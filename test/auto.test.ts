import { describe, expect, it, vi } from "vitest";
import type { MetaClient } from "../src/gateway/meta-client.ts";
import type { Page } from "../src/profiles/loop.ts";
import { checkDocument } from "../src/rules/checks.ts";
import { HEADER_KEYS, TOTALS_KEYS } from "../src/shared/fields.ts";
import { verifyDocument, type Decide } from "../src/verify/jev.ts";

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
  const files = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, b: Uint8Array) => void store.set(k, b) };
  const app = createApp({ files, client: noMeta, decide });
  const put = (s: unknown) => { store.set("samples/s1.json", enc.encode(JSON.stringify(s))); store.set("samples/s1.pdf", new Uint8Array([37, 80, 68, 70])); };
  put(sample());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (path: string, init?: RequestInit): Promise<any> => (await app.fetch(new Request(`http://x${path}`, init))).json();
  const post = (path: string, body?: unknown) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  return { put, call, open: () => post("/api/samples/s1/open"), approve: (id: string, answer = [page()]) => post(`/api/documents/${id}/approve`, { sender: "acme", answer }), post };
}

describe("second system and automatic approval", () => {
  it("sends a new sender to review, then approves its next verified document without a person", async () => {
    const { decide } = jev();
    const t = setup(decide);
    const first = await t.open();
    expect(first.approved).toBeNull();
    expect(first.auto.reasons).toEqual(["unknown_sender"]);
    expect(first.verify).toMatchObject({ flagged: 0, unchecked_pages: 0 });
    await t.approve(first.id);

    const second = await t.open();
    expect(second.auto).toEqual({ ok: true, reasons: [] });
    expect(second.approved.sender).toBe("ACME");
    expect(second.approved.corrected).toBe(0);
    const list = await t.call("/api/documents");
    expect(list.map((d: { status: string }) => d.status)).toEqual(["auto", "approved"]);
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

  it("counts values under the pass mark as flagged", async () => {
    expect((await verifyDocument(jev(0.2).decide, [pageInput()], [page()])).flagged).toBe(2);
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
