// A scanned page as an image Jev can read: the page's embedded scan, in grey, scaled to Jev's limits and encoded as PNG.
// No canvas or native module, so it runs on any JS runtime: pixels are handled here and PNG is written with CompressionStream.
import { extractImages, getDocumentProxy } from "unpdf";

/** Grey pixels, one byte each, row by row from the top. */
export type Gray = { w: number; h: number; px: Uint8Array };

// Jev's limits (OpenRouter multimodal decisions guide, 2026-11-04): 256 to 1568 px a side, 78,400 to 2,458,624 px in all.
export const MIN_SIDE = 256, MAX_SIDE = 1568;

/** The largest image on a one-page PDF in grey, or null when there is none big enough for Jev (a vector page without a text layer). */
export async function pageScan(pdf: Uint8Array): Promise<Gray | null> {
  const doc = await getDocumentProxy(pdf);
  const imgs = await extractImages(doc, 1);
  const big = imgs.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!big || big.width < MIN_SIDE || big.height < MIN_SIDE) return null;
  // shortcut: page /Rotate is not applied; a scan stored sideways is checked sideways and its values fail to a person.
  const px = new Uint8Array(big.width * big.height);
  for (let i = 0, j = 0; i < px.length; i++, j += 4) px[i] = (big.data[j]! * 299 + big.data[j + 1]! * 587 + big.data[j + 2]! * 114) / 1000;
  return { w: big.width, h: big.height, px };
}

/** Area-average downscale so neither side exceeds max (never upscales). */
export function fit(g: Gray, maxW: number, maxH = maxW): Gray {
  const s = Math.min(1, maxW / g.w, maxH / g.h);
  if (s === 1) return g;
  const w = Math.max(1, Math.round(g.w * s)), h = Math.max(1, Math.round(g.h * s));
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y / s), sy1 = Math.min(g.h, Math.max(sy0 + 1, Math.floor((y + 1) / s)));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x / s), sx1 = Math.min(g.w, Math.max(sx0 + 1, Math.floor((x + 1) / s)));
      let sum = 0;
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) sum += g.px[yy * g.w + xx]!;
      px[y * w + x] = sum / ((sy1 - sy0) * (sx1 - sx0));
    }
  }
  return { w, h, px };
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b: Uint8Array) => { let c = ~0; for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8); return ~c >>> 0; };

async function deflate(b: Uint8Array): Promise<Uint8Array> {
  const out = new Response(new Response(b.slice()).body!.pipeThrough(new CompressionStream("deflate")));
  return new Uint8Array(await out.arrayBuffer());
}

/** An 8-bit greyscale PNG as a data URL. */
export async function png(g: Gray): Promise<string> {
  const raw = new Uint8Array((g.w + 1) * g.h);
  for (let y = 0; y < g.h; y++) raw.set(g.px.subarray(y * g.w, (y + 1) * g.w), y * (g.w + 1) + 1);
  const chunk = (type: string, data: Uint8Array) => {
    const c = new Uint8Array(12 + data.length), v = new DataView(c.buffer);
    v.setUint32(0, data.length);
    c.set(new TextEncoder().encode(type), 4);
    c.set(data, 8);
    v.setUint32(8 + data.length, crc32(c.subarray(4, 8 + data.length)));
    return c;
  };
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, g.w); v.setUint32(4, g.h); ihdr.set([8, 0, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array())];
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(s)}`;
}
