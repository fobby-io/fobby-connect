import { describe, expect, it } from "vitest";
import type { MetaClient } from "../src/gateway/meta-client.ts";
import type { PromptVersion } from "../src/profiles/loop.ts";
import { createApp } from "../src/server/app.ts";
import { migrateStorage } from "../src/server/migrate-storage.ts";
import { pgliteDb } from "../src/server/pg-node.ts";

const enc = new TextEncoder();
const TODAY = "2026-11-05";
const run = (approved?: { approved_at?: string }) => ({
  id: "x", name: "x.pdf", pages: [], created_at: "2026-11-01T00:00:00Z",
  run: { cls: "PL", sender: "ACME", issuer: "ACME", prompt: { id: "class:PL:1" }, pages: [], findings: [], cost_usd: 0 },
  ...(approved && { approved: { sender: "ACME", learn: null, corrected: 0, answer: [], ...approved } }),
});
const listed = (id: string, created_at: string) => ({ id, name: `${id}.pdf`, sender: "ACME", cls: "PL", status: "approved", created_at, flagged: null, reopened: false });
const v = (version: number, status: PromptVersion["status"]): PromptVersion => ({
  id: `sender:ACME/PL:${version}`, level: "sender", key: "ACME/PL", version, parent: null, status, columns: [], notes: [], examples: [], always_review: [], change: "t",
});

function legacyFiles() {
  const store = new Map<string, Uint8Array>();
  const put = (k: string, x: unknown) => store.set(k, enc.encode(JSON.stringify(x)));
  put("s0/index/a.json", listed("a", "2026-11-02T00:00:00Z"));
  put("runs/index.json", [listed("a", "2026-11-02T00:00:00Z"), listed("b", "2026-11-01T00:00:00Z"), listed("gone", "2026-10-30T00:00:00Z")]);
  put("runs/a.json", run({ approved_at: "2026-11-02T01:00:00Z" }));
  put("runs/b.json", run({}));
  put("profiles.json", {
    versions: [v(1, "active"), v(2, "active")],
    // a was approved twice (before reopen removed examples): the second, later one must win.
    approved: ["a", "b", "a"].map((doc_id, i) => ({ doc_id, sender: "ACME", cls: "PL", pages: [[{ type: "text", text: `${doc_id}${i}` }]], answer: [], model: [] })),
  });
  for (const n of [1, 2, 3]) put(`usage/${TODAY}/read-${n}.json`, {});
  const files = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, b: Uint8Array) => void store.set(k, b), list: async (p: string) => [...store.keys()].filter((k) => k.startsWith(p)), delete: async (k: string) => void store.delete(k) };
  return { store, files };
}

describe("migrateStorage", () => {
  it("reports what would move and writes nothing without apply", async () => {
    const { store, files } = legacyFiles();
    const db = await pgliteDb();
    const keys = store.size;
    const r = await migrateStorage(files, db, { today: TODAY });
    expect(r.source).toEqual({ documents: 2, versions: 2, examples: 2, usage_today: 3 });
    expect(r.database).toBeNull();
    expect(r.notes.join("\n")).toMatch(/gone.*missing/);
    expect(await db.listDocs("s0")).toEqual([]);
    expect(store.size).toBe(keys);
  });

  it("moves documents, profiles and today's use, and a second run changes nothing", async () => {
    const { store, files } = legacyFiles();
    const db = await pgliteDb();
    const first = await migrateStorage(files, db, { apply: true, today: TODAY });
    expect(first.notes.join("\n")).toMatch(/example a was approved more than once/);
    expect(new TextDecoder().decode(store.get("examples/a.json"))).toContain('"a2"');
    expect((await db.loadProfiles("s0")).approved.map((a) => a.doc_id)).toEqual(["b", "a"]);
    const second = await migrateStorage(files, db, { apply: true, today: TODAY });
    expect(first.database).toEqual({ documents: 2, versions: 2, examples: 2 });
    expect(second.database).toEqual(first.database);
    // The duplicate active version is kept, retired; the highest stays active.
    expect(first.notes.join("\n")).toMatch(/sender:ACME\/PL:1.*retired/);
    const vs = (await db.loadProfiles("s0")).versions.sort((x, y) => x.version - y.version);
    expect(vs.map((x) => x.status)).toEqual(["retired", "active"]);
    // Both stay approved, b by its creation time since it predates approved_at.
    expect(await db.markApproved("s0", "a", "z")).toBe(false);
    expect(await db.markApproved("s0", "b", "z")).toBe(false);
    // Three used today, after two runs: one more fits under a cap of 4, then none.
    expect(await db.spend(TODAY, 3)).toBe(false);
    expect(await db.spend(TODAY, 4)).toBe(true);
  });

  it("leaves the app showing the same documents and senders as before", async () => {
    const { files } = legacyFiles();
    const db = await pgliteDb();
    await migrateStorage(files, db, { apply: true, today: TODAY });
    files.delete("runs/index.json");
    const noMeta: MetaClient = async () => { throw new Error("no model call expected"); };
    const app = createApp({ files, db, client: noMeta });
    const docs = await (await app.fetch(new Request("http://x/api/documents"))).json() as { id: string }[];
    expect(docs.map((d) => d.id)).toEqual(["a", "b"]);
    const senders = await (await app.fetch(new Request("http://x/api/senders"))).json() as { sender: string; approved: { count: number }[] }[];
    expect(senders.find((s) => s.sender === "ACME")?.approved[0]?.count).toBe(2);
  });
});
