// Local review server for the hackathon demo: upload, read, review, approve, learn.
// shortcut: Node http with files under data/; the Workers api and Postgres replace it in M2-M5.
// Run: npx tsx src/server/local.ts   (http://localhost:8787)
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { renderPageAsImage } from "unpdf";
import { cachedClient } from "../../eval/cache.ts";
import { gateway } from "../gateway/gateway.ts";
import { memoryLedger } from "../gateway/ledger.ts";
import { metaClient } from "../gateway/meta-client.ts";
import { preparePages, replayReader, runDocument, type PageInput, type RunResult } from "../pipeline/run.ts";
import { fileStore } from "../profiles/file-store.ts";
import { diff, learn, seed, type Page } from "../profiles/loop.ts";
import { sparkRewrite } from "../profiles/rewrite.ts";
import { schemas } from "../shared/model-output.ts";

const DATA = process.env.DATA_DIR ?? "data";
const RUNS = join(DATA, "runs");
mkdirSync(RUNS, { recursive: true });
process.loadEnvFile(".dev.vars");
const { client, spent } = cachedClient(metaClient(process.env.META_API_KEY!), Number(process.env.MAX_SPEND ?? 5));
const g = gateway(client, memoryLedger());
const store = seed(fileStore(join(DATA, "profiles.json")));
const WEB = new URL("../../web/", import.meta.url);

type Saved = { id: string; name: string; run: RunResult; pages: PageInput[]; approved?: { sender: string; learn: unknown; corrected: number } };
const load = (id: string): Saved => JSON.parse(readFileSync(join(RUNS, `${id}.json`), "utf8"));
const save = (d: Saved) => writeFileSync(join(RUNS, `${d.id}.json`), JSON.stringify(d));

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 25 * 1024 * 1024) throw Object.assign(new Error("file over 25 MB"), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
const json = (res: ServerResponse, status: number, x: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(x)); };

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const m = url.pathname.match(/^\/api\/documents\/([\w-]+)(?:\/(pages)\/(\d+)\.png|\/(approve))?$/);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(readFileSync(new URL("index.html", WEB)));
  }
  if (req.method === "POST" && url.pathname === "/api/documents") {
    const bytes = new Uint8Array(await body(req));
    const id = randomUUID().slice(0, 8);
    writeFileSync(join(RUNS, `${id}.pdf`), bytes);
    const pages = await preparePages(bytes);
    const run = await runDocument(g, store, pages, { doc_id: id, sender: url.searchParams.get("sender") || null });
    const d: Saved = { id, name: url.searchParams.get("name") ?? id, run, pages };
    save(d);
    return json(res, 200, view(d));
  }
  if (req.method === "GET" && url.pathname === "/api/profiles") {
    return json(res, 200, store.senders().map((s) => ({ sender: s, versions: ["PL", "SO"].flatMap((c) => store.versions("sender", `${s}/${c}`)) })));
  }
  if (m && req.method === "GET" && m[2] === "pages") {
    const png = join(RUNS, `${m[1]}-p${m[3]}.png`);
    if (!existsSync(png)) {
      const img = await renderPageAsImage(new Uint8Array(readFileSync(join(RUNS, `${m[1]}.pdf`))), Number(m[3]), { canvasImport: () => import("@napi-rs/canvas"), scale: 1.5 });
      writeFileSync(png, Buffer.from(img));
    }
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(readFileSync(png));
  }
  if (m && req.method === "GET" && !m[2] && !m[4]) return json(res, 200, view(load(m[1]!)));
  if (m && req.method === "POST" && m[4]) {
    const d = load(m[1]!);
    if (d.approved) return json(res, 409, { error: { code: "already_approved", message: "This document was already approved." } });
    const b = JSON.parse((await body(req)).toString("utf8")) as { sender: string; answer: Page[] };
    const sender = b.sender.trim().toUpperCase();
    if (!sender) return json(res, 400, { error: { code: "sender_required", message: "Name the sender before approving." } });
    // The answer comes from the browser: validate it against the same schema the model output passed.
    const answer = b.answer.map((p) => schemas.compact.parse(p));
    const model = d.run.pages.map((p) => p.output);
    const corrected = diff(model, answer).length;
    const result = await learn(store, {
      doc_id: d.id, sender, cls: d.run.cls ?? "PL", pages: d.pages.map((p) => p.content), answer, model,
    }, replayReader(g, store), sparkRewrite(client));
    d.approved = { sender, learn: result, corrected };
    save(d);
    return json(res, 200, { corrected, learn: result, spent: spent() });
  }
  json(res, 404, { error: { code: "not_found", message: url.pathname } });
}

// The browser gets the run without the page bytes.
const view = (d: Saved) => ({ id: d.id, name: d.name, run: d.run, approved: d.approved ?? null, spent: spent() });

const port = Number(process.env.PORT ?? 8787);
createServer((req, res) => handle(req, res).catch((e) => json(res, (e as { status?: number }).status ?? 500, { error: { code: "failed", message: (e as Error).message } })))
  .listen(port, () => console.log(`review server on http://localhost:${port}`));
