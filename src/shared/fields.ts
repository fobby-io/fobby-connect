// The only list of protected and key fields; grounding, approval, scoring and the experiment import it.
// Paths: header.<f>, header.containers[].<f>, row.<f>, group.<f>, totals.<f>.

export const HEADER_KEYS = [
  "doc_no", "doc_date", "booking_no", "shipper", "consignee", "notify",
  "pol", "pod", "etd", "eta", "vessel", "voyage", "shipping_marks",
] as const;
export type HeaderKey = (typeof HEADER_KEYS)[number];

export const CONTAINER_KEYS = ["number", "iso_type", "seal", "qty"] as const;
export type ContainerKey = (typeof CONTAINER_KEYS)[number];

export const ROW_TYPES = [
  "item", "ditto", "group_header", "section_title", "subtotal", "carried_forward", "total",
] as const;
export type RowType = (typeof ROW_TYPES)[number];

export const LINE_FIELDS = [
  "pkg_range", "pallet_range", "marks", "description", "part_no", "lot_no", "hs_code", "po_no",
  "pkg_qty", "pkg_unit", "qty", "qty_unit", "qty_per_pkg",
  "nw_kg", "gw_kg", "nw_per_pkg_kg", "gw_per_pkg_kg", "cbm",
] as const;
export type LineField = (typeof LINE_FIELDS)[number];

export const TOTALS_KEYS = [
  "total_pkgs", "total_pallets", "total_qty", "total_gw_kg", "total_nw_kg",
  "total_cbm", "total_gw_with_pallets_kg", "total_pkgs_in_words",
] as const;
export type TotalsKey = (typeof TOTALS_KEYS)[number];

export const PROTECTED_ROW_FIELDS = ["pkg_range", "pkg_qty", "qty", "nw_kg", "gw_kg", "cbm"] as const;

export const PROTECTED_PATHS: readonly string[] = [
  "header.shipper", "header.consignee", "header.pol", "header.pod", "header.booking_no",
  "header.containers[].number", "header.containers[].iso_type", "header.containers[].seal",
  ...PROTECTED_ROW_FIELDS.map((f) => `row.${f}`),
  "group.pallet_spec", "group.pallet_ids",
  ...TOTALS_KEYS.filter((k) => k !== "total_pkgs_in_words").map((k) => `totals.${k}`),
];

export const KEY_PATHS: readonly string[] = [
  ...PROTECTED_PATHS,
  "header.doc_no", "header.doc_date", "header.etd", "row.description", "row.part_no",
];

/** `header.containers[3].seal` -> `header.containers[].seal`, so indexed paths match the lists. */
export function pathPattern(path: string): string {
  return path.replace(/\[\d+\]/g, "[]");
}

export const isProtected = (path: string) => PROTECTED_PATHS.includes(pathPattern(path));
export const isKey = (path: string) => KEY_PATHS.includes(pathPattern(path));
