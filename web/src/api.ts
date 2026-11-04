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
// The `view` the server returns for a document.
export type Doc = {
  id: string; name: string; normalized: NormDoc; approved: Approved | null;
  run: {
    cls: string | null; sender: string | null; issuer: string | null;
    prompt: { level: string; version: number } | null;
    pages: { page_no: number; output: Page }[]; findings: Finding[];
  };
};
export type Sample = { id: string; name: string; sender: string };
export type Profile = { sender: string; versions: { key: string; version: number; status: string; notes: string[] }[] };

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
};
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError && MESSAGES[e.code]) return t(...MESSAGES[e.code]!);
  return e instanceof Error ? e.message : String(e);
}
