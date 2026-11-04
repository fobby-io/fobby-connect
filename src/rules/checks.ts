import Decimal from "decimal.js";
import type { ModelOutput } from "../shared/model-output.ts";
import { parseNumber } from "../transforms/steps/parse-number.ts";
import { isValidContainerNo } from "./containers.ts";
import { marksPos, normalize, samePo } from "../normalize/normalize.ts";
import { norm } from "../pipeline/grounding.ts";

// Step 5 of the reading loop: code checks, no model cost. A finding names the page so step 6 can re-read only that page.

export type Finding = { page: number; path: string; message: string };
type Page = ModelOutput<"compact">;

// A cell stacked as "@per-package" over "row total" holds its row total on the last line.
const rowValue = (cell: string | null | undefined) => {
  const lines = (cell ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("@"));
  return lines.length ? parseNumber(lines.at(-1)!) : null;
};

// The printed text while it still says the value; a converted or corrected value in kg.
const asRead = (x: { v: string | null; raw: string | null }) => (x.raw && rowValue(x.raw) === x.v ? x.raw : `${x.v} kg`);

const SUMS =[["pkg_qty", "total_pkgs"], ["qty", "total_qty"], ["gw_kg", "total_gw_kg"], ["nw_kg", "total_nw_kg"], ["cbm", "total_cbm"]] as const;

/** Row sums against the printed totals line, across all pages; container numbers by ISO 6346 check digit. */
/** n is the normalized document the checks hold to: the read as is, or with a person's corrections applied. */
export function checkDocument(pages: Page[], n = normalize(pages)): Finding[] {
  const out: Finding[] = [];
  for (const [field, total] of SUMS) {
    // Sums use the values as the table shows them (kg after unit conversion, corrections applied), never a cell's raw text.
    const want = n.totals[total]?.v;
    if (!want) continue;
    const printedAt = pages.findLastIndex((p) => p.totals[total]?.v);
    const raw = n.totals[total]!.raw;
    const shown = raw && parseNumber(raw) === want ? raw : `${want}${field.endsWith("_kg") ? " kg" : ""}`;
    const key = field === "pkg_qty" ? "pkgs" : field;
    let sum = new Decimal(0), seen = false;
    const pagesWithRows: number[] = [];
    for (const r of n.rows) {
      const v = (r as unknown as Record<string, { v: string | null }>)[key]!.v;
      if (!v || !pages[r.page - 1]?.columns.some((c) => c.field === field)) continue;
      sum = sum.plus(v); seen = true; if (!pagesWithRows.includes(r.page - 1)) pagesWithRows.push(r.page - 1);
    }
    // Weights and volumes are printed rounded per row; allow 0.5% before calling it a mismatch.
    const tol = field === "pkg_qty" || field === "qty" ? new Decimal(0) : new Decimal(want).abs().mul(0.005);
    if (seen && sum.minus(want).abs().gt(tol)) {
      for (const i of new Set([...(printedAt < 0 ? [] : [printedAt]), ...pagesWithRows]))
        out.push({ page: i + 1, path: `totals.${total}`, message: `rows add up to ${sum.toString()} ${field}, the totals line says ${shown}` });
    }
  }
  // Every page repeats the same header; a value that differs between pages was misread on one of them.
  const perPage = pages.map((p) => normalize([p]).header);
  for (const k of ["doc_no", "pol", "pod", "etd", "vessel", "voyage"]) {
    const seen = perPage.map((h, i) => ({ i, val: h[k]?.v ? norm(h[k]!.v!) : null })).filter((x) => x.val);
    const first = seen[0];
    for (const s of seen.slice(1)) if (s.val !== first!.val)
      out.push({ page: s.i + 1, path: `header.${k}`, message: `${k} differs between pages: page ${first!.i + 1} has ${first!.val}, page ${s.i + 1} has ${s.val}` });
  }

  const pallets = n.rows.reduce((a, r) => a + Number(r.pallets.v ?? 0), 0);
  const totalPlt = n.totals.total_pallets?.v;
  if (totalPlt && pallets && pallets !== Number(totalPlt)) {
    const pg = pages.findLastIndex((p) => p.totals.total_pallets?.v || p.totals.total_pkgs?.v) + 1;
    out.push({ page: pg, path: "totals.total_pallets", message: `rows add up to ${pallets} pallets, the totals line says ${totalPlt}` });
  }
  const marks = marksPos(n.header.shipping_marks?.v ?? null);
  if (marks.length) {
    const rowPos = [...new Set(n.rows.map((r) => r.po.v).filter((x): x is string => !!x))];
    const mp = n.header.shipping_marks!.page ?? 1;
    const missing = marks.filter((m) => !rowPos.some((r) => samePo(r, m)));
    const extra = rowPos.filter((r) => !marks.some((m) => samePo(r, m)));
    if (missing.length) out.push({ page: mp, path: "header.shipping_marks", message: `PO in the shipping marks but in no row: ${missing.join(", ")}` });
    if (extra.length) out.push({ page: mp, path: "header.shipping_marks", message: `PO in the rows but not in the shipping marks: ${extra.join(", ")}` });
  }

  // Both weights can be read and still sit in each other's column; gross under net means they are swapped or misread.
  for (const r of n.rows) {
    if (r.nw_kg.v && r.gw_kg.v && new Decimal(r.gw_kg.v).lt(r.nw_kg.v))
      out.push({ page: r.page, path: `rows[${r.row}].gw_kg`, message: `row ${r.row + 1} gross weight ${asRead(r.gw_kg)} is less than its net weight ${asRead(r.nw_kg)}` });
  }

  pages.forEach((p, i) => {
    p.containers.forEach((c, j) => {
      // Many layouts print "CNTR / SEAL" in one cell: the number is the part shaped like one.
      const no = c.number?.v?.match(/[A-Z]{3}[UJZ][\s-]?\d{6}[\s-]?\d/i)?.[0] ?? c.number?.v;
      if (no && !isValidContainerNo(no))
        out.push({ page: i + 1, path: `header.containers[${j}].number`, message: `container number ${no} fails the ISO 6346 check digit` });
    });
  });
  return out;
}
