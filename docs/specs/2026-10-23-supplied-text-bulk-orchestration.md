# Supplied-text bulk orchestration: proposed change specification

> **Status: Living — umbrella proposal with a locally authorized connection increment.** 2026-10-23. The owner subsequently authorized connecting supplied OCR to the existing ingestion system. The [connection plan](../plans/2026-10-23-supplied-text-connection.md) defines the bounded implementation. Broader relationship/serving/capacity decisions and production release remain pending. The earlier inventory task performed no coding or ingestion. Track approval and subsequent work in [open work](../plans/open-work.md). Evidence: [reconciliation report](../research/2026-10-23-corpus-reconciliation.md).

## Objective and assumptions

Prepare the downloaded National and Law corpora once, reuse valid mapping and text evidence, and process eligible documents through the website-controlled ingestion system into Supabase. A held document must not stop independent eligible documents. Existing indexed documents and their citations must survive unchanged.

Assumptions for review:

- Supplied OCR/text is the input. Missing or deficient text becomes an exception; this workflow does not purchase or rerun OCR.
- The website is the control and review surface. Archive scanning and long-running work happen in bounded background workers, not a browser request or a single Edge Function invocation.
- A cohort of 1,000 bills counts business records. It can contain more than 1,000 documents; it does not specify concurrency or override resource limits.
- The existing queue, retrieval and citation systems remain the foundation. Scaling to tens of millions requires measured capacity and a deployment decision, not simply a larger batch constant.
- Local/archived records that suggest new desk rows are proposals. Importing them, mapping feature names, and making their text searchable require an explicit release scope.

## Verified current state

There are two ingestion paths:

1. Supplied-text National work: `scripts/corpus-stage-job.mjs`, its supervisor/preflight helpers, and `supabase/functions/ingest-documents/`. The endpoint chunks and embeds; the local runner freezes expectations, reconciles existing chunks, checks identities, bounds costs and performs maintenance pauses. Current runner preparation/execution is bill-specific. It is a foreground process, with directory-local locks rather than project-wide writer exclusion. Its 500-document profile is sequential and has aggregate character/chunk limits; those limits remain binding until separately changed.
2. Website PDF ingestion: `src/admin/DocumentsPage.jsx`, `src/admin/documents/`, `supabase/functions/admin-ingest/`, `supabase/functions/ingest-worker/`, and the ingestion-v2 SQL migrations. It already has durable jobs, skip-locked claims, leases/fencing, retries, private storage, OCR/index stages and activation. Extend this machinery; do not build a second incompatible queue.

The existing page contract keys pages and blocks to an extraction revision. Legacy supplied text does not automatically acquire PDF-backed page coordinates. The current storage-backed document-key unique index permits only one v2 document per key, while legacy bill text can have multiple versions. That mismatch must be resolved deliberately before multi-document v2 registration.

`src/lib/deskRows.js`, `supabase/functions/_shared/deskRows.ts` and `src/ai/AiPanel.jsx` derive selected-record keys through `billDocumentKey`. Loading nonbill keys into the database alone will not complete website attachment/retrieval support, and a later feed refresh can erase unsupported keys.

See [current operator contract](../operations/corpus-jobs.md), [ingestion architecture](../Architectures/01-ingestion-pipeline.md), [page contract](2026-09-30-rag-v2-chunk-contract.md), and [ingestion-v2](2026-10-01-rag-v2-ingestion-v2.md). Historical architecture counts are not current capacity measurements.

## Capability map for approval

This is an umbrella specification and proposed dependency map, not a collection of approved module specifications. Review boundaries before writing implementation plans or module specs.

| ID | Capability | Existing boundary to extend | Depends on |
|---|---|---|---|
| A | Immutable corpus inventory, revisions and validation evidence | Corpus preparation helpers and source registry | None |
| B | Document/record relationships and desk adapters | Document metadata, desk-row normalization and attachment contracts | A |
| C | Durable supplied-text registration and processing | admin-ingest, ingest_jobs, ingest-worker and shared chunking | A, B |
| D | Website progress, exceptions and release controls | Existing admin Documents UI | C |
| E | Capacity qualification and staged release | Existing audits, retrieval evaluation and job metrics | A–D |

Build order is A → B → C → D → E. Work remains sequential unless an approved plan fixes interfaces and disjoint write scopes. A later plan must name exact files, database migration scope, dependencies and focused verification commands. No new infrastructure vendor or schema migration is selected by this document.

## Input and inventory contract

Use streamed JSONL/JSONL.gz shards, with a small immutable package manifest. Never unpack the whole legal archive or send it as one browser upload. Preserve source archives; a staging store holds only approved payloads, checksummed and resumable. A composite package may legitimately include older record-level pack versions; resolve the package manifest and schema compatibility rather than rejecting all retained original records. Existing storage may be reused if limits, cost and access controls are demonstrated adequate.

Each source revision must retain:

- Package ID/version, archive/member identity, member SHA-256, record location and schema version. Resolve repeated ZIP members by verified byte identity and explicit precedence. Record internal/external manifest disagreement rather than choosing a checksum silently.
- Stable source key; exact UTF-8 text SHA-256; declared extraction method/language and original text. Do not normalize text and then claim its old hash.
- Document identity, role/version/language, title and source URLs, plus supplied citation metadata. Source archive URL and archive member remain distinguishable from a direct document URL.
- Proposed record relationships, their evidence, mapping adapter/rule version, and current target fingerprint. A filename or title-only resemblance is a candidate, never an accepted match.
- Pages, sections and optional boxes with their coordinate units, offset encoding, hash/revision binding and completeness flags.
- Declared licence/attribution, source exclusion/sensitivity flags, duplicate/replacement instructions and their source provenance. Missing evidence remains unknown rather than silently passing.

The inventory separates physical files, physical record revisions, canonical source documents, business records, relationships, prepared chunks and active indexed documents. Counts at these levels must never be added indiscriminately. National structured rows follow their desk-data route; they are not all PDF documents to embed.

### Mapping precedence and exceptions

Use exact stable identifiers first, then full source URLs and independently corroborated composite identities. For case documents, include court/forum, case identifier, order date, order/document identity and language/version as applicable. CNR alone identifies a case, not every order in it. Multiple desk rows can reference one source; one business record can reference many sources. A full URL is association evidence, not proof that its current PDF is the correct document.

National bill validation retains title/number/year/chamber/version and actual Download resolver checks; bill number/year alone can collide. Preserve the frozen approved evidence for unchanged sources. PQ/regulatory/transfer adapters must propagate stable keys through loading, refresh, website selection and retrieval. Explicitly reject the known cross-chamber MP mapping errors.

Legal records already provide `document_key_suggested`, citation objects and often `desk_row`. Apply a versioned adapter to the application's actual feature catalogue; do not pass supplied feature names through blindly. Current feed records and proposed historical corpus records are distinct populations. Creating corpus-backed rows is a separate release action, not a failed attempt to match every old judgment to a small current feed.

Legal `__full` records replace the same source key's earlier truncated text; they are not new documents. Select replacements before chunking and use boxes matching the selected content hash. Preserve partial-long-document exceptions. Regional translations retain their own source identity and language while linking to the English parent where supplied. A translation must not overwrite the English text or inherit its page numbers. The current pack has 17 absent English parent references; hold those relationships rather than fabricate a parent. Whether an otherwise valid translation may be admitted standalone is an explicit adapter policy.

Apply supplied duplicate winners only after verifying the complete rule file and references. Exact text equality alone does not prove two business documents are interchangeable. Distinguish repeated occurrences of the same identity from a different source to discard. Apply the supplied file/revision selector before collapsing to source keys: three local keys have competing text hashes and file-specific keeper preferences. A first-occurrence-wins rule is invalid. Resolve keeper/drop overlaps transitively, check cycles and competing final winners, and preserve per-rule evidence. The local rules currently leave 86 competing-terminal-keeper source exceptions; these are not blanket blockers for unrelated valid sources. Retain aliases/provenance and do not erase current indexed records. Sensitivity/dedupe companions are present in this local legal ZIP and must be reconciled to the selected revisions; a future package missing them has an explicit release dependency. Their declared counts are not additive estimates of how many sources to discard.

## Relationship design decision required

Recommended direction: an explicit record-to-document relationship, with document role/language/version and primary/default selection represented independently from the business record key. Source revision identity and extraction revision identity are separate again. Retain existing document IDs and current citation references.

Before implementation, write an ADR comparing an explicit relationship table with extending current metadata/link contracts. Include RLS, authorization, retrieval joins, uniqueness, existing `ingest_link`/`ingest_swap` semantics, backfill, compatibility and rollback. Do not simply drop `documents_v2_document_key_unique`, suffix business keys with arbitrary roles, or rewrite old source keys. Validate all existing callers that assume one active storage-backed document per record. A primary displayed attachment may be singular while available document versions are plural.

## Preparation evidence and status contract

Preparation is reusable when all bound inputs remain identical: source/member/text hashes, mapping rule version, target identity fingerprint, chunker/context version, extraction/coordinate contract and quality decision. A changed dependency invalidates only affected evidence. Cost/health/authorization checks expire independently and are refreshed at execution; an unchanged corpus should not need a fresh manual identity review every time the process restarts.

Use separate dimensions rather than one overloaded status:

| Dimension | Representative values |
|---|---|
| Inventory | discovered, validated, malformed, superseded, excluded |
| Mapping | proposed, matched, ambiguous, conflicting, unmapped |
| Text/citations | valid, incomplete, invalid offsets, missing page mapping, review required |
| Preparation | not prepared, prepared, stale |
| Stored state | absent, already indexed, partial, conflicting revision |
| Release | unauthorized, approved, paused, revoked |
| Execution | queued, claimed, retry due, indexed pending audit, audited, failed |

“Mapped” must not be displayed as “ready.” “Prepared” must not be displayed as “released.” Missing PDF pages can still permit exact text citations if the product and release policy allow text-only sources; do not fabricate page numbers or treat all such sources as unreadable. Some quality flags are informational, some are release blockers: each rule must state which, with evidence and a reason code. Existing historical holds remain until explicitly resolved, not waived by a new enum.

The current National 315-source remainder is prepared with successful offline revalidation. Its existing job remains held. This specification neither resumes it nor creates a replacement manifest.

## Durable processing and idempotency

Register a batch manifest and bounded child items through an authenticated server-side contract. Validate authorization and package scope before any storage/database write. Clients must never receive a service-role key. Large payloads are referenced by verified storage location and hash; the registration endpoint accepts metadata, not tens of gigabytes of text.

Add a supplied-text input route to the existing worker state machine. It validates/restores the approved text/page/section revision and joins the existing chunk/embed/audit/activation path without invoking OCR. Keep PDF upload behavior compatible. Reuse pure chunking/embedding contracts; avoid nested unaudited calls to the legacy endpoint that bypass the queue's fencing and atomic activation.

- Claim work with the existing lease/fencing model; enforce project-wide concurrency and writer budgets across both legacy and website paths.
- Idempotency binds source identity, text revision, relationship revision and chunking/model configuration. Existing identical indexed work is a verified no-op.
- Retry only transient failures with bounded backoff. Hold semantic conflicts, invalid vectors, changed inputs and uncertain billing until reconciled.
- Reconcile persisted output before retry after a timeout. A successful provider call followed by a lost acknowledgement must not automatically repeat embedding.
- Commit chunks in bounded transactions; activate a complete, verified revision atomically. Partial chunks must not become searchable as a complete document.
- Preserve expected/actual chunk counts, embedding-input hashes, attempt receipts and known/unknown usage. Unknown usage retains its cost reservation.
- Persist pause/cancel/restart state. Revoked releases prevent new work; already committed data is not deleted as a cancellation side effect.
- Replacements/backfills require their own explicit migration/release scope and rollback plan; the first rollout may be absent-source-only.

## Citations and text correctness

Preserve exact text and source context through all routes. Convert Python/code-point offsets to the application's UTF-16 contract explicitly; test supplementary characters, not only ASCII and common Indic characters. Check page/section spans against the selected text. Keep extraction hash distinct from source-text hash according to the existing contract; never set the active extraction merely because a loader template suggests it.

Boxes must join by source key and content revision, with page-local offsets, dimensions and coordinate conventions validated. Store partial coverage honestly. A box for a superseded truncated record cannot be attached to the replacement. Distinguish physical PDF pages, reporter page numbers and section labels. Section-only Acts/regulations need exact section citations; missing sections are not silently reconstructed. Do not write generated `search_text` columns or declare `indexed_at` before genuine embeddings and activation checks.

For bills retain complete operative clauses, headings, tables, annexures, schedules and continuation context. Automated corpus-wide validation should be deterministic where possible; known semantic/layout problems go to the exception queue. Approval evidence must say which checks actually ran, rather than treating a hash match as proof of substantive OCR accuracy.

## Website behavior

Extend the current Documents UI with package/cohort summaries and drill-down to source revisions and record relationships. Show already indexed, prepared, eligible for release, held by reason, excluded/superseded, queued/running, retrying, audited and partial/conflicting sources separately. Include filtered downloadable exception manifests, provenance, receipts, progress and cost.

Allow operators to inspect mapping evidence and a representative citation before release; display what changed since the previous preparation. A release identifies exact immutable manifest/version, allowed operation types, budget and concurrency. Bulk acceptance cannot silently approve ambiguous mappings. Resume shows remaining work without duplicating paid work. Show business-record coverage separately from document/version and chunk counts.

## Capacity qualification

The local archive's scale does not establish current Supabase capacity. Measure bytes/chunks/tokens per document by collection, including long judgments, section-rich Acts, translations and OCR. Estimate table, vector index, pages/boxes and backup sizes from those distributions, then validate on isolated representative loads. Do not extrapolate the small historical bill cost to the entire legal pack.

Benchmark bounded concurrency, database connections, WAL, disk growth, indexing latency, CPU/memory, retrieval p95 and worker throughput. Account for the large box corpus separately; do not assume all geometry must reside in hot relational tables. Choose retention/storage/partitioning only after evidence and ADR review. Maintain planner statistics after authorized bulk loads and restarts, as required by AGENTS.md. ANALYZE is an operational production action and was not run during this report.

Rollout checkpoints: deterministic offline fixtures → disposable database integration → approved limited pilot → a reviewed 1,000-record cohort → measured expansion. Each cohort has configurable bounded child stages; no claim of 18-million-document throughput until demonstrated. Current conservative capacity/retrieval guards stay in force until a measured replacement is approved.

## Acceptance evidence and verification

Before implementation, approve this capability map and resolve the relationship/feature-routing decisions. Before release, produce:

1. Exact inventory conservation: physical inputs = selected + superseded/excluded/rejected, with duplicate identities explicitly reconciled; stored-state join complete and reproducible.
2. A second preparation of unchanged inputs produces the same mappings/chunk expectations; changed source/rule/target invalidates only affected records.
3. Fixtures proving collisions, cross-chamber errors, multiple orders per CNR, translations, replacement precedence, incomplete flags and unsupported desk features hold correctly. Remove the guard and demonstrate the test fails.
4. Citation fixtures for code-point/UTF-16 conversion, missing/overlapping/incorrect spans, full-text and section-only citations, mismatched boxes and partial geometry.
5. Durable-worker recovery tests: two workers, stale lease, lost acknowledgement, provider success before DB failure, partial commit, budget exhaustion, cancellation, restart and existing-source conflict. No duplicate paid work or premature activation.
6. Compatibility tests for current PDFs, legacy text, multi-version bills, selected-record attachment, desk refresh, RLS and authorization. Existing IDs/citations remain valid.
7. Bounded-load capacity evidence and retrieval comparisons; exact deltas, vectors, chunk/context/input hashes, source relationships, planner counts and receipts audited before wider release. Owner natural-language citation acceptance remains distinct from automated probes.

Implementation verification commands (not run for this documentation task):

```bash
node --experimental-strip-types --test scripts/corpus-*.test.mjs
npm test
deno test -A --config supabase/functions/deno.json supabase/functions
npm run test:sql
npm run lint
npm run build
node -e "import('./api/router.js').then(() => console.log('router import ok'))"
```

Use Vitest for application adapters/admin UI, Deno tests beside Edge handlers, Node tests beside corpus helpers, and disposable SQL fixtures under `supabase/tests/`. SQL fixtures must fail without their target migration. Router import is required if the implementation changes `api/` or `server/`. There is no standalone type-check command. Follow existing JavaScript ES modules and typed Deno interfaces, explicit hashes/version fields, pure validation functions, and the established `ingest_claim`/`ingest_advance`/`ingest_activate` boundaries. No production failure injection.

## Boundaries

Always preserve originals, archived proofs, active citations, explicit exclusions and held checkpoints; record exact evidence and limitations. Never commit credentials, place secrets in browser variables, quietly re-OCR, truncate text to fit a batch, or reset a completed manifest.

The owner has authorized the local connection increment, including its additive migration file and tests; applying it to production is not authorized. Infrastructure purchases, paid processing, data publication and replacement/deletion still require owner authorization. The original inventory phase created reports and a proposed spec only. Applying and verifying the Law companion rules, remaining National quality exceptions, nonbill adapters, relationship design, website integration and capacity qualification remain tracked in open work.
