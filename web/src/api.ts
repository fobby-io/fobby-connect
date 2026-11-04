import type { NormDoc } from "../../src/normalize/normalize.ts";
import type { Finding, Page } from "./diff.ts";
import { t } from "./i18n.ts";

export type { NormDoc };
// What the screen reads of src/profiles/loop.ts LearnResult; importing it would pull Node built-ins into the web check.
type Version = { version: number; notes: string[] };
export type LearnResult =
  | { outcome: "no_change" }
  | { outcome: "activated"; version: Version; tries: number; scores: { candidate: number[]; current: number[] } }
  | { outcome: "kept"; version: Version | null; always_review: string[]; tries: number };
export type Approved = { sender: string; learn: LearnResult; corrected: number; approved_at?: string };
// What src/verify/jev.ts and src/server/app.ts return about the second system's check and automatic approval.
export type PageCheck = { page_no: number; checked: boolean; values: Record<string, number>; rows: (number | null)[][] };
export type Verification = { pages: PageCheck[]; checked: number; flagged: number; unchecked_pages: number; cost_usd: number; error?: string };
export type AutoReason = "unknown_sender" | "on_hold" | "not_checked" | "flagged" | "findings" | "layout_changed" | "reopened";
/** Same marks as the server's PASS and WRONG. */
export const PASS = 0.75, WRONG = 0.5;
// The `view` the server returns for a document.
export type Doc = {
  id: string; name: string; normalized: NormDoc; approved: Approved | null; created_at: string | null;
  verify: Verification | null; auto: { ok: boolean; reasons: AutoReason[] } | null; deliveries: Delivery[];
  source?: { via: "email"; from: string; subject: string } | null;
  run: {
    cls: string | null; sender: string | null; issuer: string | null;
    prompt: { level: string; version: number } | null;
    pages: { page_no: number; route: "text" | "vision"; output: Page }[]; findings: Finding[];
  };
};
export type Sample = { id: string; name: string; sender: string };
// What src/server/webhook.ts records for one POST to a receiver.
export type Delivery = {
  id: string; event: string; name: string; url: string; at: string;
  status: number | null; ok: boolean; receipt: string | null; ms: number; error?: string;
  /** Which try this was, and when the next one is due; null when delivered or given up. Older records have neither. */
  attempt?: number; next_at?: string | null;
};
export type ListedDoc = {
  id: string; name: string; sender: string | null; cls: string | null; status: "review" | "approved" | "auto";
  created_at: string; flagged: number | null; reopened: boolean;
};
export type ReadingVersion = { id: string; key: string; version: number; status: string; notes: string[]; columns: { field: string; label: string }[]; always_review: string[]; change: string; examples: number };
export type SenderInfo = { sender: string; hold: boolean; versions: ReadingVersion[]; approved: { cls: string; count: number }[]; docs: ListedDoc[] };

export const reasonText = (r: AutoReason) => ({
  unknown_sender: t("第一次收到這家的這種文件", "First document of this kind from this sender"),
  on_hold: t("這家之前有一份自動確認後被改過，先暫停自動確認", "An earlier automatic approval for this sender was corrected, so automatic approval is paused"),
  not_checked: t("第二系統沒有核對到每個值（核對失敗，或頁面沒有文字也沒有掃描圖）", "The second system could not check every value (a failed check, or a page with neither text nor a scan image)"),
  flagged: t("第二系統對某些值有疑慮", "The second system doubts some values"),
  findings: t("自動核對有沒通過的項目", "Some automatic checks failed"),
  layout_changed: t("欄位跟這家上一份不一樣，可能換了格式", "The columns differ from this sender's last document; the layout may have changed"),
  reopened: t("這份被標成有錯，重新審核", "This document was marked wrong and reopened"),
})[r];

// Every error response is { error: { code, message } }; the screen shows message and branches on code.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function request(path: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(path, init);
  if (r.ok) return r;
  const body = await r.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  throw new ApiError(r.status, body?.error?.code ?? "failed", body?.error?.message ?? `HTTP ${r.status}`);
}

export const api = async <T>(path: string, init?: RequestInit): Promise<T> => (await request(path, init)).json() as Promise<T>;

export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const isCreditExhausted = (e: unknown) => e instanceof ApiError && e.code === "credit_exhausted";
export const creditText = () => t("示範額度已用完，請打開範例貨件", "The demo credit is used up. Open a sample shipment instead.");

// The server writes its messages in Chinese; known codes get both languages here, anything else shows the server's text.
const MESSAGES: Record<string, [zh: string, en: string]> = {
  credit_exhausted: ["示範額度已用完，請打開範例貨件", "The demo credit is used up. Open a sample shipment instead."],
  too_many_pages: ["這份文件超過 20 頁，示範版一次最多讀 20 頁。", "This document has more than 20 pages; the demo reads at most 20 per upload."],
  too_large: ["檔案超過 25 MB。", "The file is over 25 MB."],
  bad_column: ["請填文件上印的欄名，並選它是哪個欄位。", "Name the printed column and pick what it is."],
  still_missing: ["重讀後還是沒有這一欄，或對不上原本的列。請確認欄名和文件上印的一樣。", "The re-read still has no such column, or its rows do not line up. Check the name matches what is printed."],
  sender_required: ["請先填寄件公司再確認。", "Name the sender before approving."],
  not_approved: ["這份文件還沒核准，核准後才能匯出。", "This document is not approved yet; approve it to export."],
  not_found: ["找不到這份文件。", "Document not found."],
  no_webhook: ["這家在出口流程裡沒有設定網址的 Webhook，也沒有設定收件人的 Email。", "This sender has no webhook with a URL and no email with a recipient in the export flow."],
  bad_flow: ["出口流程格式不對。", "The export flow is not valid."],
};
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError && MESSAGES[e.code]) return t(...MESSAGES[e.code]!);
  return e instanceof Error ? e.message : String(e);
}
