import Decimal from "decimal.js";

export type NumberParams = { decimal?: "." | ","; thousands?: "," | "." | " " | "'" };

/**
 * Locale-aware number parsing, ignoring a leading `@` and trailing unit text: `1.254,50` -> "1254.5"
 * with decimal ",". Returns a canonical decimal.js string, or null when there is no number.
 */
export function parseNumber(raw: string, p: NumberParams = {}): string | null {
  const dec = p.decimal ?? ".";
  const thousands = p.thousands ?? (dec === "." ? "," : ".");
  const m = raw.normalize("NFKC").replace(/^\s*@\s*/, "").match(/[-+]?\d[\d.,' ]*/);
  if (!m) return null;
  let s = m[0].trim().split(thousands).join("");
  if (dec === ",") s = s.replace(",", ".");
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
  return new Decimal(s).toString();
}
