import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { MetaError, type MetaClient } from "../src/gateway/meta-client.ts";
import type { Page } from "../src/profiles/loop.ts";
import { HEADER_KEYS, TOTALS_KEYS } from "../src/shared/fields.ts";

import type { Mail } from "../src/server/app.ts";
import { lazyDb, pgliteDb } from "../src/server/pg-node.ts";

// Hosts without a file system serve the app too: loading it must not touch node:fs.
vi.mock("node:fs", () => new Proxy({}, { get: () => { throw new Error("node:fs used by the app"); } }));
const { createApp } = await import("../src/server/app.ts");

const nulls = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, null]));
const PAGE: Page = {
  doc_type: "PL", issuer: "ACME CORP\nTAIPEI", header: nulls(HEADER_KEYS) as Page["header"], containers: [],
  columns: [{ field: "pkg_qty", label: "CTNS" }],
  rows: [{ t: "item", cont: false, g: null, cells: ["50"], box: [0, 0, 1, 1] }],
  groups: [], totals: { ...(nulls(TOTALS_KEYS) as Page["totals"]), total_pkgs: { v: "50", box: [0, 0, 1, 1] } }, remarks: [],
};

const shared = pgliteDb();
function setup(client: MetaClient, mail?: (m: Mail) => Promise<{ id?: string }>, dailyReads?: number) {
  const store = new Map<string, Uint8Array>();
  // One PGlite per file; each setup is its own space in it, as each team is.
  const own = new TextEncoder().encode(JSON.stringify({ id: crypto.randomUUID() }));
  const files = { get: async (k: string) => (k === "space.json" ? own : store.get(k) ?? null), put: async (k: string, b: Uint8Array) => void store.set(k, b), list: async (p: string) => [...store.keys()].filter((k) => k.startsWith(p)), delete: async (k: string) => void store.delete(k) };
  return { store, app: createApp({ files, db: lazyDb(shared), client, mail, dailyReads }) };
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
  it("uploads, reads and approves a document, keeping the PDF and the approved example in files", async () => {
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
    expect(store.has(`examples/${doc.id}.json`)).toBe(true);
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

  it("shows a document only to the space that has it in the database, whatever files exist", async () => {
    const { app, store } = setup(reads());
    const doc = await (await call(app, "/api/documents", { method: "POST", body: await pdf() })).json();
    // The same files under another space: the run JSON and PDF are there, the database row is not.
    const other = new TextEncoder().encode(JSON.stringify({ id: crypto.randomUUID() }));
    const files = { get: async (k: string) => (k === "space.json" ? other : store.get(k) ?? null), put: async (k: string, b: Uint8Array) => void store.set(k, b), list: async (p: string) => [...store.keys()].filter((k) => k.startsWith(p)), delete: async (k: string) => void store.delete(k) };
    const stranger = createApp({ files, db: lazyDb(shared), client: reads() });
    expect(await (await call(stranger, "/api/documents")).json()).toEqual([]);
    for (const p of ["", "/file", "/export.json"]) expect((await call(stranger, `/api/documents/${doc.id}${p}`)).status).toBe(404);
    expect((await call(app, `/api/documents/${doc.id}`)).status).toBe(200);
  });

  it("answers 402 credit_exhausted when Meta says the credit is gone", async () => {
    const { app } = setup(async () => { throw new MetaError(402, false, "insufficient credit"); });
    const r = await call(app, "/api/documents", { method: "POST", body: await pdf() });
    expect(r.status).toBe(402);
    expect((await r.json()).error.code).toBe("credit_exhausted");
  });

  it("refuses a document over 20 pages before any read, and keeps nothing", async () => {
    const c = reads();
    const { app, store } = setup(c);
    const d = await PDFDocument.create();
    for (let i = 0; i < 21; i++) d.addPage();
    const r = await call(app, "/api/documents", { method: "POST", body: (await d.save()).slice() });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("too_many_pages");
    expect(c).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("stops model-backed actions at the daily cap as credit_exhausted, counting corrected approvals but not clean ones", async () => {
    const c = reads();
    const { app, store } = setup(c, undefined, 2);
    const doc = await (await call(app, "/api/documents", { method: "POST", body: await pdf() })).json();
    // An approval without corrections calls no model and is not counted.
    expect((await call(app, `/api/documents/${doc.id}/approve`, post({ sender: "acme", answer: [PAGE] }))).status).toBe(200);
    const second = await call(app, "/api/documents", { method: "POST", body: await pdf() });
    expect(second.status).toBe(200);
    const calls = c.mock.calls.length;
    const third = await call(app, "/api/documents", { method: "POST", body: await pdf() });
    expect(third.status).toBe(402);
    expect((await third.json()).error.code).toBe("credit_exhausted");
    expect(c.mock.calls.length).toBe(calls);
    expect([...store.keys()].filter((k) => k.endsWith(".pdf"))).toHaveLength(2);
    const fixed = { ...PAGE, rows: [{ ...PAGE.rows[0]!, cells: ["51"] }] };
    const corrected = await call(app, `/api/documents/${(await second.json()).id}/approve`, post({ sender: "acme", answer: [fixed] }));
    expect(corrected.status).toBe(402);
  });

  it("refuses a file that is not a PDF, or a broken one, before keeping it", async () => {
    const c = reads();
    const { app, store } = setup(c);
    for (const body of [new TextEncoder().encode("hello"), new TextEncoder().encode("%PDF-1.7 broken")]) {
      const r = await call(app, "/api/documents", { method: "POST", body });
      expect(r.status).toBe(400);
      expect((await r.json()).error.code).toBe("not_pdf");
    }
    expect(c).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("answers 400 bad_answer to approve and normalize bodies that are not JSON or not answer pages", async () => {
    const { app } = setup(reads());
    const doc = await (await call(app, "/api/documents", { method: "POST", body: await pdf() })).json();
    const bad = [
      [`/api/documents/${doc.id}/approve`, "not json"], [`/api/documents/${doc.id}/approve`, JSON.stringify({ sender: "acme" })],
      [`/api/documents/${doc.id}/approve`, JSON.stringify({ sender: "acme", answer: [{ rows: 1 }] })],
      ["/api/normalize", "{"], ["/api/normalize", JSON.stringify({ answer: "x" })], ["/api/normalize", "null"],
    ];
    for (const [path, body] of bad) {
      const r = await call(app, path!, { method: "POST", headers: { "content-type": "application/json" }, body });
      expect([path, r.status, (await r.json()).error.code]).toEqual([path, 400, "bad_answer"]);
    }
    expect((await (await call(app, `/api/documents/${doc.id}`)).json()).approved).toBeNull();
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

describe("email", () => {
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/.{76}/g, "$&\r\n");
  const part = (type: string, filename: string, bytes: Uint8Array) =>
    `--b\r\nContent-Type: ${type}\r\nContent-Disposition: attachment; filename="${filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(bytes)}\r\n`;
  const mime = async () => new TextEncoder().encode(
    "From: Sales <sales@acme.test>\r\nTo: in@connect.test\r\nSubject: PL 1234\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"b\"\r\n\r\n"
    + "--b\r\nContent-Type: text/plain\r\n\r\nPlease see attached.\r\n"
    + part("application/pdf", "pl-1234.pdf", await pdf())
    + part("application/octet-stream", "fake.pdf", new TextEncoder().encode("hello"))
    + part("image/png", "logo.png", new Uint8Array([137, 80, 78, 71]))
    + "--b--\r\n");

  it("reads each attached PDF like an upload, lists one that is not a PDF with its error, and skips other files", async () => {
    const { app } = setup(reads());
    const r = await app.receiveEmail(await mime(), "sales@acme.test");
    expect(r.subject).toBe("PL 1234");
    expect(r.documents).toEqual([{ name: "pl-1234.pdf", id: expect.any(String) }, { name: "fake.pdf", error: "這不是 PDF 檔。" }]);
    const doc = await (await call(app, `/api/documents/${r.documents[0]!.id}`)).json();
    expect(doc.name).toBe("pl-1234.pdf");
    expect(doc.source).toEqual({ via: "email", from: "sales@acme.test", subject: "PL 1234" });
    expect((await (await call(app, "/api/documents")).json())).toHaveLength(1);
  });

  it("emails the approved record to the branch's recipients with JSON and CSV attached, and records each send", async () => {
    let fail = false;
    const sent: Mail[] = [];
    const { app, store } = setup(reads(), async (m) => { if (fail) throw new Error("E_RATE_LIMIT_EXCEEDED"); sent.push(m); return { id: `msg-${sent.length}` }; });
    expect((await (await call(app, "/api/flow")).json()).mail).toBe(true);
    const graph = {
      autoSend: true, edges: [["b", "e1"], ["b", "e2"], ["b", "e3"]],
      nodes: [{ id: "b", kind: "branch", sender: "*", x: 0, y: 0 }, { id: "e1", kind: "email", to: "Ops@Acme.test", x: 0, y: 0 }, { id: "e2", kind: "email", to: "ops@acme.test", x: 0, y: 0 }, { id: "e3", kind: "email", to: "not an address", x: 0, y: 0 }],
    };
    expect((await call(app, "/api/flow", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ graph }) })).status).toBe(200);
    const doc = await (await call(app, "/api/documents?name=a.pdf", { method: "POST", body: await pdf() })).json();
    await call(app, `/api/documents/${doc.id}/approve`, post({ sender: "acme", answer: [PAGE] }));

    expect(sent.map((m) => m.to)).toEqual(["ops@acme.test"]);
    expect(sent[0]!.attachments.map((a) => a.filename)).toEqual([`${doc.id}.json`, `${doc.id}.csv`]);
    expect(JSON.parse(sent[0]!.attachments[0]!.content)).toMatchObject({ id: doc.id, sender: "ACME" });
    const ds = (await (await call(app, `/api/documents/${doc.id}`)).json()).deliveries;
    expect(ds).toMatchObject([{ url: "mailto:ops@acme.test", ok: true, receipt: "msg-1", event: "document.approved", next_at: null }]);

    // A failed send is recorded with the host's error and is not queued for retry.
    fail = true;
    const again = await (await call(app, `/api/documents/${doc.id}/send`, { method: "POST" })).json();
    expect(again.deliveries[0]).toMatchObject({ ok: false, error: "E_RATE_LIMIT_EXCEEDED", event: "document.corrected", next_at: null });
    expect([...store.keys()].some((k) => k.includes("/retries/"))).toBe(false);
  });
});
