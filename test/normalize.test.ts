import { describe, expect, it } from "vitest";
import { learnable, marksPos, normalize } from "../src/normalize/normalize.ts";
import { checkDocument } from "../src/rules/checks.ts";
import { HEADER_KEYS, TOTALS_KEYS } from "../src/shared/fields.ts";
import type { Page } from "../src/profiles/loop.ts";

const nulls = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, null]));
const val = (v: string) => ({ v, box: [0, 0, 1, 1] });
const page = (o: { header?: Record<string, string>; rows: string[][]; totals?: Record<string, string> }): Page => ({
  doc_type: "PL", issuer: "ACME CORP.\nTAIPEI",
  header: { ...nulls(HEADER_KEYS), ...Object.fromEntries(Object.entries(o.header ?? {}).map(([k, v]) => [k, val(v)])) } as Page["header"],
  containers: [],
  columns: [
    { field: "pkg_range", label: "Cases No." }, { field: "pkg_qty", label: "Total Cases" }, { field: "description", label: "Description" },
    { field: "qty", label: "Quantity (PCS)" }, { field: "nw_kg", label: "N/W (LBS)" }, { field: "gw_kg", label: "G/W (LBS)" },
  ],
  rows: o.rows.map((cells) => ({ t: "item" as const, cont: false, g: null, cells, box: [0, 0, 1, 1] })),
  groups: [],
  totals: { ...nulls(TOTALS_KEYS), ...Object.fromEntries(Object.entries(o.totals ?? {}).map(([k, v]) => [k, val(v)])) } as Page["totals"],
  remarks: [],
});

const ROW1 = ["1-18\n(1PLT)", "18", "# ORD40563\nM6 Flange Bolt\nPT#048317-02(K71aR)\nHS#7318.14.1060\nLOT# C2607718002D", "@1,000\n18,100", "@22.31\n401.58", "@22.97\n413.46"];
const ROW2 = ["469-504\n(1PLT)", "36", "44 ID x 50 OD\nLOT# TB-261103", "@50\n1,800", "@38.76\n1,395.36", "@39.53\n1,423.08"];

describe("normalize", () => {
  it("splits a stacked description and cells into typed values, keeping the raw text", () => {
    const n = normalize([page({ rows: [ROW1, ROW2] })]);
    const r = n.rows[0]!;
    expect([r.po.v, r.part_no.v, r.revision.v, r.hs_code.v, r.lot_no.v]).toEqual(["ORD40563", "048317-02", "K71aR", "7318.14.1060", "C2607718002D"]);
    expect([r.pkg_from.v, r.pkg_to.v, r.pkgs.v, r.pallets.v, r.qty_per_pkg.v, r.qty.v, r.qty_unit.v]).toEqual(["1", "18", "18", "1", "1000", "18100", "PCS"]);
    expect(r.nw_kg.v).toBe("182.154"); // 401.58 LBS
    expect(r.nw_kg.raw).toBe("@22.31\n401.58");
    // A row without its own PO continues the product above.
    expect([n.rows[1]!.po.v, n.rows[1]!.part_no.v, n.rows[1]!.lot_no.v]).toEqual(["ORD40563", "048317-02", "TB-261103"]);
  });

  it("normalizes the header: dates, ports, parties, vessel and voyage printed together", () => {
    const n = normalize([page({ header: { doc_date: "2026/7/1", pol: "KAOHSIUNG", pod: "NEW YORK", vessel: "EVER MERCY V.1366-007E" }, rows: [] })]);
    expect([n.header.doc_date!.v, n.header.pol!.v, n.header.pod!.v, n.header.vessel!.v, n.header.voyage!.v]).toEqual(["2026-07-01", "TWKHH", "USNYC", "EVER MERCY", "1366-007E"]);
    expect(n.header.shipper!.v).toBe("ACME CORP."); // from the letterhead when no shipper box is printed
  });

  it("keeps the pallet number range from its own column without counting it as pallets", () => {
    const p = page({ rows: [["1-108", "108", "BOLT", "237,600", "1,663.20", "1,717.20", "1-3"]] });
    p.columns.push({ field: "pallet_range", label: "P/NO." });
    const r = normalize([p]).rows[0]!;
    expect([r.pallet_from.v, r.pallet_to.v, r.pallets.v]).toEqual(["1", "3", null]);
  });

  it("counts pallets per row from the packages cell, not from a lot number followed by pallet marks", () => {
    const rows = [
      ["1-108", "108 CTNS 36CTN/3PLT", "PN:004617-41\nLOT#2640804-3 PLT#M1-M3", "@5,800 PCS\n626,400 PCS", "1,704.24", "1,747.44"],
      ["1-244", "244 CTNS\n36CTN/6PLT\n28CTN/1PLT", "LOT#2643018-4~6 PLT#S1-S7", "@525 PCS\n128,100 PCS", "3,974.76", "4,072.36"],
    ];
    const pages = [page({ rows, totals: { total_pkgs: "352 CTNS (ON 10 PLT)" } })];
    expect(normalize(pages).rows.map((r) => [r.pkgs.v, r.pallets.v])).toEqual([["108", "3"], ["244", "7"]]);
    // The carton sum uses the same count, so the stacked "28CTN/1PLT" line is not read as the row's cartons.
    expect(checkDocument(pages).filter((f) => /pkg_qty|pallets/.test(f.message))).toEqual([]);
  });

  it("reads a weight under G.W. or N.W. without a unit as kg, not grams", () => {
    const p = page({ rows: [["1-1", "1", "BOLT", "10", "705.00", "667.40"]] });
    p.columns[4]!.label = "N.W."; p.columns[5]!.label = "G.W.";
    const r = normalize([p]).rows[0]!;
    expect([r.nw_kg.v, r.gw_kg.v]).toEqual(["705", "667.4"]);
  });

  it("writes a corrected value back into its printed text when that is a misread, and lists the rest for the rules", () => {
    const p = page({ header: { doc_no: "PL-001", doc_date: "FEB. 2, 2026" }, rows: [["1-108", "108 CTNS 36CTN/3PLT", "PN:004617-41\nBOLT", "@5,800 PCS\n626,400 PCS", "@15.78\n1,704.24", "@16.18\n1,747.44"]] });
    const fixes = {
      "rows.1.0.qty": "620000", "rows.1.0.pkgs": "110", "rows.1.0.part_no": "004617-42", "header.doc_no": "PL-002",
      "rows.1.0.pallets": "4", "rows.1.0.nw_kg": "800", "header.doc_date": "2026-02-03",
    };
    const l = learnable([p], fixes);
    expect(l.learned.sort()).toEqual(["header.doc_no", "rows.1.0.part_no", "rows.1.0.pkgs", "rows.1.0.qty"]);
    expect(l.answer[0]!.rows[0]!.cells.slice(1, 4)).toEqual(["110 CTNS 36CTN/3PLT", "PN:004617-42\nBOLT", "@5,800 PCS\n620,000 PCS"]);
    expect(l.answer[0]!.header.doc_no!.v).toBe("PL-002");
    // Pallets come from "3PLT" alongside the cartons, the weight was converted from LBS, the date is printed another way.
    expect(l.review.map((r) => r.key).sort()).toEqual(["header.doc_date", "rows.1.0.nw_kg", "rows.1.0.pallets"]);
    expect(l.review.find((r) => r.key === "rows.1.0.nw_kg")).toEqual({ key: "rows.1.0.nw_kg", printed: "@15.78\n1,704.24", read: "773.03", fixed: "800" });
    expect(p.rows[0]!.cells[3]).toBe("@5,800 PCS\n626,400 PCS"); // the answer passed in is left as it was
  });

  it("takes the pallet total printed inside the package total", () => {
    const n = normalize([page({ rows: [ROW1], totals: { total_pkgs: "942 CTNS ( 46 PLTS )" } })]);
    expect([n.totals.total_pkgs!.v, n.totals.total_pallets!.v]).toEqual(["942", "46"]);
  });

  it("reads PO numbers from shipping marks, joining a number broken across lines", () => {
    expect(marksPos("NEW YORK\nPO#ORD40563,ORD40463,ORD40\n543,\nKX7215\nPT#\nMADE IN TAIWAN")).toEqual(["ORD40563", "ORD40463", "ORD40543", "KX7215"]);
  });
});

describe("normalized checks", () => {
  it("flags pallets that do not add up, POs missing from the marks, and headers that differ between pages", () => {
    const p1 = page({ header: { vessel: "EVER MERCY V.1", shipping_marks: "PO#ORD40563,FOR99999" }, rows: [ROW1] });
    const p2 = page({ header: { vessel: "EVER MARCY V.1" }, rows: [], totals: { total_pkgs: "18 CTNS (2 PLTS)" } });
    const msgs = checkDocument([p1, p2]).map((f) => f.message);
    expect(msgs).toContain("rows add up to 1 pallets, the totals line says 2");
    expect(msgs).toContain("PO in the shipping marks but in no row: FOR99999");
    expect(msgs.some((m) => m.startsWith("vessel differs between pages"))).toBe(true);
  });
});
