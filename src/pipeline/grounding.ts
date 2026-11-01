import type { Box } from "../shared/model-output.ts";
import type { GridItem } from "./text-serialize.ts";

// Grounding decides which values a person must look at. The search region is narrow on purpose:
// counts repeat down a packing list, so only a second match inside the same cell makes a value ambiguous.

export type GroundState = "matched" | "ambiguous" | "matched_untrusted" | "template" | "contradicted" | "no_text";

export const GROUNDING = {
  /** grounding.box_margin: header boxes are widened by 2% of the page. */
  box_margin: 20,
  /** Vertical slack around a row box, in grid units. */
  row_margin: 3,
  /** A table cell without a column x-range needs this many significant characters to be matched. */
  min_significant: 3,
};

export const norm = (s: string) => s.normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();

const center = (b: Box) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] as const;
const inside = (b: Box, r: Box) => {
  const [x, y] = center(b);
  return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
};

/** Items in a region joined into lines, so a value printed as two runs still matches. */
function regionLines(items: GridItem[], region: Box) {
  const lines: GridItem[][] = [];
  for (const it of items.filter((i) => inside(i.box, region))) {
    const line = lines.find((l) => Math.abs(l[0]!.box[1] - it.box[1]) <= 3);
    if (line) line.push(it);
    else lines.push([it]);
  }
  return lines.map((l) => norm(l.sort((a, b) => a.box[0] - b.box[0]).map((i) => i.text).join(" ")));
}

/** Whole-token occurrences: bounded by the line's ends or whitespace. */
function countTokens(line: string, v: string) {
  let n = 0;
  for (let at = line.indexOf(v); at >= 0; at = line.indexOf(v, at + 1)) {
    const before = at === 0 || line[at - 1] === " ";
    const after = at + v.length === line.length || line[at + v.length] === " ";
    if (before && after) n++;
  }
  return n;
}

function inRegion(v: string, items: GridItem[], region: Box, untrusted: boolean): GroundState {
  const want = norm(v);
  const lines = regionLines(items, region);
  const hits = lines.reduce((s, l) => s + countTokens(l, want), 0);
  if (hits === 0) return "contradicted";
  if (hits > 1) return "ambiguous";
  return untrusted ? "matched_untrusted" : "matched";
}

export type GroundOpts = { route: "text" | "hybrid" | "vision" };

export function groundHeader(v: string, box: Box, items: GridItem[], o: GroundOpts): GroundState {
  if (o.route === "vision") return "no_text";
  const m = GROUNDING.box_margin;
  const region: Box = [box[0] - m, box[1] - m, box[2] + m, box[3] + m];
  // A party is printed over several lines: each line must match once; the worst line decides.
  const states = v.split(/\r?\n/).filter((l) => l.trim()).map((l) => inRegion(l, items, region, o.route === "hybrid"));
  return (["contradicted", "ambiguous", "matched_untrusted", "matched"] as const).find((s) => states.includes(s)) ?? "contradicted";
}

export function groundCell(v: string, rowBox: Box, xRange: readonly [number, number] | null, items: GridItem[], o: GroundOpts): GroundState {
  if (o.route === "vision") return "no_text";
  const m = GROUNDING.row_margin;
  if (!xRange && norm(v).replace(/[^\p{L}\p{N}]/gu, "").length < GROUNDING.min_significant) return "ambiguous";
  const [x0, x1] = xRange ?? [rowBox[0], rowBox[2]];
  return inRegion(v, items, [x0, rowBox[1] - m, x1, rowBox[3] + m], o.route === "hybrid");
}

/**
 * item_ids variant: matched only when the cited items' joined text equals v, every cited item lies in the
 * region, and no other item in the region also matches. Citing the right text from the wrong column fails.
 */
export function groundIds(v: string, ids: number[], region: Box, items: GridItem[], o: GroundOpts): GroundState {
  if (o.route === "vision") return "no_text";
  const cited = ids.map((id) => items[id]).filter((i): i is GridItem => !!i);
  if (cited.length !== ids.length || cited.length === 0) return "contradicted";
  if (norm(cited.map((i) => i.text).join(" ")) !== norm(v) || !cited.every((i) => inside(i.box, region))) return "contradicted";
  const others = items.filter((i) => !ids.includes(i.id) && inside(i.box, region));
  if (others.some((i) => countTokens(norm(i.text), norm(v)) > 0)) return "ambiguous";
  return o.route === "hybrid" ? "matched_untrusted" : "matched";
}

/** Union box of cited items: the row box for the item_ids variant. */
export const unionBox = (items: GridItem[]): Box => [
  Math.min(...items.map((i) => i.box[0])), Math.min(...items.map((i) => i.box[1])),
  Math.max(...items.map((i) => i.box[2])), Math.max(...items.map((i) => i.box[3])),
];

/**
 * Column x-ranges from the printed header labels: find the line holding the most labels, then split the
 * page at midpoints between neighbouring labels. Fields whose label is not found get null.
 */
export function columnRanges(columns: { field: string; label: string }[], items: GridItem[]): ([number, number] | null)[] {
  const found = columns.map((c) => items.filter((i) => norm(i.text) === norm(c.label)));
  const near = (t: number) => found.filter((cands) => cands.some((i) => Math.abs(i.box[1] - t) <= 3)).length;
  const headerTop = found.flat().map((i) => i.box[1]).sort((a, b) => near(b) - near(a))[0];
  if (headerTop === undefined) return columns.map(() => null);
  const labels = found.map((cands) => cands.find((i) => Math.abs(i.box[1] - headerTop) <= 3) ?? null);
  const placed = labels.map((l, k) => ({ l, k })).filter((p) => p.l).sort((a, b) => a.l!.box[0] - b.l!.box[0]);
  const ranges: ([number, number] | null)[] = columns.map(() => null);
  placed.forEach((p, j) => {
    const prev = placed[j - 1]?.l, next = placed[j + 1]?.l;
    const x0 = prev ? (prev.box[2] + p.l!.box[0]) / 2 : 0;
    const x1 = next ? (p.l!.box[2] + next.box[0]) / 2 : 1000;
    ranges[p.k] = [x0, x1];
  });
  return ranges;
}
