// Data lives here: what is queried, changed and written at once. Files (R2 on a host) keep PDFs, read results, example contents and request bodies.
// Plain Postgres through Drizzle only (no provider features), so the host can be any Postgres.
import { and, desc, eq, inArray, isNull, lt, lte, or, sql, sum } from "drizzle-orm";
import { boolean, date, doublePrecision, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { Ledger, LedgerEntry } from "../gateway/ledger.ts";
import type { Approved, Page, PromptVersion } from "../profiles/loop.ts";

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
  space_id: text().notNull(), doc_id: text().notNull(), sender: text().notNull(), cls: text().notNull(),
  // The approved answer and what the model read; the pages are the document's own, in its read result.
  answer: jsonb().notNull(), model: jsonb().notNull(),
}, (t) => [primaryKey({ columns: [t.space_id, t.doc_id] })]);

// One row per UTC day for every space: a reset must not refill the day.
export const usage = pgTable("usage", { day: text().primaryKey(), n: integer().notNull().default(0) });

export const modelCalls = pgTable("model_calls", {
  call_id: text().primaryKey(), space_id: text().notNull(), doc_id: text(),
  step_id: text().notNull(), attempt_purpose: text().notNull(), attempt: integer().notNull(), model: text().notNull(),
  usage: jsonb(), cost_usd: doublePrecision(), ms: integer().notNull(), request_id: text(), prompt_key: text(),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("one_call_per_attempt").on(t.step_id, t.attempt_purpose, t.attempt)]);

// A sender on hold is never approved without a person (set by "this one is wrong", cleared by a clean review).
export const holds = pgTable("holds", {
  space_id: text().notNull(), sender: text().notNull(), hold: boolean().notNull(),
}, (t) => [primaryKey({ columns: [t.space_id, t.sender] })]);

// The export flow of a space: its graph and the secret its webhooks are signed with.
export const flows = pgTable("flows", { space_id: text().primaryKey(), flow: jsonb().notNull() });

// A failed delivery waiting for its next try.
export const retries = pgTable("retries", {
  space_id: text().notNull(), delivery_id: text().notNull(), doc_id: text().notNull(), due: text().notNull(),
}, (t) => [primaryKey({ columns: [t.space_id, t.delivery_id] })]);

// The standard record of a document: one column per field, whatever the sender printed or called it. Written after
// the read (parsed and converted) and again at approval (with a person's corrections); exports read these.
export const docHeader = pgTable("doc_header", {
  space_id: text().notNull(), doc_id: text().notNull(),
  doc_no: text(), doc_date: date({ mode: "string" }), booking_no: text(), shipper: text(), consignee: text(), notify: text(),
  pol: text(), pod: text(), etd: date({ mode: "string" }), eta: date({ mode: "string" }), vessel: text(), voyage: text(), shipping_marks: text(),
  total_pkgs: numeric(), total_pallets: numeric(), total_qty: numeric(), total_gw_kg: numeric(), total_nw_kg: numeric(),
  total_cbm: numeric(), total_gw_with_pallets_kg: numeric(), total_pkgs_in_words: text(),
}, (t) => [primaryKey({ columns: [t.space_id, t.doc_id] })]);

export const docRows = pgTable("doc_rows", {
  space_id: text().notNull(), doc_id: text().notNull(), page: integer().notNull(), row: integer().notNull(),
  po: text(), part_no: text(), revision: text(), hs_code: text(), lot_no: text(), description: text(),
  pkg_from: integer(), pkg_to: integer(), pkgs: numeric(), pallet_from: integer(), pallet_to: integer(), pallets: numeric(),
  qty_per_pkg: numeric(), qty: numeric(), qty_unit: text(), nw_kg: numeric(), gw_kg: numeric(), cbm: numeric(),
}, (t) => [primaryKey({ columns: [t.space_id, t.doc_id, t.page, t.row] })]);

// Learning from an approved document's corrections runs after the approval answers: a job per document, claimed by
// one worker at a time; a claim older than a few minutes (the worker died) is taken again.
export const learnJobs = pgTable("learn_jobs", {
  space_id: text().notNull(), doc_id: text().notNull(), started_at: text(), tries: integer().notNull().default(0),
}, (t) => [primaryKey({ columns: [t.space_id, t.doc_id] })]);

// A corrected value that the printed text does not explain: the rule that turned the text into a value needs a look.
export const ruleReviews = pgTable("rule_reviews", {
  space_id: text().notNull(), doc_id: text().notNull(), key: text().notNull(),
  printed: text(), read: text(), fixed: text(),
}, (t) => [primaryKey({ columns: [t.space_id, t.doc_id, t.key] })]);

/** Field values only; the printed text each came from stays in the document's read result. */
export type DocValues = {
  header: Record<string, string | null>;
  rows: ({ page: number; row: number } & Record<string, string | number | null>)[];
};

export type RetryRow ={ delivery_id: string; doc_id: string; due: string };

export type DocRow = {
  id: string; name: string; sender: string | null; cls: string | null; status: "review" | "approved" | "auto";
  created_at: string; flagged: number | null; reopened: boolean;
  approved_at: string | null; prompt_version_id: string | null; template_hash: string | null; model: string | null;
};
export type ApprovedRef = Omit<Approved, "pages">;
export type CallRow = LedgerEntry & { doc_id: string | null };

export interface Db {
  /** Upsert by id; never writes approved_at, so a save cannot undo an approval. */
  putDoc(space: string, d: Omit<DocRow, "approved_at">): Promise<void>;
  listDocs(space: string): Promise<DocRow[]>;
  /** Whether the space has this document: a file alone does not make a document visible. */
  hasDoc(space: string, id: string): Promise<boolean>;
  /** Claims the document: true only for the one request that set approved_at. */
  markApproved(space: string, id: string, approved_at: string): Promise<boolean>;
  clearApproved(space: string, id: string): Promise<void>;
  markReopened(space: string, id: string): Promise<void>;
  /** The row, its approved example and its pending retries, at once. */
  deleteDoc(space: string, id: string): Promise<void>;
  loadProfiles(space: string): Promise<{ versions: PromptVersion[]; approved: ApprovedRef[] }>;
  /** One transaction; a version's content is never rewritten, only its status. */
  saveProfiles(space: string, c: { put: PromptVersion[]; added: ApprovedRef[]; removed: string[] }): Promise<void>;
  /** Atomic: false, and nothing counted, once the day holds cap actions. */
  spend(day: string, cap: number): Promise<boolean>;
  recordCall(space: string, c: CallRow): Promise<void>;
  totalCost(space: string): Promise<number>;
  /** Senders with a hold row, true or false. */
  holds(space: string): Promise<Record<string, boolean>>;
  setHold(space: string, sender: string, hold: boolean): Promise<void>;
  getFlow(space: string): Promise<unknown | null>;
  /** With onlyIfMissing, a flow another request saved first is kept. */
  putFlow(space: string, flow: unknown, onlyIfMissing?: boolean): Promise<void>;
  /** Replaces the document's standard record at once. */
  putValues(space: string, id: string, v: DocValues): Promise<void>;
  getValues(space: string, id: string): Promise<DocValues | null>;
  /** Replaces the document's rule review rows. */
  putRuleReviews(space: string, id: string, rows: { key: string; printed: string | null; read: string | null; fixed: string | null }[]): Promise<void>;
  queueLearn(space: string, id: string): Promise<void>;
  /** Jobs not started, or started before staleBefore, with how often they were tried. */
  dueLearns(space: string, staleBefore: string): Promise<{ doc_id: string; tries: number }[]>;
  /** True for the one caller that took the job. */
  claimLearn(space: string, id: string, now: string, staleBefore: string): Promise<boolean>;
  dropLearn(space: string, id: string): Promise<void>;
  queueRetry(space: string, r: RetryRow): Promise<void>;
  dropRetry(space: string, delivery_id: string): Promise<void>;
  dueRetries(space: string, now: string): Promise<RetryRow[]>;
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
    async hasDoc(space, id) {
      return (await db.select({ id: documents.id }).from(documents).where(one(space, id)).limit(1)).length > 0;
    },
    async markApproved(space, id, approved_at) {
      const r = await db.update(documents).set({ approved_at }).where(and(one(space, id), isNull(documents.approved_at))).returning({ id: documents.id });
      return r.length > 0;
    },
    async clearApproved(space, id) { await db.update(documents).set({ approved_at: null }).where(one(space, id)); },
    async deleteDoc(space, id) {
      await db.transaction(async (tx) => {
        await tx.delete(approvedExamples).where(and(eq(approvedExamples.space_id, space), eq(approvedExamples.doc_id, id)));
        await tx.delete(retries).where(and(eq(retries.space_id, space), eq(retries.doc_id, id)));
        await tx.delete(docRows).where(and(eq(docRows.space_id, space), eq(docRows.doc_id, id)));
        await tx.delete(docHeader).where(and(eq(docHeader.space_id, space), eq(docHeader.doc_id, id)));
        await tx.delete(learnJobs).where(and(eq(learnJobs.space_id, space), eq(learnJobs.doc_id, id)));
        await tx.delete(ruleReviews).where(and(eq(ruleReviews.space_id, space), eq(ruleReviews.doc_id, id)));
        await tx.delete(documents).where(one(space, id));
      });
    },
    async markReopened(space, id) { await db.update(documents).set({ approved_at: null, reopened: true }).where(one(space, id)); },
    async loadProfiles(space) {
      const vs = await db.select().from(promptVersions).where(eq(promptVersions.space_id, space));
      const ap = await db.select().from(approvedExamples).where(eq(approvedExamples.space_id, space)).orderBy(approvedExamples.n);
      return {
        versions: vs.map(({ space_id: _, ...v }) => v as PromptVersion),
        approved: ap.map((a) => ({ doc_id: a.doc_id, sender: a.sender, cls: a.cls, answer: a.answer as Page[], model: a.model as Page[] })),
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
    async holds(space) {
      const rows = await db.select({ sender: holds.sender, hold: holds.hold }).from(holds).where(eq(holds.space_id, space));
      return Object.fromEntries(rows.map((r) => [r.sender, r.hold]));
    },
    async setHold(space, sender, hold) {
      await db.insert(holds).values({ space_id: space, sender, hold }).onConflictDoUpdate({ target: [holds.space_id, holds.sender], set: { hold } });
    },
    async getFlow(space) {
      const [r] = await db.select({ flow: flows.flow }).from(flows).where(eq(flows.space_id, space));
      return r?.flow ?? null;
    },
    async putFlow(space, flow, onlyIfMissing = false) {
      const q = db.insert(flows).values({ space_id: space, flow });
      await (onlyIfMissing ? q.onConflictDoNothing() : q.onConflictDoUpdate({ target: flows.space_id, set: { flow } }));
    },
    async putValues(space, id, v) {
      await db.transaction(async (tx) => {
        const head = { ...v.header, space_id: space, doc_id: id } as typeof docHeader.$inferInsert;
        await tx.insert(docHeader).values(head).onConflictDoUpdate({ target: [docHeader.space_id, docHeader.doc_id], set: head });
        await tx.delete(docRows).where(and(eq(docRows.space_id, space), eq(docRows.doc_id, id)));
        if (v.rows.length) await tx.insert(docRows).values(v.rows.map((r) => ({ ...r, space_id: space, doc_id: id }) as typeof docRows.$inferInsert));
      });
    },
    async getValues(space, id) {
      const [h] = await db.select().from(docHeader).where(and(eq(docHeader.space_id, space), eq(docHeader.doc_id, id)));
      if (!h) return null;
      const rows = await db.select().from(docRows).where(and(eq(docRows.space_id, space), eq(docRows.doc_id, id))).orderBy(docRows.page, docRows.row);
      const { space_id: _, doc_id: __, ...header } = h;
      return { header, rows: rows.map(({ space_id: _, doc_id: __, ...r }) => r) };
    },
    async putRuleReviews(space, id, rows) {
      await db.transaction(async (tx) => {
        await tx.delete(ruleReviews).where(and(eq(ruleReviews.space_id, space), eq(ruleReviews.doc_id, id)));
        if (rows.length) await tx.insert(ruleReviews).values(rows.map((r) => ({ ...r, space_id: space, doc_id: id })));
      });
    },
    async queueLearn(space, id) {
      await db.insert(learnJobs).values({ space_id: space, doc_id: id }).onConflictDoUpdate({ target: [learnJobs.space_id, learnJobs.doc_id], set: { started_at: null, tries: 0 } });
    },
    async dueLearns(space, staleBefore) {
      return await db.select({ doc_id: learnJobs.doc_id, tries: learnJobs.tries }).from(learnJobs)
        .where(and(eq(learnJobs.space_id, space), or(isNull(learnJobs.started_at), lt(learnJobs.started_at, staleBefore))));
    },
    async claimLearn(space, id, now, staleBefore) {
      const r = await db.update(learnJobs).set({ started_at: now, tries: sql`${learnJobs.tries} + 1` })
        .where(and(eq(learnJobs.space_id, space), eq(learnJobs.doc_id, id), or(isNull(learnJobs.started_at), lt(learnJobs.started_at, staleBefore))))
        .returning({ id: learnJobs.doc_id });
      return r.length > 0;
    },
    async dropLearn(space, id) {
      await db.delete(learnJobs).where(and(eq(learnJobs.space_id, space), eq(learnJobs.doc_id, id)));
    },
    async queueRetry(space, r) {
      await db.insert(retries).values({ space_id: space, ...r }).onConflictDoUpdate({ target: [retries.space_id, retries.delivery_id], set: { doc_id: r.doc_id, due: r.due } });
    },
    async dropRetry(space, delivery_id) {
      await db.delete(retries).where(and(eq(retries.space_id, space), eq(retries.delivery_id, delivery_id)));
    },
    async dueRetries(space, now) {
      return await db.select({ delivery_id: retries.delivery_id, doc_id: retries.doc_id, due: retries.due }).from(retries)
        .where(and(eq(retries.space_id, space), lte(retries.due, now)));
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
