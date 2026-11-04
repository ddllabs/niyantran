-- Hybrid (keyword + month + vector) search over NCLT chunks (F278 step 4, plan
-- docs/plans/2026-11-02-phase-c-hybrid-and-registration.md task C1, revised in place as round 2 by
-- docs/plans/2026-11-04-hybrid-and-contextual-retrieval.md task T6; spec docs/specs/2026-11-01-bulk-ingestion.md §4.2).
-- Not on production. Additive: match_documents and match_documents_feature_hnsw are unchanged and the app does not
-- call the new function yet. Never applied to a database other than local rehearsal copies, hence revised in place.
--
-- Decisions (developer, 2026-11-03), from the measurements in docs/research/2026-11-02-hybrid-search.md:
--   * Keyword search applies to the NCLT feature only. Every other scope (unscoped, a tier alone, any
--     other feature, document ids, an NCLT search that names document ids) returns exactly what
--     match_documents returns, because the keyword rules regressed those features in the eval.
--   * The text configuration is 'simple': case numbers and bill names stay whole; no stemming; Hindi and other
--     scripts are tokenised, not stemmed (pgroonga stays the candidate if the eval fails there, spec §4.2).
--   * It ships only after it clearly beats vector-only on a fresh NCLT question set (a later task).
--
-- Round 2 (developer, 2026-11-04), from docs/research/2026-11-04-hybrid-round1-failures.md (the "failure analysis"),
-- which found that round 1 (keyword rows ordered by ts_rank_cd, every rare word allowed to inject rows) did not
-- beat vector-only on the held-out NCLT questions (doc@10 19 and 19 of 30). Three changes, the analysis's
-- candidates A, B and C with the parameters it simulated (the simulation: doc@5/10/40 22/23/25 on the 30 development
-- questions against 19/19/21 for vector-only, no question lost from the top 10):
--   A. The keyword candidates are ordered by cosine similarity to the question (halfvec, as match_documents), not by
--      ts_rank_cd (analysis, "Candidate A": the word matches decide which chunks are candidates, the vector decides
--      their order; ts_rank_cd had 1 to 7 distinct scores in a top 100, so chunk id decided). ts_rank_cd is gone.
--   B. Only name-like words search: a kept rare word counts when it is in the title of 1 to 50 documents of the
--      scope the caller can read (analysis, "Candidate B", test (ii) "B'": independent of how the user types, one
--      count over the NCLT titles). The other rare words are dropped, not demoted: in the simulation the stray-word
--      questions return to their vector ranks (q-0007, q-0021, q-0024). The gate is applied after the word budget,
--      to the words the budget kept, as the simulation did.
--   C. A third fused list from a month and year stated in the question (analysis, "Candidate C"): the chunks of NCLT
--      documents whose order date (the chunk facet doc_date) is in that month, ordered by similarity to the question,
--      the best 100, fused as a list and not used as a filter. The question is parsed in SQL: an English month name
--      or abbreviation (jan, january, ... sep, sept, september, ...), optionally followed by a full stop, a comma
--      or "of", then a four-digit year 1900 to 2099, case-insensitive, the first such pair in the text; no pair, no
--      list. A month holding more than 20,000 chunks the caller can read gets no list (c_month_max_chunks; the largest
--      month of the 225,273 NCLT chunks measured on the rehearsal copy holds 8,616, 104 months), which bounds the
--      work of ordering a month by similarity; the search then equals the one without the list.
--
-- Fusion (recorded, as the plan asks): reciprocal rank fusion, score = sum over the lists a chunk is in of
-- 1 / (60 + its rank in that list); k = 60 (Cormack, Clarke and Buettcher 2009; the Supabase recipe's default is also
-- 50 to 60); weight 1 for each of three lists: the 100 vector rows of match_documents, the up to 100 keyword
-- candidates and the up to 100 month candidates. Ties: higher score, then vector rank, then keyword rank, then month
-- rank (a list the chunk is not in last), then chunk id. The analysis found that weights below 1, other values of k
-- (20, 60, 100) and a smaller candidate cut did not help.
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
--   3. retrieval_internal.hybrid_candidate_ids(p_query_text, p_query_embedding, p_desk_tier, p_desk_feature) returns
--      (list_name, id, list_rank): the ids of the chunks (of the scope, indexed, embedded, in documents the caller can
--      read) of the keyword list (list_name 'keyword': the chunks that match the question's name-like words, nearest
--      to the question first) and of the month list (list_name 'month'), each ranked 1..n. SECURITY DEFINER,
--      search_path = pg_catalog, pg_temp, custom plans.
--
--   4. public.match_documents_hybrid(query_embedding, query_text, match_count, p_document_ids, p_desk_tier,
--      p_desk_feature): SECURITY INVOKER, same parameters and columns as match_documents. For an NCLT feature
--      search it keeps the helper's ids that the caller's RLS lets it read, fuses them with match_documents'
--      vector rows and reads every returned chunk back through RLS once more; otherwise it is match_documents. `similarity` is the chunk's cosine
--      similarity to the query vector (not the fused score) and rows are in fused order.
--
--   5. Before the index is built, the migration calls the helper once (with an empty text: only the policy check below runs, no row is
--      read), so a mismatch fails the migration on the database being migrated, and rolls it back, instead of
--      surfacing at the first search.
--
-- The keyword side, in order (the helper). The question is cut to 4000 characters. Each of its first 64 words (digit
-- words first, then the longest) is probed: a word is rare when it is in at most 300 chunks of the searched feature the caller can read
-- (about 0.13% of the NCLT partition; counted over the feature, not the whole table, so a party name that also
-- occurs in 400 Bills chunks is still rare for an NCLT search). Of the rare words it keeps as many as a budget of 2000 readable chunks allows: words
-- with a digit first, then the others, each group rarest first (ties by the word), a word kept when its readable
-- count still fits in what is left. Of those, the name-like ones (change B) form the query, OR'd. Every chunk of the
-- scope that matches it (at most the budget, and fewer after the gate) is ordered by similarity (change A) and the best 100
-- are the keyword list. A strict AND of every word of a sentence matches nothing; an OR of every word is dominated by
-- common words (both measured).
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
--   left out too). Every read that follows leaves those documents out BEFORE anything is counted, ranked, cut or
--   returned, on each of the four paths that read rows:
--     (1) the document-frequency probe of a word (chunks), (2) the title count of the name gate (documents: a
--     word is a name when it is in 1 to 50 titles, and only admitted documents are counted, so the title of an
--     unpublished order can neither make a word a name nor stop it being one), (3) the keyword candidate scan
--     (chunks), (4) the month candidate scan (chunks, and its size, which decides whether the month has a list).
--   Which words are rare, which of them fit the word budget, which are names, which chunks match, their similarity
--   to the question, their order and which 100 survive are therefore functions of rows the caller can read: no
--   hidden id, count, title, date or rank reaches the caller, directly or through the search function. (An earlier
--   draft ran both over all rows and filtered afterwards; the cut then revealed how many hidden chunks matched.
--   Another computed the ranking function for every match, hidden ones included, and its running time revealed the
--   same: now the similarity is computed only for the admitted rows, at most 2000 for the keyword list because of the
--   word budget and at most c_month_max_chunks for the month list, whose count stops at c_month_max_chunks + 1 and computes no distance above it.)
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
--   vector side (which reads everything service_role may read, hidden orders included) with keyword and month rows
--   from readable documents only. The ship gate runs as authenticated on the replica; nothing in the application
--   searches as service_role.
--   Second line of defence: match_documents_hybrid is SECURITY INVOKER. It keeps only the helper's ids (of both
--   lists) that an existence check through the caller's own RLS lets it read, ranks the survivors, fuses, and reads
--   every row it returns through RLS again (the access check is last, and is the policies themselves).
--   The question's vector reaches the helper as a parameter. The helper reads the embedding of admitted chunks only,
--   and returns ids and ranks, never a similarity or a vector, so the order is the only thing that depends on it.
--   Exposure. The schema is not in the API's exposed schemas, so no HTTP client can call the helper, and it is
--   executable only by authenticated and service_role. The database cannot tell whether the hosted project's
--   API exposes the schema: BEFORE APPLYING, check it by hand (dashboard, Settings, API, "Exposed schemas" and
--   "Extra search path"). Called directly by a caller with SQL access, the helper returns ids of readable chunks only.
--   Identity. The helper runs as its owner, so every name must resolve to what was meant: search_path is
--   pg_catalog, pg_temp (a caller's temp table or type cannot shadow anything), every table and function is
--   written public.<name>, the vector type, its cast and its operator extensions.<name>, and no caller-supplied
--   text becomes SQL (a lexeme is escaped into a tsquery literal and only compared; the month is two integers
--   parsed from the text). Parameters cannot name an object.
--   Cost, and what it still reveals. The text is cut to 4000 characters, at most 64 words are probed (each a
--   count that stops after 301 readable chunks: the LIMIT stops the heap scan, but the GIN bitmap for the word is built
--   in full first, so a probe costs at least the word's matches in the whole partition, hidden ones included), and
--   the words kept have readable counts that add up to at
--   most 2000. A kept word's count is exact (at most 300) and counts every readable chunk with the word in the
--   searched feature (every feature when the call names none), in every tier, so the matches of the kept words in the scope are at most that sum: at most 2000 admitted
--   matches, and all of them are ordered by similarity (no row is dropped before the order, so the best match is
--   always among them). No single word can exceed the budget: a word is rare only when its count is at most 300, so
--   the first word always fits and at least six do. The name gate is one scan of the scope's documents (the titles,
--   about 7,500 for NCLT) computed once and compared with the kept words. The month list is one index range scan on
--   (desk_feature, doc_date) that counts admitted chunks up to c_month_max_chunks + 1 (ids only) and, within the cap, repeats with the distance. The worst call is therefore 64
--   probes, two scans of documents (once for the rule, once for the titles), one index scan per partition for the
--   keyword matches, 2000 lookups by the unique key (id, desk_feature) with a distance each, a sort of 2000, a month
--   scan of at most 20,001 chunks with a distance each, and a sort of those. To be measured on the replica, where
--   the 8 s statement timeout is the limit (the supervisor times it on a quiet machine). Residual channel, accepted:
--   the bitmap scan, the month range scan and the filters still walk the hidden chunks and documents
--   that match (roughly a microsecond to ten each), so a call's duration grows slightly with how many hidden chunks
--   contain the words or have a date in the month, and with how many hidden documents there are; thousands of them
--   move it by milliseconds. No id, count, rank, title or text reaches the caller through it.
--   The owner is the migrating role (postgres on NTER), which owns document_chunks and documents.
--
-- Rollback (nothing else depends on any of it):
--   drop function public.match_documents_hybrid(extensions.vector, text, int, uuid[], text, text);
--   drop function retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text);
--   drop schema retrieval_internal;
--   drop index public.document_chunks_content_tsv;

begin;

create schema retrieval_internal;
revoke all on schema retrieval_internal from public, anon, authenticated, service_role;
grant usage on schema retrieval_internal to authenticated, service_role;

create function retrieval_internal.hybrid_candidate_ids(
  p_query_text      text,
  p_query_embedding extensions.vector(1536),
  p_desk_tier       text,
  p_desk_feature    text
) returns table (
  list_name text,
  id        uuid,
  list_rank integer
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
  -- A rare word is a name when it is in the title of at least one and at most this many documents of the scope the
  -- caller can read (the failure analysis, candidate B').
  c_name_df_max constant int := 50;
  -- Rows of each list.
  c_candidates constant int := 100;
  -- Words probed per call (a probe is one index count): those with a digit first (case and section numbers),
  -- then the longest.
  c_max_terms constant int := 64;
  -- Characters of the text that are analysed.
  c_query_max constant int := 4000;
  -- The word budget: the kept words' readable counts add up to at most this, so at most this many admitted matches are
  -- ordered by similarity, and every one of them is. The distance cannot use an index and is the only per-row cost that
  -- grows with the matches, so this bounds a call. It replaces a cap of 2000 rows by id (the eval ran with a cap of 2000
  -- rows in scan order), which above 2000 matches ordered a random sample. Typical questions never reach it.
  c_match_budget constant int := 2000;
  -- A month with more admitted chunks than this gets no list. 20,000 is 2.3 times the largest month of the 225,273 NCLT
  -- chunks on the rehearsal copy (8,616 of 104 months), and bounds the distances computed for a month.
  c_month_max_chunks constant int := 20000;
  -- The access policies this helper's copy of the publication rule was written against, one line each, in the form
  -- table|name|mode|command|roles|using|with check, with the schema name public. removed from the expression and every run of
  -- whitespace collapsed to one space (so a space inside a string literal is still compared; two spaces and one are not told apart). Any difference (text, a name, a role, a mode, a policy added or dropped) stops the helper.
  c_policies constant text :=
    'public.document_chunks|document_chunks_read|permissive|r|authenticated|true|-' || chr(10) ||
    'public.document_chunks|law_chunks_serving|restrictive|r|authenticated|(EXISTS ( SELECT 1 FROM documents d WHERE (d.id = document_chunks.document_id)))|-' || chr(10) ||
    'public.documents|documents_read|permissive|r|authenticated|true|-' || chr(10) ||
    'public.documents|law_documents_serving|restrictive|r|authenticated|((NOT starts_with(source_key, ''law:trib:IBBI_NCLT:''::text)) OR (NOT (EXISTS ( SELECT 1 FROM law_listing_settings WHERE law_listing_settings.active))) OR (id IN ( SELECT law_published_document_ids() AS law_published_document_ids)) OR (NOT ((metadata ->> ''origin''::text) = ''supplied-text''::text)))|-';
  v_text    text;
  v_lex     text;
  v_lit     text;
  v_df      int;
  v_lexes   text[] := '{}';
  v_lits    text[] := '{}';
  v_dfs     int[]  := '{}';
  v_klexes  text[] := '{}';
  v_klits   text[] := '{}';
  v_sum     int    := 0;
  v_terms   text[] := '{}';
  v_query   tsquery;
  v_hidden  uuid[];
  v_found   uuid[];
  v_month   text[];
  v_from    date;
  v_to      date;
  v_mfound  uuid[];
  v_mn      int;
begin
  -- Fail closed: the copy of the publication rule below is correct only for these policies. First, before any row is
  -- read and whatever the text, so the migration's own call (an empty text) runs it.
  if (select string_agg(format('%s|%s|%s|%s|%s|%s|%s', p.polrelid::regclass::text, p.polname,
                               case when p.polpermissive then 'permissive' else 'restrictive' end, p.polcmd,
                               case when 0 = any (p.polroles) then 'public'
                                    else (select string_agg(r.rolname, ',' order by r.rolname) from pg_roles r where r.oid = any (p.polroles)) end,
                               regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), '-'), 'public\.', '', 'g'), '\s+', ' ', 'g'),
                               regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'), 'public\.', '', 'g'), '\s+', ' ', 'g')),
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
  if nullif(btrim(coalesce(v_text, '')), '') is null or p_query_embedding is null then
    return;
  end if;

  -- The documents the publication rule of law_documents_serving does not admit (a null result is not admitted
  -- either), once per call. Everything below leaves their chunks and titles out before it counts, orders or cuts
  -- anything.
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

  -- ---------------------------------------------------------------------------------------------------------------
  -- The keyword list.
  --
  -- The rare words. The probe counts readable chunks of the feature and stops after c_rare_df_max + 1 (the LIMIT stops the heap
  -- scan; the bitmap of the word is built in full first). (On the
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
               and (p_desk_feature is null or c.desk_feature = p_desk_feature)
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
  for v_lex, v_lit, v_df in
    select w.lex, w.lit, w.df
      from unnest(v_lexes, v_lits, v_dfs) w(lex, lit, df)
     order by (w.lex ~ '[0-9]') desc, w.df, w.lex
  loop
    if v_sum + v_df <= c_match_budget then
      v_sum := v_sum + v_df;
      v_klexes := v_klexes || v_lex;
      v_klits := v_klits || v_lit;
    end if;
  end loop;

  -- The name gate (change B): of the kept words, those in the title of 1 to c_name_df_max documents of the scope. Only
  -- documents the caller can read are counted: not a hidden one, and not an unindexed one. The titles are analysed
  -- once (materialized) and each kept word is compared with them.
  if cardinality(v_klexes) > 0 then
    with titles as materialized (
      select tsvector_to_array(to_tsvector('simple'::regconfig, d.title)) as words
        from public.documents d
       where d.indexed_at is not null
         and (p_desk_feature is null or d.desk_feature = p_desk_feature)
         and d.id not in (select h.id from unnest(v_hidden) h(id))
    ),
    counted as (
      select k.lit, count(*) as n
        from unnest(v_klexes, v_klits) k(lex, lit)
        join titles t on k.lex = any (t.words)
       group by k.lit
    )
    select coalesce(array_agg(n.lit order by n.lit), '{}') into v_terms
      from counted n
     where n.n between 1 and c_name_df_max;
  end if;

  -- The candidates (change A). Step 1 reads the ids of the matching chunks of the scope through the GIN index on their
  -- own (materialized, so the planner cannot pick another path), leaving hidden documents' chunks out; no distance is
  -- computed here. Step 2 keeps those whose document is indexed and in the tier: all of them, at most the sum of the
  -- kept words' counts, so at most c_match_budget. Step 3 reads each one's vector back by its unique key
  -- (id, desk_feature), computes its distance to the question, and keeps the nearest c_candidates, ties by id.
  if cardinality(v_terms) > 0 then
    v_query := array_to_string(v_terms, ' | ')::tsquery;
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
    select array_agg(k.id order by k.dist, k.id) into v_found
      from (select a.id,
                   (r.embedding::extensions.halfvec(1536)) operator(extensions.<=>) (p_query_embedding::extensions.halfvec(1536)) as dist
              from admitted a
              cross join lateral (
                -- A chunk with a feature: equality on the partition key, so only that feature's partition is read.
                select c.embedding
                  from public.document_chunks c
                 where c.id = a.id and c.desk_feature = a.desk_feature
                union all
                -- A chunk without one (the default partition), reached only by a direct call with no feature.
                select c.embedding
                  from public.document_chunks c
                 where a.desk_feature is null and c.id = a.id and c.desk_feature is null) r
             order by 2, a.id
             limit c_candidates) k;
  end if;

  -- ---------------------------------------------------------------------------------------------------------------
  -- The month list (change C): the first "<month name> <year>" of the text, for a feature search only (the facet
  -- doc_date is per feature). The chunks of the scope whose document is admitted and dated in that month, nearest to
  -- the question first. The scan walks the index on (desk_feature, doc_date) and stops after c_month_max_chunks + 1
  -- admitted chunks, distance included: a month with more than c_month_max_chunks has no list.
  v_month := regexp_match(v_text,
    '\m(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?,?\s+(?:of\s+)?((?:19|20)[0-9][0-9])\M', 'i');
  if v_month is not null and p_desk_feature is not null then
    v_from := make_date(v_month[2]::int, (position(lower(left(v_month[1], 3)) in 'janfebmaraprmayjunjulaugsepoctnovdec') + 2) / 3, 1);
    v_to := (v_from + interval '1 month')::date;
    -- First only the number of admitted chunks, ids and no distance, stopping at c_month_max_chunks + 1: a month above the
    -- cap does no distance work. Then, within the cap, the same scan with the distance.
    select count(*) into v_mn
      from (select 1
              from public.document_chunks c
              join public.documents d on d.id = c.document_id
             where c.desk_feature = p_desk_feature
               and c.doc_date >= v_from and c.doc_date < v_to
               and c.embedding is not null
               and d.indexed_at is not null
               and (p_desk_tier is null or d.desk_tier = p_desk_tier)
               and c.document_id is not null and c.document_id not in (select h.id from unnest(v_hidden) h(id))
             limit c_month_max_chunks + 1) z;
    if v_mn <= c_month_max_chunks then
      select (array_agg(s.id order by s.dist, s.id))[1:c_candidates] into v_mfound
        from (select c.id,
                     (c.embedding::extensions.halfvec(1536)) operator(extensions.<=>) (p_query_embedding::extensions.halfvec(1536)) as dist
                from public.document_chunks c
                join public.documents d on d.id = c.document_id
               where c.desk_feature = p_desk_feature
                 and c.doc_date >= v_from and c.doc_date < v_to
                 and c.embedding is not null
                 and d.indexed_at is not null
                 and (p_desk_tier is null or d.desk_tier = p_desk_tier)
                 and c.document_id is not null and c.document_id not in (select h.id from unnest(v_hidden) h(id))
               limit c_month_max_chunks) s;
    end if;
  end if;

  return query
    select 'keyword'::text, a.id, a.n::integer from unnest(v_found) with ordinality a(id, n)
    union all
    select 'month'::text, a.id, a.n::integer from unnest(v_mfound) with ordinality a(id, n);
end
$fn$;

revoke all on function retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text) from public, anon, authenticated, service_role;
grant execute on function retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text) to authenticated, service_role;

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
  -- search recipe also uses. Weight 1 for each of the three lists.
  c_rrf_k constant int := 60;
  v_limit int := least(greatest(coalesce(match_count, 40), 1), 200);
  v_kw    uuid[];
  v_mo    uuid[];
begin
  if coalesce(array_length(p_document_ids, 1), 0) > 0 or p_desk_feature is distinct from c_nclt then
    return query select * from public.match_documents(query_embedding, v_limit, p_document_ids, p_desk_tier, p_desk_feature);
    return;
  end if;

  -- The helper's candidates, as ids of two lists; keep those this caller may read (row-level security applies here).
  select array_agg(h.id order by h.list_rank) filter (where h.list_name = 'keyword'),
         array_agg(h.id order by h.list_rank) filter (where h.list_name = 'month')
    into v_kw, v_mo
    from retrieval_internal.hybrid_candidate_ids(query_text, query_embedding, p_desk_tier, p_desk_feature) h
   where exists (select 1 from public.document_chunks c where c.id = h.id and c.desk_feature = c_nclt);
  if v_kw is null and v_mo is null then
    return query select * from public.match_documents(query_embedding, v_limit, null, p_desk_tier, p_desk_feature);
    return;
  end if;

  return query
    with vec as (
      select m.id, m.ordinality as rn
        from public.match_documents(query_embedding, c_candidates, null, p_desk_tier, p_desk_feature) with ordinality m
    ),
    kw as (
      select a.id, a.n as rn from unnest(v_kw) with ordinality a(id, n)
    ),
    mo as (
      select a.id, a.n as rn from unnest(v_mo) with ordinality a(id, n)
    ),
    fused as (
      select u.id, v.rn as vr, k.rn as kr, m.rn as mr,
             coalesce(1.0 / (c_rrf_k + v.rn), 0) + coalesce(1.0 / (c_rrf_k + k.rn), 0) + coalesce(1.0 / (c_rrf_k + m.rn), 0) as score
        from (select vec.id from vec union select kw.id from kw union select mo.id from mo) u
        left join vec v on v.id = u.id
        left join kw k on k.id = u.id
        left join mo m on m.id = u.id
       order by 5 desc, v.rn nulls last, k.rn nulls last, m.rn nulls last, 1
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
     order by f.score desc, f.vr nulls last, f.kr nulls last, f.mr nulls last, f.id;
end
$fn$;

revoke all on function public.match_documents_hybrid(extensions.vector, text, int, uuid[], text, text) from public, anon;
grant execute on function public.match_documents_hybrid(extensions.vector, text, int, uuid[], text, text) to authenticated, service_role;

-- The policy check, now, on this database: the helper raises 55000 if the access policies are not the ones its copy
-- of the rule was written against, and the error rolls this migration back. The empty text reads no row.
do $$
begin
  perform 1 from retrieval_internal.hybrid_candidate_ids('', null, null, null);
end
$$;

-- The index last, so that a database whose policies drifted rolls back at the check above before paying for the build.
-- (The check reads no row and does not use the index.)
create index document_chunks_content_tsv on public.document_chunks
  using gin (to_tsvector('simple'::regconfig, content));

commit;
