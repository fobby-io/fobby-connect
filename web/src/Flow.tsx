// The team's export flow: received → first read → second check → approved, then one branch per sender into its outputs.
// Screen only for now: nodes can be moved, added and set up, and the layout stays in this browser; only download works.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { api, type SenderInfo } from "./api.ts";
import { SECTION } from "./App.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card } from "./components/ui/card.tsx";
import { Input } from "./components/ui/input.tsx";
import { t, useLang } from "./i18n.ts";
import { cn } from "./lib/utils.ts";

type Kind = "intake" | "read" | "check" | "approve" | "switch" | "branch" | "webhook" | "email" | "download";
type Node = { id: string; kind: Kind; x: number; y: number; sender?: string; name?: string; url?: string; to?: string };
type Edge = [from: string, to: string];
type Graph = { nodes: Node[]; edges: Edge[]; autoSend: boolean };

const W = 160, H = 64, STEP = 180, KEY = "flow.v2";
const col = (i: number) => 16 + i * STEP;
const OUTPUTS: Kind[] = ["webhook", "email", "download"];
const OTHER = "*";

function initial(senders: string[]): Graph {
  const nodes: Node[] = [
    { id: "intake", kind: "intake", x: col(0), y: 150 }, { id: "read", kind: "read", x: col(1), y: 150 },
    { id: "check", kind: "check", x: col(2), y: 150 }, { id: "approve", kind: "approve", x: col(3), y: 150 },
    { id: "switch", kind: "switch", x: col(4), y: 150 },
  ];
  const edges: Edge[] = [["intake", "read"], ["read", "check"], ["check", "approve"], ["approve", "switch"]];
  const branches = [...senders.slice(0, 3), OTHER];
  let y = 24;
  branches.forEach((s, i) => {
    const b = `branch:${s}`;
    nodes.push({ id: b, kind: "branch", sender: s, x: col(5), y });
    edges.push(["switch", b]);
    // The first sender shows the two-webhook case: one into the team's own system, one into another party's.
    const outs: Node[] = i === 0 && s !== OTHER
      ? [{ id: `${b}:w1`, kind: "webhook", name: t("自己的 ERP", "Own ERP"), url: "https://erp.example.com/hooks/fobby", x: col(6), y }, { id: `${b}:w2`, kind: "webhook", name: t("報關行", "Customs broker"), url: "https://broker.example.com/in", x: col(6), y: y + H + 16 }]
      : s === OTHER ? [{ id: `${b}:e`, kind: "email", to: "ops@example.com", x: col(6), y }, { id: `${b}:d`, kind: "download", x: col(6), y: y + H + 16 }]
        : [{ id: `${b}:d`, kind: "download", x: col(6), y }];
    outs.forEach((o) => { nodes.push(o); edges.push([b, o.id]); });
    y += outs.length * (H + 16) + 18;
  });
  return { nodes, edges, autoSend: true };
}

const load = (): Graph | null => { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) as Graph : null; } catch { return null; } };
const store = (g: Graph) => { try { localStorage.setItem(KEY, JSON.stringify(g)); } catch { /* the layout is a per-browser convenience */ } };

export function Flow() {
  useLang();
  const [g, setG] = useState<Graph | null>(load);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (g) return;
    api<SenderInfo[]>("/api/senders").then((s) => setG(initial(s.map((x) => x.sender))), () => setG(initial([])));
  }, [g]);
  useEffect(() => { if (g) store(g); }, [g]);

  if (!g) return <p className="text-muted-foreground">{t("載入中…", "Loading…")}</p>;
  const selected = g.nodes.find((n) => n.id === sel) ?? null;
  const patch = (id: string, p: Partial<Node>) => setG({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) });
  const branchOf = (n: Node | null) => (n?.kind === "branch" ? n : n && OUTPUTS.includes(n.kind) ? g.nodes.find((b) => g.edges.some(([f, to]) => f === b.id && to === n.id)) ?? null : null);

  const add = (kind: Kind) => {
    const b = branchOf(selected) ?? g.nodes.find((n) => n.kind === "branch" && n.sender === OTHER)!;
    const siblings = g.nodes.filter((n) => g.edges.some(([f, to]) => f === b.id && to === n.id));
    const id = `${b.id}:${kind}:${Date.now().toString(36)}`;
    const y = Math.max(b.y, ...siblings.map((s) => s.y + H + 16));
    setG({ ...g, nodes: [...g.nodes, { id, kind, x: col(6), y, ...(kind === "webhook" ? { name: t("新的 Webhook", "New webhook"), url: "" } : kind === "email" ? { to: "" } : {}) }], edges: [...g.edges, [b.id, id]] });
    setSel(id);
  };
  const remove = (id: string) => { setG({ ...g, nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter(([f, to]) => f !== id && to !== id) }); setSel(null); };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{t("出口流程", "Export flow")}</h2>
          <p className="max-w-[820px] text-muted-foreground">{t("整個團隊一條流程。確認後的資料依寄件公司分支，每家可以接不同出口：Webhook 進自己的系統、Webhook 進別人的系統、Email 或下載。節點可以拖動，點一下設定。",
            "One flow for the team. Approved data branches by sender, and each sender can feed different outputs: a webhook into your own system, a webhook into someone else's, email or download. Drag nodes; click one to set it up.")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("新增出口：", "Add output: ")}</span>
          {OUTPUTS.map((k) => <Button key={k} size="sm" variant="outline" onClick={() => add(k)}>+ {kindName(k)}</Button>)}
          <Button size="sm" variant="ghost" onClick={() => { try { localStorage.removeItem(KEY); } catch { /* nothing stored */ } setG(null); setSel(null); }}>{t("重設", "Reset")}</Button>
        </div>
      </div>

      {/* The canvas needs the full width for seven columns, so the settings go under it. */}
      <div className="grid items-start gap-4">
        <Canvas g={g} sel={sel} onSelect={setSel} onMove={(id, x, y) => patch(id, { x, y })} />
        <Inspector g={g} node={selected} onPatch={patch} onRemove={remove} onAutoSend={(v) => setG({ ...g, autoSend: v })} />
      </div>
    </>
  );
}

const kindName = (k: Kind) => ({
  intake: t("收件", "Received"), read: t("第一系統讀取", "First read"), check: t("第二系統核對", "Second check"), approve: t("確認", "Approved"),
  switch: t("依寄件公司分支", "Branch by sender"), branch: t("廠商", "Sender"), webhook: "Webhook", email: "Email", download: t("下載", "Download"),
})[k];
const sub = (n: Node) => {
  switch (n.kind) {
    case "intake": return t("上傳 PDF・email（即將推出）", "PDF upload, email (coming)");
    case "read": return t("Meta 模型讀出每個欄位", "Meta model reads every field");
    case "check": return t("Jev 拿原文逐一核對", "Jev checks each value against the page");
    case "approve": return t("全部通過自動確認，否則人工", "Automatic when all pass, else a person");
    case "switch": return t("寄件公司 =", "Sender =");
    case "branch": return n.sender === OTHER ? t("其他所有廠商", "Every other sender") : n.sender!;
    case "webhook": return n.name ?? "";
    case "email": return n.to || t("（未設定收件人）", "(no recipient yet)");
    case "download": return t("JSON・CSV", "JSON, CSV");
  }
};
const live = (k: Kind) => k !== "webhook" && k !== "email";

function Canvas({ g, sel, onSelect, onMove }: { g: Graph; sel: string | null; onSelect: (id: string) => void; onMove: (id: string, x: number, y: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const [, redraw] = useState(0);
  useLayoutEffect(() => { redraw((n) => n + 1); }, [g.nodes.length]);
  const width = Math.max(...g.nodes.map((n) => n.x + W)) + 40, height = Math.max(...g.nodes.map((n) => n.y + H)) + 40;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));

  const down = (e: RPointerEvent, n: Node) => {
    const r = box.current!.getBoundingClientRect();
    drag.current = { id: n.id, dx: e.clientX - r.left + box.current!.scrollLeft - n.x, dy: e.clientY - r.top + box.current!.scrollTop - n.y, moved: false };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const r = box.current!.getBoundingClientRect();
    const x = Math.max(0, e.clientX - r.left + box.current!.scrollLeft - d.dx), y = Math.max(0, e.clientY - r.top + box.current!.scrollTop - d.dy);
    d.moved = true;
    onMove(d.id, Math.round(x), Math.round(y));
  };
  const up = (n: Node) => { if (!drag.current?.moved) onSelect(n.id); drag.current = null; };

  return (
    <div ref={box} className="flow-grid relative h-[620px] overflow-auto rounded-2xl border bg-card" aria-label={t("出口流程圖", "Export flow diagram")}>
      <div className="relative" style={{ width, height }}>
        <svg className="flow-edges pointer-events-none absolute inset-0" width={width} height={height} aria-hidden="true">
          {g.edges.map(([f, to]) => {
            const a = byId.get(f), b = byId.get(to);
            if (!a || !b) return null;
            const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
            return <path key={`${f}>${to}`} className={cn((sel === f || sel === to) && "live")} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} />;
          })}
        </svg>
        {g.nodes.map((n) => (
          <button key={n.id} type="button" onPointerDown={(e) => down(e, n)} onPointerMove={move} onPointerUp={() => up(n)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(n.id); }}
            className={cn("absolute flex cursor-grab touch-none flex-col items-start justify-center rounded-xl border bg-card px-3 text-left shadow-sm select-none active:cursor-grabbing",
              n.kind === "branch" && "border-primary/40", OUTPUTS.includes(n.kind) && "border-dashed", sel === n.id && "ring-2 ring-primary")}
            style={{ left: n.x, top: n.y, width: W, height: H }}>
            <span className="flex w-full items-center justify-between gap-2">
              <span className="text-[13px] font-bold">{kindName(n.kind)}</span>
              {OUTPUTS.includes(n.kind) && (live(n.kind)
                ? <span className="rounded-full bg-ok-bg px-1.5 text-[11px] text-ok">{t("可用", "Live")}</span>
                : <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{t("即將推出", "Coming")}</span>)}
            </span>
            <span className="w-full truncate text-xs text-muted-foreground">{sub(n)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Inspector({ g, node, onPatch, onRemove, onAutoSend }: {
  g: Graph; node: Node | null; onPatch: (id: string, p: Partial<Node>) => void; onRemove: (id: string) => void; onAutoSend: (v: boolean) => void;
}) {
  const field = "mb-3 block text-sm";
  return (
    <Card className={cn(SECTION, "mb-0")}>
      <label className="mb-4 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={g.autoSend} onChange={(e) => onAutoSend(e.target.checked)} />
        <span><b>{t("自動確認的文件直接送出", "Send automatically approved documents right away")}</b><br />
          <span className="text-muted-foreground">{t("關掉的話，自動確認的文件會停在清單等人按送出。", "When off, automatically approved documents wait in the list for someone to send them.")}</span></span>
      </label>
      {!node && <p className="text-sm text-muted-foreground">{t("點流程圖上的節點來設定。選一家廠商再按「新增出口」，出口會接在那家下面。", "Click a node to set it up. Select a sender, then Add output to attach it there.")}</p>}
      {node && (
        <>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-base font-bold">{kindName(node.kind)}</h3>
            {OUTPUTS.includes(node.kind) && !live(node.kind) && <Badge variant="secondary" className="rounded-full">{t("即將推出", "Coming soon")}</Badge>}
          </div>
          {node.kind === "branch" && <p className="text-sm">{node.sender === OTHER ? t("沒有自己分支的廠商都走這裡。", "Senders without their own branch go here.") : t(`寄件公司是 ${node.sender} 的文件走這條。`, `Documents from ${node.sender} go this way.`)}</p>}
          {node.kind === "webhook" && (
            <>
              <label className={field}>{t("名稱", "Name")}<Input value={node.name ?? ""} onChange={(e) => onPatch(node.id, { name: e.target.value })} /></label>
              <label className={field}>{t("網址", "URL")}<Input value={node.url ?? ""} placeholder="https://" onChange={(e) => onPatch(node.id, { url: e.target.value })} /></label>
              <ul className="mb-3 list-disc pl-5 text-[13px] text-muted-foreground">
                <li>{t("每次送出用這個出口的密鑰簽章，對方可以驗證是我們送的。", "Every delivery is signed with this output's key, so the receiver can verify it came from us.")}</li>
                <li>{t("對方回 2xx 並帶 receipt_id 才算「已收到」；沒回就重試，失敗會通知你。", "It counts as received only when the receiver answers 2xx with a receipt_id; otherwise it retries and tells you if it fails.")}</li>
                <li>{t("事後改過的文件會送一次更正版。", "A document corrected afterwards is sent again as a correction.")}</li>
              </ul>
            </>
          )}
          {node.kind === "email" && <label className={field}>{t("收件人", "Recipient")}<Input value={node.to ?? ""} placeholder="ops@example.com" onChange={(e) => onPatch(node.id, { to: e.target.value })} /></label>}
          {node.kind === "download" && <p className="text-sm">{t("確認後在文件頁下載 JSON 或 CSV，或複製下載網址。", "After approval, download JSON or CSV on the document page, or copy the download URL.")}</p>}
          {!OUTPUTS.includes(node.kind) && node.kind !== "branch" && <p className="text-sm text-muted-foreground">{sub(node)}</p>}
          {OUTPUTS.includes(node.kind) && (
            <>
              <h4 className="mt-2 mb-1 text-sm font-bold">{t("送出紀錄", "Deliveries")}</h4>
              <p className="mb-3 text-[13px] text-muted-foreground">{live(node.kind) ? t("下載不留紀錄。", "Downloads are not logged.") : t("上線後這裡列出每次送出、對方回的收據編號和重試狀態。", "Once live, every delivery, the receiver's receipt id and retries show here.")}</p>
              <Button size="sm" variant="outline" className="self-start" onClick={() => onRemove(node.id)}>{t("移除這個出口", "Remove this output")}</Button>
            </>
          )}
        </>
      )}
    </Card>
  );
}
