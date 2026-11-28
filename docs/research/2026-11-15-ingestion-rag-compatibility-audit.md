# Research Audit: Ingestion & RAG Compatibility for Niyantran Private File Manager

> **Status: Living.** Comprehensive pre-implementation architecture and compatibility audit conducted on 2026-11-15.
> Verified against local repository checkouts, Supabase Edge Functions, PostgreSQL migrations, and RAG retrieval pipelines.
> Author: Supervising Architect & Multi-Agent Audit Team.

---

## 1. Executive Summary

This audit evaluates the architectural and cryptographic compatibility of integrating a personal, owner-isolated **Private File Manager** into Niyantran Terminal’s existing AI and document processing platform.

### Core Audit Findings
1. **Zero-Duplication Feasibility**: Niyantran's existing ingestion pipeline (`supabase/functions/ingest-worker/`, `_shared/pageText.ts`, `_shared/chunking.ts`, `_shared/embed.ts`, and Mistral OCR) is cleanly architected around deterministic in-memory transformation functions and abstract persistence ports. **It can be 100% reused for private files without building a second ingestion engine.**
2. **Persistence Isolation Necessity**: The existing shared corpus tables (`public.documents`, `public.document_chunks_partitioned`) use permissive RLS policies (`using (true)`) designed for public research. Storing personal files in these tables would cause immediate cross-tenant data leakage. Private files require a dedicated, owner-isolated schema (`public.user_files`, `public.user_folders`, `public.user_file_chunks`, `public.user_file_jobs`).
3. **Dual-Source RAG Extension**: Niyantran’s `research-chat` Edge Function and `_shared/retrieval.ts` can be extended with a parallel retrieval adapter (`match_user_files`) running alongside `match_documents`. Results are merged into the unified `Chunk` pipeline with cryptographic `text_hash` verification, preserving existing citation ladders while clearly distinguishing private file sources from public desk records.
4. **Unified Ask AI & Research AI Backend**: "✦ Ask AI" buttons across desk records and the dock `AiPanel.jsx` both route to `research-chat`. There is no separate "Ask AI" conversational backend. Both interfaces will seamlessly use the exact same dual-source retrieval adapter.
5. **Tejas OS Model Incompatibility**: The reference implementation in `sources/` relies on organization drives (`organisation_id`), tenant-wide member RLS, and tender-specific workflows. Niyantran has deliberately disabled organization provisioning (`public.create_organisation` throws `42501`) and operates on an individual-user model (`(SELECT auth.uid())`). Tejas’s UI patterns will be ported, but its data model and RLS are completely rejected.

---

## 2. Ingestion Orchestration Compatibility (Answers to Mandatory Inquiries Q1–Q6)

### Q1. Can the existing ingestion orchestrator accept a new source?
**Yes, for core processing and execution steps, but No for the registration and entry-point API without an owner-scoped registration adapter.**
- **Existing Implementation**:
  - `admin-ingest` (`supabase/functions/admin-ingest/handler.ts:1031–1040`) guards all uploads with `isAdmin(caller.token)`. Regular users cannot invoke `admin-ingest`.
  - Ingestion steps in `ingest-worker/ocr.ts` (`ocrStep`) and `ingest-worker/index-step.ts` (`indexStep`, `runIndexPlan`) are decoupled from caller identity; they operate on a generic `IngestJob` claiming work by `job_id`.
  - `ingest-worker/index.ts:300–304` already demonstrates input-source polymorphism via `job.input_kind === 'supplied_text' ? suppliedTextStep(...) : indexStep(...)`.
- **Required Changes**:
  - Implement a dedicated user file registration RPC (`user_file_enqueue_indexing`) that validates `auth.uid() = user_id`, places a pre-flight credit hold, and enqueues a job in `user_file_jobs`.
  - Update `ingest-worker` loop in `handler.ts` to claim from `user_file_jobs` alongside `ingest_jobs`.

### Q2. Can processing be separated from persistence?
**Yes. Pure mathematical/algorithmic processing is already decoupled from database writes.**
- **Evidence in Source Code**:
  - Composition: `composeDocument` and `locateBlocks` in `supabase/functions/_shared/pageText.ts` (lines 76–91) operate purely on raw OCR JSON in memory.
  - Chunking: `chunkPages` in `supabase/functions/_shared/chunking.ts` (lines 80, 300–326) transforms `ComposedDocument` into `PageChunkRow[]` with deterministic hashes and zero database I/O.
  - Planning: `planIndex` in `supabase/functions/ingest-worker/index-step.ts` (lines 60–123) is an in-memory function explicitly designed to run without I/O.
  - Embeddings: `embedTexts` in `supabase/functions/_shared/embed.ts` (lines 67–83) sends batched texts to OpenRouter and returns vector arrays in memory.
- **Persistence Decoupling**:
  - In `ingest-worker/types.ts` (`IngestDb`, lines 312–346), persistence is an interface (`upsertPages`, `chunkCommit`, `activate`).
  - Swapping the destination to `user_file_chunks` requires only a persistence adapter implementing the same signature.

### Q3. Does the worker currently assume all documents belong to the global corpus?
**Yes. The global corpus assumes universal authenticated readability.**
- **Evidence in Code & Migrations**:
  - `public.documents` has no `owner_id` or `user_id` column (`supabase/migrations/20260921000003_corpus_and_desk.sql:10–25`).
  - RLS policies on `documents`, `document_chunks`, and `document_files` are set to `using (true)` (`20260921000003_corpus_and_desk.sql:71–72`).
  - `document_chunks` is partitioned strictly by `desk_feature` (`20261101120000_document_chunks_partitioned.sql:43`).
- **Minimum Architectural Extension**:
  - Maintain private content in `public.user_files` and `public.user_file_chunks`.
  - Enforce `user_id = (SELECT auth.uid())` via PostgreSQL RLS.
  - Never route personal files into `public.documents` or `public.document_chunks`.

### Q4. Can the pipeline support selective indexing?
**Yes, natively.**
- **Evidence**:
  - In `admin-ingest/handler.ts:455–550`, files are prepared and verified in Supabase Storage before registration.
  - A stored file without an `indexed_at` timestamp is completely ignored by search RPCs (`match_documents:880`).
- **Workflow**:
  - Uploading a file inserts a record into `user_files` with `index_status = 'not_indexed'` and `indexed_at = null`.
  - An explicit user action ("Index for AI") calls `user_file_enqueue_indexing(file_id)`, inserting a record into `user_file_jobs`.
  - The central worker claims and processes it asynchronously.

### Q5. Can existing retry, lease, and checkpoint mechanisms be reused?
**Yes, 100% reusable.**
- **Leasing & Fencing**: `ingest_claim` and `ingest_advance` (`20261001140000_ingestion_v2.sql:392–455`) use transaction advisory lock `4917230411`, claim tokens (`uuid`), and 300s leases with strict fencing tokens (`line 488–490`).
- **OCR Checkpointing**: `ingest-worker/ocr.ts:53–73` (`nextRange`) checks `document_ocr_pages` on every claim and resumes processing from the exact missing page.
- **Slice Checkpointing**: `ingest-worker/index-step.ts:271–286` compares `storedEmbed.get(chunk_hash)` and skips already-embedded slices in OpenRouter calls.
- **Independent User File Retries**: For interactive user files, retry limits are tightened to `max_attempts = 3` (vs. 6 for corpus) with shorter backoff (10s, 30s) and immediate reflection to `user_files.index_error`.

### Q6. What happens during deletion or replacement?
**PostgreSQL Foreign Key cascades (`ON DELETE CASCADE`) provide atomic, zero-latency invalidation of all chunks, embeddings, OCR text, and job rows.**
- **Database Cascade**:
  - Deleting a row from `user_files` cascades immediately to `user_file_chunks`, `user_file_jobs`, and derived metadata.
  - Because vector search RPCs join against `user_files`, the file and its chunks become invisible to search instantly in the same transaction (zero stale-read window).
- **Active Job Cancellation**:
  - If a file is deleted while the worker is actively running, `user_file_jobs` is deleted by cascade. When the worker calls `user_file_advance` with its `claim_token`, the target job ID no longer exists and halts without committing orphaned records.
- **Storage Cleanup**:
  - Storage paths are returned by the deletion RPC for immediate client removal (`storage.from('user-files').remove([storage_path])`), supplemented by a daily orphan sweeper cron.

---

## 3. Ingestion Worker Scheduling, Fairness & Cost Accounting

### 3.1 Concurrency Partitioning (`ingest_settings`)
To protect against shared-corpus starvation and prevent a single user from saturating worker slots:
- Extend `public.ingest_settings` with:
  - `corpus_max_running = 2` (reserved for high-priority corpus batches and legal feeds)
  - `user_file_max_running = 2` (reserved for personal file indexing)
  - `max_running_per_user = 1` (fair-share quota preventing single-user monopolization)
- Total global concurrency: `corpus_max_running + user_file_max_running` ($2 + 2 = 4$).

### 3.2 Claim Ordering & Starvation Prevention
- `user_file_claim` prioritizes interactive user jobs within their dedicated pool, skipping users who already have an active running job.
- When no user files are queued, 100% of background capacity remains dedicated to the shared legal corpus.

### 3.3 Credit Accounting & Telemetry
1. **Pre-flight Hold**: `user_file_enqueue_indexing` verifies wallet balance and creates a hold in `credit_holds` with `turn_key = 'index:' || file_id`.
2. **Attributed Telemetry**: Worker logs OpenRouter embedding tokens and Mistral OCR costs in `model_call_logs` attributed to `user_id = job.user_id` and `raw_usage.job_id`.
3. **Settlement**: Upon job completion or terminal failure, RPC `user_file_settle_credits(job_id)` aggregates call logs, converts USD to paise credits (1 credit = 0.01 INR), debits `credit_wallets`, and records an entry in `credit_ledger`.

---

## 4. Ask AI vs. Research AI Compatibility Audit

### 4.1 Implementation Reality
- In Niyantran Terminal, "✦ Ask AI" on desk records (`NationalRecord.jsx`, `ElectoralRecords.jsx`, `ChokepointsDesk.jsx`) and "Research AI" in `AiPanel.jsx` **use the exact same conversational engine**.
- Desk buttons dispatch `window.dispatchEvent(new CustomEvent('niy-ai-open', { detail }))`, opening `AiPanel.jsx` in the dock with a pre-seeded record chip and setting focus to `'attached'`. All turns execute against `POST /functions/v1/research-chat`.
- The only other desk endpoint, `desk-brief`, is a passive, non-conversational background card summary.
- The Tejas OS `ask-ai` function in `sources/` is an enterprise ReAct agent coupled to tender tables and will NOT be ported.

### 4.2 Dual-Source Adapter Integration
- Both Ask AI and Research AI will consume the new `match_user_files` RPC via `_shared/retrieval.ts`.
- File Manager rows will feature a "✦ Ask AI" context action dispatching `openAiResearch({ privateFile: { id, name } })`.
- `AiPanel.jsx` will attach private files as chips (`kind: 'private_file'`) and pass `private_file_ids` to `research-chat`.
- Inline citations in `CitationBubble.jsx` and `PageViewer.jsx` will detect `source_origin === 'private'` and request signed URLs from the `user-files` bucket.

---

## 5. Deletion, Invalidation & Cleanup Lifecycles

### 5.1 Zero Stale-Read Window
Because RAG vector search queries `user_file_chunks`, PostgreSQL's `ON DELETE CASCADE` ensures that deleting a file immediately purges its chunks from the vector index within the same database transaction. No stale chunks can ever be returned to subsequent turns.

### 5.2 Trash Lifecycle (Soft-Delete) Analysis
- **Option A: Immediate Hard-Delete**: Simpler, zero retention, disk quota reclaimed instantly, zero sweeper overhead.
- **Option B: 30-Day Trash**: Accidental deletion recovery window, requires `deleted_at timestamptz`, recursive folder soft-delete RPC, Trash UI view, and daily purge cron. Soft-deleted files must count against user storage quota to prevent unmetered storage abuse.
- **Decision Status**: Formally approved as **Product Decision 4 (30-Day Trash)**. Detailed lifecycle specifications in `docs/specs/private-file-manager-functionality.md`.

---

## 6. Summary of Component Reuse vs. New Modules

| Component | Path | Status | Action |
| :--- | :--- | :--- | :--- |
| `_shared/pageText.ts` | `supabase/functions/_shared/pageText.ts` | Complete | **Reuse 100% as-is** |
| `_shared/chunking.ts` | `supabase/functions/_shared/chunking.ts` | Complete | **Reuse 100% as-is** |
| `_shared/embed.ts` | `supabase/functions/_shared/embed.ts` | Complete | **Reuse 100% as-is** (1536d) |
| `ingest-worker/ocr.ts` | `supabase/functions/ingest-worker/ocr.ts` | Complete | **Reuse 100% as-is** |
| `ingest-worker/index-step.ts`| `supabase/functions/ingest-worker/index-step.ts` | Complete | **Reuse 100% as-is** |
| `research-chat/agent.ts` | `supabase/functions/research-chat/agent.ts` | Complete | **Reuse 100% as-is** |
| `research-chat/sources.ts` | `supabase/functions/research-chat/sources.ts` | Complete | **Reuse citation ladder** |
| Database Schema | `supabase/migrations/` | Missing | **Add 4 isolated tables & bucket** |
| Worker Queue Adapter | `supabase/functions/ingest-worker/` | Missing | **Add `user-file-step.ts` & claim** |
| Dual-Source Retrieval | `_shared/retrieval.ts` | Partial | **Add `match_user_files` branch** |
| Frontend UI | `src/fileManager/` | Missing | **Port clean UI from `sources/`** |
