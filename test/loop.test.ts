import { describe, expect, it } from "vitest";
import { diff, learn, memoryStore, selectPrompt, type Approved, type Page, type PromptVersion, type Read } from "../src/profiles/loop.ts";
import { HEADER_KEYS, TOTALS_KEYS } from "../src/shared/fields.ts";

const nulls = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, null]));
const page = (pallets: string, qty = "100"): Page => ({
  doc_type: "PL", issuer: null, header: nulls(HEADER_KEYS) as Page["header"], containers: [],
  columns: [{ field: "pkg_range", label: "PLT NO" }, { field: "qty", label: "QTY" }],
  rows: [{ t: "item", cont: false, g: null, cells: [pallets, qty], box: [0, 0, 1, 1] }],
  groups: [], totals: nulls(TOTALS_KEYS) as Page["totals"], remarks: [],
});
const v = (p: Partial<PromptVersion>): PromptVersion => ({
  id: `${p.level}:${p.key}:${p.version ?? 1}`, level: "class", key: "PL", version: 1, parent: null, status: "active",
  columns: [], notes: [], examples: [], always_review: [], change: "", ...p,
});
const doc = (id: string, truth: string, read: string): Approved => ({ doc_id: id, sender: "ACME", cls: "PL", pages: [], answer: [page(truth)], model: [page(read)] });

// Fake model: reads the pallet range right only when the prompt carries the sender's note (or an example).
const fakeRead = (fixedBy: (v: PromptVersion) => boolean): Read => async (v, d) =>
  fixedBy(v) ? d.answer : d.model;

describe("reading loop", () => {
  it("selects the sender profile, then the class base, then the fallback", () => {
    const s = memoryStore({ versions: [v({ level: "fallback", key: "*" }), v({ level: "class", key: "PL" })] });
    expect(selectPrompt(s, { sender: "ACME", cls: "PL" })?.level).toBe("class");
    expect(selectPrompt(s, { sender: null, cls: "SO" })?.level).toBe("fallback");
    s.put(v({ level: "sender", key: "ACME/PL" }));
    expect(selectPrompt(s, { sender: "ACME", cls: "PL" })?.level).toBe("sender");
  });

  it("finds what the person changed, by field", () => {
    expect(diff([page("1-3", "100")], [page("1-3", "100")])).toEqual([]);
    expect(diff([page("1", "100")], [page("1-3", "100")])).toEqual([{ path: "row.pkg_range", got: "1", want: "1-3" }]);
  });

  it("makes no version when the person changed nothing", async () => {
    const s = memoryStore();
    expect((await learn(s, doc("d1", "1-3", "1-3"), fakeRead(() => true), async () => [])).outcome).toBe("no_change");
    expect(s.versions("sender", "ACME/PL")).toEqual([]);
  });

  it("activates the first sender profile when it reads the corrected document right", async () => {
    const s = memoryStore({ versions: [v({ level: "class", key: "PL" })] });
    const r = await learn(s, doc("d1", "1-3", "1"), fakeRead((p) => p.examples.length > 0), async () => []);
    expect(r.outcome).toBe("activated");
    expect(selectPrompt(s, { sender: "ACME", cls: "PL" })?.columns[0]?.label).toBe("PLT NO");
  });

  it("rewrites the notes on a repeated error and keeps them only if no earlier document gets worse", async () => {
    const s = memoryStore({ versions: [v({ level: "class", key: "PL" })] });
    const hasNote = (p: PromptVersion) => p.notes.includes("PLT NO 1-3 means pallets 1 to 3");
    await learn(s, doc("d1", "1-3", "1"), fakeRead((p) => p.examples.length > 0), async () => []);
    // d2 repeats the pallet error; only the rewritten note fixes it.
    const r = await learn(s, doc("d2", "4-6", "4"), fakeRead(hasNote), async () => ["PLT NO 1-3 means pallets 1 to 3"]);
    expect(r.outcome).toBe("activated");
    expect(selectPrompt(s, { sender: "ACME", cls: "PL" })?.version).toBe(2);
  });

  it("keeps the current version and marks the field for review when no candidate passes", async () => {
    const s = memoryStore({ versions: [v({ level: "class", key: "PL" })] });
    await learn(s, doc("d1", "1-3", "1"), fakeRead((p) => p.examples.length > 0), async () => []);
    let rewrites = 0;
    const r = await learn(s, doc("d2", "4-6", "4"), fakeRead((p) => p.version === 1 && p.level !== "class"), async () => (rewrites++, ["try"]));
    expect(r.outcome).toBe("kept");
    expect(rewrites).toBe(3);
    expect(selectPrompt(s, { sender: "ACME", cls: "PL" })?.always_review).toContain("row.pkg_range");
  });

  it("retires a sender profile that reads its own documents worse than the class base", async () => {
    const s = memoryStore({ versions: [v({ level: "class", key: "PL" })] });
    await learn(s, doc("d1", "1-3", "1"), fakeRead((p) => p.examples.length > 0), async () => []);
    const r = await learn(s, doc("d2", "4-6", "4"), fakeRead((p) => p.level === "class"), async () => ["try"]);
    expect(r.outcome).toBe("kept");
    expect(selectPrompt(s, { sender: "ACME", cls: "PL" })?.level).toBe("class");
  });
});
