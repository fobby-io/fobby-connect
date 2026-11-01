import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { readPdf } from "../src/pipeline/pdf.ts";
import { gridItems, serialize } from "../src/pipeline/text-serialize.ts";

async function pdf(rotate = 0) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  page.setRotation(degrees(rotate));
  // Top-left of "TOP" at (60, 80) from the top; "RIGHT" on the same line further right.
  page.drawText("RIGHT", { x: 300, y: 800 - 80 - 10, size: 10, font });
  page.drawText("TOP", { x: 60, y: 800 - 80 - 10, size: 10, font });
  page.drawText("   ", { x: 60, y: 400, size: 10, font });
  page.drawText("BOTTOM", { x: 60, y: 40, size: 10, font });
  return doc.save();
}

describe("textfmt.1", () => {
  it("converts to the top-left 0-1000 grid in reading order and drops blank items", async () => {
    const [page] = await readPdf(await pdf());
    const items = gridItems(page!);
    expect(items.map((i) => i.text)).toEqual(["TOP", "RIGHT", "BOTTOM"]);
    expect(items[0]!.box[0]).toBe(100); // 60 / 600
    expect(items[0]!.box[3]).toBe(113); // baseline at 90 pt from the top / 800
    expect(items[0]!.box[1]).toBe(100); // glyph top at 80 pt / 800
    expect(items[2]!.box[1]).toBeGreaterThan(930);
    expect(serialize(items).split("\n")[1]).toMatch(/^0 100 100 \d+ 113\|TOP$/);
  });

  it("applies page rotation so boxes stay in the displayed frame", async () => {
    const [page] = await readPdf(await pdf(90));
    const top = gridItems(page!).find((i) => i.text === "TOP")!;
    // Rotated 90 degrees clockwise: the text's top-left corner moves to the right edge, near the top.
    expect(top.box[0]).toBeGreaterThan(850);
    expect(top.box[1]).toBe(100);
  });

  it("gives the same content hash for the same page in different files", async () => {
    const a = await readPdf(await pdf());
    const doc = await PDFDocument.load(await pdf());
    doc.setTitle("another file");
    const b = await readPdf(await doc.save());
    expect(a[0]!.content_hash).toBe(b[0]!.content_hash);
  });
});
