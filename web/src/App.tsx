import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, creditText, errorMessage, isCreditExhausted, post, type Delivery, type Doc, type ListedDoc, type Sample, type SenderInfo } from "./api.ts";
import { FobbyLogo } from "./brand.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card } from "./components/ui/card.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table.tsx";
import { fmt } from "./diff.ts";
import { DeliveryRow, Flow } from "./Flow.tsx";
import { setLang, t, useLang } from "./i18n.ts";
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

export const SECTION = "mb-4 gap-0 rounded-2xl p-[18px] shadow-none";

export function App() {
  const lang = useLang();
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
    body = <Busy title={screen.title}><ErrorText error={screen.error} onOpen={show} /><div className="mt-4"><Button variant="outline" onClick={() => go("")}>{t("回到文件清單", "Back to documents")}</Button></div></Busy>;
  else if (screen?.kind === "review") body = <><Steps at={3} doc={screen.doc} /><Review key={screen.doc.id} doc={screen.doc} onOpen={show} onApproved={show} /></>;
  else if (screen?.kind === "result") body = <><Steps at={5} doc={screen.doc} /><Result key={screen.doc.id} doc={screen.doc} onReopened={show} /></>;

  const area = route.area === "doc" ? "docs" : route.area;
  const nav: [string, string, string][] = [["docs", "#", t("文件", "Documents")], ["vendors", "#/vendors", t("廠商", "Senders")], ["flow", "#/flow", t("出口流程", "Export flow")]];
  return (
    <>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b bg-card px-6 py-3">
        <a href="#" className="m-0 flex items-center text-[17px] font-bold no-underline" aria-label={t("Fobby Connect 文件清單", "Fobby Connect documents")}><FobbyLogo /></a>
        <nav className="flex gap-1" aria-label={t("主選單", "Main")}>
          {nav.map(([k, href, name]) => (
            <a key={k} href={href} aria-current={area === k ? "page" : undefined}
              className={cn("rounded-md px-3 py-1.5 text-sm text-muted-foreground no-underline hover:bg-muted hover:text-foreground", area === k && "bg-muted font-semibold text-foreground")}>{name}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <button type="button" onClick={() => setLang(lang === "zh" ? "en" : "zh")} aria-label={lang === "zh" ? "Switch to English" : "切換成中文"}
            className="cursor-pointer rounded-md border bg-transparent px-2 py-1 text-sm text-muted-foreground hover:text-foreground">
            {lang === "zh" ? "EN" : "中文"}
          </button>
          {/* AGPL §13: people using the hosted site get a way to the source. */}
          <a href="https://github.com/fobby-io/fobby-connect" target="_blank" rel="noreferrer" className="text-sm text-muted-foreground underline-offset-4 hover:underline">{t("原始碼", "Source")}</a>
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
  if (isCreditExhausted(error)) return <div><p className="mb-3">{creditText()}</p><Samples onOpen={onOpen} /></div>;
  return <span>{errorMessage(error)}</span>;
}

export function Samples({ onOpen }: { onOpen: (d: Doc) => void }) {
  useLang();
  const [list, setList] = useState<Sample[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => { api<Sample[]>("/api/samples").then(setList, setError); }, []);
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
      {list && !list.length && <p className="text-sm text-muted-foreground">{t("目前沒有範例貨件。", "No sample shipments yet.")}</p>}
      <ul className="m-0 grid list-none gap-2 p-0">
        {list?.map((s) => (
          <li key={s.id}>
            <button type="button" disabled={!!opening} onClick={() => open(s)}
              className="flex w-full cursor-pointer items-baseline justify-between gap-3 rounded-lg border bg-card px-4 py-2.5 text-left text-foreground hover:border-primary disabled:cursor-default disabled:opacity-60">
              <span className="font-semibold">{s.name}</span>
              <span className="text-sm text-muted-foreground">{opening === s.id ? t("讀取並核對中…", "Opening and checking…") : s.sender}</span>
            </button>
          </li>
        ))}
      </ul>
      {error != null && <p className="mt-2 text-sm text-warn" role="alert">{errorMessage(error)}</p>}
    </div>
  );
}

export const statusBadge = (d: Pick<ListedDoc, "status" | "reopened">) => {
  if (d.status === "auto") return <Badge className="rounded-full bg-ok-bg text-ok">{t("自動確認", "Auto-approved")}</Badge>;
  if (d.status === "approved") return <Badge variant="secondary" className="rounded-full">{t("已確認", "Approved")}</Badge>;
  return <Badge className="rounded-full bg-warn-bg text-warn">{d.reopened ? t("重新審核", "Reopened") : t("待審核", "To review")}</Badge>;
};
export const when = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

function Documents({ onFile, onOpen }: { onFile: (f: File) => void; onOpen: (d: Doc) => void }) {
  useLang();
  const { DOC_TYPE } = labels();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [list, setList] = useState<ListedDoc[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { api<ListedDoc[]>("/api/documents").then(setList, setError); }, []);
  return (
    <>
      <div className="mb-4 grid gap-4 min-[960px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className={cn("flex flex-col justify-center rounded-2xl border-2 border-dashed bg-card px-8 py-8 text-center", over && "border-primary")}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
          <h2 className="mb-2 text-xl font-bold">{t("收一份裝箱單或託運單", "Receive a packing list or shipping order")}</h2>
          <p className="mx-auto mb-5 max-w-[520px] text-muted-foreground">{t("第一系統讀出每一列，第二系統逐一核對每個值。認得的廠商、每個值都核對通過，就自動確認；其他的只把有疑慮的地方標給你看。",
            "The first system reads every row and the second checks every value. A known sender whose values all pass is approved automatically; anything else comes to you with only the doubtful values marked.")}</p>
          <div><Button onClick={() => input.current?.click()}>{t("選擇 PDF", "Choose a PDF")}</Button></div>
          <input ref={input} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          <p className="mt-2 text-[13px] text-muted-foreground">{t("或把 PDF 拖進這個框。之後也可以從 email 收件。", "or drop a PDF into this box. Email intake comes next.")}</p>
        </div>
        <Card className={cn(SECTION, "mb-0")}>
          <h3 className="mb-1 text-base font-bold">{t("範例貨件", "Sample shipments")}</h3>
          <p className="mb-3 text-[13px] text-muted-foreground">{t("已經讀好的範例，打開的是複本。同一家打開第二次，就會看到自動確認。", "Already read; you open a copy. Open one from the same sender twice to see automatic approval.")}</p>
          <Samples onOpen={onOpen} />
        </Card>
      </div>

      <Card className={SECTION}>
        <h2 className="mb-3 text-lg font-bold">{t("文件", "Documents")}</h2>
        {error != null && <p className="text-warn" role="alert">{errorMessage(error)}</p>}
        {list && !list.length && <p className="text-muted-foreground">{t("還沒有文件。上傳一份或打開範例，它會出現在這裡。", "No documents yet. Upload one or open a sample and it shows up here.")}</p>}
        {!!list?.length && (
          <div className="overflow-x-auto rounded-lg border">
            <Table className="text-sm">
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="px-3 font-semibold">{t("文件", "Document")}</TableHead>
                  <TableHead className="px-3 font-semibold">{t("寄件公司", "Sender")}</TableHead>
                  <TableHead className="px-3 font-semibold">{t("類型", "Type")}</TableHead>
                  <TableHead className="px-3 font-semibold">{t("狀態", "Status")}</TableHead>
                  <TableHead className="px-3 font-semibold">{t("第二系統", "Second check")}</TableHead>
                  <TableHead className="px-3 font-semibold">{t("收件時間", "Received")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((d) => (
                  <TableRow key={d.id} className="cursor-pointer" onClick={() => go(d.id)}>
                    <TableCell className="px-3 py-2.5"><a href={`#${d.id}`} className="font-semibold text-foreground no-underline hover:underline">{d.name}</a></TableCell>
                    <TableCell className="px-3 py-2.5">{d.sender ?? "—"}</TableCell>
                    <TableCell className="px-3 py-2.5">{DOC_TYPE[d.cls ?? ""] ?? d.cls ?? "—"}</TableCell>
                    <TableCell className="px-3 py-2.5">{statusBadge(d)}</TableCell>
                    <TableCell className="px-3 py-2.5 text-muted-foreground">
                      {d.flagged === null ? t("未核對", "Not checked") : d.flagged ? <span className="text-warn">{t(`${d.flagged} 個有疑慮`, `${d.flagged} doubtful`)}</span> : t("全部通過", "All passed")}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{when(d.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </>
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
          <Button variant="outline" disabled={sending === "busy"} onClick={sendNow}>{sending === "busy" ? t("送出中…", "Sending…") : t("送到 Webhook", "Send to webhooks")}</Button>
          <span role="status" className="text-sm text-muted-foreground">
            {copy === "done" && t("已複製", "Copied")}
            {copy === "failed" && <>{t("無法自動複製，請手動複製：", "Could not copy; copy it by hand: ")}<code className="select-all break-all">{url}</code></>}
            {typeof sending === "object" && <span className="text-warn">{errorMessage(sending.error)}</span>}
          </span>
        </div>
      ) : (
        <p className="text-muted-foreground">{t("這份在匯出功能上線前核准，沒有存下核准內容。重新打開範例再核准一次即可匯出。", "This document was approved before export existed, so its approved content was not stored. Open the sample again and approve it once more to export.")}</p>
      )}
      {deliveries.length > 0 && (
        <>
          <h4 className="mt-4 mb-1 text-sm font-bold">{t("Webhook 送出紀錄", "Webhook deliveries")}</h4>
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
            <h2 className="mb-1 text-[22px] font-bold tracking-tight">{t(`${a.sender} 的${docType}`, `${docType} from ${a.sender}`)}</h2>
            <p className="text-muted-foreground">{doc.name}</p>
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
          {typeof reopen === "object" && <span className="text-sm text-warn" role="alert">{errorMessage(reopen.error)}</span>}
        </div>
      </Card>
    </>
  );
}
