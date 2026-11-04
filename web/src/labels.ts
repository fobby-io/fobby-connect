// Plain names in both languages; the printed label and raw text are shown next to them. labels() picks the current language.
import { getLang } from "./i18n.ts";

type Labels = {
  FIELD: Record<string, string>; HEAD: Record<string, string>; TOTAL: Record<string, string>; SUM_NAME: Record<string, string>;
  DOC_TYPE: Record<string, string>; COLS: [key: string, name: string, cls?: "num"][];
};

const ZH: Labels = {
  FIELD: {
    pkg_range: "箱號", pallet_range: "板號", marks: "嘜頭", description: "品名／說明", part_no: "料號", lot_no: "批號", hs_code: "稅則號",
    po_no: "PO 號碼", pkg_qty: "箱數", pkg_unit: "包裝單位", qty: "數量", qty_unit: "數量單位", qty_per_pkg: "每箱數量",
    nw_kg: "淨重", gw_kg: "毛重", nw_per_pkg_kg: "每箱淨重", gw_per_pkg_kg: "每箱毛重", cbm: "材積",
  },
  HEAD: {
    doc_no: "文件號碼", doc_date: "文件日期", booking_no: "訂艙號碼", shipper: "寄件人", consignee: "收貨人", notify: "通知人",
    pol: "起運港", pod: "目的港", etd: "開航日", eta: "到港日", vessel: "船名", voyage: "航次", shipping_marks: "嘜頭",
  },
  TOTAL: {
    total_pkgs: "總箱數", total_pallets: "總板數", total_qty: "總數量", total_nw_kg: "總淨重", total_gw_kg: "總毛重",
    total_gw_with_pallets_kg: "含棧板毛重", total_cbm: "總材積", total_pkgs_in_words: "大寫總箱數",
  },
  SUM_NAME: { pkg_qty: "箱數", qty: "數量", gw_kg: "毛重", nw_kg: "淨重", cbm: "材積", pallets: "板數" },
  DOC_TYPE: { PL: "裝箱單（Packing List）", SO: "託運單（Shipping Order）" },
  COLS: [
    ["pkg_range", "箱號"], ["pallet_range", "板號"], ["pallets", "板數", "num"], ["pkgs", "箱數", "num"], ["po", "PO 號碼"], ["part_no", "料號"],
    ["description", "品名"], ["qty_per_pkg", "每箱數量", "num"], ["qty", "數量", "num"], ["nw_kg", "淨重 kg", "num"], ["gw_kg", "毛重 kg", "num"], ["cbm", "材積 m³", "num"],
  ],
};

const EN: Labels = {
  FIELD: {
    pkg_range: "Carton no.", pallet_range: "Pallet no.", marks: "Marks", description: "Description", part_no: "Part no.", lot_no: "Lot no.", hs_code: "HS code",
    po_no: "PO no.", pkg_qty: "Cartons", pkg_unit: "Package unit", qty: "Quantity", qty_unit: "Quantity unit", qty_per_pkg: "Qty per carton",
    nw_kg: "Net weight", gw_kg: "Gross weight", nw_per_pkg_kg: "Net weight per carton", gw_per_pkg_kg: "Gross weight per carton", cbm: "Volume",
  },
  HEAD: {
    doc_no: "Document no.", doc_date: "Document date", booking_no: "Booking no.", shipper: "Shipper", consignee: "Consignee", notify: "Notify party",
    pol: "Port of loading", pod: "Port of discharge", etd: "ETD", eta: "ETA", vessel: "Vessel", voyage: "Voyage", shipping_marks: "Shipping marks",
  },
  TOTAL: {
    total_pkgs: "Total cartons", total_pallets: "Total pallets", total_qty: "Total quantity", total_nw_kg: "Total net weight", total_gw_kg: "Total gross weight",
    total_gw_with_pallets_kg: "Gross weight with pallets", total_cbm: "Total volume", total_pkgs_in_words: "Total cartons in words",
  },
  SUM_NAME: { pkg_qty: "cartons", qty: "quantity", gw_kg: "gross weight", nw_kg: "net weight", cbm: "volume", pallets: "pallets" },
  DOC_TYPE: { PL: "Packing List", SO: "Shipping Order" },
  COLS: [
    ["pkg_range", "Carton no."], ["pallet_range", "Pallet no."], ["pallets", "Pallets", "num"], ["pkgs", "Cartons", "num"], ["po", "PO no."], ["part_no", "Part no."],
    ["description", "Description"], ["qty_per_pkg", "Qty/ctn", "num"], ["qty", "Quantity", "num"], ["nw_kg", "N.W. kg", "num"], ["gw_kg", "G.W. kg", "num"], ["cbm", "CBM", "num"],
  ],
};

export const labels = (): Labels => (getLang() === "zh" ? ZH : EN);

// Which normalized column a failed check points at.
export const CHECK_COL: Record<string, string> = {
  total_pkgs: "pkgs", total_qty: "qty", total_gw_kg: "gw_kg", total_nw_kg: "nw_kg", total_cbm: "cbm", total_pallets: "pallets", shipping_marks: "po",
};
// Which column of the normalized table a model field feeds, for warning colours.
export const FIELD_COL: Record<string, string> = { pkg_qty: "pkgs", po_no: "po" };
