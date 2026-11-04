// The second system: Jev (TypeSafe's decision model, via OpenRouter) checks every value the first read produced
// against the page's own text layer, or against pictures of a scanned page. It answers yes/no per value with a
// probability; it never writes a value itself.
import type { PageInput } from "../pipeline/run.ts";
import { norm } from "../pipeline/grounding.ts";
import type { GridItem } from "../pipeline/text-serialize.ts";
import type { Page } from "../profiles/loop.ts";
import { fit, MAX_SIDE, pageScan, png } from "./page-image.ts";

export type Question = { type: "noul"; instructions: string };
export type DecisionsRequest = { state: unknown; questions: Record<string, Question> };
export type Decide = (req: DecisionsRequest) => Promise<{ answers: Record<string, { noul?: number }>; cost: number }>;

export const JEV_MODEL = "typesafe/jev-1.14";
/**
 * A value is verified at or above PASS; below WRONG Jev says it is wrong. On the four samples, seeded swaps and misreads
 * scored 0.00-0.09 and clean values 0.64-1.00 (2026-11-04), so the gap between the two is where a person looks.
 */
export const PASS = 0.75;
export const WRONG = 0.5;

export function jevClient(apiKey: string, model = JEV_MODEL): Decide {
  return async (req) => {
    const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, ...req }),
    });
    const body = (await res.json().catch(() => null)) as { answers?: Record<string, { noul?: number }>; usage?: { cost?: number }; error?: { message?: string } } | null;
    if (!res.ok || !body?.answers) throw new Error(`jev: ${body?.error?.message ?? `HTTP ${res.status}`}`);
    return { answers: body.answers, cost: body.usage?.cost ?? 0 };
  };
}

/** Per page: a probability per header/total value and per row cell (aligned with the page's columns), or null where nothing was asked. */
export type PageCheck = { page_no: number; checked: boolean; values: Record<string, number>; rows: (number | null)[][] };
export type Verification = { pages: PageCheck[]; checked: number; flagged: number; unchecked_pages: number; cost_usd: number; error?: string };

// Text items as one line each, top to bottom, with their left edge so columns can be told apart.
const lines = (items: GridItem[]) => {
  const sorted = [...items].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  const out: GridItem[][] = [];
  for (const it of sorted) {
    const last = out.at(-1);
    if (last && Math.abs(last[0]!.box[1] - it.box[1]) <= 3) last.push(it);
    else out.push([it]);
  }
  return out.map((l) => l.sort((a, b) => a.box[0] - b.box[0]).map((i) => `${i.text} @x${Math.round(i.box[0])}`).join(" | ")).join("\n");
};
const band = (items: GridItem[], y0: number, y1: number) => items.filter((i) => { const c = (i.box[1] + i.box[3]) / 2; return c >= y0 && c <= y1; });

// The printed header line of the table: the text items that spell the column labels, and everything on their lines.
function columnHeaders(items: GridItem[], p: Page, firstRowTop: number) {
  const want = new Set(p.columns.flatMap((c) => c.label.split("\n").map((l) => norm(l).replace(/\s+/g, ""))).filter(Boolean));
  const hits = items.filter((i) => i.box[3] <= firstRowTop + 1 && want.has(norm(i.text).replace(/\s+/g, "")));
  if (!hits.length) return null;
  return lines(band(items, Math.min(...hits.map((h) => h.box[1])) - 1, Math.max(...hits.map((h) => h.box[3])) + 1));
}

// Questions name what a value means, not "copy exactly": Jev scored clean rows 0.99 that way against 0.6-0.9 with the
// exact-copy wording, and still gave swapped or misread cells 0.01 (pl-1 probe, 2026-11-04).
const FIELD_NAMES: Record<string, string> = {
  pkg_range: "carton number range", pallet_range: "pallet number range", marks: "shipping marks", description: "goods description",
  part_no: "part number", lot_no: "lot number", hs_code: "HS code", po_no: "purchase order number", pkg_qty: "number of cartons",
  pkg_unit: "package unit", qty: "quantity", qty_unit: "quantity unit", qty_per_pkg: "quantity per carton", nw_kg: "net weight",
  gw_kg: "gross weight", nw_per_pkg_kg: "net weight per carton", gw_per_pkg_kg: "gross weight per carton", cbm: "volume",
};
const VALUE_NAMES: Record<string, string> = {
  doc_no: "document number", doc_date: "document date", booking_no: "booking number", shipper: "shipper (name and address lines)", consignee: "consignee (name and address lines)",
  notify: "notify party (name and address lines)", pol: "port of loading", pod: "port of discharge", etd: "departure date (ETD)", eta: "arrival date (ETA)",
  vessel: "vessel name", voyage: "voyage number", shipping_marks: "shipping marks", total_pkgs: "total number of packages",
  total_pallets: "total pallets", total_qty: "total quantity", total_gw_kg: "total gross weight", total_nw_kg: "total net weight",
  total_cbm: "total volume", total_gw_with_pallets_kg: "total gross weight including pallets", total_pkgs_in_words: "total packages in words",
};

async function pool<T>(jobs: (() => Promise<T>)[], n = 8): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i]!(); }
  }));
  return out;
}

const image = (url: string) => ({ type: "image_url", image_url: { url } });
// One scan decoded at a time: a 300 dpi A4 page is about 35 MB of RGBA, so parallel pages would multiply peak memory.
let decoding: Promise<unknown> = Promise.resolve();
const oneAtATime = <T>(f: () => Promise<T>): Promise<T> => { const r = decoding.then(f, f); decoding = r.catch(() => {}); return r; };
// The one-page PDF preparePages attached to a scanned page.
const pagePdf = (input: PageInput) => {
  const f = input.content.find((c) => c.type === "file");
  const b64 = f?.type === "file" ? f.file.file_data.split(",")[1] : undefined;
  return b64 ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) : null;
};

/**
 * A scanned page, the same questions on the page's picture instead of its text: header and totals in one request, and
 * one request per line item. A row is named by its place among the item rows and its other values, not cut out of the
 * picture: the first read's row boxes on scans were up to 60 page units off (0065-PK page 3, 2026-11-04).
 */
async function checkScan(ask: (r: DecisionsRequest) => Promise<Record<string, { noul?: number }> | null>, input: PageInput, p: Page, empty: PageCheck): Promise<PageCheck> {
  const pdf = pagePdf(input);
  const page = pdf && await oneAtATime(async () => { const s = await pageScan(pdf).catch(() => null); return s && png(fit(s, MAX_SIDE)); });
  if (!page) return empty;
  const items = p.rows.filter((r) => r.t === "item" || r.t === "ditto");

  const vals = [...Object.entries(p.header), ...Object.entries(p.totals)].filter(([, v]) => v?.v);
  const valueJob = async () => {
    if (!vals.length) return {};
    const questions = Object.fromEntries(vals.map(([k]) => [k, { type: "noul" as const, instructions: `extracted.${k} is the ${VALUE_NAMES[k] ?? k} printed on the scanned page; it may be only the part of the printed text that is the ${VALUE_NAMES[k] ?? k}.` }]));
    const a = await ask({ state: ["The scanned page:", image(page), { extracted: Object.fromEntries(vals.map(([k, v]) => [k, v!.v])) }], questions });
    return a ? Object.fromEntries(vals.map(([k]) => [k, a[k]?.noul ?? 0])) : {};
  };
  const rowJobs = p.rows.map((r) => async (): Promise<{ ok: boolean; cells: (number | null)[] }> => {
    const asked = r.t === "item" || r.t === "ditto" ? p.columns.map((_, ci) => ci).filter((ci) => (r.cells[ci] ?? "").trim() !== "") : [];
    if (!asked.length) return { ok: true, cells: r.cells.map(() => null) };
    const extracted = Object.fromEntries(asked.map((ci) => [`c${ci}`, { printed_column: p.columns[ci]!.label.replace(/\n/g, " "), value: r.cells[ci] }]));
    const n = items.indexOf(r) + 1;
    const row = { line_item: `${n} of ${items.length}, counting the table's line items from the top of this page`, first_lines: asked.map((ci) => (r.cells[ci] ?? "").split("\n")[0]).join(" | ") };
    const questions = Object.fromEntries(asked.map((ci) => {
      const c = p.columns[ci]!;
      return [`c${ci}`, { type: "noul" as const, instructions: `extracted.c${ci}.value is the ${FIELD_NAMES[c.field] ?? c.field} printed on the scanned page in the table line item described by row, under the column headed "${c.label.replace(/\n/g, " ")}".` }];
    }));
    const a = await ask({ state: ["The scanned page:", image(page), { row, extracted }], questions });
    return a ? { ok: true, cells: r.cells.map((_, ci) => (asked.includes(ci) ? a[`c${ci}`]?.noul ?? 0 : null)) } : { ok: false, cells: r.cells.map(() => null) };
  });
  const [values, rows] = await Promise.all([valueJob(), pool(rowJobs)]);
  return { page_no: input.page_no, checked: (!vals.length || Object.keys(values).length > 0) && rows.every((x) => x.ok), values, rows: rows.map((x) => x.cells) };
}

/**
 * One Jev request per table row and one per page for header and totals, on the text layer or, for a scanned page, on
 * pictures of it. A page Jev cannot see (no text layer and no scan image) and a failed request are left unchecked
 * rather than failing the upload; the caller sends them to a person.
 */
export async function verifyDocument(decide: Decide, pages: PageInput[], outputs: Page[]): Promise<Verification> {
  let cost = 0;
  let error: string | undefined;
  const ask = async (req: DecisionsRequest) => {
    try { const r = await decide(req); cost += r.cost; return r.answers; } catch (e) { error = (e as Error).message; return null; }
  };

  const checks = await Promise.all(outputs.map(async (p, pi): Promise<PageCheck> => {
    const input = pages[pi]!;
    const empty: PageCheck = { page_no: input.page_no, checked: false, values: {}, rows: p.rows.map((r) => r.cells.map(() => null)) };
    if (input.route === "vision") return checkScan(ask, input, p, empty);
    if (!input.items.length) return empty;
    const items = input.items;

    // Row boxes are typed loosely by the model schema; they are [x0, y0, x1, y1] in 0-1000 page units like the text items.
    const boxOf = (r: Page["rows"][number]) => r.box as number[] | null | undefined;
    const firstTop = Math.min(...p.rows.map((r) => boxOf(r)?.[1] ?? Infinity));
    const headers = columnHeaders(items, p, firstTop);

    // Header and totals: each value with its printed line(s), asked in one request. A totals line is a row of bare
    // numbers, so it goes with the table's column headers to tell net from gross weight.
    const vals = [...Object.entries(p.header), ...Object.entries(p.totals)].filter(([, v]) => v?.v && v.box && v.box[3] > v.box[1]);
    const valueJob = async () => {
      if (!vals.length) return {};
      const printed = Object.fromEntries(vals.map(([k, v]) => [k, lines(band(items, v!.box[1] - 3, v!.box[3] + 3))]));
      const extracted = Object.fromEntries(vals.map(([k, v]) => [k, v!.v]));
      const questions = Object.fromEntries(vals.map(([k]) => {
        const name = VALUE_NAMES[k] ?? k;
        const where = k.startsWith("total_") && headers ? ` The numbers on that line sit under the columns in printed.column_headers.` : "";
        return [k, { type: "noul" as const, instructions: `extracted.${k} is the ${name} printed in printed.${k}; it may be only the part of that printed text that is the ${name}.${where}` }];
      }));
      const a = await ask({ state: { printed: headers ? { ...printed, column_headers: headers } : printed, extracted }, questions });
      return a ? Object.fromEntries(vals.map(([k]) => [k, a[k]?.noul ?? 0])) : {};
    };

    // Only line items are asked; totals and subtotal lines are covered by the totals above and the sum checks.
    // Empty cells are not asked: Jev scores "nothing printed here" poorly, and a value missing from a row shows up in the sums.
    const rowJobs = p.rows.map((r) => async (): Promise<{ ok: boolean; cells: (number | null)[] }> => {
      const asked = r.t === "item" || r.t === "ditto" ? p.columns.map((_, ci) => ci).filter((ci) => (r.cells[ci] ?? "").trim() !== "") : [];
      if (!asked.length) return { ok: true, cells: r.cells.map(() => null) };
      const box = boxOf(r);
      if (!headers || !box || box[3]! <= box[1]!) return { ok: false, cells: r.cells.map(() => null) };
      const extracted = Object.fromEntries(asked.map((ci) => [`c${ci}`, { printed_column: p.columns[ci]!.label.replace(/\n/g, " "), value: r.cells[ci] }]));
      const questions = Object.fromEntries(asked.map((ci) => {
        const c = p.columns[ci]!;
        return [`c${ci}`, {
          type: "noul" as const,
          instructions: `extracted.c${ci}.value is the ${FIELD_NAMES[c.field] ?? c.field} printed in printed.row, taken from the column headed "${c.label.replace(/\n/g, " ")}" in printed.column_headers.`,
        }];
      }));
      const a = await ask({ state: { printed: { column_headers: headers, row: lines(band(items, box[1]! - 2, box[3]! + 2)) }, extracted }, questions });
      return a ? { ok: true, cells: r.cells.map((_, ci) => (asked.includes(ci) ? a[`c${ci}`]?.noul ?? 0 : null)) } : { ok: false, cells: r.cells.map(() => null) };
    });

    const [values, rows] = await Promise.all([valueJob(), pool(rowJobs)]);
    const valuesOk = !vals.length || Object.keys(values).length > 0;
    return { page_no: input.page_no, checked: valuesOk && rows.every((r) => r.ok), values, rows: rows.map((r) => r.cells) };
  }));

  const all = checks.flatMap((c) => [...Object.values(c.values), ...c.rows.flat().filter((x): x is number => x !== null)]);
  return {
    pages: checks, checked: all.length, flagged: all.filter((x) => x < PASS).length,
    unchecked_pages: checks.filter((c) => !c.checked).length,
    cost_usd: cost, ...(error ? { error } : {}),
  };
}
