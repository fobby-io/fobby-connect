// The review API for both hosts: the local Node server (src/server/local.ts) and the cloud Worker (private repo).
// No Node built-ins here: files and the Meta client come in as deps.
import { CreditExhausted, creditGuard } from "../gateway/credit.ts";
import { gateway } from "../gateway/gateway.ts";
import { memoryLedger } from "../gateway/ledger.ts";
import type { MetaClient } from "../gateway/meta-client.ts";
import { normalize } from "../normalize/normalize.ts";
import { matchSender, preparePages, readMissingColumn, replayReader, runDocument, type PageInput, type RunResult } from "../pipeline/run.ts";
import { diff, learn, memoryStore, seed, type Page, type Store } from "../profiles/loop.ts";
import { sparkRewrite } from "../profiles/rewrite.ts";
import { checkDocument } from "../rules/checks.ts";
import { HEADER_KEYS, LINE_FIELDS } from "../shared/fields.ts";
import { schemas } from "../shared/model-output.ts";
import { verifyDocument, type Decide, type Verification } from "../verify/jev.ts";
import { exportCsv, exportJson, type Exportable } from "./export.ts";

/** Keys: runs/<id>.pdf|json, runs/index.json, profiles.json, senders.json, samples/index.json, samples/<id>.pdf|json. */
export type Files = { get(key: string): Promise<Uint8Array | null>; put(key: string, bytes: Uint8Array): Promise<void> };
/** decide is the second system (Jev); without it nothing is verified and every document goes to a person. */
export type Deps = { files: Files; client: MetaClient; spent?: () => number; decide?: Decide };
/** Why a document was not approved automatically; empty when it was. */
export type AutoReason = "unknown_sender" | "on_hold" | "not_checked" | "flagged" | "findings" | "layout_changed" | "reopened";
// approved.answer and approved_at are missing on documents approved before export existed.
export type Saved = {
  id: string; name: string; run: RunResult; pages: PageInput[]; created_at?: string; verify?: Verification;
  auto?: { ok: boolean; reasons: AutoReason[] };
  approved?: { sender: string; learn: unknown; corrected: number; answer?: Page[]; approved_at?: string };
};
export type Sample = { id: string; name: string; sender: string };
export type ListedDoc = {
  id: string; name: string; sender: string | null; cls: string | null; status: "review" | "approved" | "auto";
  created_at: string; flagged: number | null; reopened: boolean;
};
type SenderState = Record<string, { hold?: boolean }>;

const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_PAGES = 20;
const enc = new TextEncoder(), dec = new TextDecoder();
const toJson = (x: unknown) => enc.encode(JSON.stringify(x));
const fail = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });
const json = (status: number, x: unknown) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
const download = (body: string, type: string, filename: string) =>
  new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, "content-disposition": `attachment; filename="${filename}"` } });

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
  const senderOf = (d: Saved) => d.approved?.sender ?? d.run.sender ?? ((d.run.issuer ?? "").split("\n")[0]?.trim() || null);
  const listed = (d: Saved): ListedDoc => ({
    id: d.id, name: d.name, sender: senderOf(d), cls: d.run.cls, created_at: d.created_at ?? "",
    status: d.approved ? (d.auto?.ok ? "auto" : "approved") : "review",
    flagged: d.verify ? d.verify.flagged : null, reopened: d.auto?.reasons.includes("reopened") ?? false,
  });
  // shortcut: the list is one JSON rewritten on every save, so two saves at once can drop an entry; Postgres replaces it.
  const save = async (d: Saved) => {
    await files.put(`runs/${d.id}.json`, toJson(d));
    const list = ((await getJson<ListedDoc[]>("runs/index.json")) ?? []).filter((x) => x.id !== d.id);
    await files.put("runs/index.json", toJson([listed(d), ...list]));
  };
  // The prompt's examples hold rows of earlier approved documents, possibly another visitor's: send only which prompt it was.
  const view = (d: Saved) => ({ id: d.id, name: d.name, created_at: d.created_at ?? null, verify: d.verify ?? null, auto: d.auto ?? null, run: { ...d.run, prompt: d.run.prompt && { id: d.run.prompt.id, level: d.run.prompt.level, key: d.run.prompt.key, version: d.run.prompt.version } }, normalized: normalize(d.run.pages.map((p) => p.output)), approved: d.approved ? (({ answer: _, ...a }) => a)(d.approved) : null, spent: spent() });
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

  const senderState = async () => (await getJson<SenderState>("senders.json")) ?? {};
  const setHold = async (sender: string, hold: boolean) => {
    const st = await senderState();
    if (!!st[sender]?.hold === hold) return;
    st[sender] = { ...st[sender], hold };
    await files.put("senders.json", toJson(st));
  };
  const layoutKey = (pages: Page[]) => [...new Set(pages.flatMap((p) => p.columns.map((c) => `${c.field}=${c.label.replace(/\s+/g, " ").trim().toUpperCase()}`)))].sort().join("|");

  // Approving saves the answer as this sender's newest example and learns from any correction (the slow part).
  async function approveDoc(d: Saved, sender: string, answer: Page[]) {
    const model = d.run.pages.map((p) => p.output);
    const corrected = diff(model, answer).length;
    const result = await withStore((s) => learn(s, {
      doc_id: d.id, sender, cls: d.run.cls ?? "PL", pages: d.pages.map((p) => p.content), answer, model,
    }, replayReader(g, s), sparkRewrite(client)));
    d.approved = { sender, learn: result, corrected, answer, approved_at: new Date().toISOString() };
    return d.approved;
  }

  /**
   * After the first read: the second system checks every value, then the document is approved without a person only
   * when the sender is known and not on hold, every value is verified, every rule passes and the columns are the ones
   * this sender's last approved document had. Anything else goes to review, with the reasons.
   */
  async function intake(d: Saved) {
    d.created_at = new Date().toISOString();
    const outputs = d.run.pages.map((p) => p.output);
    if (deps.decide) d.verify = await verifyDocument(deps.decide, d.pages, outputs);
    const cls = d.run.cls ?? "PL";
    // A sample was read before this sender was known: match its issuer against the senders known now.
    const { sender, last } = await withStore(async (s) => {
      const sender = d.run.sender ?? matchSender(d.run.issuer, s.senders());
      return { sender, last: sender ? s.approved({ sender, cls }).at(-1) : undefined };
    });
    d.run.sender = sender;
    const reasons: AutoReason[] = [];
    if (!sender || !last) reasons.push("unknown_sender");
    else {
      if ((await senderState())[sender]?.hold) reasons.push("on_hold");
      if (layoutKey(last.answer) !== layoutKey(outputs)) reasons.push("layout_changed");
    }
    if (!d.verify || d.verify.unchecked_pages > 0) reasons.push("not_checked");
    else if (d.verify.flagged > 0) reasons.push("flagged");
    // Rules run again here so samples read before a rule existed are held to it too.
    d.run.findings = checkDocument(outputs);
    if (d.run.findings.length) reasons.push("findings");
    d.auto = { ok: reasons.length === 0, reasons };
    if (d.auto.ok) await approveDoc(d, sender!, outputs);
    await save(d);
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
      await intake(d);
      return json(200, view(d));
    }
    if (req.method === "GET" && path === "/api/documents") return json(200, (await getJson<ListedDoc[]>("runs/index.json")) ?? []);
    if (req.method === "GET" && path === "/api/profiles") {
      return withStore(async (s) => json(200, s.senders().map((x) => ({ sender: x, versions: ["PL", "SO"].flatMap((c) => s.versions("sender", `${x}/${c}`)) }))));
    }
    // One entry per sender: its readings (prompt versions, examples left out), whether it is on hold, and its documents.
    if (req.method === "GET" && path === "/api/senders") {
      const docs = (await getJson<ListedDoc[]>("runs/index.json")) ?? [];
      const st = await senderState();
      return withStore(async (s) => json(200, s.senders().map((x) => ({
        sender: x, hold: !!st[x]?.hold,
        versions: ["PL", "SO"].flatMap((c) => s.versions("sender", `${x}/${c}`)).map(({ examples, ...v }) => ({ ...v, examples: examples.length })),
        approved: ["PL", "SO"].map((cls) => ({ cls, count: s.approved({ sender: x, cls }).length })).filter((a) => a.count),
        docs: docs.filter((d) => d.sender === x),
      }))));
    }
    if (req.method === "GET" && path === "/api/samples") return json(200, (await getJson<Sample[]>("samples/index.json")) ?? []);
    // A sample is opened as a copy, so the original is never approved or edited; no model call.
    if (req.method === "POST" && (m = path.match(/^\/api\/samples\/([\w-]+)\/open$/))) {
      const src = await getJson<Saved>(`samples/${m[1]}.json`);
      const pdf = await files.get(`samples/${m[1]}.pdf`);
      if (!src || !pdf) throw fail(404, "not_found", `sample ${m[1]}`);
      const d: Saved = { ...src, id: newId(), approved: undefined, verify: undefined, auto: undefined };
      await files.put(`runs/${d.id}.pdf`, pdf);
      await intake(d);
      return json(200, view(d));
    }
    if (req.method === "GET" && (m = path.match(/^\/api\/documents\/([\w-]+)\/file$/))) {
      const pdf = await files.get(`runs/${m[1]}.pdf`);
      if (!pdf) throw fail(404, "not_found", `document ${m[1]}`);
      return new Response(pdf.slice(), { headers: { "content-type": "application/pdf" } });
    }
    if (req.method === "GET" && (m = path.match(/^\/api\/documents\/([\w-]+)$/))) return json(200, view(await load(m[1]!)));
    if (req.method === "GET" && (m = path.match(/^\/api\/documents\/([\w-]+)\/export\.(csv|json)$/))) {
      const d = await load(m[1]!);
      if (!d.approved?.answer || !d.approved.approved_at) throw fail(409, "not_approved", "這份文件還沒核准，核准後才能匯出。");
      const x = d as Exportable;
      return m[2] === "csv"
        ? download(exportCsv(x), "text/csv", `${d.id}.csv`)
        : download(JSON.stringify(exportJson(x), null, 2), "application/json", `${d.id}.json`);
    }
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
      if (d.approved) return json(200, { corrected: d.approved.corrected, learn: d.approved.learn, approved_at: d.approved.approved_at, spent: spent() });
      const b = await bodyJson<{ sender: string; answer: Page[] }>();
      const sender = (b.sender ?? "").trim().toUpperCase();
      if (!sender) throw fail(400, "sender_required", "Name the sender before approving.");
      // The answer comes from the browser: validate it against the same schema the model output passed.
      const answer = b.answer.map((p) => schemas.compact.parse(p));
      const a = await approveDoc(d, sender, answer);
      // A sender on hold earns automatic approval back with a document a person approved without any correction.
      if (a.corrected === 0) await setHold(sender, false);
      await save(d);
      return json(200, { corrected: a.corrected, learn: a.learn, approved_at: a.approved_at, spent: spent() });
    }
    // "This one is wrong" on an approved document: back to review, its example leaves the sender's approved set, and
    // the sender is on hold, so its next documents go to a person until one passes review unchanged.
    if (req.method === "POST" && (m = path.match(/^\/api\/documents\/([\w-]+)\/reopen$/))) {
      const d = await load(m[1]!);
      if (!d.approved) return json(200, view(d));
      const prof = await getJson<{ versions: unknown[]; approved: { doc_id: string }[] }>("profiles.json");
      if (prof) await files.put("profiles.json", toJson({ ...prof, approved: prof.approved.filter((x) => x.doc_id !== d.id) }));
      await setHold(d.approved.sender, true);
      d.approved = undefined;
      d.auto = { ok: false, reasons: ["reopened"] };
      await save(d);
      return json(200, view(d));
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
