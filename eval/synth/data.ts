import { checkDigit } from "../../src/rules/containers.ts";
import type { Rng } from "./rng.ts";

// All names are invented. Ports are real UN/LOCODEs (public reference data).

const NAME_A = ["Harbor", "Lumen", "Copperleaf", "Northgate", "Bluewater", "Kestrel", "Orchid", "Granite", "Silverpine", "Tidewell"];
const NAME_B = ["Industrial", "Precision", "Trading", "Components", "Hardware", "Fasteners", "Machinery", "Electric", "Plastics", "Supply"];
const SUFFIX = ["Co., Ltd.", "Corp.", "Inc.", "Ltd.", "GmbH", "LLC"];
const STREETS = ["No. 18, Gongye 3rd Rd.", "220 Riverside Ave.", "Unit 5, 41 Dock Lane", "88 Industrial Park Rd.", "1400 Harbor Blvd."];
const CITIES = ["Taichung, Taiwan", "Long Beach, CA 90802, USA", "Rotterdam, Netherlands", "Penang, Malaysia", "Hamburg, Germany", "Tainan, Taiwan"];

const ZH_A = ["永豐", "華聯", "建順", "宏昌", "立信", "東揚", "金泰", "聯輝"];
const ZH_B = ["精密工業", "實業", "五金", "機械", "電子", "塑膠"];
const ZH_ADDR = ["台中市西屯區工業區一路 18 號", "台南市安南區工業二路 220 號", "高雄市前鎮區新生路 41 號", "桃園市龜山區興華路 88 號"];

export const PRODUCTS = [
  ["HEX BOLT M8X30 ZINC PLATED", "HB-0830"], ["FLAT WASHER M10", "FW-1000"], ["NYLON LOCK NUT M6", "NL-0600"],
  ["SOCKET HEAD CAP SCREW M5X20", "SC-0520"], ["STAINLESS HINGE 3 IN", "SH-0300"], ["DRAWER SLIDE 450MM", "DS-0450"],
  ["CABLE TIE 200MM BLACK", "CT-0200"], ["PVC ELBOW 1/2 IN", "PE-0050"], ["BALL BEARING 6204-2RS", "BB-6204"],
  ["HOSE CLAMP 25-40MM", "HC-2540"], ["SPRING PIN 4X30", "SP-0430"], ["DOOR HANDLE ALUMINIUM", "DH-0120"],
  ["LED DRIVER 24V 60W", "LD-2460"], ["TERMINAL BLOCK 12P", "TB-0012"], ["COUPLING NUT M12", "CN-1200"],
] as const;

export const PORTS = {
  pol: [["TWKHH", "KAOHSIUNG, TAIWAN"], ["TWTXG", "TAICHUNG, TAIWAN"], ["TWKEL", "KEELUNG, TAIWAN"]],
  pod: [["USLGB", "LONG BEACH, CA"], ["NLRTM", "ROTTERDAM, NETHERLANDS"], ["DEHAM", "HAMBURG, GERMANY"], ["MYPEN", "PENANG, MALAYSIA"], ["USSAV", "SAVANNAH, GA"]],
} as const;

const VESSELS = ["EVER LUMEN", "OCEAN KESTREL", "HARBOR STAR", "PACIFIC ORCHID", "NORTHERN TIDE", "SILVER GRANITE"];

export function company(r: Rng) {
  const name = `${r.pick(NAME_A)} ${r.pick(NAME_B)} ${r.pick(SUFFIX)}`.toUpperCase();
  return { name, address: [r.pick(STREETS), r.pick(CITIES)].map((s) => s.toUpperCase()) };
}

export function zhCompany(r: Rng) {
  return { name: `${r.pick(ZH_A)}${r.pick(ZH_B)}股份有限公司`, address: [r.pick(ZH_ADDR)] };
}

export function containerNo(r: Rng) {
  const owner = Array.from({ length: 3 }, () => String.fromCharCode(65 + r.int(0, 25))).join("") + "U";
  const serial = String(r.int(0, 999999)).padStart(6, "0");
  return owner + serial + checkDigit(owner + serial);
}

export const vessel = (r: Rng) => ({ vessel: r.pick(VESSELS), voyage: `${r.int(100, 999)}${r.pick(["E", "W", "N", "S"])}` });
export const docNo = (r: Rng, prefix: string) => `${prefix}${r.int(2026, 2026)}${String(r.int(1, 9999)).padStart(4, "0")}`;
export const bookingNo = (r: Rng) => `${r.pick(["EGLV", "ONEY", "HLCU", "MAEU"])}${r.int(100000000, 999999999)}`;
export const seal = (r: Rng) => `${r.pick(["EMC", "YM", "TW"])}${r.int(1000000, 9999999)}`;

export function date(r: Rng) {
  const d = new Date(Date.UTC(2026, r.int(0, 11), r.int(1, 28)));
  return d.toISOString().slice(0, 10);
}
