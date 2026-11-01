// Header class from page 1: the title words in code; a scanned page has no text, so Spark's doc_type stands in.
// shortcut: classes are document types only; sub-classes (e.g. pallet-grouped PL) are split off once approved documents show the need.
const TITLES: [RegExp, string][] = [
  [/PACKING\s*LIST|裝箱單|包裝明細/i, "PL"],
  [/SHIPPING\s*ORDER|託運單|BOOKING/i, "SO"],
  [/INVOICE|發票/i, "INV"],
];

export function headerClass(topText: string | null, modelDocType: string | null): string | null {
  const hit = topText ? TITLES.find(([re]) => re.test(topText)) : undefined;
  if (hit) return hit[1];
  return modelDocType === "PL" || modelDocType === "SO" ? modelDocType : null;
}
