# F257–F260 review and release

> **Status: Living.** Released through PR #62 / `8f01b348`. Approved existing-document repair applied; new ingestion remains held.

**Current evidence:** see the [production release receipt](release.md) and [local verification history](verification.md). The final integrated release passed both required CI jobs. Larger batches remain held.

## What changes

- F257: reviewed record/document associations and caller-visible coverage across desks; authoritative row identity survives attachment previews. Existing Bill/Law adapters remain. Direct document chips recheck readiness. Missing, held, partial and inaccessible mappings do not claim Full Text.
- F258: feature ANN underfill recovers by exact ranking within the same tier/feature. The document-ID branch remains unchanged. Recovery is bounded at 100,000 eligible chunks; larger underfilled scopes fail explicitly and require capacity work, never an unscoped retry.
- F259: document and row tools enforce attached/selection/desk boundaries on every attempt. Explicit Broad remains available. Record-targeted actions reset stale broad focus; a subsequent deliberate scope choice is preserved. Verified Parliamentary subjects outrank MP display names.
- F260: empty markup, headings, placeholders, notices and citation-only output cannot become a successful stored answer. Failed output clears answer sources, retains usage accounting and reports an error. Existing attribution/citation review is preserved; this adds no provider retry loop.

## Reviewed existing-document repairs

Read-only inventory captured 2026-10-27 19:06:57–19:12:12 UTC (28 October IST). IDs are cutoff-bound; pages are separate SQL snapshots, not one MVCC transaction. Each candidate carries the full current row/document/chunk fingerprint; apply must recheck it and the explicitly expected source-URL peer set. Ingestion/publication must be paused during reviewed repair execution. No re-OCR, re-embedding or chunk replacement is proposed.

| Parliamentary inventory | Count |
|---|---:|
| Registered documents in cutoff set | 5,947 |
| Ready documents | 4,749 |
| Candidate listing associations | 5,638 |
| Held documents | 1,198 |
| Held for incomplete indexing | 1,116 |
| Held for unsupported/unverified source identity | 82 |

Hold reasons overlap for those 82; do not sum reason counts. This is the frozen inventory used for the approved repair, not a statement that live counts stopped changing. Already registered but incomplete inputs must not be re-ingested to repair mapping.

| Reported record | Existing document ID | Listing row keys |
|---|---|---|
| Central Assistance under FMBAP to West Bengal | 414bbb00-5706-4424-8547-50bf630930cf | 7820 |
| Support to International and Domestic Film Projects through FFO | 5b36c49d-13d5-4311-8acd-7b561144fe64 | 234 |
| ROB Projects in Jalandhar Lok Sabha Constituency | 5746e4db-4cf3-48a6-b251-2dde97eed828 | 6362 |
| Objectives of National Smart Grid Mission | 3c7cad45-cc0f-40b3-8f62-5df087015f5a | 1866, 2625, 5328, 6529, 7480 |
| Electric Vehicle Station | d8d5c718-14d4-445a-ab4d-a6c981908da9 | 2835 |

All five qualify; the Smart Grid document serves five MP rows without creating five documents.

The full inventory and manifest stay in ignored local staging `ingest/f257-review-20261028/`. They are not published to GitHub. `summary.json` records the manifest hash. The export template is `inventory/export-template.sql`; each `page-*.json` contains metadata, current counts and proposed fingerprints, no OCR body. Preserve this directory before archiving the worktree.

## Other collections

Read-only observations, separate from the Parliamentary capture window:

- Law: 7,549 indexed documents, all with canonical links; 7,546 visible links and 3 intentionally hidden records. No missing legacy key repairs are proposed for Law.
- Bills: 2,893 indexed documents; 2,771 have legacy keys, but only 2,664 resolve to a listing in the same tier/feature. The 229 without a matching listing (122 without a key plus 107 with an unmatched key) require collection-specific review; no invented keys or fuzzy repairs.
- Budget 1, Industry 6, Regulatory 474 indexed documents: shared serving support exists, but automatic repair adapters are not approved here. Keep them held for evidence-backed mapping review.

A shared resolver does not grant automatic admission to every collection. The offline automatic planner intentionally supports Parliamentary exact-source matches only; Law/Bills retain their existing adapter ownership.

## Runnable offline tools

From the repo root:

```sh
node --test scripts/record-mapping-repair.test.mjs
node scripts/record-mapping-repair.mjs --inventory ingest/f257-review-20261028/inventory --out /tmp/new-mapping-review
```

The output is a review-required manifest and summary. The script has no database client or network execution mode. After separate owner approval, its `--plan FILE --sql NEW_FILE --approval SHA256 --decision-id ID --approver NAME --max-associations N` mode renders SQL only. Never invent approval values. The recorded repair has already been applied; any new manifest needs separate approval.

The service-only mapping apply RPC binds source identity, reviewed row content, text hash, metadata, index/chunk state and expected URL peers. Idempotent repeats require the same decision/evidence. `record_mapping_remove` supports exact-evidence association rollback and recounts surviving links; it never deletes corpus content. Ambiguous/unmatched inputs remain held.

## Verification limits and release gate

Focused SQL tests use real local pgvector, authenticated RLS and migration-omission vacuity. Synthetic 44,027-chunk recovery measurements: default planner p50 959 ms, p95 1,958 ms, max 4,960 ms; a separately forced planner/concurrency run averaged 83 ms with 40/40 successes. These are different cache/planner scenarios, not a production SLA or a guarantee for 18 million documents. A 1 ms deadline raises cancellation, not false absence.

Local mocked browser coverage exercises National, State, Law, Economics and Growth plus unmapped, partial and revoked controls. Those tests are distinct from the subsequent live NTER checks recorded in the release receipt.

The owner authorized review, publication, deployment and the verified existing repair. PR #62 passed CI and was merged; migrations, research-chat and UI were deployed. Keep the client's corpus branch intact. No larger batch is authorized by this work.

## Mapping maintenance and remaining boundaries

Linked listing rows and documents cannot be deleted behind the associations: the foreign keys deliberately require an explicit reviewed unlink first. A changed row, document source key or metadata invalidates coverage until reviewed; index/vector readiness is checked live. The stored approval fingerprint also guards registration/index/chunk state at apply time. Coverage does not rehash all chunk contents on every badge request; existing ingestion integrity rules continue to own chunk correctness.

Scope diagnostics record authoritative tuples/document IDs, effective requested focus, retrieval mode and final content-validation outcome in the existing answer trace. They do not store source text or query vectors. The unchanged retrieval RPC return shape does not expose per-query ANN candidate counts or whether exact recovery ran; benchmark/SQL evidence establishes that path, not a new per-query production metric.

The new planner does not automatically admit or ingest a new National collection. Its only write-related mode renders an owner-approved association transaction for review. Client branch changes must consume the released contract and pass the collection admission gate before any resumed corpus work.
