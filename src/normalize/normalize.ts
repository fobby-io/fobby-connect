import Decimal from "decimal.js";
import { norm } from "../pipeline/grounding.ts";
import { lookupPort } from "../reference/unlocode.ts";
import type { ModelOutput } from "../shared/model-output.ts";
import { parseDate } from "../transforms/steps/date-parse.ts";
import { parseNumber } from "../transforms/steps/parse-number.ts";
import { splitParty } from "../transforms/steps/split.ts";
import { toBase, unitIn } from "../transforms/units.ts";
import { HEADER_KEYS, TOTALS_KEYS } from "../shared/fields.ts";

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
  // "G.W." and "N.W." name the weight, not a unit: the G is not grams.
  const u = unitIn(`${raw} ${label.replace(/\b[GN]\s*\.?\s*\/?\s*W\b\.?/gi, "")}`.replace(/\bLBR\b/gi, "LBS"));
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
  // A voyage printed after the vessel name ("BLUE HARBOR V.2201-015E") is split off.
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

/** PO numbers listed in the shipping marks ("PO#PO71820,PO71833,PO718\n47"), with line breaks inside a number joined. */
export function marksPos(marks: string | null): string[] {
  if (!marks) return [];
  const m = marks.toUpperCase().match(/P\s*[./]?\s*O\s*(?:NO\.?)?\s*[#:：]?([\s\S]*?)(?:\n\s*[A-Z/ ]{2,}[#:：]|$)/);
  if (!m) return [];
  return m[1]!.replace(/\s+/g, "").split(/[,，;]/).filter((x) => /^[A-Z]{1,5}\d{3,}$/.test(x));
}

export const samePo = (a: string, b: string) => norm(a).replace(/[^A-Z0-9]/g, "") === norm(b).replace(/[^A-Z0-9]/g, "");

/**
 * A person's corrections to normalized values, keyed "header.<k>", "totals.<k>" or "rows.<page>.<row>.<field>"
 * (page 1-based; field pkg_range or pallet_range sets both ends from "1-108"). null clears a value.
 */
export type Fixes = Record<string, string | null>;

const NUM_ROW = new Set(["pkgs", "pallets", "qty_per_pkg", "qty", "nw_kg", "gw_kg", "cbm"]);
const TEXT_ROW = new Set(["po", "part_no", "revision", "hs_code", "lot_no", "description", "qty_unit"]);
const DATE_HEAD = new Set(["doc_date", "etd", "eta"]);

/** The value a typed correction stands for, or undefined when it cannot be one ("12 boxes" for a number). */
function typed(field: string, input: string | null): string | null | undefined {
  const s = input?.trim() ?? "";
  if (!s) return null;
  if (NUM_ROW.has(field) || (field.startsWith("total_") && field !== "total_pkgs_in_words")) return parseNumber(s) ?? undefined;
  if (DATE_HEAD.has(field)) return parseDate(s) ?? undefined;
  if (field === "pol" || field === "pod") return lookupPort(s) ?? s.toUpperCase();
  return s;
}

/** Applies corrections on top of the values read from the page. bad lists the keys that are not a valid value. */
export function applyFixes(n: NormDoc, fixes: Fixes): { doc: NormDoc; bad: string[] } {
  const doc = structuredClone(n), bad: string[] = [];
  for (const [key, input] of Object.entries(fixes)) {
    const [part, ...rest] = key.split(".");
    if (part === "header" || part === "totals") {
      const k = rest.join("."), keys: readonly string[] = part === "header" ? HEADER_KEYS : TOTALS_KEYS;
      const val = keys.includes(k) ? typed(k, input) : undefined;
      if (val === undefined) { bad.push(key); continue; }
      if (part === "header") doc.header[k] = { ...(doc.header[k] ?? { raw: null, page: null }), v: val };
      else doc.totals[k] = { ...(doc.totals[k] ?? { raw: null }), v: val };
      continue;
    }
    const [page, row, field] = rest;
    const r = part === "rows" ? doc.rows.find((x) => x.page === Number(page) && x.row === Number(row)) : undefined;
    if (!r || !field) { bad.push(key); continue; }
    if (field === "pkg_range" || field === "pallet_range") {
      const m = (input ?? "").match(/^\s*(\d+)\s*(?:[-~–]\s*(\d+))?\s*$/);
      if (input?.trim() && !m) { bad.push(key); continue; }
      const [from, to] = field === "pkg_range" ? ["pkg_from", "pkg_to"] as const : ["pallet_from", "pallet_to"] as const;
      r[from] = { ...r[from], v: m?.[1] ?? null };
      r[to] = { ...r[to], v: m?.[2] ?? m?.[1] ?? null };
      continue;
    }
    const val = NUM_ROW.has(field) || TEXT_ROW.has(field) ? typed(field, input) : undefined;
    if (val === undefined) { bad.push(key); continue; }
    (r as unknown as Record<string, V>)[field] = { ...(r as unknown as Record<string, V>)[field]!, v: val };
  }
  return { doc, bad };
}

/** A corrected value that is not a misread of the printed text: the rule that turned the text into a value needs a look. */
export type RuleReview = { key: string; printed: string | null; read: string | null; fixed: string | null };

const TOKEN = /\d[\d,]*(?:\.\d+)?/g;
// A row entry compared by its value (its printed text may change), or page and row as they are.
const valueOf = (x: unknown) => (x && typeof x === "object" && "v" in x ? (x as V).v : x);
// The printed column a row value is read from; values made from several (pallets, ranges) are not written back.
const SOURCE: Record<string, string> = { pkgs: "pkg_qty", qty: "qty", qty_per_pkg: "qty", nw_kg: "nw_kg", gw_kg: "gw_kg", cbm: "cbm" };
const NUMERIC_TOTAL = (k: string) => k.startsWith("total_") && k !== "total_pkgs_in_words";

/** text with the one place that reads as was replaced by now, in the same style ("1,704.24" stays with commas and 2 decimals); null when not exactly one. */
function swap(text: string, was: string, now: string, numeric: boolean): string | null {
  if (numeric) {
    const hits = [...text.matchAll(TOKEN)].filter((m) => parseNumber(m[0]) === was);
    if (hits.length !== 1) return null;
    const tok = hits[0]![0], at = hits[0]!.index!;
    let s = new Decimal(now).toFixed(tok.split(".")[1]?.length ?? 0);
    if (tok.includes(",")) s = s.replace(/^-?\d+/, (d) => d.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
    return text.slice(0, at) + s + text.slice(at + tok.length);
  }
  const i = text.indexOf(was);
  if (i < 0 || text.indexOf(was, i + 1) >= 0) return null;
  return text.slice(0, i) + now + text.slice(i + was.length);
}

/**
 * Splits corrected values into misreads and rule gaps. A correction is written back into the printed text it was read
 * from; when the text then reads as the corrected value and nothing else changes, the model misread it, and the
 * corrected text is what the reader learns from. Anything else (a converted unit, a date or port written differently,
 * a value made from several places) is listed for the rules instead, so the reader is not taught a rule's mistake.
 */
export function learnable(answer: Page[], fixes: Fixes): { answer: Page[]; learned: string[]; review: RuleReview[] } {
  const out = structuredClone(answer), learned: string[] = [], review: RuleReview[] = [];
  const read = normalize(answer), target = applyFixes(read, fixes).doc;
  for (const key of Object.keys(fixes)) {
    const [part, a, b, field] = key.split(".");
    const before = normalize(out);
    let was: V | undefined, now: string | null | undefined, cells: { get: () => string | null; set: (x: string | null) => void }[] = [], numeric = false;
    let same: (n: NormDoc) => boolean = () => false;
    if (part === "header" || part === "totals") {
      const k = a!;
      was = part === "header" ? read.header[k] : read.totals[k];
      now = (part === "header" ? target.header[k] : target.totals[k])?.v;
      const pi = part === "header" ? (read.header[k]?.page ?? 0) - 1 : out.map((p) => !!p.totals[k as keyof Page["totals"]]?.v).lastIndexOf(true);
      const cell = pi < 0 ? null : (out[pi]![part] as Record<string, { v: string } | null>)[k];
      if (cell) cells = [{ get: () => cell.v, set: (x) => { cell.v = x ?? ""; } }];
      numeric = part === "totals" && NUMERIC_TOTAL(k);
      const pick = (n: NormDoc) => (part === "header" ? n.header : n.totals);
      same = (n) => pick(n)[k]?.v === now && Object.keys(pick(n)).every((x) => x === k || pick(n)[x]?.v === pick(before)[x]?.v);
    } else if (part === "rows" && field && !field.endsWith("_range")) {
      const page = Number(a), row = Number(b), p = out[page - 1];
      const rowOf = (n: NormDoc) => n.rows.find((r) => r.page === page && r.row === row);
      was = (rowOf(read) as unknown as Record<string, V> | undefined)?.[field];
      now = (rowOf(target) as unknown as Record<string, V> | undefined)?.[field]?.v;
      numeric = field in SOURCE;
      const r = p?.rows[row];
      if (r) cells = p!.columns.map((c, ci) => ({ c, ci })).filter(({ c }) => !numeric || c.field === SOURCE[field])
        .map(({ ci }) => ({ get: () => r.cells[ci] ?? null, set: (x) => { r.cells[ci] = x; } }));
      same = (n) => {
        const x = rowOf(n) as unknown as Record<string, V> | undefined, y = rowOf(before) as unknown as Record<string, V> | undefined;
        return !!x && !!y && x[field]?.v === now && Object.keys(x).every((k) => k === field || k === "box" || valueOf(x[k]) === valueOf(y[k]));
      };
    }
    // Exactly one printed place holds the value as read, and writing the correction there reads back as it.
    let ok = false;
    if (was?.v && now) {
      const places = cells.map((c) => ({ c, t: c.get() && swap(c.get()!, was!.v!, now!, numeric) })).filter((x) => x.t);
      if (places.length === 1) {
        const { c, t } = places[0]!, prev = c.get();
        c.set(t!);
        ok = same(normalize(out));
        if (!ok) c.set(prev);
      }
    }
    if (ok) learned.push(key);
    else review.push({ key, printed: was?.raw ?? null, read: was?.v ?? null, fixed: fixes[key] ?? null });
  }
  return { answer: out, learned, review };
}
