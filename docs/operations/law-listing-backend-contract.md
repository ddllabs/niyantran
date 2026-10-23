# Law listing backend contract

> **Status: Living.** Released and activated on 2026-10-24; see [release evidence](law-listing-release.md). No new cohort authorization is implied.

The additive migration separates canonical `law_records`, owned `law_source_memberships`, immutable `law_document_links`, and durable `law_publications`. Original supplied-text payloads and hashes remain unchanged. The first adapter admits only `law:trib:IBBI_NCLT:` source keys with tribunal_order/NCLT/IBBI_NCLT citations, case number, valid order date, eligible hash-bound review, and an exact official HTTPS ibbi.gov.in/uploads/order PDF URL. Company-name matching is prohibited. Date/forum/type conflicts, duplicate URL aliases, competing revisions, ambiguous listings, and unsupported provenance hold.

## Authenticated admin-ingest actions

Every action uses the existing platform-admin bearer check. Clients never receive service credentials. Bodies are bounded by the existing 4 MB supplied-text envelope; only reconcile may carry a full record.

- `law-reconcile`: `{record}` (validated/canonicalized through `prepareSuppliedText`) OR `{document_id,text_sha256}`. Read-only. Returns `{ok,contract_version:1,status:ready|held|published,action:link-existing|create-listing|hold,document_id,record_id,row_key,document_key,fingerprint,reasons,indexed}`. IDs can be null before registration/publication. Existing-source changed payloads are held, even if text hash alone matches.
- `register_text`: existing request plus `expected_mapping_fingerprint` from reconciliation for a NEW supported NCLT source. This is passed separately as `mapping_fingerprint` to the RPC; it never changes immutable payload hashing. Registration rechecks under an advisory transaction lock before creating work, then stores publication intent atomically. Existing exact retries remain compatible without this new field. All NEW Law sources outside the supported adapter are refused before paid indexing; previously registered exact retries remain compatible.
- `law-publish`: `{document_id,text_sha256,expected_fingerprint,decision_id,approver,evidence_sha256}`. Rechecks authoritative mapping; stale proposals refuse. Indexed documents publish metadata only, without OCR/chunk/embedding calls. Unindexed documents store pending intent. Unsupported mapping returns held and creates no listing.
- `law-status`: `{document_id}`. Returns `{ok,contract_version:1,status:unmapped|pending|held|published,document_id,record_id,row_key,document_key,fingerprint,reasons,attempts,last_error}`.

The indexing activation trigger attempts publication inside a recoverable subtransaction. Failure records pending and an error while indexing remains succeeded. A later explicit publication request with a fresh reconciliation fingerprint retries only metadata. Published exact retries return the existing receipt. Runtime listing publication cannot change document text, metadata, chunk IDs or vectors.

Automatically created intent records retain the immutable review decision/rules hash and authenticated registration actor. Its approver description says `approved supplied-text review`; it does not invent the original person's name, which the old canonical adapter did not retain. Explicit publication decisions carry the supplied approver name.

## Read contracts

`law_listing_page(p jsonb)` is caller-RLS, available to anon/authenticated. Returns `{active,rows,total,totalAll,page,pageSize}`. Before explicit activation it returns active:false, allowing the caller to retain the legacy feed. After activation errors must not silently fall back to stale static data.

Inputs: `q` (max300 chars), `page` (1..1000000), `pageSize` (1..200), optional exact `key` (legacy row key, UUID, or law-record UUID), `sort` in date/title/court/record_type/availability/source_url, `dir` asc/desc, `filter` array of `{col,value}` where col is record_type/court/availability. Same-column filters OR; different columns AND. Unsupported maps/properties refuse.

Each row contains its preserved `id` row key, `record_id`, `document_key=law-record:<record-id>`, record_type tribunal_order|announcement, and availability source-only|indexed. Seeded rows keep legacy bookmarks. The desk_rows search projection uses those identical keys/availability, and protected refreshes cannot erase or replace projection content or links.

`law_resolve_document_keys(p_keys text[])` is caller-RLS and authenticated-only, max12 input keys. Returns rows `{document_key,document_id}` only for verified indexed visible attachments. Existing bill resolution remains separate. Restrictive Law policies apply to documents, chunks and desk_rows; a hidden canonical record is not exposed through a different retrieval route.

## Explicit operator release sequence

Implementation used local fixtures only. The separately authorized production sequence below is now complete; release evidence records the operator RPC path and its verification limits.

0. Deploy the additive migration first (inactive, unseeded), then the matching admin-ingest/research-chat handlers and web readers. Do not seed while older readers still lack `law-record:` attachment resolution. Confirm the pre-activation RPC response and legacy serving before continuing.
1. After all matching readers/handlers are deployed, call service-only `law_seed_listings()` against the reviewed baseline. It preserves all existing NCLT/IBBI row keys and projects canonical keys; sets seeded=true but **does not activate serving**.
2. Reconcile/publish the existing indexed documents through the authenticated endpoint using exact text hashes and saved decisions. No re-ingestion. Verify original document/chunk/vector/citation and job fingerprints.
3. Service-only `law_activate_listings()` refuses if any indexed supplied NCLT document lacks a visible attachment or any canonical projection disagrees. Only this explicit operation switches reads. Existing corpus access stays unchanged before activation.
4. Verify module pages, global search, selected-record RAG and natural-language answers with real caller permissions. Larger batches require their own bounded approved scope.

Seeding captures the reviewed baseline register; legacy feed refresh cannot overwrite it afterwards. Adding/removing official source-only baseline records or other forum adapters requires a deliberate membership update capability, not an implicit destructive refresh. Translation/revision and compound-identity fallback are held for review in this first adapter.

## Local verification evidence

- Admin-ingest focused Deno:88 passed; final integrated Edge suite:1203 passed.
- Final integrated application tests:6573 passed across423 files; lint, production build, router import and bundle checks passed.
- `bash supabase/tests/run.sh law_listing supplied_text`: disposable fixtures and omission/vacuity controls pass. Law fixture additionally runs two concurrent publishers and a causal activation/exact-registration-retry overlap.
- Lock inversion was reproduced as an actual PostgreSQL deadlock before consistent activation lock order was added; overlap passes afterwards.
- Stale admission fingerprints, concurrent URL aliases, missing Law endpoint, and non-Law refresh deletion regressions each failed before their corrections.
- Temporary-copy mutation controls removing alias, admission fingerprint, projection key/text, and visibility guards each fail their intended assertions. No production test fixtures or corpus writes were used.

These checks are local evidence, not proof of production website/RAG acceptance. Production migration, baseline seed, existing-ten metadata reconciliation and activation are recorded separately in the release evidence.
