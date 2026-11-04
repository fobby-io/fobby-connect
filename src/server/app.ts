// The review API for both hosts: the local Node server (src/server/local.ts) and the cloud Worker (private repo).
// No Node built-ins here: files and the Meta client come in as deps.
import { CreditExhausted, creditGuard } from "../gateway/credit.ts";
import { gateway } from "../gateway/gateway.ts";
import { memoryLedger } from "../gateway/ledger.ts";
import type { MetaClient } from "../gateway/meta-client.ts";
import { normalize } from "../normalize/normalize.ts";
import { preparePages, readMissingColumn, replayReader, runDocument, type PageInput, type RunResult } from "../pipeline/run.ts";
import { diff, learn, memoryStore, seed, type Page, type Store } from "../profiles/loop.ts";
import { sparkRewrite } from "../profiles/rewrite.ts";
import { checkDocument } from "../rules/checks.ts";
import { HEADER_KEYS, LINE_FIELDS } from "../shared/fields.ts";
import { schemas } from "../shared/model-output.ts";

/** Keys: runs/<id>.pdf|json, profiles.json, samples/index.json, samples/<id>.pdf|json. */
export type Files = { get(key: string): Promise<Uint8Array | null>; put(key: string, bytes: Uint8Array): Promise<void> };
export type Deps = { files: Files; client: MetaClient; spent?: () => number };
export type Saved = { id: string; name: string; run: RunResult; pages: PageInput[]; approved?: { sender: string; learn: unknown; corrected: number } };
export type Sample = { id: string; name: string; sender: string };

const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_PAGES = 20;
const enc = new TextEncoder(), dec = new TextDecoder();
const toJson = (x: unknown) => enc.encode(JSON.stringify(x));
const fail = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });
const json = (status: number, x: unknown) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });

export function createApp(deps: Deps) {
  const client = creditGuard(deps.client);
  const g = gateway(client, memoryLedger());
  const { files } = deps;
  const spent = () => deps.spent?.() ?? null;

  const getJson = async <T>(key: string): Promise<T | null> => { const b = await files.get(key); return b && JSON.parse(dec.decode(b)); };
  const load = async (id: string): Promise<Saved> => {
    const d = await getJson<Saved>(`runs/${id}.json`);
    if (!d) throw fail(404, "not_found", `document ${id}`);
    // Runs saved before a header key was added lack it; the schema needs every key present.
    for (const p of d.run.pages) for (const k of HEADER_KEYS) p.output.header[k] ??= null;
    return d;
  };
  const save = (d: Saved) => files.put(`runs/${d.id}.json`, toJson(d));
  // The prompt's examples hold rows of earlier approved documents, possibly another visitor's: send only which prompt it was.
  const view = (d: Saved) => ({ id: d.id, name: d.name, run: { ...d.run, prompt: d.run.prompt && { id: d.run.prompt.id, level: d.run.prompt.level, key: d.run.prompt.key, version: d.run.prompt.version } }, normalized: normalize(d.run.pages.map((p) => p.output)), approved: d.approved ?? null, spent: spent() });
  const newId = () => crypto.randomUUID().slice(0, 8);

  // Profiles live in one JSON: read per request, written back only when the request changed them.
  // Assumed: two approvals at the same moment, the later write wins; fine for the demo, Postgres replaces it.
  async function withStore<T>(f: (s: Store) => Promise<T>): Promise<T> {
    const m = memoryStore((await getJson("profiles.json")) ?? {});
    let dirty = false;
    const s: Store = { ...m, put: (v) => { dirty = true; m.put(v); }, addApproved: (a) => { dirty = true; m.addApproved(a); } };
    seed(s);
    const r = await f(s);
    if (dirty) await files.put("profiles.json", toJson(m.dump()));
    return r;
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const body = async () => {
      if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD) throw fail(413, "too_large", "file over 25 MB");
      const b = new Uint8Array(await req.arrayBuffer());
      if (b.length > MAX_UPLOAD) throw fail(413, "too_large", "file over 25 MB");
      return b;
    };
    const bodyJson = async <T>() => JSON.parse(dec.decode(await body())) as T;
    let m: RegExpMatchArray | null;

    if (req.method === "POST" && path === "/api/documents") {
      const bytes = await body();
      const id = newId();
      await files.put(`runs/${id}.pdf`, bytes);
      const pages = await preparePages(bytes);
      // Every page is a paid read and anyone can upload: one document is at most what the billing unit covers twice.
      if (pages.length > MAX_PAGES) throw fail(400, "too_many_pages", `這份文件有 ${pages.length} 頁，示範版一次最多讀 ${MAX_PAGES} 頁。`);
      const run = await withStore((s) => runDocument(g, s, pages, { doc_id: id, sender: url.searchParams.get("sender") || null }));
      const d: Saved = { id, name: url.searchParams.get("name") ?? id, run, pages };
      await save(d);
      return json(200, view(d));
    }
    if (req.method === "GET" && path === "/api/profiles") {
      return withStore(async (s) => json(200, s.senders().map((x) => ({ sender: x, versions: ["PL", "SO"].flatMap((c) => s.versions("sender", `${x}/${c}`)) }))));
    }
    if (req.method === "GET" && path === "/api/samples") return json(200, (await getJson<Sample[]>("samples/index.json")) ?? []);
    // A sample is opened as a copy, so the original is never approved or edited; no model call.
    if (req.method === "POST" && (m = path.match(/^\/api\/samples\/([\w-]+)\/open$/))) {
      const src = await getJson<Saved>(`samples/${m[1]}.json`);
      const pdf = await files.get(`samples/${m[1]}.pdf`);
      if (!src || !pdf) throw fail(404, "not_found", `sample ${m[1]}`);
      const d: Saved = { ...src, id: newId(), approved: undefined };
      await files.put(`runs/${d.id}.pdf`, pdf);
      await save(d);
      return json(200, view(d));
    }
    if (req.method === "GET" && (m = path.match(/^\/api\/documents\/([\w-]+)\/file$/))) {
      const pdf = await files.get(`runs/${m[1]}.pdf`);
      if (!pdf) throw fail(404, "not_found", `document ${m[1]}`);
      return new Response(pdf.slice(), { headers: { "content-type": "application/pdf" } });
    }
    if (req.method === "GET" && (m = path.match(/^\/api\/documents\/([\w-]+)$/))) return json(200, view(await load(m[1]!)));
    // The review screen sends the edited raw values and shows what they normalize to and which checks still fail.
    if (req.method === "POST" && path === "/api/normalize") {
      const answer = (await bodyJson<{ answer: unknown[] }>()).answer.map((p) => schemas.compact.parse(p));
      return json(200, { normalized: normalize(answer), findings: checkDocument(answer) });
    }
    // A printed column the read left out: re-read that one page with the column named.
    if (req.method === "POST" && (m = path.match(/^\/api\/documents\/([\w-]+)\/pages\/(\d+)\/columns$/))) {
      const d = await load(m[1]!), n = Number(m[2]), page = d.pages[n - 1];
      const b = await bodyJson<{ label?: string; field?: string; page?: unknown }>();
      const label = (b.label ?? "").trim().slice(0, 60);
      if (!page || !label || !(LINE_FIELDS as readonly string[]).includes(b.field ?? "")) throw fail(400, "bad_column", "Name the printed column and pick what it is.");
      // The page as the clerk has it now (with their edits), validated like any answer.
      const current = schemas.compact.parse(b.page ?? d.run.pages[n - 1]!.output);
      const r = await withStore((s) => readMissingColumn(g, s, page, { doc_id: d.id, prompt: d.run.prompt, current, label, field: b.field! }));
      if (!r.output) throw fail(422, "still_missing", `重讀後還是沒有「${label}」這一欄，或對不上原本的列。請確認欄名和文件上印的一樣。`);
      return json(200, { output: r.output, cost_usd: r.cost_usd });
    }
    if (req.method === "POST" && (m = path.match(/^\/api\/documents\/([\w-]+)\/approve$/))) {
      const d = await load(m[1]!);
      // A repeated submit (double click, retry after a slow answer) gets the saved result, not an error.
      if (d.approved) return json(200, { corrected: d.approved.corrected, learn: d.approved.learn, spent: spent() });
      const b = await bodyJson<{ sender: string; answer: Page[] }>();
      const sender = (b.sender ?? "").trim().toUpperCase();
      if (!sender) throw fail(400, "sender_required", "Name the sender before approving.");
      // The answer comes from the browser: validate it against the same schema the model output passed.
      const answer = b.answer.map((p) => schemas.compact.parse(p));
      const model = d.run.pages.map((p) => p.output);
      const corrected = diff(model, answer).length;
      const result = await withStore((s) => learn(s, {
        doc_id: d.id, sender, cls: d.run.cls ?? "PL", pages: d.pages.map((p) => p.content), answer, model,
      }, replayReader(g, s), sparkRewrite(client)));
      d.approved = { sender, learn: result, corrected };
      await save(d);
      return json(200, { corrected, learn: result, spent: spent() });
    }
    throw fail(404, "not_found", path);
  }

  return {
    async fetch(req: Request): Promise<Response> {
      try {
        return await handle(req);
      } catch (e) {
        if (e instanceof CreditExhausted) return json(402, { error: { code: "credit_exhausted", message: "示範額度已用完，請打開範例貨件。" } });
        const x = e as { status?: number; code?: string; message: string };
        // A network failure carries status 0 and Meta's own 429/503 are not this API's answer: anything else is a 500.
        const status = x.status && x.status >= 400 && x.status < 500 && x.code ? x.status : 500;
        return json(status, { error: { code: x.code ?? "failed", message: x.message } });
      }
    },
  };
}
