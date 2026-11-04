import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { CREDIT_TEXT, isCreditExhausted, post, request, type Doc, type NormDoc } from "./api.ts";
import { Busy, ErrorText, Samples } from "./App.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card } from "./components/ui/card.tsx";
import { Input } from "./components/ui/input.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table.tsx";
import { colChanged, edits, fmt, origCell, problems, rowChanged, type Finding, type Page } from "./diff.ts";
import { COLS, DOC_TYPE, FIELD, FIELD_COL, HEAD, TOTAL } from "./labels.ts";
import { cn } from "./lib/utils.ts";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Row = { page: number; row: number };
type V = { v: string | null; raw: string | null };
const SECTION = "mb-4 gap-0 rounded-2xl p-[18px] shadow-none";
const LINK = "h-auto p-0 text-[13px] underline";
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Review({ doc, onStep, onApproved, onOpen }: {
  doc: Doc; onStep: (n: number) => void; onApproved: (d: Doc) => void; onOpen: (d: Doc) => void;
}) {
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
      if (mine === seq.current) setRefreshError(`重算失敗：${errText(e)}`);
    }
  };

  const n = edits(orig, answer);

  async function approve() {
    if (approval) return;
    if (!sender.trim()) return senderInput.current?.focus();
    setApproval({ busy: true });
    onStep(3);
    try {
      const j = await post<{ corrected: number; learn: NonNullable<Doc["approved"]>["learn"]; approved_at?: string }>(`/api/documents/${doc.id}/approve`, { sender, answer: answerRef.current });
      onApproved({ ...doc, approved: { sender: sender.trim().toUpperCase(), learn: j.learn, corrected: j.corrected, approved_at: j.approved_at } });
    } catch (e) {
      setApproval({ error: e });
    }
  }

  if (approval && "busy" in approval)
    return (
      <Busy title={n ? "正在學習你的修正…" : "存檔中…"}>
        {n ? "系統會寫一版新的讀法，並用它重讀這家以前確認過的文件，確定沒有變差才會採用。約 30 秒到 2 分鐘。" : ""}
      </Busy>
    );
  if (approval)
    return (
      <Busy title="沒有存成功">
        <ErrorText error={approval.error} onOpen={onOpen} />
        <div className="mt-4"><Button variant="outline" onClick={() => { setApproval(null); onStep(2); }}>回到檢查與修正</Button></div>
      </Busy>
    );

  const probs = problems(findings);
  const warnCols = new Set(probs.map((p) => p.col).filter(Boolean));
  const warnKeys = new Set(probs.map((p) => p.key));
  const issuer = norm.header.shipper?.v ?? ((run.issuer ?? "").split("\n")[0] || "（沒讀到寄件公司）");
  const sum = (k: string) => norm.rows.reduce((a, r) => a + Number((r as unknown as Record<string, V>)[k]!.v ?? 0), 0);
  const p0 = run.prompt;
  const sourceLine = p0?.level === "sender"
    ? `這家已經學過，用它專屬的讀法（第 ${p0.version} 版）。`
    : `這家第一次出現，用${p0?.level === "class" ? `${run.cls} 的通用讀法` : "最基本的讀法"}。你確認後，系統會記住這家的格式。`;

  const pageTabs = run.pages.length > 1 && (
    <div className="mb-2.5 flex flex-wrap gap-1.5">
      {run.pages.map((p, i) => (
        <Button key={p.page_no} size="sm" variant="outline" className={cn(i === current && "border-primary font-semibold text-primary")}
          onClick={() => setCurrent(i)}>第 {p.page_no} 頁</Button>
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
            <h2 className="mb-1 text-[22px] font-bold tracking-tight">{issuer} 的{DOC_TYPE[run.cls ?? ""] ?? "文件"}</h2>
            <p className="text-muted-foreground">共 {run.pages.length} 頁。{sourceLine}</p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {([[norm.rows.length, "列明細"], [sum("pkgs"), "箱"], [sum("pallets"), "板"], [sum("gw_kg"), "毛重 kg"]] as const).map(([v, label]) => (
              <div key={label} className="min-w-[110px] rounded-xl border bg-muted px-3.5 py-2">
                <b className="block font-mono text-[22px] leading-tight font-semibold">{fmt(String(Math.round(v * 1000) / 1000))}</b>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
        {probs.length ? (
          <div className="mt-3.5 rounded-[10px] border border-warn-line bg-warn-bg px-4 py-3">
            <h3 className="mb-1.5 text-[15px] font-bold text-warn">需要你確認 {probs.length} 處</h3>
            <ol className="list-decimal pl-5">
              {probs.map((p) => (
                <li key={p.text} className="my-1">{p.text}。
                  <Button variant="link" className={cn(LINK, "ml-1.5")} onClick={() => { setCurrent(p.pages[0]! - 1); setOpenRow(null); }}>看第 {p.pages.join("、")} 頁</Button>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[13px] text-muted-foreground">標橘色的是相關欄位。點那一列可以看到原文並修改；如果原本就對（例如合計本來就含棧板重量），直接確認即可。</p>
          </div>
        ) : (
          <div className="mt-3.5 rounded-[10px] bg-ok-bg px-4 py-3 text-ok">自動核對全部通過：加總、板數、嘜頭上的 PO、各頁抬頭都一致。快速看過一遍沒問題就可以確認。</div>
        )}
      </section>

      <MapCard key={current} page={answer[current]!} current={current} warnCols={warnCols} pageTabs={pageTabs}
        changed={(ci) => colChanged(orig, answer, current, ci)}
        onRewire={(ci, field) => { update((a) => { a[current]!.columns[ci]!.field = field as Page["columns"][number]["field"]; }); void refresh(); }}>
        <MissingColumn docId={doc.id} page={current} answerPage={answer[current]!} onOpen={onOpen}
          onRead={(output) => { update((a) => { a[current] = output; }); setOpenRow(null); void refresh(); }} />
      </MapCard>

      <div className="grid items-start gap-4 min-[1101px]:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
        <Card className={cn(SECTION, "min-[1101px]:sticky min-[1101px]:top-3")}>
          {pageTabs}
          <PageViewer docId={doc.id} pageNos={run.pages.map((p) => p.page_no)} current={current} box={openPage} />
          <p className="mt-2 text-[13px] text-muted-foreground">點右邊的明細列，原頁會跳到那一頁並框出位置。</p>
        </Card>

        <div>
          <Card className={SECTION}>
            <h3 className="mb-3 text-base font-bold">文件抬頭</h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-5 gap-y-3">
              {Object.entries(HEAD).map(([k, name]) => {
                const nv = norm.header[k];
                const pi = (nv?.page ?? 1) - 1;
                const before = orig[pi]!.header[k]?.v ?? null;
                const now = answer[pi]!.header[k]?.v ?? null;
                const key = `header.${k}`;
                return (
                  <div key={k} className={cn(k === "shipping_marks" && "col-span-full")}>
                    <div className="text-[13px] text-muted-foreground">{name}</div>
                    <div className={cn("font-semibold break-words", !nv?.v && "font-normal text-muted-foreground", warnKeys.has(k) && "text-warn", (now || null) !== before && "bg-edit")}>{nv?.v ?? "—"}</div>
                    {nv?.raw && nv.raw !== nv.v && <div className="raw-clamp text-xs text-muted-foreground">原文：{nv.raw}</div>}
                    {editing.has(key)
                      ? <RawEditor value={answer[pi]!.header[k]?.v ?? null} before={before} label={`${name} 原文`}
                          onChange={(x) => update((a) => { a[pi]!.header[k]!.v = x ?? ""; })} onDone={() => doneEdit(key)} />
                      : <Button variant="link" className={LINK} onClick={() => startEdit(key, (a) => { a[pi]!.header[k] ??= { v: "", box: [0, 0, 0, 0] }; })}>{nv?.raw ? "修改" : "補上"}</Button>}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className={SECTION}>
            <h3 className="mb-3 text-base font-bold">明細</h3>
            <div className="overflow-hidden rounded-lg border">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="px-2.5 font-semibold">頁</TableHead>
                    {COLS.map(([k, name, cls]) => (
                      <TableHead key={k} className={cn("px-2.5 font-semibold", cls === "num" && "text-right", warnCols.has(k) && "text-warn shadow-[inset_0_-3px_0_var(--warn)]")}>{name}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {norm.rows.flatMap((r) => {
                    const pi = r.page - 1, isOpen = openRow?.page === pi && openRow.row === r.row;
                    const cells = r as unknown as Record<string, V>;
                    const span = (a: V, b: V) => (a.v ? (a.v === b.v ? a.v : `${a.v}–${b.v}`) : "");
                    const tr = (
                      <TableRow key={`${pi}-${r.row}`} title="點一下看原文"
                        className={cn("cursor-pointer hover:bg-primary/5", isOpen && "bg-primary/10 hover:bg-primary/10", rowChanged(orig, answer, pi, r.row) && "[&>td:first-child]:shadow-[inset_4px_0_0_#d6a800]")}
                        onClick={() => { setOpenRow(isOpen ? null : { page: pi, row: r.row }); setCurrent(pi); }}>
                        <TableCell className="px-2.5 py-2 align-top">{r.page}</TableCell>
                        {COLS.map(([k, , cls]) => {
                          let content = fmt(cells[k]?.v);
                          if (k === "pkg_range") content = span(r.pkg_from, r.pkg_to);
                          if (k === "pallet_range") content = span(r.pallet_from, r.pallet_to);
                          if (k === "qty" && r.qty_unit.v) content = `${content} ${r.qty_unit.v}`;
                          return (
                            <TableCell key={k} className={cn("px-2.5 py-2 align-top",
                              cls === "num" && "text-right font-mono text-[13px]",
                              k === "description" ? "min-w-[220px] text-[13px] whitespace-normal" : "whitespace-nowrap",
                              ["po", "part_no", "pkg_range", "pallet_range"].includes(k) && "font-mono text-[13px]",
                              warnCols.has(k) && "bg-warn-bg shadow-[inset_0_0_0_1px_var(--warn-line)]")}>
                              {content}
                              {k === "part_no" && r.revision.v && <span className="block text-xs text-muted-foreground">版次 {r.revision.v}</span>}
                              {k === "description" && (r.hs_code.v || r.lot_no.v) && (
                                <span className="block text-xs text-muted-foreground">{[r.hs_code.v && `稅則 ${r.hs_code.v}`, r.lot_no.v && `批號 ${r.lot_no.v}`].filter(Boolean).join("　")}</span>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                    if (!isOpen) return [tr];
                    return [tr, (
                      <TableRow key={`${pi}-${r.row}-raw`} className="hover:bg-transparent">
                        <TableCell colSpan={COLS.length + 1} className="bg-muted px-3.5 py-3 whitespace-normal">
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
        <div className="flex items-center gap-2">
          <label htmlFor="sender">寄件公司</label>
          <Input id="sender" ref={senderInput} className="w-auto min-w-[220px]" value={sender} onChange={(e) => setSender(e.target.value)} />
        </div>
        <span className="text-muted-foreground" role="status">{refreshError ?? (n ? `你改了 ${n} 處` : "還沒有修改")}</span>
        <Button className="ml-auto" onClick={approve}>{n ? "確認修正，讓系統學起來" : "全部正確，確認"}</Button>
      </div>
    </>
  );
}

// Totals: normalized, editable on the page that prints them.
function Totals({ norm, orig, answer, warnKeys, editing, onStart, onDone, onChange }: {
  norm: NormDoc; orig: Page[]; answer: Page[]; warnKeys: Set<string>; editing: Set<string>;
  onStart: (key: string) => void; onDone: (key: string) => void; onChange: (pi: number, k: string, x: string | null) => void;
}) {
  const totals = Object.entries(TOTAL).filter(([k]) => norm.totals[k]?.raw);
  if (!totals.length) return null;
  return (
    <Card className={SECTION}>
      <h3 className="mb-3 text-base font-bold">合計</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-5 gap-y-3">
        {totals.map(([k, name]) => {
          const nv = norm.totals[k]!;
          const pi = answer.map((p) => !!p.totals[k]?.v).lastIndexOf(true);
          const before = pi < 0 ? null : orig[pi]!.totals[k]?.v ?? null;
          const unit = k.endsWith("_kg") ? " kg" : "";
          const key = `totals.${k}`;
          return (
            <div key={k}>
              <div className="text-[13px] text-muted-foreground">{name}</div>
              <div className={cn("font-semibold break-words", warnKeys.has(k) && "text-warn", pi >= 0 && answer[pi]!.totals[k]?.v !== before && "bg-edit")}>{fmt(nv.v)}{nv.v ? unit : ""}</div>
              {nv.raw !== nv.v && <div className="raw-clamp text-xs text-muted-foreground">原文：{nv.raw}</div>}
              {pi >= 0 && (editing.has(key)
                ? <RawEditor value={answer[pi]!.totals[k]?.v ?? null} before={before} label={`${name} 原文`} onChange={(x) => onChange(pi, k, x)} onDone={() => onDone(key)} />
                : <Button variant="link" className={LINK} onClick={() => onStart(key)}>修改</Button>)}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// A raw text editor bound to one value of the model output; leaving it re-normalizes when it changed.
function RawEditor({ value, before, label, onChange, onDone, autoFocus = true }: {
  value: string | null; before: string | null; label: string; onChange: (x: string | null) => void; onDone: () => void; autoFocus?: boolean;
}) {
  const atFocus = useRef(value);
  return (
    <textarea rows={1} aria-label={label} autoFocus={autoFocus} value={value ?? ""}
      className={cn("raw-edit block min-h-[34px] w-full rounded-md border bg-card px-2 py-1.5 text-sm text-foreground", (value || null) !== (before ?? null) && "bg-edit")}
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
  const r = page.rows[ri]!;
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-3.5 gap-y-2.5">
        {page.columns.map((c, ci) => {
          const label = c.label.replace(/\n/g, " ");
          return (
            <div key={ci} className={cn((c.field === "description" || c.field === "marks") && "col-span-2")}>
              <label className="mb-0.5 block text-xs text-muted-foreground">「{label}」→ {FIELD[c.field] ?? c.field}</label>
              <RawEditor value={r.cells[ci] ?? null} before={before(ci)} label={`${c.label} 原文`} autoFocus={false}
                onChange={(x) => onChange(ci, x)} onDone={onDone} />
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">這裡是文件上印的原文。改原文會重新整理成上面的標準格式；欄位對應錯了，到上方「欄位對應」改。</p>
    </div>
  );
}

// The printed columns of the current page wired to the standard fields they were read as. Rewiring a column re-normalizes.
function MapCard({ page: p, current, warnCols, pageTabs, changed, onRewire, children }: {
  page: Page; current: number; warnCols: Set<string | undefined>; pageTabs: ReactNode;
  changed: (ci: number) => boolean; onRewire: (ci: number, field: string) => void; children: ReactNode;
}) {
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
        <h3 className="text-base font-bold">欄位對應</h3>
        <span className="text-[13px] text-muted-foreground">第 {current + 1} 頁：上面是文件印的欄位和第一列的內容，下面是系統的標準欄位</span>
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
                <select aria-label={`「${label}」這一欄是`} value={c.field} onChange={(e) => onRewire(ci, e.target.value)}
                  className="chip-select mt-1 w-full rounded-md border-0 bg-chip-foreground/15 px-1 py-0.5 text-xs text-chip-foreground">
                  {Object.entries(FIELD).map(([f, nm]) => <option key={f} value={f}>→ {nm}</option>)}
                </select>
              </div>
            );
          })}
        </div>
        <div className="relative mt-16 flex flex-wrap gap-2.5">
          {fields.map((f) => (
            <div key={f} data-dst={f} className={cn(chip, "border bg-muted", warnCols.has(FIELD_COL[f] ?? f) && "border-warn-line bg-warn-bg")}>
              <strong className={strong}>{FIELD[f] ?? f}</strong>
              <span className={cn(eg, "text-muted-foreground")}>← {p.columns.filter((c) => c.field === f).map((c) => c.label.replace(/\n/g, " ")).join("、")}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3.5 text-center text-[13px] text-muted-foreground">{p.columns.length} 個印出來的欄位，對應到 {fields.length} 個標準欄位。線連錯了，在上面那一欄的選單改，明細會馬上重算。</p>
      {children}
    </Card>
  );
}

// A printed column the read left out: the clerk names it, the server re-reads this page with that hint.
function MissingColumn({ docId, page, answerPage, onRead, onOpen }: {
  docId: string; page: number; answerPage: Page; onRead: (output: Page) => void; onOpen: (d: Doc) => void;
}) {
  const [label, setLabel] = useState("");
  const [field, setField] = useState(Object.keys(FIELD)[0]!);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<ReactNode>(null);
  const input = useRef<HTMLInputElement>(null);
  const go = async () => {
    if (!label.trim()) return input.current?.focus();
    setBusy(true);
    setMsg("重讀中，約 10–20 秒…");
    try {
      const j = await post<{ output: Page }>(`/api/documents/${docId}/pages/${page + 1}/columns`, { label, field, page: answerPage });
      setMsg(null);
      onRead(j.output);
    } catch (e) {
      setMsg(isCreditExhausted(e) ? <span className="block w-full">{CREDIT_TEXT}<span className="mt-2 block"><Samples onOpen={onOpen} /></span></span> : errText(e));
    }
    setBusy(false);
  };
  const ctl = "rounded-[10px] border bg-card px-2.5 py-[7px] text-foreground";
  return (
    <details className="mt-3.5 border-t pt-3">
      <summary className="cursor-pointer text-sm font-semibold text-primary">文件上還有一欄沒讀到？</summary>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <input ref={input} type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="文件上印的欄名，例如 P/NO." aria-label="漏掉的欄位在文件上印的欄名" className={cn(ctl, "min-w-[240px] font-mono")} />
        <select aria-label="這一欄是" value={field} onChange={(e) => setField(e.target.value)} className={ctl}>
          {Object.entries(FIELD).map(([f, nm]) => <option key={f} value={f}>{nm}</option>)}
        </select>
        <Button disabled={busy} onClick={go}>重讀第 {page + 1} 頁</Button>
        <span className="text-muted-foreground" role="status">{msg}</span>
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">系統會帶著這個欄名重讀這一頁，只把新讀到的欄位補進來，其他格子和你改過的內容都不動。確認後，下次這家的文件會記得有這一欄。</p>
    </details>
  );
}

// pdf.js draws every page once into its own canvas; the open row's box sits on top in 0–1000 page coordinates, so render scale does not matter.
function PageViewer({ docId, pageNos, current, box }: { docId: string; pageNos: number[]; current: number; box: number[] | undefined }) {
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
      task = pdfjs.getDocument({ data: bytes });
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
        canvas.setAttribute("aria-label", `原文件第 ${n} 頁`);
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
      {error != null && <p className="text-warn" role="alert">原文件載入失敗：{errText(error)}</p>}
      {error == null && loaded <= current && <p className="text-[13px] text-muted-foreground">原文件載入中…</p>}
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
