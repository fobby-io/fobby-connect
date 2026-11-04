import type { NormDoc } from "../../src/normalize/normalize.ts";
import type { Finding, Page } from "./diff.ts";
import { t } from "./i18n.ts";

export type { NormDoc };
// What the screen reads of src/profiles/loop.ts LearnResult; importing it would pull Node built-ins into the web check.
type Version = { version: number; notes: string[] };
export type LearnResult =
  | { outcome: "no_change" }
  | { outcome: "activated"; version: Version; tries: number; scores: { candidate: number[]; current: number[] } }
  | { outcome: "kept"; version: Version | null; always_review: string[]; tries: number }
  // Learning runs after the approval answers; failed after three tries.
  | { outcome: "pending" } | { outcome: "failed" };
export type Approved = { sender: string; learn: LearnResult; corrected: number; approved_at?: string; rules?: number };
// What src/verify/jev.ts and src/server/app.ts return about the second system's check and automatic approval.
export type PageCheck = { page_no: number; checked: boolean; values: Record<string, number>; rows: (number | null)[][] };
export type Verification = { pages: PageCheck[]; checked: number; flagged: number; unchecked_pages: number; cost_usd: number; error?: string };
export type AutoReason = "unknown_sender" | "on_hold" | "not_checked" | "flagged" | "findings" | "layout_changed" | "reopened";
/** Same marks as the server's PASS and WRONG. */
export const PASS = 0.75, WRONG = 0.5;
// The `view` the server returns for a document.
export type Doc = {
  id: string; name: string; normalized: NormDoc; fixes?: Record<string, string | null>; approved: Approved | null; created_at: string | null;
  verify: Verification | null; auto: { ok: boolean; reasons: AutoReason[] } | null; deliveries: Delivery[];
  /** Whether the flow keeps a download output for this sender. */
  download: boolean;
  source?: { via: "email"; from: string; subject: string } | null;
  run: {
    cls: string | null; sender: string | null; issuer: string | null;
    prompt: { level: string; version: number } | null;
    pages: { page_no: number; route: "text" | "vision"; output: Page }[]; findings: Finding[];
  };
};
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
  unknown_sender: t("新廠商", "New sender"),
  on_hold: t("這家的自動確認暫停中", "Automatic approval is paused for this sender"),
  not_checked: t("有些值沒有核對到", "Some values could not be checked"),
  flagged: t("有值待確認", "Some values are flagged"),
  findings: t("有檢查沒過", "Some checks failed"),
  layout_changed: t("欄位跟上一份不同", "Columns differ from the last document"),
  reopened: t("被標成有錯", "Marked wrong"),
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
export const creditText = () => t("讀取額度暫時用完了（每天有讀取上限）。", "The read credit is used up for now (reads are capped per day).");

// The server writes its messages in Chinese; known codes get both languages here, anything else shows the server's text.
const MESSAGES: Record<string, [zh: string, en: string]> = {
  credit_exhausted: ["今天的讀取額度用完了。", "Today's read limit is reached."],
  too_many_pages: ["超過 20 頁，一次最多 20 頁。", "Over 20 pages; the limit is 20 per upload."],
  too_large: ["檔案超過 25 MB。", "The file is over 25 MB."],
  not_pdf: ["不是 PDF，或檔案損壞。", "Not a PDF, or the file is broken."],
  bad_answer: ["資料格式不對，請重新整理頁面。", "Something went wrong. Reload the page."],
  bad_column: ["請填欄名並選擇欄位。", "Enter the column name and pick a field."],
  still_missing: ["還是讀不到這一欄，請確認欄名跟文件上一樣。", "Still not found. Check the name matches the document."],
  sender_required: ["請先填寄件公司。", "Enter the sender first."],
  not_approved: ["還沒確認，不能匯出。", "Approve it before exporting."],
  not_found: ["找不到這份文件。", "Document not found."],
  no_webhook: ["這家還沒設定出口（Webhook 或 Email）。", "No webhook or email set up for this sender."],
  bad_flow: ["出口流程格式不對。", "The export flow is not valid."],
};
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError && MESSAGES[e.code]) return t(...MESSAGES[e.code]!);
  return e instanceof Error ? e.message : String(e);
}
