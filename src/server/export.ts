// Approved documents as CSV (for Excel) and JSON (for programs). Pure functions: app.ts checks approval first.
import { normalize, type NormDoc, type NormRow } from "../normalize/normalize.ts";
import type { Page } from "../profiles/loop.ts";
import { checkDocument, type Finding } from "../rules/checks.ts";
import { HEADER_KEYS } from "../shared/fields.ts";
import type { Saved } from "./app.ts";

export const ROW_KEYS = [
  "po", "part_no", "revision", "hs_code", "lot_no", "description", "pkg_from", "pkg_to", "pkgs",
  "pallet_from", "pallet_to", "pallets", "qty_per_pkg", "qty", "qty_unit", "nw_kg", "gw_kg", "cbm",
] as const satisfies readonly (keyof NormRow)[];

export type Exportable = Saved & { approved: NonNullable<Saved["approved"]> & { answer: Page[]; approved_at: string } };
type Container = { page: number; number: string | null; iso_type: string | null; seal: string | null; qty: string | null };
export type ExportV1 = {
  schema_version: 1; id: string; name: string; doc_type: string | null; sender: string; approved_at: string;
  header: NormDoc["header"]; containers: Container[]; rows: Omit<NormRow, "box">[]; totals: NormDoc["totals"];
  // The receiver sees where the data came from, which checks still fail and how much a person changed.
  source: { file: string; pages: number }; checks: Finding[]; review: { corrected: number; prompt_version: number | null };
};

export function exportJson(d: Exportable): ExportV1 {
  const answer = d.approved.answer;
  const n = normalize(answer);
  const containers = answer.flatMap((p, i) => p.containers.map((c) => ({
    page: i + 1, number: c.number?.v ?? null, iso_type: c.iso_type?.v ?? null, seal: c.seal?.v ?? null, qty: c.qty?.v ?? null,
  })));
  return {
    schema_version: 1, id: d.id, name: d.name, doc_type: d.run.cls, sender: d.approved.sender, approved_at: d.approved.approved_at,
    header: n.header, containers, rows: n.rows.map(({ box: _, ...r }) => r), totals: n.totals,
    source: { file: `/api/documents/${d.id}/file`, pages: answer.length },
    checks: checkDocument(answer),
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

export function exportCsv(d: Exportable): string {
  const n = normalize(d.approved.answer);
  const head = [d.id, d.run.cls, d.approved.sender, d.approved.approved_at, ...HEADER_KEYS.map((k) => n.header[k]?.v)];
  const lines = [
    ["doc_id", "doc_type", "sender", "approved_at", ...HEADER_KEYS, "page", "item", ...ROW_KEYS],
    ...n.rows.map((r, i) => [...head, r.page, i + 1, ...ROW_KEYS.map((k) => r[k].v)]),
  ];
  return BOM + lines.map((l) => l.map(cell).join(",") + "\r\n").join("");
}
