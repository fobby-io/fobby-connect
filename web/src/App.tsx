import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, creditText, errorMessage, isCreditExhausted, post, type Delivery, type Doc, type ListedDoc, type Sample, type SenderInfo } from "./api.ts";
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
      text: t("第一系統逐頁讀出每個欄位，每頁約 5–15 秒；讀完由第二系統逐一核對每個值。", "The first system reads every field, about 5–15 seconds a page; then the second system checks every value.") });
    setRoute({ area: "doc", id: "" });
    try {
      show(await api<Doc>(`/api/documents?${new URLSearchParams({ name: f.name })}`, { method: "POST", body: f }));
    } catch (e) {
      setScreen({ kind: "failed", title: t("讀取失敗", "Read failed"), error: e });
    }
  }

  let body: ReactNode = null;
  if (route.area === "docs") body = <Documents onFile={upload} onOpen={show} />;
  else if (route.area === "vendors") body = <Vendors />;
  else if (route.area === "flow") body = <Flow />;
  else if (screen?.kind === "busy") body = <><Steps at={screen.step} /><Busy title={screen.title}>{screen.text}</Busy></>;
  else if (screen?.kind === "failed")
    body = <Busy title={screen.title}><ErrorText error={screen.error} onOpen={show} /><div className="mt-4"><Button variant="outline" onClick={() => { go(""); setRoute({ area: "docs" }); }}>{t("回到文件清單", "Back to documents")}</Button></div></Busy>;
  else if (screen?.kind === "review") body = <><Steps at={3} doc={screen.doc} /><Review key={screen.doc.id} doc={screen.doc} onOpen={show} onApproved={show} /></>;
  else if (screen?.kind === "result") body = <><Steps at={5} doc={screen.doc} /><Result key={screen.doc.id} doc={screen.doc} onReopened={show} /></>;

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

/** The whole workflow, with where this document is in it. Review shows as skipped when the document was approved automatically. */
function Steps({ at, doc }: { at: number; doc?: Doc }) {
  useLang();
  const auto = !!doc?.auto?.ok;
  // A first document goes straight to a person without the second check.
  const first = !!doc && !doc.verify && !!doc.auto?.reasons.includes("unknown_sender");
  const names = [t("收件", "Received"), t("第一系統讀取", "First read"), first ? t("第二系統核對（新廠商略過）", "Second check (skipped: new sender)") : t("第二系統核對", "Second check"),
    auto ? t("審核（自動略過）", "Review (skipped)") : t("人工審核", "Review"), t("確認並學習", "Approve and learn"), t("送出", "Send")];
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

// Every API error is shown; running out of demo credit points at the samples, which cost nothing.
export function ErrorText({ error, onOpen }: { error: unknown; onOpen: (d: Doc) => void }) {
  useLang();
  if (isCreditExhausted(error)) return <div><p className="mb-3">{creditText()}</p><Samples onOpen={onOpen} lead={SAMPLE_LEAD()} /></div>;
  return <span>{errorMessage(error)}</span>;
}

export const SAMPLE_LEAD = () => t("可以先打開已經讀好的範例貨件：", "You can open a sample shipment, already read, instead:");

/** Sample shipments are demo data a host may or may not carry; with none, this shows nothing. */
export function Samples({ onOpen, given, lead }: { onOpen: (d: Doc) => void; given?: Sample[]; lead?: string }) {
  useLang();
  const [fetched, setList] = useState<Sample[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => { if (!given) api<Sample[]>("/api/samples").then(setList, () => setList([])); }, [given]);
  const list = given ?? fetched;
  if (!list?.length) return null;
  const open = async (s: Sample) => {
    setOpening(s.id);
    setError(null);
    try {
      onOpen(await api<Doc>(`/api/samples/${s.id}/open`, { method: "POST" }));
    } catch (e) {
      setError(e);
      setOpening(null);
    }
  };
  return (
    <div className="text-left">
      {lead && <p className="mb-2">{lead}</p>}
      <ul className="m-0 grid list-none gap-2 p-0">
        {list.map((s) => (
          <li key={s.id}>
            <button type="button" disabled={!!opening} onClick={() => open(s)} aria-busy={opening === s.id}
              className="group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-white/70 px-3 py-2.5 text-left text-foreground transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-60">
              <DocIcon so={/shipping order/i.test(s.name)} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{s.name}</span>
                <span className="block truncate text-[13px] text-muted-foreground">{opening === s.id ? t("讀取並核對中…", "Opening and checking…") : s.sender}</span>
              </span>
              <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                className="flex-none text-primary transition-transform group-hover:translate-x-0.5"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
            </button>
          </li>
        ))}
      </ul>
      {error != null && <p className="mt-2 text-sm text-destructive" role="alert">{errorMessage(error)}</p>}
    </div>
  );
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

const Icon = ({ d, className = "text-primary" }: { d: string; className?: string }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={cn("flex-none", className)}><path d={d} /></svg>
);
const ICON = {
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

function Documents({ onFile, onOpen }: { onFile: (f: File) => void; onOpen: (d: Doc) => void }) {
  useLang();
  const { DOC_TYPE } = labels();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [list, setList] = useState<ListedDoc[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<"all" | "review" | "done">("all");
  const [intake, setIntake] = useState<string | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  useEffect(() => {
    api<ListedDoc[]>("/api/documents").then(setList, setError);
    api<Sample[]>("/api/samples").then(setSamples, () => setSamples([]));
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
      <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-5", samples.length ? "min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]" : "min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]")}>
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
                  {d.flagged ? <span className="text-xs font-medium whitespace-nowrap text-warn">{t(`${d.flagged} 個疑慮`, `${d.flagged} doubtful`)}</span> : null}
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
          <h1 id="upload" className="mb-2 text-xl font-semibold tracking-[-0.2px]">{t("收一份裝箱單或託運單", "Receive a packing list or shipping order")}</h1>
          <p className="mb-5 max-w-[46ch] text-sm text-muted-foreground">{t("第一系統讀出每一列，第二系統逐一核對每個值。認得的廠商、每個值都通過就自動確認；其他的只把有疑慮的地方標給你看。",
            "The first system reads every row, the second checks every value. A known sender whose values all pass is approved without you; anything else comes to you with only the doubtful values marked.")}</p>
          {/* The one filled button on this page. */}
          <Button size="lg" onClick={() => input.current?.click()}><Icon d={ICON.upload} className="" />{t("選擇 PDF", "Choose a PDF")}</Button>
          <input ref={input} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          <p className="mt-3 text-[13px] text-muted-foreground">
            {over ? t("放開就開始讀取", "Release to read it") : intake ? <>{t("或把 PDF 拖到這裡，或寄到 ", "or drop a PDF here, or email it to ")}<span className="font-medium text-foreground select-all">{intake}</span></> : t("或把 PDF 拖到這裡", "or drop a PDF here")}
          </p>
        </section>

        {/* Only a demo host carries samples; a team's own site shows its documents and nothing else. */}
        {samples.length > 0 && (
          <Card className={panel}>
            <div className="mb-1 flex items-center gap-2">
              <Icon d={ICON.spark} />
              <h2 className="text-base font-semibold">{t("範例貨件", "Sample shipments")}</h2>
            </div>
            <p className="mb-3 text-[13px] text-muted-foreground">{t("手邊沒有 PDF？打開一份，拿到的是複本。確認之後再打開同一份，第二份就會自動確認。",
              "No PDF at hand? Open one; you get a copy. Approve it, then open the same one again: the second is approved without a person.")}</p>
            <Samples onOpen={onOpen} given={samples} />
          </Card>
        )}
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
              {!list.length ? t("還沒有文件。上傳一份 PDF 就會出現在這裡。", "No documents yet. Upload a PDF and it shows up here.")
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
                  <TableHead className={head}>{t("第二系統", "Second check")}</TableHead>
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
                        : d.flagged ? <span className="font-medium text-warn">{t(`${d.flagged} 個有疑慮`, `${d.flagged} doubtful`)}</span>
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
    <Card className={SECTION}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-bold">{t("送出", "Send")}</h3>
        <a href="#/flow" className="text-sm text-primary">{t("設定這家要送到哪裡（Webhook、Email）→", "Set where this sender's documents go (webhook, email) →")}</a>
      </div>
      {doc.approved?.approved_at ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild><a href={`${base}.json`} download>{t("完整資料（JSON）", "Full record (JSON)")}</a></Button>
          <Button asChild variant="outline"><a href={`${base}.csv`} download>{t("Excel 表格（只有明細，CSV）", "Excel table (line items only, CSV)")}</a></Button>
          <Button variant="outline" onClick={copyUrl}>{t("複製下載網址", "Copy download URL")}</Button>
          <Button variant="outline" disabled={sending === "busy"} onClick={sendNow}>{sending === "busy" ? t("送出中…", "Sending…") : t("送到 Webhook／Email", "Send to webhooks and email")}</Button>
          <span role="status" className="text-sm text-muted-foreground">
            {copy === "done" && t("已複製", "Copied")}
            {copy === "failed" && <>{t("無法自動複製，請手動複製：", "Could not copy; copy it by hand: ")}<code className="select-all break-all">{url}</code></>}
            {typeof sending === "object" && <span className="text-destructive" role="alert">{errorMessage(sending.error)}</span>}
          </span>
        </div>
      ) : (
        <p className="text-muted-foreground">{t("這份在匯出功能上線前核准，沒有存下核准內容。重新上傳再核准一次即可匯出。", "This document was approved before export existed, so its approved content was not stored. Upload it again and approve it once more to export.")}</p>
      )}
      {deliveries.length > 0 && (
        <>
          <h4 className="mt-4 mb-1 text-sm font-bold">{t("送出紀錄", "Deliveries")}</h4>
          <ul className="list-none p-0">{deliveries.map((d) => <DeliveryRow key={d.id} d={d} />)}</ul>
        </>
      )}
    </Card>
  );
}

function Result({ doc, onReopened }: { doc: Doc; onReopened: (d: Doc) => void }) {
  useLang();
  const { FIELD, HEAD, TOTAL, DOC_TYPE } = labels();
  const a = doc.approved!, l = a.learn, auto = !!doc.auto?.ok;
  const [info, setInfo] = useState<SenderInfo | null>(null);
  const [reopen, setReopen] = useState<"idle" | "busy" | { error: unknown }>("idle");
  useEffect(() => { api<SenderInfo[]>("/api/senders").then((s) => setInfo(s.find((x) => x.sender === a.sender) ?? null), () => {}); }, [a.sender]);
  const docType = DOC_TYPE[doc.run.cls ?? ""] ?? t("文件", "document");
  const count = info?.approved.find((x) => x.cls === (doc.run.cls ?? "PL"))?.count;
  const active = info?.versions.find((v) => v.status === "active" && v.key.endsWith(`/${doc.run.cls ?? "PL"}`));
  const n = doc.normalized;
  const sum = (k: string) => n.rows.reduce((x, r) => x + Number((r as unknown as Record<string, { v: string | null }>)[k]?.v ?? 0), 0);
  const v = doc.verify;

  const markWrong = async () => {
    setReopen("busy");
    try { onReopened(await post<Doc>(`/api/documents/${doc.id}/reopen`, {})); } catch (e) { setReopen({ error: e }); }
  };

  // What was learned is the point of this screen, so it comes first.
  let learnCard: ReactNode;
  if (l.outcome === "activated") {
    const before = l.scores.current.reduce((x, y) => x + y, 0), after = l.scores.candidate.reduce((x, y) => x + y, 0);
    learnCard = (
      <div className="rounded-2xl bg-ok-bg px-6 py-5">
        <p className="mb-1 text-sm font-semibold text-ok">{t("學到了", "Learned")}</p>
        <h2 className="mb-2 text-xl font-bold">{t(`${a.sender} 的${docType}讀法更新到第 ${l.version.version} 版`, `${a.sender}'s ${docType} reading is now version ${l.version.version}`)}</h2>
        <p className="my-1">{t(`你改了 ${a.corrected} 處。Muse Wonder 拿你的修正對照原文找出讀錯的原因，改寫這家的讀法；新讀法重讀這家已確認的 ${l.scores.candidate.length} 份文件，需要修改的地方從 ${before} 處降到 ${after} 處，確定沒有變差才採用。`,
          `You corrected ${a.corrected} field(s). Muse Wonder compared your corrections with the printed page to find why they were misread and rewrote this sender's reading; it re-read this sender's ${l.scores.candidate.length} approved document(s): corrections needed went from ${before} to ${after}, and it was adopted only because nothing got worse.`)}</p>
        {l.version.notes.length
          ? <ul className="mt-2 list-disc pl-5">{l.version.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>
          : <p className="my-1">{t("這次學到的是這家的欄位排列，並把這份存成範例。", "What was learned is this sender's column layout, with this document kept as an example.")}</p>}
        <p className="mt-2 text-sm">{t(`下一份 ${a.sender} 的${docType}會用這版讀，全部核對通過就自動確認。`, `The next ${docType} from ${a.sender} is read with this version and approved automatically if every value passes.`)}</p>
      </div>
    );
  } else if (l.outcome === "kept") {
    learnCard = (
      <div className="rounded-2xl bg-warn-bg px-6 py-5">
        <p className="mb-1 text-sm font-semibold text-warn">{t("這次沒學會", "Not learned this time")}</p>
        <h2 className="mb-2 text-xl font-bold">{t("改過的欄位以後固定請你確認", "The corrected fields will always come to you")}</h2>
        <p className="my-1">{t(`你改了 ${a.corrected} 處，但試了 ${l.tries} 種新寫法都沒有讀得更好，所以維持原本的讀法。以後這家的這些欄位會固定請你確認：`,
          `You corrected ${a.corrected} field(s), but none of ${l.tries} rewritten readings did better, so the current reading stays. These fields will always come to you for this sender: `)}
          {l.always_review.map((p) => { const k = p.split(".").pop()!; return FIELD[k] ?? HEAD[k] ?? TOTAL[k] ?? p; }).join(t("、", ", "))}{t("。", ".")}</p>
      </div>
    );
  } else {
    learnCard = (
      <div className="rounded-2xl border bg-card px-6 py-5">
        <p className="mb-1 text-sm font-semibold text-muted-foreground">{auto ? t("自動確認", "Approved automatically") : t("全對", "All correct")}</p>
        <h2 className="mb-2 text-xl font-bold">{auto
          ? t(`${a.sender} 這份全部核對通過，沒有經過人工`, `Every value from ${a.sender} passed, with no person involved`)
          : t("沒有新東西要學，這家的格式記住了", "Nothing new to learn; this sender's layout is remembered")}</h2>
        <p className="my-1">{auto
          ? t(`認得的廠商、欄位跟上一份一樣、第二系統核對 ${v?.checked ?? 0} 個值全部通過、自動核對全部通過，四個條件都成立。`,
            `A known sender, the same columns as last time, all ${v?.checked ?? 0} values passed the second check, and every rule passed.`)
          : t("第一系統讀的每個值你都確認了，所以讀法維持不變，這份存成這家的範例。", "You confirmed every value the first system read, so the reading stays as it is and this document is kept as an example.")}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {count ? t(`這家的${docType}已確認 ${count} 份`, `${count} approved ${docType}(s) from this sender`) : ""}
          {active ? t(`，讀法第 ${active.version} 版。`, `, reading version ${active.version}.`) : count ? t("，用通用讀法。", ", read with the general reading.") : ""}
          {!auto && info && !info.hold ? t("下一份全部核對通過就自動確認。", " The next one is approved automatically if every value passes.") : ""}
        </p>
      </div>
    );
  }

  return (
    <>
      <section className="mb-4 rounded-2xl border bg-card px-6 py-5">
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex-[1_1_320px]">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {statusBadge({ status: auto ? "auto" : "approved", reopened: false })}
              <span className="text-sm text-muted-foreground">{a.approved_at ? when(a.approved_at) : ""}</span>
            </div>
            <h1 className="mb-1 text-[22px] font-bold tracking-tight">{t(`${a.sender} 的${docType}`, `${docType} from ${a.sender}`)}</h1>
            <p className="text-muted-foreground">{doc.name}</p>
            <ViaEmail doc={doc} />
          </div>
          <div className="flex flex-wrap gap-2.5">
            {([[n.rows.length, t("列明細", "line items")], [sum("pkgs"), t("箱", "cartons")], [sum("gw_kg"), t("毛重 kg", "gross kg")], [v?.checked ?? 0, t("核對過的值", "values checked")]] as const).map(([x, label]) => (
              <div key={label} className="min-w-[110px] rounded-xl border bg-muted px-3.5 py-2">
                <b className="block font-mono text-[22px] leading-tight font-semibold">{fmt(String(Math.round(x * 1000) / 1000))}</b>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="mb-4">{learnCard}</div>
      <Export doc={doc} />

      <Card className={SECTION}>
        <h3 className="mb-1 text-base font-bold">{t("發現這份有錯？", "Found a mistake?")}</h3>
        <p className="mb-3 text-[13px] text-muted-foreground">{t("重新打開審核，改完再確認一次，系統會拿這次修正去學。這家會先暫停自動確認，直到下一份人工審核完全沒改。",
          "Reopen it for review, correct it and approve again; the correction is learned. Automatic approval for this sender pauses until a reviewed document needs no change.")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={reopen === "busy"} onClick={markWrong}>{t("這份有錯，重新審核", "This is wrong, reopen")}</Button>
          <Button variant="ghost" onClick={() => go("")}>{t("回到文件清單", "Back to documents")}</Button>
          {typeof reopen === "object" && <span className="text-sm text-destructive" role="alert">{errorMessage(reopen.error)}</span>}
        </div>
      </Card>
    </>
  );
}
