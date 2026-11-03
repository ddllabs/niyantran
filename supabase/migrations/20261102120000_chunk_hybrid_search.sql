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
--     chunks the caller can read (about 0.08% of the table). Of those, it keeps as many as a budget of 2000
--     readable chunks allows: words with a digit first, then the others, each group rarest first (ties by the
--     word), a word kept when its readable count still fits in what is left. The kept words are OR'd; every match
--     of them is ranked by ts_rank_cd; reciprocal rank fusion, weight 1, k = 60, with the 100 vector rows of
--     match_documents. A strict AND of every word of a sentence matches nothing; an OR of every word is dominated
--     by common words (both measured).
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
--      (the invoker function runs as the caller), so no one can create objects in it but its owner. (A function
--      added later would be executable by PUBLIC, PostgreSQL's built-in default, but only reachable by those two
--      roles: ALTER DEFAULT PRIVILEGES IN SCHEMA ... REVOKE cannot cancel that default, it has no effect, so it is
--      not used; the fixture asserts the schema holds exactly the helper, and a function added here must revoke
--      explicitly, as the helper does.) CREATE
--      SCHEMA has no IF NOT EXISTS: if the name is ever taken, this migration fails instead of reusing it.
--      The schema that holds billing and credits is a different schema and is not touched: this file names no
--      other schema and changes no privilege outside retrieval_internal, public.document_chunks (the index)
--      and the two functions; supabase/tests/run.sh compares that schema's ACLs before and after.
--      BEFORE APPLYING: open the Supabase dashboard, Settings, API, "Exposed schemas", and confirm
--      retrieval_internal is not listed (and "Extra search path" does not name it). The database cannot tell us;
--      supabase/config.toml covers only local development.
--
--   3. retrieval_internal.hybrid_keyword_ids(p_query_text, p_desk_tier, p_desk_feature) returns (id, keyword_rank): the ids
--      of the chunks (of the scope, indexed, embedded, in documents the caller can read) that match the kept rare
--      words, best first, ranks 1..n. SECURITY DEFINER, search_path = pg_catalog, pg_temp, custom plans.
--
--   4. public.match_documents_hybrid(query_embedding, query_text, match_count, p_document_ids, p_desk_tier,
--      p_desk_feature): SECURITY INVOKER, same parameters and columns as match_documents. For an NCLT feature
--      search it keeps the helper's ids that the caller's RLS lets it read, fuses them with match_documents'
--      vector rows and reads every returned chunk back through RLS once more; otherwise it is match_documents. `similarity` is the chunk's cosine
--      similarity to the query vector (not the fused score) and rows are in fused order.
--
--   5. Last, the migration calls the helper once (with an empty text: only the policy check below runs, no row is
--      read), so a mismatch fails the migration on the database being migrated, and rolls it back, instead of
--      surfacing at the first search.
--
-- WHY A DEFINER HELPER. Under row-level security the keyword predicate cannot use the GIN index: the match
-- operator (@@) is not leakproof, so the planner may not evaluate it before the restrictive policy
-- law_chunks_serving, and a signed-in user's keyword query seq-scans every chunk and probes documents for
-- each (measured 22 to 29 s with no match, against 57 ms as service_role). The helper runs as its owner, with
-- the index, and so must itself keep hidden rows out of everything it computes.
--
-- SECURITY ARGUMENT (for the reviewer).
--   The helper reads as its owner, who owns the tables and so bypasses RLS: it could see every chunk and
--   document, including the unpublished NCLT orders hidden by law_chunks_serving and law_documents_serving.
--   It never uses them. Once per call it collects the documents the publication rule of law_documents_serving
--   does not admit:
--       not starts_with(source_key, 'law:trib:IBBI_NCLT:')
--       or not exists (select 1 from public.law_listing_settings where active)
--       or id in (select public.law_published_document_ids())
--       or not (metadata->>'origin' = 'supplied-text')
--   (a null result is not admitted either; the chunk policy law_chunks_serving admits a chunk exactly when its
--   document is admitted, so a chunk with a null document_id, which the column's NOT NULL already forbids, is
--   left out too), and leaves their chunks out of the document-frequency count and out of the candidate
--   scan before anything is counted, ranked or cut. Which words are rare, which of them fit the word budget, which
--   chunks match, their order and which 100 survive are therefore functions of rows the caller can read: no hidden
--   id, count or rank reaches the caller, directly or through the search function. (An earlier draft ran both over
--   all rows and filtered afterwards; the cut then revealed how many hidden chunks matched. Another computed the
--   ranking function for every match, hidden ones included, and its running time revealed the same: now it is
--   computed only for the admitted rows, at most 2000 because of the word budget.)
--   The hidden list is applied as `document_id not in (select ... from unnest(list))`: a subplan that the planner
--   sizes from the array's length alone and hashes (built once per statement, at the first row that reaches it, and
--   probed per row) unless it expects only a few rows; the scan keeps its shape and the probe's limit still stops it
--   at 301 readable rows. A null document_id is tested apart (not in an empty list is true). (`= any (list)` with
--   the list inlined, as custom plans inline it, made the planner estimate every element: with 8000 hidden
--   documents a probe planned in 12 ms warm, 471 ms cold. An EXISTS over unnest would become an anti join whose
--   join order the planner picks; hashing the chunk side would read every match of a word, past the probe's limit.)
--   The rule is a copy of the policy's. Two guards keep the copy honest. supabase/tests/chunk_hybrid_search.sql
--   replays the matrix of law_documents_serving_set.sql (every kind of document the rule distinguishes, six
--   listing states) and requires the helper to return exactly the chunks authenticated reads. And at run time,
--   first, before reading any row, the helper compares the normalised text, name, command, roles and mode of every
--   policy on documents and document_chunks (and their number) with the list it was written against, and raises
--   (55000) if anything differs, so a later policy change cannot silently diverge from the copy: the search
--   function fails for an NCLT search until this file is updated. Other scopes never call the helper. This
--   migration calls the helper as its last statement, so the comparison also runs on the target database at
--   migration time and a mismatch rolls the migration back. The error the client sees (through PostgREST) is terse
--   and names nothing internal; the explanation for operators is the comment at the raise.
--   Before applying, read pg_get_expr(polqual, polrelid) of those policies on the production database: the
--   comparison is on PostgreSQL's deparsed text and the list was captured on PostgreSQL 17.
--   If the policy ever depends on the caller, the helper must change.
--   service_role: the helper applies authenticated's rule to every caller, so a service_role search mixes the
--   vector side (which reads everything service_role may read, hidden orders included) with keyword rows from
--   readable documents only. The ship gate runs as authenticated on the replica; nothing in the application
--   searches as service_role.
--   Second line of defence: match_documents_hybrid is SECURITY INVOKER. It keeps only the helper's ids that an
--   existence check through the caller's own RLS lets it read, ranks the survivors, fuses, and reads every row it
--   returns through RLS again (the access check is last, and is the policies themselves).
--   Exposure. The schema is not in the API's exposed schemas, so no HTTP client can call the helper, and it is
--   executable only by authenticated and service_role. The database cannot tell whether the hosted project's
--   API exposes the schema: BEFORE APPLYING, check it by hand (dashboard, Settings, API, "Exposed schemas" and
--   "Extra search path"). Called directly by a caller with SQL access, the helper returns ids of readable chunks only.
--   Identity. The helper runs as its owner, so every name must resolve to what was meant: search_path is
--   pg_catalog, pg_temp (a caller's temp table or type cannot shadow anything), every table and function is
--   written public.<name>, and no caller-supplied text becomes SQL (a lexeme is escaped into a tsquery literal and
--   only compared). Parameters cannot name an object.
--   Cost, and what it still reveals. The text is cut to 4000 characters, at most 64 words are probed (each a
--   bounded index count of at most 301 readable chunks), and the words kept have readable counts that add up to at
--   most 2000. A kept word's count is exact (at most 300) and counts every readable chunk with the word, in every
--   feature and tier, so the matches of the kept words in the scope are at most that sum: at most 2000 admitted
--   matches, and all of them are ranked (no row is dropped, so the best match is always among them). No single
--   word can exceed the budget: a word is rare only when its count is at most 300, so the first word always fits
--   and at least six do. The worst call is therefore 64 probes, one scan of documents (once, for the rule), one
--   index scan per partition for the matches, 2000 lookups by the unique key (id, desk_feature) with a rank each
--   (an estimated 0.2 to 0.5 s at the 100 to 260 microseconds a row implied by the 2 to 5 s the security review
--   measured for 19,200 rows; to be measured on the replica, where the 8 s statement timeout is the limit) and a
--   sort of 2000. Residual channel, accepted: the bitmap scan and the filter still walk the hidden chunks that
--   match a word (roughly a microsecond to ten each), so a call's duration grows slightly with how many hidden
--   chunks contain the words; thousands of them move it by milliseconds. No id, count, rank or text reaches the
--   caller through it.
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
set search_path = pg_catalog, pg_temp
set plan_cache_mode = force_custom_plan
as $fn$
#variable_conflict use_column
declare
  -- A word is rare when it is in at most this many chunks the caller can read.
  c_rare_df_max constant int := 300;
  c_candidates constant int := 100;
  -- Words probed per call (a probe is one index count): those with a digit first (case and section numbers),
  -- then the longest.
  c_max_terms constant int := 64;
  -- Characters of the text that are analysed.
  c_query_max constant int := 4000;
  -- The word budget: the kept words' readable counts add up to at most this, so at most this many admitted matches are
  -- ranked, and every one of them is. The ranking function cannot use an index and is the only per-row cost that grows
  -- with the matches, so this bounds a call. It replaces a cap of 2000 rows by id (the eval ran with a cap of 2000 rows
  -- in scan order), which above 2000 matches ranked a random sample. Typical questions never reach it.
  c_match_budget constant int := 2000;
  -- The access policies this helper's copy of the publication rule was written against, one line each, in the form
  -- table|name|mode|command|roles|using|with check, whitespace and the schema name public. removed from the
  -- expression. Any difference (text, a name, a role, a mode, a policy added or dropped) stops the helper.
  c_policies constant text :=
    'public.document_chunks|document_chunks_read|permissive|r|authenticated|true|-' || chr(10) ||
    'public.document_chunks|law_chunks_serving|restrictive|r|authenticated|(EXISTS(SELECT1FROMdocumentsdWHERE(d.id=document_chunks.document_id)))|-' || chr(10) ||
    'public.documents|documents_read|permissive|r|authenticated|true|-' || chr(10) ||
    'public.documents|law_documents_serving|restrictive|r|authenticated|((NOTstarts_with(source_key,''law:trib:IBBI_NCLT:''::text))OR(NOT(EXISTS(SELECT1FROMlaw_listing_settingsWHERElaw_listing_settings.active)))OR(idIN(SELECTlaw_published_document_ids()ASlaw_published_document_ids))OR(NOT((metadata->>''origin''::text)=''supplied-text''::text)))|-';
  v_text    text;
  v_lex     text;
  v_lit     text;
  v_df      int;
  v_lexes   text[] := '{}';
  v_lits    text[] := '{}';
  v_dfs     int[]  := '{}';
  v_sum     int    := 0;
  v_terms   text[] := '{}';
  v_query   tsquery;
  v_hidden  uuid[];
  v_found   uuid[];
begin
  -- Fail closed: the copy of the publication rule below is correct only for these policies. First, before any row is
  -- read and whatever the text, so the migration's own call (an empty text) runs it.
  if (select string_agg(format('%s|%s|%s|%s|%s|%s|%s', p.polrelid::regclass::text, p.polname,
                               case when p.polpermissive then 'permissive' else 'restrictive' end, p.polcmd,
                               case when 0 = any (p.polroles) then 'public'
                                    else (select string_agg(r.rolname, ',' order by r.rolname) from pg_roles r where r.oid = any (p.polroles)) end,
                               regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), '-'), '\s+|public\.', '', 'g'),
                               regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'), '\s+|public\.', '', 'g')),
                        chr(10) order by p.polrelid::regclass::text, p.polname)
        from pg_policy p
       where p.polrelid in ('public.documents'::regclass, 'public.document_chunks'::regclass)) is distinct from c_policies then
    -- For operators: the access policies on public.documents and public.document_chunks are no longer the ones in
    -- c_policies, the list this helper's copy of the publication rule of law_documents_serving was written against.
    -- Update the copy (the v_hidden query) and c_policies in a new migration together with the policy change; until
    -- then every NCLT keyword search fails here, and so does this migration if it is applied to such a database.
    -- The message is terse and names nothing internal because PostgREST returns it to the client.
    raise exception 'keyword search unavailable' using errcode = '55000';
  end if;

  v_text := left(p_query_text, c_query_max);
  if nullif(btrim(coalesce(v_text, '')), '') is null then
    return;
  end if;

  -- The documents the publication rule of law_documents_serving does not admit (a null result is not admitted
  -- either), once per call. Everything below leaves their chunks out before it counts, ranks or cuts anything.
  select coalesce(array_agg(d.id), '{}') into v_hidden
    from public.documents d
   where (not starts_with(d.source_key, 'law:trib:IBBI_NCLT:')
          or not exists (select 1 from public.law_listing_settings where active)
          or d.id in (select public.law_published_document_ids())
          or not (d.metadata->>'origin' = 'supplied-text')) is not true;
  -- The hidden-list test below admits every row when the list is null (unnest(null) is empty): fail closed instead,
  -- should a later edit drop the coalesce.
  if v_hidden is null then
    raise exception 'keyword search unavailable' using errcode = '55000';
  end if;

  -- The rare words. The probe is a bounded count of readable chunks: at most c_rare_df_max + 1 are read. (On the
  -- form of the hidden-list test, here and below, see "The hidden list" in the header.)
  for v_lex in
    select x.lex
      from (select distinct unnest(tsvector_to_array(to_tsvector('simple'::regconfig, v_text))) as lex) x
     order by (x.lex ~ '[0-9]') desc, length(x.lex) desc, x.lex
     limit c_max_terms
  loop
    v_lit := '''' || replace(replace(v_lex, '\', '\\'), '''', '''''') || '''';
    select count(*) into v_df
      from (select 1
              from public.document_chunks c
             where to_tsvector('simple'::regconfig, c.content) @@ v_lit::tsquery
               and c.document_id is not null and c.document_id not in (select h.id from unnest(v_hidden) h(id))
             limit c_rare_df_max + 1) z;
    if v_df between 1 and c_rare_df_max then
      v_lexes := v_lexes || v_lex;
      v_lits := v_lits || v_lit;
      v_dfs := v_dfs || v_df;
    end if;
  end loop;

  -- The word budget, from the readable counts alone: words with a digit (case and section numbers) first, then the
  -- others, each group rarest first, ties by the word; a word is kept when its count still fits in what is left of
  -- c_match_budget, and skipped otherwise (a rarer word after it may still fit). Every count is at most c_rare_df_max,
  -- below the budget, so the first word is always kept.
  for v_lit, v_df in
    select w.lit, w.df
      from unnest(v_lexes, v_lits, v_dfs) w(lex, lit, df)
     order by (w.lex ~ '[0-9]') desc, w.df, w.lex
  loop
    if v_sum + v_df <= c_match_budget then
      v_sum := v_sum + v_df;
      v_terms := v_terms || v_lit;
    end if;
  end loop;
  if cardinality(v_terms) = 0 then
    return;
  end if;
  v_query := array_to_string(v_terms, ' | ')::tsquery;

  -- The candidates. Step 1 reads the ids of the matching chunks of the scope through the GIN index on their own
  -- (materialized, so the planner cannot pick another path), leaving hidden documents' chunks out; no rank is
  -- computed here. Step 2 keeps those whose document is indexed and in the tier: all of them, at most v_sum (each
  -- matches a kept word and is among that word's readable count), so at most c_match_budget. Step 3 reads each one's
  -- text back by its unique key (id, desk_feature), ranks it, and keeps the best c_candidates by rank and id.
  with m as materialized (
    select c.id, c.document_id, c.desk_feature
      from public.document_chunks c
     where to_tsvector('simple'::regconfig, c.content) @@ v_query
       and c.embedding is not null
       and (p_desk_feature is null or c.desk_feature = p_desk_feature)
       and c.document_id is not null and c.document_id not in (select h.id from unnest(v_hidden) h(id))
  ),
  admitted as (
    select m.id, m.desk_feature
      from m
      join public.documents d on d.id = m.document_id
     where d.indexed_at is not null
       and (p_desk_tier is null or d.desk_tier = p_desk_tier)
  )
  select array_agg(k.id order by k.rank desc, k.id) into v_found
    from (select a.id, ts_rank_cd(to_tsvector('simple'::regconfig, r.content), v_query) as rank
            from admitted a
            cross join lateral (
              -- A chunk with a feature: equality on the partition key, so only that feature's partition is read.
              select c.content
                from public.document_chunks c
               where c.id = a.id and c.desk_feature = a.desk_feature
              union all
              -- A chunk without one (the default partition), reached only by a direct call with no feature.
              select c.content
                from public.document_chunks c
               where a.desk_feature is null and c.id = a.id and c.desk_feature is null) r
           order by 2 desc, a.id
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

-- The policy check, now, on this database: the helper raises 55000 if the access policies are not the ones its copy
-- of the rule was written against, and the error rolls this migration back. The empty text reads no row.
do $$
begin
  perform 1 from retrieval_internal.hybrid_keyword_ids('', null, null);
end
$$;

commit;
