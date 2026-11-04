import Decimal from "decimal.js";
import { norm } from "../pipeline/grounding.ts";
import { lookupPort } from "../reference/unlocode.ts";
import type { ModelOutput } from "../shared/model-output.ts";
import { parseDate } from "../transforms/steps/date-parse.ts";
import { parseNumber } from "../transforms/steps/parse-number.ts";
import { splitParty } from "../transforms/steps/split.ts";
import { toBase, unitIn } from "../transforms/units.ts";

// Stage 2, generic steps: printed text -> typed values. The model only copies; every computation is here.
// Every value keeps the raw text it came from, so review can show both and a correction can tell
// a misread (raw wrong) from a rule gap (raw right, value wrong).
// shortcut: generic patterns only; per-sender rules (the profile's step lists) are added when a sender needs them.

type Page = ModelOutput<"compact">;
export type V = { v: string | null; raw: string | null };
export type NormRow = {
  page: number; row: number; box: number[];
  po: V; part_no: V; revision: V; hs_code: V; lot_no: V; description: V;
  pkg_from: V; pkg_to: V; pkgs: V; pallet_from: V; pallet_to: V; pallets: V; qty_per_pkg: V; qty: V; qty_unit: V; nw_kg: V; gw_kg: V; cbm: V;
};
export type NormDoc = {
  header: Record<string, V & { page: number | null }>;
  rows: NormRow[];
  totals: Record<string, V>;
};

const v = (val: string | null | undefined, raw: string | null | undefined): V => ({ v: val ?? null, raw: raw ?? null });
const lines = (s: string | null | undefined) => (s ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

// Stacked cells print "@per package" over "row total".
const perPkg = (cell: string | null | undefined) => lines(cell).find((l) => l.startsWith("@")) ?? null;
const rowTotal = (cell: string | null | undefined) => lines(cell).filter((l) => !l.startsWith("@")).at(-1) ?? null;

const PO = /(?:\bP\s*[./]?\s*O\b\.?\s*(?:NO\.?)?\s*[#:：]?|(?:^|\s)#)\s*([A-Z]{1,5}\d{3,})(?:-(\d{1,3}))?/im;
const PART = /\b(?:PT|P\/N|PN|PART[-\s]?NO\.?)\s*[#:：]\s*([A-Z0-9][A-Z0-9.-]*[A-Z0-9])(?:\s*\(([^)]*)\)?)?/i;
const HS = /\b(?:HS|HTS|H\.\s?S\.)(?:\s*CODE)?\s*[#:：]?\s*(\d[\d.]{5,})/i;
const LOT = /\bLOT\s*(?:NO\.?)?\s*[#:：]\s*([A-Z0-9][A-Z0-9-]*)/i;
const LABELLED = [PO, PART, HS, LOT];

function weight(cell: string | null | undefined, label: string): V {
  const raw = rowTotal(cell);
  const n = raw ? parseNumber(raw) : null;
  if (n === null) return v(null, cell);
  // LBR is the UN/ECE code for pound, printed by some ERPs.
  const u = unitIn(`${raw} ${label}`.replace(/\bLBR\b/gi, "LBS"));
  if (!u || ["KG", "KGS", "KGM"].includes(u.unit)) return v(n, cell);
  const kg = toBase(n, u.unit);
  return v(kg && new Decimal(kg).toDecimalPlaces(3).toString(), cell);
}

export function normalize(pages: Page[]): NormDoc {
  const header: NormDoc["header"] = {};
  const first = <K extends keyof Page["header"]>(k: K) => {
    const i = pages.findIndex((p) => p.header[k]?.v);
    return i < 0 ? { raw: null, page: null } : { raw: pages[i]!.header[k]!.v, page: i + 1 };
  };
  for (const k of Object.keys(pages[0]?.header ?? {}) as (keyof Page["header"])[]) {
    const { raw, page } = first(k);
    let val: string | null = raw;
    if (raw && (k === "doc_date" || k === "etd" || k === "eta")) val = parseDate(raw);
    if (raw && (k === "pol" || k === "pod")) val = lookupPort(raw) ?? raw.trim();
    if (raw && (k === "shipper" || k === "consignee" || k === "notify")) val = splitParty(raw).name;
    header[k] = { ...v(val, raw), page };
  }
  // A voyage printed after the vessel name ("EVER MERCY V.1366-007E") is split off.
  const ves = header.vessel;
  const m = ves?.raw?.match(/^(.*?)\s+(V\.?\s*\S+|\d{3,}\w*)$/i);
  if (ves?.raw && m) {
    ves.v = m[1]!.trim();
    if (!header.voyage?.raw) header.voyage = { v: m[2]!.trim(), raw: ves.raw, page: ves.page };
  }
  // "V.1353-012E", "VOY. 1353-012E" and "1353-012E" are the same voyage.
  if (header.voyage?.v) header.voyage.v = header.voyage.v.replace(/^V(?:OY(?:AGE)?)?\.?\s*/i, "");
  if (!header.shipper?.raw && pages[0]?.issuer) header.shipper = { v: splitParty(pages[0].issuer).name, raw: pages[0].issuer, page: 1 };

  const rows: NormRow[] = [];
  let ctx = { po: v(null, null), part_no: v(null, null), revision: v(null, null), hs_code: v(null, null), lot_no: v(null, null), description: v(null, null) };
  pages.forEach((p, pi) => {
    const col = (cells: (string | null)[], f: string) => { const i = p.columns.findIndex((c) => c.field === f); return i < 0 ? null : cells[i] ?? null; };
    const label = (f: string) => p.columns.find((c) => c.field === f)?.label ?? "";
    p.rows.forEach((r, ri) => {
      const text = [col(r.cells, "description"), col(r.cells, "marks"), col(r.cells, "po_no"), col(r.cells, "part_no")].filter(Boolean).join("\n");
      const po = col(r.cells, "po_no") ?? text.match(PO)?.[1] ?? null;
      const part = text.match(PART);
      // A new PO starts a new product; a row without one continues the product above (fill down).
      if (po) ctx = { po: v(po.toUpperCase().replace(/\s/g, ""), po), part_no: v(null, null), revision: v(null, null), hs_code: v(null, null), lot_no: v(null, null), description: v(null, null) };
      const partNo = col(r.cells, "part_no") ?? part?.[1];
      if (partNo) { ctx.part_no = v(partNo, partNo); ctx.revision = v(part?.[2] ?? null, part?.[0] ?? null); }
      const hs = col(r.cells, "hs_code") ?? text.match(HS)?.[1];
      if (hs) ctx.hs_code = v(hs, hs);
      const desc = lines(col(r.cells, "description")).filter((l) => !LABELLED.some((re) => re.test(l)) && !/^[-=*]+$/.test(l));
      if (desc.length && r.t !== "ditto") ctx.description = v(desc.join(" "), col(r.cells, "description"));
      if (r.t !== "item" && r.t !== "ditto") return;

      const lot = col(r.cells, "lot_no") ?? text.match(LOT)?.[1] ?? null;
      const range = col(r.cells, "pkg_range");
      const rm = range?.match(/(\d+)\s*[-~]\s*(\d+)/) ?? range?.match(/^\s*(\d+)\s*$/m);
      const from = rm?.[1] ?? null, to = rm?.[2] ?? rm?.[1] ?? null;
      // Pallet numbers are kept, not counted: rows sharing a pallet repeat its number.
      const pr = col(r.cells, "pallet_range");
      const pm = pr?.match(/(\d+)\s*[-~]\s*(\d+)/) ?? pr?.match(/(\d+)/);
      const pkgCell = col(r.cells, "pkg_qty");
      // "@10\n50" is per pallet over the row's count; "244 CTNS\n36CTN/6PLT" is the count over its pallet split.
      const pkgLine = lines(pkgCell).find((l) => !l.startsWith("@"));
      const pkgs = (pkgLine && parseNumber(pkgLine)) ?? (from && to ? String(Number(to) - Number(from) + 1) : null);
      // "36CTN/3PLT" or "(1PLT)" counts pallets; "LOT#2640804-3 PLT#M1-M3" is a lot number then pallet marks, not 3 pallets.
      const plts = [...r.cells.filter(Boolean).join(" ").matchAll(/(?<![\w-])(\d+)\s*PLTS?\b(?!\s*#)/gi)].map((x) => Number(x[1]));
      const qtyCell = col(r.cells, "qty");
      const qtyRaw = rowTotal(qtyCell);
      const unit = (qtyRaw?.match(/[A-Z]{2,}/i)?.[0] ?? label("qty").match(/\(([A-Z]+)\)/i)?.[1] ?? null)?.toUpperCase() ?? null;
      rows.push({
        page: pi + 1, row: ri, box: r.box as number[],
        ...ctx, lot_no: lot ? v(lot, lot) : ctx.lot_no,
        pkg_from: v(from, range), pkg_to: v(to, range), pkgs: v(pkgs, pkgCell ?? range),
        pallet_from: v(pm?.[1] ?? null, pr), pallet_to: v(pm?.[2] ?? pm?.[1] ?? null, pr),
        pallets: v(plts.length ? String(plts.reduce((a, b) => a + b, 0)) : null, range),
        qty_per_pkg: v(perPkg(qtyCell) ? parseNumber(perPkg(qtyCell)!) : null, qtyCell),
        qty: v(qtyRaw ? parseNumber(qtyRaw) : null, qtyCell), qty_unit: v(unit, qtyCell),
        nw_kg: weight(col(r.cells, "nw_kg"), label("nw_kg")), gw_kg: weight(col(r.cells, "gw_kg"), label("gw_kg")),
        cbm: v(rowTotal(col(r.cells, "cbm")) ? parseNumber(rowTotal(col(r.cells, "cbm"))!) : null, col(r.cells, "cbm")),
      });
    });
  });

  const totals: NormDoc["totals"] = {};
  const lastWith = (k: keyof Page["totals"]) => [...pages].reverse().find((p) => p.totals[k]?.v);
  for (const k of Object.keys(pages[0]?.totals ?? {}) as (keyof Page["totals"])[]) {
    const p = lastWith(k);
    const raw = p?.totals[k]?.v ?? null;
    if (!raw) { totals[k] = v(null, null); continue; }
    if (k.endsWith("_kg")) totals[k] = weight(raw, p!.columns.find((c) => c.field === (k === "total_nw_kg" ? "nw_kg" : "gw_kg"))?.label ?? "");
    else if (k === "total_pkgs_in_words") totals[k] = v(raw, raw);
    else totals[k] = v(parseNumber(raw), raw);
  }
  // "942 CTNS ( 46 PLTS )": the pallet count printed inside the package total.
  const inPkgs = totals.total_pkgs?.raw?.match(/(\d+)\s*PLTS?\b/i);
  if (!totals.total_pallets?.v && inPkgs) totals.total_pallets = v(inPkgs[1]!, totals.total_pkgs!.raw);
  return { header, rows, totals };
}

/** PO numbers listed in the shipping marks ("PO#ORD40563,ORD40463,ORD40\n543"), with line breaks inside a number joined. */
export function marksPos(marks: string | null): string[] {
  if (!marks) return [];
  const m = marks.toUpperCase().match(/P\s*[./]?\s*O\s*(?:NO\.?)?\s*[#:：]?([\s\S]*?)(?:\n\s*[A-Z/ ]{2,}[#:：]|$)/);
  if (!m) return [];
  return m[1]!.replace(/\s+/g, "").split(/[,，;]/).filter((x) => /^[A-Z]{1,5}\d{3,}$/.test(x));
}

export const samePo = (a: string, b: string) => norm(a).replace(/[^A-Z0-9]/g, "") === norm(b).replace(/[^A-Z0-9]/g, "");
