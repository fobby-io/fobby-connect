// Prices per 1M tokens, read from dev.meta.ai/docs/pricing-rate-limits on 2026-11-01.
export const MODELS = {
  "muse-spark-1.3": { input: 1.25, cached_input: 0.15, output: 4.25, contributor: false },
  "muse-spark-1.3-contributor": { input: 0.1, cached_input: 0.002, output: 0.2, contributor: true },
} as const;
export type ModelId = keyof typeof MODELS;

export const DEFAULT_MODEL: ModelId = "muse-spark-1.3";

export type Usage = { prompt_tokens: number; cached_tokens: number; completion_tokens: number; reasoning_tokens: number };

/** Reasoning tokens are part of completion_tokens and billed at the output price. */
export function costUsd(model: ModelId, u: Usage): number {
  const p = MODELS[model];
  return ((u.prompt_tokens - u.cached_tokens) * p.input + u.cached_tokens * p.cached_input + u.completion_tokens * p.output) / 1e6;
}
