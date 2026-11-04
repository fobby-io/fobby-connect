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
  const files = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, b: Uint8Array) => void store.set(k, b) };
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

  it("returns errors in one shape", async () => {
    const { app } = setup(reads());
    const r = await call(app, "/api/documents/nope");
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe("not_found");
  });
});
