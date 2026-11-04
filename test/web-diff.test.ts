import { describe, expect, it } from "vitest";
import { colChanged, edits, fmt, origCell, origCol, problems, rowChanged, type Page } from "../web/src/diff.ts";

const page = (): Page => ({
  doc_type: "PL", issuer: null,
  header: { doc_no: { v: "INV-1", box: [0, 0, 0, 0] }, shipper: null } as Page["header"],
  containers: [],
  columns: [{ field: "po_no", label: "PO" }, { field: "qty", label: "QTY" }],
  rows: [{ t: "item", cont: false, g: null, cells: ["A100", "5"], box: [0, 0, 10, 10] }],
  groups: [],
  totals: { total_qty: { v: "5", box: [0, 0, 0, 0] } } as Page["totals"],
  remarks: [],
});

describe("web diff helpers", () => {
  it("counts nothing when the answer is the read", () => {
    expect(edits([page()], [page()])).toBe(0);
    expect(rowChanged([page()], [page()], 0, 0)).toBe(false);
  });

  it("matches columns by label, so an added column does not shift the others", () => {
    const orig = [page()], answer = [page()];
    answer[0]!.columns.unshift({ field: "pallet_range", label: "P/NO." });
    answer[0]!.rows[0]!.cells.unshift("1-2");
    expect(origCol(orig, answer, 0, 0)).toBe(-1);
    expect(origCol(orig, answer, 0, 2)).toBe(1);
    expect(origCell(orig, answer, 0, 0, 2)).toBe("5");
    expect(colChanged(orig, answer, 0, 0)).toBe(true);
    expect(colChanged(orig, answer, 0, 1)).toBe(false);
    // The new column and its one new cell.
    expect(edits(orig, answer)).toBe(2);
  });

  it("counts a cell, a rewired column, a header and a total edit; empty equals missing", () => {
    const orig = [page()], answer = [page()];
    answer[0]!.rows[0]!.cells[1] = "6";
    answer[0]!.columns[0]!.field = "part_no";
    answer[0]!.header.doc_no = { v: "INV-2", box: [0, 0, 0, 0] };
    answer[0]!.header.shipper = { v: "", box: [0, 0, 0, 0] };
    answer[0]!.totals.total_qty = { v: "6", box: [0, 0, 0, 0] };
    expect(rowChanged(orig, answer, 0, 0)).toBe(true);
    expect(edits(orig, answer)).toBe(4);
  });

  it("words failed checks once per message, with the column they point at", () => {
    const p = problems([
      { page: 1, path: "totals.total_gw_kg", message: "rows add up to 1234.5 gw_kg, the totals line says 1,200 KGS" },
      { page: 2, path: "totals.total_gw_kg", message: "rows add up to 1234.5 gw_kg, the totals line says 1,200 KGS" },
      { page: 1, path: "header.shipping_marks", message: "PO in the shipping marks but in no row: A200" },
      { page: 3, path: "header.vessel", message: "vessel differs between pages: page 1 has X, page 3 has Y" },
    ]);
    expect(p).toEqual([
      { text: "毛重對不上：每列加起來是 1,234.5，合計列印的是 1,200 KGS", col: "gw_kg", key: "total_gw_kg", pages: [1, 2] },
      { text: "嘜頭上列了 PO A200，但明細裡沒有", col: "po", key: "shipping_marks", pages: [1] },
      { text: "船名前後不一致：第 1 頁是 X，第 3 頁是 Y", col: undefined, key: "vessel", pages: [3] },
    ]);
  });

  it("formats plain numbers only", () => {
    expect(fmt("1234.5678")).toBe("1,234.568");
    expect(fmt("12 PCS")).toBe("12 PCS");
    expect(fmt(null)).toBe("");
  });
});
