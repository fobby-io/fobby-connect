// Approved documents as CSV (for Excel) and JSON (for programs). Pure functions: app.ts checks approval first.
import { normalize, type Fixes, type NormDoc, type NormRow } from "../normalize/normalize.ts";
import type { Page } from "../profiles/loop.ts";
import { checkDocument, type Finding } from "../rules/checks.ts";
import { HEADER_KEYS, TOTALS_KEYS } from "../shared/fields.ts";
import type { DocValues } from "./db.ts";
import type { Saved } from "./app.ts";

export const ROW_KEYS = [
  "po", "part_no", "revision", "hs_code", "lot_no", "description", "pkg_from", "pkg_to", "pkgs",
  "pallet_from", "pallet_to", "pallets", "qty_per_pkg", "qty", "qty_unit", "nw_kg", "gw_kg", "cbm",
] as const satisfies readonly (keyof NormRow)[];

const NUM = /^-?\d+(\.\d+)?$/;
const INT_KEYS = new Set(["pkg_from", "pkg_to", "pallet_from", "pallet_to"]);
const NUM_KEYS = new Set(["pkgs", "pallets", "qty_per_pkg", "qty", "nw_kg", "gw_kg", "cbm", ...TOTALS_KEYS.filter((k) => k !== "total_pkgs_in_words")]);
const DATE_KEYS = new Set(["doc_date", "etd", "eta"]);
// A value the column type cannot hold is left empty rather than failing the whole record.
const col = (k: string, x: string | null | undefined) =>
  x == null ? null : INT_KEYS.has(k) ? (/^\d+$/.test(x) ? Number(x) : null) : NUM_KEYS.has(k) ? (NUM.test(x) ? x : null)
    : DATE_KEYS.has(k) ? (/^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null) : x;

/** The normalized document as the standard record kept in the database. */
export const toValues = (n: NormDoc): DocValues => ({
  header: Object.fromEntries([
    ...HEADER_KEYS.map((k) => [k, col(k, n.header[k]?.v)]),
    ...TOTALS_KEYS.map((k) => [k, col(k, n.totals[k]?.v)]),
  ]) as Record<string, string | null>,
  rows: n.rows.map((r) => ({ page: r.page, row: r.row, ...Object.fromEntries(ROW_KEYS.map((k) => [k, col(k, r[k].v)])) })),
});

/** The stored values over the read, which keeps the printed text each came from. No stored record: the read as is. */
export function withValues(n: NormDoc, v: DocValues | null): NormDoc {
  if (!v) return n;
  const s = (x: unknown) => (x == null ? null : String(x));
  const rows = new Map(v.rows.map((r) => [`${r.page}:${r.row}`, r]));
  return {
    header: Object.fromEntries(HEADER_KEYS.map((k) => [k, { ...(n.header[k] ?? { raw: null, page: null }), v: s(v.header[k]) }])),
    totals: Object.fromEntries(TOTALS_KEYS.map((k) => [k, { ...(n.totals[k] ?? { raw: null }), v: s(v.header[k]) }])),
    rows: n.rows.map((r) => {
      const stored = rows.get(`${r.page}:${r.row}`);
      return stored ? { ...r, ...Object.fromEntries(ROW_KEYS.map((k) => [k, { ...r[k], v: s(stored[k]) }])) } : r;
    }),
  };
}

/** The stored values that differ from the read, as corrections: what review starts from when a person set them. */
export function fixesOf(read: NormDoc, v: DocValues): Fixes {
  const now = toValues(read), out: Fixes = {};
  const s = (x: unknown) => (x == null ? null : String(x));
  const range = (a: unknown, b: unknown) => (a == null ? null : a === b ? s(a) : `${a}-${b}`);
  for (const k of HEADER_KEYS) if (s(v.header[k]) !== s(now.header[k])) out[`header.${k}`] = s(v.header[k]);
  for (const k of TOTALS_KEYS) if (s(v.header[k]) !== s(now.header[k])) out[`totals.${k}`] = s(v.header[k]);
  const rows = new Map(now.rows.map((r) => [`${r.page}:${r.row}`, r]));
  for (const r of v.rows) {
    const was = rows.get(`${r.page}:${r.row}`);
    if (!was) continue;
    for (const k of ROW_KEYS) {
      if (s(r[k]) === s(was[k])) continue;
      // Ranges are corrected as one value, "1-108".
      if (k === "pkg_from" || k === "pkg_to") out[`rows.${r.page}.${r.row}.pkg_range`] = range(r.pkg_from, r.pkg_to);
      else if (k === "pallet_from" || k === "pallet_to") out[`rows.${r.page}.${r.row}.pallet_range`] = range(r.pallet_from, r.pallet_to);
      else out[`rows.${r.page}.${r.row}.${k}`] = s(r[k]);
    }
  }
  return out;
}

export type Exportable = Saved & { approved: NonNullable<Saved["approved"]> & { answer: Page[]; approved_at: string } };
type Container = { page: number; number: string | null; iso_type: string | null; seal: string | null; qty: string | null };
export type ExportV1 = {
  schema_version: 1; id: string; name: string; doc_type: string | null; sender: string; approved_at: string;
  header: NormDoc["header"]; containers: Container[]; rows: Omit<NormRow, "box">[]; totals: NormDoc["totals"];
  // The receiver sees where the data came from, which checks still fail and how much a person changed.
  source: { file: string; pages: number }; checks: Finding[]; review: { corrected: number; prompt_version: number | null };
};

export function exportJson(d: Exportable, n: NormDoc = normalize(d.approved.answer)): ExportV1 {
  const answer = d.approved.answer;
  const containers = answer.flatMap((p, i) => p.containers.map((c) => ({
    page: i + 1, number: c.number?.v ?? null, iso_type: c.iso_type?.v ?? null, seal: c.seal?.v ?? null, qty: c.qty?.v ?? null,
  })));
  return {
    schema_version: 1, id: d.id, name: d.name, doc_type: d.run.cls, sender: d.approved.sender, approved_at: d.approved.approved_at,
    header: n.header, containers, rows: n.rows.map(({ box: _, ...r }) => r), totals: n.totals,
    source: { file: `/api/documents/${d.id}/file`, pages: answer.length },
    checks: checkDocument(answer, n),
    review: { corrected: d.approved.corrected, prompt_version: d.run.prompt?.version ?? null },
  };
}

// Excel reads a CSV as UTF-8 only when it starts with a byte order mark.
export const BOM = String.fromCharCode(0xfeff);

// Excel runs a cell starting with = + @ (and - unless it is a number) as a formula.
const cell = (x: string | number | null | undefined) => {
  let s = x == null ? "" : String(x);
  if (/^[=+@\t\r]/.test(s) || (s.startsWith("-") && !/^-\d+(\.\d+)?$/.test(s))) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function exportCsv(d: Exportable, n: NormDoc = normalize(d.approved.answer)): string {
  const head = [d.id, d.run.cls, d.approved.sender, d.approved.approved_at, ...HEADER_KEYS.map((k) => n.header[k]?.v)];
  const lines = [
    ["doc_id", "doc_type", "sender", "approved_at", ...HEADER_KEYS, "page", "item", ...ROW_KEYS],
    ...n.rows.map((r, i) => [...head, r.page, i + 1, ...ROW_KEYS.map((k) => r[k].v)]),
  ];
  return BOM + lines.map((l) => l.map(cell).join(",") + "\r\n").join("");
}
