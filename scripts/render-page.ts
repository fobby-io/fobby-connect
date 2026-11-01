// Renders one PDF page to PNG for a visual check: npx tsx scripts/render-page.ts <pdf> <png> [page]
import { readFileSync, writeFileSync } from "node:fs";
import { renderPageAsImage } from "unpdf";
const [src, out] = process.argv.slice(2);
const png = await renderPageAsImage(new Uint8Array(readFileSync(src!)), Number(process.argv[4] ?? 1), { canvasImport: () => import("@napi-rs/canvas"), scale: 1.5 });
writeFileSync(out!, Buffer.from(png));
