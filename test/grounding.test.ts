import { describe, expect, it } from "vitest";
import { columnRanges, groundCell, groundHeader, groundIds } from "../src/pipeline/grounding.ts";
import type { GridItem } from "../src/pipeline/text-serialize.ts";

let id = 0;
const it_ = (text: string, x0: number, y0: number, x1: number, y1 = y0 + 10): GridItem => ({ id: id++, text, box: [x0, y0, x1, y1] });

// A packing list fragment: CTNS and PLT columns hold short numbers that repeat down the page.
const items = [
  it_("PLT NO: 1-3", 50, 40, 160),
  it_("INVOICE NO.:", 600, 40, 690), it_("PL2026001", 700, 40, 790),
  it_("DESCRIPTION", 100, 100, 200), it_("CTNS", 520, 100, 560), it_("PLT", 640, 100, 670), it_("G.W.(KGS)", 760, 100, 840),
  it_("HEX BOLT", 100, 120, 170), it_("12", 545, 120, 560), it_("1", 660, 120, 670), it_("1,234.50", 790, 120, 840),
  it_("NUT M8", 100, 140, 150), it_("12", 545, 140, 560), it_("2", 660, 140, 670), it_("402.25", 800, 140, 840),
  it_("WASHER 12 12", 100, 160, 200), it_("4", 552, 160, 560), it_("1", 660, 160, 670), it_("88.00", 805, 160, 840),
];
items.forEach((x, k) => (x.id = k));
const text = { route: "text" } as const;
const cols = columnRanges(
  [{ field: "description", label: "DESCRIPTION" }, { field: "pkg_qty", label: "CTNS" }, { field: "pallets", label: "PLT" }, { field: "gw_kg", label: "G.W.(KGS)" }],
  items,
);
const row = (y: number) => [0, y, 1000, y + 10] as [number, number, number, number];

describe("grounding", () => {
  it("finds column ranges from the header labels", () => {
    expect(cols.every((c) => c !== null)).toBe(true);
    expect(cols[1]![0]).toBeLessThan(545);
    expect(cols[1]![1]).toBeGreaterThan(560);
    expect(cols[1]![1]).toBeLessThan(640);
  });

  it("matches a short number that repeats down its column, inside its own cell", () => {
    expect(groundCell("12", row(120), cols[1]!, items, text)).toBe("matched");
    expect(groundCell("12", row(140), cols[1]!, items, text)).toBe("matched");
  });

  it("does not match a count read from the neighbouring column of the same row", () => {
    // Row 3's CTNS is 4; "1" is the pallet column's value.
    expect(groundCell("1", row(160), cols[1]!, items, text)).toBe("contradicted");
  });

  it("is ambiguous when the cell region holds two matches", () => {
    expect(groundCell("12", row(160), cols[0]!, items, text)).toBe("ambiguous");
  });

  it("treats a short value with no column range as ambiguous", () => {
    expect(groundCell("12", row(120), null, items, text)).toBe("ambiguous");
  });

  it("matches header values by whole token only", () => {
    expect(groundHeader("PL2026001", [700, 40, 790, 50], items, text)).toBe("matched");
    // `PLT NO: 1-3` read as 1 must not match.
    expect(groundHeader("1", [50, 40, 160, 50], items, text)).toBe("contradicted");
  });

  it("grounds a multi-line party line by line", () => {
    const party = [it_("ACME CORP.", 50, 300, 150), it_("1 MAIN ST", 50, 312, 140)];
    party.forEach((p, k) => (p.id = 100 + k));
    expect(groundHeader("ACME CORP.\n1 MAIN ST", [50, 300, 150, 322], party, text)).toBe("matched");
    expect(groundHeader("ACME CORP.\n9 MAIN ST", [50, 300, 150, 322], party, text)).toBe("contradicted");
  });

  it("marks hybrid matches untrusted and vision values as no_text", () => {
    expect(groundHeader("PL2026001", [700, 40, 790, 50], items, { route: "hybrid" })).toBe("matched_untrusted");
    expect(groundHeader("PL2026001", [700, 40, 790, 50], items, { route: "vision" })).toBe("no_text");
  });

  it("item_ids: the right text cited from the wrong column is not matched", () => {
    const ctnsCell: [number, number, number, number] = [cols[1]![0], 157, cols[1]![1], 173];
    const pltOne = items.find((i) => i.text === "1" && i.box[1] === 160)!;
    const ctnsFour = items.find((i) => i.text === "4")!;
    expect(groundIds("4", [ctnsFour.id], ctnsCell, items, text)).toBe("matched");
    expect(groundIds("1", [pltOne.id], ctnsCell, items, text)).toBe("contradicted");
    expect(groundIds("4", [999], ctnsCell, items, text)).toBe("contradicted");
  });
});
