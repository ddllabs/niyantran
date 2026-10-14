-- F35: the unscoped branch of match_documents searches the HNSW index with ef_search 200 instead of
-- the default 40, so whole-library search finds what exact search finds. Measured on the local
-- replica (docs/research/2026-10-15-unscoped-search-recall.md): the right document in the top 10 for
-- 170 of 184 questions (exact: 170; 40: 162), recall@40 0.991 (40: 0.920), about 2 ms more p50.
-- Only the unscoped branch changes; the function is otherwise the one in 20261001120000_page_contract
-- (same signature, security invoker, search_path and grants). Checked 2026-10-15: NTER's live body is
-- that file's, without some of its comments.
--
-- Down: re-run the match_documents block of 20261001120000_page_contract.sql with
-- "create or replace" (the unscoped branch without the two set_config lines).

create or replace function public.match_documents(
  query_embedding extensions.vector(1536),
  match_count     int    default 40,
  p_document_ids  uuid[] default null,
  p_desk_tier     text   default null,
  p_desk_feature  text   default null
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
  desk_feature  text,
  block_ids     uuid[],
  image_ids     uuid[],
  section       jsonb
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
  -- T: at most this many indexed, embedded chunks in the feature -> exact scan;
  -- more -> match_documents_feature_hnsw, which applies N = 400 to its own
  -- query and restores the caller's value (see its comment). Chosen in
  -- docs/research/2026-10-01-feature-filter-measurements.md.
  c_exact_max_chunks constant int := 15000;
  v_chunks int;
  -- F35: the unscoped search's HNSW candidate list. 200 finds the right document in the top 10 as
  -- often as exact search on the replica (170/184; the default 40 finds 162), at about 2 ms more p50.
  -- Above about 500 the planner turns to an exact scan. Measured:
  -- docs/research/2026-10-15-unscoped-search-recall.md.
  c_unscoped_ef_search constant text := '200';
  v_previous text;
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
               c.block_ids, c.image_ids, c.metadata->'section' as section,
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
             d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature,
             s.block_ids, s.image_ids, s.section
        from scoped s
        join public.documents d on d.id = s.document_id
       where s.rn <= v_quota
         and d.indexed_at is not null
         and (p_desk_tier is null or d.desk_tier = p_desk_tier)
       order by s.dist
       limit v_limit;
  elsif p_desk_feature is null then
    -- Unscoped: ranked on the half-precision HNSW index
    -- (document_chunks_embedding_halfvec_hnsw); the similarity returned is
    -- still computed at full precision for the rows kept. ef_search is set with
    -- set_config and restored afterwards, as in match_documents_feature_hnsw
    -- (NTER refuses a SET clause for it; see that function's comment).
    v_previous := current_setting('hnsw.ef_search', true);
    perform set_config('hnsw.ef_search', c_unscoped_ef_search, true);
    return query
      select c.id, c.document_id, c.content,
             (1 - (c.embedding <=> query_embedding))::float8,
             c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
             d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature,
             c.block_ids, c.image_ids, c.metadata->'section'
        from public.document_chunks c
        join public.documents d on d.id = c.document_id
       where c.embedding is not null
         and d.indexed_at is not null
         and (p_desk_tier is null or d.desk_tier = p_desk_tier)
       order by (c.embedding::extensions.halfvec(1536)) <=> (query_embedding::extensions.halfvec(1536))
       limit v_limit;
    perform set_config('hnsw.ef_search', coalesce(nullif(v_previous, ''), '40'), true);
  else
    -- Feature, no ids: hybrid X. Count the feature's chunks, stopping at T + 1:
    -- that decides the path without counting all of a large feature.
    select count(*) into v_chunks
      from (select 1
              from public.document_chunks c
              join public.documents d on d.id = c.document_id
             where c.embedding is not null
               and d.indexed_at is not null
               and d.desk_feature = p_desk_feature
               and (p_desk_tier is null or d.desk_tier = p_desk_tier)
             limit c_exact_max_chunks + 1) f;
    if v_chunks <= c_exact_max_chunks then
      -- Exact: full-precision distance, which no index serves, so every chunk
      -- of the feature is scored and the full match_count comes back whenever
      -- the feature holds that many. No per-document quota.
      return query
        select c.id, c.document_id, c.content,
               (1 - (c.embedding <=> query_embedding))::float8,
               c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
               d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature,
               c.block_ids, c.image_ids, c.metadata->'section'
          from public.document_chunks c
          join public.documents d on d.id = c.document_id
         where c.embedding is not null
           and d.indexed_at is not null
           and d.desk_feature = p_desk_feature
           and (p_desk_tier is null or d.desk_tier = p_desk_tier)
         order by c.embedding <=> query_embedding
         limit v_limit;
    else
      return query
        select * from public.match_documents_feature_hnsw(query_embedding, v_limit, p_desk_tier, p_desk_feature);
    end if;
  end if;
end
$fn$;

revoke all on function public.match_documents(extensions.vector, int, uuid[], text, text) from public, anon;
grant execute on function public.match_documents(extensions.vector, int, uuid[], text, text) to authenticated, service_role;
