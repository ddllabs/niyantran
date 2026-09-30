-- Build the replica's search index after the load, with the same definition as NTER's
-- (supabase/migrations/20260929120000_halfvec_index.sql: default m and ef_construction).
-- A new build, so replica rankings are compared only with a replica baseline.
\set ON_ERROR_STOP on
set maintenance_work_mem = '1GB';
set statement_timeout = 0;
create index if not exists document_chunks_embedding_halfvec_hnsw
  on public.document_chunks
  using hnsw ((embedding::extensions.halfvec(1536)) extensions.halfvec_cosine_ops);
analyze public.documents;
analyze public.document_chunks;
