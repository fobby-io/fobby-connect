import { columnRanges, groundCell, groundHeader, groundIds, GROUNDING, norm, unionBox, type GroundState } from "../src/pipeline/grounding.ts";
import type { GridItem } from "../src/pipeline/text-serialize.ts";
import { lookupPort } from "../src/reference/unlocode.ts";
import { isKey, isProtected, type HeaderKey, type LineField, type TotalsKey } from "../src/shared/fields.ts";
import type { Box, ModelOutput } from "../src/shared/model-output.ts";
import { parseDate } from "../src/transforms/steps/date-parse.ts";
import { parseNumber } from "../src/transforms/steps/parse-number.ts";
import { splitParty } from "../src/transforms/steps/split.ts";
import { toBase, unitIn } from "../src/transforms/units.ts";
import type { Expected } from "./synth/types.ts";

export type FieldResult = {
  doc_id: string; page_no: number; path: string;
  expected: string | null; got: string | null; correct: boolean;
  key: boolean; protected: boolean; state: GroundState | null;
};

const NUMERIC = new Set(["pkg_qty", "qty", "qty_per_pkg", "nw_kg", "gw_kg", "nw_per_pkg_kg", "gw_per_pkg_kg", "cbm",
  "total_pkgs", "total_pallets", "total_qty", "total_gw_kg", "total_nw_kg", "total_cbm", "total_gw_with_pallets_kg"]);
const WEIGHT = /(_kg)$/;
const VOLUME = /cbm$/;

/** Stand-in for the stage 2 default steps, applied to a raw printed value before comparing. */
export function canonical(field: string, raw: string | null, label?: string): string | null {
  if (raw === null || raw.trim() === "") return null;
  if (field === "doc_date" || field === "etd") return parseDate(raw);
  if (["shipper", "consignee", "notify"].includes(field)) return norm(splitParty(raw).name);
  if (field === "pol" || field === "pod") return lookupPort(raw);
  if (field === "iso_type") return norm(raw).replace(/[^A-Z0-9]/g, "").replace(/X\d+$/, "");
  if (field === "pkg_range") return norm(raw).replace(/\s/g, "").replace(/~/g, "-");
  if (NUMERIC.has(field)) {
    const n = parseNumber(raw);
    if (n === null) return null;
    // Units come from the printed label or cell, never assumed; KG and CBM stay as they are.
    const u = unitIn(`${label ?? ""} ${raw}`);
    if (u && (WEIGHT.test(field) || VOLUME.test(field)) && !["KG", "KGS", "CBM", "M3"].includes(u.unit)) return toBase(n, u.unit);
    return n;
  }
  return norm(raw);
}

const exp = (field: string, v: string | null | undefined) => (v == null ? null : canonical(field, v));

// Any variant's output, read loosely: values are `{v, box}` or `{v, ids}`, cells are strings or values.
type Val = { v: string; box?: Box; ids?: number[] };
type AnyRow = { t: string; cells: (string | Val | null)[]; box?: Box; pbox?: Record<string, Box | null> };
type AnyOut = Omit<ModelOutput<"compact">, "header" | "containers" | "rows" | "totals"> & {
  header: Record<string, Val | null>; containers: Record<string, Val | null>[]; rows: AnyRow[]; totals: Record<string, Val | null>;
};

export function scorePage(
  e: Expected, page_no: number, output: unknown, items: GridItem[], route: "text" | "hybrid" | "vision",
): FieldResult[] {
  const out = output as AnyOut;
  const res: FieldResult[] = [];
  const push = (path: string, expected: string | null, got: string | null, state: GroundState | null) => {
    if (expected === null && got === null) return;
    res.push({ doc_id: e.doc_id, page_no, path, expected, got, correct: expected === got, key: isKey(path), protected: isProtected(path), state });
  };
  const o = { route };
  const last = page_no === e.pages.length;
  const m = GROUNDING.box_margin;
  const cited = (ids: number[]) => ids.map((id) => items[id]).filter((i): i is GridItem => !!i);

  /** Header, container and totals values: the box plus margin, or the cited items' box for item_ids. */
  const groundVal = (v: Val): GroundState => {
    if (v.ids) {
      const c = cited(v.ids);
      if (!c.length) return "contradicted";
      const b = unionBox(c);
      return groundIds(v.v, v.ids, [b[0] - m, b[1] - m, b[2] + m, b[3] + m], items, o);
    }
    return groundHeader(v.v, v.box!, items, o);
  };

  if (page_no === 1) {
    for (const k of Object.keys(out.header) as HeaderKey[]) {
      const v = out.header[k] ?? null;
      push(`header.${k}`, exp(k, e.header[k]), canonical(k, v?.v ?? null), v ? groundVal(v) : null);
    }
    const n = Math.max(e.containers.length, out.containers.length);
    for (let i = 0; i < n; i++) {
      for (const f of ["number", "iso_type", "seal"] as const) {
        const v = out.containers[i]?.[f] ?? null;
        push(`header.containers[${i}].${f}`, exp(f, e.containers[i]?.[f]), canonical(f, v?.v ?? null), v ? groundVal(v) : null);
      }
    }
  }

  const ranges = columnRanges(out.columns, items);
  const want = e.rows.filter((r) => r.page_no === page_no && r.row_type === "item");
  const got = out.rows.filter((r) => r.t === "item");
  // shortcut: rows are aligned by order; a dropped or extra row shifts every later row. Use LCS alignment
  // on description and part number if the experiment shows row-count mismatches.
  for (let i = 0; i < Math.max(want.length, got.length); i++) {
    const w = want[i], g = got[i];
    // item_ids rows have no box: it is the union of every item the row cites.
    const rowBox = g?.box ?? (g ? unionBox(cited(g.cells.flatMap((c) => (c && typeof c === "object" ? c.ids ?? [] : [])))) : undefined);
    for (const f of Object.keys(w?.fields ?? {}) as LineField[]) {
      const col = out.columns.findIndex((c) => c.field === f);
      const cell = g && col >= 0 ? g.cells[col] ?? null : null;
      const v = cell === null ? null : typeof cell === "string" ? cell : cell.v;
      let state: GroundState | null = null;
      if (v !== null && g) {
        const range = ranges[col] ?? null;
        const pbox = g.pbox?.[f];
        if (typeof cell === "object" && cell?.ids) {
          const [x0, x1] = range ?? [rowBox![0], rowBox![2]];
          state = groundIds(v, cell.ids, [x0, rowBox![1] - 3, x1, rowBox![3] + 3], items, o);
        } else if (typeof cell === "object" && cell?.box) state = groundHeader(v, cell.box, items, o);
        else if (pbox) state = groundHeader(v, pbox, items, o);
        else if (rowBox && Number.isFinite(rowBox[0])) state = groundCell(v, rowBox, range, items, o);
        else state = "contradicted";
      }
      push(`row.${f}`, exp(f, w?.fields[f]), canonical(f, v, out.columns[col]?.label), state);
    }
  }

  if (last) {
    for (const k of Object.keys(e.totals) as TotalsKey[]) {
      if (k === "total_pkgs_in_words") continue;
      const v = out.totals[k] ?? null;
      push(`totals.${k}`, exp(k, e.totals[k]), canonical(k, v?.v ?? null), v ? groundVal(v) : null);
    }
  }
  return res;
}

/** Wilson 95% interval for k successes out of n. */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export function summarize(fields: FieldResult[]) {
  const key = fields.filter((f) => f.key && f.expected !== null);
  const prot = fields.filter((f) => f.protected && f.got !== null);
  const correct = key.filter((f) => f.correct).length;
  const needPerson = prot.filter((f) => f.state !== "matched").length;
  return {
    key_fields: key.length,
    key_accuracy: key.length ? correct / key.length : 0,
    key_ci: wilson(correct, key.length),
    protected_fields: prot.length,
    need_person: prot.length ? needPerson / prot.length : 0,
    /** The dangerous case: a wrong value that grounding would let through without a person. */
    wrong_but_matched: prot.filter((f) => !f.correct && f.state === "matched").length,
    errors: fields.filter((f) => f.key && !f.correct),
    /** Share needing a person per field type, with the grounding states behind it. */
    need_person_by_path: Object.fromEntries(
      [...new Set(prot.map((f) => f.path.replace(/\[\d+\]/, "[]")))].sort().map((p) => {
        const fs = prot.filter((f) => f.path.replace(/\[\d+\]/, "[]") === p);
        const states: Record<string, number> = {};
        fs.filter((f) => f.state !== "matched").forEach((f) => (states[f.state ?? "none"] = (states[f.state ?? "none"] ?? 0) + 1));
        return [p, `${fs.length - fs.filter((f) => f.state === "matched").length}/${fs.length} ${JSON.stringify(states)}`];
      }),
    ),
  };
}
