import { describe, expect, it } from "vitest";
import { gateway, NonRetryableError } from "../src/gateway/gateway.ts";
import { memoryLedger } from "../src/gateway/ledger.ts";
import { MetaError, type ChatResult, type MetaClient } from "../src/gateway/meta-client.ts";
import { HEADER_KEYS, TOTALS_KEYS } from "../src/shared/fields.ts";

const nulls = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, null]));
const valid = JSON.stringify({
  doc_type: "PL", issuer: null, header: nulls(HEADER_KEYS), containers: [], columns: [{ field: "description", label: "DESC" }],
  rows: [{ t: "item", cont: false, g: null, cells: ["BOLT"], box: [0, 0, 10, 10] }], groups: [], totals: nulls(TOTALS_KEYS), remarks: [],
});
const usage = { prompt_tokens: 1000, cached_tokens: 0, completion_tokens: 100, reasoning_tokens: 50 };
const reply = (content: string, finish_reason = "stop"): ChatResult => ({ content, finish_reason, usage, request_id: "r", ms: 5 });

function scripted(...steps: (ChatResult | Error)[]): MetaClient & { calls: number } {
  const c = (async () => {
    const s = steps[c.calls++]!;
    if (s instanceof Error) throw s;
    return s;
  }) as unknown as MetaClient & { calls: number };
  c.calls = 0;
  return c;
}
const input = { step_id: "s1", variant: "compact" as const, instructions: "x", page: [{ type: "text" as const, text: "p" }] };

describe("gateway", () => {
  it("returns parsed output and records the cost", async () => {
    const ledger = memoryLedger();
    const r = await gateway(scripted(reply(valid)), ledger).extractPage(input);
    expect(r.calls).toBe(1);
    expect(await ledger.total()).toBeCloseTo((1000 * 1.25 + 100 * 4.25) / 1e6);
  });

  it("re-asks once on a validation failure, then fails with the raw output", async () => {
    const ok = await gateway(scripted(reply("{}"), reply(valid)), memoryLedger()).extractPage(input);
    expect(ok.calls).toBe(2);
    await expect(gateway(scripted(reply("{}"), reply("nope")), memoryLedger()).extractPage(input)).rejects.toMatchObject({ reason: "schema_invalid" });
  });

  it("fails a truncated page instead of paying for a second full read", async () => {
    const c = scripted(reply(valid.slice(0, 50), "length"));
    await expect(gateway(c, memoryLedger()).extractPage(input)).rejects.toMatchObject({ reason: "output_truncated" });
    expect(c.calls).toBe(1);
  });

  it("does not retry a 400 but retries a 429", async () => {
    await expect(gateway(scripted(new MetaError(400, false, "bad")), memoryLedger()).extractPage(input)).rejects.toBeInstanceOf(NonRetryableError);
    const c = scripted(new MetaError(429, true, "slow down"), reply(valid));
    expect((await gateway(c, memoryLedger()).extractPage(input)).calls).toBe(1);
    expect(c.calls).toBe(2);
  });

  it("refuses contributor-tier models for anything but synthetic data", async () => {
    const g = gateway(scripted(reply(valid)), memoryLedger());
    await expect(g.extractPage({ ...input, model: "muse-spark-1.3-contributor" })).rejects.toMatchObject({ reason: "contributor_guard" });
    await expect(g.extractPage({ ...input, model: "muse-spark-1.3-contributor", synthetic: true })).resolves.toBeTruthy();
  });
});
