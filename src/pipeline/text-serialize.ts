import type { Box } from "../shared/model-output.ts";
import type { PdfPage } from "./pdf.ts";

export const TEXT_FORMAT = "textfmt.1";

export type GridItem = { id: number; box: Box; text: string };

/** Apply a PDF page rotation to a point in user space, returning top-left-origin coordinates. */
function toTopLeft(x: number, y: number, page: PdfPage["view"]): [number, number] {
  const [bx0, by0, bx1, by1] = page.viewBox as [number, number, number, number];
  const w = bx1 - bx0, h = by1 - by0;
  const u = x - bx0, v = y - by0;
  switch (((page.rotation % 360) + 360) % 360) {
    case 90: return [v, u];
    case 180: return [w - u, v];
    case 270: return [h - v, w - u];
    default: return [u, h - v];
  }
}

const grid = (n: number, d: number) => Math.min(1000, Math.max(0, Math.round((n / d) * 1000)));

/**
 * pdf.js text items -> 0-1000 grid, origin top left: the frame the model's boxes use, and the
 * items grounding compares against. Empty items are dropped; ids follow reading order.
 */
export function gridItems(page: PdfPage): GridItem[] {
  const out = page.items
    .filter((i) => i.str.trim() !== "")
    .map((i) => {
      const [a, b, c, d, e, f] = i.transform as [number, number, number, number, number, number];
      const fontH = Math.hypot(c, d) || i.height;
      // Corners of the run in user space: baseline start, run end, and the top of the glyphs.
      const ux = Math.hypot(a, b) ? a / Math.hypot(a, b) : 1, uy = Math.hypot(a, b) ? b / Math.hypot(a, b) : 0;
      const corners = [
        [e, f], [e + ux * i.width, f + uy * i.width],
        [e - uy * fontH, f + ux * fontH], [e + ux * i.width - uy * fontH, f + uy * i.width + ux * fontH],
      ].map(([x, y]) => toTopLeft(x!, y!, page.view));
      const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
      const box: Box = [
        grid(Math.min(...xs), page.view.width), grid(Math.min(...ys), page.view.height),
        grid(Math.max(...xs), page.view.width), grid(Math.max(...ys), page.view.height),
      ];
      return { box, text: i.str.replace(/\s+/g, " ").trim() };
    })
    .sort((p, q) => p.box[1] - q.box[1] || p.box[0] - q.box[0]);
  // Group into lines (tops within 3 units of the line's first item), then left to right.
  const lines: (typeof out)[] = [];
  for (const it of out) {
    const line = lines.at(-1);
    if (line && it.box[1] - line[0]!.box[1] <= 3) line.push(it);
    else lines.push([it]);
  }
  return lines.flatMap((l) => l.sort((p, q) => p.box[0] - q.box[0])).map((it, id) => ({ id, ...it }));
}

/** One line per item: `id x0 y0 x1 y1|text`. */
export function serialize(items: GridItem[]): string {
  return [TEXT_FORMAT, ...items.map((i) => `${i.id} ${i.box.join(" ")}|${i.text}`)].join("\n");
}
