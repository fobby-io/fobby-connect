import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, creditText, errorMessage, isCreditExhausted, request, type Doc, type Profile, type Sample } from "./api.ts";
import { FobbyLogo } from "./brand.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card } from "./components/ui/card.tsx";
import { setLang, t, useLang } from "./i18n.ts";
import { labels } from "./labels.ts";
import { cn } from "./lib/utils.ts";
import { Review } from "./Review.tsx";

type Screen =
  | { kind: "upload"; error?: unknown }
  | { kind: "busy"; title: string; text: string }
  | { kind: "failed"; title: string; error: unknown }
  | { kind: "review"; doc: Doc }
  | { kind: "result"; doc: Doc };

export function App() {
  const lang = useLang();
  const steps = [t("上傳文件", "Upload"), t("檢查與修正", "Check and correct"), t("確認並學習", "Approve and learn")];
  const [screen, setScreen] = useState<Screen | null>(null);
  const [step, setStep] = useState(1);
  const show = (s: Screen, n: number) => { setScreen(s); setStep(n); };

  const start = (doc: Doc) => {
    history.replaceState(null, "", `#${doc.id}`);
    doc.approved ? show({ kind: "result", doc }, 3) : show({ kind: "review", doc }, 2);
  };
  const toUpload = (error?: unknown) => { history.replaceState(null, "", "/"); show({ kind: "upload", error }, 1); };

  // #<id> reopens a document already read, so a review survives a reload.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const open = () => {
      const id = location.hash.slice(1);
      if (!id) return show({ kind: "upload" }, 1);
      if (opened.current === id) return;
      opened.current = id;
      api<Doc>(`/api/documents/${id}`).then(start, (e) => toUpload(e));
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  const openDoc = (doc: Doc) => { opened.current = doc.id; start(doc); };

  async function upload(f: File) {
    show({ kind: "busy", title: t(`正在讀取 ${f.name}…`, `Reading ${f.name}…`), text: t("每頁約 5–15 秒。讀完會自動核對加總。", "About 5–15 seconds per page. The totals are checked when the read is done.") }, 1);
    try {
      openDoc(await api<Doc>(`/api/documents?${new URLSearchParams({ name: f.name })}`, { method: "POST", body: f }));
    } catch (e) {
      show({ kind: "failed", title: t("讀取失敗", "Read failed"), error: e }, 1);
    }
  }

  let body: ReactNode = null;
  if (screen?.kind === "upload") body = <Upload onFile={upload} onOpen={openDoc} error={screen.error} />;
  else if (screen?.kind === "busy") body = <Busy title={screen.title}>{screen.text}</Busy>;
  else if (screen?.kind === "failed") body = <Busy title={screen.title}><ErrorText error={screen.error} onOpen={openDoc} /></Busy>;
  else if (screen?.kind === "review")
    body = <Review key={screen.doc.id} doc={screen.doc} onStep={setStep} onOpen={openDoc} onApproved={(doc) => show({ kind: "result", doc }, 3)} />;
  else if (screen?.kind === "result") body = <Result doc={screen.doc} />;

  return (
    <>
      <header className="flex flex-wrap items-center gap-6 border-b bg-card px-6 py-3.5">
        <h1 className="m-0 flex items-center gap-2 text-[17px] font-bold">
          <FobbyLogo />
          <span className="text-primary">Connect</span>
        </h1>
        <ol className="steps m-0 flex list-none flex-wrap gap-1.5 p-0">
          {steps.map((s, i) => (
            <li key={s} className={cn("flex items-center gap-2 rounded-full bg-muted py-1 pr-3.5 pl-1 text-sm text-muted-foreground",
              i + 1 === step && "on font-semibold text-foreground", i + 1 < step && "done")}>{s}</li>
          ))}
        </ol>
        <div className="ml-auto flex items-center gap-3">
          <button type="button" onClick={() => setLang(lang === "zh" ? "en" : "zh")} aria-label={lang === "zh" ? "Switch to English" : "切換成中文"}
            className="cursor-pointer rounded-md border bg-transparent px-2 py-1 text-sm text-muted-foreground hover:text-foreground">
            {lang === "zh" ? "EN" : "中文"}
          </button>
          {/* AGPL §13: people using the hosted site get a way to the source. */}
          <a href="https://github.com/fobby-io/fobby-connect" target="_blank" rel="noreferrer" className="text-sm text-muted-foreground underline-offset-4 hover:underline">{t("原始碼", "Source")}</a>
          {step !== 1 && <Button variant="outline" onClick={() => { opened.current = null; toUpload(); }}>{t("讀下一份文件", "Next document")}</Button>}
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-6 pt-5 pb-32">{body}</main>
    </>
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
              <span className="text-sm text-muted-foreground">{opening === s.id ? t("打開中…", "Opening…") : s.sender}</span>
            </button>
          </li>
        ))}
      </ul>
      {error != null && <p className="mt-2 text-sm text-warn" role="alert">{errorMessage(error)}</p>}
    </div>
  );
}

function Upload({ onFile, onOpen, error }: { onFile: (f: File) => void; onOpen: (d: Doc) => void; error?: unknown }) {
  useLang();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="mx-auto my-14 max-w-[640px]">
      {error != null && (
        <div className="mb-4 rounded-lg border border-warn-line bg-warn-bg px-4 py-3 text-warn" role="alert">
          {errorMessage(error)}
        </div>
      )}
      <div className={cn("rounded-xl border-2 border-dashed bg-card px-8 py-12 text-center", over && "border-primary")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
        <h2 className="mb-2 text-xl font-bold">{t("上傳一份裝箱單或託運單", "Upload a packing list or shipping order")}</h2>
        <p className="mb-5 text-muted-foreground">{t("系統會讀出每一列、整理成標準格式、自動核對加總，只把需要你確認的地方標出來。掃描檔也可以。", "Every row is read into one standard format, the totals are checked, and only what needs your eye is marked. Scans work too.")}</p>
        <Button onClick={() => input.current?.click()}>{t("選擇 PDF", "Choose a PDF")}</Button>
        <input ref={input} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        <p className="mt-2 text-[13px] text-muted-foreground">{t("或把 PDF 拖進這個框", "or drop a PDF into this box")}</p>
      </div>
      <section className="mt-8">
        <h3 className="mb-1 text-base font-bold">{t("或打開一份範例貨件", "Or open a sample shipment")}</h3>
        <p className="mb-3 text-[13px] text-muted-foreground">{t("範例已經讀好，打開的是一份複本，可以照常修改和確認。", "Samples are already read; you open a copy and can correct and approve it as usual.")}</p>
        <Samples onOpen={onOpen} />
      </section>
    </div>
  );
}

const SECTION = "mb-4 gap-0 rounded-2xl p-[18px] shadow-none";

function Export({ doc }: { doc: Doc }) {
  useLang();
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const base = `/api/documents/${doc.id}/export`;
  const url = location.origin + `${base}.json`;
  // The clipboard is missing outside https and can refuse; then the address is shown to copy by hand.
  const copyUrl = async () => {
    try { await navigator.clipboard.writeText(url); setCopy("done"); setTimeout(() => setCopy("idle"), 2000); }
    catch { setCopy("failed"); }
  };
  return (
    <Card className={SECTION}>
      <h3 className="mb-3 text-base font-bold">{t("匯出", "Export")}</h3>
      {doc.approved?.approved_at ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild><a href={`${base}.json`} download>{t("完整資料（JSON）", "Full record (JSON)")}</a></Button>
          <Button asChild variant="outline"><a href={`${base}.csv`} download>{t("Excel 表格（只有明細，CSV）", "Excel table (line items only, CSV)")}</a></Button>
          <Button variant="outline" onClick={copyUrl}>{t("複製 API 網址", "Copy API URL")}</Button>
          <span role="status" className="text-sm text-muted-foreground">
            {copy === "done" && t("已複製", "Copied")}
            {copy === "failed" && <>{t("無法自動複製，請手動複製：", "Could not copy; copy it by hand: ")}<code className="select-all break-all">{url}</code></>}
          </span>
        </div>
      ) : (
        <p className="text-muted-foreground">{t("這份在匯出功能上線前核准，沒有存下核准內容。重新打開範例再核准一次即可匯出。", "This document was approved before export existed, so its approved content was not stored. Open the sample again and approve it once more to export.")}</p>
      )}
    </Card>
  );
}

function Result({ doc }: { doc: Doc }) {
  useLang();
  const { FIELD, HEAD, TOTAL, DOC_TYPE } = labels();
  const a = doc.approved!, l = a.learn;
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { request("/api/profiles").then((r) => r.json()).then(setProfiles, setError); }, []);
  const docType = DOC_TYPE[doc.run.cls ?? ""] ?? t("文件", "document");

  let card: ReactNode;
  if (l.outcome === "no_change") {
    card = (
      <div className="mb-4 rounded-[10px] border bg-card px-5 py-4">
        <h2 className="mb-1.5 text-lg font-bold">{t("已確認存檔", "Approved and saved")}</h2>
        <p>{t("這份沒有需要修改的地方，這家的讀法維持不變。", "Nothing needed correcting, so this sender's reading stays as it is.")}</p>
      </div>
    );
  } else if (l.outcome === "activated") {
    const v = l.version, before = l.scores.current.reduce((x, y) => x + y, 0), after = l.scores.candidate.reduce((x, y) => x + y, 0);
    card = (
      <div className="mb-4 rounded-[10px] bg-ok-bg px-5 py-4">
        <h2 className="mb-1.5 text-lg font-bold">{t(`已學會 ${a.sender} 的格式`, `Learned ${a.sender}'s layout`)}</h2>
        <p className="my-1">{t(
          `你改了 ${a.corrected} 處。系統寫了新的讀法（第 ${v.version} 版），用它重讀這家已確認的 ${l.scores.candidate.length} 份文件：需要修改的地方從 ${before} 處變成 ${after} 處。`,
          `You corrected ${a.corrected} field(s). A new reading (version ${v.version}) was written and used to re-read this sender's ${l.scores.candidate.length} approved document(s): corrections needed went from ${before} to ${after}.`)}</p>
        <p className="my-1">{t(`下次收到 ${a.sender} 的${docType}，會自動用這版讀。`, `The next ${docType} from ${a.sender} is read with this version.`)}</p>
        {v.notes.length
          ? <ul className="mt-2 list-disc pl-5">{v.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>
          : <p className="my-1 text-muted-foreground">{t("這次學到的是這家的欄位排列，並把這份存成範例。", "What was learned is this sender's column layout, with this document kept as an example.")}</p>}
      </div>
    );
  } else {
    card = (
      <div className="mb-4 rounded-[10px] bg-warn-bg px-5 py-4">
        <h2 className="mb-1.5 text-lg font-bold">{t("這次的修正系統學不會", "This correction could not be learned")}</h2>
        <p className="my-1">{t(
          `你改了 ${a.corrected} 處，但試了 ${l.tries} 種新寫法，都沒有讓這家的文件讀得更好，所以維持原本的讀法。`,
          `You corrected ${a.corrected} field(s), but none of ${l.tries} rewritten readings read this sender's documents better, so the current reading stays.`)}</p>
        <p className="my-1">{t("以後這家的這些欄位會固定請你確認：", "These fields will always be shown for your review on this sender's documents: ")}{l.always_review.map((p) => { const k = p.split(".").pop()!; return FIELD[k] ?? HEAD[k] ?? TOTAL[k] ?? p; }).join(t("、", ", "))}{t("。", ".")}</p>
      </div>
    );
  }

  return (
    <>
      {card}
      <Export doc={doc} />
      <Card className={SECTION}>
        <h3 className="mb-3 text-base font-bold">{t("系統記住的各家讀法", "Readings learned per sender")}</h3>
        {error != null && <p className="text-warn" role="alert">{errorMessage(error)}</p>}
        <ul className="m-0 list-none p-0">
          {profiles && !profiles.length && <li className="py-2.5 text-muted-foreground">{t("還沒有。確認一份有修正的文件後，這裡會出現那家的讀法。", "None yet. Approve a document with corrections and that sender's reading appears here.")}</li>}
          {profiles?.flatMap((s) => s.versions.slice().reverse().map((v) => {
            const cls = v.key.split("/")[1] ?? "";
            return (
              <li key={`${s.sender}/${v.key}/${v.version}`} className="border-b py-2.5 last:border-b-0">
                <strong>{s.sender}・{DOC_TYPE[cls] ?? cls}・{t(`第 ${v.version} 版`, `version ${v.version}`)}</strong>
                <Badge variant="secondary" className={cn("ml-1.5 rounded-full text-muted-foreground", v.status === "active" && "bg-ok-bg text-ok")}>
                  {v.status === "active" ? t("使用中", "active") : v.status === "retired" ? t("已停用", "retired") : t("候選", "candidate")}
                </Badge>
                {v.notes.length > 0 && <ul className="mt-1 list-disc pl-5">{v.notes.map((x, i) => <li key={i} className="text-muted-foreground">{x}</li>)}</ul>}
              </li>
            );
          }))}
        </ul>
      </Card>
    </>
  );
}
