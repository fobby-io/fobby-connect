// The team's export flow: received → first read → second check → approved, then one branch per sender into its outputs.
// The flow is kept on the server (src/server/webhook.ts reads it). Email outputs and the intake address work only where
// the server was given a way to send and receive mail (Host).
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { api, errorMessage, post, request, type Delivery, type SenderInfo } from "./api.ts";
import { SECTION, when } from "./App.tsx";
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
/** What this server can do with mail: send the email outputs, and the address it reads PDFs from. */
type Host = { mail: boolean; intake: string | null };

const W = 160, H = 64, STEP = 180;
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
  branches.forEach((s) => {
    const b = `branch:${s}`;
    nodes.push({ id: b, kind: "branch", sender: s, x: col(5), y });
    edges.push(["switch", b]);
    // Only what works with nothing set up: downloads. Webhooks and emails are the team's own, added with + Webhook / + Email.
    nodes.push({ id: `${b}:d`, kind: "download", x: col(6), y });
    edges.push([b, `${b}:d`]);
    y += H + 16 + 18;
  });
  return { nodes, edges, autoSend: true };
}

const fresh = () => api<SenderInfo[]>("/api/senders").then((s) => initial(s.map((x) => x.sender)), () => initial([]));

export function Flow() {
  useLang();
  const [g, setG] = useState<Graph | null>(null);
  const [secret, setSecret] = useState("");
  const [host, setHost] = useState<Host>({ mail: false, intake: null });
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | { error: unknown }>("idle");
  const [sel, setSel] = useState<string | null>(null);
  // What the server has, so opening the screen does not write it back; a flow the server lacks is saved at once.
  const stored = useRef("");
  useEffect(() => {
    api<{ graph: Graph | null; secret: string } & Host>("/api/flow")
      .then(async (f) => { setSecret(f.secret); setHost({ mail: f.mail, intake: f.intake }); if (f.graph) stored.current = JSON.stringify(f.graph); setG(f.graph ?? await fresh()); }, async () => setG(await fresh()));
  }, []);
  // Saved a moment after the last change, so dragging a node is one write, not one per pixel.
  useEffect(() => {
    if (!g || JSON.stringify(g) === stored.current) return;
    setSaved("saving");
    const timer = setTimeout(() => {
      request("/api/flow", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ graph: g }) })
        .then(() => { stored.current = JSON.stringify(g); setSaved("saved"); }, (e) => setSaved({ error: e }));
    }, 600);
    return () => clearTimeout(timer);
  }, [g]);

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
          <h1 className="text-xl font-bold">{t("出口流程", "Export flow")}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("新增出口：", "Add output: ")}</span>
          {OUTPUTS.map((k) => <Button key={k} size="sm" variant="outline" onClick={() => add(k)}>+ {kindName(k)}</Button>)}
          <Button size="sm" variant="ghost" onClick={async () => { setSel(null); setG(await fresh()); }}>{t("重設", "Reset")}</Button>
          <span role="status" className="text-[13px] text-muted-foreground">
            {saved === "saving" ? t("儲存中…", "Saving…") : saved === "saved" ? t("已儲存", "Saved") : typeof saved === "object" ? errorMessage(saved.error) : ""}
          </span>
        </div>
      </div>

      {/* The canvas needs the full width for seven columns, so the settings go under it. */}
      <div className="grid items-start gap-4">
        <Canvas g={g} host={host} sel={sel} onSelect={setSel} onMove={(id, x, y) => patch(id, { x, y })} />
        <Inspector g={g} host={host} node={selected} secret={secret} onPatch={patch} onRemove={remove} onAutoSend={(v) => setG({ ...g, autoSend: v })} />
      </div>
    </>
  );
}

const kindName = (k: Kind) => ({
  intake: t("收件", "Received"), read: t("讀取", "Read"), check: t("核對", "Check"), approve: t("確認", "Approved"),
  switch: t("依寄件公司分支", "Branch by sender"), branch: t("廠商", "Sender"), webhook: "Webhook", email: "Email", download: t("下載", "Download"),
})[k];
const sub = (n: Node, host: Host) => {
  switch (n.kind) {
    case "intake": return host.intake ? t(`上傳 PDF・寄到 ${host.intake}`, `PDF upload, or email to ${host.intake}`) : t("上傳 PDF", "PDF upload");
    case "read": return t("每個欄位", "Every field");
    case "check": return t("每個值（認得的廠商）", "Every value (known senders)");
    case "approve": return t("全部通過就自動", "Automatic if all pass");
    case "switch": return t("寄件公司 =", "Sender =");
    case "branch": return n.sender === OTHER ? t("其他所有廠商", "Every other sender") : n.sender!;
    case "webhook": return n.url ? n.name ?? "" : t(`${n.name ?? ""}（未設定網址）`, `${n.name ?? ""} (no URL yet)`);
    case "email": return n.to || t("（未設定收件人）", "(no recipient yet)");
    case "download": return t("JSON・CSV", "JSON, CSV");
  }
};
const live = (k: Kind, host: Host) => k !== "email" || host.mail;

/** One delivery: who got it, the status code they answered and their receipt id. */
export function DeliveryRow({ d }: { d: Delivery }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b py-1.5 text-[13px] last:border-b-0">
      <span className={cn("rounded-full px-1.5 font-mono text-xs", d.ok ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn")}>{d.status ?? (d.ok ? t("已寄出", "sent") : t("沒送到", "failed"))}</span>
      {d.url.startsWith("mailto:") && <span className="text-muted-foreground">{d.url.slice(7)}</span>}
      <b>{d.name}</b>
      <span className="text-muted-foreground">{d.event}</span>
      <span className="text-muted-foreground">{d.receipt ? t(`收據 ${d.receipt}`, `receipt ${d.receipt}`) : d.ok ? t("對方沒回收據編號", "no receipt id returned") : d.error ?? ""}</span>
      {(d.attempt ?? 1) > 1 && <span className="text-muted-foreground">{t(`第 ${d.attempt} 次`, `try ${d.attempt}`)}</span>}
      {!d.ok && (d.next_at ? <span className="text-warn">{t(`${when(d.next_at)} 自動重試`, `retries at ${when(d.next_at)}`)}</span> : d.attempt ? <span className="text-warn">{t("已停止重試", "retries stopped")}</span> : null)}
      <span className="ml-auto text-muted-foreground">{when(d.at)}・{d.ms} ms</span>
    </li>
  );
}

function TestSend({ node }: { node: Node }) {
  const [state, setState] = useState<"idle" | "busy" | Delivery | { error: unknown }>("idle");
  useEffect(() => setState("idle"), [node.id]);
  const go = async () => {
    setState("busy");
    try { setState(await post<Delivery>("/api/flow/test", { name: node.name, url: node.url })); } catch (e) { setState({ error: e }); }
  };
  return (
    <div className="mb-3">
      <Button size="sm" variant="outline" disabled={!node.url?.trim() || state === "busy"} onClick={go}>{state === "busy" ? t("送出中…", "Sending…") : t("送一筆測試", "Send a test event")}</Button>
      {typeof state === "object" && ("error" in state ? <p className="mt-1 text-[13px] text-destructive" role="alert">{errorMessage(state.error)}</p> : <ul className="mt-1 list-none p-0"><DeliveryRow d={state} /></ul>)}
    </div>
  );
}

function Canvas({ g, host, sel, onSelect, onMove }: { g: Graph; host: Host; sel: string | null; onSelect: (id: string) => void; onMove: (id: string, x: number, y: number) => void }) {
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
              {OUTPUTS.includes(n.kind) && (live(n.kind, host)
                ? <span className="rounded-full bg-ok-bg px-1.5 text-xs text-ok">{t("可用", "Live")}</span>
                : <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{t("即將推出", "Coming")}</span>)}
            </span>
            <span className="w-full truncate text-xs text-muted-foreground">{sub(n, host)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Inspector({ g, host, node, secret, onPatch, onRemove, onAutoSend }: {
  g: Graph; host: Host; node: Node | null; secret: string; onPatch: (id: string, p: Partial<Node>) => void; onRemove: (id: string) => void; onAutoSend: (v: boolean) => void;
}) {
  const field = "mb-3 block text-sm";
  return (
    <Card className={cn(SECTION, "mb-0")}>
      <label className="mb-4 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={g.autoSend} onChange={(e) => onAutoSend(e.target.checked)} />
        <span className="font-medium">{t("確認後自動送出", "Send on approval")}</span>
      </label>
      {!node && <p className="text-sm text-muted-foreground">{t("選一個節點來設定。", "Select a node to set it up.")}</p>}
      {node && (
        <>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-bold">{kindName(node.kind)}</h2>
            {OUTPUTS.includes(node.kind) && !live(node.kind, host) && <Badge variant="secondary" className="rounded-full">{t("這個伺服器沒有設定寄信", "No mail set up on this server")}</Badge>}
          </div>
          {node.kind === "branch" && <p className="text-sm">{node.sender === OTHER ? t("其他所有廠商", "Every other sender") : node.sender}</p>}
          {node.kind === "webhook" && (
            <>
              <label className={field}>{t("名稱", "Name")}<Input value={node.name ?? ""} onChange={(e) => onPatch(node.id, { name: e.target.value })} /></label>
              <label className={field}>{t("網址", "URL")}<Input value={node.url ?? ""} placeholder="https://" onChange={(e) => onPatch(node.id, { url: e.target.value })} /></label>
              <TestSend node={node} />
              <p className="mb-2 text-[13px]">{t("簽章密鑰：", "Signing secret: ")}<code className="break-all select-all">{secret}</code></p>
              {/* For whoever builds the receiving end; out of the way for everyone else. */}
              <details className="mb-3 text-[13px] text-muted-foreground">
                <summary className="cursor-pointer text-primary">{t("接收端規格", "For developers")}</summary>
                <ul className="mt-1 list-disc pl-5">
                  <li>POST JSON · <code>document.approved</code> / <code>document.corrected</code></li>
                  <li><code>X-Fobby-Signature: sha256=HMAC(secret, timestamp.body)</code>, <code>X-Fobby-Timestamp</code></li>
                  <li>{t("2xx 算送達；receipt_id 或 X-Receipt-Id 記為收據", "2xx = delivered; receipt_id or X-Receipt-Id kept as receipt")}</li>
                  <li>{t("失敗重試：1、5、30 分鐘、2 小時，delivery id 不變", "Retries after 1, 5, 30 min and 2 h with the same delivery id")}</li>
                </ul>
              </details>
            </>
          )}
          {node.kind === "email" && (
            <>
              <label className={field}>{t("收件人", "Recipient")}<Input type="email" value={node.to ?? ""} placeholder="ops@example.com" onChange={(e) => onPatch(node.id, { to: e.target.value })} /></label>
              <p className="mb-3 text-[13px] text-muted-foreground">{t("附件：JSON、CSV", "Attached: JSON, CSV")}</p>
            </>
          )}
          {node.kind === "download" && <p className="text-sm">{t("在文件頁下載 JSON、CSV", "JSON and CSV on the document page")}</p>}
          {!OUTPUTS.includes(node.kind) && node.kind !== "branch" && <p className="text-sm text-muted-foreground">{sub(node, host)}</p>}
          {OUTPUTS.includes(node.kind) && (
            <>
              <Button size="sm" variant="outline" className="self-start" onClick={() => onRemove(node.id)}>{t("移除這個出口", "Remove this output")}</Button>
            </>
          )}
        </>
      )}
    </Card>
  );
}
