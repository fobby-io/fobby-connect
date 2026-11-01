// Runs one document through the reading loop (steps 1-6) with the local profile store.
// Run: npx tsx scripts/run-doc.ts <pdf> [--sender NAME] [--store data/profiles.json]
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { cachedClient } from "../eval/cache.ts";
import { gateway } from "../src/gateway/gateway.ts";
import { memoryLedger } from "../src/gateway/ledger.ts";
import { metaClient } from "../src/gateway/meta-client.ts";
import { fileStore } from "../src/profiles/file-store.ts";
import { seed } from "../src/profiles/loop.ts";
import { preparePages, runDocument } from "../src/pipeline/run.ts";

const { values: a, positionals } = parseArgs({ allowPositionals: true, options: { sender: { type: "string" }, store: { type: "string", default: "data/profiles.json" } } });
process.loadEnvFile(".dev.vars");
const { client, spent } = cachedClient(metaClient(process.env.META_API_KEY!), 1);
const pages = await preparePages(new Uint8Array(readFileSync(positionals[0]!)));
const r = await runDocument(gateway(client, memoryLedger()), seed(fileStore(a.store!)), pages, { doc_id: basename(positionals[0]!), sender: a.sender ?? null });
console.log({ cls: r.cls, sender: r.sender, issuer: r.issuer?.split("\n")[0], prompt: r.prompt?.id ?? "none", routes: r.pages.map((p) => p.route), reread: r.pages.map((p) => p.reread) });
console.log("findings:", r.findings);
console.log(`rows: ${r.pages.map((p) => p.output.rows.length).join(", ")}; cost US$${r.cost_usd.toFixed(3)}, live spend US$${spent().toFixed(3)}`);
