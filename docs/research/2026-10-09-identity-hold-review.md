# Corpus identity-hold investigation

> **Status: Living.** Read-only corpus/production investigation and narrow local parser correction, 2026-10-09. No ingestion in this phase.

Subsequent owner-go follow-up: the regressed four-point layout preserved139/139 prior passes and recovered two fresh sources, now indexed with12 version4 chunks. Current production is2,505 documents /2,502 indexed /67,854 chunks.52 selected identity cases remain unreleased. [Completed follow-up](2026-10-09-corpus-500-worker-pilot.md). The initial diagnostic results below describe the earlier read-only phase and are preserved as evidence.

All approved91 small and48 medium sources had already completed. This investigation selected54 previously held header/title/version cases (48 small,6 medium) from the existing524 exact-URL candidate subset. It is not a new inventory of the entire10GB corpus. The325 held small/medium sources include192 gazette cases,79 body-agreement cases and these54 identity cases; shared-key conflicts and other corpus cohorts remain separate.

## Executed evidence

The diagnostic adapter streamed both original corpus and citation pack, checked source hashes/lengths and current listing/Download identity, freshly fetched the54 bounded PDFs and preserved their extracted text plus original source text. All54 remained held under the original checks:46 bill-number/year headers,4 titles and4 versions. Failed PDF/source artifacts were retained without modifying earlier receipts or the input collections.

Three modern PDFs use U+2012 FIGURE DASH between bill number and suffix F. The existing parser allowed only ASCII hyphen and en dash. The local correction adds only the observed separator; it does not infer corrupt digits or change number/year, title, chamber, role or body requirements. A new regression failed before the correction with the actual header error, then passed. Wrong number/year cases remain rejected.

Rechecking all54 cached diagnostics with the corrected parser yielded **zero eligible sources**:43 header holds,4 title holds,4 version holds and3 body-agreement holds. Cached review is evidence of matcher behavior, not a fresh release preflight.

| Newly readable identity | Bill key | Existing body agreement |
| --- | --- | --- |
| Delhi Laws (Special Provisions) Second (Amendment),2023 | `bill:2023:176` |19/23 samples,82.61% |
| Central Universities (Amendment),2023 | `bill:2023:141` |14/17 samples,82.35% |
| Repealing and Amending, listing2022 | `bill:2022:290` |35/40 samples,87.50% |

The Repealing and Amending PDF retains Bill No.290-F of2022 but prints a2023 title and passage dates. Do not equate introduction year with every subsequent version's printed title year; this needs explicit review before release. The current title matcher finds title words anywhere in the first10,000 characters, so the header's2022 satisfies its year token. A matcher pass alone does not resolve this title-version distinction.

## Layout finding and remaining work

PDF.js coordinate evidence shows marginal note baselines displaced from the corresponding main text baseline. The present two-point row grouping interleaves notes differently from the original layout text, breaking distributed80-character samples even when the visible words agree. A diagnostic experiment (no repository layout change) tried row tolerances2,3,4,5 and6 points. Four points produced100% agreement for all three. Three points still failed Central Universities (88.24%); five points also failed that source. This sensitivity means selecting a tolerance merely because three documents pass is insufficient release evidence.

Next: establish a justified layout reconstruction rule and red regressions using the observed coordinates, including separate close lines and tables; compare it against all previously passing cached PDFs and the broader body-hold cohort. Preserve the90% threshold and exact original text/hash. Then freshly recheck original/pack/current listing/PDF identity, resolve the2022/2023 version distinction, prepare version4 section-context chunks, run the deployed endpoint dry check, and release only the proven bounded cohort through the existing supervised worker. Unreadable old scanned headers, actual title/version mismatches and gazette-to-Act identity still require their own evidence; no paid OCR or guessed mapping was performed.

## Production and verification

Read-only live SQL before/after: **2,503 documents /2,500 indexed documents /67,842 chunks**. Postmaster start unchanged at2026-09-28 08:19:47.722698+00. No new embeddings, metadata writes, cleanup, deployment or ingestion occurred. Covered listing keys remain the prior verified1,394; that distinct count was not rerun in this phase.

Commands and outcomes:

- `node --test scripts/corpus-job-preflight.test.mjs`: red proof, exit1; figure-dash acceptance failed with bill-number/year mismatch.
- `node --test scripts/corpus-job-preflight.test.mjs scripts/corpus-context-preflight.test.mjs scripts/corpus-stage-job.test.mjs scripts/corpus-job-supervisor.test.mjs`:65 passed, exit0.
- `npm test -- --run`:184 files /2,465 tests passed, exit0.
- `npm run lint`:passed, exit0, no warnings.
- `npm run build`:passed, exit0; existing large-bundle warning remains.
- `git diff --check`:passed. No standalone type-check was claimed. Supabase functions/schema were unchanged in this phase; no new Deno/SQL fixture execution was needed.

Changed this phase: local preflight parser/test, identity-review plan, this report and R7. Work remains uncommitted on `task/corpus-single-pilot-20261009`; extensive earlier authorized changes were preserved. Main matched origin/main after fetch. No merge or push.

Artifact directory: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-job-plan/identity-hold-review`. Contains frozen selection, original-hash checks,54 diagnostic PDFs/source/PDF text sets, original failure receipts, corrected cached review, layout experiment and verification logs. Diagnostic adapter and experiments are local evidence, not an ingestion service.
