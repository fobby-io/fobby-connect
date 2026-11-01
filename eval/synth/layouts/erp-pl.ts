import Decimal from "decimal.js";
import { PDFDocument } from "pdf-lib";
import { company, containerNo, date, docNo, PORTS, PRODUCTS, bookingNo, seal, vessel } from "../data.ts";
import { A4, hline, loadFonts, text } from "../draw.ts";
import { canon, grouped, usDate, words } from "../format.ts";
import { rng } from "../rng.ts";
import type { Expected } from "../types.ts";

// Invented digital ERP packing list: one row per item, running carton numbers, totals and a words line
// on the last page, the column header repeated on every page.

const COLS = [
  { field: "pkg_range", label: "C/NO.", x: 30, align: "left" },
  { field: "description", label: "DESCRIPTION", x: 80, align: "left" },
  { field: "part_no", label: "PART NO.", x: 250, align: "left" },
  { field: "pkg_qty", label: "CTNS", x: 340, align: "right" },
  { field: "qty", label: "QTY(PCS)", x: 395, align: "right" },
  { field: "nw_kg", label: "N.W.(KGS)", x: 455, align: "right" },
  { field: "gw_kg", label: "G.W.(KGS)", x: 510, align: "right" },
  { field: "cbm", label: "MEAS.(CBM)", x: 565, align: "right" },
] as const;

const ROW_H = 16;
const FIRST_TOP = 262, NEXT_TOP = 82, BOTTOM = 760;

export async function erpPl(seed: number, opts: { rows?: number; name?: string } = {}) {
  const r = rng(seed);
  const shipper = company(r), consignee = company(r);
  const pol = r.pick(PORTS.pol), pod = r.pick(PORTS.pod);
  const v = vessel(r);
  const docDate = date(r), etd = date(r);
  const no = docNo(r, "PL"), booking = bookingNo(r);
  const containers = Array.from({ length: r.int(1, 2) }, () => ({ number: containerNo(r), seal: seal(r), iso_type: r.pick(["40HQ", "20GP", "40GP"]) }));

  let next = 1;
  const items = Array.from({ length: opts.rows ?? r.int(8, 80) }, () => {
    const [desc, part] = r.pick(PRODUCTS);
    const ctns = r.int(1, 60);
    const perCtn = r.pick([50, 100, 200, 250, 500, 1000]);
    const nwPer = new Decimal(r.int(25, 180)).div(10);
    const nw = nwPer.mul(ctns).toDecimalPlaces(2);
    const gw = nwPer.plus(0.8).mul(ctns).toDecimalPlaces(2);
    const cbm = new Decimal(r.int(12, 80)).div(1000).mul(ctns).toDecimalPlaces(3);
    const range = ctns === 1 ? `${next}` : `${next}-${next + ctns - 1}`;
    next += ctns;
    return { range, desc, part, ctns, qty: ctns * perCtn, nw, gw, cbm };
  });
  const sum = (k: "nw" | "gw" | "cbm") => items.reduce((a, i) => a.plus(i[k]), new Decimal(0));
  const tot = { ctns: next - 1, qty: items.reduce((a, i) => a + i.qty, 0), nw: sum("nw"), gw: sum("gw"), cbm: sum("cbm") };
  const sayTotal = `SAY TOTAL: ${words(tot.ctns)} (${tot.ctns}) CARTONS ONLY.`;

  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0));
  const f = await loadFonts(doc);
  const pages: Expected["pages"] = [];
  const rows: Expected["rows"] = [];

  let i = 0;
  while (i < items.length || pages.length === 0) {
    const page = doc.addPage([A4.w, A4.h]);
    const first = pages.length === 0;
    let top: number;
    if (first) {
      text(page, shipper.name, A4.w / 2, 30, { font: f.bold, size: 14, align: "center" });
      shipper.address.forEach((l, k) => text(page, l, A4.w / 2, 50 + k * 12, { font: f.regular, align: "center" }));
      text(page, "PACKING LIST", A4.w / 2, 85, { font: f.bold, size: 16, align: "center" });
      text(page, "MESSRS.:", 30, 115, { font: f.bold });
      [consignee.name, ...consignee.address].forEach((l, k) => text(page, l, 95, 115 + k * 12, { font: f.regular }));
      const kv = (k: string, val: string, x: number, t: number, vx: number) => {
        text(page, k, x, t, { font: f.bold });
        text(page, val, vx, t, { font: f.regular });
      };
      kv("INVOICE NO.:", no, 360, 115, 450);
      kv("DATE:", usDate(docDate), 360, 129, 450);
      kv("BOOKING NO.:", booking, 360, 143, 450);
      kv("SHIPPED PER:", `${v.vessel} V.${v.voyage}`, 30, 165, 110);
      kv("ETD:", usDate(etd), 360, 165, 450);
      kv("FROM:", pol[1], 30, 179, 110);
      kv("TO:", pod[1], 360, 179, 450);
      text(page, "CONTAINER NO./SEAL NO.:", 30, 200, { font: f.bold });
      containers.forEach((c, k) =>
        text(page, `${c.number} / ${c.seal}   ${c.iso_type.slice(0, 2)}'${c.iso_type.slice(2)}`, 160, 200 + k * 12, { font: f.regular }));
      top = FIRST_TOP;
    } else {
      text(page, "PACKING LIST (CONTINUED)", 30, 30, { font: f.bold, size: 11 });
      text(page, `INVOICE NO.: ${no}`, 565, 30, { font: f.regular, align: "right" });
      top = NEXT_TOP;
    }
    hline(page, 30, 565, top - 26);
    COLS.forEach((c) => text(page, c.label, c.x, top - 20, { font: f.bold, size: 8, align: c.align }));
    hline(page, 30, 565, top - 8);

    let n = 0;
    while (i < items.length && top + ROW_H <= BOTTOM) {
      const it = items[i++]!;
      const cells = [it.range, it.desc, it.part, String(it.ctns), grouped(it.qty, 0), grouped(it.nw, 2), grouped(it.gw, 2), it.cbm.toFixed(3)];
      COLS.forEach((c, k) => text(page, cells[k]!, c.x, top, { font: f.regular, size: 8, align: c.align }));
      rows.push({
        page_no: pages.length + 1, row_type: "item", group_code: null,
        fields: {
          pkg_range: it.range, description: it.desc, part_no: it.part, pkg_qty: String(it.ctns),
          qty: String(it.qty), nw_kg: canon(it.nw), gw_kg: canon(it.gw), cbm: canon(it.cbm),
        },
      });
      top += ROW_H; n++;
    }
    const last = i >= items.length;
    if (last) {
      hline(page, 30, 565, top + 2);
      text(page, "TOTAL:", 80, top + 8, { font: f.bold, size: 8 });
      const t = [String(tot.ctns), grouped(tot.qty, 0), grouped(tot.nw, 2), grouped(tot.gw, 2), tot.cbm.toFixed(3)];
      COLS.slice(3).forEach((c, k) => text(page, t[k]!, c.x, top + 8, { font: f.bold, size: 8, align: c.align }));
      text(page, sayTotal, 30, top + 32, { font: f.regular, size: 8 });
    } else {
      text(page, "TO BE CONTINUED", A4.w / 2, 790, { font: f.regular, size: 8, align: "center" });
    }
    pages.push({ page_no: pages.length + 1, expected_route: "text", rows: n });
  }
  pages.forEach((p, k) => text(doc.getPage(k), `PAGE ${p.page_no} OF ${pages.length}`, 565, 810, { font: f.regular, size: 8, align: "right" }));

  const expected: Expected = {
    doc_id: `${opts.name ?? "erp-pl"}-${seed}`, layout: "erp-pl", seed, doc_type: "PL", pages,
    header: {
      doc_no: no, doc_date: docDate, booking_no: booking, shipper: shipper.name, consignee: consignee.name,
      pol: pol[0], pod: pod[0], etd, vessel: v.vessel, voyage: v.voyage,
    },
    containers: containers.map((c) => ({ number: c.number, iso_type: c.iso_type, seal: c.seal, qty: null })),
    rows, groups: [],
    totals: {
      total_pkgs: String(tot.ctns), total_qty: String(tot.qty), total_nw_kg: canon(tot.nw),
      total_gw_kg: canon(tot.gw), total_cbm: canon(tot.cbm), total_pkgs_in_words: sayTotal,
    },
    profile: {
      columns: COLS.map((c) => ({ field: c.field, label: c.label })),
      prompt_notes: ["The company in the letterhead at the top is the shipper; MESSRS. is the consignee.", "C/NO. is the carton number range of the row.", "Dates are printed like OCT. 30, 2026."],
    },
  };
  return { pdf: await doc.save(), expected };
}
