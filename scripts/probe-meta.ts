// One-off live checks of Meta API behaviour the docs do not state (see docs/hackathon_context.md).
// Costs a few cents. Run: npx tsx scripts/probe-meta.ts
import { PDFDocument, StandardFonts } from "pdf-lib";
import { responseFormat } from "../src/shared/model-output.ts";

process.loadEnvFile(".dev.vars");
const KEY = process.env.META_API_KEY;
if (!KEY) throw new Error("META_API_KEY missing in .dev.vars");
const MODEL = process.env.META_MODEL ?? "muse-spark-1.3";
const EFFORT = process.env.META_EFFORT; // minimal | low | medium | high; unset = model default

const W = 612, H = 792;
type Placed = { text: string; x: number; y: number; size: number };
const placed: Placed[] = [
  { text: "PACKING LIST", x: 230, y: 740, size: 18 },
  { text: "No.: PL-2026-001", x: 72, y: 700, size: 10 },
  { text: "Date: 2026-10-30", x: 400, y: 700, size: 10 },
  { text: "DESCRIPTION", x: 72, y: 640, size: 10 },
  { text: "CTNS", x: 300, y: 640, size: 10 },
  { text: "G.W.(KGS)", x: 420, y: 640, size: 10 },
  ...[["HEX BOLT M8", "12", "1,234.50"], ["FLAT WASHER", "4", "88.00"], ["NUT M8", "6", "402.25"]].flatMap(
    ([d, c, g], i) => [
      { text: d!, x: 72, y: 615 - i * 20, size: 10 },
      { text: c!, x: 300, y: 615 - i * 20, size: 10 },
      { text: g!, x: 420, y: 615 - i * 20, size: 10 },
    ],
  ),
  { text: "TOTAL", x: 72, y: 540, size: 10 },
  { text: "22", x: 300, y: 540, size: 10 },
  { text: "1,724.75", x: 420, y: 540, size: 10 },
];

async function makePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const p of placed) page.drawText(p.text, { x: p.x, y: p.y, size: p.size, font });
  const boxes = placed.map((p) => {
    const w = font.widthOfTextAtSize(p.text, p.size);
    const g = (n: number, d: number) => Math.round((n / d) * 1000);
    return { text: p.text, box: [g(p.x, W), g(H - p.y - p.size, H), g(p.x + w, W), g(H - p.y, H)] };
  });
  return { b64: Buffer.from(await doc.save()).toString("base64"), boxes };
}

const INSTRUCTIONS =
  "You read one page of a freight document and return JSON in the given schema. " +
  "Copy every value exactly as printed. Boxes are [x0,y0,x1,y1] on a 0-1000 grid of the page, origin top left. " +
  "Use null for header and totals fields the page does not print. " +
  "Map line-item columns to these fields: description, pkg_qty, gw_kg. Totals go in totals.total_pkgs and totals.total_gw_kg.";

async function call(label: string, content: unknown[], strict = true) {
  const rf = responseFormat("compact");
  rf.json_schema.strict = strict;
  const t0 = Date.now();
  const res = await fetch("https://api.meta.ai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: INSTRUCTIONS }, { role: "user", content }],
      response_format: rf,
      // Reasoning is billed as output and cannot be turned off on Spark ("none" is a 400).
      ...(EFFORT ? { reasoning_effort: EFFORT } : {}),
    }),
  });
  const body = (await res.json()) as any;
  console.log(`\n== ${label}: HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!res.ok) return console.log(JSON.stringify(body).slice(0, 800)), null;
  console.log("usage", JSON.stringify(body.usage));
  try {
    return JSON.parse(body.choices[0].message.content);
  } catch {
    console.log("not JSON:", String(body.choices?.[0]?.message?.content).slice(0, 300));
    return null;
  }
}

const { b64, boxes } = await makePdf();
const textLines = boxes.map((b, i) => `${i} ${b.box.join(" ")}|${b.text}`).join("\n");

// 1. Text input: is the schema (anyOf with null, strict) accepted?
const t = await call("text input, strict schema", [{ type: "text", text: `textfmt.1\n${textLines}` }]);
if (t) console.log("doc_no", JSON.stringify(t.header.doc_no), "rows", t.rows.length, "totals.gw", JSON.stringify(t.totals.total_gw_kg));

// 2. PDF file part + json_schema in one request; compare boxes with known positions.
const pdfPart = { type: "file", file: { filename: "probe.pdf", file_data: `data:application/pdf;base64,${b64}` } };
const p = await call("pdf input, strict schema", [pdfPart, { type: "text", text: "Read this page." }]);
if (p) {
  const want = (s: string) => boxes.find((b) => b.text.includes(s))!.box;
  console.log("doc_no  model", JSON.stringify(p.header.doc_no?.box), "expected (whole line)", JSON.stringify(want("PL-2026")));
  console.log("row0    model", JSON.stringify(p.rows[0]?.box), "expected y", want("HEX BOLT")[1], "-", want("HEX BOLT")[3]);
  console.log("total   model", JSON.stringify(p.totals.total_gw_kg), "expected", JSON.stringify(want("1,724.75")));
  console.log("cells", JSON.stringify(p.rows.map((r: any) => r.cells)));
}

// 3. Same request again: does the cache report cached tokens?
await call("pdf input, repeat for cache", [pdfPart, { type: "text", text: "Read this page." }]);
