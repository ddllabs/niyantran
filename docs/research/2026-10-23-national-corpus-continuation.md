# National corpus continuation — 23 October 2026

> **Status: Living.** Owner-authorized execution record. The supervised execution started after all 395 endpoint dry runs passed; new ingestion totals require receipts and independent audits.

## Milestone and local resources

Fresh SQL on 22 October 2026 at 19:09 UTC (23 October, 00:39 IST), reconfirmed at 19:28 UTC, found 3,379 documents, 3,376 indexed and 99,225 chunks. Of 9,415 distinct current listing bill identities, 2,134 have indexed vector-bearing document coverage and 7,281 do not. Coverage counts bills separately from documents and versions. Historical reports describe larger totals; they are not the current baseline, and this run does not explain or reverse intervening removals.

Inputs are the original `~/Downloads/NTER-Complete-Processed-Data/01_original_corpus/docs/_clean.jsonl.gz`, `~/Downloads/citation_pack_v1/documents/bills.jsonl.gz`, current database document/listing exports, repository bill-analysis identity/source registry, and current official Sansad PDFs. Original archives and citation pack files remain unchanged. Law delivery and generic Law ingestion remain separate.

The bill pack contains 9,709 source records: 2,812 currently indexed, three existing recovery records and 6,894 absent sources. Absent sources map to 5,082 current bill keys, with overlapping mapping, version, text-quality and size holds; this is not a ready count. The broader local pack has 24,801 documents across document families and is not interchangeable with the bill inventory.

## First 1,000-bill cohort

The initial screen selected one candidate document for each of 1,000 distinct bills. All 1,000 original text hashes matched the original archive, and all 1,000 source PDFs were fetched. Across all pack records for these same bill keys there are **1,040 associated source records**: 1,029 absent and 11 indexed. The 29 additional absent versions remain outside the first release pending their own evidence; a bill is not treated as a single document.

PDF identity screening passed 600 candidates and held 400 for title, number/year, version or body agreement review. Layout reconstruction and independent full-order comparison reduced this to 451 automated candidates. All pages of 442 short candidates received rendered layout overview review; nine longer candidates await detailed review. Prior hold ledgers, tables, reversed pages, scanned text and uncertain margin layouts were retained. A final complete clause-sequence/context and UTF-16 coverage screen left **395 documents / 395 previously uncovered bill keys / 7,368 expected chunks** in the first frozen stage. The other 605 selected candidates remain held or awaiting review. The first 80 are now independently audited as ingested; 315 remain in this stage. Execution is currently held on a recurring pre-write transport failure.

Quality evidence combines full-character preservation against original text, independently decoded PDFplumber/PDF.js ordered body and margin text, all-page rendered layout overviews, complete operative clause sequence, exact chunk spans/input hashes, and tail-context isolation. This was not manual word-by-word transcription. Margin text is retained in labeled per-page appendices, with separately preserved raw text, exact edit ledgers and hash-bound review records. Original wording is not inferred or corrected. Older holds are not waived by a new automated pass. No source in the stage intersects the 1,086 historically verified source keys found in prior checkpoint evidence.

## Frozen stage and operational gates

Runtime directory (outside Git):
`/Users/vighneshshukla/.codex/visualizations/2026/10/22/01a164c1-e43b-7dc1-a740-4076165a94d6/national-20261023`

Stage: `job-national-v1/stage-01.release.json`

SHA-256: `604716517aed1d417fc3c96933964e87f41ff35d912aeb8f881b0541b6e645b7`

The existing `sequential_500_v1` / `medium_v1` runner remains unchanged: one writer, minimum two-second gap, version-4 context, independent cumulative audit every 20 documents or 2,000 chunks, planner/count reconciliation and fresh maintenance acknowledgement. The first stage budget is USD 1; its conservative single-attempt byte/token ceiling at the checked price is USD 0.05898852. Actual usage must come from receipts.

At 19:30 UTC, the read-only capacity preflight passed: CPU 1.49%, available memory 51.16%, disk busy 0.10%. An initial 35-second sample attempt failed the required timestamp separation; the established 60-second sampling passed without weakening the guard. The worker repeats capacity checks during execution. Embedding model price was USD 0.00000002/token. No local corpus worker or historical worker/supervisor lock was found before the baseline run. The scheduled website ingest worker is active but had only two succeeded jobs, no pending work and no active leases; live SQL found no active corpus writes. These are point-in-time observations, not a project-global lock.

Manifest loading and preparation verification passed for every staged document. Fresh focused corpus tests: `node --experimental-strip-types --test scripts/corpus-*.test.mjs` — 113 passed. No application or worker code was changed. Historical full-suite evidence is recorded in the prior integration report and is not represented as a fresh run.

The manifest-bound current-PDF/retrieval baseline passed (20 broad and 20 scoped samples over five indexed bills; p95 1,271.55 ms broad and 537.98 ms scoped). All 395 endpoint no-write dry runs passed, with two capacity and two retrieval health samples. At 19:50 UTC, exact totals were still unchanged, with zero queued/running ingestion jobs, zero active corpus writes and no local competing corpus process. The dry-run receipt is preserved separately. The existing supervisor was then started for this frozen manifest. At every maintenance pause, audit all completed vectors, spans, context/input hashes, provenance, current Download/listing mappings and scoped citations before planner/count acknowledgement. Final acceptance also requires exact deltas, usage and orphan reconciliation. Natural-language owner RAG acceptance remains separate.

## Audited execution progress

At 20:03 UTC (01:33 IST), the first maintenance checkpoint passed: **20 new documents / 20 new covered bills / 418 chunks**. The independent audit checked every stored vector, span, embedding-input hash, source provenance and current bill/Download mapping, with **190 scoped citation probes** including each final substantive body chunk. An initial audit selected back-cover text as its tail probe; that evidence was preserved, and the local audit was strengthened and rerun before acknowledgement. The production runner and manifest were unchanged.

Exact post-ANALYZE totals: **3,399 documents / 3,396 indexed / 99,643 chunks / 2,154 covered bill keys**; no orphan document chunks or null vectors. Planner counts matched all three analyzed tables, including 136,752 desk rows. No competing queued/running ingest jobs. Known provider receipts total 39,432 tokens / USD 0.00078864. The passing maintenance acknowledgement permits resuming the same frozen stage; the other 375 sources remain pending.

### Read-only resume interruption at 20 documents

At 20:05:50 UTC, the resume failed before entering its write loop: `HTTP 555: Internal server error.` The checkpoint retained exactly 20 paid attempts, 20 verified records and 375 dry-run-only entries. Supabase edge logs locate the failure to a `GET /rest/v1/document_chunks` (request `01a16538-233b-76fd-a1da-bfd55053e350`, origin time 10,215 ms). There was no failed ingestion POST. The underlying gateway cause is unconfirmed; it is not being attributed to source quality or treated as a successful write.

The held checkpoint is preserved as `stage-01.release.json.held-http555-before-resume.json`. Ten bounded follow-up reads of the same five health-probe vectors all returned HTTP 200 with valid vectors. Supabase reported `ACTIVE_HEALTHY`; the narrow PostgreSQL log window contained LOG-level events with SQLSTATE 00000. At 20:08 UTC, SQL reconfirmed unchanged audited totals, exact planner counts, zero null vectors/orphans and no competing ingestion jobs. All 395 local prepared entries, cached PDF hashes and repair proofs were reverified. Fresh pricing and capacity passed at 20:09 UTC. One documented recovery preserved every receipt and reservation, restored the maintenance boundary, and passed normal worker preflight. Execution advanced to 40 documents.


### Second audited checkpoint and pre-write fetch interruption

At 20:23:51 UTC, the cumulative 40-document audit passed 413 scoped citation probes and all vector, span, context/hash, provenance and current mapping checks. Totals were **3,419 documents / 3,416 indexed / 100,119 chunks / 2,174 covered bill keys**. The increment is **40 documents / 40 bills / 894 chunks**, using 90,319 embedding tokens / USD 0.00180638. Planner counts matched actual counts after ANALYZE; orphan/null-vector and competing-job counts were zero.

The next resume stopped before its write loop with `fetch failed`. The held checkpoint is preserved as `stage-01.release.json.held-fetch-before-resume-40.json`; the previous recovery record and all receipts remain intact. SQL at 20:28:33 UTC reconfirmed unchanged totals. Public source hashes, pricing and capacity are being independently rechecked before any further recovery. The precise failed request is not recorded by the runner, so its underlying transport cause remains unconfirmed.


At 20:29:55 UTC, capacity passed (CPU 0.92%, available memory 51.01%, disk busy 0.065%). All 395 public PDF hashes and current pricing passed fresh reads; all prepared entries and source proofs were reverified. A separate `fetch-recovery-40.json` records one bounded recovery while preserving the held snapshot, all receipts and prior recovery history. The normal supervisor resumed the same frozen manifest with all gates unchanged. No new completion is claimed until independently audited.


### Third audited checkpoint

At 20:44:01 UTC the cumulative audit passed **60 documents / 1,140 chunks / 60 newly covered bills**, including **477 scoped citation probes**. Exact totals were **3,439 documents / 3,436 indexed / 100,365 chunks / 2,194 covered bills**. All planner counts matched actual counts, with no orphan/null-vector chunks or competing ingestion jobs. Known receipts total **109,249 embedding tokens / USD 0.00218498**. The documented fetch recovery passed the normal full preflight and this checkpoint; its underlying transient cause remains unconfirmed. The same frozen stage continues with 335 sources pending.


### Fourth audited checkpoint; recurring transport hold

At 20:58:47 UTC (02:28:47 IST on 23 October), the cumulative audit passed **80 documents / 1,491 chunks / 80 newly covered bills**, including **630 scoped citation probes**. Exact totals: **3,459 documents / 3,456 indexed / 100,716 chunks / 2,214 covered bills**. Planner counts match actual counts, with zero orphan document chunks, null vectors and competing ingest jobs. Known receipts total **140,396 tokens / USD 0.00280792**. All 80 paid attempts have verified outcomes.

The subsequent resume again stopped before writing with `fetch failed`. The checkpoint is held with exactly 80 paid attempts, 80 verified entries and no in-flight entry; `stage-01.release.json.held-fetch-before-resume-80.json` preserves it. SQL at 21:01:03 UTC confirmed unchanged audited totals. No further recovery has been authorized by the operator after this recurrence: the remaining 315 staged documents are pending, not ingested. The runner does not retain the failing public-fetch URL or underlying cause, so source-PDF versus pricing transport failure cannot be proven from this error alone. A bounded read-only diagnostic records URL and cause on reproduction. Further execution requires resolving this recurring transport issue and passing normal preflight; no source checks or maintenance gates were weakened.


The bounded follow-up diagnostic passed all 395 public PDF hash checks and the model-price read (396/396). This rules out a persistent hash/price mismatch at that observation; it does not identify or fix the intermittent transport failure. Evidence is `stage-01.release.json.fetch-diagnostic-80.json`. Execution remains held rather than repeatedly clearing the same unexplained error. The next technical step is request-specific transport diagnostics and bounded recovery behavior under a separately scoped, regression-tested worker change if needed. The current task made no worker/application code changes. `git diff --check` passed; focused corpus tests previously passed 113/113. Five documentation paths remain uncommitted on `task/national-corpus-1000-20261023`; no commit, merge, push or deployment was performed.
