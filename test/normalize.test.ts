import { describe, expect, it } from "vitest";
import { marksPos, normalize } from "../src/normalize/normalize.ts";
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
