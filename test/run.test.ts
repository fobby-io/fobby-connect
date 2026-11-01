import { describe, expect, it } from "vitest";
import { gateway } from "../src/gateway/gateway.ts";
import { memoryLedger } from "../src/gateway/ledger.ts";
import type { ChatRequest, MetaClient } from "../src/gateway/meta-client.ts";
import { memoryStore, type Page, type PromptVersion } from "../src/profiles/loop.ts";
import { matchSender, runDocument, type PageInput } from "../src/pipeline/run.ts";
import { checkDocument } from "../src/rules/checks.ts";
import { HEADER_KEYS, TOTALS_KEYS } from "../src/shared/fields.ts";

const nulls = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, null]));
const page = (rows: string[], total: string | null, issuer: string | null = "ACME CORP\nTAIPEI"): Page => ({
  doc_type: "PL", issuer, header: nulls(HEADER_KEYS) as Page["header"], containers: [],
  columns: [{ field: "pkg_qty", label: "CTNS" }],
  rows: rows.map((c) => ({ t: "item" as const, cont: false, g: null, cells: [c], box: [0, 0, 1, 1] })),
  groups: [], totals: { ...(nulls(TOTALS_KEYS) as Page["totals"]), total_pkgs: total ? { v: total, box: [0, 0, 1, 1] } : null }, remarks: [],
});
const v = (p: Partial<PromptVersion>): PromptVersion => ({
  id: `${p.level}:${p.key}`, level: "class", key: "PL", version: 1, parent: null, status: "active",
  columns: [], notes: [], examples: [], always_review: [], change: "", ...p,
});
const vision = (n: number): PageInput => ({ page_no: n, route: "vision", items: [], content: [{ type: "text", text: `page ${n}` }] });

// Fake Spark: answers from what the request carries, so tests see which prompt and hint each read used.
function fake(answer: (req: ChatRequest) => Page): MetaClient & { reqs: ChatRequest[] } {
  const reqs: ChatRequest[] = [];
  const c = (async (req: ChatRequest) => {
    reqs.push(req);
    return { content: JSON.stringify(answer(req)), finish_reason: "stop", usage: { prompt_tokens: 10, cached_tokens: 0, completion_tokens: 10, reasoning_tokens: 0 }, request_id: null, ms: 1 };
  }) as MetaClient & { reqs: ChatRequest[] };
  c.reqs = reqs;
  return c;
}
const text = (req: ChatRequest) => JSON.stringify(req.messages);

describe("checks", () => {
  it("flags row sums that disagree with the totals line, reading stacked cells by their last line", () => {
    expect(checkDocument([page(["@10\n50", "36"], "86")])).toEqual([]);
    expect(checkDocument([page(["5", "36"], "86")])[0]?.message).toMatch(/41 pkg_qty.*86/);
  });
});

describe("runDocument", () => {
  it("matches page 1's issuer to a known sender and re-reads page 1 with that sender's profile", async () => {
    const s = memoryStore({ versions: [v({ level: "class", key: "PL" }), v({ level: "sender", key: "ACME/PL", notes: ["ACME NOTE"] })] });
    const c = fake(() => page(["50"], "100"));
    const r = await runDocument(gateway(c, memoryLedger()), s, [vision(1), vision(2)], { doc_id: "d" });
    expect(r.sender).toBe("ACME");
    expect(r.prompt?.level).toBe("sender");
    expect(c.reqs).toHaveLength(3); // page 1 before the sender is known, page 1 again, page 2
    expect(text(c.reqs[2]!)).toContain("ACME NOTE");
  });

  it("re-reads only the failing page with the findings as a hint, and keeps it when it passes", async () => {
    const s = memoryStore({ versions: [v({ level: "class", key: "PL" })] });
    const c = fake((req) => (text(req).includes("Checks found problems") ? page(["50", "36"], "86", null) : page(["5", "36"], "86", null)));
    const r = await runDocument(gateway(c, memoryLedger()), s, [vision(1)], { doc_id: "d" });
    expect(r.findings).toEqual([]);
    expect(r.pages[0]!.reread).toBe(true);
    expect(c.reqs).toHaveLength(2); // the class base adds nothing yet, so page 1 is not read twice; then the re-read
  });

  it("names a sender only when the issuer contains its name", () => {
    expect(matchSender("ACME CORP.\n1 Road", ["ACME", "BOLT"])).toBe("ACME");
    expect(matchSender("OTHER LTD", ["ACME"])).toBe(null);
  });
});
