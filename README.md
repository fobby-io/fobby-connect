# Fobby Connect

**Connects every sender's freight document layout to one schema, and learns each sender so the next document needs less review.**

Freight forwarders retype every Shipping Order (SO) and Packing List (PL) by hand: 30–60 minutes per document, and every sender uses its own layout. Fobby Connect reads them with Meta's Muse Spark into one fixed schema, checks the numbers with code and every value with a second system, and learns each sender's layout from the clerk's corrections with Muse Wonder, so the next document from that sender needs less review, or none: a known sender's document that passes every check is approved and sent on without a person.

Live demo: https://connect.fobby.io. The screen is in English; it reads Chinese and English documents. No PDF of your own? Upload these synthetic ones (invented companies), in this order:

1. [Packing list 1](eval/samples/pl-1.pdf), 2 pages, from a new sender: it goes to review. Check it against the PDF and approve.
2. [Packing list 2](eval/samples/pl-2.pdf), same sender and layout: every value is checked, and it is approved without review.
3. [Shipping order](eval/samples/so-1.pdf), in Chinese, from another sender.

## How it works

1. **Receive.** Upload a PDF on the screen, or email it to the team's intake address: each attached PDF is read like an upload, and the document shows who sent it.
2. **Read.** Each page goes to `muse-spark-1.3` with a strict JSON schema: digital pages as positioned text, scanned pages as a one-page PDF. The model only copies what is printed, with a box per value.
3. **Check (code, no model).** Row sums against the totals line, pallets, PO numbers in the shipping marks, headers that differ between pages, container check digits. A page with failed checks is read once more with the findings as a hint.
4. **Second check.** For a sender seen before, a second system (Jev, a decision model) checks every value against the page: the printed text for digital pages, the page image for scans. A sender's first document skips it, because a person reviews every value anyway.
5. **Approve.** A document is approved without a person only when the sender is known and not on hold, every value passed the second check, every rule passed and the columns match the sender's last approved document. Anything else goes to review with the reasons. "This one is wrong" on an approved document sends it back and puts the sender on hold until a document passes review unchanged.
6. **Normalize (code, no model).** Printed text becomes typed values (dates, ports as UN/LOCODE, weights in kg, ranges, PO and part numbers filled down), and every value keeps its raw text.
7. **Review.** The clerk sees the page next to the result, wires printed columns to standard fields, adds a column the read missed (one page re-read, only the new column merged), edits raw text and sees the checks re-run.
8. **Learn.** On approval, `muse-wonder-1.0` compares the corrections with the printed text and rewrites that sender's reading notes, with no document-specific values. The new notes are activated only if replaying the sender's approved documents shows no regression; otherwise the field is marked "always review".
9. **Export.** One flow for the team: approved data branches by sender into its outputs.
   - Download: `GET /api/documents/<id>/export.json` (the full record: header, containers, line items and totals with raw text, the check results, a link to the PDF, how much was corrected; `schema_version: 1`) and `export.csv` (one line item per row for Excel; UTF-8 with BOM). Unapproved documents answer 409.
   - Webhook: the same JSON is POSTed as `document.approved` (or `document.corrected`), signed with `X-Fobby-Signature: sha256=HMAC(secret, timestamp.body)`. The receiver's status code and receipt id are kept; a failed delivery is retried after 1, 5 and 30 minutes and 2 hours with the same delivery id.
   - Email: the record goes out with the JSON and CSV attached, where the host provides a way to send mail.

## Run it yourself

Needs Node 22 and a Meta Model API key. The second check needs an OpenRouter key (`OPENROUTER_API_KEY`); without it every document goes to review.

```bash
npx -y pnpm@12.16.1 install --frozen-lockfile
cp .dev.vars.example .dev.vars   # then fill in META_API_KEY
npx -y pnpm@12.16.1 build:web
npx tsx src/server/local.ts      # http://localhost:8787
```

Tests: `npx tsc --noEmit && npx vitest run`. Sample PDFs: `npx tsx scripts/build-samples.ts`.

## Meta models used

| Model | Where |
|---|---|
| `muse-spark-1.3` (standard tier) | Reading every page (`src/gateway/`), re-reads with check hints and missing columns, replaying approved documents to validate new notes (`src/pipeline/run.ts`) |
| `muse-wonder-1.0` | Comparing a clerk's corrections with the printed page and rewriting that sender's reading notes (`src/profiles/rewrite.ts`) |

Customer documents only go to tiers whose data is not used to train Meta's models; the gateway refuses to send anything but synthetic data to a contributor-tier model. The second check (`src/verify/`) is not a Meta model: it is Jev (TypeSafe) through OpenRouter's decisions API, and it is optional.

## Built during the hackathon

Everything in this repository was written between 2026-10-27 and 2026-11-04 (see the git history). Nothing from fobby.io, the author's freight-quote product, is used. Meta Global AI Developer Hackathon, Startups track, "Build for Your World".

| Part | Code |
|---|---|
| Meta Model API client, strict JSON schema output, retries, cost ledger | `src/gateway/` |
| Page routing (text or vision) and reading loop: read, check, re-read with hints, read a missing column | `src/pipeline/` |
| Prompt hierarchy (fallback, document class, sender) and learning from corrections with replay validation | `src/profiles/` |
| Normalization to typed values with raw text kept | `src/normalize/`, `src/transforms/`, `src/reference/` |
| Checks across rows, totals, pages and containers | `src/rules/` |
| Second check of every value against the page text or the page image, and automatic approval | `src/verify/`, `src/server/app.ts` |
| Review API for any JS host (Node server included); export flow with signed webhooks, retries and email; email intake | `src/server/` |
| Review screen (React, shadcn/ui, pdf.js) | `web/` |
| Synthetic document generator, evaluation and samples | `eval/`, `scripts/` |

Sample and test documents are synthetic: invented companies, numbers and products.

## Licence

AGPL-3.0. The hosted version at connect.fobby.io runs this code.
