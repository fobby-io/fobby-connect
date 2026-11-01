import Decimal from "decimal.js";
import type { ModelOutput } from "../shared/model-output.ts";
import { parseNumber } from "../transforms/steps/parse-number.ts";
import { isValidContainerNo } from "./containers.ts";

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
  pages.forEach((p, i) => {
    p.containers.forEach((c, j) => {
      if (c.number?.v && !isValidContainerNo(c.number.v))
        out.push({ page: i + 1, path: `header.containers[${j}].number`, message: `container number ${c.number.v} fails the ISO 6346 check digit` });
    });
  });
  return out;
}
