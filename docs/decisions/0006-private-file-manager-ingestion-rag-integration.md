# ADR 0006 (Amended): Private File Manager Ingestion & Dual-Source RAG Integration

> **Status: Normative.** Architectural Decision Record governing the integration of the
> Private File Manager with Niyantran’s existing ingestion orchestration and RAG retrieval infrastructure.
> Date: 2026-11-15.
> Cross-Reference: [Ingestion & RAG Compatibility Audit](../research/2026-11-15-ingestion-rag-compatibility-audit.md),
> [Private File Manager Spec](../specs/2026-11-14-private-file-manager.md).

---

## 1. Context

Users of Niyantran Terminal require durable personal file storage, folder organization, selective AI indexing, and the ability to query their personal documents alongside Niyantran’s research corpus.

The platform already possesses:
- An enterprise-grade, asynchronous ingestion engine (`supabase/functions/ingest-worker/`).
- Document processing, Mistral OCR page checkpointing, and OpenRouter text embeddings (`1536` dimensions).
- A research chat agent (`supabase/functions/research-chat/`) with vector similarity search, citation verification, and streaming responses.
- Contextual "✦ Ask AI" triggers across desk records (`NationalRecord.jsx`, `ElectoralRecords.jsx`, etc.) that route directly into `research-chat`.
- An established Supabase Auth and PostgreSQL Row Level Security (RLS) model.

The core architectural problem is how to provide personal file storage and AI indexing without:
1. Creating a duplicate ingestion pipeline or second embedding engine.
2. Contaminating the shared research corpus (`documents`, `document_chunks_partitioned`), which is intentionally readable by all authenticated users under `using (true)`.
3. Starving shared-corpus batch ingestion or legal feeds.
4. Leaking private document metadata, chunks, embeddings, or storage objects across users.

---

## 2. Existing Architecture

1. **Shared Corpus Persistence**:
   - `public.documents`: Stores global document metadata. Has no user or owner identifier.
   - `public.document_chunks_partitioned`: Partitioned by `desk_feature`. All authenticated users have unrestricted SELECT permissions.
   - Storage Bucket `corpus`: Stores global PDF files and extracted page images.
2. **Asynchronous Ingestion Worker**:
   - Leased queue architecture (`ingest_jobs`, `ingest_claim`, `ingest_advance`, `ingest_activate`).
   - Settings in `ingest_settings` (`max_running = 2`, `claim_batch = 1`).
   - Pure transformation libraries: `pageText.ts` (OCR composition), `chunking.ts` (deterministic chunking), and `embed.ts` (OpenRouter batch embedding).
3. **Research Chat & Desk Ask AI**:
   - Both interfaces share the single `research-chat` Edge Function.
   - `match_documents` searches `document_chunks_partitioned` via exact scan for scoped documents and HNSW for broad searches.
   - In-browser file drop extracts raw text up to 12,000 characters; it is unindexed, ephemeral, and non-citable.

---

## 3. Decision

We decide to:

1. **Confirm PDF-Only Indexing for v1**:
   - Storage accepts arbitrary file bytes. AI indexing in v1 is confirmed strictly for PDF files, which match the existing central page-aware pipeline. Other file types remain stored and downloadable with an unsupported status.
2. **Reuse Central Worker with Partitioned Concurrency**:
   - Personal file indexing jobs will be queued in a dedicated `public.user_file_jobs` table, claimed and processed by `ingest-worker`.
   - Concurrency is partitioned in `public.ingest_settings`:
     - `corpus_max_running = 2` (reserved for high-priority legal corpus batches and feeds).
     - `user_file_max_running = 2` (reserved for interactive personal file indexing).
     - `max_running_per_user = 1` (fair-share quota preventing any single user from monopolizing slots).
   - Ingestion jobs are serialized using the existing transaction advisory lock `4917230411` and 300s leases with random UUID claim tokens.
   - User file jobs fail faster: `max_attempts = 3` (vs. 6 for corpus) with rapid backoff (10s, 30s) and direct error reflection to `user_files.index_error`.
   - Embeddings and OCR costs are held pre-flight via `credit_holds` (`turn_key = 'index:' || file_id`) and settled to the user's paise credit ledger via `user_file_settle_credits`.
3. **Enforce Isolated Private Persistence**:
   - Private documents will **never** be inserted into `public.documents` or `public.document_chunks_partitioned`.
   - All private metadata, files, folders, chunks, and jobs will persist in a dedicated, owner-isolated relational schema:
     - `public.user_folders`
     - `public.user_files`
     - `public.user_file_chunks`
     - `public.user_file_jobs`
   - Every private table enforces `user_id = (SELECT auth.uid())` via PostgreSQL RLS.
   - Cross-tenant folder nesting is prevented at the database constraint layer using composite foreign keys `(parent_id, user_id) REFERENCES user_folders(id, user_id)`.
4. **Dedicate a Private Storage Bucket**:
   - Personal file binaries will be stored in a dedicated `user-files` bucket (`public: false`, 50 MB limit).
   - Storage paths will strictly follow `<user_id>/<file_id>/<filename>`.
   - Access will be enforced via Supabase Storage RLS: `(storage.foldername(name))[1] = (SELECT auth.uid()::text)`.
5. **Implement Dual-Source RAG Retrieval for Research AI & Ask AI**:
   - Create a dedicated `match_user_files` RPC running in `SECURITY INVOKER` mode against `user_file_chunks`.
   - Extend `_shared/retrieval.ts` to execute `match_documents` (shared corpus) and `match_user_files` (private files) in parallel according to the turn's requested retrieval scope.
   - Both dock Research AI and desk "✦ Ask AI" actions route through this dual-source pipeline.
   - Unify returned chunks into the standard `Chunk` interface tagged with `source_origin: 'shared' | 'private'`.
   - Preserve cryptographic citation verification (`sha256Hex(normalise(content))`) across both source origins.
6. **Zero Stale-Read Deletion Cascade**:
   - PostgreSQL `ON DELETE CASCADE` ensures that deleting a file immediately purges its chunks from `user_file_chunks` within the same database transaction, guaranteeing zero stale vector reads.
   - Storage deletion is decoupled: deletion RPC returns paths for immediate removal, backed by a daily background orphan sweeper.
   - The 30-day Trash soft-delete model remains pending user sign-off.
7. **Reject Tejas OS Data & Authorization Model**:
   - The Tejas OS Drive implementation in `sources/` relies on organization drives, shared tenant permissions, and tender workflows.
   - We port its visual UI components into `src/fileManager/` while connecting them exclusively to Niyantran’s native individual-user backend.

---

## 4. Ingestion Worker Scheduling & Starvation Prevention

```
                      Worker Loop (runOnce)
                                │
                 Acquires Lock 4917230411
                                │
                                ▼
           Check user_file_jobs (Pool Cap: 2, User Cap: 1)
                                │
             ┌──────────────────┴──────────────────┐
             ▼                                     ▼
     User Jobs Due?                        No User Jobs Due
             │                                     │
             ▼                                     ▼
   Claim User File Job                   Check ingest_jobs (Cap: 2)
   Set 300s lease & claim_token                    │
   Process Mistral OCR + Embeddings                ▼
   Commit to user_file_chunks            Claim Shared Corpus Job
   Settle credits via RPC                Process Legal Corpus Batch
```

---

## 5. Dual-Source RAG Retrieval Architecture

```
                       Research Turn / Ask AI
                                │
                                ▼
                   Resolve Authenticated User
                                │
                                ▼
                   Evaluate Retrieval Scope
              (e.g., Attached Private File + Corpus)
                                │
             ┌──────────────────┴──────────────────┐
             ▼                                     ▼
    Private Vector Search                Shared Corpus Search
    match_user_files                     match_documents
    Filter: user_id = (SELECT auth.uid()) Filter: desk_feature / desk_tier
    Source: user_file_chunks             Source: document_chunks_partitioned
             │                                     │
             └──────────────────┬──────────────────┘
                                ▼
                   Merge & Normalize Chunks
                   Tagged: source_origin
                                │
                                ▼
                   Deduplicate & Rank Chunks
                                │
                                ▼
                   Assign Verification Handles
                   Compute text_hash per chunk
                                │
                                ▼
                   Assemble Grounded Prompt
                                │
                                ▼
                   OpenRouter Stream Response
                                │
                                ▼
                   Apply Citation Ladder
                   (Numbered [1], [2] brackets)
                                │
                                ▼
                   Stream SSE to Frontend
           (Badged Private vs. Public Citations)
```

---

## 6. Product Decision Resolution & Architectural Baseline

1. **Decision 1 — Quota & Limits**:
   - Individual file upload limit: **50 MB** (Approved product limit).
   - `free` plan (formerly `explorer`): **500 MB** (Approved product limit).
   - `pro` plan (formerly `professional`): **5 GB** (Approved product limit).
   - `plus` plan: **2 GB** (**Proposed mapping — pending explicit product confirmation**).
   - `max` plan (formerly `enterprise`): **50 GB configurable** (**Proposed mapping — pending explicit product confirmation**).
   - Lapsed accounts evaluate dynamically via `my_entitlement()` to **500 MB** (Approved behavior).
   - Quotas are enforced server-side under concurrency locks; Trash files continue consuming quota; permanently deleted files release quota.
   - Outstanding verification requirement: Storage quota function and server-side upload check must be authored and verified in Task 2.
2. **Decision 2 — Retrieval Scope & Indexing Trigger**:
   - Default retrieval when private files are attached: (1) Attached private file(s) + (2) Shared Niyantran research corpus.
   - User can adjust scope to attached-only or corpus-only.
   - Web search is independently toggled and never silently enabled.
   - **Recommended v1 Indexing Behavior**: Upload and indexing are decoupled. Uploading a PDF does not automatically initiate indexing. The user initiates indexing using an explicit **"Index for AI"** action. Non-PDF formats remain storage-only in v1. Failed indexing can be retried. (Recommended decision pending final product confirmation).
3. **Decision 3 — AI Artifacts**:
   - User-owned `AI Artifacts` folder created lazily upon first save.
   - Artifacts save only via explicit user action ("Save to Files"), with target folder selection.
   - Preserves title, timestamp, conversation reference, artifact type, and owner ID.
4. **Decision 4 — Deletion & Trash**:
   - **30-day soft-delete Trash** remains the approved default.
   - Trashing a folder or file immediately invalidates RAG retrieval within the same transaction (`WHERE deleted_at IS NULL`).
   - Recursive folder trashing marks all descendant folders and files with `deleted_at = now()`.
   - Child files retain their individual deletion timestamps and the 30-day retention countdown.
   - Restoration within 30 days re-enables searchability after index verification (`user_file_verify_index_validity`).
   - If parent folder was permanently purged, restored files relocate safely to root (`parent_id = NULL`) with an informative user notice.
   - **"Empty Trash" / Immediate Hard Purge**: Documented as an explicit user action requiring high-friction confirmation, explicit warning of permanent data loss, ownership check `user_id = auth.uid()`, cascading DB deletion (`user_file_chunks`, `user_file_jobs`, OCR pages), and immediate storage quota reclamation.
5. **Decision 5 — File Preview, Formats & Citation Security**:
   - Allowlisted safe inline preview: PDF, JPEG, PNG, WebP, Plain Text, and Sanitized Markdown via short-lived (60s) signed URLs.
   - HTML, SVG, and binary executables are blocked from inline rendering and force attachment download with `nosniff` headers.
   - PDF-only AI indexing in v1.
   - **Private Citation Security**: Every private citation is revalidated at opening time via `document-file` for active ownership (`user_id = auth.uid()` and `deleted_at IS NULL`). Trashed files return 404. Signed download tokens expire strictly in 60s. RAG invalidation is instantaneous; already-issued browser download URLs expire strictly within 60s. Internal storage paths are never transmitted in chat SSE or citations.
   - Central product functionality reference in [private-file-manager-functionality.md](../specs/private-file-manager-functionality.md).
