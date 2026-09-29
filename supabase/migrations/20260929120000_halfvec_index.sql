-- F22, step 1: a half-precision HNSW index beside the full-precision one
-- (docs/plans/open-work.md; plans/2026-09-29-corpus-ingestion.md, "The gate").
--
-- The HNSW index should fit in shared_buffers. On 2026-09-29 it was 404 MB
-- against 512 MB, and phase A of the corpus ingestion takes it to about 1 GB.
-- An expression index on embedding::halfvec(1536) stores each vector in 2 bytes
-- per dimension instead of 4, so it is roughly half the size. The table is not
-- rewritten and the stored embeddings stay full precision.
--
-- This step only builds the index; match_documents is unchanged, so no query
-- uses it yet. Step 2 (20260929120100) measures recall against exact search,
-- moves the unscoped branch onto it, and drops the old index.
--
-- The build takes a SHARE lock on document_chunks (reads continue, writes
-- wait) for a few minutes; nothing writes chunks outside an ingest run. The
-- limits below apply to this transaction only.

set local statement_timeout = '20min';
set local maintenance_work_mem = '256MB';

create index if not exists document_chunks_embedding_halfvec_hnsw
  on public.document_chunks
  using hnsw ((embedding::extensions.halfvec(1536)) extensions.halfvec_cosine_ops);
