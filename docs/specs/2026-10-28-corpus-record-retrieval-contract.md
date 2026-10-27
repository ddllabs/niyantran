# Corpus records: mapping, search, scope and answer completion

> **Status: Living.** Implementation approved locally, 2026-10-28. Production changes, deployments and re-ingestion remain on hold.

## Summary for reviewers

Indexed text is not enough: a listing must resolve to the correct accessible document, the attachment must report that coverage, and a question must stay within its chosen scope. Four separate defects need separate acceptance evidence.

| Module | Responsibility | Dependencies |
|---|---|---|
| record-document-mapping | Shared verified mapping and coverage contract, with collection adapters | None |
| filtered-search | Avoid falsely empty approximate search within an allowed scope | None |
| retrieval-scope | Enforce document/selection/desk boundaries through every retrieval attempt | Mapping; filtered search for acceptance |
| answer-completion | Reject empty or placeholder answers before successful persistence | None |

Proposed order: mapping and safe reconciliation; filtered search; scope integration; answer completion; combined acceptance. Local implementation is approved; production acceptance remains held.

## 1. Verified evidence and limits

Read-only hosted SQL and deployed research-chat v104 inspection confirmed:

- Five reported question documents are indexed with all vectors: FMBAP 4/4, FFO 5/5, ROB Jalandhar 15/15, Smart Grid objectives 11/11, Electric Vehicle Station 15/15 (chunks/vectors).
- Their desk_rows.document_key and document metadata document_key are null. Official full PDF URLs match existing rows. Smart Grid has five matching MP rows for one answer document; the other four have one each.
- At the earlier inventory check, all 4,153 indexed Parliamentary Question Database documents lacked legacy keys. Counts are changing during ingestion; this is not a fixed repair manifest. Law's null legacy keys are not proof of a defect: Law uses a separate canonical resolver.
- Shared documentKey currently supports canonical law-record UUIDs or derived bill keys. Merely adding an arbitrary key in SQL will not complete browser/server resolution.
- Latest-20 conversation audit found five Parliamentary conversations/six assistant responses: named queries sometimes retrieved correct text; a generic query retrieved unrelated records; another widened from the section to unrelated bills and saved a notice plus <p></p>. SQL-only citations were also used for legitimate metadata questions.
- F255/PR45 commit 3c430a02 blocks unresolved record document searches in attached/selection modes. It did not prohibit every widening path. Deployed code still retries outside resolved-document scope after an empty result and outside a desk module after an empty module result.

### Independently verified scale failure

Live match_documents uses exact feature search at <=15,000 indexed embedded chunks, otherwise match_documents_feature_hnsw with hnsw.ef_search=400 and a shared halfvec index. This is a chunk threshold, not a 5,000-document threshold. The current Parliamentary feature had 44,027 indexed embedded chunks at measurement.

Read-only paired queries reused stored vectors; no provider calls or new embeddings:

| Probe chunk | Current RPC, requested 40 | Exact same-feature search | Overlap |
|---|---:|---:|---:|
| 75277c25-ddd4-4815-8ca5-38d482a90f20 (FMBAP source passage) | 40 | 40 | 40 |
| acc99233-19a0-4acf-be37-e0e0d85c534b (Law passage, cross-topic control) | 0 | 40 | 0 |

Both sides used the identical vector, national tier, Parliamentary Question Database feature, indexed documents and non-null embeddings. Exact comparison ranks full-precision distance within that feature. This reproduces false emptiness in the current large-feature path. It is not an original-query replay, proof of semantic relevance, authenticated-user RLS test, concurrency benchmark or latency guarantee. The original generic query vector was not stored in the inspected database schema. The previous trace separately proves its zero-result/widening behavior.

Historical rationale: docs/research/2026-10-01-feature-filter-measurements.md selected hybrid exact/H400 using a 54,219-chunk replica. PQ was small in that evaluation; reported H400 success for small features depended on an exact plan. That evidence does not qualify current or future 20 GB corpus growth.

## 2. Document mapping across desks

### Required behavior

Define a server-owned record-to-document association contract: stable (tier, feature, record identity) resolves to zero, one or multiple approved document IDs with source role/version, provenance, decision, publication/access state and audit timestamps. Reuse existing bill and canonical Law identities behind compatible adapters; do not replace or blindly populate their keys.

Browser pills, attachment serialization, server resolution, retrieval and citations consume the same authoritative association. Support multiple MPs/rows pointing to one answer and multiple versions/documents belonging to one record. Keep question identity (house/session/question number/date/source) separate from MP identity. Never use title alone or strip identity-bearing URL paths/query parameters to force a match.

Coverage states distinguish verified full text, indexed-but-unmapped, registered/not indexed, metadata-only, held/ambiguous, inaccessible and lookup unavailable. Only accessible, published, indexed sources with required embeddings qualify as Full Text. Mixed multi-document coverage is explicit. Failed lookups cannot assert missing text. Refresh invalidates caches after mapping/index/publication changes.

### Existing corpus reconciliation (no re-ingestion)

Export a dated immutable inventory of documents, chunks/vectors, listings, existing mappings and publication states. Classify mapped, uniquely matchable, ambiguous/conflicting, orphaned, intentionally hidden and incomplete. Match supported collections through official full source identity plus validating metadata; never approve solely by fuzzy title. Record exact IDs/hashes and reasons in a reviewable manifest.

Propose association-only repairs for unique matches, preserving document IDs, OCR text, chunks, vectors, citations, existing version relationships and hidden Law records. Ambiguous items stay held. Require separately approved transaction bounds, before/after fingerprints, idempotent rerun and reversible association changes. Unsupported collections do not silently enter a generic bill/Law adapter.

### Acceptance

All five named records show correct coverage and resolve to their exact answer IDs. All five Smart Grid MP rows resolve to its one answer without duplicate documents. Saved/stale attachments resolve server-side. Verify mixed attachments, multiple versions, hidden/inaccessible sources, lookup failure, already mapped bills and Law, and negative cross-desk matches. Compare authenticated coverage with actual retrieval permissions.

## 3. Search at scale

Treat approximate underfill as retrieval incompleteness, not proof a feature has no evidence. Evaluate bounded iterative/filtered retrieval and a same-scope exact fallback; choose from measured recall, p95 latency, concurrency and database resource use. Never solve underfill by searching another desk. Do not promise a full 40 where fewer eligible passages exist, or semantic relevance merely because 40 rows return.

Benchmark below/at/above 15,000 chunks and representative larger cardinalities on a disposable replica, with realistic skew and RLS. Include generic, topic-specific, unrelated and empty-feature queries. Compare recall against an exact same-scope oracle, ensure tenant/publication filtering, cancellation/timeout behavior and bounded cost. Use EXPLAIN ANALYZE on the replica. Record per-path counts/latency and whether fallback occurred. No live index rebuild, ANALYZE, migration or setting change as part of this specification task. Dedicated indexes/partitioning remain options requiring measurements, not an automatic guarantee.

## 4. No unwanted widening

Attached only and Selection + pins remain within the resolved permitted document set on every search, retry and follow-up. Desk focus remains within its tier and feature. Only explicit Broad context authorizes cross-desk corpus search. Empty results or missing mappings never grant broader scope. Web search is a separate, disclosed policy: preserve explicit off, model capability and privacy failure rules; web results must not masquerade as attached document evidence.

Generic references such as “this document” use verified record identity and subject, not only literal question words. Unknown mappings produce a truthful mapping-unavailable state rather than an assertion that no OCR exists. Row queries remain available for metadata/count questions with row citations. A follow-up that requests other records must honor the selected scope or ask the user to broaden it.

Acceptance: a scoped empty result never issues an unscoped query; a desk miss never searches Law/bills elsewhere. Prove by regression traces, not just response wording. Preserve explicit broad search and supported web fallback.

## 5. Empty answers

Before marking complete, assess visible semantic content after normalizing markup: reject whitespace, empty HTML, comments, citation-only text, placeholders and notices without an answer. Buffer/validate final content as necessary without publishing rejected text. Permit at most one bounded repair under existing turn/model/cost/deadline limits; after failure return an explicit unsuccessful-answer state, not a successful empty answer. Keep actual provider cost accounting and retry idempotency.

Preserve legitimate concise answers, tables and explicit evidence limitations; never invent content or citations to satisfy a length check. Validate cited source identity against retrieved evidence. Test <p></p>, headings/notices only, malformed structured output, cancellation, stream interruption, valid short answers and repair exhaustion. Verify persisted history and UI status agree.

## 6. Ingestion acceptance for all future batches

States: screened -> registered -> indexed -> mapped -> accessible/published -> retrieval-verified -> accepted. Store separate counts; never label merely indexed rows end-to-end verified. Before admitting a new collection, implement and test its mapping adapter or hold it explicitly pending support.

Each batch reports manifest hash, collection/policy boundaries, document/listing/mapping IDs, role/version, text hashes, chunks/vectors, holds, cost, retries and checkpoints. Idempotency must cover both registration and associations. Validate zero unexplained missing mappings, permission parity, Full Text UI, exact attachment scope, citation-reader navigation and representative natural-language questions. Include generic “tell me about this document” and negative no-evidence controls. Database-only vector lookup is insufficient website acceptance. No auto-growing batch size or new collection without owner approval.

## 7. Implementation boundaries and verification plan

Expected scopes after approval: src/lib/deskRows.js and mirrored Deno identity helper; corpusCoverage and aiDrop; relevant desk loaders and AiPanel; server-side mapping adapters/RPCs and additive migrations; ingestion registration/publication/client scripts; research-chat handler/agent/answer validation/persistence; fixtures and documentation. Preserve auth, billing, OCR/chunker settings and corpus content.

Sequential implementation plan with exact write ownership must precede code. Coordinate with active task/admin-persona-prompts and the client's corpus branch; do not overwrite, merge or deploy their work implicitly. Test red before fix for all four capabilities. Required commands after implementation: npm test; deno test -A --config supabase/functions/deno.json supabase/functions; npm run test:sql (disposable local database); npm run lint; npm run build; node -e "import('./api/router.js').then(() => console.log('router import ok'))"; git diff --check. Independent review, both required CI jobs and separately authorized production acceptance follow. This draft alone authorizes none of those production mutations.

## Independent review clarification — 2026-10-28

### What the 15,000 threshold does and does not mean

Two independent reviewers traced the SQL and attachment paths. The threshold applies only to feature search with no nonempty document-ID list. It is neither a database capacity limit nor a limit on document-scoped RAG. The document-ID branch prefilters by document_id, ranks full-precision distance within those documents, and never calls feature HNSW. Its per-document quota and final top-K can still omit passages from long documents; this is evidence selection, not automatic complete-document reading.

An additional read-only live control used the same cross-topic Law vector (acc99233-19a0-4acf-be37-e0e0d85c534b) with p_document_ids=[5b36c49d-13d5-4311-8acd-7b561144fe64] (FFO): 5 results, all 5 from the target, zero outsiders. Hosted privileged SQL proves this retrieval-path behavior, not end-user RLS acceptance.

The feature SQL retains tier/feature predicates: it does not itself return Law documents for a Parliamentary filter. A shared approximate index can exhaust candidates before enough eligible results survive those predicates. The application’s subsequent unscoped retry is the distinct step that can return other sections. Original query vectors and per-turn focus settings are not persisted in the inspected research_turns schema; do not claim exact historical focus/button state from stored response text alone.

### Additional mandatory UI and query tests

Attaching a row currently preserves the saved focus (localStorage, default attached). Only the citation-based “Ask about this document” action explicitly switches desk/broad to attached. A chip therefore does not currently guarantee confinement. The new contract must make explicit record-targeted actions, including record attach/ask-about actions, select and visibly acknowledge Attached only or Selection + pins. Users may subsequently choose desk or broad deliberately; never silently keep a stale broad/desk mode for a newly targeted record. Module attachments retain module scope. Define and test multiple-pin behavior, reload, persisted preference, selection changes and every attachment entry point.

For Parliamentary queries, canonical source subject/question number/date must take precedence over an MP display title when grounding “this document”. Current presearch selection favors row.title before row.subject; the MP name alone is not the answer’s subject. Identity resolution must not depend on an embedding query being specific enough to rediscover the attached document.

For small resolved documents, a bounded original-text read can cover all passages in source order; longer documents require scoped evidence selection and neighboring/section context. Decide the exact bounded policy during implementation planning and test overview versus narrow questions. Neither option may search outside the document set automatically. Do not introduce a universal full-document prompt that overruns budgets.

Require privacy-safe per-turn diagnostics: requested/effective focus, authoritative record/document identities, mapping state, retrieval algorithm and filters, candidate/result counts, fallback reason, and final content-validation outcome. Avoid logging source text, credentials or query vectors by default. These diagnostics must make later scope incidents auditable without inferring UI state.

## Implemented local interface

The lookup pointer is `desk-record:["tier","feature","row_key"]`. It proves no association by itself. Both coverage and research resolve the current caller-visible row through the same RPC. Current Bill/Law keys delegate to their existing adapters; ordinary reviewed links use `record_document_links`. Direct citations use `document-id:<uuid>` with current RLS/index/vector checks. Stale browser legacy keys cannot override the stored row. The final adapter SQL and full 59-fixture SQL suite passed after local Docker recovery; production is unchanged and remains held for owner review.
