import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { MetaError, type MetaClient } from "../src/gateway/meta-client.ts";
import type { Page } from "../src/profiles/loop.ts";
import { HEADER_KEYS, TOTALS_KEYS } from "../src/shared/fields.ts";

// The Worker has no file system: loading the app must not touch node:fs.
vi.mock("node:fs", () => new Proxy({}, { get: () => { throw new Error("node:fs used by the app"); } }));
const { createApp } = await import("../src/server/app.ts");

const nulls = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, null]));
const PAGE: Page = {
  doc_type: "PL", issuer: "ACME CORP\nTAIPEI", header: nulls(HEADER_KEYS) as Page["header"], containers: [],
  columns: [{ field: "pkg_qty", label: "CTNS" }],
  rows: [{ t: "item", cont: false, g: null, cells: ["50"], box: [0, 0, 1, 1] }],
  groups: [], totals: { ...(nulls(TOTALS_KEYS) as Page["totals"]), total_pkgs: { v: "50", box: [0, 0, 1, 1] } }, remarks: [],
};

function setup(client: MetaClient) {
  const store = new Map<string, Uint8Array>();
  const files = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, b: Uint8Array) => void store.set(k, b), list: async (p: string) => [...store.keys()].filter((k) => k.startsWith(p)) };
  return { store, app: createApp({ files, client }) };
}
const reads = () => {
  const c = vi.fn(async () => ({ content: JSON.stringify(PAGE), finish_reason: "stop", usage: { prompt_tokens: 10, cached_tokens: 0, completion_tokens: 10, reasoning_tokens: 0 }, request_id: null, ms: 1 }));
  return c;
};
const pdf = async () => { const d = await PDFDocument.create(); d.addPage(); return (await d.save()).slice(); };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Res = { status: number; headers: Headers; json(): Promise<any> };
const call = (app: ReturnType<typeof createApp>, path: string, init?: RequestInit): Promise<Res> => app.fetch(new Request(`http://x${path}`, init));
const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("createApp", () => {
  it("uploads, reads and approves a document, keeping the PDF and the learned profile in files", async () => {
    const c = reads();
    const { app, store } = setup(c);
    const up = await call(app, "/api/documents?name=a.pdf", { method: "POST", body: await pdf() });
    expect(up.status).toBe(200);
    const doc = await up.json();
    expect(c).toHaveBeenCalled();
    expect((await call(app, `/api/documents/${doc.id}/file`)).headers.get("content-type")).toBe("application/pdf");

    const ok = await call(app, `/api/documents/${doc.id}/approve`, post({ sender: "acme", answer: [PAGE] }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).corrected).toBe(0);
    expect(store.has("profiles.json")).toBe(true);
    expect((await (await call(app, `/api/documents/${doc.id}`)).json()).approved.sender).toBe("ACME");
  });

  it("exports only approved documents, from the stored answer", async () => {
    const { app } = setup(reads());
    const doc = await (await call(app, "/api/documents", { method: "POST", body: await pdf() })).json();
    const early = await call(app, `/api/documents/${doc.id}/export.csv`);
    expect(early.status).toBe(409);
    expect((await early.json()).error.code).toBe("not_approved");

    // The answer equals the model output, so learning ends at no_change without a model call.
    const ok = await (await call(app, `/api/documents/${doc.id}/approve`, post({ sender: "acme", answer: [PAGE] }))).json();
    expect(ok.approved_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    const again = await call(app, `/api/documents/${doc.id}`);
    const v = (await again.json()).approved;
    expect(v.approved_at).toBe(ok.approved_at);
    expect("answer" in v).toBe(false);

    const csv = await call(app, `/api/documents/${doc.id}/export.csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("content-disposition")).toBe(`attachment; filename="${doc.id}.csv"`);
    const j = await call(app, `/api/documents/${doc.id}/export.json`);
    expect(j.headers.get("content-disposition")).toBe(`attachment; filename="${doc.id}.json"`);
    expect(j.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body = await j.json();
    expect(body.sender).toBe("ACME");
    expect(body.rows[0].pkgs.v).toBe("50");

    // A second submit keeps what the first one stored.
    const twice = await (await call(app, `/api/documents/${doc.id}/approve`, post({ sender: "other", answer: [PAGE] }))).json();
    expect(twice.approved_at).toBe(ok.approved_at);
    expect((await (await call(app, `/api/documents/${doc.id}/export.json`)).json()).sender).toBe("ACME");
  });

  it("refuses to export a document approved before export existed", async () => {
    const { app, store } = setup(reads());
    const doc = await (await call(app, "/api/documents", { method: "POST", body: await pdf() })).json();
    await call(app, `/api/documents/${doc.id}/approve`, post({ sender: "acme", answer: [PAGE] }));
    const key = `runs/${doc.id}.json`;
    const saved = JSON.parse(new TextDecoder().decode(store.get(key)));
    saved.approved = { sender: saved.approved.sender, learn: saved.approved.learn, corrected: saved.approved.corrected };
    store.set(key, new TextEncoder().encode(JSON.stringify(saved)));
    for (const ext of ["csv", "json"]) {
      const r = await call(app, `/api/documents/${doc.id}/export.${ext}`);
      expect(r.status).toBe(409);
      expect((await r.json()).error.code).toBe("not_approved");
    }
    expect("approved_at" in (await (await call(app, `/api/documents/${doc.id}`)).json()).approved).toBe(false);
  });

  it("opens a sample as a new copy without calling the model", async () => {
    const c = reads();
    const { app, store } = setup(c);
    const enc = (x: unknown) => new TextEncoder().encode(JSON.stringify(x));
    store.set("samples/index.json", enc([{ id: "s1", name: "Sample", sender: "DEMO" }]));
    store.set("samples/s1.json", enc({ id: "s1", name: "Sample", pages: [], run: { cls: "PL", sender: "DEMO", issuer: null, prompt: null, pages: [{ page_no: 1, route: "vision", output: PAGE, reread: false }], findings: [], cost_usd: 0 } }));
    store.set("samples/s1.pdf", await pdf());

    expect(await (await call(app, "/api/samples")).json()).toEqual([{ id: "s1", name: "Sample", sender: "DEMO" }]);
    const r = await (await call(app, "/api/samples/s1/open", { method: "POST" })).json();
    expect(r.id).not.toBe("s1");
    expect(store.has(`runs/${r.id}.pdf`)).toBe(true);
    expect(c).not.toHaveBeenCalled();
  });

  it("answers 402 credit_exhausted when Meta says the credit is gone", async () => {
    const { app } = setup(async () => { throw new MetaError(402, false, "insufficient credit"); });
    const r = await call(app, "/api/documents", { method: "POST", body: await pdf() });
    expect(r.status).toBe(402);
    expect((await r.json()).error.code).toBe("credit_exhausted");
  });

  it("refuses a document over 20 pages before any read", async () => {
    const c = reads();
    const { app } = setup(c);
    const d = await PDFDocument.create();
    for (let i = 0; i < 21; i++) d.addPage();
    const r = await call(app, "/api/documents", { method: "POST", body: (await d.save()).slice() });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("too_many_pages");
    expect(c).not.toHaveBeenCalled();
  });

  it("answers a network failure as a JSON 500, and never sends the prompt's examples", async () => {
    const { app } = setup(async () => { throw new MetaError(0, false, "fetch failed"); });
    const r = await call(app, "/api/documents", { method: "POST", body: await pdf() });
    expect(r.status).toBe(500);
    expect((await r.json()).error.message).toMatch(/fetch failed/);

    const ok = setup(reads());
    const doc = await (await call(ok.app, "/api/documents", { method: "POST", body: await pdf() })).json();
    expect(Object.keys(doc.run.prompt)).toEqual(["id", "level", "key", "version"]);
  });

  it("returns errors in one shape", async () => {
    const { app } = setup(reads());
    const r = await call(app, "/api/documents/nope");
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe("not_found");
  });
});
