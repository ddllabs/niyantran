# Approved small corpus cohort completed

> **Status: Historical (2026-10-09).** [Plan](../plans/2026-10-09-trackable-corpus-jobs.md), [spec](../specs/2026-10-09-trackable-corpus-jobs.md). Owner authorized a modest batch increase and finishing the remaining preflight-approved subset. This report does not declare the entire corpus resolved.

The remaining **41 documents / 976 chunks** completed in two sequential stages: **30 / 719**, then **11 / 257**. Every source passed independent post-write text/hash, bill key, current listing Download PDF URL, chunk/hash/span, vector and bill-scoped retrieval checks. There were 41 live attempts, no source failures/retries, no unknown usage and no cleanup. Endpoint receipts report 161,493 embedding tokens / USD 0.00322986, within the existing USD 0.08 per-stage ceilings (USD 0.16 combined maximum). Receipt cost is not an independently reconciled provider invoice.

## Counts and cohort reconciliation

| Metric | Before final 41 | After final 41 | Change |
|---|---:|---:|---:|
| Stored documents | 2,414 | 2,455 | 41 |
| Indexed documents | 2,411 | 2,452 | 41 |
| Embedded chunks | 56,177 | 57,153 | 976 |
| Current bill keys with indexed documents | 1,306 | 1,346 | 40 |

One remaining bill key (`bill:2008:31`) already had indexed text; the other 40 gained their first indexed document. The three earlier retained text-only holds are unchanged.

Across the full new small-source cohort, all **91 approved documents / 2,350 chunks** are now ingested, adding **89 newly covered bill keys**. The union of the four executed receipts exactly matches the original four proposals' 91 unique source IDs; no excluded source entered the job. Combined receipts: 381,850 embedding tokens / USD 0.007637, 91 live attempts, zero unknown usage. This excludes the earlier pilot/23-source stage.

## Modest batch increase and verification

Only the worker's hard document cap changed, from 25 to 30, in its two bound checks. Each manifest remains independently bounded; historical 25-document manifests still reject a 26th source. Chunk limit (1,000 per stage), per-document limit (100 chunks / 50,000 characters), two-second gap, one-source requests, budget, recovery and health checks are unchanged. No concurrency increase occurred.

A new 30-source acceptance test failed against the old cap before implementation. After the minimal change, 48 focused checks passed, including explicit >30 rejection before writes and existing 25-manifest rejection. Full verification: `npm test` passed 184 files / 2,465 tests; `npm run lint` passed; `npm run build` passed with the existing >500 kB bundle warning; Node's experimental type-stripping warning remains. No endpoint/schema implementation changed and no standalone type-check was claimed.

Execution commands: `node scripts/corpus-stage-job.mjs --baseline <manifest> <sha>`; `node scripts/corpus-job-supervisor.mjs --execute <manifest> <sha>` for each final part; `node <artifact-root>/final-1-verification.mjs` and `final-2-verification.mjs`; `ANALYZE public.document_chunks; ANALYZE public.documents;` after each stage; independent SQL counts/start-time/index-size/planner checks; `git diff --check`. All passed. The final 11 were released only after the 30-source audit, health and statistics gate passed.

The independent audits check exact stored text/hash and metadata, current identity across both bill features, the current UI Download PDF resolver, expected unique chunks and hashes, exact UTF-16 citation spans, and all finite nonzero 1,536-dimensional embeddings. Stored-vector RPC probes scoped through the bill attachment's indexed-document lookup retrieved the intended source for every source. These establish backend retrieval/scoping; natural-language answer quality for every document was not exhaustively tested. Owner confirmed earlier sample RAG works. Existing text citations are used; no new PDF page-coordinate OCR was generated.

## Health and maintenance

| Final part | Baseline broad/scoped p95 | Final broad/scoped p95 | Passing windows |
|---|---|---|---:|
| 30 documents | 666.62 / 380.35 ms | 682.87 / 346.14 ms | 32 / 32 |
| 11 documents | 649.31 / 365.10 ms | 626.81 / 541.48 ms | 13 / 13 |

Baselines contain 20 probes per scope; subsequent windows contain three. Timings include network overhead, and CPU/RAM telemetry remains unavailable. These operational checks do not prove unlimited server capacity. No health pause occurred.

Authorized ANALYZE ran after both stages. Final planner counts match actual counts: documents 2,455; document_chunks 57,153; desk_rows 34,184. Database start remained 2026-09-28 08:19:47.722698+00; no restart occurred. Final database size: 987,196,563 bytes; combined chunk index size: 241,115,136 bytes. No compute/index configuration changes were needed.

## Frozen evidence, local state and outstanding work

Artifact root: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-job-plan/preflight-v2/`.

- `final-1-release.json`: SHA-256 `91c9199ed54f78201721c4e2e26fcd5ca078cfd1f569967b010d7b126e30cfdf`.
- `final-2-release.json`: SHA-256 `4d0f6dd0ba24f3d972fc6e66b5baafdf63b63a63dedd3520d3131d40072227e6`.
- Both preserve the unchanged source evidence from original stage-03/stage-04 and bind their original proposal hashes. Original proposals and earlier execution evidence remain unchanged.
- Each release's checkpoint/health file, independent verification JSON, SQL-counts JSON, baseline/execution log and audit script remain available. Verification timestamps: 2026-10-09T10:10:46.004Z and 2026-10-09T10:13:44.233Z.
- `final-cohort-summary.json`, `final-checksums.json` and `final-code-verification/` preserve cohort reconciliation, hashes and exact red/green/full-check logs.

Changed scope: worker/test cap, living plan/spec/operator guide/R7 tracker, this execution report and runtime final-* evidence. Working tree remains uncommitted on `task/corpus-single-pilot-20261009`; main is unchanged and matches origin/main. No push, deployment or scheduler installation.

**No documents remain in this 91-source approved queue.** Broader R7 remains open: 256 small preflight holds (145 gazette identity, 63 body-text disagreement, 42 header, three title, three version), 117 medium candidates, 35 additional shared-key ambiguities, two prior PDF failures and three earlier text-only holds, plus other corpus/linking cohorts. These categories require separate investigation; they are not all proven unusable or necessarily client-data blockers. No embeddings were generated for excluded candidates by these batches.
