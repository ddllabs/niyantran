-- Hybrid (keyword + vector) search over document chunks (F278 step 4, plan
-- docs/plans/2026-11-02-phase-c-hybrid-and-registration.md task C1; spec
-- docs/specs/2026-11-01-bulk-ingestion.md §4.2). Not on production. Additive: match_documents and
-- match_documents_feature_hnsw are unchanged, the app does not call the new function yet, and the
-- app switches only after the eval passes.
--
-- Orders after 20261101120000_document_chunks_partitioned. It does not touch that migration and does
-- not depend on its partitions: the index is created on the parent, so every partition that exists
-- has its own, and a partition created or attached later gets one too.
--
-- What it adds.
--
--   * document_chunks_content_tsv: a GIN index on the expression
--       to_tsvector('simple'::regconfig, content)
--     No stored column, so no table rewrite. The text configuration was chosen by measurement
--     (docs/research/2026-11-02-hybrid-search.md). Hindi and other scripts are tokenised by the
--     default parser, not stemmed; pgroonga stays the candidate if the eval shows built-in search
--     failing on Hindi documents (spec §4.2).
--
--   * match_documents_hybrid(query_embedding, query_text, match_count, p_document_ids, p_desk_tier,
--     p_desk_feature): same scope parameters and same result columns as match_documents.
--       vector side   match_documents itself, for the 100 nearest chunks (c_candidates): its access
--                     rules and its exact or approximate paths are used, not copied.
--       keyword side  websearch_to_tsquery over the same scope (document ids win over a feature, as in
--                     match_documents; tier on the document), the matches ranked by ts_rank_cd, ties by
--                     id. ts_rank_cd cannot use the index, so a common word could match most of the
--                     table: at most c_keyword_cap matches are ranked, and the 100 best are kept.
--       fusion        reciprocal rank fusion, score = 1/(60 + vector rank) + 1/(60 + keyword rank),
--                     ties broken by vector rank, keyword rank, then chunk id. match_count rows
--                     (clamped to 1..200 like match_documents), best first.
--     `similarity` stays the chunk's cosine similarity to the query vector, not the fused score, so
--     it keeps its meaning; the rows are in fused order, not similarity order.
--     No usable query text (null, empty, or no lexemes once parsed: only stop words or punctuation)
--     returns exactly match_documents' rows.
--
--   * Security is match_documents': security invoker, so RLS and the restrictive law policies apply
--     to the chunks and documents both sides read; the access check is never used to scope. Fixed
--     search_path, stable, executable by authenticated and service_role only.
--
-- Cost of the index. Built on every partition with a share lock: reads continue, writes to that
-- partition wait for its build. Measured on a copy of the retrieval replica: see the research note.
--
-- Rollback (nothing else depends on either object):
--   drop function public.match_documents_hybrid(extensions.vector, text, int, uuid[], text, text);
--   drop index public.document_chunks_content_tsv;

begin;

create index document_chunks_content_tsv on public.document_chunks
  using gin (to_tsvector('simple'::regconfig, content));

create function public.match_documents_hybrid(
  query_embedding extensions.vector(1536),
  query_text      text,
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
#variable_conflict use_column
declare
  -- Candidates taken from each side before fusion. Ranks beyond about 50 add under 1% of a top score
  -- (1/110 against 1/61), so 100 loses nothing a 40-row answer could show.
  c_candidates constant int := 100;
  -- Keyword matches ranked before the best c_candidates are kept (see the header).
  c_keyword_cap constant int := 2000;
  -- The reciprocal rank fusion constant of Cormack, Clarke and Buettcher (2009), which the Supabase
  -- hybrid search recipe also uses.
  c_rrf_k constant int := 60;
  v_limit  int := least(greatest(coalesce(match_count, 40), 1), 200);
  v_scoped boolean := coalesce(array_length(p_document_ids, 1), 0) > 0;
  v_query  tsquery;
begin
  if nullif(btrim(coalesce(query_text, '')), '') is not null then
    v_query := websearch_to_tsquery('simple'::regconfig, query_text);
  end if;
  if v_query is null or numnode(v_query) = 0 then
    return query select * from public.match_documents(query_embedding, v_limit, p_document_ids, p_desk_tier, p_desk_feature);
    return;
  end if;

  return query
    with vec as (
      select m.id, m.ordinality as rn
        from public.match_documents(query_embedding, c_candidates, p_document_ids, p_desk_tier, p_desk_feature) with ordinality m
    ),
    hits as (
      select k.id, row_number() over (order by k.rank desc, k.id) as rn
        from (select c.id, ts_rank_cd(to_tsvector('simple'::regconfig, c.content), v_query) as rank
                from public.document_chunks c
                join public.documents d on d.id = c.document_id
               where to_tsvector('simple'::regconfig, c.content) @@ v_query
                 and c.embedding is not null
                 and d.indexed_at is not null
                 and (not v_scoped or c.document_id = any (p_document_ids))
                 and (v_scoped or p_desk_feature is null or c.desk_feature = p_desk_feature)
                 and (p_desk_tier is null or d.desk_tier = p_desk_tier)
               limit c_keyword_cap) k
       order by k.rank desc, k.id
       limit c_candidates
    ),
    fused as (
      select coalesce(v.id, h.id) as id, v.rn as vr, h.rn as kr,
             coalesce(1.0 / (c_rrf_k + v.rn), 0) + coalesce(1.0 / (c_rrf_k + h.rn), 0) as score
        from vec v full join hits h on h.id = v.id
       order by 4 desc, v.rn nulls last, h.rn nulls last, 1
       limit v_limit
    )
    select c.id, c.document_id, c.content,
           (1 - (c.embedding <=> query_embedding))::float8,
           c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
           d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature,
           c.block_ids, c.image_ids, c.metadata->'section'
      from fused f
      join public.document_chunks c on c.id = f.id
      join public.documents d on d.id = c.document_id
     order by f.score desc, f.vr nulls last, f.kr nulls last, f.id;
end
$fn$;

revoke all on function public.match_documents_hybrid(extensions.vector, text, int, uuid[], text, text) from public, anon;
grant execute on function public.match_documents_hybrid(extensions.vector, text, int, uuid[], text, text) to authenticated, service_role;

commit;
