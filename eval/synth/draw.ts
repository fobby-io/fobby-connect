import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { type PDFDocument, type PDFFont, type PDFPage, StandardFonts } from "pdf-lib";

// Static subset of Noto Sans TC (OFL, see fonts/OFL.txt); rebuild with scripts/build-cjk-font.sh.
const CJK_FONT = new URL("./fonts/NotoSansTC-subset.ttf", import.meta.url);

export type Fonts = { regular: PDFFont; bold: PDFFont; cjk?: PDFFont };

export async function loadFonts(doc: PDFDocument, cjk = false): Promise<Fonts> {
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  if (!cjk) return { regular, bold };
  doc.registerFontkit(fontkit);
  return { regular, bold, cjk: await doc.embedFont(readFileSync(CJK_FONT), { subset: true }) };
}

export const A4 = { w: 595, h: 842 };

/** Draw with a top-left origin, matching the 0-1000 grid the model uses. */
export function text(
  page: PDFPage, s: string, x: number, top: number,
  o: { font: PDFFont; size?: number; align?: "left" | "right" | "center" },
) {
  const size = o.size ?? 9;
  const w = o.font.widthOfTextAtSize(s, size);
  const left = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
  page.drawText(s, { x: left, y: page.getHeight() - top - size, size, font: o.font });
}

export function hline(page: PDFPage, x0: number, x1: number, top: number, thickness = 0.6) {
  const y = page.getHeight() - top;
  page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness });
}
