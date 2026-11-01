import { createHash } from "node:crypto";
import { getDocumentProxy } from "unpdf";

export type TextItem = { str: string; transform: number[]; width: number; height: number; fontName: string };
export type PdfPage = {
  page_no: number;
  /** Viewport after the page's rotation, in PDF points. */
  view: { width: number; height: number; rotation: number; viewBox: number[] };
  items: TextItem[];
  /** Hash of the sorted text items; independent of the file's bytes, so the same page in two files matches. */
  content_hash: string;
};

export class PdfError extends Error {
  constructor(readonly reason: "encrypted" | "unreadable", message: string) {
    super(message);
  }
}

// Text only: getOperatorList() decodes every image (pdf.js evaluator), so image coverage and
// invisible-text counts are measured separately in M1 before the router uses them.
export async function readPdf(bytes: Uint8Array): Promise<PdfPage[]> {
  let doc;
  try {
    doc = await getDocumentProxy(bytes.slice());
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    throw new PdfError(/password/i.test(msg) ? "encrypted" : "unreadable", msg);
  }
  const pages: PdfPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: TextItem[] = content.items.flatMap((i) =>
      "transform" in i ? [{ str: i.str, transform: i.transform as number[], width: i.width, height: i.height, fontName: i.fontName }] : []);
    const sorted = items.map((i) => `${i.transform.map((t) => t.toFixed(2)).join(",")}|${i.str}`).sort();
    pages.push({
      page_no: n,
      view: { width: vp.width, height: vp.height, rotation: vp.rotation, viewBox: [...page.view] },
      items,
      content_hash: createHash("sha256").update(sorted.join("\n")).digest("hex"),
    });
  }
  return pages;
}
