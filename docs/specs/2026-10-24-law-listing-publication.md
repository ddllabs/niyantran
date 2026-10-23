# Automatic Law listing publication

> **Status: Living.** Owner approved implementation on 2026-10-24. No new batch authorization. Tracked as F245 in `docs/plans/open-work.md`.

## Outcome and scope

Every eligible indexed Law document must resolve to the correct user-visible legal record and verified document attachment. Existing listings gain verified OCR attachments; eligible corpus orders absent from the register gain new listings. Existing indexed documents must be reconciled without re-OCR, re-chunking or re-embedding.

This is one publication capability layered onto the existing supplied-text orchestrator. It does not replace its chunking, hashing, indexing, citation or deduplication rules. Read [observed architecture](../research/2026-10-24-law-listing-review.md) and [bulk orchestration specification](2026-10-23-supplied-text-bulk-orchestration.md) first.

First rollout boundary: NCLT orders and existing IBBI announcements, preserved as distinct record types. Other forum adapters require explicit source/collection eligibility. SC views may share one canonical document with multiple placements. News modules remain news; High Court judgments, Acts and regulations cannot silently be routed into unrelated news features. No expanded ingestion, automatic downloads, sensitivity release or source-coverage claim is included.

## Identity and reconciliation contract

Separate four concepts: legal record, source occurrence, immutable document version, and module placement. One case may have many orders; one order may have several language/version documents. Company name is never a legal document identity.

A server-validated mapping proposal carries:

- contract/adapter version, collection and policy boundary;
- stable source key, full source URL, source occurrence/shard locator and immutable text hash;
- forum, jurisdiction, record type, case/order number, order date, language and revision where supplied;
- action `link-existing`, `create-listing`, or `hold`, and target record ID if known;
- matched evidence and hashes, policy decision reference, expected current mapping fingerprint;
- existing document ID and hash for metadata-only reconciliation, or immutable ingestion manifest identity for new text.

Match verified source associations first. Exact full source URL is a candidate match only after record-type/forum/date conflict checks. Corroborated compound identity may match when unique and supported by evidence. Titles, company names, basenames and text hashes alone cannot merge legal identities. Conflicting aliases, ambiguous records, unsupported forums, missing required provenance or policy uncertainty are held with reasons.

Live database reconciliation is authoritative at admission and publication. An offline prior-decisions file is insufficient. Stale proposals must be recomputed or held, never overwrite a changed relationship.

| Existing state | Required action |
|---|---|
| Listing + eligible OCR, no indexed document | Link pending mapping; reuse existing supplied-text ingestion; publish attachment after successful index |
| Eligible OCR, no listing | Reserve stable canonical identity; ingest through existing pipeline; publish new listing and attachment |
| Indexed document, missing listing/link | Metadata-only reconciliation; preserve document/chunks/embeddings |
| Listing with no available eligible OCR | Keep source-only listing; report missing/held text; do not claim indexed coverage |
| Exact rerun | Return existing ingestion and publication receipts, zero duplicate records or embedding calls |

## Persistence and publication

Add separate canonical records, source memberships/aliases, verified record-document relationships and publication receipts/checkpoints. Exact table names belong to the implementation plan. Relationships store document role/version/language, evidence hash and adapter version. Preserve immutable supplied-text metadata and all prior manifest hashes.

Seed current prepared listing rows with their existing row keys and source provenance before switching reads. Do not regenerate index-derived legacy IDs after sorting. Preserve bookmarks/pins and one record across compatible module placements. Source refresh owns its own membership only; it cannot delete corpus-owned records or verified attachments.

Indexing and publication have separate durable states. Index activation must durably schedule publication, with an idempotency key bound to document version and mapping decision. `indexed_pending_listing` is not a failed embedding job. Publish canonical record, attachment and serving/search projection atomically; retry publication alone after failure. Use unique constraints and concurrency checks, not client-side existence checks alone. Existing jobs remain historically successful; the combined workflow reports complete only when publication is verified or explicitly held.

Expose authenticated, scoped server reconciliation/publication operations using existing platform-admin authorization. Client scripts must not require a Supabase service-role key or write arbitrary listing SQL. Endpoint names and payload schemas are proposed until implemented and tested. Current ingestion manifests remain byte-for-byte retryable; a separate publication decision references existing document IDs/hashes instead of rewriting old input metadata.

## Serving and user experience

Published canonical data must supply module pagination/search, exact-record navigation, global command search, AI row selection, corpus availability and summary counts. Replace the static-only NCLT read path deliberately; do not rely on an unstable static/DB union. Add bounded server pagination before large registers are exposed.

Resolve selected listing attachments to verified document IDs server-side throughout coverage, pins and research-chat. Show source-only versus indexed availability and document type. An announcement and an order may share a case relationship but remain separate records. Record counts, placement counts and indexed-document counts must be labeled separately.

Apply serving permissions and sensitivity policy to listing, search, attachments and RAG; UI hiding alone is insufficient. Keep corpus text and credentials out of Git evidence. Policy decisions do not themselves grant unrestricted serving rights.

## Existing-ten reconciliation acceptance

Capture a fresh baseline before any future authorized migration. The investigation observed ten indexed Law documents and 527 chunks. Nine have exact register matches. Future Consumer requires a distinct order listing, not reuse of its announcement. Globiz must link to its existing correction without creating another listing. Preserve all ten document IDs, text/input hashes, chunk IDs/content/vectors, citations and ingestion receipts; zero OCR/embedding calls or embedding spend. Reconcile the entire current metadata register without implying that all 435 entries contain indexed text.

## Client script contract and operational limits

Extend the reusable screener/importer workflow after the server contract is released. Screen corpus policy and conflicts; query live reconciliation; produce hashed mapping proposals and ready/held/already-indexed manifests; dry-run exact chunks and projected spend; submit only bounded approved scope; save restartable checkpoints and both ingestion/publication receipts; verify every resulting listing and attachment. Resume from remote receipts after interruption. A publication failure never resubmits text for paid indexing.

Per-batch document, chunk, spend, concurrency and collection boundaries must be explicit. No values or blanket autopilot approval are granted by this specification. Existing eligible records can be processed automatically within a future approved envelope; held inputs remain held. Unsupported conditions stop or quarantine the affected scope and produce an actionable report.

## Ordered implementation and verification plan

1. Resolve PR 13 conflict-scan blocker separately; add failing escaped-identity regression and malformed-row policy tests. Re-review exact head and CI.
2. Freeze baseline identities and draft SQL/interface contracts. Scope: new Law mapping migrations and disposable SQL fixtures. Verify stable keys, RLS, uniqueness, optimistic concurrency and refresh ownership with failing controls first.
3. Add server reconciliation and durable publication integration. Scope: supplied-text activation/queue and scoped handlers; preserve existing indexing behavior. Test crash after indexing, concurrent publication, stale mapping and retry without embedding calls.
4. Add canonical read/attachment adapters. Scope: Law feeds, pagination, desk-row projections, counts, selection/coverage and research-chat resolution. Verify source-only records and existing pins, cross-view placement, search on later pages and authorization.
5. Extend client screener/importer and guide to the released contract. Scope: scripts, focused tests and operations documentation. Test offline/stale state, exact rerun, checkpoints and bounded budgets. No raw corpus or secrets in evidence.
6. Independently review, pass lint/build/app/Edge/SQL/client checks and normal protected-branch CI. Release only with explicit authorization. Execute separately authorized metadata-only existing-ten reconciliation and authenticated listing/RAG acceptance before proposing a new ingestion batch.

Acceptance cases include Future Consumer announcement/order separation; multiple orders per case; translations/revisions; exact URL with conflicting identity; new OCR-only order; listed/no OCR; exact retries; concurrent agents; refresh survival; policy holds; hidden records in search/RAG; malformed and escaped JSON identities; preserved legacy navigation; realistic natural-language query embeddings and website answer citations. Remove each guard to show its relevant test fails. Record anything unverified instead of calling vector self-lookup end-to-end RAG proof.

## Exclusions and pending decisions

Implementation was authorized on 2026-10-24; production activation remains a separate release step. No production backfill, larger batch, re-ingestion, expanded forum catalog or automatic merge of ambiguous identities is performed here. No production activation or metadata backfill is performed during implementation. Capacity qualification and the broader 19-million-record policy/adapter work remain in the existing bulk specification and open-work tracker.
