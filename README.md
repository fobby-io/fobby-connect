# Fobby Connect

**Connects every sender's freight document layout to one schema, and learns each sender so the next document needs less review.**

Freight forwarders retype every Shipping Order (SO) and Packing List (PL) by hand: 30–60 minutes per document, and every sender uses its own layout. Fobby Connect reads them with Meta's Muse Spark into one fixed schema, checks the numbers with code, and learns each sender's layout from the clerk's corrections, so the next document from that sender needs less review.

Live demo: https://connect.fobby.io (open a sample shipment, or upload your own PDF). The screen follows the browser language, Chinese or English, with a switch in the top right.

## How it works

1. **Read.** Each page goes to `muse-spark-1.3` with a strict JSON schema: digital pages as positioned text, scanned pages as a one-page PDF. The model only copies what is printed, with a box per value.
2. **Check (code, no model).** Row sums against the totals line, pallets, PO numbers in the shipping marks, headers that differ between pages, container check digits. A page with failed checks is read once more with the findings as a hint.
3. **Normalize (code, no model).** Printed text becomes typed values (dates, ports as UN/LOCODE, weights in kg, ranges, PO and part numbers filled down), and every value keeps its raw text.
4. **Review.** The clerk sees the page next to the result, wires printed columns to standard fields, adds a column the read missed (one page re-read, only the new column merged), edits raw text and sees the checks re-run.
5. **Learn.** On approval, the correction becomes a candidate prompt for that sender. It is activated only if replaying the sender's approved documents shows no regression; otherwise the field is marked "always review".
6. **Export.** An approved document is available at `GET /api/documents/<id>/export.json` (the full record: header, containers, line items and totals with raw text, the check results, a link to the PDF, how much was corrected; `schema_version: 1`) and `GET /api/documents/<id>/export.csv` (one line item per row for Excel; UTF-8 with BOM). Unapproved documents answer 409.

## Run it yourself

Needs Node 22 and a Meta Model API key.

```bash
npx -y pnpm@12.16.1 install --frozen-lockfile
echo "META_API_KEY=..." > .dev.vars
npx -y pnpm@12.16.1 build:web
npx tsx src/server/local.ts      # http://localhost:8787
```

Tests: `npx tsc --noEmit && npx vitest run`. Sample shipments: `npx tsx scripts/build-samples.ts` (synthetic documents, invented companies).

## Meta models used

| Model | Where |
|---|---|
| `muse-spark-1.3` (standard tier) | Reading every page (`src/gateway/`), re-reads with check hints and missing columns (`src/pipeline/run.ts`), rewriting a sender's prompt from corrections (`src/profiles/rewrite.ts`) |

Customer documents are only sent to the standard tier, whose data is not used to train Meta's models.

## Built during the hackathon

Everything in this repository was written between 2026-10-27 and 2026-11-04 (see the git history). Nothing from fobby.io, the author's freight-quote product, is used. Meta Global AI Developer Hackathon, Startups track, "Build for Your World".

| Part | Code |
|---|---|
| Meta Model API client, strict JSON schema output, retries, cost ledger | `src/gateway/` |
| Page routing (text or vision) and reading loop: read, check, re-read with hints, read a missing column | `src/pipeline/` |
| Prompt hierarchy (fallback, document class, sender) and learning from corrections with replay validation | `src/profiles/` |
| Normalization to typed values with raw text kept | `src/normalize/`, `src/transforms/`, `src/reference/` |
| Checks across rows, totals, pages and containers | `src/rules/` |
| Review API for any JS host (Node server included) | `src/server/` |
| Review screen (React, shadcn/ui, pdf.js) | `web/` |
| Synthetic document generator, evaluation and samples | `eval/`, `scripts/` |

Sample and test documents are synthetic: invented companies, numbers and products.

## Licence

AGPL-3.0. The hosted version at connect.fobby.io runs this code.
