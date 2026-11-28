# Private File Manager discovery and integration proposal

> **Status: Living** — discovery baseline on 2026-11-14; update after owner decisions and implementation evidence.

## Purpose

Record the current Niyantran (NTER) access and ingestion model, the Tejas OS File Manager reference inspected from the preserved local `sources` tree, and a safe proposal for a per-user File Manager. This is an audit and proposal, not implementation authorization.

The expanded table inventory, migration lineage, Storage policy comparison, ingestion/chunk flow, and target schema are in [the 2026-11-15 final audit](../research/2026-11-15-file-manager-final-audit.md).

## Current Niyantran implementation (source audit)

- Authenticated identity is `auth.uid()`. Admin authority is derived server-side by `is_platform_admin()`; profile authority is hardened in `20260921000012_profile_authority.sql`. Conversation rows and their children are owner-bound (`20260921000002_conversations.sql`, `20260921000013_conversation_ownership.sql`).
- Shared research corpus tables `documents`, `document_chunks` (including partitioned successor), and `desk_rows` have authenticated read policies using `true`; writes are service-controlled. This is intentional shared corpus behavior, **not** an acceptable policy for personal file content.
- The `corpus` Storage bucket is private and configured for 50,000,000 bytes per object and PDF/JPEG/PNG/WebP MIME types. In ingestion-v2, `document_files` is also readable by any authenticated user; OCR pages and jobs are service-role controlled. These records are corpus ingestion internals, not a user-owned drive.
- Existing chat drop attachments are transient browser extraction, not durable File Manager data: PDFs, spreadsheets/CSV and text have bounded extraction; images and Word files are currently refused; per-file 25,000,000 bytes, per-drop 50,000,000 bytes and 12,000 characters sent per attachment (`src/lib/fileText.js`).
- The centralized ingestion architecture comprises admission/registration (`admin-ingest` and `ingest_register`/batch registration), private staged storage, leased and fenced `ingest_jobs`, worker OCR (Mistral), deterministic page composition/chunking, OpenRouter embeddings, bounded `chunk_commit` calls and activation only after indexing. Retrieval is through shared-corpus research search. There are also supplied-text/batch adapters. These are existing central-corpus routes; no user-facing private-drive route is present in NTER.
- NTER source audit found no `drive_items`, user File Manager UI, per-user drive schema, personal file Storage policy, or personal-file retrieval scope in `src`, `supabase/migrations`, or `supabase/functions`.

## Tejas OS reference findings (preserved `sources` tree)

The Tejas OS / DDL Labs source is at `C:\Users\Afreen\Downloads\niyantran-main (2)\niyantran-main\sources` in this workspace; it is absent from the refreshed GitHub checkout. Its archived migration `supabase_migrations_archive/20261007000003_create_drives_and_file_tables.sql` defines `public.drive_items` (along with drives, grants and indexing jobs). It includes a Drive UI and hooks, upload policy, AI-artifact related areas, and chat/source-picker integrations. Its archived schema is organisation-oriented and carries grants, linked domains, and org IDs. `ensure_my_drives()` and UI labels are not proof of per-user confidentiality. Its `KnowledgeSourcesPanel` describes Agent artifacts as org-wide across every agent, and the Drive browser has a system “Agent artifacts” folder. This conflicts with NTER's private-per-user requirement, so artifact ownership/provenance must be adapted rather than copied as-is. Its upload policy permits PDF, XLS/XLSX/XLSM and CSV up to 50 MiB in `uploaded-tender-documents`; this is narrower than “any file”. Treat the module as a behavior/reference source, not a drop-in schema/policy or ingestion implementation.

The owner confirmed the OS `drive_items` table is present in the DDL Labs `sources` repository and wants a separate Storage bucket named **File Manager Drive**. Proposed Supabase bucket ID is `file-manager-drive`; use the label in the UI and the slug as the API identifier. This bucket has not been created. OS `documents`, `uploaded_tender_documents`, `uploaded_doc_embeddings`, `document_chunks`, and `drive_index_jobs` represent separate editor/tender/indexing lifecycles; do not treat them as one schema. The OS migration archive is source evidence, not proof of live DB state.

## Proposed outcome

Each authenticated NTER user gets a private drive and can browse, upload, download/preview supported files, create folders, move/rename, and delete files/folders. AI-generated artifacts are represented as File Manager items in the existing AI Artifacts area. A user may explicitly attach a file or index it and ask questions in chat. Every listing, object operation, artifact operation, indexing job, and retrieval result must be scoped to the owner. No other user, including another ordinary user, may list, read, download, modify, delete, index, or retrieve that user's private file content. Existing NTER RBAC and shared-corpus policies remain unchanged.

“Any file type” means accepting/storing arbitrary uploaded bytes if the owner chooses that policy; it does not mean executing uploaded files. Indexing is limited to explicitly supported, safely parsed formats. Unsupported files remain stored but unindexed with a clear status. File extension/MIME checks are not a security boundary by themselves.

## Ingestion integration constraint

Reuse the centralized ingestion *architecture and worker components* (durable jobs, leases/fencing, retry/cancel, scan/OCR or parser stage, chunking, embedding, bounded commits, activation/observability) behind a personal-file adapter. Do **not** put personal rows into the shared `documents`/`document_chunks` path or call its global `chunk_commit` unchanged: their authenticated RLS is shared-read. Add owner-bound drive/file/index tables and a private bucket/prefix policy; expose a search/RPC path that enforces owner scope inside the trusted query. Chat attachments must prove ownership server-side and search must include the owner predicate before candidates are returned. Keep private retrieval and global corpus serving distinct. Use private bucket ID `file-manager-drive` with the product label **File Manager Drive**; do not reuse `corpus` or `uploaded-tender-documents`.

The existing worker's OCR stage is PDF/image-oriented. PDF, image, spreadsheet, CSV, Word, text, and other formats require an explicit parser/admission matrix; the Tejas upload allowlist does not imply NTER worker support. “GPU scanning” has not been mapped to a named NTER service or Tejas OS component in this audit. Confirm whether it means malware scanning, OCR/vision processing, or another GPU-backed analysis before planning that stage.

## Acceptance evidence for later implementation

1. Two-user authorization tests prove cross-user denial for metadata CRUD, object read/write/delete, artifact access, job status/control, chat attachment and retrieval; owner access passes. Include forged owner IDs, parent-folder IDs, storage paths, and job/document IDs.
2. Database migrations prove owner constraints and RLS for files/folders, artifacts, jobs and private index rows; Storage policies bind object paths to authenticated owner and validate corresponding metadata. Admin access follows explicit existing RBAC policy, not a service-role shortcut in the client.
3. Index action creates one durable job through the centralized job architecture, reports queued/running/succeeded/failed/cancelled accurately, retries safely, and makes content searchable only to the owner after activation.
4. Format, size/quota, malformed-file and unsupported-format cases are tested; uploaded content is never executed. Chat citations identify the correct private file and page/chunk without returning another user's data.
5. Existing shared corpus access and current RBAC behavior are regression-checked unchanged.

## Decisions still required

- Confirm whether the user means **Niyantran/NTER** throughout; upstream repo is `ddllabs/niyantran` and Tejas OS is the reference source.
- Numeric per-file and per-user storage limits, accepted upload formats/MIME policy, and whether “any type” means store all bytes while indexing only supported types. The current NTER corpus limit (50,000,000 bytes) is not a user quota.
- Search/index quota: “standard, works with any data” is not a measurable rule yet. Define what is counted (indexed files, pages/tokens, embeddings, queries, bytes, AI credits), plan tiers, reset period, and behavior at limit. Format-specific adapters still apply.
- Define malware/security scanning versus OCR/vision meaning of “GPU scanning”, service/provider, fail-open/closed behavior, latency/cost target, and retention of scan results.
- Proposed: port/adapt the `drive_items` concept into NTER as its File Manager item table; confirm whether to keep that table/API name and which Tejas OS UI capabilities are in first release. The app must not acquire Tejas org/team sharing unless explicitly desired; current product decision is private per user.
- AI Artifacts: confirm artifact types, whether artifacts can be indexed/attached like uploads, provenance links to conversation/run, and whether deleting an artifact/file cascades to generated content and vectors.
- Folder upload behavior and collision/overwrite rules; deletion soft/hard and retention/recovery window; supported preview/download behavior.
- Whether personal documents should be available only in the chat where attached or selectable across the user's conversations; agreed intent so far is owner-private and user can ask questions via chat.

## Out of scope for this discovery

No source copying, code edits to product behavior, database migration, production/live Supabase access, data writes, deployment, or publication. No arbitrary uploaded-code execution.
