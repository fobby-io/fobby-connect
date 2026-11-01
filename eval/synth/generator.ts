// pnpm synth [--count N] [--seed S] [--out DIR]: writes <doc_id>.pdf and <doc_id>.json per document.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { cjkSo } from "./layouts/cjk-so.ts";
import { erpPl } from "./layouts/erp-pl.ts";
import type { Expected } from "./types.ts";

export const LAYOUTS: Record<string, (seed: number) => Promise<{ pdf: Uint8Array; expected: Expected }>> = {
  "erp-pl": (s) => erpPl(s),
  // 73 rows put 42 on page 2: the dense-page pass criterion is a 40-row page.
  "erp-pl-dense": (s) => erpPl(s, { rows: 73, name: "erp-pl-dense" }),
  "cjk-so": cjkSo,
};

export async function generate(count: number, seed: number, out: string) {
  mkdirSync(out, { recursive: true });
  const docs: Expected[] = [];
  for (const [name, make] of Object.entries(LAYOUTS)) {
    for (let k = 0; k < count; k++) {
      const { pdf, expected } = await make(seed + k);
      writeFileSync(join(out, `${expected.doc_id}.pdf`), pdf);
      writeFileSync(join(out, `${expected.doc_id}.json`), JSON.stringify(expected, null, 2));
      docs.push(expected);
    }
    console.log(`${name}: ${count} documents`);
  }
  return docs;
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  const { values } = parseArgs({ options: { count: { type: "string", default: "10" }, seed: { type: "string", default: "1" }, out: { type: "string", default: "eval/out/synth" } } });
  const docs = await generate(Number(values.count), Number(values.seed), values.out!);
  const rows = docs.reduce((a, d) => a + d.rows.length, 0);
  const pages = docs.reduce((a, d) => a + d.pages.length, 0);
  console.log(`${docs.length} documents, ${pages} pages, ${rows} line items -> ${values.out}`);
}
