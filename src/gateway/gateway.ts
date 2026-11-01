import { schemas, responseFormat, type Variant } from "../shared/model-output.ts";
import type { Ledger } from "./ledger.ts";
import { MetaError, type ChatRequest, type ContentPart, type MetaClient, type Message } from "./meta-client.ts";
import { costUsd, DEFAULT_MODEL, MODELS, type ModelId, type Usage } from "./models.ts";

// M1 form: no database, budget or RateBucket. M2 adds them behind the same calls.

export const GATEWAY = { timeout_ms: 120_000, max_retries: 2, max_tokens: 16_000 };

export class NonRetryableError extends Error {
  constructor(readonly reason: "schema_invalid" | "output_truncated" | "request_rejected" | "contributor_guard", message: string) {
    super(message);
  }
}

export type ExtractInput = {
  step_id: string;
  variant: Variant;
  instructions: string;
  page: ContentPart[];
  model?: ModelId;
  effort?: ChatRequest["reasoning_effort"];
  /** Only synthetic eval data may go to a contributor-tier model: its data is used to train Meta's models. */
  synthetic?: boolean;
  /** Extra check after Zod, e.g. item_ids citing unknown IDs; returns an issue text or null. */
  check?: (out: unknown) => string | null;
};

export type ExtractResult = { output: unknown; raw: string; usage: Usage; cost_usd: number; ms: number; calls: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function gateway(client: MetaClient, ledger: Ledger) {
  async function send(req: ChatRequest, step_id: string, purpose: "extract" | "reask") {
    for (let attempt = 0; ; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), GATEWAY.timeout_ms);
      try {
        const r = await client(req, ctl.signal);
        const cost = costUsd(req.model, r.usage);
        await ledger.record({ step_id, attempt_purpose: purpose, attempt, model: req.model, usage: r.usage, cost_usd: cost, ms: r.ms, request_id: r.request_id });
        return { ...r, cost };
      } catch (e) {
        const err = e as MetaError;
        if (ctl.signal.aborted) {
          await ledger.record({ step_id, attempt_purpose: purpose, attempt, model: req.model, usage: null, cost_usd: null, ms: GATEWAY.timeout_ms, request_id: null });
        }
        const retryable = ctl.signal.aborted || (err instanceof MetaError && err.retryable);
        if (!retryable) throw new NonRetryableError("request_rejected", err.message);
        if (attempt >= GATEWAY.max_retries) throw err;
        await sleep(1000 * 2 ** attempt + Math.random() * 500);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  async function extractPage(x: ExtractInput): Promise<ExtractResult> {
    const model = x.model ?? DEFAULT_MODEL;
    if (MODELS[model].contributor && !x.synthetic) throw new NonRetryableError("contributor_guard", `${model} may only read synthetic data`);
    const messages: Message[] = [{ role: "system", content: x.instructions }, { role: "user", content: x.page }];
    const req: ChatRequest = {
      model, messages, response_format: responseFormat(x.variant), max_tokens: GATEWAY.max_tokens,
      ...(x.effort ? { reasoning_effort: x.effort } : {}),
    };
    const total = { usage: { prompt_tokens: 0, cached_tokens: 0, completion_tokens: 0, reasoning_tokens: 0 }, cost: 0, ms: 0, calls: 0 };
    const add = (r: { usage: Usage; cost: number; ms: number }) => {
      for (const k of Object.keys(total.usage) as (keyof Usage)[]) total.usage[k] += r.usage[k];
      total.cost += r.cost; total.ms += r.ms; total.calls++;
    };

    // One re-ask on a validation failure, then the page fails with the raw output kept.
    for (const purpose of ["extract", "reask"] as const) {
      const r = await send(req, x.step_id, purpose);
      add(r);
      if (r.finish_reason === "length") throw new NonRetryableError("output_truncated", "output hit max_tokens; split the page");
      let issue: string;
      try {
        const parsed = schemas[x.variant].safeParse(JSON.parse(r.content));
        issue = parsed.success ? (x.check?.(parsed.data) ?? "") : parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        if (!issue) return { output: parsed.data, raw: r.content, usage: total.usage, cost_usd: total.cost, ms: total.ms, calls: total.calls };
      } catch (e) {
        issue = `not valid JSON: ${(e as Error).message}`;
      }
      if (purpose === "reask") throw new NonRetryableError("schema_invalid", `${issue}\nraw: ${r.content.slice(0, 2000)}`);
      messages.push({ role: "assistant", content: r.content }, { role: "user", content: `The output failed validation: ${issue}. Return the corrected JSON for the same page.` });
    }
    throw new Error("unreachable");
  }

  return { extractPage };
}
