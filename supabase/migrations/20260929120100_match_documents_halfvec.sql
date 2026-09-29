-- F22, step 2: unscoped retrieval uses the half-precision index; the
-- full-precision index is dropped (docs/plans/open-work.md;
-- plans/2026-09-29-corpus-ingestion.md, "The gate").
--
-- Measured on NTER on 2026-09-29, after step 1 built
-- document_chunks_embedding_halfvec_hnsw (204 MB, against 404 MB for the
-- full-precision index). 20 sample queries (chunk embeddings chosen by
-- md5(id)), top 40 each, against an exact scan of all 54,219 chunks:
--
--     index            recall@40 mean   worst    mean latency
--     full precision   0.990            0.950    224 ms
--     half precision   0.9875           0.925    161 ms
--     exact scan       1.000            1.000    782 ms
--
-- The difference in recall is one chunk in 400; the index is half the size,
-- so phase A of the corpus ingestion fits shared_buffers (512 MB).
--
-- Only the unscoped branch changes. The scoped branch (attached documents)
-- never used HNSW and is copied unchanged from 20260922104646. The similarity
-- returned is still full precision. Signature, return type, security invoker,
-- search_path and grants are unchanged.
--
-- Down (manual): recreate document_chunks_embedding_hnsw
--   (hnsw (embedding extensions.vector_cosine_ops)) and restore the function
--   body from 20260922104646_match_documents_prefilter_and_quota.sql.

create or replace function public.match_documents(
  query_embedding extensions.vector(1536),
  match_count     int    default 40,
  p_document_ids  uuid[] default null,
  p_desk_tier     text   default null
) returns table (
  id            uuid,
  document_id   uuid,
  content       text,
  similarity    float8,
  chunk_index   int,
  source_kind   text,
  page_number   int,
  char_from     int,
  char_to       int,
  title         text,
  file_name     text,
  file_url      text,
  desk_tier     text,
  desk_feature  text
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $fn$
declare
  v_limit int := least(greatest(coalesce(match_count, 40), 1), 200);
  v_docs  int := coalesce(array_length(p_document_ids, 1), 0);
  v_quota int;
begin
  if v_docs > 0 then
    -- Scoped. The predicate on document_id is unconditional here, so the planner
    -- pre-filters with document_chunks_document_order and scores only that
    -- document's rows. HNSW is deliberately unused: over 23-915 rows an exact
    -- scan is both faster and, unlike an approximate index, complete.
    v_quota := greatest(ceil(v_limit::numeric / v_docs)::int, 1);
    return query
      with scoped as (
        select c.id, c.document_id, c.content, c.chunk_index, c.source_kind,
               c.page_number, c.char_from, c.char_to,
               (c.embedding <=> query_embedding) as dist,
               row_number() over (partition by c.document_id
                                  order by c.embedding <=> query_embedding) as rn
          from public.document_chunks c
         where c.document_id = any (p_document_ids)
           and c.embedding is not null
      )
      -- documents is joined after ranking, against the quota'd handful of rows,
      -- so indexed_at costs a primary-key probe instead of hashing every document.
      select s.id, s.document_id, s.content, (1 - s.dist)::float8,
             s.chunk_index, s.source_kind, s.page_number, s.char_from, s.char_to,
             d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature
        from scoped s
        join public.documents d on d.id = s.document_id
       where s.rn <= v_quota
         and d.indexed_at is not null
         and (p_desk_tier is null or d.desk_tier = p_desk_tier)
       order by s.dist
       limit v_limit;
  else
    -- Unscoped: ranked on the half-precision HNSW index
    -- (document_chunks_embedding_halfvec_hnsw); the similarity returned is
    -- still computed at full precision for the rows kept.
    return query
      select c.id, c.document_id, c.content,
             (1 - (c.embedding <=> query_embedding))::float8,
             c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
             d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature
        from public.document_chunks c
        join public.documents d on d.id = c.document_id
       where c.embedding is not null
         and d.indexed_at is not null
         and (p_desk_tier is null or d.desk_tier = p_desk_tier)
       order by (c.embedding::extensions.halfvec(1536)) <=> (query_embedding::extensions.halfvec(1536))
       limit v_limit;
  end if;
end
$fn$;

revoke all on function public.match_documents(extensions.vector, int, uuid[], text) from public, anon;
grant execute on function public.match_documents(extensions.vector, int, uuid[], text) to authenticated, service_role;

drop index if exists public.document_chunks_embedding_hnsw;
