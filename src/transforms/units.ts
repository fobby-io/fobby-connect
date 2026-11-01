import Decimal from "decimal.js";

// The built-in units table. Conversion only ever uses these factors; there is no free-form arithmetic.
const MASS: Record<string, string> = { KG: "1", KGS: "1", KGM: "1", G: "0.001", T: "1000", MT: "1000", TNE: "1000", LB: "0.45359237", LBS: "0.45359237" };
const VOLUME: Record<string, string> = { CBM: "1", M3: "1", MTQ: "1", CFT: "0.028316846592", FT3: "0.028316846592", L: "0.001" };

const tokenOf = (s: string) => s.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Unit token found in a printed label or cell, e.g. "G.W.(LBS)" -> "LBS"; null when none is known. */
export function unitIn(label: string): { kind: "mass" | "volume"; unit: string } | null {
  const words = label.normalize("NFKC").toUpperCase().split(/[^A-Z0-9³]+/).map((w) => w.replace("³", "3"));
  for (const w of words.reverse()) {
    if (MASS[w]) return { kind: "mass", unit: w };
    if (VOLUME[w]) return { kind: "volume", unit: w };
  }
  return null;
}

/** Converts to KG or CBM. Returns null for an unknown unit, so the field goes to review instead of guessing. */
export function toBase(value: string, unit: string): string | null {
  const u = tokenOf(unit);
  const f = MASS[u] ?? VOLUME[u];
  return f ? new Decimal(value).mul(f).toString() : null;
}
