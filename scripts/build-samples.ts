// Builds the synthetic sample PDFs the README links (invented companies and numbers). No model call.
// Run: npx tsx scripts/build-samples.ts   (writes eval/samples/)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cjkSo } from "../eval/synth/layouts/cjk-so.ts";
import { erpPl } from "../eval/synth/layouts/erp-pl.ts";

const OUT = "eval/samples";
// pl-1 and pl-2 share a sender: the first is reviewed, the second is checked and approved automatically.
const SAMPLES = [
  { id: "pl-1", make: () => erpPl(101) },
  { id: "pl-2", make: () => erpPl(102, { rows: 12, shipper: 101 }) },
  { id: "so-1", make: () => cjkSo(201) },
];

mkdirSync(OUT, { recursive: true });
for (const s of SAMPLES) {
  const { pdf } = await s.make();
  writeFileSync(join(OUT, `${s.id}.pdf`), pdf);
  console.log(`${s.id}.pdf`);
}
