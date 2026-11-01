import Decimal from "decimal.js";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { LAYOUTS } from "../eval/synth/generator.ts";
import { checkDigit, isValidContainerNo } from "../src/rules/containers.ts";

describe("container numbers", () => {
  it("accepts known-valid numbers and rejects a wrong check digit", () => {
    expect(checkDigit("CSQU305438")).toBe(3);
    expect(isValidContainerNo("CSQU3054383")).toBe(true);
    expect(isValidContainerNo("MSKU 907032-3")).toBe(true);
    expect(isValidContainerNo("CSQU3054384")).toBe(false);
  });
});

describe.each(Object.keys(LAYOUTS))("synthetic layout %s", (name) => {
  it("is deterministic, self-consistent and prints what it expects", async () => {
    const make = LAYOUTS[name]!;
    const a = await make(7), b = await make(7);
    expect(Buffer.from(a.pdf).equals(Buffer.from(b.pdf))).toBe(true);

    const e = a.expected;
    const sum = (k: "gw_kg" | "cbm") => e.rows.reduce((s, r) => s.plus(r.fields[k] ?? 0), new Decimal(0)).toString();
    expect(sum("gw_kg")).toBe(e.totals.total_gw_kg);
    expect(sum("cbm")).toBe(e.totals.total_cbm);
    expect(e.rows.reduce((s, r) => s + Number(r.fields.pkg_qty), 0)).toBe(Number(e.totals.total_pkgs));
    e.containers.forEach((c) => c.number && expect(isValidContainerNo(c.number)).toBe(true));
    expect(e.pages.reduce((s, p) => s + p.rows, 0)).toBe(e.rows.length);

    const { text } = await extractText(await getDocumentProxy(new Uint8Array(a.pdf)), { mergePages: true });
    for (const v of [e.header.doc_no, e.header.shipper, e.header.booking_no, ...e.rows.map((r) => r.fields.description)])
      expect(text).toContain(v);
  });
});
