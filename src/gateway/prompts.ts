import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { LineField } from "../shared/fields.ts";

const TEMPLATE = readFileSync(new URL("./prompts/extract-page.v1.md", import.meta.url), "utf8");

/** Hash of the unfilled template; part of the cache key. */
export const PROMPT_TEMPLATE_HASH = createHash("sha256").update(TEMPLATE).digest("hex").slice(0, 16);

// Generic profile for an unknown sender: no examples or notes, the schema's field descriptions as headers.
export const FIELD_DESCRIPTIONS: Record<LineField, string> = {
  pkg_range: "package or carton number range of the row, such as 1-12",
  marks: "shipping marks",
  description: "goods description",
  part_no: "part, item or model number",
  lot_no: "lot or batch number",
  hs_code: "HS tariff code",
  po_no: "purchase order number",
  pkg_qty: "number of packages or cartons",
  pkg_unit: "package unit such as CTNS or PLTS, when printed in its own column",
  qty: "quantity of goods",
  qty_unit: "quantity unit such as PCS or SETS, when printed in its own column",
  qty_per_pkg: "quantity per package",
  nw_kg: "net weight of the row",
  gw_kg: "gross weight of the row",
  nw_per_pkg_kg: "net weight per package",
  gw_per_pkg_kg: "gross weight per package",
  cbm: "volume or measurement of the row",
};

export type ProfilePrompt = { columns?: { field: LineField; label: string }[]; prompt_notes?: string[] };

function profilePart(p: ProfilePrompt): string {
  if (!p.columns?.length) {
    return ["Line-item fields:", ...Object.entries(FIELD_DESCRIPTIONS).map(([f, d]) => `- ${f}: ${d}`)].join("\n");
  }
  return [
    "This sender's layout. Table columns as printed, and the field each one maps to:",
    ...p.columns.map((c) => `- "${c.label}" -> ${c.field}`),
    ...(p.prompt_notes?.length ? ["Notes:", ...p.prompt_notes.map((n) => `- ${n}`)] : []),
  ].join("\n");
}

/** The cached prefix: instructions, then the profile part, then examples. Page content goes last, separately. */
export function extractInstructions(profile: ProfilePrompt, examples: string[] = []): string {
  return TEMPLATE.replace("{{profile}}", profilePart(profile))
    .replace("{{examples}}", examples.length ? `Examples from this layout:\n\n${examples.join("\n\n")}` : "")
    .trimEnd();
}

/** Page text is quoted data in a fixed field, never part of the instructions. */
export function textPageMessage(pageNo: number, pageCount: number, textfmt: string): string {
  return `Page ${pageNo} of ${pageCount}. Text items, one per line: id x0 y0 x1 y1|text\n<page_text>\n${textfmt}\n</page_text>`;
}
