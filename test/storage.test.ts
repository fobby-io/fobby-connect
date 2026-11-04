import { beforeAll, describe, expect, it } from "vitest";
import { dbLedger, docOfStep, type DocRow } from "../src/server/db.ts";
import { pgliteDb } from "../src/server/pg-node.ts";
import type { PromptVersion } from "../src/profiles/loop.ts";

const doc = (id: string): Omit<DocRow, "approved_at"> => ({
  id, name: `${id}.pdf`, sender: "ACME", cls: "PL", status: "review", created_at: new Date().toISOString(),
  flagged: null, reopened: false, prompt_version_id: null, template_hash: "abc", model: "muse-spark-1.3",
});
const version = (key: string, v: number, status: PromptVersion["status"]): PromptVersion => ({
  id: `sender:${key}:${v}`, level: "sender", key, version: v, parent: null, status,
  columns: [], notes: [`v${v}`], examples: [], always_review: [], change: "test",
});

// The first PGlite compiles its wasm, slow on a cold runner: done once here, not inside the first test.
beforeAll(() => pgliteDb(), 60_000);

describe("database storage", () => {
  it("keeps both changes when two senders' profiles are saved at once", async () => {
    const db = await pgliteDb();
    await Promise.all([
      db.saveProfiles("s0", { put: [version("A/PL", 1, "active")], added: [{ doc_id: "a1", sender: "A", cls: "PL", answer: [], model: [] }], removed: [] }),
      db.saveProfiles("s0", { put: [version("B/PL", 1, "active")], added: [{ doc_id: "b1", sender: "B", cls: "PL", answer: [], model: [] }], removed: [] }),
    ]);
    const p = await db.loadProfiles("s0");
    expect(p.versions.map((v) => v.key).sort()).toEqual(["A/PL", "B/PL"]);
    expect(p.approved.map((a) => a.doc_id).sort()).toEqual(["a1", "b1"]);
  });

  it("changes only a version's status, and refuses a second active version of one key", async () => {
    const db = await pgliteDb();
    await db.saveProfiles("s0", { put: [version("A/PL", 1, "active")], added: [], removed: [] });
    // Retire then activate, in order, as learn() does.
    await db.saveProfiles("s0", { put: [{ ...version("A/PL", 1, "retired"), notes: ["rewritten"] }, version("A/PL", 2, "active")], added: [], removed: [] });
    const vs = (await db.loadProfiles("s0")).versions.sort((a, b) => a.version - b.version);
    expect(vs.map((v) => [v.version, v.status, v.notes[0]])).toEqual([[1, "retired", "v1"], [2, "active", "v2"]]);
    await expect(db.saveProfiles("s0", { put: [version("A/PL", 3, "active")], added: [], removed: [] })).rejects.toThrow();
  });

  it("lets exactly one of two approvals at once claim a document, and a later save does not undo it", async () => {
    const db = await pgliteDb();
    await db.putDoc("s0", doc("d1"));
    const won = await Promise.all([db.markApproved("s0", "d1", "2026-11-05T00:00:00Z"), db.markApproved("s0", "d1", "2026-11-05T00:00:01Z")]);
    expect(won.filter(Boolean)).toHaveLength(1);
    await db.putDoc("s0", { ...doc("d1"), status: "approved" });
    expect((await db.listDocs("s0"))[0]!.approved_at).toBe("2026-11-05T00:00:00Z");
    await db.clearApproved("s0", "d1");
    expect(await db.markApproved("s0", "d1", "2026-11-05T00:00:02Z")).toBe(true);
  });

  it("stops the day at the cap even when requests arrive at once", async () => {
    const db = await pgliteDb();
    const r = await Promise.all(Array.from({ length: 6 }, () => db.spend("2026-11-05", 5)));
    expect(r.filter((x) => !x)).toHaveLength(1);
    expect(await db.spend("2026-11-06", 5)).toBe(true);
  });

  it("keeps one space's documents and profiles from another", async () => {
    const db = await pgliteDb();
    await db.putDoc("A", doc("d1"));
    await db.saveProfiles("A", { put: [version("X/PL", 1, "active")], added: [], removed: [] });
    expect(await db.listDocs("B")).toEqual([]);
    expect(await db.loadProfiles("B")).toEqual({ versions: [], approved: [] });
    expect(await db.markApproved("B", "d1", "2026-11-05T00:00:00Z")).toBe(false);
  });

  it("writes one ledger row per attempt, tied to its document", async () => {
    const db = await pgliteDb();
    const ledger = dbLedger(db, async () => "s0");
    const e = { call_id: "c1", step_id: "d1:1:none", prompt_key: "prompts/x.json", attempt_purpose: "extract" as const, attempt: 0, model: "muse-spark-1.3" as const, usage: null, cost_usd: 0.01, ms: 5, request_id: null };
    await ledger.record(e);
    await ledger.record({ ...e, call_id: "c2" });
    expect(await ledger.total()).toBeCloseTo(0.01);
    expect(docOfStep("replay:d9:2:sender:A/PL:1")).toBe("d9");
    expect(docOfStep("d1:1:column:ctns:none")).toBe("d1");
  });
});
