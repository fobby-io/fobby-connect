// pnpm experiment [--step effort] [--docs N] [--max-spend USD] [--concurrency N]
// The M1 reading experiment: one factor at a time, scored on the synthetic set, stopping at the spend cap.
// Raw model replies are cached on disk by request, so a rerun of the same option costs nothing.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gateway, NonRetryableError } from "../src/gateway/gateway.ts";
import { memoryLedger } from "../src/gateway/ledger.ts";
import { metaClient, type ChatRequest } from "../src/gateway/meta-client.ts";
import { cachedClient, pool } from "./cache.ts";
import { extractInstructions, textPageMessage } from "../src/gateway/prompts.ts";
import { readPdf } from "../src/pipeline/pdf.ts";
import { gridItems, serialize } from "../src/pipeline/text-serialize.ts";
import { unknownIds, type ModelOutput, type Variant } from "../src/shared/model-output.ts";
import { scorePage, summarize, type FieldResult } from "./score.ts";
import { generate } from "./synth/generator.ts";
import type { Expected } from "./synth/types.ts";

const { values: args } = parseArgs({
  options: {
    step: { type: "string", default: "effort" },
    effort: { type: "string", default: "minimal" },
    docs: { type: "string", default: "30" },
    "max-spend": { type: "string", default: "40" },
    concurrency: { type: "string", default: "6" },
    synth: { type: "string", default: "eval/out/synth" },
  },
});

type Option = { name: string; variant: Variant; effort?: ChatRequest["reasoning_effort"]; profile: boolean };
const STEPS: Record<string, Option[]> = {
  effort: [
    { name: "effort=minimal", variant: "compact", effort: "minimal", profile: true },
    { name: "effort=low", variant: "compact", effort: "low", profile: true },
    { name: "effort=default", variant: "compact", profile: true },
  ],
  // Step 2 keeps step 1's winner (--effort).
  format: (["compact", "per_field", "cell_box", "item_ids"] as const).map((variant) => ({
    name: `format=${variant}`, variant, effort: args.effort as Option["effort"], profile: true,
  })),
};

const maxSpend = Number(args["max-spend"]);

async function main() {
  const options = STEPS[args.step!];
  if (!options) throw new Error(`unknown step ${args.step}; known: ${Object.keys(STEPS).join(", ")}`);
  if (!existsSync(args.synth!)) await generate(10, 1, args.synth!);
  const all: Expected[] = readdirSync(args.synth!).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readFileSync(join(args.synth!, f), "utf8")));
  // Round-robin over layouts so a small --docs still covers every layout.
  const byLayout = Object.values(Object.groupBy(all, (d) => d.doc_id.replace(/-\d+$/, ""))) as Expected[][];
  const docs = Array.from({ length: Math.max(...byLayout.map((l) => l.length)) }, (_, i) => byLayout.map((l) => l[i]))
    .flat().filter((d): d is Expected => !!d).slice(0, Number(args.docs));
  const pages = (await Promise.all(docs.map(async (e) => {
    const pdf = await readPdf(new Uint8Array(readFileSync(join(args.synth!, `${e.doc_id}.pdf`))));
    return pdf.map((p) => ({ e, page_no: p.page_no, items: gridItems(p) }));
  }))).flat();

  process.loadEnvFile(".dev.vars");
  const { client, spent } = cachedClient(metaClient(process.env.META_API_KEY!), maxSpend);
  const report: unknown[] = [];
  console.log(`${docs.length} documents, ${pages.length} pages; spend cap US$${maxSpend}\n`);

  for (const opt of options) {
    const ledger = memoryLedger();
    const g = gateway(client, ledger);
    const fields: FieldResult[] = [];
    const perPage: { doc: string; page: number; rows: number; out: number; ms: number; cost: number }[] = [];
    const failures: string[] = [];
    await pool(pages, Number(args.concurrency), async ({ e, page_no, items }) => {
      const instructions = extractInstructions(opt.profile ? e.profile : {}, [], opt.variant);
      try {
        const r = await g.extractPage({
          step_id: `${e.doc_id}:${page_no}:${opt.name}`, variant: opt.variant, effort: opt.effort, instructions, synthetic: true,
          check: opt.variant === "item_ids" ? (o) => { const bad = unknownIds(o as ModelOutput<"item_ids">, items.length); return bad.length ? `unknown item ids: ${bad.join(", ")}` : null; } : undefined,
          page: [{ type: "text", text: textPageMessage(page_no, e.pages.length, serialize(items)) }],
        });
        fields.push(...scorePage(e, page_no, r.output as ModelOutput<"compact">, items, "text"));
        perPage.push({ doc: e.doc_id, page: page_no, rows: e.pages[page_no - 1]!.rows, out: r.usage.completion_tokens, ms: r.ms, cost: r.cost_usd });
      } catch (err) {
        failures.push(`${e.doc_id} p${page_no}: ${err instanceof NonRetryableError ? err.reason : ""} ${(err as Error).message.slice(0, 200)}`);
      }
    });
    const s = summarize(fields);
    const nDocs = new Set(perPage.map((p) => p.doc)).size || 1;
    const dense = perPage.sort((a, b) => b.rows - a.rows)[0];
    const row = {
      option: opt.name,
      key_accuracy: `${(s.key_accuracy * 100).toFixed(1)}% [${(s.key_ci[0] * 100).toFixed(1)}-${(s.key_ci[1] * 100).toFixed(1)}] of ${s.key_fields}`,
      need_person: `${(s.need_person * 100).toFixed(1)}% of ${s.protected_fields}`,
      wrong_but_matched: s.wrong_but_matched,
      cost_per_doc: `$${(perPage.reduce((a, p) => a + p.cost, 0) / nDocs).toFixed(4)}`,
      sec_per_doc: (perPage.reduce((a, p) => a + p.ms, 0) / nDocs / 1000).toFixed(1),
      densest_page: dense ? `${dense.rows} rows: ${dense.out} out tokens, ${(dense.ms / 1000).toFixed(1)}s` : "-",
      failed_pages: failures.length,
    };
    console.table([row]);
    if (failures.length) console.log("failures:\n  " + failures.join("\n  "));
    const byPath = new Map<string, number>();
    s.errors.forEach((f) => byPath.set(f.path.replace(/\[\d+\]/, "[]"), (byPath.get(f.path.replace(/\[\d+\]/, "[]")) ?? 0) + 1));
    console.log("errors by field:", Object.fromEntries([...byPath].sort((a, b) => b[1] - a[1])));
    console.log("need a person, by field:", s.need_person_by_path);
    report.push({ ...row, errors: s.errors.slice(0, 200), failures, perPage });
  }

  mkdirSync("eval/out/experiment", { recursive: true });
  const file = `eval/out/experiment/${args.step}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\nspent this run: US$${spent().toFixed(2)}; report: ${file}`);
}

await main();
