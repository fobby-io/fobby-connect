// What the clerk changed against the model's read, and the failed checks in plain words. Moved from the old web/index.html unchanged.
import type { Finding } from "../../src/rules/checks.ts";
import type { ModelOutput } from "../../src/shared/model-output.ts";
import { CHECK_COL, HEAD, SUM_NAME } from "./labels.ts";

export type Page = ModelOutput<"compact">;
export type { Finding };

export const fmt = (x: string | null | undefined) =>
  x == null ? "" : /^-?\d+(\.\d+)?$/.test(x) ? Number(x).toLocaleString("en-US", { maximumFractionDigits: 3 }) : x;

// Columns are matched by printed label, so a column added in review does not shift the ones after it.
export const origCol = (orig: Page[], answer: Page[], pi: number, ci: number) =>
  orig[pi]!.columns.findIndex((c) => c.label === answer[pi]!.columns[ci]!.label);
export const origCell = (orig: Page[], answer: Page[], pi: number, ri: number, ci: number) => {
  const oc = origCol(orig, answer, pi, ci);
  return oc < 0 ? null : orig[pi]!.rows[ri]?.cells[oc] ?? null;
};
export const colChanged = (orig: Page[], answer: Page[], pi: number, ci: number) => {
  const oc = origCol(orig, answer, pi, ci);
  return oc < 0 || orig[pi]!.columns[oc]!.field !== answer[pi]!.columns[ci]!.field;
};
export const rowChanged = (orig: Page[], answer: Page[], pi: number, ri: number) =>
  answer[pi]!.rows[ri]!.cells.some((v, ci) => (v || null) !== origCell(orig, answer, pi, ri, ci));

export function edits(orig: Page[], answer: Page[]) {
  let n = 0;
  answer.forEach((p, pi) => {
    p.rows.forEach((r, ri) => r.cells.forEach((v, ci) => { if ((v || null) !== origCell(orig, answer, pi, ri, ci)) n++; }));
    p.columns.forEach((_, ci) => { if (colChanged(orig, answer, pi, ci)) n++; });
    for (const part of ["header", "totals"] as const)
      Object.entries(p[part]).forEach(([k, v]) => { if ((v?.v || null) !== (orig[pi]![part][k]?.v ?? null)) n++; });
  });
  return n;
}

export type Problem = { text: string; col: string | undefined; key: string; pages: number[] };

export function problems(findings: Finding[]): Problem[] {
  // The server lists a failed check once per page it involves; show it once.
  return [...Map.groupBy(findings, (f) => f.message)].map(([msg, list]) => {
    const key = list[0]!.path.split(".")[1]!.replace(/\[\d+\]/, "");
    let m: RegExpMatchArray | null, text = msg;
    if ((m = msg.match(/^rows add up to ([\d.]+) (\w+), the totals line says (.+)$/))) text = `${SUM_NAME[m[2]!] ?? m[2]}對不上：每列加起來是 ${fmt(m[1])}，合計列印的是 ${m[3]}`;
    else if ((m = msg.match(/^PO in the shipping marks but in no row: (.+)$/))) text = `嘜頭上列了 PO ${m[1]}，但明細裡沒有`;
    else if ((m = msg.match(/^PO in the rows but not in the shipping marks: (.+)$/))) text = `明細裡的 PO ${m[1]} 沒有出現在嘜頭上`;
    else if ((m = msg.match(/^(\w+) differs between pages: page (\d+) has (.+), page (\d+) has (.+)$/))) text = `${HEAD[m[1]!] ?? m[1]}前後不一致：第 ${m[2]} 頁是 ${m[3]}，第 ${m[4]} 頁是 ${m[5]}`;
    else if ((m = msg.match(/^container number (\S+) fails/))) text = `貨櫃號碼 ${m[1]} 的檢查碼不對`;
    return { text, col: CHECK_COL[key], key, pages: list.map((x) => x.page).sort() };
  });
}
