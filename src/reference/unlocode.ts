// shortcut: a hand-picked list covering the synthetic set; replace with the pinned UNECE list
// (data/reference/unlocode.json) before real documents run in M3.
const PORTS: Record<string, string[]> = {
  TWKHH: ["KAOHSIUNG", "高雄"], TWTXG: ["TAICHUNG", "台中", "臺中"], TWKEL: ["KEELUNG", "基隆"], TWTPE: ["TAIPEI", "台北"],
  USLGB: ["LONG BEACH"], USLAX: ["LOS ANGELES"], USSAV: ["SAVANNAH"], USNYC: ["NEW YORK"],
  NLRTM: ["ROTTERDAM"], DEHAM: ["HAMBURG"], MYPEN: ["PENANG"], SGSIN: ["SINGAPORE"], CNSHA: ["SHANGHAI"],
};

const norm = (s: string) => s.normalize("NFKC").toUpperCase();

/** A printed port name or code -> UN/LOCODE, or null when no single port matches. */
export function lookupPort(raw: string): string | null {
  const s = norm(raw);
  const code = s.replace(/\s+/g, "").match(/^[A-Z]{5}$/)?.[0];
  if (code && PORTS[code]) return code;
  const hits = Object.entries(PORTS).filter(([, names]) => names.some((n) => s.includes(norm(n))));
  return hits.length === 1 ? hits[0]![0] : null;
}
