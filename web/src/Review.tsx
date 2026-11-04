import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
// Scanned pages (CCITT fax, JBIG2, JPEG 2000) decode in wasm; without these the page renders blank.
import jbig2Url from "pdfjs-dist/wasm/jbig2.wasm?url";
import "pdfjs-dist/wasm/openjpeg.wasm?url";
import { creditText, errorMessage, isCreditExhausted, PASS, post, reasonText, request, WRONG, type Doc, type NormDoc } from "./api.ts";
import { Busy, ErrorText, ViaEmail } from "./App.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card } from "./components/ui/card.tsx";
import { Input } from "./components/ui/input.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table.tsx";
import { colChanged, edits, fmt, origCell, problems, rowChanged, type Finding, type Page } from "./diff.ts";
import { t, useLang } from "./i18n.ts";
import { FIELD_COL, labels } from "./labels.ts";
import { cn } from "./lib/utils.ts";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Row = { page: number; row: number };
type V = { v: string | null; raw: string | null };
const SECTION = "mb-4 gap-0 rounded-2xl p-[18px] shadow-none";
const LINK = "h-auto p-0 text-[13px] underline";

export function Review({ doc, onApproved }: {
  doc: Doc; onApproved: (d: Doc) => void;
}) {
  useLang();
  const L = labels();
  const run = doc.run;
  const orig = useMemo(() => run.pages.map((p) => p.output), [run]);
  const [answer, setAnswer] = useState<Page[]>(() => structuredClone(orig));
  const answerRef = useRef(answer);
  const [norm, setNorm] = useState<NormDoc>(doc.normalized);
  const [findings, setFindings] = useState<Finding[]>(run.findings);
  const [current, setCurrent] = useState(0);
  const [openRow, setOpenRow] = useState<Row | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [showMap, setShowMap] = useState(false);
  const [sender, setSender] = useState(() => {
    const issuer = doc.normalized.header.shipper?.v ?? (run.issuer ?? "").split("\n")[0]!;
    return run.sender ?? issuer.replace(/\b(CO|CORP|INC|LTD|LIMITED|ENTERPRISE)\b\.?|[.,]/gi, "").trim();
  });
  const senderInput = useRef<HTMLInputElement>(null);
  const [approval, setApproval] = useState<{ busy: true } | { error: unknown } | null>(null);

  // Mutate a copy; the ref lets a blur handler send the latest answer before React re-renders.
  const update = (f: (a: Page[]) => void) => {
    const next = structuredClone(answerRef.current);
    f(next);
    answerRef.current = next;
    setAnswer(next);
    return next;
  };

  // Edits are made on the raw text; the server normalizes it again and re-runs the checks.
  const seq = useRef(0);
  const refresh = async () => {
    const mine = ++seq.current;
    try {
      const j = await post<{ normalized: NormDoc; findings: Finding[] }>("/api/normalize", { answer: answerRef.current });
      if (mine !== seq.current) return;
      setNorm(j.normalized);
      setFindings(j.findings);
      setRefreshError(null);
    } catch (e) {
      if (mine === seq.current) setRefreshError(t(`重算失敗：${errorMessage(e)}`, `Recalculation failed: ${errorMessage(e)}`));
    }
  };

  const n = edits(orig, answer);

  async function approve() {
    if (approval) return;
    if (!sender.trim()) return senderInput.current?.focus();
    setApproval({ busy: true });
    try {
      const j = await post<{ corrected: number; learn: NonNullable<Doc["approved"]>["learn"]; approved_at?: string }>(`/api/documents/${doc.id}/approve`, { sender, answer: answerRef.current });
      onApproved({ ...doc, approved: { sender: sender.trim().toUpperCase(), learn: j.learn, corrected: j.corrected, approved_at: j.approved_at } });
    } catch (e) {
      setApproval({ error: e });
    }
  }

  if (approval && "busy" in approval)
    return (
      <Busy title={n ? t("正在學習你的修正…", "Learning your corrections…") : t("存檔中…", "Saving…")}>
        {n ? t("約 30 秒到 2 分鐘。", "About 30 seconds to 2 minutes.") : ""}
      </Busy>
    );
  if (approval)
    return (
      <Busy title={t("沒有存成功", "Not saved")}>
        <ErrorText error={approval.error} />
        <div className="mt-4"><Button variant="outline" onClick={() => setApproval(null)}>{t("回到檢查與修正", "Back to review")}</Button></div>
      </Busy>
    );

  const probs = problems(findings);
  const warnCols = new Set(probs.map((p) => p.col).filter(Boolean));
  const warnKeys = new Set(probs.map((p) => p.key));
  // The second system's doubts, on the values as first read: a cell by page, row and normalized column; a header or total by key.
  const v = doc.verify;
  const doubtCells = (v?.pages ?? []).flatMap((pg, pi) => pg.rows.flatMap((r, ri) => r.flatMap((p, ci) => {
    const c = orig[pi]?.columns[ci];
    return p !== null && p < PASS && c ? [{ pi, ri, ci, col: FIELD_COL[c.field] ?? c.field, label: c.label.replace(/\n/g, " "), value: orig[pi]!.rows[ri]?.cells[ci] ?? "", p }] : [];
  })));
  const doubtVals = (v?.pages ?? []).flatMap((pg, pi) => Object.entries(pg.values).filter(([, p]) => p < PASS).map(([key, p]) => ({ pi, key, p })));
  const doubtAt = new Map(doubtCells.map((d) => [`${d.pi}:${d.ri}:${d.col}`, d.p]));
  const doubtKey = new Map(doubtVals.map((d) => [d.key, d.p]));
  const doubts = doubtCells.length + doubtVals.length;
  const doubtWord = (p: number) => (p < WRONG ? t("可能讀錯", "likely wrong") : t("不確定", "unsure"));
  const issuer = norm.header.shipper?.v ?? ((run.issuer ?? "").split("\n")[0] || t("（沒讀到寄件公司）", "(sender not read)"));
  const span = (a: V, b: V) => (a.v ? (a.v === b.v ? a.v : `${a.v}–${b.v}`) : "");
  const cellText = (r: NormDoc["rows"][number], k: string) => {
    if (k === "pkg_range") return span(r.pkg_from, r.pkg_to);
    if (k === "pallet_range") return span(r.pallet_from, r.pallet_to);
    const v = fmt((r as unknown as Record<string, V>)[k]?.v);
    return k === "qty" && r.qty_unit.v ? `${v} ${r.qty_unit.v}` : v;
  };
  // Columns empty on every row are left out, so the table fits beside the page; one with a warning or a doubt always shows.
  const cols = L.COLS.filter(([k]) => warnCols.has(k) || doubtCells.some((d) => d.col === k) || norm.rows.some((r) => cellText(r, k)));
  const sum = (k: string) => norm.rows.reduce((a, r) => a + Number((r as unknown as Record<string, V>)[k]!.v ?? 0), 0);

  const pageTabs = run.pages.length > 1 && (
    <div className="mb-2.5 flex flex-wrap gap-1.5">
      {run.pages.map((p, i) => (
        <Button key={p.page_no} size="sm" variant="outline" className={cn(i === current && "border-primary font-semibold text-primary")}
          onClick={() => setCurrent(i)}>{t(`第 ${p.page_no} 頁`, `Page ${p.page_no}`)}</Button>
      ))}
    </div>
  );

  const startEdit = (key: string, f?: (a: Page[]) => void) => { if (f) update(f); setEditing((s) => new Set(s).add(key)); };
  const doneEdit = (key: string) => { setEditing((s) => { const x = new Set(s); x.delete(key); return x; }); void refresh(); };

  const openPage = openRow?.page === current ? answer[current]!.rows[openRow.row]?.box as number[] | undefined : undefined;

  return (
    <>
      <section className="mb-4 rounded-2xl border bg-card px-6 py-5">
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex-[1_1_320px]">
            <h1 className="mb-1 text-[22px] font-semibold tracking-tight">{doc.name}</h1>
            <p className="text-muted-foreground">{L.DOC_TYPE[run.cls ?? ""] ?? t("文件", "Document")} · {t(`${run.pages.length} 頁`, `${run.pages.length} page${run.pages.length === 1 ? "" : "s"}`)}{doc.auto?.reasons.includes("unknown_sender") ? t(" · 新廠商", " · New sender") : ""}</p>
            <ViaEmail doc={doc} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label htmlFor="sender" className="text-sm font-semibold">{t("寄件公司", "Sender")}</label>
              <Input id="sender" ref={senderInput} className="w-auto min-w-[240px]" value={sender} placeholder={issuer} onChange={(e) => setSender(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {([[norm.rows.length, t("列明細", "line items")], [sum("pkgs"), t("箱", "cartons")], [sum("pallets"), t("板", "pallets")], [sum("gw_kg"), t("毛重 kg", "gross kg")]] as const).map(([v, label]) => (
              <div key={label} className="min-w-[110px] rounded-xl border bg-muted px-3.5 py-2">
                <b className="block font-mono text-[22px] leading-tight font-semibold">{fmt(String(Math.round(v * 1000) / 1000))}</b>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
        {/* One line: why a person sees it, what the second check found, what the rules found. Lists only when something needs a look. */}
        <ul className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t pt-3.5 text-sm" aria-label={t("狀態", "Status")}>
          {!!doc.auto?.reasons.length && (
            <Status tone="neutral">{t("待審：", "In review: ")}{doc.auto.reasons.map(reasonText).join(t("、", ", "))}</Status>
          )}
          <Status tone={doubts ? "warn" : v && !v.unchecked_pages ? "ok" : "neutral"}>
            {!v ? (doc.auto?.reasons.includes("unknown_sender") ? t("新廠商不核對，請看過每個值", "Not checked (new sender): look over every value") : t("沒有核對，請看過每個值", "Not checked: look over every value"))
              : <>{t(`核對 ${v.checked} 個值`, `${v.checked} values checked`)}{doubts ? t(`，${doubts} 個待確認`, `, ${doubts} flagged`) : t("，全部通過", ", all passed")}
                {v.unchecked_pages ? t(`，${v.unchecked_pages} 頁沒核對到`, `, ${v.unchecked_pages} page${v.unchecked_pages === 1 ? "" : "s"} not checked`) : ""}</>}
          </Status>
          <Status tone={probs.length ? "warn" : "ok"}>
            {probs.length ? t(`${probs.length} 個檢查沒過`, `${probs.length} check${probs.length === 1 ? "" : "s"} failed`) : t("加總、板數、PO、各頁抬頭都通過", "Sums, pallets, PO and page headers pass")}
          </Status>
        </ul>
        {(doubts > 0 || probs.length > 0) && (
          <div className="mt-3 rounded-[10px] border border-warn-line bg-warn-bg px-4 py-3 text-sm">
            <ol className="list-decimal space-y-1 pl-5">
              {probs.map((p) => (
                <li key={p.text}>{p.text}{t("。", ".")}
                  <Button variant="link" className={cn(LINK, "ml-1.5")} onClick={() => { setCurrent(p.pages[0]! - 1); setOpenRow(null); }}>{t(`看第 ${p.pages.join("、")} 頁`, `See page ${p.pages.join(", ")}`)}</Button>
                </li>
              ))}
              {doubtVals.map((d) => (
                <li key={`v${d.pi}${d.key}`}>{L.HEAD[d.key] ?? L.TOTAL[d.key] ?? d.key}{t(`：「${orig[d.pi]!.header[d.key]?.v ?? orig[d.pi]!.totals[d.key]?.v}」，`, `: "${orig[d.pi]!.header[d.key]?.v ?? orig[d.pi]!.totals[d.key]?.v}", `)}{doubtWord(d.p)}{t("。", ".")}</li>
              ))}
              {doubtCells.slice(0, 12).map((d) => (
                <li key={`c${d.pi}-${d.ri}-${d.ci}`}>{t(`第 ${d.pi + 1} 頁第 ${d.ri + 1} 列「${d.label}」：${d.value}，`, `Page ${d.pi + 1}, row ${d.ri + 1}, "${d.label}": ${d.value}, `)}{doubtWord(d.p)}{t("。", ".")}
                  <Button variant="link" className={cn(LINK, "ml-1.5")} onClick={() => { setCurrent(d.pi); setOpenRow({ page: d.pi, row: d.ri }); }}>{t("打開這一列", "Open this row")}</Button>
                </li>
              ))}
              {doubtCells.length > 12 && <li>{t(`還有 ${doubtCells.length - 12} 個（明細裡的橘色）`, `${doubtCells.length - 12} more (orange in the line items)`)}</li>}
            </ol>
            {probs.length > 0 && <p className="mt-2 text-[13px] text-muted-foreground">{t("原本就對的話，直接確認。", "If it was right all along, just approve.")}</p>}
          </div>
        )}
      </section>

      {showMap || probs.length ? (
        <MapCard key={current} page={answer[current]!} current={current} warnCols={warnCols} pageTabs={pageTabs}
          changed={(ci) => colChanged(orig, answer, current, ci)}
          onRewire={(ci, field) => { update((a) => { a[current]!.columns[ci]!.field = field as Page["columns"][number]["field"]; }); void refresh(); }}>
          <MissingColumn docId={doc.id} page={current} answerPage={answer[current]!}
            onRead={(output) => { update((a) => { a[current] = output; }); setOpenRow(null); void refresh(); }} />
        </MapCard>
      ) : (
        // Nothing failed: the mapping is one line, so the header and line items are on the first screen.
        <Card className={cn(SECTION, "flex-row flex-wrap items-center gap-3")}>
          <h2 className="text-base font-bold">{t("欄位對應", "Column mapping")}</h2>
          <span className="text-[13px] text-muted-foreground">{t(`${answer[current]!.columns.length} 欄全部對應`, `All ${answer[current]!.columns.length} columns mapped`)}</span>
          <Button variant="link" className={LINK} onClick={() => setShowMap(true)}>{t("修改", "Change")}</Button>
        </Card>
      )}

      {/* Half and half: the page is what every value is checked against, so it is shown at a readable size and stays in
          view (scrolling inside itself) while the values scroll past. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 min-[1101px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className={cn(SECTION, "min-[1101px]:sticky min-[1101px]:top-[72px] min-[1101px]:max-h-[calc(100vh-88px)] min-[1101px]:overflow-auto")}>
          <div className="flex flex-wrap items-start gap-x-3">
            {pageTabs}
            <a href={`/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer" className="ml-auto pt-1 text-[13px] text-primary underline underline-offset-2">{t("在新分頁開 PDF", "Open PDF in a new tab")}</a>
          </div>
          <PageViewer docId={doc.id} pageNos={run.pages.map((p) => p.page_no)} current={current} box={openPage} />
        </Card>

        <div>
          <Card className={SECTION}>
            <h2 className="mb-3 text-base font-bold">{t("文件抬頭", "Header")}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-5 gap-y-3">
              {Object.entries(L.HEAD).map(([k, name]) => {
                const nv = norm.header[k];
                const pi = (nv?.page ?? 1) - 1;
                const before = orig[pi]!.header[k]?.v ?? null;
                const now = answer[pi]!.header[k]?.v ?? null;
                const key = `header.${k}`;
                return (
                  <Field key={k} name={name} value={nv?.v ?? null} printed={nv?.raw && nv.raw !== nv.v ? nv.raw : null} wide={k === "shipping_marks"}
                    warn={warnKeys.has(k) || doubtKey.has(k)} changed={(now || null) !== before}
                    note={doubtKey.has(k) && <div className="text-xs text-warn">{doubtWord(doubtKey.get(k)!)}</div>}
                    onStart={() => startEdit(key, (a) => { a[pi]!.header[k] ??= { v: "", box: [0, 0, 0, 0] }; })}
                    editor={editing.has(key) && <RawEditor value={answer[pi]!.header[k]?.v ?? null} before={before} label={t(`${name} 原文`, `${name} printed text`)}
                      onChange={(x) => update((a) => { a[pi]!.header[k]!.v = x ?? ""; })} onDone={() => doneEdit(key)} />} />
                );
              })}
            </div>
          </Card>

          <Card className={SECTION}>
            <h2 className="mb-3 text-base font-bold">{t("明細", "Line items")}</h2>
            <div className="overflow-hidden rounded-lg border">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    {cols.map(([k, name, cls]) => (
                      <TableHead key={k} className={cn("px-2 font-semibold", cls === "num" && "text-right", warnCols.has(k) && "text-warn shadow-[inset_0_-3px_0_var(--warn)]")}>{name}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {norm.rows.flatMap((r, i) => {
                    const pi = r.page - 1, isOpen = openRow?.page === pi && openRow.row === r.row;
                    // A page's rows start under a thin divider instead of a Page column on every row.
                    const divider = run.pages.length > 1 && r.page !== norm.rows[i - 1]?.page && (
                      <TableRow key={`p${r.page}`} className="hover:bg-transparent">
                        <TableCell colSpan={cols.length} className="bg-muted/60 px-2 py-1 text-xs font-semibold text-muted-foreground">{t(`第 ${r.page} 頁`, `Page ${r.page}`)}</TableCell>
                      </TableRow>
                    );
                    const tr = (
                      <TableRow key={`${pi}-${r.row}`} title={t("點一下看原文", "Click to see the printed text")}
                        className={cn("cursor-pointer hover:bg-primary/5", isOpen && "bg-primary/10 hover:bg-primary/10", rowChanged(orig, answer, pi, r.row) && "[&>td:first-child]:shadow-[inset_4px_0_0_#d6a800]")}
                        onClick={() => { setOpenRow(isOpen ? null : { page: pi, row: r.row }); setCurrent(pi); }}>
                        {cols.map(([k, , cls]) => {
                          const content = cellText(r, k);
                          const doubt = doubtAt.get(`${pi}:${r.row}:${k}`);
                          return (
                            <TableCell key={k} title={doubt !== undefined ? doubtWord(doubt) : undefined} className={cn("px-2 py-2 align-top",
                              doubt !== undefined && "bg-warn-bg font-semibold text-warn shadow-[inset_0_0_0_2px_var(--warn-line)]",
                              cls === "num" && "text-right font-mono text-[13px]",
                              k === "description" ? "min-w-[160px] text-[13px] whitespace-normal" : "whitespace-nowrap",
                              ["po", "part_no", "pkg_range", "pallet_range"].includes(k) && "font-mono text-[13px]",
                              warnCols.has(k) && "bg-warn-bg shadow-[inset_0_0_0_1px_var(--warn-line)]")}>
                              {content}
                              {k === "part_no" && r.revision.v && <span className="block text-xs text-muted-foreground">{t(`版次 ${r.revision.v}`, `Rev. ${r.revision.v}`)}</span>}
                              {k === "description" && (r.hs_code.v || r.lot_no.v) && (
                                <span className="block text-xs text-muted-foreground">{[r.hs_code.v && t(`稅則 ${r.hs_code.v}`, `HS ${r.hs_code.v}`), r.lot_no.v && t(`批號 ${r.lot_no.v}`, `Lot ${r.lot_no.v}`)].filter(Boolean).join(t("　", "  "))}</span>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                    const head = divider ? [divider] : [];
                    if (!isOpen) return [...head, tr];
                    return [...head, tr, (
                      <TableRow key={`${pi}-${r.row}-raw`} className="hover:bg-transparent">
                        <TableCell colSpan={cols.length} className="bg-muted px-3.5 py-3 whitespace-normal">
                          <RawRow page={answer[pi]!} ri={r.row} before={(ci) => origCell(orig, answer, pi, r.row, ci)}
                            onChange={(ci, x) => update((a) => { a[pi]!.rows[r.row]!.cells[ci] = x; })} onDone={() => void refresh()} />
                        </TableCell>
                      </TableRow>
                    )];
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>

          <Totals norm={norm} orig={orig} answer={answer} warnKeys={warnKeys} editing={editing}
            onStart={(key) => startEdit(key)} onDone={doneEdit}
            onChange={(pi, k, x) => update((a) => { a[pi]!.totals[k]!.v = x ?? ""; })} />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 flex flex-wrap items-center gap-4 border-t bg-card px-6 py-3">
        <span className="font-semibold">{sender.trim().toUpperCase() || t("（請在上方填寄件公司）", "(name the sender above)")}</span>
        <span className="text-muted-foreground" role="status">{refreshError ?? (n ? t(`你改了 ${n} 處`, `You changed ${n} field${n === 1 ? "" : "s"}`) : t("還沒有修改", "No changes yet"))}</span>
        <Button className="ml-auto" onClick={approve}>{t("確認", "Approve")}</Button>
      </div>
    </>
  );
}

// Totals: normalized, editable on the page that prints them.
function Totals({ norm, orig, answer, warnKeys, editing, onStart, onDone, onChange }: {
  norm: NormDoc; orig: Page[]; answer: Page[]; warnKeys: Set<string>; editing: Set<string>;
  onStart: (key: string) => void; onDone: (key: string) => void; onChange: (pi: number, k: string, x: string | null) => void;
}) {
  useLang();
  const L = labels();
  const totals = Object.entries(L.TOTAL).filter(([k]) => norm.totals[k]?.raw);
  if (!totals.length) return null;
  return (
    <Card className={SECTION}>
      <h2 className="mb-3 text-base font-bold">{t("合計", "Totals")}</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-5 gap-y-3">
        {totals.map(([k, name]) => {
          const nv = norm.totals[k]!;
          const pi = answer.map((p) => !!p.totals[k]?.v).lastIndexOf(true);
          const before = pi < 0 ? null : orig[pi]!.totals[k]?.v ?? null;
          const unit = k.endsWith("_kg") ? " kg" : "";
          const key = `totals.${k}`;
          return (
            <Field key={k} name={name} value={nv.v ? `${fmt(nv.v)}${unit}` : null} printed={nv.raw !== nv.v ? nv.raw : null}
              warn={warnKeys.has(k)} changed={pi >= 0 && answer[pi]!.totals[k]?.v !== before}
              onStart={pi >= 0 ? () => onStart(key) : undefined}
              editor={pi >= 0 && editing.has(key) && <RawEditor value={answer[pi]!.totals[k]?.v ?? null} before={before} label={t(`${name} 原文`, `${name} printed text`)} onChange={(x) => onChange(pi, k, x)} onDone={() => onDone(key)} />} />
          );
        })}
      </div>
    </Card>
  );
}

function Status({ tone, children }: { tone: "ok" | "warn" | "neutral"; children: ReactNode }) {
  return (
    <li className={cn("flex items-center gap-2", tone === "ok" && "text-ok", tone === "warn" && "font-semibold text-warn")}>
      <span aria-hidden="true" className={cn("size-2 flex-none rounded-full", tone === "neutral" ? "bg-muted-foreground/50" : "bg-current")} />
      {children}
    </li>
  );
}

// One header or total value. The value itself is the control: clicking it opens its printed text for editing.
function Field({ name, value, printed, warn, changed, note, wide, onStart, editor }: {
  name: string; value: string | null; printed: string | null; warn: boolean; changed: boolean;
  note?: ReactNode; wide?: boolean; onStart?: () => void; editor: ReactNode;
}) {
  useLang();
  const shown = cn("font-semibold break-words", !value && "font-normal text-muted-foreground", warn && "text-warn", changed && "bg-edit");
  return (
    <div className={cn(wide && "col-span-full")}>
      <div className="text-[13px] text-muted-foreground">{name}</div>
      {editor || (onStart
        ? <button type="button" onClick={onStart} title={value ? t("點一下修改", "Click to edit") : t("點一下補上", "Click to fill in")}
            className={cn(shown, "group -mx-1.5 block w-[calc(100%+0.75rem)] cursor-text rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring")}>
            {value ?? <><span className="group-hover:hidden group-focus-visible:hidden">—</span><span className="hidden text-primary group-hover:inline group-focus-visible:inline">{t("補上", "Fill in")}</span></>}
          </button>
        : <div className={shown}>{value ?? "—"}</div>)}
      {note}
      {printed && <div className="raw-clamp text-xs text-muted-foreground">{t("原文：", "Printed: ")}{printed}</div>}
    </div>
  );
}

// A raw text editor bound to one value of the model output; leaving it re-normalizes when it changed.
function RawEditor({ value, before, label, onChange, onDone, autoFocus = true }: {
  value: string | null; before: string | null; label: string; onChange: (x: string | null) => void; onDone: () => void; autoFocus?: boolean;
}) {
  const atFocus = useRef(value);
  return (
    <textarea rows={1} aria-label={label} autoFocus={autoFocus} value={value ?? ""}
      className={cn("raw-edit block min-h-[34px] w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm text-foreground", (value || null) !== (before ?? null) && "bg-edit")}
      onFocus={(e) => { atFocus.current = e.target.value || null; }}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      // A standalone editor (autoFocus) closes on blur either way; a row cell only re-normalizes when it changed.
      onBlur={(e) => { if (autoFocus || (e.target.value || null) !== atFocus.current) onDone(); }} />
  );
}

// The printed text of one row, cell by cell, with the column mapping.
function RawRow({ page, ri, before, onChange, onDone }: {
  page: Page; ri: number; before: (ci: number) => string | null; onChange: (ci: number, x: string | null) => void; onDone: () => void;
}) {
  useLang();
  const L = labels();
  const r = page.rows[ri]!;
  // One printed cell can feed several table columns; name them all so a value is found where it is fixed.
  const also: Record<string, string> = {
    pkg_qty: t("、板數（「3PLT」）", ", pallets (\"3PLT\")"), qty: t("、每箱數量（「@」那行）", ", qty per carton (the \"@\" line)"),
    description: t("、料號、稅則、批號、PO", ", part no., HS code, lot, PO"),
  };
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <p className="mb-2 text-xs text-muted-foreground">{t("這一列印在文件上的原文。改這裡，上面表格的值會跟著重算。", "This row as printed. Correct the text here and the values in the table are worked out again.")}</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-3.5 gap-y-2.5">
        {page.columns.map((c, ci) => {
          const label = c.label.replace(/\n/g, " ");
          return (
            <div key={ci} className={cn((c.field === "description" || c.field === "marks") && "col-span-2")}>
              <label className="mb-0.5 block text-xs text-muted-foreground">{t(`「${label}」→ `, `"${label}" → `)}{L.FIELD[c.field] ?? c.field}{also[c.field] ?? ""}</label>
              <RawEditor value={r.cells[ci] ?? null} before={before(ci)} label={t(`${c.label} 原文`, `${c.label} printed text`)} autoFocus={false}
                onChange={(x) => onChange(ci, x)} onDone={onDone} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The printed columns of the current page wired to the standard fields they were read as. Rewiring a column re-normalizes.
function MapCard({ page: p, current, warnCols, pageTabs, changed, onRewire, children }: {
  page: Page; current: number; warnCols: Set<string | undefined>; pageTabs: ReactNode;
  changed: (ci: number) => boolean; onRewire: (ci: number, field: string) => void; children: ReactNode;
}) {
  useLang();
  const L = labels();
  const mapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const sample = (ci: number) => (p.rows.find((r) => r.t === "item" && r.cells[ci])?.cells[ci] ?? "").split("\n")[0];
  const fields = [...new Set(p.columns.map((c) => c.field))];

  // Wires are measured from the laid-out chips, so they are redrawn after every render and on any resize.
  useLayoutEffect(() => {
    const map = mapRef.current!, svg = svgRef.current!, ns = "http://www.w3.org/2000/svg";
    const draw = () => {
      const o = map.getBoundingClientRect();
      svg.replaceChildren();
      map.querySelectorAll<HTMLElement>("[data-src]").forEach((s) => {
        const d = map.querySelector<HTMLElement>(`[data-dst="${CSS.escape(s.dataset.src!)}"]`);
        if (!d) return;
        const a = s.getBoundingClientRect(), b = d.getBoundingClientRect();
        const x1 = a.left + a.width / 2 - o.left, y1 = a.bottom - o.top, x2 = b.left + b.width / 2 - o.left, y2 = b.top - o.top, my = (y1 + y2) / 2;
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`);
        if (s.dataset.edited) path.classList.add("edited");
        svg.append(path);
        for (const [cx, cy] of [[x1, y1], [x2, y2]] as const) {
          const c = document.createElementNS(ns, "circle");
          c.setAttribute("cx", String(cx)); c.setAttribute("cy", String(cy)); c.setAttribute("r", "3.5");
          svg.append(c);
        }
      });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(map);
    window.addEventListener("resize", draw);
    return () => { ro.disconnect(); window.removeEventListener("resize", draw); };
  });

  const chip = "min-w-[104px] max-w-[200px] rounded-[10px] px-2.5 py-[7px] text-[13px] leading-[1.35]";
  const strong = "block truncate font-mono text-[12.5px]";
  const eg = "block truncate font-mono text-[11.5px]";
  return (
    <Card className={SECTION}>
      <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
        <h2 className="text-base font-bold">{t("欄位對應", "Column mapping")}</h2>
      </div>
      {pageTabs}
      <div ref={mapRef} className="relative">
        <svg ref={svgRef} aria-hidden="true" className="wires pointer-events-none absolute inset-0 size-full overflow-visible" />
        <div className="relative flex flex-wrap gap-2.5">
          {p.columns.map((c, ci) => {
            const label = c.label.replace(/\n/g, " "), edited = changed(ci);
            return (
              <div key={ci} data-src={c.field} data-edited={edited || undefined} className={cn(chip, "bg-chip text-chip-foreground", edited && "shadow-[0_0_0_2px_var(--warn)]")}>
                <strong className={strong} title={c.label}>{label}</strong>
                <span className={cn(eg, "text-chip-sub")}>{sample(ci) || "—"}</span>
                <select aria-label={t(`「${label}」這一欄是`, `Column "${label}" is`)} value={c.field} onChange={(e) => onRewire(ci, e.target.value)}
                  className="chip-select mt-1 w-full rounded-md border-0 bg-chip-foreground/15 px-1 py-0.5 text-xs text-chip-foreground">
                  {Object.entries(L.FIELD).map(([f, nm]) => <option key={f} value={f}>→ {nm}</option>)}
                </select>
              </div>
            );
          })}
        </div>
        <div className="relative mt-16 flex flex-wrap gap-2.5">
          {fields.map((f) => (
            <div key={f} data-dst={f} className={cn(chip, "border bg-muted", warnCols.has(FIELD_COL[f] ?? f) && "border-warn-line bg-warn-bg")}>
              <strong className={strong}>{L.FIELD[f] ?? f}</strong>
              <span className={cn(eg, "text-muted-foreground")}>← {p.columns.filter((c) => c.field === f).map((c) => c.label.replace(/\n/g, " ")).join(t("、", ", "))}</span>
            </div>
          ))}
        </div>
      </div>
      {children}
    </Card>
  );
}

// A printed column the read left out: the clerk names it, the server re-reads this page with that hint.
function MissingColumn({ docId, page, answerPage, onRead }: {
  docId: string; page: number; answerPage: Page; onRead: (output: Page) => void;
}) {
  useLang();
  const L = labels();
  const [label, setLabel] = useState("");
  const [field, setField] = useState(Object.keys(L.FIELD)[0]!);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<ReactNode>(null);
  const input = useRef<HTMLInputElement>(null);
  const go = async () => {
    if (!label.trim()) return input.current?.focus();
    setBusy(true);
    setMsg(t("重讀中，約 10–20 秒…", "Re-reading, about 10–20 seconds…"));
    try {
      const j = await post<{ output: Page }>(`/api/documents/${docId}/pages/${page + 1}/columns`, { label, field, page: answerPage });
      setMsg(null);
      onRead(j.output);
    } catch (e) {
      setMsg(isCreditExhausted(e) ? creditText() : errorMessage(e));
    }
    setBusy(false);
  };
  const ctl = "rounded-[10px] border border-input bg-card px-2.5 py-[7px] text-foreground";
  return (
    <details className="mt-3.5 border-t pt-3">
      <summary className="cursor-pointer text-sm font-semibold text-primary">{t("文件上還有一欄沒讀到？", "A printed column was missed?")}</summary>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <input ref={input} type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("文件上印的欄名，例如 P/NO.", "Column name as printed, e.g. P/NO.")}
          aria-label={t("漏掉的欄位在文件上印的欄名", "Printed name of the missed column")} className={cn(ctl, "min-w-[240px] font-mono")} />
        <select aria-label={t("這一欄是", "This column is")} value={field} onChange={(e) => setField(e.target.value)} className={ctl}>
          {Object.entries(L.FIELD).map(([f, nm]) => <option key={f} value={f}>{nm}</option>)}
        </select>
        <Button disabled={busy} onClick={go}>{t(`重讀第 ${page + 1} 頁`, `Re-read page ${page + 1}`)}</Button>
        <span className="text-muted-foreground" role="status">{msg}</span>
      </div>
    </details>
  );
}

// pdf.js draws every page once into its own canvas; the open row's box sits on top in 0–1000 page coordinates, so render scale does not matter.
export function PageViewer({ docId, pageNos, current, box }: { docId: string; pageNos: number[]; current: number; box: number[] | undefined }) {
  useLang();
  const slots = useRef<(HTMLDivElement | null)[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(0);
  const pagesKey = pageNos.join();
  useEffect(() => {
    let dead = false, task: ReturnType<typeof pdfjs.getDocument> | null = null;
    const canvases: HTMLCanvasElement[] = [];
    (async () => {
      const bytes = await (await request(`/api/documents/${docId}/file`)).arrayBuffer();
      if (dead) return;
      task = pdfjs.getDocument({ data: bytes, wasmUrl: new URL(".", new URL(jbig2Url, location.href)).href });
      const pdf = await task.promise;
      for (const [i, n] of pageNos.entries()) {
        if (dead) return;
        const page = await pdf.getPage(n);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.className = "block w-full rounded border bg-white";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", t(`原文件第 ${n} 頁`, `Source document page ${n}`));
        slots.current[i]?.append(canvas);
        canvases.push(canvas);
        await page.render({ canvas, viewport }).promise;
        if (!dead) setLoaded(i + 1);
      }
    })().catch((e) => { if (!dead) setError(e); });
    return () => { dead = true; canvases.forEach((c) => c.remove()); void task?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pagesKey stands for pageNos
  }, [docId, pagesKey]);

  return (
    <div>
      {error != null && <p className="text-destructive" role="alert">{t("原文件載入失敗：", "Could not load the source document: ")}{errorMessage(error)}</p>}
      {error == null && loaded <= current && <p className="text-[13px] text-muted-foreground">{t("原文件載入中…", "Loading the source document…")}</p>}
      {pageNos.map((n, i) => (
        <div key={n} className="relative" hidden={i !== current}>
          <div ref={(el) => { slots.current[i] = el; }} />
          {i === current && box && (
            <div className="pointer-events-none absolute rounded-[3px] border-2 border-primary bg-primary/15"
              style={{ left: `${box[0]! / 10}%`, top: `${box[1]! / 10}%`, width: `${(box[2]! - box[0]!) / 10}%`, height: `${(box[3]! - box[1]!) / 10}%` }} />
          )}
        </div>
      ))}
    </div>
  );
}
