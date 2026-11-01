// Survey a folder of real documents for header classes: title, text layer, page-1 column labels.
// Real documents stay outside the repository; the report goes to eval/out (gitignored).
// Run: npx tsx scripts/survey-headers.ts <dir>
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readPdf } from "../src/pipeline/pdf.ts";
import { gridItems } from "../src/pipeline/text-serialize.ts";

const dir = process.argv[2];
if (!dir) throw new Error("usage: survey-headers.ts <dir>");

const TITLES: [RegExp, string][] = [
  [/PACKING\s*LIST|裝箱單|包裝明細/i, "PL"],
  [/SHIPPING\s*ORDER|託運單|S\/O\b|BOOKING/i, "SO"],
  [/COMMERCIAL\s*INVOICE|\bINVOICE\b|發票/i, "INV"],
];
const LABELS = /^(C\/?NO|CTN|CTNS|CARTON|PLT|PALLET|P\/?NO|PO|P\.O\.|QTY|QUANTITY|N\.?W|G\.?W|NET|GROSS|CBM|MEAS|DESCRIPTION|MARKS|ITEM|PART|LOT|@|PCS)/i;

const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
const rows = [];
for (const f of files) {
  try {
    const pages = await readPdf(new Uint8Array(readFileSync(join(dir, f))));
    const items = gridItems(pages[0]!);
    const top = items.filter((i) => i.box[1] < 300).map((i) => i.text).join(" ");
    const titles = TITLES.filter(([re]) => re.test(top)).map(([, t]) => t);
    const labels = [...new Set(items.map((i) => i.text.trim().toUpperCase()).filter((t) => t.length < 20 && LABELS.test(t)))].slice(0, 12);
    const cjk = /[一-鿿]/.test(items.map((i) => i.text).join(""));
    rows.push({ file: f, pages: pages.length, text_items_p1: items.length, titles: titles.join("+") || "-", cjk, labels: labels.join(" | ") });
  } catch (e) {
    rows.push({ file: f, pages: 0, text_items_p1: 0, titles: `ERROR ${(e as Error).message.slice(0, 60)}`, cjk: false, labels: "" });
  }
}
mkdirSync("eval/out", { recursive: true });
writeFileSync("eval/out/header-survey.json", JSON.stringify(rows, null, 2));
console.table(rows.map(({ labels, ...r }) => r));
