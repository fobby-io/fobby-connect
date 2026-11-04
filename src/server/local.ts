// Local review server: the review API from app.ts on Node, with files under data/ and the disk cache in front of Meta.
// Run: npx tsx src/server/local.ts   (http://localhost:8787)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { cachedClient } from "../../eval/cache.ts";
import { metaClient } from "../gateway/meta-client.ts";
import { createApp, type Files } from "./app.ts";

const DATA = process.env.DATA_DIR ?? "data";
const SAMPLES = "eval/samples";
process.loadEnvFile(".dev.vars");
const { client, spent } = cachedClient(metaClient(process.env.META_API_KEY!), Number(process.env.MAX_SPEND ?? 5));
const DIST = new URL("../../web/dist/", import.meta.url);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".map": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".wasm": "application/wasm",
};

// samples/ are the committed synthetic samples; everything else is this machine's data.
const fileOf = (key: string) => key.startsWith("samples/") ? join(SAMPLES, key.slice(8)) : join(DATA, key);
const files: Files = {
  get: async (key) => existsSync(fileOf(key)) ? new Uint8Array(readFileSync(fileOf(key))) : null,
  put: async (key, bytes) => { mkdirSync(dirname(fileOf(key)), { recursive: true }); writeFileSync(fileOf(key), bytes); },
};
const app = createApp({ files, client, spent });

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
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
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
