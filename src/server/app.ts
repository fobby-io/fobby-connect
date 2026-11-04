// The review API. src/server/local.ts serves it with Node; any other host serves it the same way.
// No Node built-ins here: files, the Meta client and sending email come in as deps.
import PostalMime from "postal-mime";
import { CreditExhausted, creditGuard } from "../gateway/credit.ts";
import { gateway } from "../gateway/gateway.ts";
import { memoryLedger } from "../gateway/ledger.ts";
import type { MetaClient } from "../gateway/meta-client.ts";
import { normalize } from "../normalize/normalize.ts";
import { matchSender, preparePages, readMissingColumn, replayReader, runDocument, type PageInput, type RunResult } from "../pipeline/run.ts";
import { diff, learn, memoryStore, seed, type Page, type Store } from "../profiles/loop.ts";
import { museRewrite } from "../profiles/rewrite.ts";
import { checkDocument } from "../rules/checks.ts";
import { HEADER_KEYS, LINE_FIELDS } from "../shared/fields.ts";
import { schemas } from "../shared/model-output.ts";
import { verifyDocument, type Decide, type Verification } from "../verify/jev.ts";
import { exportCsv, exportJson, type Exportable } from "./export.ts";
import { deliver, Graph, newSecret, recipients, targets, type Delivery, type Flow } from "./webhook.ts";

/** Keys: runs/<id>.pdf|json, space.json, <space>/index/<id>.json, <space>/holds/<sender>.json, profiles.json, flow.json, samples/index.json, samples/<id>.pdf|json; runs/index.json and senders.json are read from older data only. */
/** list gives every key that starts with prefix, in any order; delete of a missing key is not an error. */
export type Files = { get(key: string): Promise<Uint8Array | null>; put(key: string, bytes: Uint8Array): Promise<void>; list(prefix: string): Promise<string[]>; delete(key: string): Promise<void> };
/** One email the host sends for an email output of the flow. Throws when the host refuses or fails to send it. */
export type Mail = { to: string; subject: string; text: string; attachments: { filename: string; type: string; content: string }[] };
/**
 * decide is the second system (Jev); without it nothing is verified and every document goes to a person. mail sends the
 * flow's email outputs; without it they are not sent. intakeAddress is the address whose mail the host passes to
 * receiveEmail, shown on the flow screen.
 */
export type Deps = { files: Files; client: MetaClient; spent?: () => number; decide?: Decide; mail?: (m: Mail) => Promise<{ id?: string }>; intakeAddress?: string };
/** Why a document was not approved automatically; empty when it was. */
export type AutoReason = "unknown_sender" | "on_hold" | "not_checked" | "flagged" | "findings" | "layout_changed" | "reopened";
// approved.answer and approved_at are missing on documents approved before export existed.
export type Saved = {
  id: string; name: string; run: RunResult; pages: PageInput[]; created_at?: string; verify?: Verification;
  auto?: { ok: boolean; reasons: AutoReason[] }; deliveries?: Delivery[]; source?: { via: "email"; from: string; subject: string };
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
// Every attached PDF is a paid read: one email reads at most this many.
const MAX_ATTACHMENTS = 5;
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
  // The document list and sender holds are one small file per document and per sender, so two requests at once never
  // overwrite each other's entries. They live under the namespace named in space.json (s0 without one); a demo is reset
  // by writing a new name there. Requests never write it, so requests at once always agree on it.
  const space = async () => (await getJson<{ id: string }>("space.json"))?.id ?? "s0";
  const entries = async <T>(prefix: string) =>
    (await Promise.all((await files.list(prefix)).map((k) => getJson<T>(k)))).filter((x): x is Awaited<T> & {} => x != null);
  const docList = async () => {
    const own = await entries<ListedDoc>(`${await space()}/index/`);
    const ids = new Set(own.map((d) => d.id));
    // Documents listed before the per-document entries existed are still read from the old single list.
    const old = ((await getJson<ListedDoc[]>("runs/index.json")) ?? []).filter((d) => !ids.has(d.id));
    return [...own, ...old].sort((a, b) => b.created_at.localeCompare(a.created_at));
  };
  const save = async (d: Saved) => {
    await files.put(`runs/${d.id}.json`, toJson(d));
    await files.put(`${await space()}/index/${d.id}.json`, toJson(listed(d)));
  };
  // The prompt's examples hold rows of earlier approved documents, possibly another visitor's: send only which prompt it was.
  const view = (d: Saved) => ({ id: d.id, name: d.name, created_at: d.created_at ?? null, verify: d.verify ?? null, auto: d.auto ?? null, deliveries: d.deliveries ?? [], source: d.source ?? null, run: { ...d.run, prompt: d.run.prompt && { id: d.run.prompt.id, level: d.run.prompt.level, key: d.run.prompt.key, version: d.run.prompt.version } }, normalized: normalize(d.run.pages.map((p) => p.output)), approved: d.approved ? (({ answer: _, ...a }) => a)(d.approved) : null, spent: spent() });
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

  const senderState = async (): Promise<SenderState> => {
    const own = await entries<{ sender: string; hold: boolean }>(`${await space()}/holds/`);
    return { ...((await getJson<SenderState>("senders.json")) ?? {}), ...Object.fromEntries(own.map((h) => [h.sender, { hold: h.hold }])) };
  };
  const setHold = async (sender: string, hold: boolean) => {
    if (!!(await senderState())[sender]?.hold === hold) return;
    await files.put(`${await space()}/holds/${encodeURIComponent(sender)}.json`, toJson({ sender, hold }));
  };
  const layoutKey = (pages: Page[]) => [...new Set(pages.flatMap((p) => p.columns.map((c) => `${c.field}=${c.label.replace(/\s+/g, " ").trim().toUpperCase()}`)))].sort().join("|");

  // Approving saves the answer as this sender's newest example and learns from any correction (the slow part).
  async function approveDoc(d: Saved, sender: string, answer: Page[]) {
    const model = d.run.pages.map((p) => p.output);
    const corrected = diff(model, answer).length;
    const result = await withStore((s) => learn(s, {
      doc_id: d.id, sender, cls: d.run.cls ?? "PL", pages: d.pages.map((p) => p.content), answer, model,
    }, replayReader(g, s), museRewrite(client)));
    d.approved = { sender, learn: result, corrected, answer, approved_at: new Date().toISOString() };
    return d.approved;
  }

  // The flow's signing secret is made on first use and kept with the flow.
  const getFlow = async (): Promise<Flow> => {
    const f = await getJson<Flow>("flow.json");
    if (f?.secret) return f;
    const made = { graph: f?.graph ?? null, secret: newSecret() };
    await files.put("flow.json", toJson(made));
    return made;
  };
  // One email with the record attached as JSON and CSV. Not retried: the host's mail service queues and retries itself.
  async function mailTo(d: Saved, to: string, event: string): Promise<Delivery> {
    const x = d as Exportable, t0 = Date.now();
    const base = { id: `dlv_${crypto.randomUUID().slice(0, 12)}`, event, name: "Email", url: `mailto:${to}`, at: new Date().toISOString(), status: null, attempt: 1, next_at: null };
    const what = event === "document.corrected" ? "corrected / 已更正" : "approved / 已確認";
    try {
      const r = await deps.mail!({
        to, subject: `${d.name}: ${what}`,
        text: [`${d.name} (${d.approved!.sender}) ${what}, ${d.approved!.approved_at}.`, "The full record is attached as JSON and CSV. 完整資料在附件的 JSON 和 CSV。", "", "Fobby Connect"].join("\n"),
        attachments: [
          { filename: `${d.id}.json`, type: "application/json", content: JSON.stringify(exportJson(x), null, 2) },
          { filename: `${d.id}.csv`, type: "text/csv", content: exportCsv(x) },
        ],
      });
      return { ...base, ok: true, receipt: r.id ?? null, ms: Date.now() - t0 };
    } catch (e) {
      return { ...base, ok: false, receipt: null, ms: Date.now() - t0, error: (e as Error).message.slice(0, 300) };
    }
  }
  // An approved document goes to every webhook and email of its sender's branch; a document sent before and approved again is a correction.
  async function send(d: Saved, flow: Flow) {
    const event = d.deliveries?.length ? "document.corrected" : "document.approved";
    const sender = d.approved!.sender;
    const out = await Promise.all([
      ...targets(flow.graph, sender).map((t) => deliver(t, event, exportJson(d as Exportable), flow.secret)),
      ...(deps.mail ? recipients(flow.graph, sender).map((to) => mailTo(d, to, event)) : []),
    ]);
    d.deliveries = [...out, ...(d.deliveries ?? [])].slice(0, 20);
    await queue(d.id, out);
    return out;
  }
  // A failed delivery waits in <space>/retries/ until its next_at; retry() picks it up.
  type Pending = { doc_id: string; delivery: string; due: string };
  const queue = async (docId: string, ds: Delivery[]) => {
    const dir = `${await space()}/retries/`;
    for (const x of ds) {
      if (x.next_at) await files.put(`${dir}${x.id}.json`, toJson({ doc_id: docId, delivery: x.id, due: x.next_at } satisfies Pending));
      else await files.delete(`${dir}${x.id}.json`);
    }
  };

  /** Tries again every failed delivery that is due. The host calls this on a timer, about once a minute. */
  async function retry(now = new Date()) {
    const due = (await entries<Pending>(`${await space()}/retries/`)).filter((p) => p.due <= now.toISOString());
    const flow = await getFlow();
    let sent = 0;
    for (const p of due) {
      const d = await load(p.doc_id).catch(() => null);
      const prev = d?.deliveries?.find((x) => x.id === p.delivery);
      // A document reopened since, or a delivery no longer on it, is not sent again.
      if (!d?.approved?.answer || !prev) { await files.delete(`${await space()}/retries/${p.delivery}.json`); continue; }
      const next = await deliver({ name: prev.name, url: prev.url }, prev.event, exportJson(d as Exportable), flow.secret, prev);
      d.deliveries = d.deliveries!.map((x) => (x.id === next.id ? next : x));
      await save(d);
      await queue(d.id, [next]);
      sent++;
    }
    return { due: due.length, sent };
  }
  const autoSend = async (d: Saved) => { const f = await getFlow(); if (f.graph?.autoSend) await send(d, f); };

  /**
   * After the first read. A sender's first document of a kind goes to a person, who checks every value anyway, so the
   * second system is not paid for. A known sender's document is checked value by value, and approved without a person
   * only when the sender is not on hold, every value is verified, every rule passes and the columns are the ones this
   * sender's last approved document had. Anything else goes to review, with the reasons.
   */
  async function intake(d: Saved) {
    d.created_at = new Date().toISOString();
    const outputs = d.run.pages.map((p) => p.output);
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
      if (deps.decide) d.verify = await verifyDocument(deps.decide, d.pages, outputs);
      if (!d.verify || d.verify.unchecked_pages > 0) reasons.push("not_checked");
      else if (d.verify.flagged > 0) reasons.push("flagged");
    }
    // Rules run again here so samples read before a rule existed are held to it too.
    d.run.findings = checkDocument(outputs);
    if (d.run.findings.length) reasons.push("findings");
    d.auto = { ok: reasons.length === 0, reasons };
    if (d.auto.ok) { await approveDoc(d, sender!, outputs); await autoSend(d); }
    await save(d);
  }

  // A new PDF, uploaded or attached to an email: kept, read page by page, then through intake.
  async function ingest(bytes: Uint8Array, name: string, sender: string | null, source?: Saved["source"]) {
    const id = newId();
    await files.put(`runs/${id}.pdf`, bytes);
    const pages = await preparePages(bytes);
    // Every page is a paid read and anyone can upload: one document is at most what the billing unit covers twice.
    if (pages.length > MAX_PAGES) throw fail(400, "too_many_pages", `這份文件有 ${pages.length} 頁，示範版一次最多讀 ${MAX_PAGES} 頁。`);
    const run = await withStore((s) => runDocument(g, s, pages, { doc_id: id, sender }));
    const d: Saved = { id, name: name || id, run, pages, ...(source && { source }) };
    await intake(d);
    return d;
  }

  /**
   * An email sent to the intake address. Each attached PDF (at most MAX_ATTACHMENTS) is read like an upload, one at a
   * time; one that fails is listed with its error and the rest still go in. from is the envelope sender the host
   * received the mail from, not the From header, which the sender can write as anything.
   */
  async function receiveEmail(raw: Uint8Array | ArrayBuffer, from: string) {
    const mail = await PostalMime.parse(raw);
    const subject = (mail.subject ?? "").slice(0, 200);
    const pdfs = mail.attachments.filter((a) => a.mimeType === "application/pdf" || /\.pdf$/i.test(a.filename ?? "")).slice(0, MAX_ATTACHMENTS);
    const documents: { name: string; id?: string; error?: string }[] = [];
    for (const [i, a] of pdfs.entries()) {
      const name = (a.filename ?? `${subject || "email"} ${i + 1}.pdf`).slice(0, 200);
      try {
        const bytes = new Uint8Array(a.content as ArrayBuffer);
        if (bytes.length > MAX_UPLOAD) throw fail(413, "too_large", "file over 25 MB");
        if (dec.decode(bytes.subarray(0, 5)) !== "%PDF-") throw fail(400, "not_pdf", "not a PDF");
        documents.push({ name, id: (await ingest(bytes, name, null, { via: "email", from, subject })).id });
      } catch (e) {
        documents.push({ name, error: (e as Error).message });
      }
    }
    return { from, subject, documents };
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
      const d = await ingest(bytes, url.searchParams.get("name") ?? "", url.searchParams.get("sender") || null);
      return json(200, view(d));
    }
    if (req.method === "GET" && path === "/api/documents") return json(200, await docList());
    if (req.method === "GET" && path === "/api/profiles") {
      return withStore(async (s) => json(200, s.senders().map((x) => ({ sender: x, versions: ["PL", "SO"].flatMap((c) => s.versions("sender", `${x}/${c}`)) }))));
    }
    // One entry per sender: its readings (prompt versions, examples left out), whether it is on hold, and its documents.
    if (req.method === "GET" && path === "/api/senders") {
      const docs = await docList();
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
      const d: Saved = { ...src, id: newId(), approved: undefined, verify: undefined, auto: undefined, deliveries: undefined };
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
      await autoSend(d);
      await save(d);
      return json(200, { corrected: a.corrected, learn: a.learn, approved_at: a.approved_at, spent: spent() });
    }
    // Send an approved document to its sender's webhooks now, whether or not the flow sends automatically.
    if (req.method === "POST" && (m = path.match(/^\/api\/documents\/([\w-]+)\/send$/))) {
      const d = await load(m[1]!);
      if (!d.approved?.answer || !d.approved.approved_at) throw fail(409, "not_approved", "這份文件還沒核准，核准後才能送出。");
      const sent = await send(d, await getFlow());
      if (!sent.length) throw fail(409, "no_webhook", "這家在出口流程裡沒有設定網址的 Webhook。");
      await save(d);
      return json(200, { deliveries: d.deliveries });
    }
    if (req.method === "GET" && path === "/api/flow") return json(200, { ...(await getFlow()), mail: !!deps.mail, intake: deps.intakeAddress ?? null });
    if (req.method === "PUT" && path === "/api/flow") {
      const parsed = Graph.safeParse((await bodyJson<{ graph: unknown }>()).graph);
      if (!parsed.success) throw fail(400, "bad_flow", "出口流程格式不對。");
      const f = await getFlow();
      await files.put("flow.json", toJson({ ...f, graph: parsed.data }));
      return json(200, { ok: true });
    }
    // A test event to one URL from the flow screen, so a receiver can be set up before any document is approved.
    if (req.method === "POST" && path === "/api/flow/test") {
      const b = await bodyJson<{ name?: string; url?: string }>();
      const f = await getFlow();
      // A test event is never queued for retry.
      const d = await deliver({ name: String(b.name ?? "Webhook").slice(0, 100), url: String(b.url ?? "") }, "test", { message: "Test delivery from Fobby Connect" }, f.secret);
      return json(200, { ...d, next_at: null });
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
    retry, receiveEmail,
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
