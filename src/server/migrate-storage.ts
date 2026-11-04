// One-time move of the state kept as JSON files (before the database) into a Db. Safe to run again: rows that exist
// are kept, and counts are compared at the end. No Node built-ins, so it runs where the files are (a folder or R2).
import { listedOf, type Files, type ListedDoc, type Saved } from "./app.ts";
import type { Approved, PromptVersion } from "../profiles/loop.ts";
import type { Db } from "./db.ts";

export type MigrationReport = {
  space: string; apply: boolean;
  source: { documents: number; versions: number; examples: number; usage_today: number; holds: number };
  database: { documents: number; versions: number; examples: number } | null;
  notes: string[];
};

const dec = new TextDecoder(), enc = new TextEncoder();

/** Without apply nothing is written: the report says what would move. */
export async function migrateStorage(files: Files, db: Db, o: { apply?: boolean; today?: string } = {}): Promise<MigrationReport> {
  const apply = !!o.apply, notes: string[] = [];
  const getJson = async <T>(key: string): Promise<T | null> => { const b = await files.get(key); return b && JSON.parse(dec.decode(b)); };
  const space = (await getJson<{ id: string }>("space.json"))?.id ?? "s0";

  // The list: one entry per document under <space>/index/, and the single list older data kept in runs/index.json.
  const own = (await Promise.all((await files.list(`${space}/index/`)).map((k) => getJson<ListedDoc>(k)))).filter((x): x is ListedDoc => !!x);
  const seen = new Set(own.map((d) => d.id));
  const listed = [...own, ...((await getJson<ListedDoc[]>("runs/index.json")) ?? []).filter((d) => !seen.has(d.id))];
  for (const d of listed) seen.add(d.id);
  // Every saved run is a document, listed or not: writes to the old single list could drop entries.
  const runIds = (await files.list("runs/")).map((k) => k.match(/^runs\/([\w-]+)\.json$/)?.[1]).filter((id): id is string => !!id && id !== "index");
  const unlisted = runIds.filter((id) => !seen.has(id));
  let documents = 0;
  for (const [id, l] of [...listed.map((x) => [x.id, x] as const), ...unlisted.map((x) => [x, null] as const)]) {
    const d = await getJson<Saved>(`runs/${id}.json`);
    if (!d) { notes.push(`document ${id} is listed but runs/${id}.json is missing: left out`); continue; }
    const row = l ?? listedOf(d);
    documents++;
    if (!apply) continue;
    await db.putDoc(space, { ...row, prompt_version_id: d.run.prompt?.id ?? null, template_hash: d.run.template_hash ?? null, model: d.run.model ?? null });
    // Documents approved before approved_at was kept still count as approved: their creation time stands in.
    if (d.approved) await db.markApproved(space, row.id, d.approved.approved_at ?? d.created_at ?? row.created_at);
  }

  // Profiles: every version with its status, and every approved example, in the order they were approved.
  const prof = (await getJson<{ versions?: PromptVersion[]; approved?: Approved[] }>("profiles.json")) ?? {};
  const versions = [...(prof.versions ?? [])];
  // Overlapping writes to the one file could leave two active versions of a key: the highest stays active.
  const top = new Map<string, number>();
  for (const v of versions) if (v.status === "active") top.set(`${v.level}|${v.key}`, Math.max(top.get(`${v.level}|${v.key}`) ?? 0, v.version));
  const fixed = versions.map((v) => {
    if (v.status !== "active" || top.get(`${v.level}|${v.key}`) === v.version) return v;
    notes.push(`${v.id} was a second active version of ${v.level} ${v.key}: moved as retired`);
    return { ...v, status: "retired" as const };
  });
  // A document approved again before reopen removed its example appears twice: the later approval is the one kept.
  const byDoc = new Map<string, Approved>();
  for (const a of prof.approved ?? []) {
    if (byDoc.delete(a.doc_id)) notes.push(`example ${a.doc_id} was approved more than once: the latest is kept`);
    byDoc.set(a.doc_id, a);
  }
  const examples = [...byDoc.values()];
  if (apply) {
    for (const a of examples) await files.put(`examples/${a.doc_id}.json`, enc.encode(JSON.stringify({ pages: a.pages, answer: a.answer, model: a.model })));
    // Active versions go last, so a key never has two at once on the way in.
    const put = [...fixed.filter((v) => v.status !== "active"), ...fixed.filter((v) => v.status === "active")];
    await db.saveProfiles(space, { put, added: examples.map((a) => ({ doc_id: a.doc_id, sender: a.sender, cls: a.cls, key: `examples/${a.doc_id}.json` })), removed: [] });
  }

  // Today's paid actions, so moving does not refill the day. spend() counts up to the cap and no further, so a second
  // run leaves the same number.
  const today = o.today ?? new Date().toISOString().slice(0, 10);
  const used = (await files.list(`usage/${today}/`)).length;
  if (apply) for (let i = 0; i < used; i++) await db.spend(today, used);

  // Holds from the single senders.json become one entry per sender, as the app writes them; a newer entry is kept.
  const holds = Object.entries((await getJson<Record<string, { hold?: boolean }>>("senders.json")) ?? {}).filter(([, h]) => h.hold).map(([s]) => s);
  if (apply) for (const s of holds) {
    const key = `${space}/holds/${encodeURIComponent(s)}.json`;
    if (!(await files.get(key))) await files.put(key, enc.encode(JSON.stringify({ sender: s, hold: true })));
  }

  const after = apply ? await db.loadProfiles(space) : null;
  return {
    space, apply,
    source: { documents, versions: versions.length, examples: examples.length, usage_today: used, holds: holds.length },
    database: after && { documents: (await db.listDocs(space)).length, versions: after.versions.length, examples: after.approved.length },
    notes,
  };
}
