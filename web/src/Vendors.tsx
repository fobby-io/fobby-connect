// Every sender the system knows: whether it is approved automatically, its readings version by version, and its documents.
import { useEffect, useState } from "react";
import { api, errorMessage, type ReadingVersion, type SenderInfo } from "./api.ts";
import { DocIcon, Icon, ICON, statusBadge, when } from "./App.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Card } from "./components/ui/card.tsx";
import { t, useLang } from "./i18n.ts";
import { labels } from "./labels.ts";
import { cn } from "./lib/utils.ts";

const DOT = "gap-1.5 rounded-full border-0 px-2.5 py-0.5 text-xs font-medium before:size-1.5 before:rounded-full before:bg-current before:content-['']";

const known = (s: SenderInfo) => s.approved.length > 0;
function State({ s }: { s: SenderInfo }) {
  if (s.hold) return <Badge className={cn(DOT, "bg-warn-bg text-warn")}>{t("暫停自動確認", "Paused")}</Badge>;
  if (known(s)) return <Badge className={cn(DOT, "bg-ok-bg text-ok")}>{t("已認得", "Known")}</Badge>;
  return <Badge className={cn(DOT, "bg-muted text-muted-foreground")}>{t("新廠商", "New")}</Badge>;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join("").toUpperCase();
const Avatar = ({ name, big }: { name: string; big?: boolean }) => (
  <span aria-hidden="true" className={cn("grid flex-none place-items-center rounded-xl bg-accent font-semibold text-primary", big ? "size-12 text-base" : "size-9 text-[13px]")}>{initials(name)}</span>
);

export function Vendors() {
  useLang();
  const [list, setList] = useState<SenderInfo[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => { api<SenderInfo[]>("/api/senders").then(setList, setError); }, []);
  const s = list?.find((x) => x.sender === pick) ?? list?.[0];
  const count = (f: (x: SenderInfo) => boolean) => list?.filter(f).length ?? 0;

  return (
    <div className="mx-auto grid max-w-[80rem] grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="mb-1 text-2xl leading-tight font-semibold tracking-[-0.3px]">{t("廠商", "Senders")}</h1>
          <p className="max-w-[70ch] text-muted-foreground">{t("確認過一份就認得這家；之後每個值都核對通過的文件會自動確認，事後被改過一次就先暫停。",
            "One approved document and the sender is known; after that, documents whose values all pass are approved automatically. One corrected afterwards pauses it.")}</p>
        </div>
        {!!list?.length && (
          <dl className="m-0 flex gap-5 text-sm">
            {([[count(() => true), t("家廠商", "senders")], [count((x) => known(x) && !x.hold), t("已認得", "known")], [count((x) => x.hold), t("暫停", "paused")]] as const).map(([n, label]) => (
              <div key={label} className="flex items-baseline gap-1.5"><dt className="sr-only">{label}</dt><dd className="m-0 text-xl font-semibold">{n}</dd><span className="text-muted-foreground">{label}</span></div>
            ))}
          </dl>
        )}
      </div>

      {error != null && <p className="text-destructive" role="alert">{errorMessage(error)}</p>}
      {!list && error == null && <p className="text-muted-foreground">{t("載入中…", "Loading…")}</p>}
      {list && !list.length && (
        <Card className="items-center gap-2 p-10 text-center">
          <h2 className="text-base font-semibold">{t("還沒有認得的廠商", "No senders yet")}</h2>
          <p className="max-w-[46ch] text-sm text-muted-foreground">{t("確認一份文件後，那家寄件公司會出現在這裡，下一份就開始自動核對。", "Approve a document and its sender appears here; from its next document on, every value is checked automatically.")}</p>
          <a href="#" className="mt-2 text-sm text-primary">{t("去文件清單 →", "Go to documents →")}</a>
        </Card>
      )}

      {s && (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 min-[900px]:grid-cols-[18rem_minmax(0,1fr)]">
          <Card className="gap-0 p-2">
            <h2 className="sr-only">{t("廠商清單", "Sender list")}</h2>
            <ul className="m-0 grid list-none gap-0.5 p-0">
              {list!.map((x) => (
                <li key={x.sender}>
                  <button type="button" onClick={() => setPick(x.sender)} aria-current={x === s ? "true" : undefined}
                    className={cn("flex w-full cursor-pointer items-center gap-3 rounded-xl border-0 bg-transparent p-2.5 text-left text-foreground transition-colors hover:bg-accent/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      x === s && "bg-accent")}>
                    <Avatar name={x.sender} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{x.sender}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-[13px] text-muted-foreground">
                        <State s={x} />{t(`${x.docs.length} 份文件`, `${x.docs.length} document${x.docs.length === 1 ? "" : "s"}`)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Sender key={s.sender} s={s} />
        </div>
      )}
    </div>
  );
}

function Sender({ s }: { s: SenderInfo }) {
  const L = labels();
  const auto = s.docs.filter((d) => d.status === "auto").length;
  // Approved counts come from the learning store, which also holds documents approved before the list existed.
  const approved = s.approved.reduce((n, a) => n + a.count, 0);
  const reopened = s.docs.filter((d) => d.reopened).length;
  const waiting = s.docs.filter((d) => d.status === "review").length;
  const tiles = [[approved, t("已確認", "Approved in total")], [auto, t("自動確認", "Approved automatically")], [reopened, t("事後被改", "Corrected later")], [waiting, t("待審核", "To review")]] as const;
  return (
    <Card className="gap-0 p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Avatar name={s.sender} big />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-[-0.2px]">{s.sender}</h2>
          <a href="#/flow" className="text-[13px] text-primary">{t("這家的出口設定 →", "Where this sender's documents go →")}</a>
        </div>
        <State s={s} />
      </div>
      {s.hold && <p className="mb-5 rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn">{t("有一份自動確認的文件事後被改過。下一份人工審核完全沒改，就恢復自動確認。", "An automatically approved document was corrected afterwards. The next document that passes review unchanged turns it back on.")}</p>}

      <dl className="m-0 mb-6 grid grid-cols-2 gap-y-3 border-y py-4 min-[600px]:grid-cols-4">
        {tiles.map(([n, label], i) => (
          <div key={label} className={cn("px-4", i % 2 && "border-l", i === 2 && "min-[600px]:border-l")}>
            <dt className="text-[13px] text-muted-foreground">{label}</dt>
            <dd className="m-0 text-2xl font-semibold">{n}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mb-2 flex items-center gap-2 text-base font-semibold"><Icon d={ICON.spark} />{t("讀法", "Readings")}</h3>
      <div className="mb-6 grid divide-y">
        {(["PL", "SO"] as const).map((cls) => {
          const vs = s.versions.filter((v) => v.key.endsWith(`/${cls}`)).slice().reverse();
          const count = s.approved.find((a) => a.cls === cls)?.count ?? 0;
          if (!vs.length && !count) return null;
          return (
            <section key={cls} className="py-3 first:pt-1">
              <div className="flex items-center gap-3">
                <DocIcon so={cls === "SO"} />
                <strong className="flex-1 font-medium">{L.DOC_TYPE[cls]}</strong>
                <span className="text-[13px] text-muted-foreground">{t(`已確認 ${count} 份`, `${count} approved`)}</span>
              </div>
              {!vs.length && <p className="mt-2 text-[13px] text-muted-foreground">{t("一直都讀對，用通用讀法，還不需要專屬版本。", "Always read right with the general reading; no own version needed yet.")}</p>}
              {vs.length > 0 && <ol className="m-0 mt-3 grid list-none gap-0 p-0">{vs.map((v, i) => <Version key={v.id} v={v} last={i === vs.length - 1} />)}</ol>}
            </section>
          );
        })}
      </div>

      <h3 className="mb-2 flex items-center gap-2 text-base font-semibold"><Icon d={ICON.clock} />{t("最近的文件", "Recent documents")}</h3>
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {s.docs.slice(0, 5).map((d) => (
          <li key={d.id}>
            <a href={`#${d.id}`} className="flex items-center gap-3 rounded-xl p-2 text-foreground no-underline transition-colors hover:bg-accent/70">
              <DocIcon so={d.cls === "SO"} />
              <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
              {statusBadge(d)}
              <span className="w-28 text-right text-[13px] whitespace-nowrap text-muted-foreground">{when(d.created_at)}</span>
            </a>
          </li>
        ))}
        {!s.docs.length && <li className="text-sm text-muted-foreground">{t("文件清單裡還沒有這家的文件。", "No documents from this sender in the list yet.")}</li>}
      </ul>
    </Card>
  );
}

/** One reading version on a timeline; the active one is open. */
function Version({ v, last }: { v: ReadingVersion; last: boolean }) {
  const L = labels();
  const active = v.status === "active";
  return (
    <li className="relative pb-3 pl-6 last:pb-0">
      {!last && <span aria-hidden="true" className="absolute top-3 bottom-0 left-[5px] w-px bg-border" />}
      <span aria-hidden="true" className={cn("absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-white", active ? "bg-ok" : v.status === "retired" ? "bg-input" : "bg-primary")} />
      <details open={active}>
        <summary className="cursor-pointer text-sm">
          <span className="font-medium">{t(`第 ${v.version} 版`, `Version ${v.version}`)}</span>
          <span className={cn("ml-2 text-xs", active ? "font-medium text-ok" : "text-muted-foreground")}>
            {active ? t("使用中", "active") : v.status === "retired" ? t("已停用", "retired") : t("候選", "candidate")}
          </span>
          {v.change && <span className="ml-2 text-[13px] text-muted-foreground">{v.change}</span>}
        </summary>
        <div className="mt-2 grid gap-2 text-[13px]">
          {!!v.columns.length && (
            <div className="flex flex-wrap gap-1.5">
              {v.columns.map((c, i) => (
                <span key={i} className="rounded-full bg-accent px-2.5 py-0.5 text-xs">{c.label.replace(/\n/g, " ")} → <b className="font-medium text-primary">{L.FIELD[c.field] ?? c.field}</b></span>
              ))}
            </div>
          )}
          {v.notes.length > 0 && <ul className="m-0 list-disc pl-5 text-muted-foreground">{v.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          {v.always_review.length > 0 && <p className="text-warn">{t("固定請人確認：", "Always reviewed: ")}{v.always_review.map((p) => { const k = p.split(".").pop()!; return L.FIELD[k] ?? L.HEAD[k] ?? L.TOTAL[k] ?? p; }).join(t("、", ", "))}</p>}
          <p className="text-muted-foreground">{t(`依據 ${v.examples} 份確認過的文件`, `Based on ${v.examples} approved document${v.examples === 1 ? "" : "s"}`)}</p>
        </div>
      </details>
    </li>
  );
}
