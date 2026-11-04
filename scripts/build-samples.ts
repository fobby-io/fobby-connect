// Builds the sample shipments a visitor can open for free: synthetic documents (invented companies and numbers),
// read once with an empty profile store so nothing learned from real documents ends up in a sample.
// Run: npx tsx scripts/build-samples.ts   (writes eval/samples/; costs one read per page, then cached)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cachedClient } from "../eval/cache.ts";
import { cjkSo } from "../eval/synth/layouts/cjk-so.ts";
import { erpPl } from "../eval/synth/layouts/erp-pl.ts";
import { gateway } from "../src/gateway/gateway.ts";
import { memoryLedger } from "../src/gateway/ledger.ts";
import { metaClient } from "../src/gateway/meta-client.ts";
import { preparePages, runDocument } from "../src/pipeline/run.ts";
import { memoryStore, seed } from "../src/profiles/loop.ts";
import type { Sample, Saved } from "../src/server/app.ts";

const OUT = "eval/samples";
// pl-1 and pl-2 share a sender: the first is reviewed, the second is checked and approved automatically.
const SAMPLES = [
  { id: "pl-1", name: "Packing list 1 (2 pages)", make: () => erpPl(101) },
  { id: "pl-2", name: "Packing list 2, same sender", make: () => erpPl(102, { rows: 12, shipper: 101 }) },
  { id: "so-1", name: "Shipping order (中文)", make: () => cjkSo(201) },
];

process.loadEnvFile(".dev.vars");
const { client, spent } = cachedClient(metaClient(process.env.META_API_KEY!), 2);
const g = gateway(client, memoryLedger());
mkdirSync(OUT, { recursive: true });
const index: Sample[] = [];
for (const s of SAMPLES) {
  const { pdf, expected } = await s.make();
  const pages = await preparePages(pdf);
  const run = await runDocument(g, seed(memoryStore()), pages, { doc_id: `sample-${s.id}` });
  const saved: Saved = { id: s.id, name: s.name, run, pages };
  writeFileSync(join(OUT, `${s.id}.pdf`), pdf);
  writeFileSync(join(OUT, `${s.id}.json`), JSON.stringify(saved));
  index.push({ id: s.id, name: s.name, sender: expected.header.shipper ?? run.issuer?.split("\n")[0] ?? "" });
  console.log(`${s.id}: ${pages.length} pages, ${run.findings.length} findings, US$${run.cost_usd.toFixed(3)}`);
}
writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 2));
console.log(`live spend US$${spent().toFixed(3)}`);
