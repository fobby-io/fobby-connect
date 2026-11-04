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
          <h1 className="text-2xl leading-tight font-semibold tracking-[-0.3px]">{t("廠商", "Senders")}</h1>
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
  const learned = (["PL", "SO"] as const).flatMap((cls) => {
    const v = s.versions.find((x) => x.status === "active" && x.key.endsWith(`/${cls}`));
    return v ? [[cls, v] as const] : [];
  });
  const tiles = [[approved, t("已確認", "Approved in total")], [auto, t("自動確認", "Approved automatically")], [reopened, t("事後被改", "Corrected later")], [waiting, t("待審核", "To review")]] as const;
  return (
    <Card className="gap-0 p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Avatar name={s.sender} big />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-[-0.2px]">{s.sender}</h2>
          <a href="#/flow" className="text-[13px] text-primary">{t("出口設定 →", "Export settings →")}</a>
        </div>
        <State s={s} />
      </div>
      {s.hold && <p className="mb-5 rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn">{t("自動確認的文件事後被改過，下一份審核沒改就恢復。", "Paused after a correction; resumes when a reviewed document needs no change.")}</p>}

      <dl className="m-0 mb-6 grid grid-cols-2 gap-y-3 border-y py-4 min-[600px]:grid-cols-4">
        {tiles.map(([n, label], i) => (
          <div key={label} className={cn("px-4", i % 2 && "border-l", i === 2 && "min-[600px]:border-l")}>
            <dt className="text-[13px] text-muted-foreground">{label}</dt>
            <dd className="m-0 text-2xl font-semibold">{n}</dd>
          </div>
        ))}
      </dl>

      {/* Only what was learned from corrections; version history is the system's business. */}
      {learned.length > 0 && (
        <>
          <h3 className="mb-2 flex items-center gap-2 text-base font-semibold"><Icon d={ICON.spark} />{t("從修正學到的", "Learned from corrections")}</h3>
          <div className="mb-6 grid divide-y">
            {learned.map(([cls, v]) => (
              <section key={cls} className="py-3 first:pt-1">
                <div className="mb-2 flex items-center gap-3">
                  <DocIcon so={cls === "SO"} />
                  <strong className="font-medium">{L.DOC_TYPE[cls]}</strong>
                </div>
                <Learned v={v} />
              </section>
            ))}
          </div>
        </>
      )}

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

/** The rules in use for one document type: column names, notes, fields a person always checks. */
function Learned({ v }: { v: ReadingVersion }) {
  const L = labels();
  return (
    <div className="grid gap-2 pl-12 text-[13px]">
      {!!v.columns.length && (
        <div className="flex flex-wrap gap-1.5">
          {v.columns.map((c, i) => (
            <span key={i} className="rounded-full bg-accent px-2.5 py-0.5 text-xs">{c.label.replace(/\n/g, " ")} → <b className="font-medium text-primary">{L.FIELD[c.field] ?? c.field}</b></span>
          ))}
        </div>
      )}
      {v.notes.length > 0 && <ul className="m-0 list-disc pl-5">{v.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {v.always_review.length > 0 && <p className="text-warn">{t("固定請人確認：", "Always reviewed: ")}{v.always_review.map((p) => { const k = p.split(".").pop()!; return L.FIELD[k] ?? L.HEAD[k] ?? L.TOTAL[k] ?? p; }).join(t("、", ", "))}</p>}
    </div>
  );
}
