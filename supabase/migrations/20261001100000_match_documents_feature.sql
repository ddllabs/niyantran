-- retrieval-scope (T8): match_documents gains p_desk_feature, so desk focus on
-- a module with documents searches only that module's documents; and
-- document_modules() lists the (desk_tier, desk_feature) pairs that have
-- indexed documents. Spec: docs/specs/2026-09-30-rag-v2-retrieval-scope.md
-- ("SQL: migration", "Deploy order and compatibility").
--
-- The feature branch is the measured hybrid X
-- (docs/research/2026-10-01-feature-filter-measurements.md, "Decision"):
--   * the feature (with its tier, when given) holds at most T = 15,000 indexed,
--     embedded chunks -> an exact scan of those chunks, ordered by
--     full-precision distance, no per-document quota (candidate E);
--   * more than T -> the HNSW helper match_documents_feature_hnsw, whose
--     SET clause gives hnsw.ef_search = N = 400 for that call only, filtered
--     after the index scan (candidate H400).
-- On the 2026-09-30 replica X matched exact search's quality (171/184, the
-- full match_count every time) at p95 213 ms, and kept broad search's p95
-- within the bar while four Bills calls ran. Exact alone failed that
-- concurrency check (Bills is 78% of the corpus); the index alone returned
-- 0-37 of 40 rows for a 2% feature at ef_search 100. Bills (42,025 chunks)
-- takes the index path; Regulatory (11,040) and the smaller modules take the
-- exact path. T and N are tuned to that corpus: revisit them with the eval
-- harness when the corpus grows, because the index path under-returns when a
-- feature above T is a small share of a much larger corpus.
--
-- The other two branches are copied byte for byte from 20260929120100:
--   * ids given -> the scoped branch (exact, per-document quota);
--     p_desk_feature is ignored, because confinement outranks any filter;
--   * no ids and no feature -> the unscoped branch (the half-precision HNSW
--     index at the default ef_search).
-- The return columns, security invoker, stable and search_path are unchanged.
-- create function grants EXECUTE to PUBLIC, so every new function is revoked
-- from public and anon and granted to authenticated and service_role.
-- The helper sets hnsw.ef_search with set_config(..., true) and restores it
-- before returning, so the setting never outlives the call (see its comment).
--
-- Deploy order:
--   1. This migration. The research-chat already deployed keeps working:
--      it never names p_desk_feature, and PostgREST fills the default. It does
--      not call document_modules() either. (Supabase reloads PostgREST's
--      schema cache on DDL; if a call reports the function missing, run
--      notify pgrst, 'reload schema'.)
--   2. research-chat (T9a/T9b), which calls document_modules() and sends
--      p_desk_feature only when it has a feature scope, never null.
--   3. The frontend.
--
-- Down, in reverse: roll back the frontend, then research-chat to a build
-- that never sends p_desk_feature and never calls document_modules(), then,
-- from the repository root:
--
--   begin;
--   drop function public.match_documents(extensions.vector, int, uuid[], text, text);
--   drop function public.match_documents_feature_hnsw(extensions.vector, int, text, text);
--   \i supabase/migrations/20260929120100_match_documents_halfvec.sql
--   drop function public.document_modules();
--   commit;
--
-- The \i recreates the 20260929120100 definition exactly, with its revoke
-- and grant (outside psql, run that file's create, revoke and grant
-- statements); its trailing drop index if exists is already a no-op. Then
-- check that exactly one match_documents overload exists.

-- The large-feature path. Filtering after the index scan is correct only
-- while the feature is a large share of the corpus: with N = 400 the scan
-- yields up to 400 nearest chunks before the feature filter. Measured: the
-- research doc above.
--
-- N is applied with set_config(..., true) and restored before returning,
-- rather than with a SET clause. NTER refused the SET clause on 2026-10-01
-- ("permission denied to set parameter hnsw.ef_search"): until pgvector's
-- library is loaded in a session, hnsw.ef_search is a placeholder, and only
-- a superuser may attach a placeholder to a function. set_config is allowed
-- for any role (verified as authenticated on NTER). RETURN QUERY runs the
-- query to completion before the next statement, so restoring the old value
-- afterwards means nothing outlives the call.
create function public.match_documents_feature_hnsw(
  query_embedding extensions.vector(1536),
  match_count     int,
  p_desk_tier     text,
  p_desk_feature  text
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
  c_ef_search constant text := '400';
  v_previous  text := current_setting('hnsw.ef_search', true);
begin
  perform set_config('hnsw.ef_search', c_ef_search, true);
  return query
    select c.id, c.document_id, c.content,
           (1 - (c.embedding <=> query_embedding))::float8,
           c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
           d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature
      from public.document_chunks c
      join public.documents d on d.id = c.document_id
     where c.embedding is not null
       and d.indexed_at is not null
       and d.desk_feature = p_desk_feature
       and (p_desk_tier is null or d.desk_tier = p_desk_tier)
     order by (c.embedding::extensions.halfvec(1536)) <=> (query_embedding::extensions.halfvec(1536))
     limit least(greatest(coalesce(match_count, 40), 1), 200);
  -- Restore what the caller had ('' when the setting did not exist yet reads
  -- back as the default, 40, once the library is loaded).
  perform set_config('hnsw.ef_search', coalesce(nullif(v_previous, ''), '40'), true);
end
$fn$;

revoke all on function public.match_documents_feature_hnsw(extensions.vector, int, text, text) from public, anon;
grant execute on function public.match_documents_feature_hnsw(extensions.vector, int, text, text) to authenticated, service_role;

drop function public.match_documents(extensions.vector, int, uuid[], text);

create function public.match_documents(
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
  -- T: at most this many indexed, embedded chunks in the feature -> exact scan;
  -- more -> match_documents_feature_hnsw (N = 400 in its SET clause).
  -- Chosen in docs/research/2026-10-01-feature-filter-measurements.md.
  c_exact_max_chunks constant int := 15000;
  v_chunks int;
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
  elsif p_desk_feature is null then
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
               d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature
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

-- The modules that have indexed documents, one row per (tier, feature). It
-- replaces research-chat's read of one desk_feature per document, which
-- PostgREST's max_rows (1,000) cut short of the corpus's 2,338 documents.
create function public.document_modules()
returns table (desk_tier text, desk_feature text)
language sql
stable
security invoker
set search_path = public
as $fn$
  select distinct d.desk_tier, d.desk_feature
    from public.documents d
   where d.indexed_at is not null
     and d.desk_feature is not null
   order by 1, 2;
$fn$;

revoke all on function public.document_modules() from public, anon;
grant execute on function public.document_modules() to authenticated, service_role;
