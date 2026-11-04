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

const SUMS = [["pkg_qty", "total_pkgs"], ["qty", "total_qty"], ["gw_kg", "total_gw_kg"], ["nw_kg", "total_nw_kg"], ["cbm", "total_cbm"]] as const;

/** Row sums against the printed totals line, across all pages; container numbers by ISO 6346 check digit. */
export function checkDocument(pages: Page[]): Finding[] {
  const out: Finding[] = [];
  for (const [field, total] of SUMS) {
    const printed = pages.map((p, i) => ({ i, v: p.totals[total]?.v })).find((t) => t.v);
    if (!printed) continue;
    const want = parseNumber(printed.v!);
    if (want === null) continue;
    let sum = new Decimal(0), seen = false;
    const pagesWithRows: number[] = [];
    pages.forEach((p, i) => {
      const c = p.columns.findIndex((col) => col.field === field);
      if (c < 0) return;
      for (const r of p.rows) {
        if (r.t !== "item" && r.t !== "ditto") continue;
        const v = rowValue(r.cells[c]);
        if (v !== null) { sum = sum.plus(v); seen = true; if (!pagesWithRows.includes(i)) pagesWithRows.push(i); }
      }
    });
    // Weights and volumes are printed rounded per row; allow 0.5% before calling it a mismatch.
    const tol = field === "pkg_qty" || field === "qty" ? new Decimal(0) : new Decimal(want).abs().mul(0.005);
    if (seen && sum.minus(want).abs().gt(tol)) {
      for (const i of new Set([printed.i, ...pagesWithRows]))
        out.push({ page: i + 1, path: `totals.${total}`, message: `rows add up to ${sum.toString()} ${field}, the totals line says ${printed.v}` });
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

  const n = normalize(pages);
  const pallets = n.rows.reduce((a, r) => a + Number(r.pallets.v ?? 0), 0);
  const totalPlt = n.totals.total_pallets?.v;
  if (totalPlt && pallets && pallets !== Number(totalPlt)) {
    const pg = pages.findLastIndex((p) => p.totals.total_pallets?.v || p.totals.total_pkgs?.v) + 1;
    out.push({ page: pg, path: "totals.total_pallets", message: `rows add up to ${pallets} pallets, the totals line says ${totalPlt}` });
  }
  const marks = marksPos(n.header.shipping_marks?.raw ?? null);
  if (marks.length) {
    const rowPos = [...new Set(n.rows.map((r) => r.po.v).filter((x): x is string => !!x))];
    const mp = n.header.shipping_marks!.page ?? 1;
    const missing = marks.filter((m) => !rowPos.some((r) => samePo(r, m)));
    const extra = rowPos.filter((r) => !marks.some((m) => samePo(r, m)));
    if (missing.length) out.push({ page: mp, path: "header.shipping_marks", message: `PO in the shipping marks but in no row: ${missing.join(", ")}` });
    if (extra.length) out.push({ page: mp, path: "header.shipping_marks", message: `PO in the rows but not in the shipping marks: ${extra.join(", ")}` });
  }

  // Both weights can be read and still sit in each other's column; gross under net means they are swapped or misread.
  pages.forEach((p, i) => {
    const nw = p.columns.findIndex((c) => c.field === "nw_kg"), gw = p.columns.findIndex((c) => c.field === "gw_kg");
    if (nw < 0 || gw < 0) return;
    p.rows.forEach((r, ri) => {
      if (r.t !== "item" && r.t !== "ditto") return;
      const n = rowValue(r.cells[nw]), g = rowValue(r.cells[gw]);
      if (n !== null && g !== null && new Decimal(g).lt(n))
        out.push({ page: i + 1, path: `rows[${ri}].gw_kg`, message: `row ${ri + 1} gross weight ${r.cells[gw]} is less than its net weight ${r.cells[nw]}` });
    });
  });

  pages.forEach((p, i) => {
    p.containers.forEach((c, j) => {
      if (c.number?.v && !isValidContainerNo(c.number.v))
        out.push({ page: i + 1, path: `header.containers[${j}].number`, message: `container number ${c.number.v} fails the ISO 6346 check digit` });
    });
  });
  return out;
}
