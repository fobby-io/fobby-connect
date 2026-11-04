// Plain names; the printed label and raw text are shown next to them.
export const FIELD: Record<string, string> = {
  pkg_range: "箱號", pallet_range: "板號", marks: "嘜頭", description: "品名／說明", part_no: "料號", lot_no: "批號", hs_code: "稅則號",
  po_no: "PO 號碼", pkg_qty: "箱數", pkg_unit: "包裝單位", qty: "數量", qty_unit: "數量單位", qty_per_pkg: "每箱數量",
  nw_kg: "淨重", gw_kg: "毛重", nw_per_pkg_kg: "每箱淨重", gw_per_pkg_kg: "每箱毛重", cbm: "材積",
};
export const HEAD: Record<string, string> = {
  doc_no: "文件號碼", doc_date: "文件日期", booking_no: "訂艙號碼", shipper: "寄件人", consignee: "收貨人", notify: "通知人",
  pol: "起運港", pod: "目的港", etd: "開航日", eta: "到港日", vessel: "船名", voyage: "航次", shipping_marks: "嘜頭",
};
export const TOTAL: Record<string, string> = {
  total_pkgs: "總箱數", total_pallets: "總板數", total_qty: "總數量", total_nw_kg: "總淨重", total_gw_kg: "總毛重",
  total_gw_with_pallets_kg: "含棧板毛重", total_cbm: "總材積", total_pkgs_in_words: "大寫總箱數",
};
export const SUM_NAME: Record<string, string> = { pkg_qty: "箱數", qty: "數量", gw_kg: "毛重", nw_kg: "淨重", cbm: "材積", pallets: "板數" };
// Which normalized column a failed check points at.
export const CHECK_COL: Record<string, string> = {
  total_pkgs: "pkgs", total_qty: "qty", total_gw_kg: "gw_kg", total_nw_kg: "nw_kg", total_cbm: "cbm", total_pallets: "pallets", shipping_marks: "po",
};
// Which column of the normalized table a model field feeds, for warning colours.
export const FIELD_COL: Record<string, string> = { pkg_qty: "pkgs", po_no: "po" };
export const DOC_TYPE: Record<string, string> = { PL: "裝箱單（Packing List）", SO: "託運單（Shipping Order）" };
export const COLS: [key: string, name: string, cls?: "num"][] = [
  ["pkg_range", "箱號"], ["pallet_range", "板號"], ["pallets", "板數", "num"], ["pkgs", "箱數", "num"], ["po", "PO 號碼"], ["part_no", "料號"],
  ["description", "品名"], ["qty_per_pkg", "每箱數量", "num"], ["qty", "數量", "num"], ["nw_kg", "淨重 kg", "num"], ["gw_kg", "毛重 kg", "num"],
];
