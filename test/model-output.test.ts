import { describe, expect, it } from "vitest";
import { HEADER_KEYS, TOTALS_KEYS } from "../src/shared/fields.ts";
import { responseFormat, schemas, unknownIds, VARIANTS } from "../src/shared/model-output.ts";

const nulls = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, null]));
const page = (cells: (string | null)[]) => ({
  doc_type: "PL",
  issuer: "ACME",
  header: { ...nulls(HEADER_KEYS), doc_no: { v: "PL-1", box: [10, 10, 80, 20] } },
  containers: [],
  columns: [{ field: "description", label: "DESCRIPTION" }, { field: "gw_kg", label: "G.W.(KGS)" }],
  rows: [{ t: "item", cont: false, g: null, cells, box: [0, 100, 1000, 120] }],
  groups: [],
  totals: nulls(TOTALS_KEYS),
  remarks: [],
});

describe("model output schema", () => {
  it("accepts a compact page", () => {
    expect(schemas.compact.safeParse(page(["BOLT", "12.5"])).success).toBe(true);
  });

  it("rejects rows whose cell count differs from columns", () => {
    const r = schemas.compact.safeParse(page(["BOLT"]));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/expected 2 cells/);
  });

  it("clamps boxes off the 0-1000 grid and rejects wrong lengths", () => {
    const p = page(["BOLT", "1"]);
    p.rows[0]!.box = [-3, 0, 1001, 5.4];
    expect(schemas.compact.parse(p).rows[0]!.box).toEqual([0, 0, 1000, 5]);
    p.rows[0]!.box = [0, 0, 5];
    expect(schemas.compact.safeParse(p).success).toBe(false);
  });

  it("finds item IDs past the page's item list", () => {
    const out = schemas.item_ids.parse({
      ...page([]),
      header: { ...nulls(HEADER_KEYS), doc_no: { v: "PL-1", ids: [3] } },
      columns: [],
      rows: [{ t: "item", cont: false, g: null, cells: [] }],
    });
    expect(unknownIds(out, 3)).toEqual([3]);
    expect(unknownIds(out, 4)).toEqual([]);
  });

  it("emits a JSON schema with every key required for each variant", () => {
    for (const v of VARIANTS) {
      const s = responseFormat(v).json_schema.schema as { required: string[]; properties: object };
      expect(s.required.sort()).toEqual(Object.keys(s.properties).sort());
    }
  });
});
