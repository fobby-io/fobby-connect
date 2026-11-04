import { describe, expect, it, vi } from "vitest";
import type { MetaClient } from "../src/gateway/meta-client.ts";
import type { Page } from "../src/profiles/loop.ts";
import { checkDocument } from "../src/rules/checks.ts";
import { HEADER_KEYS, TOTALS_KEYS } from "../src/shared/fields.ts";
import { verifyDocument, type Decide } from "../src/verify/jev.ts";
import { checkUrl, deliver, sign, targets, type Graph } from "../src/server/webhook.ts";
import { png } from "../src/verify/page-image.ts";
import { PDFDocument } from "pdf-lib";

vi.mock("node:fs", () => new Proxy({}, { get: () => { throw new Error("node:fs used by the app"); } }));
const { createApp } = await import("../src/server/app.ts");

const nulls = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, null]));
// One text page: a CTNS header above one item row, a total line under it.
const page = (label = "CTNS", cells = ["50"]): Page => ({
  doc_type: "PL", issuer: "ACME CORP\nTAIPEI", header: nulls(HEADER_KEYS) as Page["header"], containers: [],
  columns: [{ field: "pkg_qty", label }],
  rows: [
    { t: "item", cont: false, g: null, cells, box: [50, 300, 950, 310] },
    { t: "total", cont: false, g: null, cells: ["50"], box: [50, 320, 950, 330] },
  ],
  groups: [], totals: { ...(nulls(TOTALS_KEYS) as Page["totals"]), total_pkgs: { v: "50", box: [50, 340, 70, 350] } }, remarks: [],
});
const ITEMS = [
  { id: 0, box: [50, 280, 90, 290] as [number, number, number, number], text: "CTNS" },
  { id: 1, box: [50, 300, 70, 310] as [number, number, number, number], text: "50" },
  { id: 2, box: [50, 340, 70, 350] as [number, number, number, number], text: "50" },
];
const pageInput = (route: "text" | "vision" = "text") => ({ page_no: 1, route, content: [{ type: "text" as const, text: "page" }], items: route === "text" ? ITEMS : [] });
const sample = (output = page()) => ({
  id: "s1", name: "sample", pages: [pageInput()],
  run: { cls: "PL", sender: null, issuer: "ACME CORP\nTAIPEI", prompt: null, pages: [{ page_no: 1, route: "text", output, reread: false }], findings: [], cost_usd: 0 },
});

// Jev stand-in: every question gets `p`, and every request is kept.
const jev = (p = 0.99) => {
  const asked: { state: unknown; questions: Record<string, unknown> }[] = [];
  const decide: Decide = async (req) => { asked.push(req); return { answers: Object.fromEntries(Object.keys(req.questions).map((k) => [k, { noul: p }])), cost: 0.00001 }; };
  return { decide, asked };
};
const noMeta: MetaClient = async () => { throw new Error("no model call expected"); };

function setup(decide?: Decide) {
  const store = new Map<string, Uint8Array>();
  const enc = new TextEncoder();
  const files = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, b: Uint8Array) => void store.set(k, b), list: async (p: string) => [...store.keys()].filter((k) => k.startsWith(p)), delete: async (k: string) => void store.delete(k) };
  const app = createApp({ files, client: noMeta, decide });
  const put = (s: unknown) => { store.set("samples/s1.json", enc.encode(JSON.stringify(s))); store.set("samples/s1.pdf", new Uint8Array([37, 80, 68, 70])); };
  put(sample());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, init?: RequestInit): Promise<any> => (await app.fetch(new Request(`http://x${path}`, init))).json();
  const post = (path: string, body?: unknown) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  return { app, store, put, call, open: () => post("/api/samples/s1/open"), approve: (id: string, answer = [page()]) => post(`/api/documents/${id}/approve`, { sender: "acme", answer }), post };
}

describe("second system and automatic approval", () => {
  it("sends a new sender to review, then approves its next verified document without a person", async () => {
    const { decide, asked } = jev();
    const t = setup(decide);
    const first = await t.open();
    expect(first.approved).toBeNull();
    expect(first.auto.reasons).toEqual(["unknown_sender"]);
    // A person reviews a first document anyway, so the second system is not paid for it.
    expect(first.verify).toBeNull();
    expect(asked).toHaveLength(0);
    await t.approve(first.id);

    const second = await t.open();
    expect(second.auto).toEqual({ ok: true, reasons: [] });
    expect(second.verify).toMatchObject({ flagged: 0, unchecked_pages: 0 });
    expect(second.approved.sender).toBe("ACME");
    expect(second.approved.corrected).toBe(0);
    const list = await t.call("/api/documents");
    expect(list.map((d: { status: string }) => d.status)).toEqual(["auto", "approved"]);
  });

  it("keeps every document in the list when several arrive at once, and still lists ones from the old single list", async () => {
    const t = setup(jev().decide);
    t.store.set("runs/index.json", new TextEncoder().encode(JSON.stringify([{ id: "old1", name: "old", sender: null, cls: "PL", status: "review", created_at: "2026-11-01T00:00:00Z", flagged: null, reopened: false }])));
    const opened = await Promise.all([1, 2, 3, 4, 5].map(() => t.open()));
    const list = await t.call("/api/documents");
    expect(list.map((d: { id: string }) => d.id).sort()).toEqual([...opened.map((d) => d.id), "old1"].sort());
    expect(list.at(-1).id).toBe("old1");
  });

  it("holds a sender after a reopened document until one passes review unchanged", async () => {
    const t = setup(jev().decide);
    await t.approve((await t.open()).id);
    const auto = await t.open();
    expect(auto.auto.ok).toBe(true);

    const back = await t.post(`/api/documents/${auto.id}/reopen`);
    expect(back.approved).toBeNull();
    expect(back.auto.reasons).toEqual(["reopened"]);
    expect((await t.call("/api/senders"))[0]).toMatchObject({ sender: "ACME", hold: true });

    const held = await t.open();
    expect(held.auto.reasons).toEqual(["on_hold"]);
    await t.approve(held.id);
    expect((await t.call("/api/senders"))[0].hold).toBe(false);
    expect((await t.open()).auto.ok).toBe(true);
  });

  it("goes to review when Jev doubts a value, the columns changed, a rule fails or nothing was verified", async () => {
    const doubt = setup(jev(0.3).decide);
    await doubt.approve((await doubt.open()).id);
    expect((await doubt.open()).auto.reasons).toEqual(["flagged"]);

    const moved = setup(jev().decide);
    await moved.approve((await moved.open()).id);
    moved.put(sample(page("CARTONS")));
    expect((await moved.open()).auto.reasons).toContain("layout_changed");

    const failing = setup(jev().decide);
    await failing.approve((await failing.open()).id);
    failing.put(sample(page("CTNS", ["49"])));
    expect((await failing.open()).auto.reasons).toContain("findings");

    const blind = setup();
    await blind.approve((await blind.open()).id);
    expect((await blind.open()).auto.reasons).toEqual(["not_checked"]);
  });
});

describe("verifyDocument", () => {
  it("asks only non-empty line item cells and the printed totals, with the column headers", async () => {
    const { decide, asked } = jev();
    const p = page("CTNS", ["50"]);
    const v = await verifyDocument(decide, [pageInput()], [p]);
    expect(v).toMatchObject({ checked: 2, flagged: 0, unchecked_pages: 0 });
    expect(v.pages[0]!.rows).toEqual([[0.99], [null]]);
    expect(JSON.stringify(asked)).toContain("CTNS @x50");
  });

  it("leaves scanned pages and failed requests unchecked instead of failing", async () => {
    const { decide } = jev();
    expect((await verifyDocument(decide, [pageInput("vision")], [page()])).unchecked_pages).toBe(1);
    const down: Decide = async () => { throw new Error("HTTP 503"); };
    const v = await verifyDocument(down, [pageInput()], [page()]);
    expect(v).toMatchObject({ unchecked_pages: 1, checked: 0, error: "HTTP 503" });
  });

  it("checks a scanned page against its picture, scaled to Jev's limits", async () => {
    // A 2000x2600 grey "scan" with a dark band, as a one-page PDF like preparePages attaches to a vision page.
    const scan = { w: 2000, h: 2600, px: new Uint8Array(2000 * 2600).fill(240) };
    scan.px.fill(20, 2000 * 1000, 2000 * 1100);
    const doc = await PDFDocument.create();
    const pageObj = doc.addPage([595, 842]);
    pageObj.drawImage(await doc.embedPng(Uint8Array.from(atob((await png(scan)).split(",")[1]!), (c) => c.charCodeAt(0))), { x: 0, y: 0, width: 595, height: 842 });
    const b64 = btoa(String.fromCharCode(...await doc.save()));
    const input = { page_no: 1, route: "vision" as const, items: [], content: [{ type: "file" as const, file: { filename: "p.pdf", file_data: `data:application/pdf;base64,${b64}` } }] };

    const { decide, asked } = jev();
    const v = await verifyDocument(decide, [input], [page()]);
    expect(v).toMatchObject({ checked: 2, flagged: 0, unchecked_pages: 0 });
    const url = (asked[0]!.state as unknown[]).find((x): x is { image_url: { url: string } } => typeof x === "object" && x !== null && "image_url" in x)!.image_url.url;
    const bytes = Uint8Array.from(atob(url.split(",")[1]!), (c) => c.charCodeAt(0));
    const dims = new DataView(bytes.buffer);
    expect([dims.getUint32(16), dims.getUint32(20)]).toEqual([1206, 1568]);
  });

  it("counts values under the pass mark as flagged", async () => {
    expect((await verifyDocument(jev(0.2).decide, [pageInput()], [page()])).flagged).toBe(2);
  });
});

describe("webhooks", () => {
  const graph = (url: string, autoSend = true): Graph => ({
    autoSend,
    nodes: [
      { id: "switch", kind: "switch", x: 0, y: 0 },
      { id: "b:acme", kind: "branch", sender: "ACME", x: 0, y: 0 }, { id: "b:acme:w", kind: "webhook", name: "ERP", url, x: 0, y: 0 },
      { id: "b:*", kind: "branch", sender: "*", x: 0, y: 0 }, { id: "b:*:d", kind: "download", x: 0, y: 0 },
    ],
    edges: [["switch", "b:acme"], ["b:acme", "b:acme:w"], ["switch", "b:*"], ["b:*", "b:*:d"]],
  });
  // The receiver: answers 200 with a receipt and keeps every request.
  const receiver = () => {
    const got: { url: string; headers: Headers; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      got.push({ url, headers: new Headers(init.headers), body: String(init.body) });
      return new Response(JSON.stringify({ receipt_id: `r${got.length}` }), { status: 200 });
    });
    return got;
  };

  it("routes a sender to its branch's webhooks, others to the catch-all, and skips empty URLs", () => {
    const g = graph("https://erp.test/in");
    expect(targets(g, "acme")).toEqual([{ name: "ERP", url: "https://erp.test/in" }]);
    expect(targets(g, "OTHER CO")).toEqual([]);
    expect(targets(graph(" "), "ACME")).toEqual([]);
  });

  it("refuses plain http and local addresses", () => {
    expect(checkUrl("http://erp.test/in")).toMatch(/https/);
    expect(checkUrl("https://127.0.0.1/in")).toMatch(/private/);
    expect(checkUrl("https://localhost:8787/in")).toMatch(/private/);
    expect(checkUrl("https://webhook.site/abc")).toBeNull();
  });

  it("signs the body, so the receiver can recompute the signature, and keeps the receipt", async () => {
    const got = receiver();
    const d = await deliver({ name: "ERP", url: "https://erp.test/in" }, "test", { a: 1 }, "whsec_x");
    vi.unstubAllGlobals();
    expect(d).toMatchObject({ ok: true, status: 200, receipt: "r1" });
    const h = got[0]!.headers;
    expect(h.get("x-fobby-signature")).toBe(`sha256=${await sign("whsec_x", h.get("x-fobby-timestamp")!, got[0]!.body)}`);
    expect(JSON.parse(got[0]!.body)).toMatchObject({ id: d.id, event: "test", data: { a: 1 } });
  });

  it("sends approved documents of a sender with a webhook, and a re-approval as a correction", async () => {
    const got = receiver();
    const t = setup(jev().decide);
    const flow = await t.call("/api/flow");
    expect(flow.secret).toMatch(/^whsec_/);
    await t.call("/api/flow", { method: "PUT", body: JSON.stringify({ graph: graph("https://erp.test/in") }) });

    const first = await t.open();
    await t.approve(first.id);
    const auto = await t.open();
    expect(auto.deliveries).toMatchObject([{ event: "document.approved", ok: true, receipt: "r2" }]);
    expect(JSON.parse(got[1]!.body).data).toMatchObject({ sender: "ACME", schema_version: 1 });

    await t.post(`/api/documents/${auto.id}/reopen`);
    await t.approve(auto.id);
    const again = await t.call(`/api/documents/${auto.id}`);
    vi.unstubAllGlobals();
    expect(again.deliveries.map((x: { event: string }) => x.event)).toEqual(["document.corrected", "document.approved"]);
  });

  it("tries a failed delivery again when due, with the same delivery id, and gives up after five tries", async () => {
    // The receiver answers 500 to the first `fails` requests, then 200.
    const got: Headers[] = [];
    const flaky = (fails: number) => vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      got.push(new Headers(init.headers));
      return new Response("{}", { status: got.length <= fails ? 500 : 200 });
    });
    const later = (min: number) => new Date(Date.now() + min * 60_000);

    flaky(1);
    const t = setup(jev().decide);
    await t.approve((await t.open()).id);
    await t.call("/api/flow", { method: "PUT", body: JSON.stringify({ graph: graph("https://erp.test/in") }) });
    const auto = await t.open();
    expect(auto.deliveries).toMatchObject([{ ok: false, status: 500, attempt: 1 }]);
    expect(auto.deliveries[0].next_at).not.toBeNull();
    expect(await t.app.retry()).toEqual({ due: 0, sent: 0 });
    expect(await t.app.retry(later(2))).toEqual({ due: 1, sent: 1 });
    const fixed = await t.call(`/api/documents/${auto.id}`);
    expect(fixed.deliveries).toMatchObject([{ id: auto.deliveries[0].id, ok: true, attempt: 2, next_at: null }]);
    expect(got.map((h) => h.get("x-fobby-delivery"))).toEqual([auto.deliveries[0].id, auto.deliveries[0].id]);
    expect(await t.app.retry(later(999))).toEqual({ due: 0, sent: 0 });

    got.length = 0;
    flaky(99);
    const t2 = setup(jev().decide);
    await t2.approve((await t2.open()).id);
    await t2.call("/api/flow", { method: "PUT", body: JSON.stringify({ graph: graph("https://erp.test/in") }) });
    const down = await t2.open();
    for (let i = 0; i < 6; i++) await t2.app.retry(later(1000 * (i + 1)));
    vi.unstubAllGlobals();
    expect((await t2.call(`/api/documents/${down.id}`)).deliveries).toMatchObject([{ ok: false, attempt: 5, next_at: null }]);
    expect(got).toHaveLength(5);
  });

  it("does not retry a URL it refuses", async () => {
    const d = await deliver({ name: "ERP", url: "http://erp.test/in" }, "test", {}, "whsec_x");
    expect(d).toMatchObject({ ok: false, attempt: 1, next_at: null });
  });
});

describe("gross against net weight", () => {
  it("finds a row whose gross weight is under its net weight", () => {
    const p = page();
    p.columns = [{ field: "nw_kg", label: "N.W." }, { field: "gw_kg", label: "G.W." }];
    p.rows = [{ t: "item", cont: false, g: null, cells: ["705.00", "667.40"], box: [0, 0, 1, 1] }, { t: "item", cont: false, g: null, cells: ["10", "12"], box: [0, 0, 1, 1] }];
    p.totals.total_pkgs = null;
    expect(checkDocument([p])).toEqual([{ page: 1, path: "rows[0].gw_kg", message: "row 1 gross weight 667.40 is less than its net weight 705.00" }]);
  });
});
