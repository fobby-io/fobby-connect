import type { HeaderKey, LineField, RowType, TotalsKey } from "../../src/shared/fields.ts";

// Ground truth for one synthetic document. Values are canonical (what stage 2 must produce):
// decimals as decimal.js strings, dates as YYYY-MM-DD, everything else as printed.
export type Expected = {
  doc_id: string;
  layout: string;
  seed: number;
  doc_type: "SO" | "PL";
  pages: { page_no: number; expected_route: "text" | "hybrid" | "vision"; rows: number }[];
  header: Partial<Record<HeaderKey, string>>;
  containers: { number: string | null; iso_type: string; seal: string | null; qty: string | null }[];
  rows: { page_no: number; row_type: RowType; group_code: string | null; fields: Partial<Record<LineField, string>> }[];
  groups: { group_code: string; pallet_spec: { pkgs_per_pallet: string; pallets: string }[]; pallet_ids: string | null }[];
  totals: Partial<Record<TotalsKey, string>>;
  // Profile stand-in for M1: printed column labels and prompt notes for this layout.
  profile: { columns: { field: LineField; label: string }[]; prompt_notes: string[] };
};
