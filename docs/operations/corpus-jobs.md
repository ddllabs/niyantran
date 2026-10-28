# Existing-text corpus jobs

> **Status: Living.** Current operator contract, reconciled 2026-10-12. R7 remains open. Dated run reports record earlier policies and outcomes; they do not authorize execution.

## Current boundary

**Law pilot release (2026-10-23):** the owner subsequently authorized the supplied-text connector release and exactly five Law sources. See [pilot plan](../plans/2026-10-23-law-five-pilot.md). This does not resume the held National stage or authorize larger batches. Earlier boundaries below describe their own tasks.

**Latest task boundary (2026-10-23):** the owner has switched to inventory, mapping and orchestration specification only, including the local legal pack. No coding or ingestion is authorized by that task. The National continuation below remains held with 315 prepared sources; preserve its manifest and checkpoint. See the [reconciliation](../research/2026-10-23-corpus-reconciliation.md) and [proposed spec](../specs/2026-10-23-supplied-text-bulk-orchestration.md). Law inclusion is inventory/mapping scope, not a release authorization.

**2026-10-23 continuation:** the owner has now authorized pending National bill ingestion, targeting 1,000 bill identities per review cohort through multiple existing bounded stages. The [continuation spec](../specs/2026-10-23-national-corpus-continuation.md) supersedes the preparation-only boundary below for this scope. Every quality, manifest, budget, capacity and independent audit gate remains. No completed manifest may restart; Law and existing-source replacements remain excluded.

The preceding 2026-10-12 owner task was local integration review only. Its no-ingestion boundary is superseded only by the National continuation above; deployment, merging and pushing remain outside the current scope. The Download resolver and identity companion are already on `origin/main` at `6acabfb`; preserve them. This review does not re-verify production deployment state.

The last recorded completed release is [413 documents / 7,493 chunks](../research/2026-10-11-corpus-wide-batch.md). Its manifest and all earlier completed manifests must never restart. These dated receipts report 3,434 documents / 3,431 indexed / 100,031 chunks / 2,143 covered bill keys; these are not newly queried totals. The 87 exclusions from that cohort, remaining original-pool candidates, nonbill attachment work, and existing-source repairs remain unresolved. Use the current ledger and live state at a future authorized release, never these totals as a readiness count.

## Limits and execution model

- `stage_profile:"sequential_500_v1"`: at most 500 documents, 20,000 aggregate chunks and 10 million aggregate Unicode characters; one document in flight.
- `worker_profile:"medium_v1"`: complete version-4 context documents only, at most 800 chunks and 600,000 Unicode characters each. Never truncate to fit.
- Defaults remain 30 documents / 1,000 aggregate chunks and 100 chunks / 75,000 characters per document. Historical preparation tools may produce smaller drafts; this does not change the explicit larger profile.
- Minimum two-second write gap, bounded attempts and a manifest-specific budget. Every 20 documents or 2,000 verified chunks requires an independent maintenance audit before another write.
- Local foreground supervisor only. It is not an OS service, distributed queue or unattended ingestion system. Closing the session can stop it.

## Preparation and quality

Use a new job directory, repository dependencies, Node supporting `--experimental-strip-types`, original corpus and Citation Pack inputs. Private credentials remain outside Git and command arguments. The source registry is required by the shared binder: `bindBillAnalysisIdentities(map, companion.records, companion.sources)`.

`corpus-job-preflight.mjs` reads original and pack hashes, current listings, public PDFs and version-2 chunks for comparison. `corpus-context-preflight.mjs` prepares version-4 context drafts without network or provider calls. `corpus-version-preflight.mjs` prepares alternate-version evidence. These are preparation tools; their identity `pass` is not substantive quality acceptance. Outputs remain execution-unauthorized until all independent proof and owner release requirements are met. Never overwrite frozen stages/checkpoints. The retired directory-based 23-source runner is historical, not an eligible execution path; current two-feature validation rejects its old one-feature query. Use only file-based manifests for new work.

For each new absent source prove:

1. Exact original archive/pack identity and hashes; cached and current PDF bytes; English title, registration number/year, chamber and version; distributed body agreement.
2. Both current bill features, unique matching title/number/chamber/key, and the actual Download URL. Current validation requires both matching feature rows. For different source/Download versions, prove both identities and roles explicitly. Gazette, manual-year and shared-key holds are not bypassed.
3. Complete substantive text and rendered layout. Text-layer agreement or 90% identity samples alone do not prove OCR quality. Reconcile tables by row/column and inspect operative text, enactment, TOC termination, headings, clauses, schedules, annexures and continuation context.
4. Full version-4 chunks, exact original UTF-16 spans, section metadata, embedding-input hashes and token ceilings. The production Edge Function performs chunking and embedding; local use of the same chunker freezes expectations for verification.
5. Fresh provider price, bounded budget, exact manifest hash, endpoint no-write dry run, manifest-bound retrieval baseline, capacity checks and project-wide writer exclusivity.

Source repair requires a separate raw file, exact ordered edit ledger, repaired hash, PDF hash, and hash-bound full-body quality review. Originals remain untouched. Download repairs use their own identity/proof, never a repaired hash relabeled as original. Proof verification certifies provenance, not semantic quality. `corpus-batch-review.mjs` explicitly leaves `quality_accepted:false`.

Existing stubs, partial writes, page-OCR documents and existing-source overwrite/deletion require separate recovery review and authorization. Incomplete transcripts, unresolved markers and known-quality holds are never fillers for a desired batch size.

## Authorized operation

After owner authorization and completion of the preparation gates, set task-specific `STAGE_MANIFEST` and `MANIFEST_SHA` to the exact reviewed file and hash. A live manifest requires `execution_authorized:true`, `operation_mode:"supervised"` and an exact release note; changing it invalidates prior hashes/baselines.

```bash
node --experimental-strip-types scripts/corpus-stage-job.mjs --baseline "$STAGE_MANIFEST" "$MANIFEST_SHA"
node --experimental-strip-types scripts/corpus-stage-job.mjs --dry-run "$STAGE_MANIFEST" "$MANIFEST_SHA"
node scripts/corpus-job-supervisor.mjs --execute "$STAGE_MANIFEST" "$MANIFEST_SHA"
```

Baseline uses 20 broad and 20 scoped retrieval probes over five indexed bills and expires after 12 hours. Dry runs invoke no embeddings or data writes but create local checkpoints. Every live source gets another dry run and mapping validation. Runtime fetches exact PDF bytes and verifies prepared chunk identities.

Large stages require official Supabase metrics: two samples 30–180 seconds apart, no more than 120 seconds stale. Missing/reset counters, CPU at least 70%, available memory below 15%, or disk busy at least 80% pause work. Retrieval pauses after two consecutive windows above twice baseline p95. These are conservative controls, not a measured saturation guarantee.

## Recovery and independent audits

Locks contain PID, host and ownership token with a recovery gate. They exclude another writer in the same job directory only. The operator must establish exclusivity across all job directories and ingestion mechanisms before starting; these locks are not project-global. Never remove active, unknown or foreign-host locks. A verified dead same-host lock may be reclaimed by the guarded code.

Exit 75 means a persisted bounded retry; respect wake/settlement times. An uncertain write is read before retry; a complete verified record can avoid a repeated embedding request. Unknown usage retains the full cost reservation and requires model-log reconciliation before final acceptance. Partial data, changed identity, invalid vectors, health or budget failures stop the job. Never clear a hold just to proceed. A checkpoint is bound to one manifest and must not be deleted or reused to force execution.

At each maintenance pause independently audit every completed vector, span, context/input hash, original/PDF provenance, listing attachment and real bill-scoped citation retrieval. During an authorized production run, ANALYZE `document_chunks`, `documents` and `desk_rows`, then compare exact expected deltas, real counts, planner counts and orphans. Only after passing, write a fresh `<manifest>.maintenance-ack.json` with manifest hash, exact verified document/chunk totals, timestamp, `independent_audit_passed:true`, and `analyze_counts_passed:true`. It expires after 30 minutes. Resume the same supervisor; completed records are reconciled without paid repetition.

At final completion repeat full independent audit, usage/receipt reconciliation, exact deltas, planner and orphan checks. Worker completion alone is not quality acceptance. Natural-language owner RAG/citation acceptance remains distinct from automated probes.

## Local verification and dependencies

Run `node --experimental-strip-types --test scripts/corpus-*.test.mjs`, `npm test`, the full Deno suite, lint, build, and applicable disposable SQL fixtures. No production failure injection. Version-4 context relies on the existing page-contract SQL support for `embed_hash` and section metadata; no new migration is included in this integration. Function deployment and live evaluation require separate authorization.

See [integration review](../plans/2026-10-12-corpus-integration.md) for current test evidence and local commit disposition. Historical stages, exploratory repairs and mapping-only proposals are preserved as evidence, not executable queues.


## Public capability versus ingestion readiness (F264, local review)

The proposed Full text / Record only display is not an admission or completion signal. Operational readiness remains separately verified: registration, complete indexing, reviewed mapping, publication/access and retrieval/citation acceptance. Read-only admin diagnostics retain detailed states; paged observations do not prove a complete mapping inventory. Do not retry ingestion merely because a public badge says Record only. Existing OCR, identities, chunk hashes, manifests, checkpoints, collection boundaries and authorization gates remain binding. This increment is not yet released and authorizes no production action. See [F264 spec](../specs/2026-10-28-public-corpus-capability.md) and [client handoff](2026-10-28-corpus-client-handoff.md).
