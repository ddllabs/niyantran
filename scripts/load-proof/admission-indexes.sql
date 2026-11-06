-- Test-only indexes for the F287 load, on the disposable proof database. Not a migration, and nothing here
-- is on NTER.
--
-- Superseded by 20261106120000_admission_scans.sql (F290). Kept as the record of what the F287 figures relied on:
-- do not apply it alongside that migration.
--
-- ingest_admit_document scans every national document (pq_answer_key over file_url) and every question row
-- (row->>'source_url') once per document admitted. On the full-size copy that is about 870 ms a document, so
-- a 100-document ingest_register_batch call passes corpus_ingest's 60 s limit. These indexes let the load
-- reach its target, and show whether indexing is enough to remove the cost. The admission code is unchanged.
--
-- Apply after the unindexed cost has been measured. They add under 0.1% to a chunk's bytes (a few hundred
-- bytes per document, across about 31 chunks), and are dropped before sizes are read.
create index concurrently if not exists lp_documents_answer_key
  on public.documents (public.pq_answer_key(file_url)) where desk_tier = 'national';
create index concurrently if not exists lp_documents_file_url
  on public.documents (file_url) where desk_tier = 'national';
create index concurrently if not exists lp_desk_rows_source_url
  on public.desk_rows ((row->>'source_url'))
  where tier = 'national' and feature = 'Parliamentary Question Database';
-- The index alone is ignored: with ORDER BY id LIMIT 1 and about 50 estimated matches, the planner walks the
-- primary key and runs the function on every row (1,120 ms). A cost hint steers it to the index without
-- changing what admission does. Rewriting the query as a UNION ALL gives the same plan (0.15 ms), and is the
-- better fix for the real migration.
alter function public.pq_answer_key(text) cost 100000;
-- The hint did not hold. On 2026-11-06 at 04:42 UTC an automatic analyze moved the row estimate, the planner went
-- back to the primary key, and a call that took 7 s passed 60 s. No index or cost makes this plan stable: the real
-- fix is the UNION ALL rewrite. To finish the load, this copy turns plain index scans off inside admission only.
alter function public.ingest_admit_document(jsonb, jsonb) set enable_indexscan = off;
analyze public.documents;
analyze public.desk_rows;
