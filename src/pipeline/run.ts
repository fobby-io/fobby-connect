import { PDFDocument } from "pdf-lib";
import type { gateway as makeGateway } from "../gateway/gateway.ts";
import type { ChatRequest, ContentPart } from "../gateway/meta-client.ts";
import { DEFAULT_MODEL } from "../gateway/models.ts";
import { extractInstructions, PROMPT_TEMPLATE_HASH, textPageMessage } from "../gateway/prompts.ts";
import { headerClass } from "../profiles/classify.ts";
import { resolvePrompt, selectPrompt, type Page, type PromptVersion, type Read, type Store } from "../profiles/loop.ts";
import { checkDocument, type Finding } from "../rules/checks.ts";
import type { ModelOutput } from "../shared/model-output.ts";
import { norm } from "./grounding.ts";
import { readPdf } from "./pdf.ts";
import { gridItems, serialize, type GridItem } from "./text-serialize.ts";

// Steps 1-6 of the reading loop for one document: route, classify, select the prompt, read, check, re-read failing pages.

type Gateway = ReturnType<typeof makeGateway>;
type Effort = ChatRequest["reasoning_effort"];
export type PageInput = { page_no: number; route: "text" | "vision"; content: ContentPart[]; items: GridItem[] };

// shortcut: a page is text-routed when it has at least 20 text items; the quality score of Stage 0.5 replaces this in M2.
const MIN_TEXT_ITEMS = 20;

export async function preparePages(bytes: Uint8Array): Promise<PageInput[]> {
  const parsed = await readPdf(bytes);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return Promise.all(parsed.map(async (p) => {
    const items = gridItems(p);
    if (items.length >= MIN_TEXT_ITEMS) {
      return { page_no: p.page_no, route: "text" as const, items, content: [{ type: "text" as const, text: textPageMessage(p.page_no, parsed.length, serialize(items)) }] };
    }
    const one = await PDFDocument.create();
    one.addPage((await one.copyPages(src, [p.page_no - 1]))[0]!);
    const b64 = Buffer.from(await one.save()).toString("base64");
    return {
      page_no: p.page_no, route: "vision" as const, items,
      content: [
        { type: "text" as const, text: `Page ${p.page_no} of ${parsed.length}. The page is the attached PDF.` },
        { type: "file" as const, file: { filename: `page-${p.page_no}.pdf`, file_data: `data:application/pdf;base64,${b64}` } },
      ],
    };
  }));
}

const instructionsFor = (s: Store, v: PromptVersion | null) => {
  const r = resolvePrompt(s, v);
  return extractInstructions({ columns: r.columns, prompt_notes: r.prompt_notes }, r.examples, "compact");
};

/** Page 1's issuer names a known sender when it contains the sender's name; the clerk can always override. */
export function matchSender(issuer: string | null, senders: string[]): string | null {
  if (!issuer) return null;
  // Punctuation is ignored ("B.V." is the sender "BV"), and the longest name wins ("ACME TRADING" over "ACME").
  const key = (s: string) => norm(s).replace(/[^\p{L}\p{N} ]/gu, "").replace(/ +/g, " ").trim();
  const i = key(issuer);
  return senders.filter((s) => key(s) && i.includes(key(s))).sort((a, b) => key(b).length - key(a).length)[0] ?? null;
}

export type RunResult = {
  cls: string | null; sender: string | null; issuer: string | null; prompt: PromptVersion | null;
  pages: { page_no: number; route: "text" | "vision"; output: Page; reread: boolean }[];
  findings: Finding[]; cost_usd: number;
  /** What read it; missing on documents read before they were recorded. */
  template_hash?: string; model?: string;
};

export async function runDocument(g: Gateway, s: Store, pages: PageInput[], o: { doc_id: string; sender?: string | null; effort?: Effort }): Promise<RunResult> {
  let cost = 0;
  const read = async (v: PromptVersion | null, p: PageInput, hint?: string) => {
    const r = await g.extractPage({
      step_id: `${o.doc_id}:${p.page_no}${hint ? ":reread" : ""}:${v?.id ?? "none"}`, variant: "compact", effort: o.effort ?? "minimal",
      instructions: instructionsFor(s, v), page: hint ? [...p.content, { type: "text", text: hint }] : p.content,
    });
    cost += r.cost_usd;
    return r.output as ModelOutput<"compact">;
  };

  // Steps 2-3: the title words give the class on a text page; on a scan, page 1's own doc_type and issuer decide.
  const top = pages[0]!.items.filter((i) => i.box[1] < 300).map((i) => i.text).join(" ");
  const textCls = headerClass(top || null, null);
  const guess = o.sender ?? matchSender(top || null, s.senders());
  const first = selectPrompt(s, { sender: guess, cls: textCls });
  // Sender and class both known from the text layer: every page is read at once instead of waiting on page 1.
  const early = !!(guess && textCls);
  const readAll = (v: PromptVersion | null) => Promise.all((early ? pages : pages.slice(0, 1)).map((p) => read(v, p)));
  let outputs = await readAll(first);
  const cls = headerClass(top || null, outputs[0]!.doc_type);
  const sender = o.sender ?? matchSender(outputs[0]!.issuer, s.senders());
  const prompt = selectPrompt(s, { sender, cls });
  // Page 1 names another sender whose reading differs: read again with its instructions.
  if (instructionsFor(s, prompt) !== instructionsFor(s, first)) outputs = await readAll(prompt);
  const p1 = outputs[0]!;

  // Step 4.
  if (!early) outputs = [p1, ...(await Promise.all(pages.slice(1).map((p) => read(prompt, p))))];
  const reread = outputs.map(() => false);

  // Steps 5-6: re-read only pages with findings, once; keep the re-read when it has fewer findings.
  let findings = checkDocument(outputs);
  const failing = [...new Set(findings.map((f) => f.page))];
  await Promise.all(failing.map(async (n) => {
    const hint = `Checks found problems on this page:\n${findings.filter((f) => f.page === n).map((f) => `- ${f.message}`).join("\n")}\nRead the page again and copy every value exactly as printed.`;
    const again = await read(prompt, pages[n - 1]!, hint);
    const trial = outputs.with(n - 1, again);
    if (checkDocument(trial).filter((f) => f.page === n).length < findings.filter((f) => f.page === n).length) {
      outputs[n - 1] = again;
      reread[n - 1] = true;
    }
  }));
  if (failing.length) findings = checkDocument(outputs);

  return {
    cls, sender, issuer: p1.issuer, prompt,
    pages: outputs.map((output, i) => ({ page_no: pages[i]!.page_no, route: pages[i]!.route, output, reread: reread[i]! })),
    findings, cost_usd: cost, template_hash: PROMPT_TEMPLATE_HASH, model: DEFAULT_MODEL,
  };
}

/**
 * Review step: the clerk points at a printed column the read left out. Re-read that page with the hint and
 * copy only the new columns into the page as the clerk has it: a whole re-read can misread cells that were right.
 * Rows are matched by their package range, or by order when both reads have the same number of item rows.
 * Null when the re-read still misses the column or its rows cannot be matched.
 */
export async function readMissingColumn(g: Gateway, s: Store, page: PageInput, o: { doc_id: string; prompt: PromptVersion | null; current: Page; label: string; field: string; effort?: Effort }) {
  const hint = `The table on this page has a column printed as "${o.label}" (${o.field}) that a previous read left out. Read the page again with every printed column, including that one, and copy every value exactly as printed.`;
  const r = await g.extractPage({
    step_id: `${o.doc_id}:${page.page_no}:column:${norm(o.label)}:${o.prompt?.id ?? "none"}`, variant: "compact", effort: o.effort ?? "minimal",
    instructions: instructionsFor(s, o.prompt), page: [...page.content, { type: "text", text: hint }],
  });
  const out = r.output as Page;
  const want = norm(o.label).replace(/[^A-Z0-9]/g, "");
  const col = out.columns.find((c) => norm(c.label).replace(/[^A-Z0-9]/g, "").includes(want)) ?? out.columns.find((c) => c.field === o.field);
  if (!col) return { output: null, cost_usd: r.cost_usd };
  col.field = o.field as typeof col.field;
  return { output: mergeColumns(o.current, out), cost_usd: r.cost_usd };
}

const key = (c: { label: string }) => norm(c.label).replace(/[^A-Z0-9]/g, "");

/** `cur` with the columns only `next` has, placed where `next` prints them; null when rows cannot be matched. */
export function mergeColumns(cur: Page, next: Page): Page | null {
  const have = new Set(cur.columns.map(key));
  const added = next.columns.map((c, i) => ({ c, i })).filter(({ c }) => !have.has(key(c)));
  if (!added.length) return cur;
  const range = (p: Page, r: Page["rows"][number]) => {
    const i = p.columns.findIndex((c) => c.field === "pkg_range");
    return i < 0 ? null : (r.cells[i] ?? "").replace(/\s/g, "") || null;
  };
  const items = (p: Page) => p.rows.filter((r) => r.t === "item" || r.t === "ditto");
  const byRange = new Map(items(next).map((r) => [range(next, r), r]));
  const ci = items(cur), ni = items(next);
  const match = (r: Page["rows"][number], k: number) => (range(cur, r) && byRange.get(range(cur, r))) || (ci.length === ni.length ? ni[k] : undefined);
  if (ci.some((r, k) => !match(r, k))) return null;

  const out = structuredClone(cur);
  // Insert each new column before the first old column that follows it in the re-read.
  for (const { c, i } of added) {
    const after = next.columns.slice(i + 1).find((x) => have.has(key(x)));
    const at = after ? out.columns.findIndex((x) => key(x) === key(after)) : out.columns.length;
    out.columns.splice(at, 0, c);
    let k = 0;
    out.rows.forEach((r, ri) => {
      const isItem = r.t === "item" || r.t === "ditto";
      r.cells.splice(at, 0, isItem ? match(cur.rows[ri]!, k++)!.cells[i] ?? null : null);
    });
  }
  return out;
}

/** The reader the loop's validation replays with: the same pages, read with a given prompt version. */
export function replayReader(g: Gateway, s: Store, effort: Effort = "minimal"): Read {
  return async (v, doc) => Promise.all((doc.pages as ContentPart[][]).map(async (content, i) =>
    (await g.extractPage({ step_id: `replay:${doc.doc_id}:${i + 1}:${v.id}`, variant: "compact", effort, instructions: instructionsFor(s, v), page: content })).output as Page));
}
