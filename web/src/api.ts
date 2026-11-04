import type { NormDoc } from "../../src/normalize/normalize.ts";
import type { Finding, Page } from "./diff.ts";

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
export const CREDIT_TEXT = "示範額度已用完，請打開範例貨件";
