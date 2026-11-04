// The export flow's webhooks: which outputs a sender's approved documents go to, and one signed delivery.
// The flow is the graph the screen draws (web/src/Flow.tsx); the server only reads its branch and webhook nodes.
import { z } from "zod";

const Node = z.object({
  id: z.string().max(200), kind: z.string().max(20), x: z.number(), y: z.number(),
  sender: z.string().max(200).optional(), name: z.string().max(100).optional(), url: z.string().max(500).optional(), to: z.string().max(200).optional(),
});
export const Graph = z.object({
  nodes: z.array(Node).max(80), edges: z.array(z.tuple([z.string().max(200), z.string().max(200)])).max(120), autoSend: z.boolean(),
});
export type Graph = z.infer<typeof Graph>;
/** secret signs every delivery; it is made once per flow and shown on the flow screen so the receiver can verify. */
export type Flow = { graph: Graph | null; secret: string };
export type Delivery = {
  id: string; event: string; name: string; url: string; at: string;
  status: number | null; ok: boolean; receipt: string | null; ms: number; error?: string;
  /** Which try this was (1 to 5), and when the next one is due; null when delivered or given up. */
  attempt: number; next_at: string | null;
};

export const OTHER = "*";

/** The output nodes under this sender's branch, or under "every other sender" when it has none. */
function outputs(g: Graph | null, sender: string) {
  if (!g) return [];
  const branch = g.nodes.find((n) => n.kind === "branch" && n.sender?.toUpperCase() === sender.toUpperCase())
    ?? g.nodes.find((n) => n.kind === "branch" && n.sender === OTHER);
  if (!branch) return [];
  const outs = new Set(g.edges.filter(([f]) => f === branch.id).map(([, to]) => to));
  return g.nodes.filter((n) => outs.has(n.id));
}

/** The webhooks of this sender's branch. Empty URLs are skipped. */
export function targets(g: Graph | null, sender: string): { name: string; url: string }[] {
  return outputs(g, sender).filter((n) => n.kind === "webhook" && n.url?.trim()).map((n) => ({ name: n.name ?? "Webhook", url: n.url!.trim() }));
}

export const isAddress = (s: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s);
/** The email recipients of this sender's branch, each once. Empty or malformed addresses are skipped. */
export function recipients(g: Graph | null, sender: string): string[] {
  return [...new Set(outputs(g, sender).filter((n) => n.kind === "email").map((n) => n.to?.trim().toLowerCase() ?? "").filter(isAddress))];
}

/** https only and no local or private address: the server sends, so a URL must not reach inside its own network. */
export function checkUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "not a URL"; }
  if (u.protocol !== "https:") return "only https:// URLs";
  const h = u.hostname.toLowerCase();
  // shortcut: checks the name as written, not what it resolves to; a host on a private network should also block private addresses at its egress.
  if (h === "localhost" || h.endsWith(".localhost") || h.startsWith("[") || /^(127|10|0)\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return "local or private addresses are not allowed";
  return null;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Stripe-style: HMAC-SHA256 of "<timestamp>.<body>", so a receiver can check the sender and reject replays. */
export async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
}

export const newSecret = () => `whsec_${hex(crypto.getRandomValues(new Uint8Array(24)).buffer as ArrayBuffer)}`;

/** Minutes to wait before attempts 2 to 5; after the fifth failure the delivery is given up. */
export const RETRY_MINUTES = [1, 5, 30, 120];

/**
 * One POST, a retry of `prev` when given (same delivery id, so the receiver can drop a duplicate). The receipt is the
 * receiver's receipt_id (or id) from a JSON answer, or its X-Receipt-Id header. A failure gets next_at, when to try
 * again, unless the URL itself is refused or the attempts are used up. Never throws.
 */
export async function deliver(target: { name: string; url: string }, event: string, payload: unknown, secret: string, prev?: Delivery, timeoutMs = 8000): Promise<Delivery> {
  const r = await post(target, event, payload, secret, prev?.id ?? `dlv_${crypto.randomUUID().slice(0, 12)}`, timeoutMs);
  const attempt = (prev?.attempt ?? 0) + 1;
  const wait = r.ok || r.refused ? undefined : RETRY_MINUTES[attempt - 1];
  return { ...r.d, attempt, next_at: wait === undefined ? null : new Date(Date.now() + wait * 60_000).toISOString() };
}

async function post(target: { name: string; url: string }, event: string, payload: unknown, secret: string, id: string, timeoutMs: number): Promise<{ d: Omit<Delivery, "attempt" | "next_at">; ok: boolean; refused?: boolean }> {
  const at = new Date().toISOString(), t0 = Date.now();
  const base = { id, event, name: target.name, url: target.url, at };
  const bad = checkUrl(target.url);
  if (bad) return { d: { ...base, status: null, ok: false, receipt: null, ms: 0, error: bad }, ok: false, refused: true };
  const body = JSON.stringify({ id, event, created_at: at, data: payload });
  const ts = String(Math.floor(Date.now() / 1000));
  try {
    const r = await fetch(target.url, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "content-type": "application/json", "user-agent": "FobbyConnect-Webhook/1",
        "x-fobby-event": event, "x-fobby-delivery": id, "x-fobby-timestamp": ts, "x-fobby-signature": `sha256=${await sign(secret, ts, body)}`,
      },
      body,
    });
    const text = (await r.text()).slice(0, 4000);
    let receipt = r.headers.get("x-receipt-id");
    try { const j = JSON.parse(text) as { receipt_id?: unknown; id?: unknown }; receipt = String(j.receipt_id ?? j.id ?? "") || receipt; } catch { /* not JSON: header or nothing */ }
    const ok = r.status >= 200 && r.status < 300;
    return { d: { ...base, status: r.status, ok, receipt: receipt || null, ms: Date.now() - t0 }, ok };
  } catch (e) {
    return { d: { ...base, status: null, ok: false, receipt: null, ms: Date.now() - t0, error: (e as Error).name === "TimeoutError" ? `no answer in ${timeoutMs / 1000} s` : (e as Error).message }, ok: false };
  }
}
