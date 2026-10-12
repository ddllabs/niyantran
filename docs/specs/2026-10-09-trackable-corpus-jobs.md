# Spec: resumable ingestion of trackable existing text

> **Status: Living.** Follow-up to the first R7 stage; owner authorized implementation/preflight on 2026-10-09. The exact first 25-document stage completed and the owner confirmed RAG works; the next 25-document stage has also completed under the [plan](../plans/2026-10-09-trackable-corpus-jobs.md). Sequential work, no delegation.

## Objective and current state

Expand bill-scoped RAG using existing local OCR/text, preserving the exact relationship between the listing, its Download PDF button, the document and citation text. Reuse the existing text ingestion endpoint and text citation viewer. No re-OCR is required for this path. Here, “editable” means usable by the existing ingestion/admin workflow; it does not introduce a PDF editing feature.

Read-only production checks on 2026-10-09 confirmed 2,364 documents, 2,361 indexed documents and 54,803 chunks. Three held documents retain their original text/URL but have zero chunks or embeddings. The previous stage has 20 searchable documents / 457 chunks after that cleanup. [Fresh inventory evidence](../research/2026-10-09-trackable-corpus-inventory.md).

At the initial planning snapshot, the runner was bounded to the previous 23-source manifest. The generalized manifest worker and foreground supervisor have since been implemented and tested: bounded retries, uncertain-response reconciliation, verified-success skipping and stale-lock recovery. Partial writes remain explicit holds; no persistent reboot service or unattended CPU telemetry exists.

## Scope and invariants

- Only previously unindexed, manifest-listed bill sources with local text, valid hashes, traceable PDFs and unambiguous current attachment keys.
- Check all current listings sharing the key, including both bill features; matching one intended listing is insufficient. Conservatively hold differing title/chamber identities until reviewed.
- Require the UI resolver's PDF to match the approved source URL and document version. Fetch the actual PDF, confirm PDF content, and verify title, bill number/year, chamber where evidenced and version against source metadata. Unreadable or contradictory identity is a hold, not a guessed match.
- Text integrity and citation-span integrity are separate from PDF identity. Keep stable source IDs, text hash, role/version and exact URLs; do not replace an existing document's text automatically.
- Produce embeddings only after these checks. Searchability requires all expected chunks, valid 1,536-dimensional embeddings and exact UTF-16 citation spans. Never mark partial data indexed.
- Preserve completed work across crashes, timeouts and laptop sleep. Reconcile uncertain writes before repeating a paid request. Revalidate mapping before every new write and after resume.
- No accumulating unusable vectors: mapping failures detected before writing create none. Unexpected post-write identity failure stops the job and produces an exact cleanup inventory; removal requires scoped authorization unless the execution approval explicitly covers that compensation policy.

## Eligible cohorts

The refreshed, conservative candidate pool is 464 sources: 347 small candidates (at most 100 chunks and 50,000 characters), then 117 medium candidates. The 347 small sources have since undergone actual-PDF preflight: 91 pass, 256 hold; all 91 passing sources are now ingested across the approved stages. The 117 medium candidates still await their own preflight and release. None is declared ready solely because its URL matches. A failed preflight reduces the released count. Documents and distinct newly covered bills are reported separately: an additional document version can belong to an already indexed bill.

The next implementation targets the small tier first. The medium tier requires a measured ingestion limit and separate manifest release. Cross-key links, other versions, missing/unproven URLs, ambiguous keys, oversized documents, generic nonbill attachment work and the three retained text-only documents remain outside this release.

## Execution contract

Use one local worker, one document per authenticated request, with corpus files on the laptop. Start with stages capped at 25 documents or 1,000 expected new chunks, whichever would be reached first; never split a document simply to fit a stage. Initial maximum is 100 chunks and 50,000 characters per document. Use a two-second minimum gap between writes, bounded transient backoff and health pauses. These are proposed starting limits, not proven CPU guarantees.

Every manifest binds target project, source location/hash, source ID, canonical listing evidence, PDF identity evidence/hash, source role/version, expected chunks, chunker/model/version, stage bounds and estimated/actual budget. Checkpoints bind to the manifest hash and record attempts, receipt, reconciliation and verification. Secrets and runtime files stay outside Git.

Transient errors may resume automatically within the approved manifest and budget. Identity/hash conflicts, unexpected existing sources, malformed vectors, resource-limit failures and exhausted retries are terminal holds. Health pauses require recovery evidence; manual review pauses cannot be cleared by a process restart. No automatic expansion to another cohort.

## Acceptance evidence and verification

1. Offline/preflight inventory records a pass or explicit hold for every selected source. No live ingestion or embeddings during preparation.
2. Tests fail first for duplicate/multi-identity keys, wrong PDF/version, a timeout after a successful write, partial writes, stale/live locks, restart after verification, changed manifest/text, terminal hold and exhausted budget. Then they pass with the intended recovery.
3. Recovery reconciles exact source/hash/chunks before retry. Completed sources incur no additional embedding request. Partial states either resume only verified missing work through a validated endpoint path or stop with an exact repair inventory.
4. A disposable/local fixture proves recovery and cleanup behavior. Production is not a failure-injection test fixture.
5. Each live document is verified against source hash, listing key, URL, expected unique chunks, dimensions and spans. Scoped retrieval verifies the intended document is accessible through the bill attachment. Owner UI evidence checks Download PDF, drag/drop RAG and a text citation.
6. Stage receipts reconcile exact per-source outcomes, billed usage, failures and counts; global deltas alone are insufficient if another writer is active. Planner statistics and database health pass before continuing.

Commands for the scripts-only implementation: `node --experimental-strip-types --test scripts/corpus-job-preflight.test.mjs scripts/corpus-stage-job.test.mjs scripts/corpus-job-supervisor.test.mjs`, `npm test`, `npm run lint`, `npm run build`, `git diff --check`. Supervisor/preflight/worker tests are now present. If endpoint changes become necessary, stop and revise the scope; then run the required Deno and SQL checks as applicable. No standalone type-check is claimed.

Implementation follows the existing ESM scripts and Node test style. Keep recovery decisions separate from transport; for example `if (receiptUncertain) await reconcileSource(sourceId)` must run before another ingestion request. Repository docs live under `docs/`; scripts under `scripts/`; runtime manifests, texts, locks and receipts outside Git.

Always validate and fail closed on identity. Obtain exact authorization before further production ingestion, cleanup, schema/endpoint changes or persistent OS-service installation. Never publish secrets, guess mappings, delete unrelated chunks, modify historical stage evidence, deploy or change main as part of this plan.

Current execution evidence: [first released stage report](../research/2026-10-09-trackable-corpus-stage-01-run.md). Production totals after the approved stage are 2,389 documents / 2,386 indexed / 55,484 chunks; the three retained text-only holds are unchanged. The owner confirmed RAG works and authorized the next prepared stage; later stages remain unreleased.

Second-stage execution: [report](../research/2026-10-09-trackable-corpus-stage-02-run.md). Current totals: 2,414 documents / 2,411 indexed / 56,177 chunks / 1,306 covered bill keys. Forty-one passing small sources remain; stage 3 is unreleased.

Final-subset amendment: owner authorized completing the remaining 41 approved sources with a modest stage increase. Global cap is now 30 documents, with all other bounds unchanged; freeze 30 + 11 source stages, USD 0.08 each. Advance only after independent source/link/vector/retrieval and health checks plus ANALYZE. No hold/medium source is admitted.

Final current state: all 91 approved small sources / 2,350 chunks complete, verified and linked. Production totals 2,455 stored documents / 2,452 indexed / 57,153 chunks / 1,346 covered bill keys. [Final report](../research/2026-10-09-trackable-corpus-final-run.md). No approved queue remains; medium candidates and held/other cohorts require separate investigation.
