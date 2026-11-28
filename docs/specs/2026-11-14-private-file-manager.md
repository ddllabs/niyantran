# Spec: private per-user File Manager with AI indexing

> **Status: Historical (2026-11-14).** From the contributor's file-manager branch (a4a09d84); records the branch's design as it stood then. Main's schema is F410–F413 (see `docs/specs/2026-11-26-file-manager-schema-adoption.md`), not the migrations this document describes.

> **Branch status: Approved for implementation — pending explicit implementation authorization.**
> Prepared 2026-11-14, reconciled 2026-11-15 following the formal product sign-off, the
> [Ingestion & RAG Compatibility Audit](../research/2026-11-15-ingestion-rag-compatibility-audit.md),
> [ADR 0016](../decisions/0016-private-file-manager-ingestion-rag-integration.md), and the
> [Central Product Functionality Reference](private-file-manager-functionality.md).
> No application or database changes are authorized by this document.

## Current state

Niyantran has owner-scoped Supabase conversations and user preferences, plus a
server-verified platform-admin role. Its `documents`, `document_chunks`, and
`desk_rows` are intentionally shared-readable to authenticated users. The
private `corpus` bucket and page-aware PDF ingestion-v2 flow serve the shared
research corpus. Browser chat attachments are temporary text extracts; they
do not create durable user files. See the [integration audit](../research/2026-11-13-file-manager-integration-audit.md),
the [compatibility audit](../research/2026-11-15-ingestion-rag-compatibility-audit.md),
and the [central functionality reference](private-file-manager-functionality.md).

Tejas OS provides a useful Drive UI/data-model reference, but its organisation,
sharing, tender, and search/index integrations are not Niyantran's auth model.
Some Tejas Drive migrations are archived, and its current hook uses an
organisation drive; do not treat those policies as proof of private ownership.

## Problem

Users need durable, private file storage and folder organization, plus a way to
select their own stored files for Niyantran AI and save AI-created artifacts.
Reusing Niyantran's shared corpus tables unchanged would expose personal file
metadata and indexed content to all authenticated users.

## Approved product scope & outcome

- One personal File Manager per authenticated Niyantran user, keyed to the
  verified Supabase Auth user id (`auth.uid()`). No org/team drive or user sharing in the
  initial release.
- Users can upload and store any file type, create folders, browse, rename,
  move, preview/download where safe and supported, and delete files/folders.
  Files persist until their user deletes them.
- Include an explicit per-file **Index for AI** action for file formats
  supported by the ingestion pipeline. PDF-only indexing is confirmed for v1.
  Reuse Niyantran's centralized queued ingestion architecture: the same worker lifecycle,
  Mistral OCR page checkpointing, `pageText.ts` composition, `chunking.ts` chunking,
  `embed.ts` OpenRouter 1536d embeddings, retry/checkpoint/cost handling, and progress
  concepts. Do not create a parallel ingestion engine.
- Store and retrieve File Manager metadata, extracted content, chunks and
  embeddings with an enforced owner boundary (`user_files`, `user_folders`, `user_file_chunks`,
  `user_file_jobs`). Do not put personal content in the current shared-readable corpus tables
  (`documents`, `document_chunks_partitioned`) or loosen their policies.
- Allow a user to attach their own stored file to research chat. Server-side
  code must verify ownership before reading or searching it; the response and
  citations must not disclose storage paths or another user's content.
- Provide a dual-source RAG retrieval adapter (`match_user_files`) that runs
  alongside `match_documents` when personal files are in scope, merging evidence
  with full cryptographic citation verification (`text_hash`).
- Seamlessly support both Research AI and Desk "✦ Ask AI" triggers using the same
  dual-source retrieval adapter in `research-chat`.
- Provide a way to save AI-created artifacts as owned File Manager items in an `AI Artifacts` folder.
- Keep existing Niyantran RBAC, profile authority, shared corpus access and
  admin-ingest authorization unchanged except for separately reviewed,
  additive File Manager policies and server checks.

## Upload-any-type boundary & v1 format confirmation

“Any file type” means the File Manager may store arbitrary file bytes in the
dedicated `user-files` private storage bucket up to 50 MB per file. It does not
mean arbitrary files are safe to render, parse, OCR, execute, or include in AI context.

- **Confirmed for v1**: Initial AI indexing is confirmed strictly for **PDF** files.
- Other file types remain stored and available for safe download but show an
  unsupported-for-AI status pill. Adding formats (spreadsheets, plain text, docx)
  requires a separate parser/validation and security review in v1.1.

## Authorization invariants

1. Every user File Manager row and derived index belongs to exactly one
   authenticated user. The caller cannot choose or update `user_id`. Identity is
   derived exclusively from `(SELECT auth.uid())` via the InitPlan pattern.
2. RLS prevents user A from reading or changing user B's files, folders, jobs,
   extracted text, chunks, search results, or artifact rows.
3. Private Storage policies bind object paths and operations to the owner:
   `(storage.foldername(name))[1] = (SELECT auth.uid()::text)`. An
   authenticated session alone does not grant access to an arbitrary object.
4. Folder parent references and moves cannot cross owners, enforced by composite
   foreign key `(parent_id, user_id) REFERENCES user_folders(id, user_id)`.
   Deleting a folder applies a documented subtree/object/index cascade.
5. Privileged Edge Functions validate the caller and ownership before every
   service-role read/write. An item id or path from the browser is never
   authorization by itself.
6. Platform-admin role (`is_platform_admin()`) does not imply access to a user's personal files.
7. Existing shared-corpus, conversation, profile and billing policies remain
   unchanged by this feature.

## Central ingestion worker scheduling & RAG extension

1. **Ingestion Scheduling & Fairness**:
   - `user_file_jobs` is maintained as a dedicated table with client Realtime status subscriptions.
   - Concurrency is partitioned in `ingest_settings`: `corpus_max_running = 2`, `user_file_max_running = 2`,
     and `max_running_per_user = 1`.
   - Shared corpus batch jobs are never starved; interactive user jobs are prioritized within their dedicated pool.
   - Retries fail faster for interactive user files (max 3 attempts vs. 6 for corpus).
   - Pre-flight credit holds and settlement RPC (`user_file_settle_credits`) attribute OCR and embedding costs
     to the user's paise credit ledger.
2. **Dual-Source RAG Integration (Unified for Research AI & Ask AI)**:
   - "Ask AI" from desk records and Research AI in `AiPanel.jsx` both route to `research-chat`.
   - Existing RAG in `_shared/retrieval.ts` invokes `match_user_files` in parallel
     with `match_documents` based on turn focus and requested scope.
   - Returned chunks are unified under the `Chunk` contract tagged with `source_origin: 'shared' | 'private'`.
   - Private citations preserve `text_hash` cryptographic verification while rendering
     distinct private source badges in the frontend and routing PageViewer downloads to the `user-files` bucket.

## Acceptance evidence

- Two-user database tests prove A cannot enumerate, read, modify, move, delete,
  download, index, attach, search, or cite B's file by guessed id/path.
- Composite foreign key proves cross-tenant folder injection fails closed (`23503`).
- Storage RLS proves path traversal attempts fail closed (`403`).
- Authenticated non-admin can use own File Manager; current admin checks and
  existing shared-corpus behavior are unchanged.
- A supported PDF can be stored, explicitly indexed by the central worker,
  queried in chat under the agreed scope, and cited to its owner; retry and
  failure status are visible without duplicate work/cost.
- Unsupported file types can be stored and safely downloaded but cannot reach
  a parser or chat as if successfully indexed.
- AI-created artifacts appear only in the requesting user's File Manager and
  survive reload; deleting a file removes its searchable derived content immediately.
- Existing chat, corpus retrieval, ingestion and authorization regression
  suites pass; local SQL fixtures use disposable databases.
- Live migration/deployment and user-data testing remain separate authorized
  actions after local acceptance.

## Final product decision resolution & approval baseline

1. **Decision 1 — Storage Quota & Limits**:
   - Individual file size limit: **50 MB** (Approved product limit).
   - `free` plan (formerly `explorer`): **500 MB** (Approved product limit).
   - `pro` plan (formerly `professional`): **5 GB** (Approved product limit).
   - `plus` plan: **2 GB** (**Proposed mapping — pending explicit product confirmation**).
   - `max` plan (formerly `enterprise`): **50 GB configurable** (**Proposed mapping — pending explicit product confirmation**).
   - Lapsed accounts evaluate dynamically via `my_entitlement()` to **500 MB** (Approved behavior).
   - Quotas are enforced server-side under concurrency locks; Trash files continue consuming quota; permanently deleted files release quota.
   - Outstanding verification requirement: Storage quota function and server-side upload check must be authored and verified in Task 2.
2. **Decision 2 — Retrieval Scope & Explicit Indexing Initiation**:
   - Default retrieval when private files are attached: (1) Attached private file(s) + (2) Shared Niyantran research corpus.
   - User can adjust scope to attached-only or corpus-only.
   - Web search is independently toggled and never silently enabled.
   - **Recommended v1 Indexing Behavior**: Upload and AI indexing are decoupled. Uploading a PDF does not automatically trigger indexing. Indexing is initiated strictly by an explicit user action (**"Index for AI"** button in context menu / bulk bar). Non-PDF formats remain storage-only in v1. Failed indexing can be retried by the user. (Recommended decision pending final product confirmation).
3. **Decision 3 — AI Artifacts**:
   - User-owned `AI Artifacts` folder created lazily upon first save.
   - Artifacts save only via explicit user action ("Save to Files"), with target folder selection.
   - Preserves title, timestamp, conversation reference, artifact type, and owner ID.
4. **Decision 4 — Deletion & Trash**:
   - **30-day soft-delete Trash** remains the approved default.
   - Moving a folder or file to Trash immediately invalidates RAG retrieval within the same transaction (`WHERE deleted_at IS NULL`).
   - Recursive folder trashing marks all descendant folders and files with `deleted_at = now()`.
   - Child files retain their individual deletion timestamps and the 30-day retention countdown.
   - Restoration within 30 days re-enables searchability only after index validity verification (`user_file_verify_index_validity`).
   - If parent folder was permanently purged, restored files relocate safely to root (`parent_id = NULL`) with a user notice.
   - **"Empty Trash" / Immediate Hard Purge**: An explicit user action requiring a high-friction confirmation dialog, explicit warning that recovery is impossible, strict ownership check `user_id = (SELECT auth.uid())`, cascading DB deletion (`user_file_chunks`, `user_file_jobs`, OCR pages), and immediate quota reclamation.
5. **Decision 5 — File Preview, Formats & Citation Security**:
   - Allowlisted safe inline preview: PDF, JPEG, PNG, WebP, Plain Text, and Sanitized Markdown via short-lived (60s) signed URLs.
   - HTML, SVG, and binary executables are blocked from inline rendering and force attachment download with `nosniff` headers.
   - PDF-only AI indexing in v1.
   - **Private Citation Security**: Every private citation is revalidated at opening time via `document-file` for active ownership (`user_id = auth.uid()` and `deleted_at IS NULL`). Trashed files return 404. Signed download tokens expire in 60s. RAG invalidation is instantaneous; already-issued browser download URLs expire strictly within 60s. Internal storage paths are never transmitted in chat SSE or citations.
   - Central product functionality reference in [`docs/specs/private-file-manager-functionality.md`](private-file-manager-functionality.md).
