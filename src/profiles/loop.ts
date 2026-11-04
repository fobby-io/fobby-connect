import { pathPattern, type LineField } from "../shared/fields.ts";
import type { ModelOutput } from "../shared/model-output.ts";
import { norm } from "../pipeline/grounding.ts";

// The reading loop (design: "Reading loop: prompt selection and learning from corrections").
// Prompt versions per level; a correction makes a candidate at the narrowest level, which is
// activated only after a replay over that level's approved documents shows no regression.

export type Level = "fallback" | "class" | "sender";
export type PromptVersion = {
  id: string; level: Level; key: string; version: number; parent: string | null;
  status: "active" | "candidate" | "retired";
  columns: { field: LineField; label: string }[];
  notes: string[];
  examples: string[];
  /** Fields this profile cannot learn; always shown to a person. */
  always_review: string[];
  change: string;
};
export type Page = ModelOutput<"compact">;
export type Approved = { doc_id: string; sender: string; cls: string; pages: unknown[]; answer: Page[]; model: Page[] };

export interface Store {
  versions(level: Level, key: string): PromptVersion[];
  put(v: PromptVersion): void;
  approved(filter: { sender?: string; cls?: string }): Approved[];
  addApproved(a: Approved): void;
  /** Sender names that have a profile or an approved document, for matching page 1's issuer. */
  senders(): string[];
}

export function memoryStore(init: { versions?: PromptVersion[]; approved?: Approved[] } = {}): Store & { dump(): { versions: PromptVersion[]; approved: Approved[] } } {
  const versions = [...(init.versions ?? [])];
  const approved = [...(init.approved ?? [])];
  return {
    versions: (level, key) => versions.filter((v) => v.level === level && v.key === key).sort((a, b) => a.version - b.version),
    put: (v) => { const i = versions.findIndex((x) => x.id === v.id); i < 0 ? versions.push(v) : (versions[i] = v); },
    approved: (f) => approved.filter((a) => (!f.sender || a.sender === f.sender) && (!f.cls || a.cls === f.cls)),
    addApproved: (a) => approved.push(a),
    // A sender approved without corrections has no profile yet, but its next document must still be recognised.
    senders: () => [...new Set([...versions.filter((v) => v.level === "sender").map((v) => v.key.split("/")[0]!), ...approved.map((a) => a.sender)])],
    dump: () => ({ versions, approved }),
  };
}

/** A new store starts with the fallback and one empty class base per document type; corrections fill them. */
export function seed(s: Store) {
  const blank = (level: Level, key: string): PromptVersion => ({
    id: `${level}:${key}:1`, level, key, version: 1, parent: null, status: "active",
    columns: [], notes: [], examples: [], always_review: [], change: "initial",
  });
  if (!s.versions("fallback", "*").length) s.put(blank("fallback", "*"));
  for (const c of ["PL", "SO"]) if (!s.versions("class", c).length) s.put(blank("class", c));
  return s;
}

const active = (s: Store, level: Level, key: string) => s.versions(level, key).find((v) => v.status === "active") ?? null;

/** Step 3: sender profile, else class base, else fallback. */
export function selectPrompt(s: Store, q: { sender: string | null; cls: string | null }): PromptVersion | null {
  return (q.sender && q.cls && active(s, "sender", `${q.sender}/${q.cls}`)) || (q.cls && active(s, "class", q.cls)) || active(s, "fallback", "*");
}

/** The class base notes come first, then the sender's own; the model sees one profile. */
export function resolvePrompt(s: Store, v: PromptVersion | null) {
  if (!v) return { columns: [], prompt_notes: [], examples: [] as string[] };
  const cls = v.level === "sender" ? active(s, "class", v.key.split("/")[1]!) : null;
  return { columns: v.columns, prompt_notes: [...(cls?.notes ?? []), ...v.notes], examples: v.examples };
}

export type FieldError = { path: string; got: string | null; want: string | null };

const cmp = (x: string | null | undefined) => (x == null || x.trim() === "" ? null : norm(x).replace(/\s+/g, " "));

/** Step 8: what the person changed, by field. Rows are aligned by order. */
export function diff(model: Page[], answer: Page[]): FieldError[] {
  // shortcut: rows aligned by index, so an inserted row shifts every row after it; align by key fields once reviews insert rows.
  const out: FieldError[] = [];
  const push = (path: string, got: string | null | undefined, want: string | null | undefined) => {
    if (cmp(got) !== cmp(want)) out.push({ path, got: got ?? null, want: want ?? null });
  };
  answer.forEach((a, p) => {
    const m = model[p];
    for (const [k, v] of Object.entries(a.header)) push(`header.${k}`, m?.header[k as keyof Page["header"]]?.v, v?.v);
    for (const [k, v] of Object.entries(a.totals)) push(`totals.${k}`, m?.totals[k as keyof Page["totals"]]?.v, v?.v);
    const mcol = (f: string) => m?.columns.findIndex((c) => c.field === f) ?? -1;
    a.rows.forEach((r, i) => {
      a.columns.forEach((c, j) => {
        const mi = mcol(c.field);
        push(`row.${c.field}`, mi < 0 ? null : m?.rows[i]?.cells[mi], r.cells[j]);
      });
    });
    const extra = (m?.rows.length ?? 0) - a.rows.length;
    if (extra !== 0) out.push({ path: "rows.count", got: String(m?.rows.length ?? 0), want: String(a.rows.length) });
  });
  return out.map((e) => ({ ...e, path: pathPattern(e.path) }));
}

/** A field wrong on an earlier approved document of the same profile is a repeated error; the rest are one-off. */
export function sortErrors(errors: FieldError[], earlier: Approved[]) {
  const seen = new Set(earlier.flatMap((a) => diff(a.model, a.answer).map((e) => e.path)));
  return { repeated: errors.filter((e) => seen.has(e.path)), oneOff: errors.filter((e) => !seen.has(e.path)) };
}

/** An example is the approved answer cut to its first 5 rows, so the prefix stays small. */
export function example(a: Approved): string {
  const p = a.answer[0]!;
  return JSON.stringify({ columns: p.columns, rows: p.rows.slice(0, 5).map((r) => ({ t: r.t, cells: r.cells })) });
}

export type Read = (prompt: PromptVersion, doc: Approved) => Promise<Page[]>;
export type Rewrite = (current: PromptVersion, errors: FieldError[], doc: Approved) => Promise<string[]>;

const errorsOf = async (read: Read, v: PromptVersion, docs: Approved[]) =>
  Promise.all(docs.map(async (d) => diff(await read(v, d), d.answer).length));

/** Step 9: the candidate must beat the current version on the new document and lose on none of the others. */
export async function validate(read: Read, current: PromptVersion | null, candidate: PromptVersion, newDoc: Approved, earlier: Approved[]) {
  const docs = [newDoc, ...earlier.slice(-10)];
  const cand = await errorsOf(read, candidate, docs);
  const cur = current ? await errorsOf(read, current, docs) : docs.map((d) => diff(d.model, d.answer).length);
  const ok = cand[0]! < cur[0]! && cand.every((n, i) => n <= cur[i]!);
  return { ok, candidate: cand, current: cur };
}

let seq = 0;
const nextVersion = (s: Store, base: PromptVersion | null, level: Level, key: string, patch: Partial<PromptVersion>): PromptVersion => {
  const vs = s.versions(level, key);
  return {
    id: `${level}:${key}:${(vs.at(-1)?.version ?? 0) + 1}:${++seq}`, level, key, version: (vs.at(-1)?.version ?? 0) + 1,
    parent: base?.id ?? null, status: "candidate",
    columns: base?.columns ?? [], notes: base?.notes ?? [], examples: base?.examples ?? [], always_review: base?.always_review ?? [], change: "",
    ...patch,
  };
};

function activate(s: Store, v: PromptVersion) {
  for (const o of s.versions(v.level, v.key)) if (o.status === "active") s.put({ ...o, status: "retired" });
  s.put({ ...v, status: "active" });
}

export type LearnResult =
  | { outcome: "no_change" }
  | { outcome: "activated"; version: PromptVersion; tries: number; scores: { candidate: number[]; current: number[] } }
  | { outcome: "kept"; version: PromptVersion | null; always_review: string[]; tries: number };

/**
 * Steps 8 and 9 for one approved document. The sender profile is the narrowest level; its first version
 * starts from the class base with the approved columns and the document as an example.
 */
export async function learn(s: Store, doc: Approved, read: Read, rewrite: Rewrite, maxTries = 3): Promise<LearnResult> {
  const key = `${doc.sender}/${doc.cls}`;
  const earlier = s.approved({ sender: doc.sender, cls: doc.cls });
  s.addApproved(doc);
  const errors = diff(doc.model, doc.answer);
  if (errors.length === 0) return { outcome: "no_change" };

  const current = active(s, "sender", key);
  const { repeated } = sortErrors(errors, earlier);
  const base = current ?? { ...nextVersion(s, null, "sender", key, {}), notes: [] };
  const columns = doc.answer[0]!.columns;
  const examples = [example(doc), ...base.examples].slice(0, 3);

  // A one-off misread only adds the document as an example; a repeated error also rewrites the notes.
  let last: Awaited<ReturnType<typeof validate>> | null = null;
  for (let tries = 1; tries <= maxTries; tries++) {
    const notes = repeated.length || tries > 1 ? await rewrite(base, repeated.length ? repeated : errors, doc) : base.notes;
    const cand = nextVersion(s, current, "sender", key, { columns, examples, notes, change: `from ${doc.doc_id}: ${errors.length} fields corrected` });
    last = await validate(read, current, cand, doc, earlier);
    if (last.ok) {
      activate(s, cand);
      return { outcome: "activated", version: cand, tries, scores: { candidate: last.candidate, current: last.current } };
    }
  }
  const always = [...new Set([...(current?.always_review ?? []), ...errors.map((e) => e.path)])];
  if (!current) return { outcome: "kept", version: null, always_review: always, tries: maxTries };
  // A profile that does worse than its class base on its own documents is retired, so the class base reads them again.
  const parent = active(s, "class", doc.cls) ?? active(s, "fallback", "*");
  if (parent) {
    const docs = [doc, ...earlier.slice(-10)];
    const [p, c] = await Promise.all([errorsOf(read, parent, docs), errorsOf(read, current, docs)]);
    if (p.reduce((a, b) => a + b, 0) < c.reduce((a, b) => a + b, 0)) {
      s.put({ ...current, status: "retired" });
      return { outcome: "kept", version: parent, always_review: always, tries: maxTries };
    }
  }
  s.put({ ...current, always_review: always });
  return { outcome: "kept", version: current, always_review: always, tries: maxTries };
}
