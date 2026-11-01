const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
};

const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};

/** A year below 1911 with three digits or fewer is a ROC year (民國): 115 -> 2026. */
const year = (y: number, roc: boolean) => (roc || y < 1000 ? y + 1911 : y);

export type DateParams = { roc?: boolean; order?: "mdy" | "dmy" };

/**
 * Dates in the known printed formats, returning YYYY-MM-DD or null:
 * 2026-10-30, 2026/10/30, 115/10/30, 115年10月30日, OCT. 30, 2026, 30-OCT-2026, 30 OCT 2026,
 * and 10/30/2026 or 30/10/2026 by `order` (default mdy).
 */
export function parseDate(raw: string, p: DateParams = {}): string | null {
  const s = raw.normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();
  let m = s.match(/(\d{2,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return iso(year(+m[1]!, !!p.roc), +m[2]!, +m[3]!);
  m = s.match(/\b(\d{2,4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m && m[1]!.length !== 2) return iso(year(+m[1]!, !!p.roc), +m[2]!, +m[3]!);
  m = s.match(/\b([A-Z]{3,4})\.?\s*(\d{1,2}),?\s*(\d{4})\b/);
  if (m && MONTHS[m[1]!]) return iso(+m[3]!, MONTHS[m[1]!]!, +m[2]!);
  m = s.match(/\b(\d{1,2})[-\s]([A-Z]{3,4})\.?[-\s,]*(\d{4})\b/);
  if (m && MONTHS[m[2]!]) return iso(+m[3]!, MONTHS[m[2]!]!, +m[1]!);
  m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (m) return p.order === "dmy" ? iso(+m[3]!, +m[2]!, +m[1]!) : iso(+m[3]!, +m[1]!, +m[2]!);
  return null;
}
