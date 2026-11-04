import type { ModelId, Usage } from "./models.ts";

export type AttemptPurpose =
  | "extract" | "reask" | "reread_profile" | "template_fallback" | "rule_reread" | "reextract" | "explain" | "compile" | "publish_check";

export type LedgerEntry = {
  /** One per attempt. */
  call_id: string;
  step_id: string;
  /** Where the request body sent for this step is kept; null when the gateway keeps none. */
  prompt_key: string | null;
  attempt_purpose: AttemptPurpose;
  attempt: number;
  model: ModelId;
  usage: Usage | null;
  /** null when the cost is unknown (client-side timeout after the request was sent). */
  cost_usd: number | null;
  ms: number;
  request_id: string | null;
};

export interface Ledger {
  /** Idempotent on (step_id, attempt_purpose, attempt): a replay writes nothing new. */
  record(e: LedgerEntry): Promise<void>;
  total(): Promise<number>;
}

/** M1 ledger with no database; M2 replaces it with the Postgres one. */
export function memoryLedger(): Ledger & { entries: LedgerEntry[] } {
  const rows = new Map<string, LedgerEntry>();
  return {
    get entries() {
      return [...rows.values()];
    },
    async record(e) {
      const k = `${e.step_id}|${e.attempt_purpose}|${e.attempt}`;
      if (!rows.has(k)) rows.set(k, e);
    },
    async total() {
      return [...rows.values()].reduce((s, e) => s + (e.cost_usd ?? 0), 0);
    },
  };
}
