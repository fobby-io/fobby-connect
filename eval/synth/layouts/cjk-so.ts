import Decimal from "decimal.js";
import { PDFDocument } from "pdf-lib";
import { bookingNo, company, date, docNo, PORTS, PRODUCTS, vessel, zhCompany } from "../data.ts";
import { A4, hline, loadFonts, text } from "../draw.ts";
import { canon, grouped, rocDate } from "../format.ts";
import { rng } from "../rng.ts";
import type { Expected } from "../types.ts";

// Invented Traditional Chinese shipping order (訂艙委託書) with bilingual labels and ROC dates.

const COLS = [
  { field: "marks", label: "嘜頭 MARKS", x: 30, align: "left" },
  { field: "description", label: "品名 DESCRIPTION", x: 150, align: "left" },
  { field: "pkg_qty", label: "件數 PKGS", x: 410, align: "right" },
  { field: "gw_kg", label: "毛重 G.W.(KGS)", x: 490, align: "right" },
  { field: "cbm", label: "材積 CBM", x: 565, align: "right" },
] as const;

export async function cjkSo(seed: number) {
  const r = rng(seed);
  const shipper = zhCompany(r), consignee = company(r);
  const notifySame = r.next() < 0.6;
  const notify = notifySame ? null : company(r);
  const pol = r.pick(PORTS.pol), pod = r.pick(PORTS.pod);
  const v = vessel(r);
  const docDate = date(r), etd = date(r);
  const no = docNo(r, "SO"), booking = bookingNo(r);
  const cont = { iso_type: r.pick(["20GP", "40GP", "40HQ"]), qty: r.int(1, 4) };
  const items = Array.from({ length: r.int(1, 4) }, () => ({
    marks: `${consignee.name.split(" ")[0]}/${pod[1].split(",")[0]}`,
    desc: r.pick(PRODUCTS)[0],
    pkgs: r.int(20, 900),
    gw: new Decimal(r.int(2000, 180000)).div(10),
    cbm: new Decimal(r.int(500, 68000)).div(1000),
  }));
  const tot = {
    pkgs: items.reduce((a, i) => a + i.pkgs, 0),
    gw: items.reduce((a, i) => a.plus(i.gw), new Decimal(0)),
    cbm: items.reduce((a, i) => a.plus(i.cbm), new Decimal(0)),
  };

  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0));
  const f = await loadFonts(doc, true);
  const font = f.cjk!;
  const page = doc.addPage([A4.w, A4.h]);
  const rocLong = (iso: string) => `${Number(iso.slice(0, 4)) - 1911}年${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;

  text(page, shipper.name, A4.w / 2, 28, { font, size: 15, align: "center" });
  text(page, "訂艙委託書  SHIPPING ORDER", A4.w / 2, 52, { font, size: 13, align: "center" });
  text(page, `S/O NO.: ${no}`, 565, 80, { font, size: 9, align: "right" });
  text(page, `日期 DATE: ${rocLong(docDate)}`, 565, 94, { font, size: 9, align: "right" });

  const block = (label: string, lines: string[], x: number, top: number) => {
    text(page, label, x, top, { font, size: 8 });
    lines.forEach((l, k) => text(page, l, x + 8, top + 14 + k * 12, { font, size: 9 }));
  };
  hline(page, 30, 565, 112);
  block("託運人 SHIPPER", [shipper.name, ...shipper.address], 30, 118);
  block("受貨人 CONSIGNEE", [consignee.name, ...consignee.address], 30, 178);
  block("通知人 NOTIFY PARTY", notify ? [notify.name, ...notify.address] : ["SAME AS CONSIGNEE"], 30, 238);
  block("船名/航次 VESSEL/VOY.", [`${v.vessel} ${v.voyage}`], 320, 118);
  block("開航日 ETD", [rocDate(etd)], 320, 150);
  block("裝貨港 PORT OF LOADING", [pol[1]], 320, 182);
  block("卸貨港 PORT OF DISCHARGE", [pod[1]], 320, 214);
  block("訂艙號碼 BOOKING NO.", [booking], 320, 246);
  block("櫃型/櫃量 CONTAINER", [`${cont.iso_type} X ${cont.qty}`], 320, 278);
  hline(page, 30, 565, 310);

  COLS.forEach((c) => text(page, c.label, c.x, 318, { font, size: 8, align: c.align }));
  hline(page, 30, 565, 332);
  const rows: Expected["rows"] = [];
  items.forEach((it, k) => {
    const top = 340 + k * 18;
    const cells = [it.marks, it.desc, `${it.pkgs} CTNS`, grouped(it.gw, 1), it.cbm.toFixed(3)];
    COLS.forEach((c, j) => text(page, cells[j]!, c.x, top, { font, size: 8, align: c.align }));
    rows.push({
      page_no: 1, row_type: "item", group_code: null,
      fields: { marks: it.marks, description: it.desc, pkg_qty: String(it.pkgs), pkg_unit: "CTNS", gw_kg: canon(it.gw), cbm: canon(it.cbm) },
    });
  });
  const tTop = 340 + items.length * 18 + 6;
  hline(page, 30, 565, tTop - 4);
  text(page, "合計 TOTAL", 150, tTop, { font, size: 8 });
  [`${tot.pkgs} CTNS`, grouped(tot.gw, 1), tot.cbm.toFixed(3)].forEach((s, j) =>
    text(page, s, COLS[j + 2]!.x, tTop, { font, size: 8, align: "right" }));

  const expected: Expected = {
    doc_id: `cjk-so-${seed}`, layout: "cjk-so", seed, doc_type: "SO",
    pages: [{ page_no: 1, expected_route: "text", rows: items.length }],
    header: {
      doc_no: no, doc_date: docDate, booking_no: booking, shipper: shipper.name, consignee: consignee.name,
      ...(notify ? { notify: notify.name } : {}),
      pol: pol[0], pod: pod[0], etd, vessel: v.vessel, voyage: v.voyage,
    },
    containers: [{ number: null, iso_type: cont.iso_type, seal: null, qty: String(cont.qty) }],
    rows, groups: [],
    totals: { total_pkgs: String(tot.pkgs), total_gw_kg: canon(tot.gw), total_cbm: canon(tot.cbm) },
    profile: {
      columns: COLS.map((c) => ({ field: c.field, label: c.label })),
      prompt_notes: ["Dates use the ROC calendar: 115/11/05 and 115年11月5日 are 2026-11-05.", "Notify party SAME AS CONSIGNEE means no separate notify party."],
    },
  };
  return { pdf: await doc.save(), expected };
}
