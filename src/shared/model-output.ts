import { z } from "zod";
import { HEADER_KEYS, LINE_FIELDS, PROTECTED_ROW_FIELDS, ROW_TYPES, TOTALS_KEYS } from "./fields.ts";

// What extractPage returns, sent as response_format. Kept small: output tokens are the largest model cost.
// The Meta API needs every key in `required`, so optional values are unions with null.

export const VARIANTS = ["compact", "per_field", "cell_box", "item_ids"] as const;
export type Variant = (typeof VARIANTS)[number];

// Muse Spark can report 1001 and the like (dev.meta.ai image-understanding), so clamp instead of rejecting.
// A plain length-4 array: the docs do not say whether tuple `items` arrays are accepted.
const clamp = (n: number) => Math.min(1000, Math.max(0, Math.round(n)));
export const Box = z
  .array(z.number())
  .length(4)
  .transform((a) => a.map(clamp) as [number, number, number, number]);
export type Box = z.output<typeof Box>;

const boxVal = z.object({ v: z.string(), box: Box });
const idsVal = z.object({ v: z.string(), ids: z.array(z.number().int().min(0)) });

function keyed<T extends z.ZodType>(keys: readonly string[], val: T) {
  return z.object(Object.fromEntries(keys.map((k) => [k, val.nullable()])) as Record<string, z.ZodNullable<T>>);
}

function build<V extends z.ZodType, C extends z.ZodType>(val: V, cell: C, rowExtra: z.ZodRawShape, withBox: boolean) {
  const rowBox = withBox ? { box: Box } : {};
  return z
    .object({
      doc_type: z.enum(["SO", "PL", "other"]).nullable(),
      issuer: z.string().nullable(),
      header: keyed(HEADER_KEYS, val),
      containers: z.array(keyed(["number", "iso_type", "seal", "qty"], val)),
      columns: z.array(z.object({ field: z.enum(LINE_FIELDS), label: z.string() })),
      rows: z.array(
        z.object({
          t: z.enum(ROW_TYPES),
          cont: z.boolean(),
          g: z.string().nullable(),
          cells: z.array(cell.nullable()),
          ...rowBox,
          ...rowExtra,
        }),
      ),
      groups: z.array(
        z.object({
          code: z.string(),
          pallet_spec: z.array(z.object({ pkgs_per_pallet: z.string(), pallets: z.string() })),
          pallet_ids: z.string().nullable(),
          ...rowBox,
        }),
      ),
      totals: keyed(TOTALS_KEYS, val),
      remarks: z.array(val),
    })
    .superRefine((o, ctx) => {
      o.rows.forEach((r, i) => {
        if (r.cells.length !== o.columns.length)
          ctx.addIssue({ code: "custom", path: ["rows", i, "cells"], message: `expected ${o.columns.length} cells, got ${r.cells.length}` });
      });
    });
}

export const schemas = {
  compact: build(boxVal, z.string(), {}, true),
  per_field: build(boxVal, boxVal, {}, true),
  cell_box: build(boxVal, z.string(), { pbox: keyed(PROTECTED_ROW_FIELDS, Box) }, true),
  // Row and group boxes are the union of cited items' boxes, computed in code.
  item_ids: build(idsVal, idsVal, {}, false),
} as const;

export type ModelOutput<V extends Variant = "compact"> = z.output<(typeof schemas)[V]>;

/** item_ids: every cited ID must exist in the page's textfmt.1 item list. */
export function unknownIds(out: ModelOutput<"item_ids">, itemCount: number): number[] {
  const bad = new Set<number>();
  const check = (x: { ids: number[] } | null) => x?.ids.forEach((id) => id >= itemCount && bad.add(id));
  Object.values(out.header).forEach(check);
  Object.values(out.totals).forEach(check);
  out.containers.forEach((c) => Object.values(c).forEach(check));
  out.rows.forEach((r) => r.cells.forEach(check));
  out.remarks.forEach(check);
  return [...bad];
}

/** JSON Schema for response_format; the refinement is checked by Zod after the call, not by the API. */
export function responseFormat(variant: Variant) {
  return {
    type: "json_schema" as const,
    json_schema: { name: `page_${variant}`, strict: true, schema: z.toJSONSchema(schemas[variant], { target: "draft-7", io: "input" }) },
  };
}
