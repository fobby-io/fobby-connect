// Local review server: the review API from app.ts on Node, with files under data/ and the disk cache in front of Meta.
// Run: npx tsx src/server/local.ts   (http://localhost:8787)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { renderPageAsImage } from "unpdf";
import { cachedClient } from "../../eval/cache.ts";
import { metaClient } from "../gateway/meta-client.ts";
import { createApp, type Files } from "./app.ts";

const DATA = process.env.DATA_DIR ?? "data";
const SAMPLES = "eval/samples";
process.loadEnvFile(".dev.vars");
const { client, spent } = cachedClient(metaClient(process.env.META_API_KEY!), Number(process.env.MAX_SPEND ?? 5));
const WEB = new URL("../../web/", import.meta.url);

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
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(readFileSync(new URL("index.html", WEB)));
    }
    // shortcut: page images rendered on the server need a native canvas, so only the local host has them; react-ui UI-1.3 removes this.
    const png = url.pathname.match(/^\/api\/documents\/([\w-]+)\/pages\/(\d+)\.png$/);
    if (req.method === "GET" && png) {
      const out = join(DATA, "runs", `${png[1]}-p${png[2]}.png`);
      if (!existsSync(out)) {
        const img = await renderPageAsImage(new Uint8Array(readFileSync(join(DATA, "runs", `${png[1]}.pdf`))), Number(png[2]), { canvasImport: () => import("@napi-rs/canvas"), scale: 1.5 });
        writeFileSync(out, Buffer.from(img));
      }
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(readFileSync(out));
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
