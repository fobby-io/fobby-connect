import { describe, expect, it } from "vitest";
import { gateway } from "../src/gateway/gateway.ts";
import { memoryLedger } from "../src/gateway/ledger.ts";
import type { ChatRequest, MetaClient } from "../src/gateway/meta-client.ts";
import { memoryStore, type Page, type PromptVersion } from "../src/profiles/loop.ts";
import { matchSender, mergeColumns, runDocument, type PageInput } from "../src/pipeline/run.ts";
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

  it("checks the container number inside a cell that also prints the seal", () => {
    const box = [0, 0, 1, 1] as [number, number, number, number];
    const withNo = (v: string) => ({ ...page([], null), containers: [{ number: { v, box }, size_type: null, seal_no: null }] }) as unknown as Page;
    expect(checkDocument([withNo("CSQU3054383 / EMC7585259")])).toEqual([]);
    expect(checkDocument([withNo("CSQU3054384 / EMC7585259")])[0]?.message).toMatch(/ISO 6346/);
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

  it("reads every page at once with the sender's profile when the text layer names the sender and the class", async () => {
    const s = memoryStore({ versions: [v({ level: "class", key: "PL" }), v({ level: "sender", key: "ACME/PL", notes: ["ACME NOTE"] })] });
    const c = fake(() => page(["50"], "150"));
    const textPage = (n: number): PageInput => ({ ...vision(n), route: "text", items: [{ text: "ACME CORP", box: [0, 10, 100, 20] }, { text: "PACKING LIST", box: [0, 40, 100, 50] }] as PageInput["items"] });
    const r = await runDocument(gateway(c, memoryLedger()), s, [textPage(1), textPage(2), textPage(3)], { doc_id: "d" });
    expect(r.sender).toBe("ACME");
    expect(c.reqs).toHaveLength(3); // one read per page, none waiting on page 1
    for (const q of c.reqs) expect(text(q)).toContain("ACME NOTE");
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

  it("matches a sender whatever the punctuation, and prefers the longest name", () => {
    expect(matchSender("LUMEN ELECTRIC B.V.\nROTTERDAM", ["LUMEN ELECTRIC BV"])).toBe("LUMEN ELECTRIC BV");
    expect(matchSender("LUMEN ELECTRIC B.V.", ["LUMEN ELECTRIC", "LUMEN ELECTRIC BV"])).toBe("LUMEN ELECTRIC BV");
  });
});

describe("mergeColumns", () => {
  const grid = (cols: string[], rows: string[][]): Page => ({
    ...page([], null), columns: cols.map((l) => ({ field: l === "C/NO." ? "pkg_range" as const : "qty" as const, label: l })),
    rows: rows.map((cells) => ({ t: "item" as const, cont: false, g: null, cells, box: [0, 0, 1, 1] })),
  });

  it("adds only the new column, matched by package range, and keeps the clerk's cells", () => {
    const cur = grid(["C/NO.", "QTY"], [["1-3", "100 (edited)"], ["4-4", "50"]]);
    const next = grid(["C/NO.", "PLT", "QTY"], [["4-4", "1 PLT", "5"], ["1-3", "3 PLT", "10"]]);
    const out = mergeColumns(cur, next)!;
    expect(out.columns.map((c) => c.label)).toEqual(["C/NO.", "PLT", "QTY"]);
    expect(out.rows.map((r) => r.cells)).toEqual([["1-3", "3 PLT", "100 (edited)"], ["4-4", "1 PLT", "50"]]);
  });

  it("gives up when rows cannot be matched", () => {
    const cur = grid(["C/NO.", "QTY"], [["1-3", "100"], ["4-4", "50"]]);
    expect(mergeColumns(cur, grid(["C/NO.", "PLT", "QTY"], [["1-3", "3 PLT", "10"]]))).toBeNull();
  });
});
