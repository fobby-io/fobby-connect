// What is queried, changed and written at once lives here; PDFs, read results and example contents stay in Files.
// Plain Postgres through Drizzle only (no provider features), so the host can be any Postgres.
import { and, desc, eq, inArray, isNull, sql, sum } from "drizzle-orm";
import { boolean, doublePrecision, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { Ledger, LedgerEntry } from "../gateway/ledger.ts";
import type { PromptVersion } from "../profiles/loop.ts";

export const documents = pgTable("documents", {
  space_id: text().notNull(), id: text().notNull(),
  name: text().notNull(), sender: text(), cls: text(), status: text().notNull(),
  created_at: text().notNull(), flagged: integer(), reopened: boolean().notNull().default(false),
  approved_at: text(), prompt_version_id: text(), template_hash: text(), model: text(),
}, (t) => [primaryKey({ columns: [t.space_id, t.id] })]);

export const promptVersions = pgTable("prompt_versions", {
  space_id: text().notNull(), id: text().notNull(),
  level: text().notNull(), key: text().notNull(), version: integer().notNull(), parent: text(), status: text().notNull(),
  columns: jsonb().notNull(), notes: jsonb().notNull(), examples: jsonb().notNull(), always_review: jsonb().notNull(), change: text().notNull(),
}, (t) => [
  primaryKey({ columns: [t.space_id, t.id] }),
  uniqueIndex("one_active_version").on(t.space_id, t.level, t.key).where(sql`status = 'active'`),
]);

export const approvedExamples = pgTable("approved_examples", {
  n: integer().generatedAlwaysAsIdentity(),
  space_id: text().notNull(), doc_id: text().notNull(), sender: text().notNull(), cls: text().notNull(), key: text().notNull(),
}, (t) => [primaryKey({ columns: [t.space_id, t.doc_id] })]);

// One row per UTC day for every space: a reset must not refill the day.
export const usage = pgTable("usage", { day: text().primaryKey(), n: integer().notNull().default(0) });

export const modelCalls = pgTable("model_calls", {
  call_id: text().primaryKey(), space_id: text().notNull(), doc_id: text(),
  step_id: text().notNull(), attempt_purpose: text().notNull(), attempt: integer().notNull(), model: text().notNull(),
  usage: jsonb(), cost_usd: doublePrecision(), ms: integer().notNull(), request_id: text(), prompt_key: text(),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("one_call_per_attempt").on(t.step_id, t.attempt_purpose, t.attempt)]);

export type DocRow = {
  id: string; name: string; sender: string | null; cls: string | null; status: "review" | "approved" | "auto";
  created_at: string; flagged: number | null; reopened: boolean;
  approved_at: string | null; prompt_version_id: string | null; template_hash: string | null; model: string | null;
};
export type ApprovedRef = { doc_id: string; sender: string; cls: string; key: string };
export type CallRow = LedgerEntry & { doc_id: string | null };

export interface Db {
  /** Upsert by id; never writes approved_at, so a save cannot undo an approval. */
  putDoc(space: string, d: Omit<DocRow, "approved_at">): Promise<void>;
  listDocs(space: string): Promise<DocRow[]>;
  /** Claims the document: true only for the one request that set approved_at. */
  markApproved(space: string, id: string, approved_at: string): Promise<boolean>;
  clearApproved(space: string, id: string): Promise<void>;
  markReopened(space: string, id: string): Promise<void>;
  loadProfiles(space: string): Promise<{ versions: PromptVersion[]; approved: ApprovedRef[] }>;
  /** One transaction; a version's content is never rewritten, only its status. */
  saveProfiles(space: string, c: { put: PromptVersion[]; added: ApprovedRef[]; removed: string[] }): Promise<void>;
  /** Atomic: false, and nothing counted, once the day holds cap actions. */
  spend(day: string, cap: number): Promise<boolean>;
  recordCall(space: string, c: CallRow): Promise<void>;
  totalCost(space: string): Promise<number>;
}

// Any Drizzle Postgres database: node-postgres (Hyperdrive, Neon) or PGlite (tests, local without a URL).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pgDb(db: PgDatabase<any, any, any>): Db {
  const docCols = { id: documents.id, name: documents.name, sender: documents.sender, cls: documents.cls, status: documents.status, created_at: documents.created_at, flagged: documents.flagged, reopened: documents.reopened, approved_at: documents.approved_at, prompt_version_id: documents.prompt_version_id, template_hash: documents.template_hash, model: documents.model };
  const one = (space: string, id: string) => and(eq(documents.space_id, space), eq(documents.id, id));
  return {
    async putDoc(space, d) {
      await db.insert(documents).values({ ...d, space_id: space })
        .onConflictDoUpdate({ target: [documents.space_id, documents.id], set: { name: d.name, sender: d.sender, cls: d.cls, status: d.status, created_at: d.created_at, flagged: d.flagged, reopened: d.reopened, prompt_version_id: d.prompt_version_id, template_hash: d.template_hash, model: d.model } });
    },
    async listDocs(space) {
      return await db.select(docCols).from(documents).where(eq(documents.space_id, space)).orderBy(desc(documents.created_at)) as DocRow[];
    },
    async markApproved(space, id, approved_at) {
      const r = await db.update(documents).set({ approved_at }).where(and(one(space, id), isNull(documents.approved_at))).returning({ id: documents.id });
      return r.length > 0;
    },
    async clearApproved(space, id) { await db.update(documents).set({ approved_at: null }).where(one(space, id)); },
    async markReopened(space, id) { await db.update(documents).set({ approved_at: null, reopened: true }).where(one(space, id)); },
    async loadProfiles(space) {
      const vs = await db.select().from(promptVersions).where(eq(promptVersions.space_id, space));
      const ap = await db.select().from(approvedExamples).where(eq(approvedExamples.space_id, space)).orderBy(approvedExamples.n);
      return {
        versions: vs.map(({ space_id: _, ...v }) => v as PromptVersion),
        approved: ap.map((a) => ({ doc_id: a.doc_id, sender: a.sender, cls: a.cls, key: a.key })),
      };
    },
    async saveProfiles(space, c) {
      await db.transaction(async (tx) => {
        // Puts keep their order: a retired version is written before its successor becomes active.
        for (const v of c.put) {
          await tx.insert(promptVersions).values({ ...v, space_id: space })
            .onConflictDoUpdate({ target: [promptVersions.space_id, promptVersions.id], set: { status: v.status } });
        }
        if (c.added.length) await tx.insert(approvedExamples).values(c.added.map((a) => ({ ...a, space_id: space }))).onConflictDoNothing();
        if (c.removed.length) await tx.delete(approvedExamples).where(and(eq(approvedExamples.space_id, space), inArray(approvedExamples.doc_id, c.removed)));
      });
    },
    async spend(day, cap) {
      await db.insert(usage).values({ day, n: 0 }).onConflictDoNothing();
      const r = await db.update(usage).set({ n: sql`${usage.n} + 1` }).where(and(eq(usage.day, day), sql`${usage.n} < ${cap}`)).returning({ n: usage.n });
      return r.length > 0;
    },
    async recordCall(space, c) {
      await db.insert(modelCalls).values({ ...c, space_id: space, usage: c.usage }).onConflictDoNothing();
    },
    async totalCost(space) {
      const [r] = await db.select({ t: sum(modelCalls.cost_usd) }).from(modelCalls).where(eq(modelCalls.space_id, space));
      return Number(r?.t ?? 0);
    },
  };
}

/** The document a model call belongs to: step ids start with the doc id, or with replay: and then the doc id. */
export const docOfStep = (step_id: string) => (step_id.startsWith("replay:") ? step_id.split(":")[1] : step_id.split(":")[0]) || null;

/** The ledger kept in the database; the space is read per call, since one gateway serves every request. */
export function dbLedger(db: Db, space: () => Promise<string>): Ledger {
  return {
    record: async (e) => db.recordCall(await space(), { ...e, doc_id: docOfStep(e.step_id) }),
    total: async () => db.totalCost(await space()),
  };
}
