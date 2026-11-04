import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, creditText, errorMessage, isCreditExhausted, post, request, type Delivery, type Doc, type ListedDoc, type SenderInfo } from "./api.ts";
import { Approved, PdfPanel, useApproved } from "./Approved.tsx";
import { FobbyLogo } from "./brand.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card } from "./components/ui/card.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table.tsx";
import { fmt } from "./diff.ts";
import { DeliveryRow, Flow } from "./Flow.tsx";
import { t, useLang } from "./i18n.ts";
import { labels } from "./labels.ts";
import { cn } from "./lib/utils.ts";
import { Review } from "./Review.tsx";
import { Vendors } from "./Vendors.tsx";

// #/vendors and #/flow are the two other areas; #<id> is one document; nothing is the document list.
type Route = { area: "docs" } | { area: "vendors" } | { area: "flow" } | { area: "doc"; id: string };
const parse = (h: string): Route => {
  const x = h.replace(/^#\/?/, "");
  if (x === "vendors") return { area: "vendors" };
  if (x === "flow") return { area: "flow" };
  return /^[\w-]+$/.test(x) ? { area: "doc", id: x } : { area: "docs" };
};
export const go = (hash: string) => { location.hash = hash; };

type Screen =
  | { kind: "busy"; title: string; text: string; step: number }
  | { kind: "failed"; title: string; error: unknown }
  | { kind: "review"; doc: Doc }
  | { kind: "result"; doc: Doc };

export const SECTION = "mb-4 gap-0 rounded-2xl p-[18px]";

export function App() {
  useLang();
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  const [screen, setScreen] = useState<Screen | null>(null);
  // A document opened in this tab is shown at once; a reload or a link fetches it.
  const shown = useRef<string | null>(null);

  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    if (route.area !== "doc" || shown.current === route.id) return;
    shown.current = route.id;
    setScreen({ kind: "busy", title: t("打開文件中…", "Opening the document…"), text: "", step: 0 });
    api<Doc>(`/api/documents/${route.id}`).then(show, (e) => setScreen({ kind: "failed", title: t("打不開這份文件", "Could not open this document"), error: e }));
  }, [route]);

  const show = (doc: Doc) => {
    shown.current = doc.id;
    setScreen(doc.approved ? { kind: "result", doc } : { kind: "review", doc });
    if (location.hash !== `#${doc.id}`) go(doc.id);
  };

  async function upload(f: File) {
    // The busy screen lives in the document area before the document has an id.
    shown.current = "";
    setScreen({ kind: "busy", title: t(`正在讀取 ${f.name}…`, `Reading ${f.name}…`), step: 1,
      text: t("每頁約 5–15 秒。", "About 5–15 seconds a page.") });
    setRoute({ area: "doc", id: "" });
    try {
      show(await api<Doc>(`/api/documents?${new URLSearchParams({ name: f.name })}`, { method: "POST", body: f }));
    } catch (e) {
      setScreen({ kind: "failed", title: t("讀取失敗", "Read failed"), error: e });
    }
  }

  let body: ReactNode = null;
  if (route.area === "docs") body = <Documents onFile={upload} />;
  else if (route.area === "vendors") body = <Vendors />;
  else if (route.area === "flow") body = <Flow />;
  else if (screen?.kind === "busy") body = <><Steps at={screen.step} /><Busy title={screen.title}>{screen.text}</Busy></>;
  else if (screen?.kind === "failed")
    body = <Busy title={screen.title}><ErrorText error={screen.error} /><div className="mt-4"><Button variant="outline" onClick={() => { go(""); setRoute({ area: "docs" }); }}>{t("回到文件清單", "Back to documents")}</Button></div></Busy>;
  else if (screen?.kind === "review") body = <><DocBar doc={screen.doc}><Steps at={3} doc={screen.doc} /></DocBar><Review key={screen.doc.id} doc={screen.doc} onApproved={show} /></>;
  else if (screen?.kind === "result") body = <><div className="mx-auto max-w-[64rem]"><DocBar doc={screen.doc}><Steps at={5} doc={screen.doc} /></DocBar></div><Result key={screen.doc.id} doc={screen.doc} onReopened={show} /></>;

  const area = route.area === "doc" ? "docs" : route.area;
  const nav: [string, string, string][] = [["docs", "#", t("文件", "Documents")], ["vendors", "#/vendors", t("廠商", "Senders")], ["flow", "#/flow", t("出口流程", "Export flow")]];
  return (
    <>
      <header className="sticky top-0 z-20 flex flex-wrap items-stretch gap-x-8 border-b border-white/70 bg-white/70 px-6 backdrop-blur-xl">
        <a href="#" className="m-0 flex items-center py-3 text-[17px] font-bold no-underline" aria-label={t("Fobby Connect 文件清單", "Fobby Connect documents")}><FobbyLogo /></a>
        <nav className="flex gap-6" aria-label={t("主選單", "Main")}>
          {nav.map(([k, href, name]) => (
            <a key={k} href={href} aria-current={area === k ? "page" : undefined}
              className={cn("flex items-center border-b-2 border-transparent pt-0.5 text-sm text-muted-foreground no-underline transition-colors hover:text-foreground",
                area === k && "border-primary font-semibold text-primary hover:text-primary")}>{name}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {/* AGPL §13: people using the hosted site get a way to the source. */}
          <a href="https://github.com/fobby-io/fobby-connect" target="_blank" rel="noreferrer" title={t("原始碼（GitHub）", "Source code (GitHub)")} aria-label={t("原始碼（GitHub）", "Source code (GitHub)")}
            className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <GitHubMark />
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-6 pt-5 pb-32">{body}</main>
    </>
  );
}

/** The row above a document: where it is in the workflow, and deleting it. */
function DocBar({ doc, children }: { doc: Doc; children: ReactNode }) {
  useLang();
  const [state, setState] = useState<"idle" | "confirm" | "busy" | { error: unknown }>("idle");
  async function remove() {
    setState("busy");
    try {
      await request(`/api/documents/${doc.id}`, { method: "DELETE" });
      go("");
    } catch (e) {
      setState({ error: e });
    }
  }
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4">
      {children}
      {state === "idle" ? (
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => setState("confirm")}>
          <TrashIcon />{t("刪除", "Delete")}
        </Button>
      ) : (
        // Asked in place: deleting cannot be undone, and an approved document also stops teaching its sender.
        <div role="group" aria-label={t("確認刪除", "Confirm delete")} className="mb-4 flex flex-wrap items-center gap-2 rounded-full border border-destructive/30 bg-card py-1 pr-1 pl-4 text-sm">
          <span>{typeof state === "object" ? <span className="text-destructive">{errorMessage(state.error)}</span>
            : doc.approved ? t("刪除這份文件，並不再從它學習？無法復原。", "Delete this document and stop learning from it? This cannot be undone.")
            : t("刪除這份文件？無法復原。", "Delete this document? This cannot be undone.")}</span>
          <Button size="sm" variant="destructive" disabled={state === "busy"} onClick={remove}>{state === "busy" ? t("刪除中…", "Deleting…") : t("刪除", "Delete")}</Button>
          <Button size="sm" variant="ghost" disabled={state === "busy"} onClick={() => setState("idle")} autoFocus>{t("取消", "Cancel")}</Button>
        </div>
      )}
    </div>
  );
}

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </svg>
);

/** The whole workflow, with where this document is in it. Review shows as skipped when the document was approved automatically. */
function Steps({ at, doc }: { at: number; doc?: Doc }) {
  useLang();
  const auto = !!doc?.auto?.ok;
  // A first document goes straight to a person without the second check.
  const first = !!doc && !doc.verify && !!doc.auto?.reasons.includes("unknown_sender");
  const names = [t("收件", "Received"), t("讀取", "Read"), first ? t("核對（新廠商略過）", "Check (skipped, new sender)") : t("核對", "Check"),
    auto ? t("審核（自動略過）", "Review (skipped)") : t("人工審核", "Review"), t("確認", "Approve"), t("送出", "Send")];
  return (
    <ol className="steps mb-4 flex list-none flex-wrap gap-1.5 p-0" aria-label={t("處理流程", "Workflow")}>
      {names.map((s, i) => (
        <li key={i} aria-current={i === at ? "step" : undefined}
          className={cn("flex items-center gap-2 rounded-full bg-card py-1 pr-3.5 pl-1 text-sm text-muted-foreground",
            i === at && "on font-semibold text-foreground", i < at && "done", ((auto && i === 3) || (first && i === 2)) && "skip")}>{s}</li>
      ))}
    </ol>
  );
}

export function Busy({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto my-20 max-w-[640px] text-center text-muted-foreground" role="status">
      <strong className="mb-1.5 block text-lg text-foreground">{title}</strong>
      {children}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  useLang();
  return <span>{isCreditExhausted(error) ? creditText() : errorMessage(error)}</span>;
}

export const statusBadge = (d: Pick<ListedDoc, "status" | "reopened">) => {
  // The dot carries the colour so the word stays readable; amber waits for a person, green is done, blue was done without one.
  const tag = "gap-1.5 rounded-full border-0 px-2.5 py-0.5 text-xs font-medium before:size-1.5 before:rounded-full before:bg-current before:content-['']";
  if (d.status === "auto") return <Badge className={cn(tag, "bg-accent text-primary")}>{t("自動確認", "Auto-approved")}</Badge>;
  if (d.status === "approved") return <Badge className={cn(tag, "bg-ok-bg text-ok")}>{t("已確認", "Approved")}</Badge>;
  return <Badge className={cn(tag, "bg-warn-bg text-warn")}>{d.reopened ? t("重新審核", "Reopened") : t("待審核", "To review")}</Badge>;
};

/** A document tile: blue for a packing list, green for a shipping order. */
export const DocIcon = ({ so }: { so?: boolean }) => (
  <span aria-hidden="true" className={cn("grid size-9 flex-none place-items-center rounded-lg", so ? "bg-ok-bg text-ok" : "bg-accent text-primary")}>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  </span>
);

export const Icon = ({ d, className = "text-primary" }: { d: string; className?: string }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={cn("flex-none", className)}><path d={d} /></svg>
);
export const ICON = {
  inbox: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  spark: "M13 2 4 14h7l-1 8 9-12h-7z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  upload: "M12 16V4M7 9l5-5 5 5M5 20h14",
  chevron: "m9 6 6 6-6 6",
};

// GitHub's mark, from Octicons (MIT).
const GitHubMark = () => (
  <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
  </svg>
);

/** Who emailed this document in, and the subject line; nothing for an upload. */
export function ViaEmail({ doc }: { doc: Doc }) {
  if (doc.source?.via !== "email") return null;
  return <p className="text-[13px] text-muted-foreground">{t(`由 ${doc.source.from} 寄來`, `Emailed by ${doc.source.from}`)}{doc.source.subject && t(`：「${doc.source.subject}」`, `: "${doc.source.subject}"`)}</p>;
}

export const when = (iso: string) => (iso ? new Date(iso).toLocaleString(t("zh-TW", "en-US"), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

function Documents({ onFile }: { onFile: (f: File) => void }) {
  useLang();
  const { DOC_TYPE } = labels();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [list, setList] = useState<ListedDoc[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<"all" | "review" | "done">("all");
  const [intake, setIntake] = useState<string | null>(null);
  useEffect(() => {
    api<ListedDoc[]>("/api/documents").then(setList, setError);
    api<{ intake: string | null }>("/api/flow").then((f) => setIntake(f.intake), () => setIntake(null));
  }, []);
  const toReview = list?.filter((d) => d.status === "review") ?? [];
  const shown = !list ? [] : filter === "review" ? toReview : filter === "done" ? list.filter((d) => d.status !== "review") : list;
  const filters = [["all", t("全部", "All"), list?.length ?? 0], ["review", t("待審核", "To review"), toReview.length], ["done", t("已確認", "Approved"), (list?.length ?? 0) - toReview.length]] as const;
  const head = "h-10 px-3 text-[13px] font-semibold text-muted-foreground";
  const cell = "px-3 py-3";
  const panel = "gap-0 p-5";
  const isSO = (d: ListedDoc) => d.cls === "SO";

  return (
    <div className="mx-auto grid max-w-[80rem] grid-cols-[minmax(0,1fr)] gap-5">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card className={panel}>
          <div className="mb-3 flex items-center gap-2">
            <Icon d={ICON.inbox} />
            <h2 className="text-base font-semibold">{t("待審核", "To review")}</h2>
            {toReview.length > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">{toReview.length}</span>}
          </div>
          {!list && error == null && <p className="text-sm text-muted-foreground">{t("載入中…", "Loading…")}</p>}
          {list && !toReview.length && <p className="text-sm text-muted-foreground">{t("沒有在等你的文件。", "Nothing is waiting for you.")}</p>}
          <ul className="m-0 grid list-none gap-1 p-0">
            {toReview.slice(0, 4).map((d) => (
              <li key={d.id}>
                <a href={`#${d.id}`} className="group flex items-center gap-3 rounded-xl p-2 text-foreground no-underline transition-colors hover:bg-accent">
                  <DocIcon so={isSO(d)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.name}</span>
                    <span className="block truncate text-[13px] text-muted-foreground">{d.sender ?? t("還不認得的廠商", "New sender")} · {when(d.created_at)}</span>
                  </span>
                  {d.flagged ? <span className="text-xs font-medium whitespace-nowrap text-warn">{t(`${d.flagged} 個待確認`, `${d.flagged} flagged`)}</span> : null}
                  <Icon d={ICON.chevron} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </a>
              </li>
            ))}
          </ul>
          {toReview.length > 4 && <button type="button" onClick={() => setFilter("review")} className="mt-2 cursor-pointer self-start border-0 bg-transparent p-0 text-sm text-primary hover:underline">{t(`看全部 ${toReview.length} 份`, `See all ${toReview.length}`)}</button>}
        </Card>

        {/* The upload panel is also the drop target; it comes first on a phone. */}
        <section aria-labelledby="upload" className={cn("order-first flex flex-col items-center justify-center rounded-2xl border border-white/80 bg-card px-6 py-8 text-center shadow-[0_1px_2px_rgb(16_40_90/0.04),0_10px_30px_rgb(16_40_90/0.06)] backdrop-blur-xl transition-colors min-[1100px]:order-none",
          over && "border-primary bg-accent")}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
          <span aria-hidden="true" className="relative mb-4 grid size-16 place-items-center rounded-2xl bg-accent text-primary">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>
            <span className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-full border-2 border-white bg-primary text-white">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
            </span>
          </span>
          <h1 id="upload" className="mb-5 text-xl font-semibold tracking-[-0.2px]">{t("上傳裝箱單或託運單", "Upload a packing list or shipping order")}</h1>
          {/* The one filled button on this page. */}
          <Button size="lg" onClick={() => input.current?.click()}><Icon d={ICON.upload} className="" />{t("選擇 PDF", "Choose a PDF")}</Button>
          <input ref={input} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          <p className="mt-3 text-[13px] text-muted-foreground">
            {over ? t("放開就開始讀取", "Release to read it") : intake ? <>{t("或把 PDF 拖到這裡，或寄到 ", "or drop a PDF here, or email it to ")}<span className="font-medium text-foreground select-all">{intake}</span></> : t("或把 PDF 拖到這裡", "or drop a PDF here")}
          </p>
        </section>
      </div>

      <Card className="gap-0 px-5 pt-4 pb-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Icon d={ICON.clock} />
              <h2 className="text-base font-semibold">{t("所有文件", "All documents")}</h2>
            </div>
            <div role="group" aria-label={t("篩選", "Filter")} className="flex gap-1">
              {filters.map(([k, name, n]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                  className={cn("cursor-pointer rounded-full border-0 px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    filter === k ? "bg-accent font-medium text-foreground" : "bg-transparent text-muted-foreground hover:text-foreground")}>
                  {name} <span className="ml-0.5 text-muted-foreground">{n}</span>
                </button>
              ))}
            </div>
          </div>

          {error != null && <p className="py-3 text-destructive" role="alert">{errorMessage(error)}</p>}
          {!list && error == null && <p className="py-6 text-muted-foreground">{t("載入中…", "Loading…")}</p>}
          {list && !shown.length && (
            <p className="border-t py-8 text-center text-muted-foreground">
              {!list.length ? t("還沒有文件。", "No documents yet.")
                : filter === "review" ? t("沒有要審核的文件。", "Nothing is waiting for review.") : t("還沒有確認過的文件。", "Nothing approved yet.")}
            </p>
          )}
          {!!shown.length && (
            <Table className="text-sm">
              <TableHeader>
                <TableRow className="border-0 bg-muted hover:bg-muted [&>th:first-child]:rounded-l-lg [&>th:last-child]:rounded-r-lg">
                  <TableHead className={head}>{t("文件", "Document")}</TableHead>
                  <TableHead className={head}>{t("寄件公司", "Sender")}</TableHead>
                  <TableHead className={head}>{t("狀態", "Status")}</TableHead>
                  <TableHead className={head}>{t("核對", "Check")}</TableHead>
                  <TableHead className={cn(head, "text-right")}>{t("收件時間", "Received")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((d) => (
                  <TableRow key={d.id} onClick={() => go(d.id)} className="cursor-pointer hover:bg-accent/70">
                    <TableCell className={cell}>
                      <span className="flex items-center gap-3">
                        <DocIcon so={isSO(d)} />
                        <span>
                          <a href={`#${d.id}`} className="font-medium text-foreground no-underline hover:underline">{d.name}</a>
                          <span className="block text-[13px] text-muted-foreground">{DOC_TYPE[d.cls ?? ""] ?? d.cls ?? "—"}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className={cn(cell, "max-w-[16rem] truncate")}>{d.sender ?? <span className="text-muted-foreground">{t("還不認得", "Not known yet")}</span>}</TableCell>
                    <TableCell className={cell}>{statusBadge(d)}</TableCell>
                    <TableCell className={cell}>
                      {d.flagged === null ? <span className="text-muted-foreground">{t("未核對", "Not checked")}</span>
                        : d.flagged ? <span className="font-medium text-warn">{t(`${d.flagged} 個待確認`, `${d.flagged} flagged`)}</span>
                        : <span className="text-muted-foreground">{t("全部通過", "All passed")}</span>}
                    </TableCell>
                    <TableCell className={cn(cell, "text-right whitespace-nowrap text-muted-foreground")}>{when(d.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </Card>
    </div>
  );
}

// "1 document", "3 documents"; Chinese has no plural.
const many = (n: number, word: string) => t(`${n} 份${word}`, `${n} ${word}${n === 1 ? "" : "s"}`);

function Export({ doc }: { doc: Doc }) {
  useLang();
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const [deliveries, setDeliveries] = useState<Delivery[]>(doc.deliveries ?? []);
  const [sending, setSending] = useState<"idle" | "busy" | { error: unknown }>("idle");
  const sendNow = async () => {
    setSending("busy");
    try { setDeliveries((await post<{ deliveries: Delivery[] }>(`/api/documents/${doc.id}/send`, {})).deliveries); setSending("idle"); }
    catch (e) { setSending({ error: e }); }
  };
  const base = `/api/documents/${doc.id}/export`;
  const url = location.origin + `${base}.json`;
  // The clipboard is missing outside https and can refuse; then the address is shown to copy by hand.
  const copyUrl = async () => {
    try { await navigator.clipboard.writeText(url); setCopy("done"); setTimeout(() => setCopy("idle"), 2000); }
    catch { setCopy("failed"); }
  };
  return (
    <Card className="gap-0 p-6">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{t("送出", "Export")}</h2>
        <a href="#/flow" className="text-sm text-primary">{t("出口設定 →", "Export settings →")}</a>
      </div>
      {doc.approved?.approved_at ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={sending === "busy"} onClick={sendNow}>{sending === "busy" ? t("送出中…", "Sending…") : t("現在送出", "Send now")}</Button>
            {doc.download && (
              <>
                <Button asChild variant="outline"><a href={`${base}.json`} download>{t("下載 JSON", "Download JSON")}</a></Button>
                <Button asChild variant="outline"><a href={`${base}.csv`} download>{t("下載 CSV", "Download CSV")}</a></Button>
                <Button variant="ghost" onClick={copyUrl}>{copy === "done" ? t("已複製", "Copied") : t("複製 JSON 網址", "Copy JSON link")}</Button>
              </>
            )}
          </div>
          <div role="status" className="mt-2 text-sm text-muted-foreground empty:hidden">
            {copy === "failed" && <>{t("無法自動複製，請手動複製：", "Could not copy; copy it by hand: ")}<code className="select-all break-all">{url}</code></>}
            {typeof sending === "object" && <span className="text-destructive" role="alert">{errorMessage(sending.error)}</span>}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">{t("這份是舊版核准的，要匯出請重新上傳。", "Approved before export existed; upload it again to export.")}</p>
      )}
      {deliveries.length > 0 && (
        <>
          <h3 className="mt-5 mb-1 text-sm font-semibold">{t("送出紀錄", "Deliveries")}</h3>
          <ul className="list-none p-0">{deliveries.map((d) => <DeliveryRow key={d.id} d={d} />)}</ul>
        </>
      )}
    </Card>
  );
}

function Result({ doc, onReopened }: { doc: Doc; onReopened: (d: Doc) => void }) {
  useLang();
  const { FIELD, HEAD, TOTAL } = labels();
  const a = doc.approved!, auto = !!doc.auto?.ok;
  // Learning runs on the server after the approval; this page asks again until it has ended.
  const [l, setL] = useState(a.learn);
  useEffect(() => {
    if (l.outcome !== "pending") return;
    const timer = setInterval(() => {
      api<Doc>(`/api/documents/${doc.id}`).then((d) => { if (d.approved && d.approved.learn.outcome !== "pending") setL(d.approved.learn); }, () => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [doc.id, l.outcome]);
  const [info, setInfo] = useState<SenderInfo | null>(null);
  const [reopen, setReopen] = useState<"idle" | "busy" | { error: unknown }>("idle");
  useEffect(() => { api<SenderInfo[]>("/api/senders").then((s) => setInfo(s.find((x) => x.sender === a.sender) ?? null), () => {}); }, [a.sender]);
  const cls = doc.run.cls ?? "PL";
  const approvedData = useApproved(doc.id, !!a.approved_at);
  const [pdf, setPdf] = useState(false);
  const closePdf = useCallback(() => setPdf(false), []);
  // Counts come from what was approved; documents approved before export existed fall back to what was read.
  const n = approvedData.rec ?? doc.normalized;
  const sum = (k: string) => n.rows.reduce((x, r) => x + Number((r as unknown as Record<string, { v: string | null }>)[k]?.v ?? 0), 0);
  const v = doc.verify;
  const fields = (ps: string[]) => ps.map((p) => { const k = p.split(".").pop()!; return FIELD[k] ?? HEAD[k] ?? TOTAL[k] ?? p; }).join(t("、", ", "));

  const markWrong = async () => {
    setReopen("busy");
    try { onReopened(await post<Doc>(`/api/documents/${doc.id}/reopen`, {})); } catch (e) { setReopen({ error: e }); }
  };

  // What happened to this sender's reading is the point of this screen, so it comes first.
  let tone: "ok" | "warn" | "info" | "plain" = "plain", title: string, body: ReactNode, next: string | null = null;
  if (l.outcome === "pending") {
    tone = "info";
    title = t("正在從你的修正學習", "Learning from your corrections");
    body = <p>{t("在背景重讀這家已確認的文件，確認新的讀法比較好才換上，約 1 到 3 分鐘。你可以繼續處理下一份，這裡會自己更新。", "Re-reading this sender's approved documents in the background; the new reading is used only if it does better. About 1 to 3 minutes. Carry on with the next document; this updates by itself.")}</p>;
  } else if (l.outcome === "failed") {
    tone = "warn";
    title = t("這次的學習沒有完成", "Learning did not finish this time");
    body = <p>{t("確認和匯出不受影響；這家的讀法維持原樣。", "The approval and exports stand; this sender is read as before.")}</p>;
  } else if (l.outcome === "activated") {
    const before = l.scores.current.reduce((x, y) => x + y, 0), after = l.scores.candidate.reduce((x, y) => x + y, 0);
    tone = "ok";
    title = t("從你的修正學到了", "Learned from your corrections");
    body = (
      <>
        <p>{t(`依你的 ${a.corrected} 處修正；重讀 ${l.scores.candidate.length} 份已確認文件，要改的地方 ${before} → ${after}。`,
          `From your ${a.corrected === 1 ? "1 correction" : `${a.corrected} corrections`}; re-read on ${many(l.scores.candidate.length, "approved document")}, corrections needed ${before} → ${after}.`)}</p>
        {l.version.notes.length > 0 && <ul className="mt-2 list-disc pl-5">{l.version.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      </>
    );
  } else if (l.outcome === "kept") {
    tone = "warn";
    title = t("這次沒學會", "Could not learn from this");
    body = <p>{t(`這家以後固定請人確認：${fields(l.always_review)}`, `Always reviewed for this sender from now on: ${fields(l.always_review)}`)}</p>;
  } else if (auto) {
    tone = "ok";
    title = t("自動確認", "Approved automatically");
    body = <p>{t(`${v?.checked ?? 0} 個值全部核對通過。`, `All ${v?.checked ?? 0} values passed the check.`)}</p>;
  } else {
    // Approved as read: nothing happened worth a card, only what it means for the next document.
    title = "";
    body = null;
  }
  // Only what changes the user's next step is said; how the sender is learned lives on the Senders page.
  let note: string | null = null;
  if (info?.hold) {
    const paused = t(`${a.sender} 的自動確認暫停中`, `Automatic approval for ${a.sender} is paused`);
    if (tone === "plain") note = paused; else next = paused;
  }
  // Corrections the printed text does not explain are not learned from: they point at a conversion rule.
  if (a.rules) {
    const rules = t(`${a.rules} 個修正是換算規則的問題（原文沒讀錯），已記下待查，不拿來學習。`, `${a.rules === 1 ? "1 correction is" : `${a.rules} corrections are`} about a conversion rule (the printed text was read right): noted for a fix, not learned from.`);
    note = note ? `${note}。${rules}` : rules;
  }

  const stats: [number, string][] = [[n.rows.length, t("列明細", "line items")], [sum("pkgs"), t("箱", "cartons")], [sum("gw_kg"), t("毛重 kg", "gross kg")]];
  if (v) stats.push([v.checked, t("個值核對過", "values checked")]);

  return (
    // With the PDF open on a wide screen the page splits in two so both can be scrolled side by side.
    <div className={cn("mx-auto grid grid-cols-[minmax(0,1fr)] items-start gap-5", pdf ? "max-w-[110rem] min-[1100px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" : "max-w-[64rem]")}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Card className="gap-0 p-6">
        <div className="flex flex-wrap items-start gap-4">
          <DocIcon so={cls === "SO"} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.3px]">{doc.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {statusBadge({ status: auto ? "auto" : "approved", reopened: false })}
              <span>{a.sender}</span>
              {a.approved_at && <span>· {when(a.approved_at)}</span>}
            </p>
            <ViaEmail doc={doc} />
          </div>
          <Button variant="outline" size="sm" disabled={reopen === "busy"} onClick={markWrong}>{t("有錯，重新審核", "Reopen for review")}</Button>
        </div>
        {typeof reopen === "object" && <p className="mt-2 text-sm text-destructive" role="alert">{errorMessage(reopen.error)}</p>}
        <dl className="m-0 mt-5 grid grid-cols-2 gap-y-3 border-t pt-4 min-[600px]:grid-cols-4">
          {stats.map(([x, label], i) => (
            <div key={label} className={cn("px-4 first:pl-0", i % 2 && "border-l", i === 2 && "min-[600px]:border-l")}>
              <dd className="m-0 text-2xl font-semibold">{fmt(String(Math.round(x * 1000) / 1000))}</dd>
              <dt className="text-[13px] text-muted-foreground">{label}</dt>
            </div>
          ))}
        </dl>
        {note && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-accent px-3.5 py-2.5 text-sm">
            <Icon d={ICON.spark} className="mt-0.5 text-primary" />
            <span>{note}</span>
          </p>
        )}
      </Card>

      {tone !== "plain" && (
        <Card className={cn("gap-0 p-6", tone === "ok" && "bg-ok-bg/80", tone === "warn" && "bg-warn-bg/80")}>
          <h2 className={cn("mb-2 text-lg font-semibold", tone === "ok" && "text-ok", tone === "warn" && "text-warn")}>{title}</h2>
          <div className="text-[15px]">{body}</div>
          {next && <p className="mt-3 text-sm text-muted-foreground">{next}</p>}
        </Card>
      )}

      {a.approved_at && <Approved {...approvedData} onViewPdf={() => setPdf(true)} />}

      <Export doc={doc} />
      </div>
      {pdf && approvedData.rec && <PdfPanel docId={doc.id} pages={approvedData.rec.source.pages} onClose={closePdf} />}
    </div>
  );
}
