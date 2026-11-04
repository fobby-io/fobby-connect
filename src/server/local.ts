// Local review server: the review API from app.ts on Node, with files under data/ and the disk cache in front of Meta.
// Run: npx tsx src/server/local.ts   (http://localhost:8787)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { cachedClient } from "../../eval/cache.ts";
import { metaClient } from "../gateway/meta-client.ts";
import { jevClient } from "../verify/jev.ts";
import { createApp, type Files } from "./app.ts";
import { pgliteDb, urlDb } from "./pg-node.ts";

const DATA = process.env.DATA_DIR ?? "data";
process.loadEnvFile(".dev.vars");
const { client, spent } = cachedClient(metaClient(process.env.META_API_KEY!), Number(process.env.MAX_SPEND ?? 5));
const DIST = new URL("../../web/dist/", import.meta.url);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".map": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".wasm": "application/wasm",
};

const fileOf = (key: string) => join(DATA, key);
const files: Files = {
  get: async (key) => existsSync(fileOf(key)) ? new Uint8Array(readFileSync(fileOf(key))) : null,
  put: async (key, bytes) => { mkdirSync(dirname(fileOf(key)), { recursive: true }); writeFileSync(fileOf(key), bytes); },
  // Prefixes here are directories ("<space>/index/"), so one level is enough.
  list: async (prefix) => existsSync(fileOf(prefix)) ? readdirSync(fileOf(prefix)).map((n) => prefix + n) : [],
  delete: async (key) => rmSync(fileOf(key), { force: true }),
};
const decide = process.env.OPENROUTER_API_KEY ? jevClient(process.env.OPENROUTER_API_KEY) : undefined;
if (!decide) console.warn("OPENROUTER_API_KEY is not set: nothing is verified, every document goes to review");
// DATABASE_URL (a direct Postgres URL, e.g. a Neon dev branch) when set; else PGlite kept under DATA_DIR.
const db = process.env.DATABASE_URL ? await urlDb(process.env.DATABASE_URL) : await pgliteDb(join(DATA, "pg"));
const app = createApp({ files, db, client, spent, decide });
// Failed webhook deliveries are tried again when due.
setInterval(() => void app.retry().catch((e) => console.warn("webhook retry:", (e as Error).message)), 60_000).unref();

const port = Number(process.env.PORT ?? 8787);
createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    // The built React screen (npm run build:web); everything outside /api is a file under web/dist/.
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
      const file = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const path = fileURLToPath(new URL(file, DIST));
      if (!path.startsWith(fileURLToPath(DIST)) || !existsSync(path) || !statSync(path).isFile()) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        return res.end(existsSync(fileURLToPath(new URL("index.html", DIST))) ? "not found" : "web/dist/ is missing: run npm run build:web");
      }
      // index.html names the hashed bundle, so it is checked every time; otherwise a rebuild is not seen until a hard reload.
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream", ...(path.endsWith(".html") ? { "cache-control": "no-cache" } : {}) });
      return res.end(readFileSync(path));
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const r = await app.fetch(new Request(url, {
      method: req.method, headers: req.headers as Record<string, string>,
      ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream, duplex: "half" } : {}),
    } as RequestInit));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "failed", message: (e as Error).message } }));
  }
}).listen(port, () => console.log(`review server on http://localhost:${port}`));
