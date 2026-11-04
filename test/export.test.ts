import { describe, expect, it } from "vitest";
import type { Page } from "../src/profiles/loop.ts";
import { BOM, exportCsv, exportJson, type Exportable } from "../src/server/export.ts";
import { HEADER_KEYS, TOTALS_KEYS } from "../src/shared/fields.ts";

const b: [number, number, number, number] = [0, 0, 1, 1];
const val = (v: string) => ({ v, box: b });
const nulls = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, null]));
const page = (ctns: string): Page => ({
  doc_type: "PL", issuer: null,
  header: { ...nulls(HEADER_KEYS), doc_no: val("-12.5"), booking_no: val("-x") } as Page["header"],
  containers: [{ number: val("MSKU1234565"), iso_type: val("45G1"), seal: null, qty: null }],
  columns: [{ field: "description", label: "DESC" }, { field: "pkg_qty", label: "CTNS" }, { field: "qty", label: "QTY" }],
  rows: [
    { t: "item", cont: false, g: null, cells: ["=SUM(A1)", ctns, "100 PCS"], box: b },
    { t: "subtotal", cont: false, g: null, cells: [null, ctns, null], box: b },
    { t: "item", cont: false, g: null, cells: ['Bolt, "M6"', "3", "-12.5"], box: b },
  ],
  groups: [], totals: { ...nulls(TOTALS_KEYS), total_pkgs: val("8") } as Page["totals"], remarks: [],
});

const doc = (answer: Page[]): Exportable => ({
  id: "d1", name: "a.pdf", pages: [],
  run: { cls: "PL", sender: null, issuer: null, prompt: null, findings: [], cost_usd: 0, pages: [{ page_no: 1, route: "text", output: page("4"), reread: false }] },
  approved: { sender: "ACME", learn: { outcome: "no_change" }, corrected: 1, answer, approved_at: "2026-11-04T08:00:00.000Z" },
});

const HEAD = "doc_id,doc_type,sender,approved_at,doc_no,doc_date,booking_no,shipper,consignee,notify,pol,pod,etd,eta,vessel,voyage,shipping_marks,page,item,po,part_no,revision,hs_code,lot_no,description,pkg_from,pkg_to,pkgs,pallet_from,pallet_to,pallets,qty_per_pkg,qty,qty_unit,nw_kg,gw_kg,cbm";

describe("exportCsv", () => {
  const csv = exportCsv(doc([page("5")]));
  const lines = csv.slice(1).split("\r\n");

  it("starts with a BOM, ends every line with CRLF and names the columns in order", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(BOM).toBe(String.fromCharCode(0xfeff));
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(lines[0]).toBe(HEAD);
    expect(lines).toHaveLength(4); // header, two items, the empty string after the last CRLF
  });

  it("writes the approved values, numbers items from 1 and skips subtotal rows", () => {
    const cols = HEAD.split(",");
    const row1 = lines[1]!.split(",");
    const at = (k: string) => row1[cols.indexOf(k)];
    expect(at("pkgs")).toBe("5"); // the answer, not the model's 4
    expect(at("item")).toBe("1");
    expect(at("sender")).toBe("ACME");
    expect(at("description")).toBe("'=SUM(A1)");
    expect(at("doc_no")).toBe("-12.5");
    expect(at("booking_no")).toBe("'-x");
    expect(lines[2]).toContain(',1,2,');
    expect(lines[2]).toContain('"Bolt, ""M6"""');
  });

  it("has only the header line when there are no items", () => {
    const empty = { ...page("5"), rows: [] };
    expect(exportCsv(doc([empty]))).toBe(`${BOM}${HEAD}\r\n`);
  });

  it("is the same bytes every time", () => {
    expect(exportCsv(doc([page("5")]))).toBe(csv);
  });
});

describe("exportJson", () => {
  it("carries the schema version, the approved values and the containers, without boxes", () => {
    const j = exportJson(doc([page("5")]));
    expect(j.schema_version).toBe(1);
    expect(j.doc_type).toBe("PL");
    expect(j.rows[0]!.pkgs.v).toBe("5");
    expect(j.rows).toHaveLength(2);
    expect(j.rows.map((r) => r.row)).toEqual([0, 2]); // the page's row index, counting the subtotal
    expect("box" in j.rows[0]!).toBe(false);
    expect(j.containers).toEqual([{ page: 1, number: "MSKU1234565", iso_type: "45G1", seal: null, qty: null }]);
    expect(j.totals.total_pkgs!.v).toBe("8");
    expect(JSON.stringify(exportJson(doc([page("5")])))).toBe(JSON.stringify(j));
  });
});
