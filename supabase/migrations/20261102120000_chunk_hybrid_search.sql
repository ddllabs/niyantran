-- Hybrid (keyword + vector) search over NCLT chunks (F278 step 4, plan
-- docs/plans/2026-11-02-phase-c-hybrid-and-registration.md task C1; spec
-- docs/specs/2026-11-01-bulk-ingestion.md §4.2). Not on production. Additive: match_documents and
-- match_documents_feature_hnsw are unchanged and the app does not call the new function yet.
--
-- Decisions (developer, 2026-11-03), from the measurements in docs/research/2026-11-02-hybrid-search.md:
--   * Keyword search applies to the NCLT feature only. Every other scope (unscoped, a tier alone, any
--     other feature, document ids, an NCLT search that names document ids) returns exactly what
--     match_documents returns, because the keyword rules regressed those features in the eval.
--   * The keyword side searches only the question's rare words: a word counts when it is in at most 300
--     chunks of the table (about 0.08%); the rare words are OR'd; matches are ranked by ts_rank_cd; reciprocal
--     rank fusion, weight 1, k = 60, with the 100 vector rows of match_documents. A strict AND of every word
--     of a sentence matches nothing; an OR of every word is dominated by common words (both measured).
--   * The text configuration is 'simple': case numbers and bill names stay whole; no stemming; Hindi and other
--     scripts are tokenised, not stemmed (pgroonga stays the candidate if the eval fails there, spec §4.2).
--   * It ships only after it clearly beats vector-only on a fresh NCLT question set (a later task).
--
-- Orders after 20261101130000_law_documents_serving_set (partitions first, then the policy). It does not
-- touch either and does not depend on how many partitions exist: the index is created on the parent, so every
-- partition that exists has its own, and one attached later gets one too.
--
-- What it adds.
--
--   1. document_chunks_content_tsv: a GIN index on to_tsvector('simple'::regconfig, content). No stored column,
--      no table rewrite. Built with a share lock on each partition: reads continue, writes to that partition wait.
--
--   2. Schema retrieval_internal, used by hybrid search and nothing else, not exposed through the API
--      (supabase/config.toml: schemas = public, graphql_public). USAGE for authenticated and service_role only
--      (the invoker function runs as the caller), so no one can create objects in it but its owner. CREATE
--      SCHEMA has no IF NOT EXISTS: if the name is ever taken, this migration fails instead of reusing it.
--      The schema that holds billing and credits is a different schema and is not touched: this file names no
--      other schema and changes no privilege outside retrieval_internal, public.document_chunks (the index)
--      and the two functions; supabase/tests/run.sh compares that schema's ACLs before and after.
--      BEFORE APPLYING: open the Supabase dashboard, Settings, API, "Exposed schemas", and confirm
--      retrieval_internal is not listed (and "Extra search path" does not name it). The database cannot tell us;
--      supabase/config.toml covers only local development.
--
--   3. retrieval_internal.hybrid_keyword_ids(p_query_text, p_desk_tier, p_desk_feature) returns (id, keyword_rank): the ids
--      of chunks (of the scope, indexed, embedded) that match the rare words, best first, ranks 1..n, NOT
--      filtered by the caller's visibility. SECURITY DEFINER, search_path = public, extensions, pg_temp
--      (pg_temp last, every table schema-qualified), custom plans.
--
--   4. public.match_documents_hybrid(query_embedding, query_text, match_count, p_document_ids, p_desk_tier,
--      p_desk_feature): SECURITY INVOKER, same parameters and columns as match_documents. For an NCLT feature
--      search it keeps the helper's ids that the caller's RLS lets it read, fuses them with match_documents'
--      vector rows and reads every returned chunk back through RLS once more; otherwise it is match_documents. `similarity` is the chunk's cosine
--      similarity to the query vector (not the fused score) and rows are in fused order.
--
-- WHY A DEFINER HELPER. Under row-level security the keyword predicate cannot use the GIN index: the match
-- operator (@@) is not leakproof, so the planner may not evaluate it before the restrictive policy
-- law_chunks_serving, and a signed-in user's keyword query seq-scans every chunk and probes documents for
-- each (measured 22 to 29 s with no match, against 57 ms as service_role). The helper finds the candidates as
-- its owner, with the index, then returns only what the caller could have read anyway.
--
-- SECURITY ARGUMENT (for the reviewer).
--   What the helper can see that the caller cannot: every chunk and document, including the unpublished
--   NCLT orders hidden by law_chunks_serving / law_documents_serving, because its owner owns the tables and
--   so bypasses RLS. Document frequencies, candidates and their ranks are computed over all of it.
--   What it hands back: chunk ids and ranks, never text, titles, scores or counts. Those ids may include the
--   ids of hidden chunks. The caller never receives them through the search function:
--     a. match_documents_hybrid is SECURITY INVOKER. It keeps only the helper's ids that an existence check
--        through the caller's own RLS lets it read, ranks the survivors, fuses, and reads every row it returns
--        through RLS again (the access check is last, and is the policies themselves, not a copy of them).
--     b. The helper cannot filter by the caller's identity itself: PostgreSQL forbids SET ROLE inside a
--        SECURITY DEFINER function ('cannot set parameter "role" within security-definer function').
--        So a caller who can run SQL and call the helper directly would see candidate ids of hidden chunks
--        (an existence signal: a hidden chunk matches these rare words), not their content. That path is closed
--        by exposure, not by the function: the schema is not in the API's exposed schemas, so no HTTP
--        client can reach the helper, and it is executable only by authenticated and service_role. A
--        signed-in browser or app user has no SQL connection. Options that would close it in the database
--        (a copy of the publication rule inside the helper, or a non-bypass owner role for the search function)
--        are listed in the task report; neither is done here.
--     c. Identity. The helper runs as its owner, so every name must resolve to what was meant: search_path is
--        fixed with pg_temp last (a caller's temp table or type cannot shadow a catalog or public name), every
--        table is written public.<name>, and no caller-supplied text becomes SQL (a lexeme is escaped into a
--        tsquery literal and only compared). Parameters cannot name an object.
--     d. Residual channels, accepted: (i) the 2000-row candidate cap and the best-100 cut run before the
--        visibility check, so hidden matching chunks can crowd a visible chunk out of the candidates (at most
--        the hidden chunks, 69 now); (ii) whether a word is rare depends on its count over all chunks, hidden
--        ones included, and a call's duration depends on the candidates; neither returns text or ids.
--   The owner is the migrating role (postgres on NTER), which owns document_chunks and documents.
--
-- Rollback (nothing else depends on any of it):
--   drop function public.match_documents_hybrid(extensions.vector, text, int, uuid[], text, text);
--   drop function retrieval_internal.hybrid_keyword_ids(text, text, text);
--   drop schema retrieval_internal;
--   drop index public.document_chunks_content_tsv;

begin;

create index document_chunks_content_tsv on public.document_chunks
  using gin (to_tsvector('simple'::regconfig, content));

create schema retrieval_internal;
revoke all on schema retrieval_internal from public, anon, authenticated, service_role;
grant usage on schema retrieval_internal to authenticated, service_role;

create function retrieval_internal.hybrid_keyword_ids(
  p_query_text   text,
  p_desk_tier    text,
  p_desk_feature text
) returns table (
  id           uuid,
  keyword_rank integer
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
set plan_cache_mode = force_custom_plan
as $fn$
#variable_conflict use_column
declare
  -- A word is rare when it is in at most this many chunks of the whole table.
  c_rare_df_max constant int := 300;
  -- Keyword matches ranked before the best c_candidates are kept; ts_rank_cd cannot use the index, so a common
  -- word could otherwise match most of the table.
  c_keyword_cap constant int := 2000;
  c_candidates constant int := 100;
  -- Words probed per call (a probe is one index count): those with a digit first (case and section numbers),
  -- then the longest.
  c_max_terms constant int := 64;
  v_lex     text;
  v_lit     text;
  v_df      int;
  v_terms   text[] := '{}';
  v_query   tsquery;
  v_found   uuid[];
begin
  if nullif(btrim(coalesce(p_query_text, '')), '') is null then
    return;
  end if;

  -- The rare words. The probe is a bounded index count: at most c_rare_df_max + 1 chunks are read.
  for v_lex in
    select x.lex
      from (select distinct unnest(tsvector_to_array(to_tsvector('simple'::regconfig, p_query_text))) as lex) x
     order by (x.lex ~ '[0-9]') desc, length(x.lex) desc, x.lex
     limit c_max_terms
  loop
    v_lit := '''' || replace(replace(v_lex, '\', '\\'), '''', '''''') || '''';
    select count(*) into v_df
      from (select 1 from public.document_chunks c
             where to_tsvector('simple'::regconfig, c.content) @@ v_lit::tsquery
             limit c_rare_df_max + 1) z;
    if v_df between 1 and c_rare_df_max then
      v_terms := v_terms || v_lit;
    end if;
  end loop;
  if cardinality(v_terms) = 0 then
    return;
  end if;
  v_query := array_to_string(v_terms, ' | ')::tsquery;

  -- The candidates, as the owner, through the GIN index (under RLS the match operator could not use it).
  select array_agg(k.id order by k.rank desc, k.id) into v_found
    from (select s.id, s.rank
            from (select c.id, ts_rank_cd(to_tsvector('simple'::regconfig, c.content), v_query) as rank
                    from public.document_chunks c
                    join public.documents d on d.id = c.document_id
                   where to_tsvector('simple'::regconfig, c.content) @@ v_query
                     and c.embedding is not null
                     and d.indexed_at is not null
                     and (p_desk_feature is null or c.desk_feature = p_desk_feature)
                     and (p_desk_tier is null or d.desk_tier = p_desk_tier)
                   limit c_keyword_cap) s
           order by s.rank desc, s.id
           limit c_candidates) k;
  if v_found is null then
    return;
  end if;

  return query
    select a.id, a.n::integer from unnest(v_found) with ordinality a(id, n);
end
$fn$;

revoke all on function retrieval_internal.hybrid_keyword_ids(text, text, text) from public, anon, authenticated, service_role;
grant execute on function retrieval_internal.hybrid_keyword_ids(text, text, text) to authenticated, service_role;

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
  -- The one feature keyword search applies to (the measurement: it lifted NCLT and regressed the others).
  c_nclt constant text := 'NCLT / NCLAT (Insolvency)';
  -- Rows taken from the vector side before fusion. Ranks beyond about 50 add under 1% of a top score
  -- (1/110 against 1/61), so 100 loses nothing a 40-row answer could show.
  c_candidates constant int := 100;
  -- The reciprocal rank fusion constant of Cormack, Clarke and Buettcher (2009), which the Supabase hybrid
  -- search recipe also uses.
  c_rrf_k constant int := 60;
  v_limit int := least(greatest(coalesce(match_count, 40), 1), 200);
  v_hits  uuid[];
begin
  if coalesce(array_length(p_document_ids, 1), 0) > 0 or p_desk_feature is distinct from c_nclt then
    return query select * from public.match_documents(query_embedding, v_limit, p_document_ids, p_desk_tier, p_desk_feature);
    return;
  end if;

  -- The helper's candidates, as ids; keep those this caller may read (row-level security applies here).
  select array_agg(h.id order by h.keyword_rank) into v_hits
    from retrieval_internal.hybrid_keyword_ids(query_text, p_desk_tier, p_desk_feature) h
   where exists (select 1 from public.document_chunks c where c.id = h.id and c.desk_feature = c_nclt);
  if v_hits is null then
    return query select * from public.match_documents(query_embedding, v_limit, null, p_desk_tier, p_desk_feature);
    return;
  end if;

  return query
    with vec as (
      select m.id, m.ordinality as rn
        from public.match_documents(query_embedding, c_candidates, null, p_desk_tier, p_desk_feature) with ordinality m
    ),
    hits as (
      select a.id, a.n as rn from unnest(v_hits) with ordinality a(id, n)
    ),
    fused as (
      select coalesce(v.id, h.id) as id, v.rn as vr, h.rn as kr,
             coalesce(1.0 / (c_rrf_k + v.rn), 0) + coalesce(1.0 / (c_rrf_k + h.rn), 0) as score
        from vec v full join hits h on h.id = v.id
       order by 4 desc, v.rn nulls last, h.rn nulls last, 1
       limit v_limit
    )
    -- The access check, last: every row is read again through the caller's RLS.
    select c.id, c.document_id, c.content,
           (1 - (c.embedding <=> query_embedding))::float8,
           c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
           d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature,
           c.block_ids, c.image_ids, c.metadata->'section'
      from fused f
      join public.document_chunks c on c.id = f.id and c.desk_feature = c_nclt
      join public.documents d on d.id = c.document_id
     order by f.score desc, f.vr nulls last, f.kr nulls last, f.id;
end
$fn$;

revoke all on function public.match_documents_hybrid(extensions.vector, text, int, uuid[], text, text) from public, anon;
grant execute on function public.match_documents_hybrid(extensions.vector, text, int, uuid[], text, text) to authenticated, service_role;

commit;
