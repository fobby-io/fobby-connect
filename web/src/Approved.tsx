// The approved record as it is sent: what export.json holds, read-only, so a mistake can be spotted before reopening.
import { useEffect, useState } from "react";
import type { NormDoc } from "./api.ts";
import { api, errorMessage } from "./api.ts";
import { Button } from "./components/ui/button.tsx";
import { Card } from "./components/ui/card.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table.tsx";
import { fmt, problems, type Finding } from "./diff.ts";
import { t, useLang } from "./i18n.ts";
import { labels } from "./labels.ts";
import { cn } from "./lib/utils.ts";

type V = { v: string | null; raw: string | null };
type Row = Omit<NormDoc["rows"][number], "box">;
// The fields of src/server/export.ts ExportV1 this screen shows.
export type ApprovedRecord = {
  header: NormDoc["header"]; rows: Row[]; totals: NormDoc["totals"]; checks: Finding[];
  containers: { page: number; number: string | null; iso_type: string | null; seal: string | null; qty: string | null }[];
  source: { file: string; pages: number };
};

const FIRST = 12;
const label = "text-[13px] text-muted-foreground";

// "99,750" and "3,460.70" print the same number as 99750 and 3460.7; only a real change of meaning is worth showing.
const sameNumber = (raw: string, v: string | null) => v !== null && /^[\d,.\s-]+$/.test(raw) && Number(raw.replace(/[,\s]/g, "")) === Number(v);

/** One labelled value; the printed text shows under it when normalizing changed it, and a missing value shows as a dash. */
function Field({ name, nv, unit = "" }: { name: string; nv: V | undefined; unit?: string }) {
  return (
    <div className="min-w-0">
      <dt className={label}>{name}</dt>
      <dd className={cn("m-0 font-medium break-words", !nv?.v && "font-normal text-muted-foreground")}>{nv?.v ? `${fmt(nv.v)}${unit}` : "—"}</dd>
      {nv?.raw && nv.raw !== nv.v && !sameNumber(nv.raw, nv.v) && <dd className="raw-clamp m-0 text-xs text-muted-foreground">{t("原文：", "Printed: ")}{nv.raw}</dd>}
    </div>
  );
}

/** Fetches the approved record once; null until it arrives. */
export function useApproved(id: string, approved: boolean) {
  const [rec, setRec] = useState<ApprovedRecord | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (approved) api<ApprovedRecord>(`/api/documents/${id}/export.json`).then(setRec, setError); }, [id, approved]);
  return { rec, error };
}

export function Approved({ rec, error }: { rec: ApprovedRecord | null; error: unknown }) {
  useLang();
  const L = labels();
  const [all, setAll] = useState(false);

  if (error != null) return <Card className="gap-0 p-6"><p className="text-destructive" role="alert">{errorMessage(error)}</p></Card>;
  if (!rec) return <Card className="gap-0 p-6"><p className="text-muted-foreground">{t("載入確認後的資料…", "Loading the approved data…")}</p></Card>;

  const rows = all ? rec.rows : rec.rows.slice(0, FIRST);
  const span = (a: V, b: V) => (a.v ? (a.v === b.v ? a.v : `${a.v}–${b.v}`) : "");
  const cell = (r: Row, k: string) => {
    if (k === "pkg_range") return span(r.pkg_from, r.pkg_to);
    if (k === "pallet_range") return span(r.pallet_from, r.pallet_to);
    const x = fmt((r as unknown as { [k: string]: V })[k]?.v);
    return k === "qty" && x && r.qty_unit.v ? `${x} ${r.qty_unit.v}` : x;
  };
  // A column this document never prints only pushes the table sideways.
  const cols = L.COLS.filter(([k]) => rec.rows.some((r) => cell(r, k)));
  const totals = Object.entries(L.TOTAL).filter(([k]) => rec.totals[k]?.raw);
  const failed = problems(rec.checks);

  return (
    <Card className="gap-0 p-6">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{t("確認後的資料", "Approved data")}</h2>
        <a href={rec.source.file} target="_blank" rel="noreferrer" className="text-sm text-primary">{t(`打開原始 PDF（${rec.source.pages} 頁）↗`, `Open the PDF (${rec.source.pages} page${rec.source.pages === 1 ? "" : "s"}) ↗`)}</a>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">{t("送出去的就是這些。對照原始 PDF，有錯就在下面重新審核。", "This is exactly what is sent. Compare it with the PDF; if something is wrong, reopen it below.")}</p>

      {failed.length > 0 && (
        <div className="mb-5 rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn" role="note">
          <p className="font-medium">{t("確認時仍有檢查沒通過：", "Approved with checks still failing:")}</p>
          <ul className="m-0 mt-1 list-disc pl-5">{failed.map((p) => <li key={p.text}>{p.text}</li>)}</ul>
        </div>
      )}

      <h3 className="mb-3 text-sm font-semibold">{t("文件抬頭", "Header")}</h3>
      <dl className="m-0 mb-6 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-5 gap-y-3">
        {Object.entries(L.HEAD).map(([k, name]) => (
          <div key={k} className={cn(k === "shipping_marks" && "col-span-full")}><Field name={name} nv={rec.header[k]} /></div>
        ))}
      </dl>

      {rec.containers.length > 0 && (
        <>
          <h3 className="mb-2 text-sm font-semibold">{t("貨櫃", "Containers")}</h3>
          <ul className="m-0 mb-6 grid list-none gap-1 p-0 text-sm">
            {rec.containers.map((c, i) => (
              <li key={i}><span className="font-medium">{c.number ?? "—"}</span>
                <span className="text-muted-foreground">{[c.iso_type, c.seal && t(`封條 ${c.seal}`, `seal ${c.seal}`), c.qty && t(`${c.qty} 件`, `${c.qty} pkgs`)].filter(Boolean).map((x) => ` · ${x}`).join("")}</span></li>
            ))}
          </ul>
        </>
      )}

      <h3 className="mb-2 text-sm font-semibold">{t(`明細（${rec.rows.length} 列）`, `Line items (${rec.rows.length})`)}</h3>
      <div className="mb-2">
        <Table className="text-sm">
          <TableHeader>
            <TableRow className="border-0 bg-muted hover:bg-muted [&>th:first-child]:rounded-l-lg [&>th:last-child]:rounded-r-lg">
              <TableHead className="h-9 px-2.5 text-[13px] font-semibold text-muted-foreground">{t("頁", "Page")}</TableHead>
              {cols.map(([k, name, cls]) => <TableHead key={k} className={cn("h-9 px-2.5 text-[13px] font-semibold text-muted-foreground", cls === "num" && "text-right")}>{name}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.page}-${r.row}`} className="hover:bg-accent/50">
                <TableCell className="px-2.5 py-2 align-top text-muted-foreground">{r.page}</TableCell>
                {cols.map(([k, , cls]) => (
                  <TableCell key={k} className={cn("px-2.5 py-2 align-top", cls === "num" && "text-right",
                    k === "description" ? "min-w-[200px] text-[13px] whitespace-normal" : "whitespace-nowrap")}>{cell(r, k)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rec.rows.length > FIRST && (
        <Button variant="ghost" size="sm" className="mb-4 self-start" onClick={() => setAll(!all)}>
          {all ? t("只看前幾列", "Show fewer") : t(`顯示全部 ${rec.rows.length} 列`, `Show all ${rec.rows.length} line items`)}
        </Button>
      )}

      {totals.length > 0 && (
        <>
          <h3 className="mt-4 mb-3 text-sm font-semibold">{t("合計", "Totals")}</h3>
          <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-5 gap-y-3">
            {totals.map(([k, name]) => <Field key={k} name={name} nv={rec.totals[k]} unit={k.endsWith("_kg") ? " kg" : ""} />)}
          </dl>
        </>
      )}
    </Card>
  );
}
