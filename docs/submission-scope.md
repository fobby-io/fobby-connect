# Submission scope as of 2026-11-04

Meta Global AI Developer Hackathon, Startups track, problem statement "Build for Your World".

## Built during the hackathon (2026-10-27 to 2026-11-04)

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

## Existing before the hackathon

Nothing. fobby.io (the author's freight-quote product) is not part of this submission and none of its code is used.

## Shown in the demo

Only the parts above. Sample documents are synthetic: invented companies, numbers and products.
