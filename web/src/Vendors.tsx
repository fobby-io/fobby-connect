// Every sender the system knows: whether it is approved automatically, its readings version by version, and its documents.
import { useEffect, useState } from "react";
import { api, errorMessage, type SenderInfo } from "./api.ts";
import { SECTION, statusBadge, when } from "./App.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Card } from "./components/ui/card.tsx";
import { t, useLang } from "./i18n.ts";
import { labels } from "./labels.ts";
import { cn } from "./lib/utils.ts";

export function Vendors() {
  useLang();
  const [list, setList] = useState<SenderInfo[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { api<SenderInfo[]>("/api/senders").then(setList, setError); }, []);
  return (
    <>
      <div className="mb-4">
        <h1 className="text-xl font-bold">{t("廠商", "Senders")}</h1>
        <p className="text-muted-foreground">{t("每家寄件公司各有自己的讀法和紀錄。確認過一份就認得這家；之後每個值都核對通過的文件會自動確認，被改過一次就先暫停。",
          "Each sender has its own reading and record. One approved document and the sender is known; after that, documents whose values all pass are approved automatically, and one corrected afterwards pauses that.")}</p>
      </div>
      {error != null && <p className="text-destructive" role="alert">{errorMessage(error)}</p>}
      {list && !list.length && <Card className={SECTION}><p className="text-muted-foreground">{t("還沒有認得的廠商。確認一份文件後，那家會出現在這裡。", "No senders yet. Approve a document and its sender appears here.")}</p></Card>}
      <div className="grid gap-4 min-[1100px]:grid-cols-2">
        {list?.map((s) => <Sender key={s.sender} s={s} />)}
      </div>
    </>
  );
}

function Sender({ s }: { s: SenderInfo }) {
  const L = labels();
  const auto = s.docs.filter((d) => d.status === "auto").length;
  // Approved counts come from the learning store, which also holds documents approved before the list existed.
  const approved = s.approved.reduce((n, a) => n + a.count, 0);
  const reopened = s.docs.filter((d) => d.reopened).length;
  const waiting = s.docs.filter((d) => d.status === "review").length;
  const known = s.approved.length > 0;
  return (
    <Card className={cn(SECTION, "mb-0")}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">{s.sender}</h2>
        {s.hold
          ? <Badge className="rounded-full bg-warn-bg text-warn">{t("暫停自動確認", "Automatic approval paused")}</Badge>
          : known ? <Badge className="rounded-full bg-ok-bg text-ok">{t("自動確認中", "Approving automatically")}</Badge>
            : <Badge variant="secondary" className="rounded-full">{t("學習中", "Learning")}</Badge>}
      </div>
      {s.hold && <p className="mb-3 text-sm text-warn">{t("有一份自動確認的文件事後被改過。下一份人工審核完全沒改，就恢復自動確認。", "An automatically approved document was corrected afterwards. The next document that passes review unchanged turns it back on.")}</p>}

      <div className="mb-4 grid grid-cols-4 gap-2">
        {([[approved, t("已確認", "Approved")], [auto, t("自動確認", "Automatic")], [reopened, t("事後被改", "Corrected later")], [waiting, t("待審核", "To review")]] as const).map(([n, label]) => (
          <div key={label} className="rounded-xl border bg-muted px-3 py-2">
            <b className="block font-mono text-xl leading-tight font-semibold">{n}</b>
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      <h3 className="mb-1.5 text-sm font-bold">{t("讀法", "Readings")}</h3>
      <ul className="mb-4 list-none p-0">
        {(["PL", "SO"] as const).map((cls) => {
          const vs = s.versions.filter((v) => v.key.endsWith(`/${cls}`)).slice().reverse();
          const count = s.approved.find((a) => a.cls === cls)?.count ?? 0;
          if (!vs.length && !count) return null;
          return (
            <li key={cls} className="mb-2 rounded-lg border px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong>{L.DOC_TYPE[cls]}</strong>
                <span className="text-[13px] text-muted-foreground">{t(`已確認 ${count} 份`, `${count} approved`)}</span>
              </div>
              {!vs.length && <p className="text-[13px] text-muted-foreground">{t("一直都讀對，用通用讀法，還不需要專屬版本。", "Always read right with the general reading; no own version needed yet.")}</p>}
              {vs.map((v) => (
                <details key={v.id} className="mt-1.5" open={v.status === "active"}>
                  <summary className="cursor-pointer text-sm">
                    {t(`第 ${v.version} 版`, `Version ${v.version}`)}
                    <Badge variant="secondary" className={cn("ml-1.5 rounded-full text-muted-foreground", v.status === "active" && "bg-ok-bg text-ok")}>
                      {v.status === "active" ? t("使用中", "active") : v.status === "retired" ? t("已停用", "retired") : t("候選", "candidate")}
                    </Badge>
                    <span className="ml-1.5 text-[13px] text-muted-foreground">{v.change}</span>
                  </summary>
                  <div className="mt-1.5 pl-3 text-[13px]">
                    {!!v.columns.length && (
                      <div className="mb-1.5 flex flex-wrap gap-1.5">
                        {v.columns.map((c, i) => (
                          <span key={i} className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">{c.label.replace(/\n/g, " ")} → {L.FIELD[c.field] ?? c.field}</span>
                        ))}
                      </div>
                    )}
                    {v.notes.length > 0 && <ul className="mb-1.5 list-disc pl-5 text-muted-foreground">{v.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                    {v.always_review.length > 0 && <p className="text-warn">{t("固定請人確認：", "Always reviewed: ")}{v.always_review.map((p) => { const k = p.split(".").pop()!; return L.FIELD[k] ?? L.HEAD[k] ?? L.TOTAL[k] ?? p; }).join(t("、", ", "))}</p>}
                    <p className="text-muted-foreground">{t(`範例 ${v.examples} 份`, `${v.examples} example(s)`)}</p>
                  </div>
                </details>
              ))}
            </li>
          );
        })}
      </ul>

      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">{t("最近的文件", "Recent documents")}</h3>
        <a href="#/flow" className="text-[13px] text-primary">{t("這家的出口設定 →", "Where this sender's documents go →")}</a>
      </div>
      <ul className="list-none p-0">
        {s.docs.slice(0, 5).map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 border-b py-1.5 text-sm last:border-b-0">
            <a href={`#${d.id}`} className="font-semibold text-foreground">{d.name}</a>
            {statusBadge(d)}
            <span className="ml-auto text-[13px] text-muted-foreground">{when(d.created_at)}</span>
          </li>
        ))}
        {!s.docs.length && <li className="text-sm text-muted-foreground">{t("文件清單裡還沒有這家的文件。", "No documents from this sender in the list yet.")}</li>}
      </ul>
    </Card>
  );
}
