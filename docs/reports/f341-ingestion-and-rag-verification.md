# F341 Ingestion Pipeline & RAG Retrieval Verification Report

> **Status: Normative Record**  
> **Feature:** F341 — Private File Manager & RAG Chat Retrieval  
> **Component:** Ingest Worker Pipeline, Mistral OCR, Vector Search & Research Chat  
> **Author:** Principal Engineer / AI Ingestion & Retrieval Specialist  
> **Target Production:** NTER Supabase (`vfgcppstyzjarlzyqdac`)  
> **Date:** 2026-11-18

---

## 1. Executive Summary

This report validates the end-to-end ingestion and retrieval pipeline for user-owned files, from PDF upload and OCR to semantic chunking, vector embedding, and real-time grounded context injection into `research-chat`.

---

## 2. Ingestion Pipeline Verification (`ingest-worker`)

The ingestion step handler in [supabase/functions/ingest-worker/user-file-step.ts](file:///c:/Users/Afreen/Downloads/niyantran-main%20(2)/niyantran-main/supabase/functions/ingest-worker/user-file-step.ts) executes three sequential phases:

```
[Uploaded PDF] 
     │
     ▼
Phase 1: Mistral OCR (Extract markdown & page structure)
     │
     ▼
Phase 2: Semantic Chunking (Sliding window token chunks with page provenance)
     │
     ▼
Phase 3: OpenRouter Embeddings (openai/text-embedding-3-small, 1536d)
     │
     ▼
[public.user_file_chunks] ──> [Authoritative Credit Settlement (PostgreSQL)]
```

### 2.1 Ingestion Verification Checks
- **Worker Lease Management:** Jobs are claimed atomically via `user_file_claim()` using row-level locking (`FOR UPDATE SKIP LOCKED`) with an expiring lease timeout (default: 10 minutes) to prevent duplicate processing.
- **Incremental Checkpointing:** `user_file_advance()` commits step progression. If a worker terminates mid-process, the lease expires and resumes from the last completed checkpoint.
- **Deduplication & Content Hashing:** Files are verified by SHA-256 hash. Re-indexing identical files without content modification is prevented.
- **Error & Failure Isolation:** Provider timeouts or malformed documents transition the job to `failed` and invoke `user_file_settle_credits()` to release unused reservation holds.

---

## 3. RAG Retrieval & Context Augmentation (`research-chat`)

In `supabase/functions/research-chat/retrieval.ts`:
1. When a user asks a query in chat and has attached private files (or when file-scoped retrieval is enabled), `match_user_files` is executed.
2. **Vector Similarity Function:**
   ```sql
   CREATE OR REPLACE FUNCTION public.match_user_files(
     p_embedding vector(1536),
     p_match_count integer DEFAULT 5,
     p_file_ids uuid[] DEFAULT NULL
   )
   RETURNS TABLE (
     id uuid,
     file_id uuid,
     chunk_index integer,
     content text,
     page_number integer,
     similarity double precision
   ) ...
   ```
3. **Prompt Injection & Grounding:**
   Retrieved chunks are formatted with explicit file and page citations:
   ```markdown
   [Context from User File: "Q3-Report.pdf", Page 4]:
   "Revenue increased by 14.2% quarter-over-quarter..."
   ```
4. **Citation Overlay Support:** The chat UI's `CitationOverlay` and `WebSourceStrip` components recognize user file sources and provide inline page preview popovers.

---

## 4. Test Evidence & Suite Results

- **Ingestion Worker Test Suite:**
  - Command: `deno test -A --config supabase/functions/deno.json supabase/functions/ingest-worker`
  - Result: **167 passed, 0 failed**.
- **Research Chat Retrieval Suite:**
  - Command: `deno test -A --config supabase/functions/deno.json supabase/functions/research-chat`
  - Result: **822 passed, 0 failed**.
- **Shared Utilities Test Suite:**
  - Command: `deno test -A --config supabase/functions/deno.json supabase/functions/_shared`
  - Result: **373 passed, 0 failed**.
