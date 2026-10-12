# Download mapping production release and ingestion

**Status: Living.** Updated 2026-10-11; ingestion evidence below is updated only after independent verification.

## Authority and deployed scope

The owner explicitly authorized deployment of only the Download resolver and mapping companion, production verification, then ingestion of passing absent sources while retaining actual issue holds.

Production deployment `dpl_438HZMoNej18rhCS8xmTz1fip34D` was built from isolated production commit `66e955e5f5b5a33f8018b92cb13c7664d5a5cb40`, with only `src/lib/impactRecord.js` replaced and `public/data/embedded_json/national_bill_analysis_identity.json` added. Byte comparison against the archive proved this scope. No other dirty checkout changes, Edge Functions, schema or compute changes were deployed. No Git push/merge occurred.

The staged deployment `niyantran-hkyw62saq-ddl-labs.vercel.app` was promoted to `https://niyantran-six.vercel.app`. Previous deployment `dpl_BNrzGcxxHisELAJW3Sq5DxvLh9nd` remains the rollback target. The isolated production build passed with the existing large-bundle warning.

## Executed production verification

The served companion is byte-identical to the reviewed companion (SHA256 `f525755410084da348f95f5ad1c9051b9571e029655e48b4e9df09a42c14dca2`). The served production bundle `/assets/index-CEmdK2gS.js` is identical to the staged bundle (SHA256 `f02ab04fd6d420691ea84f1f939719966dfdc6b389d8c53ae2d16a0feb2fef92`). Extracted deployed resolver functions were replayed against all 19,634 current listing rows: 12,498 nonempty Download results and zero differences from the tested local resolver. The public landing page loaded without browser console errors. An authenticated bill click was not performed; verification consists of served asset hashes and deployed-function replay against actual listing data.

Runtime evidence lives under `corpus-shared-mapping-20261011` in the task artifact directory, including `production-deployment-verification.json`. Deployment/build logs remain under `/private/tmp/corpus-*`.

## Completed ingestion

Two exact disjoint releases are COMPLETE and must never restart:

| Release | SHA256 | Documents | Complete chunks | Scoped citation probes |
| --- | --- | ---: | ---: | ---: |
| job-quality18/stage-01.release.json | 2d50e31767379337ebd5931f2142d2af4bd81b4640562930ca41830801d10088 | 18 | 195 | 56 |
| job-quality20/stage-01.release.json | 15d9a562bd5113d7e5d73f169b43feabbd3f0ea27ae0dab5d605e0ac96d0161c | 20 | 241 | 62 |

All 38 sources passed original/archive/Citation Pack hash checks, exact cached/live PDF hashes, current two-feature listing and production Download identity, rendered-page/full-text quality review, independent PDF.js body agreement, complete v4 context/span/input checks, fresh manifest-bound retrieval baselines, official capacity metrics, budget guards and deployed Edge Function no-write dry runs. The unchanged Edge Function performed chunking and embedding; no prepared chunk arrays were uploaded. One document was in flight at a time. Each release ended below or at the 20-document maintenance boundary and received the complete independent audit and ANALYZE before another release started.

All 436 stored vectors, spans, context, input hashes, provenance, current Download links and listing attachments passed independent verification. All 118 actual bill-scoped citation probes passed. Provider receipts show 34,538 tokens, USD 0.00069076, 38 write attempts, no paid retries and no unknown usage. Peak sampled CPU was 9.429%; all 46 recorded retrieval health windows passed.

Final live counts after ANALYZE: **2,807 documents, 2,804 indexed documents, 88,339 chunks, 1,516 covered listing bill keys**. Exact combined deltas from the pre-run baseline: +38 documents, +38 indexed, +436 chunks, +38 covered keys. Zero orphan chunks and zero null vectors. Planner counts match real counts, including 34,184 desk_rows. Existing three unindexed records and earlier Government/University quality holds were not modified.

## Quality corrections and isolated failures

All forty reviewed PDFs were inspected page by page. Thirty-eight native-text sources passed. Separately hash-bound layout repairs retained every alphanumeric character, isolated margin notes/back covers from operative clauses, and restored demonstrated whitespace around clause/enactment markers. Originals remain untouched. Reasons, annexures, language lists and financial memoranda were retained; no substantive table was present in these releases. Blank pages in two sources were confirmed visually. Full source-specific edit ledgers, render hashes, word inventories and independent checks are stored with each release.

Two actual text-completeness failures remain excluded: `de9d067e45679d20b349d13f6970d2bf4629a474` and `e17d8cb5448414f774fb222b5d1c0816d5881e7c`. Later scanned pages are absent from their PDF text layers. One still passed sampled identity agreement, demonstrating why identity alone is insufficient. These need complete OCR of the scanned pages, not a mapping waiver.

The 500-source review inventory now separates **38 completed, 2 confirmed text-completeness holds, 270 awaiting full quality review, 97 identity reviews, 83 version reviews and 10 mapping holds**. These are per-source review outcomes; the remaining 462 are not all defective and not all ready. Continue from `quality-progress.json` and `release-sequence.json`, preserving completed receipts. The 140 remaining sources in the 180-source exact-text shortlist have not yet received full rendered-page quality review. Do not silently label them ready or held.

## Verification commands and workspace

Executed isolated `npm run build`; passed with existing bundle-size warning. Production CLI staging/promotion and served-file hash checks passed. Deployed resolver replay passed 19,634 rows. For each frozen release, `corpus-stage-job.mjs --baseline`, `--dry-run`, and `corpus-job-supervisor.mjs --execute` passed. Each release's `verify-quality.mjs` independently audited every stored chunk and scoped citation. Supabase ANALYZE and exact/planner/orphan queries passed. `git diff --check` passed. Node emitted its existing experimental Type Stripping warning. No repository implementation changed in this execution; prior mapping-fix test/lint/build evidence is linked from the active plan.

Current branch remains `task/corpus-single-pilot-20261009`; existing dirty work is preserved and uncommitted. This turn updated the active spec/plan authorization, R7, operations handoff and this report. Runtime evidence remains outside the repository. No Git commit, push or merge, Edge deployment, schema/compute change, original corpus edit or existing-source overwrite/deletion occurred.

Suggested RAG samples: bill:2019:320 (High Court at Allahabad, Permanent Bench at Mahoba) and bill:2024:71 (Micro, Small and Medium Enterprises Development Amendment). Refresh and reattach the bill, ask about its proposed changes and request citations.
