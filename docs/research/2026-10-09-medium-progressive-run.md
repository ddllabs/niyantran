# Remaining41 medium-source execution

> **Status: Historical (2026-10-09).** Owner instructed continuation after the successful103-chunk larger-worker pilot. All13 stages complete; no ingestion remains running.

**41 new documents /10,068 complete version4 chunks are indexed and independently verified**, covering41 new listing bill keys. This completes all42 approved sources from the next50 preflight when its prior103-chunk pilot is included. Eight candidates remain held for text/identity/version investigation. Across the original medium audit, all48 identity-approved sources are now indexed with10,689 context chunks;69 historical medium identity/body holds remain unresolved (including these eight).

## Execution results

| Stage | Documents | Chunks | Largest document | Cost USD |
| --- | ---: | ---: | ---: | ---: |
| 1 | 8 | 944 | 136 | 0.00284002 |
| 2 | 1 | 147 | 147 | 0.00042636 |
| 3 | 6 | 956 | 171 | 0.00308186 |
| 4 | 5 | 919 | 193 | 0.00305348 |
| 5 | 4 | 830 | 210 | 0.00267916 |
| 6 | 4 | 868 | 222 | 0.00292198 |
| 7 | 4 | 991 | 292 | 0.00321704 |
| 8 | 3 | 970 | 363 | 0.00302806 |
| 9 | 2 | 921 | 476 | 0.00317472 |
| 10 | 1 | 559 | 559 | 0.00208648 |
| 11 | 1 | 576 | 576 | 0.00218630 |
| 12 | 1 | 597 | 597 | 0.00195446 |
| 13 | 1 | 790 | 790 | 0.00229152 |

Actual total **1,647,072 tokens /USD0.03294144**.41 live attempts, no paid retries, unknown usage, deletes or unrelated re-embedding. Independent model logs confirm41 successful ingestion calls /10,068 inputs /129 provider requests. The129 requests equal the prepared embedding-batch count; they are ordinary batching, not repeated attempts. Full receipt costs are retained; database cost columns round to six decimal places.

Each frozen manifest had aUSD0.08 stage ceiling. Aggregate one-attempt byte reservationUSD0.17353342 is a conservative bound, not charged usage. Documents progressed from108 to790 chunks, with explicit medium profile caps150/200/300/400/600/800. Every stage stayed below1,000 chunks. No document was truncated; OCR text, context chunker and citation offsets remained unchanged.

## Gates and independent verification

Owner's continuation released the remaining41 sources after the measured pilot. Exact manifests and SHA256 values are in `stages.json`; their text/PDF bytes were copied from the freshly refreshed next50 preflight, not regenerated. Every stage ran:

```bash
node scripts/corpus-stage-job.mjs --baseline <stage-manifest> <sha256>
node scripts/corpus-stage-job.mjs --dry-run <stage-manifest> <sha256>
node scripts/corpus-job-supervisor.mjs --execute <stage-manifest> <sha256>
node <artifact-dir>/verify-stage.mjs <stage-manifest> <sha256>
```

The baseline re-fetched PDF hashes and ran20 broad/20 scoped retrieval probes. Dry-run and execution rechecked prepared context identities, actual deployed version4 counts, current listing/Download URL, source absence/reconciliation, model price and health. The foreground artifact driver stopped between stages until the supervising agent ran ANALYZE and matched counts/planner statistics against the exact cumulative receipts. No OS service, cron or automatic new-cohort release was installed.

Independent bounded pagination verified all10,068 finite nonzero1536-dimensional vectors, exact original UTF16 source spans, content/input/context hashes, version4/pipeline metadata and absence of duplicate/orphan chunks within these sources.9,717 chunks have detected heading or clause context. Both listing features resolve the correct original PDF; indexed attachment lookup returns each expected document only.

Two real retrieval/text-citation probes per document, **82 probes**, used stored vectors without paid query embeddings. Each returned40 results confined to that document, included the matching chunk at similarity1 and preserved source URL, exact text hash/offsets and context. This proves retrieval/scoping/citation plumbing, not natural-language answer quality. Existing-text ingestion produces text citations; it does not fabricate PDF highlight coordinates.

**One independent read-only audit timed out in stage9.** Both ingestion receipts were already complete, so the driver stopped before stage10. Repeating the identical read-only audit passed2 documents /921 chunks. No paid call or production repair was repeated. After ANALYZE/count acknowledgement, the driver resumed and skipped acknowledged stages1–9. The failed log, successful retry and recovery note are preserved.

All **93 health windows passed**; zero bad windows or pauses. Maximum observed broad/scoped p95:822.381/637.450ms, within their stage-specific2×baseline gates. Direct CPU/RAM remains unavailable. The790-chunk source completed under this execution's invocation/network bounds; that does not establish capacity beyond the tested cohort or justify parallel writes.

## Final database state

Before:2,462 documents /2,459 indexed /57,774 chunks /1,353 covered listing bill keys.

After: **2,503 documents /2,500 indexed /67,842 chunks /1,394 covered listing bill keys**. Exactly +41 documents, +10,068 chunks and +41 bill keys. The bill-key denominator requires an indexed chunk-bearing document whose key exists in `desk_rows`; it is not the number of documents.

`ANALYZE public.document_chunks; ANALYZE public.documents;` succeeded after every stage. Planner live tuples matched real counts each time. Postmaster start remained2026-09-28 08:19:47.722698UTC; no restart. Final database size1,134,251,155bytes; combined chunk indexes287,268,864bytes. Both existing Mistral documents retain original indexing/extract identities and40/81 version3 chunks. Three previously held text-only stubs were untouched.

The final Mistral-preservation SQL read initially hit an automatic permission-review deadline (not a safety rejection); one permitted read-only retry succeeded. No requested work remains blocked by it.

## Evidence and working tree

Artifact directory: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-job-plan/medium-progressive-41`. Contains13 exact manifests, index/hashes, bound PDF/text, baseline/checkpoint/execution/audit logs, per-stage verification/maintenance acknowledgements, foreground driver and verification script, stage9 recovery evidence, receipt summary,82-probe audit JSON, `verified-documents.csv`, independent model-log summary and Mistral preservation read.

No implementation changed in this execution; unchanged tests were not repeated. The [worker implementation](2026-10-09-medium-worker-pilot.md) had63 focused checks,2,465 application tests, lint/build and real multi-commit/partial/lost-response/pagination-mutation evidence. This task updated its living plan, R7, operations and this execution report, plus local artifacts. `git diff --check` passed; Node experimental type-stripping warning persists in runtime logs. Work remains uncommitted on `task/corpus-single-pilot-20261009`; main equals origin/main after fetch. No deployment/schema/frontend change, cleanup, merge or push occurred.

## Owner RAG samples and remaining work

- **Industrial Relations Code,2019** (`bill:2019:364`),445 chunks, document `f91441a9-873b-47c1-a5ec-9d80c60fdf18`: “What provisions govern lay-off and retrenchment? Cite the relevant clauses.”
- **Merchant Shipping Bill,2024** (`bill:2024:183`),790 chunks, document `9726bbf4-d860-4f4f-a90b-a340ad397412`: “How is the oil-pollution compensation fund constituted? Cite the relevant clauses.”

Attach the bill in chat and check the cited text and listing Download PDF. Owner natural-language acceptance of these new samples remains pending. The approved48-source medium queue is complete; internal review of69 medium holds and other R7 small/key/link/oversized/nonbill cohorts remains open. This report does not claim full corpus completion or that every hold needs client intervention.
