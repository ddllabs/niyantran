# NTER × Tejas OS File Manager — final source audit

> **Status: Historical (dated) — 2026-11-15.** Read-only source audit and proposed implementation contract. It does not certify the current live Supabase schema or authorize product-code, database, or production changes.

## Executive summary

The requested File Manager is a distinct NTER feature, built from the DDL Labs Tejas OS source in the preserved local `sources` folder. The OS source contains `drive_items`, folder hierarchy, upload/index state, file indexing jobs, ingestion functions, chunk/embedding code, AI artifact UI, and a separate Storage bucket (`uploaded-tender-documents`). NTER's refreshed GitHub checkout does not yet contain `drive_items`, a private user drive, or private-file retrieval.

The OS module cannot be copied unchanged. Its effective access model is organization membership plus optional grants; its Agent Artifacts area is organization-wide; and its file ingestion/index tables serve tender and organization workflows. NTER's current corpus tables deliberately allow authenticated shared reads. The safe integration is an additive, owner-scoped File Manager data path that reuses the central ingestion worker architecture but persists and searches private chunks separately.

**Storage decision recorded from the owner:** create a separate private Supabase Storage bucket presented to users as **File Manager Drive**. Proposed machine bucket ID: `file-manager-drive`; use this identifier in code and RLS. Supabase docs require bucket/file names to follow supported naming rules, so keep the machine ID slug-safe and use the spaced wording as the product/UI label. Bucket creation/settings and live policies have not been applied or verified.

## Scope and evidence limits

- NTER checkout: `C:\Users\Afreen\Downloads\niyantran-main (2)\nter-github-refresh`, branch `task/private-file-manager`, base commit `679464770089bde161afc18e2f9200f3ca65a455`.
- OS reference: `C:\Users\Afreen\Downloads\niyantran-main (2)\niyantran-main\sources` (DDL Labs / Tejas OS source). This is a separate local source tree, not a directory in the refreshed GitHub checkout.
- Reviewed NTER React, Supabase migrations and Edge Functions; reviewed OS current migration directory, archived migrations, drive/File Manager UI/hooks, Storage policy migrations, ingestion/indexing functions and chunk/retrieval code.
- Repository migrations and source describe intended/evolved schema; they do not prove which OS migrations are installed in its live Supabase project. No live database or Storage bucket was queried in this audit. The user previously confirmed NTER is live; this report makes no new live-state claim.
- Three requested independent read-only audit agents were started, but each stopped at an account usage limit before returning. The primary agent completed the audit directly. No source or production code was changed by those agents.

## NTER today

### Identity, RBAC and RLS

- Supabase Auth identity is `auth.uid()`. Profile/admin authority is server-derived and protected by `20260921000012_profile_authority.sql` (`is_platform_admin()`); clients cannot make themselves admins by editing profile fields.
- Conversation ownership is implemented in `20260921000002_conversations.sql`: authenticated select/insert/update/delete require `user_id = auth.uid()`. `20260921000013_conversation_ownership.sql` adds composite owner constraints for message/cancellation children so a child cannot be attached to another user's conversation.
- Shared knowledge remains shared by design. `20260921000003_corpus_and_desk.sql` grants authenticated select on `documents`, `document_chunks`, and `desk_rows` with `USING (true)`. Partitioned chunks retain authenticated shared-read policy in `20261101120000_document_chunks_partitioned.sql`; Law serving adds a restrictive serving predicate but does not convert the corpus into a personal file store.
- Ingestion-v2 `document_files` is authenticated-readable with `USING (true)`; OCR pages and ingest job operations are service-controlled. Those tables are also tied to shared `documents`.
- **Consequence:** never store personal File Manager metadata/chunks in the existing shared corpus and assume a new UI filter is sufficient. Existing RBAC and corpus policies should remain unchanged; private data needs independent owner checks.

### Current ingestion and chat uploads

1. Admin upload/admission uses `src/admin/DocumentsPage.jsx`, `src/lib/corpusUpload.js`, and `supabase/functions/admin-ingest/index.ts`; registration is via `ingest_register`/batch registration and staged object verification.
2. `supabase/functions/ingest-worker` claims leased jobs with claim-token fencing, checkpoints stages, retries, cancellation, limits and cost logs.
3. The OCR stage uses Mistral on PDF pages/images. Indexing composes pages/blocks, chunks deterministically (`supabase/functions/_shared/chunking.ts`), embeds through the configured OpenRouter path, writes bounded slices via service-only `chunk_commit`, then activates the document. Shared research retrieval serves the resulting global corpus.
4. Supplied-text/batch paths also exist, but still register into shared corpus tables. They are not an owner-private index lane.
5. Chat drag/drop is ephemeral extraction, not a durable drive: `src/lib/fileText.js` currently caps a file at 25,000,000 bytes, a drop at 50,000,000 bytes and sent text at 12,000 characters per attachment. It reads a subset (PDF, spreadsheet/CSV, text), refuses Word and images, and does not persist the original file.

NTER's current `corpus` bucket is private, configured in `20261001140000_ingestion_v2.sql` for 50,000,000 bytes and PDF/JPEG/PNG/WebP; it is a shared-corpus intake bucket, not the requested File Manager bucket. Its content-addressed paths and global corpus registration semantics must not be reused as user identity.

## Tejas OS / DDL Labs source inventory

### Drive and item tables

The OS source has a migration lineage. The current `sources/supabase/migrations/20260821132741_1065dfad-d76c-4d66-8f51-6c50c2969620.sql` defines the drive foundation; later archived migrations extend it. Other currently active migrations also refer to those tables. `sources/supabase_migrations_archive/20261007000003_create_drives_and_file_tables.sql` is a later port/refinement, but an archived file is not proof of live application.

| OS table | What it stores | Key relevance / adaptation |
|---|---|---|
| `drives` | Organization, `drive_type`, optional `owner_user_id`, name/timestamps; partial unique index for one personal drive per organization/user and one org drive | Keep the `drive_items` concept. NTER can have one private drive per NTER Auth user; do not require an OS organization tenant. Check OS `ensure_my_drives()`: the inspected implementation returns/creates an organization drive and does not establish that all users get a private drive. |
| `drive_items` | File/folder row, `drive_id`, `parent_id`, `kind`, name, materialized `path`/`depth`, Storage bucket/path, MIME, byte size, content hash, extracted text, upload/index lifecycle, `owner_user_id`, `created_by`, timestamps, soft-delete, optional domain linkage | This is the proposed NTER File Manager item table name. Folder rows live in the same hierarchy. Adapt owner checks on every operation; do not copy organization-only RLS. The later archived schema expands kinds (`table_base`, `doc`) and adds `system_key`/artifact-related metadata. |
| `drive_item_grants` | User/role/organization/link grants and viewer/editor/owner role | Exclude grants/sharing from first private-per-user version unless the product later asks for sharing. A grant would change the privacy contract. |
| `drive_index_jobs` | Item-linked queued/running/succeeded/failed/cancelled jobs, requester, attempts, payload, stage, error/retry fields, content/extract/chunk hashes, provider cost, pipeline and shadow-run metadata | Reuse lifecycle ideas, but ownership must be explicit and service transitions fenced. Avoid letting a client update arbitrary job state or change another user's item. |
| `documents` (OS editor module) | TipTap JSON content, plain text, outline, word count, editor lock/revision/index state, keyed by `drive_item_id` | This is the OS document-editor feature, not the uploaded-file row. NTER need not port it unless editable native docs are in scope. |
| `document_revisions`, `document_blocks`, `document_versions` and related editor tables | Rich document revision/block/editor support | Separate editor subsystem; not needed just to upload/index files. Confirm if AI artifacts are editable docs before including this family. |
| `uploaded_tender_documents` | Uploaded tender file metadata: parent tender, Storage bucket/path, MIME/size, embedding lifecycle, uploader/timestamp | Tender-specific metadata. Do not make NTER personal files depend on tender records. |
| `uploaded_doc_embeddings` | Tender/file chunks, 1536-dimensional vectors, content, metadata and chunk index; later migrations link chunks to drive items and add retrieval metadata | Existing OS retrieval is attached to tender/organization corpus. Do not reuse its organization-scoped result function as private retrieval without owner filtering in the trusted query. |
| `document_chunks` (archived migration `20261019000002`) | `document_id`, `drive_item_id`, `organisation_id`, chunk index, heading/content, token/word counts, JSONB embedding | This is a separate OS chunk schema tied to editor documents and organizations. The source has both it and uploaded-document embeddings; choose the latter file-ingestion concepts carefully rather than merging schemas blindly. |

The OS `drive_items` trigger materializes ancestry and checks same-drive parent, folder parent, nesting depth and cycles. These are reusable hierarchy constraints, but owner equality also must be enforced for parent/child rows in NTER (a same-drive UUID alone is not adequate if drive ownership is mutable).

### OS access model findings

- The later `drive_items` policies require the current organization and item effective role/grants. Personal drive `SELECT` additionally checks `owner_user_id = auth.uid()`. This is stronger than basic org-only access, but it remains embedded in OS org/member/grant helpers and requires careful porting.
- Folder/item/job operations are not all identical: `drive_index_jobs` has item-read/edit/own checks, while the base archive used wider organization membership. Migration chronology matters.
- OS `uploaded-tender-documents` Storage policy history begins with authenticated-user-only access in the old bucket migration, then later hardening binds object keys to current org and tender/share checks (`20260416174830...`, `20260416190623...` and related migrations). It is organization/tender sharing, not owner-private storage.
- OS `drive_index_jobs` service processing uses a service-role client for state transitions after authenticating the caller; the Edge Function first checks the item as the caller under RLS and dispatches the orchestrator/lanes with the caller JWT. NTER should preserve this “authenticate and scope at entry, trusted worker for durable work” boundary, while workers must re-check owner binding before reading file content or writing private chunks.
- OS Agent Artifacts UI (`KnowledgeSourcesPanel.tsx`, `DriveBrowser.tsx`) labels Agent artifacts as available organization-wide and uses `system_key = 'agent_artifacts'`. For NTER, artifact rows must belong to the requesting user and retain safe provenance; no organization-wide artifact folder behavior should be copied.

### OS ingestion, chunking and retrieval flow

1. OS File Manager stores file/folder metadata in `drive_items`; files are uploaded to the separate existing `uploaded-tender-documents` private bucket. Client allowlist is `src/lib/drive/uploadPolicy.ts`: PDF, XLS/XLSX/XLSM/CSV, max 50 MiB. This is a UI policy; the bucket definition in an older migration configures 25 MiB and Word MIME types, showing migration/client-policy drift. Effective live limits need dashboard/DB confirmation.
2. `process-uploaded-document/index.ts` authenticates the caller, creates/updates a durable `drive_index_jobs` row, resolves drive scope, handles enqueue/retry, marks state, and calls `ingest-orchestrator`.
3. `ingest-orchestrator/index.ts` loads the drive item under caller RLS, then `route.ts` selects spreadsheet, PDF or drawing extraction. Unsupported types return `unsupported_type`; current router does not support Word. Spreadsheet extensions include XLS/XLSX/XLSM/XLSB/ODS/CSV; PDF can route to PDF or drawing extractor based on filename pattern.
4. `sequence.ts` resumes by saved stage and invokes the extraction lane and `chunk-embed` with the caller JWT. `index-document` and `_shared/chunking.ts` produce chunks; `chunk-embed` handles embedding and persistence. The job stores stage/status, errors, attempts, hashes and pipeline metadata across migration additions.
5. `talk-to-tender`/shared retrieval functions query organization/tender scope and vector chunks. The archived `match_documents_scoped` filters by organization, not owner. A private NTER search function must filter `owner_user_id = auth.uid()` (and active item state) inside the database query before similarity ordering/limit, not retrieve globally then filter in the browser.

“Any file” is supported as a storage policy only if explicitly set. The OS parser is not generic: indexing supports PDF and selected spreadsheet/CSV types, and unsupported types can be stored/unindexed if NTER chooses. The audit did not find a specific “GPU scanning” service. Distinguish malware scanning from OCR/vision extraction; do not execute uploaded bytes.

### Storage quota finding

The OS has organization-level storage quota machinery (archived migrations show a default quota of 5 GiB and usage accounting). It is not evidence for a personal NTER quota or a plan-tier search quota. The inspected File Manager client policy caps individual files at 50 MiB, while a historical bucket migration sets 25 MiB. Do not reuse either number as the final NTER user quota without checking current live OS settings and deciding NTER plan behavior.

## Proposed NTER target data model (approval-ready, not yet migrated)

Use additive tables and one new private bucket; do not alter existing global corpus tables/RLS.

| Proposed object | Minimum responsibility/columns | Security invariant |
|---|---|---|
| `drives` | `id`, `owner_user_id`, name, timestamps; unique owner (one default personal drive per Auth user) | RLS every operation by `owner_user_id = auth.uid()`; no organisation required. Bootstrap function derives owner only from Auth, never caller-supplied owner. |
| `drive_items` | `id`, `drive_id`, `owner_user_id`, `parent_id`, kind (`folder`/`file`), name/path/depth, `storage_bucket`, `storage_path`, MIME, bytes/hash, upload/index states, error/indexed timestamps, source kind (`upload`/`ai_artifact`), optional `conversation_id`/generation provenance, created/deleted timestamps | Owner-bound CRUD; immutable server-established owner/drive; parent must be folder in same drive and same owner. Soft/hard deletion semantics to decide. Root/folder/file uniqueness and path trigger/constraints. |
| `drive_index_jobs` | `id`, `drive_item_id`, `owner_user_id`, `requested_by`, status/stage/attempt/error, leases/claim token or relation to central worker queue, hashes/cost/created/finished times | User can request and read only own job; trusted worker alone advances job; job owner must match item owner and cannot be reassigned. |
| `drive_file_pages` or private extraction table | Item/version/hash, page number, extracted text, OCR/parser metadata and safe artifact references | Owner inherited/enforced through item FK; no public/authenticated shared reads. Keep large OCR text separate from metadata if it benefits lifecycle/retention. |
| `drive_document_chunks` | Item/version, owner, chunk hash/index, page/sheet/range anchors, content, token count, embedding model/vector, metadata | RLS on owner; FK item owner equality; owner filter in vector RPC before top-k. Private chunks never enter global `document_chunks(_partitioned)`/`uploaded_doc_embeddings`. |
| Optional `chat_file_attachments` | `conversation_id`, `drive_item_id`, `user_id`, created time | Composite ownership/FK checks tie conversation, item and authenticated user to the same owner; if attachments are transient, enforce the same check at request time and don't persist this table. |
| Private artifact metadata (table or fields on `drive_items`) | `source_kind='ai_artifact'`, `conversation_id`, run/message id, artifact type, created by, optionally parent Artifact folder | Artifact is owned by the initiating user. Decide whether artifact rows can be indexed and how deletion affects the generated object/provenance. |
| `drive_usage` or transactional quota ledger | owner key, bytes/files/optional indexed pages/chunks and quota policy, atomic reservation/release | Server-side quota checks; counters reconcile with Storage API/listing and deletion events. Numeric limits and billing semantics remain owner decisions. |
| Storage bucket | Private bucket ID `file-manager-drive`; user-facing label “File Manager Drive” | Object path begins with authenticated owner UUID and object ID; policies check bucket and metadata ownership for SELECT/INSERT/UPDATE/DELETE. No public URLs; use authenticated download or short-lived signed URLs issued only after owner authorization. |

Whether to name the owner table `drives` or `user_drives`, and whether attachment/provenance needs dedicated tables, can be settled in schema design. The `drive_items` table concept/name is carried forward from OS at the owner's request. Avoid grants/shares in the first version.

### Bucket setup/security contract

- Create a **new** bucket with machine ID `file-manager-drive`; user-facing label exactly **File Manager Drive**. Keep it private.
- Do not reuse `corpus` or OS `uploaded-tender-documents`; they have different corpus/tender access and parsing contracts.
- Object key proposal: `<auth-user-uuid>/<drive-item-uuid>/<opaque-object-key>`; avoid raw client-selected paths. Validate user prefix and matching `drive_items` record in Storage policies. Every operation must check item owner; never treat UUID unguessability as authorization.
- Set per-object size and MIME restrictions from approved policy. If the user wants arbitrary types, keep bucket type allowlist unset/broad only after server-side malware/content inspection requirements are defined; this only controls storage acceptance and does not mean arbitrary format parsing or execution.
- Storage quotas are owner-level application quotas enforced transactionally in DB/service logic; bucket max file size and Supabase project global max are separate caps.
- Signed URL issuance, delete cleanup, quota release, and worker read paths need authorization and failure tests. Follow Supabase Storage API semantics; do not directly edit `storage.objects` rows.

## Implementation checklist, in dependency order

1. **Approve product contract:** owner-private visibility; `drive_items`; bucket ID/UI label above; upload allowlist versus arbitrary storage; numeric per-file/per-user storage limits; indexed-format list; index/search quota units/tiers/reset; “GPU scanning” meaning and provider; Artifact ownership/provenance/deletion; supported folder upload/delete/retention behavior; optional NTER admin access. Until decided, proposed default is no cross-user sharing and no arbitrary file execution.
2. **Schema/security design:** additive migrations for private drives/items/jobs/pages/chunks/usage; explicit owner constraints and parent ownership; RLS for all tables; no service-role leakage to browser; private Storage policies. Preserve NTER profile/admin/conversation/global-corpus policies unchanged.
3. **Security proof before UI copy:** disposable SQL fixtures with two users; prove cross-user denial on item/folder CRUD, path forgery, storage download/upload/update/delete, job ID manipulation, chunks/RPC, chat attachment, citations, artifacts, quota racing; prove owner flow works. Check all SECURITY DEFINER search paths/execute grants, FK owner alignment, signed URL lifetime, cleanup and rollback.
4. **Central ingestion adapter:** reuse NTER centralized worker concepts (durable queue, lease/fencing, retry/cancel, OCR/parser, deterministic chunking, embeddings, bounded commit, activation, cost/error telemetry). Add a per-user target adapter that writes only private page/chunk/item records. Provide format adapters only after server-side file signature/type/size validation. Index becomes searchable only after successful activation and only to owner.
5. **UI/chat:** adapt selected Tejas OS FileManager/Drive UI with NTER components/auth; list/folder/create/rename/move/upload/download/delete/preview, status and quota. Save AI outputs in the owner’s Artifact area. Attach files to the owner’s chat and cite file/page/sheet sources from owner-filtered retrieval.
6. **Acceptance/release:** tests on disposable DB only (NTER repo requires both app/Edge suites and SQL fixtures for `src/lib`, Edge and migrations), lint/build, independent security review, migration/rollback and data-retention review. Preview shares live Supabase per NTER repo rule; therefore any preview action that writes real user content/data or deploys schema needs separate owner authorization and must be scheduled after local acceptance.

## Open decisions and ready-to-code status

The high-level direction is sufficient to begin the **design/migration contract**: NTER-owned user-private `drive_items`, separate private **File Manager Drive** bucket, and centralized ingestion architecture reused through an owner-scoped persistence/retrieval adapter. It is not yet sufficient for a fully specified implementation because the following affect schema, UX and cost:

1. Numeric per-user/per-file storage limits and any plan mapping.
2. Search/index quotas: what counts (queries, pages, chunks, tokens, bytes or AI credits), reset window and at-limit behavior.
3. Which types may be stored versus indexed; whether PDF, image, Word, spreadsheets, CSV, text and archives need parsers.
4. Meaning/service for “GPU scanning” (security malware scan versus OCR/vision), and what happens when it fails.
5. Whether NTER platform admins can inspect a user's private files and under what audited support workflow.
6. Artifact types, provenance, indexing, retention and deletion semantics.
7. Folder upload, folder depth/collision rules, soft-delete and recovery period.

The recommendation is to use separate user-private drive data and a shared worker implementation, not shared corpus rows. Owner review of the final plan is the next gate; coding can start once these decisions are confirmed or the owner explicitly delegates defaults. No implementation/migration/deployment has been made in this audit.

## Primary source map

### NTER checkout

- `supabase/migrations/20260921000002_conversations.sql`
- `supabase/migrations/20260921000003_corpus_and_desk.sql`
- `supabase/migrations/20260921000012_profile_authority.sql`
- `supabase/migrations/20260921000013_conversation_ownership.sql`
- `supabase/migrations/20261001140000_ingestion_v2.sql`
- `supabase/migrations/20261101120000_document_chunks_partitioned.sql`
- `supabase/functions/admin-ingest/index.ts`
- `supabase/functions/ingest-worker/{handler.ts,ocr.ts,index-step.ts,index.ts}`
- `supabase/functions/_shared/{chunking.ts,embed.ts}`; `src/lib/fileText.js`

### Tejas OS / DDL Labs `sources`

- `supabase/migrations/20260821132741_1065dfad-d76c-4d66-8f51-6c50c2969620.sql` (drive tables/RLS/jobs); later job evolution: `20260821145623...`, `20260821164025...`, `20260822195438...`, `20260823100421...`.
- `supabase_migrations_archive/20261007000003_create_drives_and_file_tables.sql` (later archived drive schema); `20261012000002_file_sharing_and_contributor_access.sql` (grant model).
- `supabase/migrations/20260219201238_907dd0f1-b45e-4e50-bdc3-fd47e59523ca.sql`, `20260416174830...`, `20260416190623...` (uploaded tender document/chunk tables and evolving Storage policies).
- `supabase/functions/process-uploaded-document/index.ts`, `ingest-orchestrator/{index.ts,route.ts,sequence.ts}`, `index-document/chunks.ts`, `chunk-embed/{index.ts,embed.ts,assemble.ts}`, `_shared/chunking.ts`.
- `supabase_migrations_archive/20261019000002_create_document_chunks_table.sql`, `20261031000002_enhance_vector_rag_retrieval.sql` (archived chunk/retrieval evolution).
- `src/lib/drive/uploadPolicy.ts`, `src/hooks/useDrive.ts`, `src/components/agent-hub/files/FileManagerShell.tsx`, `src/components/agent-hub/drive/DriveBrowser.tsx`, `src/components/agent-hub/panels/KnowledgeSourcesPanel.tsx`.

## External platform reference

Supabase distinguishes buckets by access rules; private buckets enforce Storage object RLS on download as well as writes. Bucket/file naming follows the platform's allowed naming rules; the bucket ID `file-manager-drive` is the safe API identifier, and “File Manager Drive” is the product label. Supabase recommends Storage API operations rather than direct writes to Storage metadata tables. [Bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals), [bucket creation](https://supabase.com/docs/guides/storage/buckets/creating-buckets), [Storage schema](https://supabase.com/docs/guides/storage/schema/design).
