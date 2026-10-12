# Wider corpus batch: 413 documents ingested

> **Status: Living.** This release is complete and independently audited. Broader corpus work remains open in R7. Final verification: 2026-10-11 19:10 UTC / 2026-10-12 00:40 IST.

The fresh 500-source cohort produced **413 passing documents**, all ingested through the existing Edge Function in one frozen job. They added **7,493 complete version-4 chunks and embeddings**, including **6,661 section-context-prefixed chunks**. The other **87 candidates remain held** with source-specific evidence. They did not block the passing cohort. This is completion of this release, not of the entire corpus.

## Verified result

| Measure | Before | After | Change |
| --- | ---: | ---: | ---: |
| Documents | 3,021 | 3,434 | +413 |
| Indexed documents | 3,018 | 3,431 | +413 |
| Chunks | 92,538 | 100,031 | +7,493 |
| Covered listing bill keys | 1,730 | 2,143 | +413 |
| Desk rows | 34,184 | 34,184 | 0 |
| Orphan chunks / null vectors | 0 / 0 | 0 / 0 | 0 / 0 |

Coverage counts distinct indexed bill keys with vector-bearing chunks and a current bill-listing row. It is distinct from document count; multiple documents can belong to one bill. All 413 records in this release were absent before ingestion. Receipts show 7,493 inserts, zero kept chunks and zero deletions; no existing source was overwritten.

Independent completion verification passed for every stored vector, source span, embedding-input hash, section context, provenance, current Download identity, listing attachment and scoped citation. **3,033 bill-scoped citation probes passed.** ANALYZE completed on `document_chunks`, `documents` and `desk_rows`; planner counts equal real counts exactly. The worker exited 0 with checkpoint `complete`; worker and supervisor locks were released. Never restart this manifest.

Actual provider receipts: **706,730 embedded tokens / USD 0.01413460**, below the USD 1 job budget and USD 0.06142224 conservative embedding bound. All **90 capacity samples passed**; sampled peak CPU was **16.12%**. Of 437 retrieval-health samples, 15 were individually slower than twice the idle baseline; none were consecutive, so the documented two-consecutive-window pause threshold was never reached. Final broad/scoped p95 was 364.458 / 647.417 ms and passed. This does not claim every individual latency sample passed.

## What was checked before release

The current Citation Pack was streamed and reconciled against the live source-key snapshot: **24,801 unique source records across nine categories**, with all pack file and content hashes passing. Bill sources numbered 9,709: 2,422 indexed-present, three recovery stubs and 7,284 absent at that snapshot. Presence is not completeness proof. The original archive stream contains 66,113 records, not 66,113 ingestible documents.

Outside the previous 500-source pool, 1,888 absent bills passed the initial listing/Download/role/size/context screen. The next 500 were selected with matching source and resolved current Download URLs. All 500 raw texts matched both the original archive and pack. The initial raw-text chunk screen contained 8,612 chunks / 4,743,389 characters.

All 500 public PDFs were fetched: 457 passed initial identity screening and 43 were held. Further checks reduced the release to 413. Review combined full ordered independent PDF.js text comparison, conservation of original text characters, rendered-page layout review, complete operative clause/tail recognition, exact chunk spans and embedding-input hashes, and token bounds. This was not word-by-word visual transcription. Table-bearing and unresolved section/layout sources were held. Original files were unchanged; any accepted layout repair was separately hash-bound.

All 413 passed fresh live absence, unique current two-feature listing attachment, actual production Download resolution, public PDF hash checks, complete version-4 `section_context_v1` checks, provider pricing/budget checks and Edge no-write dry runs. Maximum document size was 47 chunks; no document was truncated to a chunk-count target. The manifest-bound idle retrieval baseline used 20 broad and 20 scoped samples and passed.

The existing sequential supervisor processed one document in flight. Its 20-document / 2,000-chunk maintenance gates were retained. Each 20-document checkpoint through 400 received a separate cumulative independent audit, ANALYZE, exact real/planner delta check and fresh exact acknowledgement before resume. The final 13 then completed, followed by the full 413-document independent audit. These were maintenance windows within one 413-document job.

## Held files and remaining scope

The 87 held candidates have concrete evidence in `cohort-ledger.json`. Reasons overlap: 37 independent ordered-text mismatches, 37 PDF-title mismatches, 10 PDF/source disagreements, four original-character mismatches, two annexure tables requiring explicit row/column reconciliation, and two unresolved heading/schedule-context cases. A failed validation does not establish that a file is permanently unusable. These files were not uploaded in this job.

Other bill candidates and nonbill categories remain outside this release. Parliamentary questions alone had 6,758 absent source keys at the snapshot; pack links do not establish current attachment or readiness. Existing recovery stubs, page-OCR records, prior Government/University correction holds and all unrelated existing records remain untouched. New releases require their own current checks; the completed manifest cannot be expanded or restarted.

The worker repeatedly revalidates the complete manifest and saved receipts at maintenance restarts. This dominated elapsed time despite low CPU and small embedding cost. No worker guards were weakened or changed during this run.

## Execution evidence and warnings

Runtime root: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-wide-20261011/`.

Frozen manifest: `job-wide500-v1/stage-01.release.json`.
SHA256: `b8a987362724afab31e157f01fae72b7f9cd9dec7667db269b4caed5864c2481`.

Primary receipts:

- `job-wide500-v1/final-completion.json`: totals, usage, health, capacity and completion evidence.
- `job-wide500-v1/stage-01.release.json.verification-413.json`: all 413 independent document audits and 3,033 citation probes.
- `job-wide500-v1/final-sql.json`: exact final live/planner counts and bill coverage.
- `job-wide500-v1/maintenance-sql-20.json` through `maintenance-sql-400.json`, plus cumulative verification files: maintenance evidence.
- `quality-release-review.json`, `cohort-ledger.json`, `original-provenance.json`, `pdf-screen.json`, `rescreen.json`, `context-screen.json`: review and exclusion evidence.
- `execution-progress.json` and `continuation-state.json`: completed state; do not restart.

A pre-write resume at 40 documents failed with `fetch failed`. Fresh read-only verification checked all 413 public PDF hashes, prepared entries and unchanged provider price; fresh SQL proved no extra writes. The original held checkpoint was preserved and the recovery explicitly recorded in `job-wide500-v1/network-recovery-40.json` before a bounded retry. Later windows and final verification passed. The historical error string remains in the checkpoint and does not describe the final status. Node also emitted its existing experimental type-stripping warning.

Executed verification included the frozen-manifest Edge dry run, sequential supervisor execution, `verify-cumulative.mjs` at every maintenance checkpoint and final completion, live SQL ANALYZE/count/orphan/planner checks, and `git diff --check`. The audit command was `node --experimental-strip-types <job-directory>/verify-cumulative.mjs <manifest> <manifest-sha256>`; final exit 0, `verified 413 documents /7493 chunks`. Supervisor final exit was 0. A negative check of the maintenance acknowledgement helper rejected an incorrect indexed count and preserved the prior acknowledgement.

Changed durable paths in this continuation: this report and `docs/plans/open-work.md`; runtime preparation, ledgers and receipts are under the runtime root and temporary directory. No application implementation was changed in this continuation, so application build/test suites were not rerun. The pre-existing dirty checkout on `task/corpus-single-pilot-20261009` is preserved, with no commit, push, merge, new deployment or schema/compute change. This report records execution evidence; it does not declare the broader project or all corpus work accepted.

## Owner RAG samples

Refresh the listing and reattach either bill before testing:

- **The Right to Menstrual Hygiene and Paid Leave Bill, 2019**, `bill:2019:292`, document `3714bd38-0f70-49f8-92f1-10fcc79102c3` (39 chunks).
- **The Victims of Flood Caused by Heavy Rains, Cyclones and Other Reasons (Rehabilitation and Welfare) Bill, 2019**, `bill:2019:XXXIX`.

Ask: “Summarize the main provisions and responsible authorities, citing the relevant clauses.” Automated scoped retrieval and citation metadata passed; a fresh natural-language chat/UI test by the owner is separate.
