-- Disposable local fixture for 20261102120000_chunk_hybrid_search (F278 step 4, plan
-- docs/plans/2026-11-02-phase-c-hybrid-and-registration.md task C1; design decisions of
-- 2026-11-03: security-definer helper in a retrieval_internal schema, keyword search for NCLT only,
-- rare-terms rule). Chain: law_documents_serving_set's chain (the law listing, the partitioned
-- document_chunks of 20261101120000, the policy set of 20261101130000) + the migration, all applied
-- as a non-superuser.
--
--   Part 1  what the migration creates: the retrieval_internal schema and its ACL, the helper (security
--           definer, fixed search_path, custom plans, ids and ranks only), the invoker function's
--           properties, the keyword index on the parent and on every partition, the pinned constants.
--   Part 2  behaviour on a small seeded corpus, as `authenticated` under RLS and the law serving
--           policy (never as the owner). The vector side is made exact (enable_indexscan off).
--             * Outside the NCLT feature (unscoped, tier, other features, document ids, an NCLT
--               search that names document ids) the function returns exactly match_documents' rows.
--             * For an NCLT feature search it equals an independent oracle (reciprocal rank fusion of
--               match_documents' 100 vector rows and the rare-terms keyword rows, k = 60) in every
--               case: a keyword-only match, OR over rare terms, common words and unknown words
--               ignored, the document-frequency boundary (300 in, 301 out), the term cap.
--             * The access check: the helper sees only chunks of documents the publication rule admits
--               (the rule of law_documents_serving, copied into it because it reads as its owner), in
--               its document-frequency count and in its candidate cut, so a hidden order can neither
--               appear as an id nor change a visible answer (the crowding case); the matrix of
--               law_documents_serving_set is replayed to prove the copy admits exactly the documents
--               authenticated can read. The function still re-reads through RLS.
--           Also: oversized text, quotes and backslashes in the text, and that no other function mentions
--           the helper.
--   Part 3  the guards, each proved against the defect it guards: the helper's plan reads the GIN
--           index and never scans a chunk partition sequentially (a direct keyword query as
--           authenticated does); anon is refused by the schema's ACL (and is served once granted);
--           a temp table or type cannot shadow what the helper reads (a function without the fixed
--           search_path is shadowed).
--
-- Vacuity: run.sh rebuilds the chain without the migration and this file must fail. It fails at the
-- first assertion (the function does not exist); keep part 1 first.
\set ON_ERROR_STOP on
begin;
set local search_path = public, extensions;
set local jit = off;

create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$
begin
  if v is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.fails(q text, state text, label text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlstate <> state then raise exception 'FAIL: % (expected SQLSTATE %, got %: %)', label, state, sqlstate, sqlerrm; end if;
    raise notice 'PASS: %', label;
    return;
  end;
  raise exception 'FAIL: % (accepted: %)', label, q;
end $$;
-- A unit vector on axis, offset by r in the next two axes so its cosine distance to the axis is d.
create function pg_temp.cone(axis int, d float8, k int) returns vector language sql immutable as $$
  select (array_fill(0::real, array[axis - 1])
          || array[1::real, (r * cos(k * 2.39996323))::real, (r * sin(k * 2.39996323))::real]
          || array_fill(0::real, array[1536 - axis - 2]))::vector(1536)
    from (select sqrt(1 / (1 - d) ^ 2 - 1) as r) x
$$;

-- ===========================================================================================
-- Part 1. What the migration creates.

select pg_temp.ok(to_regprocedure('public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)') is not null
  and to_regprocedure('retrieval_internal.hybrid_keyword_ids(text, text, text)') is not null,
  'match_documents_hybrid(...) and retrieval_internal.hybrid_keyword_ids(text, text, text) exist');

-- The invoker function.
select pg_temp.ok((select pg_get_function_arguments(oid) from pg_proc where oid = 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)'::regprocedure)
  = 'query_embedding vector, query_text text, match_count integer DEFAULT 40, p_document_ids uuid[] DEFAULT NULL::uuid[], p_desk_tier text DEFAULT NULL::text, p_desk_feature text DEFAULT NULL::text',
  'argument names, types and defaults');
select pg_temp.ok((select pg_get_function_result(h.oid) = pg_get_function_result(m.oid)
                     from pg_proc h, pg_proc m
                    where h.oid = 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)'::regprocedure
                      and m.oid = 'public.match_documents(extensions.vector, integer, uuid[], text, text)'::regprocedure),
  'the same result columns as match_documents, in the same order');
select pg_temp.ok((select not h.prosecdef and h.provolatile = 's' and h.proconfig = m.proconfig and h.proretset and h.proconfig = '{"search_path=public, extensions"}'
                     from pg_proc h, pg_proc m
                    where h.oid = 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)'::regprocedure
                      and m.oid = 'public.match_documents(extensions.vector, integer, uuid[], text, text)'::regprocedure),
  'the search function is security invoker, stable, set-returning, with match_documents'' fixed search_path');
select pg_temp.ok(not has_function_privilege('anon', 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)', 'execute')
  and has_function_privilege('service_role', 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                   where p.oid = 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)'::regprocedure and a.grantee = 0),
  'executable by authenticated and service_role; not by anon or PUBLIC');

-- The helper: definer, fixed search_path with pg_temp last, custom plans, ids and ranks only.
select pg_temp.ok((select p.prosecdef and p.provolatile = 's' and p.proretset
                          and (select array_agg(c order by c) from unnest(p.proconfig) c)
                              = array['plan_cache_mode=force_custom_plan', 'search_path=pg_catalog, pg_temp']
                          and pg_get_function_result(p.oid) = 'TABLE(id uuid, keyword_rank integer)'
                     from pg_proc p where p.oid = 'retrieval_internal.hybrid_keyword_ids(text, text, text)'::regprocedure),
  'the helper is a stable security definer returning (id uuid, keyword_rank integer), search_path pg_catalog, pg_temp, force_custom_plan');
select pg_temp.ok(has_function_privilege('authenticated', 'retrieval_internal.hybrid_keyword_ids(text, text, text)', 'execute')
  and has_function_privilege('service_role', 'retrieval_internal.hybrid_keyword_ids(text, text, text)', 'execute')
  and not has_function_privilege('anon', 'retrieval_internal.hybrid_keyword_ids(text, text, text)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'retrieval_internal.hybrid_keyword_ids(text, text, text)'::regprocedure and a.grantee = 0),
  'the helper: execute for authenticated and service_role only (not anon, not PUBLIC)');
select pg_temp.ok(has_schema_privilege('authenticated', 'retrieval_internal', 'usage') and has_schema_privilege('service_role', 'retrieval_internal', 'usage')
  and not has_schema_privilege('anon', 'retrieval_internal', 'usage')
  and not exists (select 1 from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'retrieval_internal' and a.grantee = 0)
  and not has_schema_privilege('authenticated', 'retrieval_internal', 'create') and not has_schema_privilege('service_role', 'retrieval_internal', 'create'),
  'schema retrieval_internal: usage for authenticated and service_role only; nobody but the owner may create in it');
select pg_temp.ok((select count(*) from pg_proc where pronamespace = 'retrieval_internal'::regnamespace) = 1
  and not exists (select 1 from pg_class where relnamespace = 'retrieval_internal'::regnamespace)
  and not exists (select 1 from pg_type where typnamespace = 'retrieval_internal'::regnamespace and typtype <> 'c' and typelem = 0 and typname !~ '^_'),
  'schema retrieval_internal holds the helper and nothing else (no table, view or type)');
-- The helper reads every chunk as its owner; that works only if the owner is not subject to RLS on them.
select pg_temp.ok((select bool_and(pg_has_role(p.proowner, c.relowner, 'usage'))
                     from pg_proc p, pg_class c
                    where p.oid = 'retrieval_internal.hybrid_keyword_ids(text, text, text)'::regprocedure
                      and c.oid in ('public.document_chunks'::regclass, 'public.documents'::regclass)),
  'the helper''s owner owns (or is a member of the owner of) document_chunks and documents, so its candidate scan is not filtered by RLS');

-- The constants the measurement chose (docs/research/2026-11-02-hybrid-search.md).
select pg_temp.ok((select position('c_rrf_k constant int := 60;' in prosrc) > 0 and position('c_candidates constant int := 100;' in prosrc) > 0
                          and position('c_nclt constant text := ''NCLT / NCLAT (Insolvency)'';' in prosrc) > 0
                     from pg_proc where oid = 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)'::regprocedure)
  and (select position('c_rare_df_max constant int := 300;' in prosrc) > 0 and position('c_query_max constant int := 4000;' in prosrc) > 0
              and position('c_candidates constant int := 100;' in prosrc) > 0 and position('c_max_terms constant int := 64;' in prosrc) > 0
         from pg_proc where oid = 'retrieval_internal.hybrid_keyword_ids(text, text, text)'::regprocedure),
  'pinned: fusion constant 60, 100 candidates, NCLT only; rare = in at most 300 readable chunks, 64 terms, 4000 characters of text');

-- The keyword index: one expression, one text configuration, on the parent and on every leaf partition.
create temp table kw_idx as
  select t.relname::text as tab, c.relname::text as name, i.indisvalid, am.amname::text as am,
         regexp_replace(pg_get_indexdef(c.oid), '^.* USING ', 'USING ') as def,
         (select p.relname::text from pg_inherits h join pg_class p on p.oid = h.inhparent where h.inhrelid = c.oid) as parent
    from pg_index i join pg_class c on c.oid = i.indexrelid join pg_class t on t.oid = i.indrelid
    join pg_am am on am.oid = c.relam
   where t.relnamespace = 'public'::regnamespace and t.relname like 'document_chunks%' and t.relname <> 'document_chunks_unpartitioned'
     and pg_get_indexdef(c.oid) like '%to_tsvector%';
select pg_temp.ok((select count(*) from kw_idx where tab = 'document_chunks') = 1
  and (select count(*) from kw_idx where tab = 'document_chunks' and am = 'gin' and name = 'document_chunks_content_tsv') = 1,
  'one GIN keyword index on the parent, document_chunks_content_tsv');
select pg_temp.ok((select def = 'USING gin (to_tsvector(''simple''::regconfig, content))' from kw_idx where tab = 'document_chunks'),
  'the index is on the expression to_tsvector(''simple''::regconfig, content): no stored column');
select pg_temp.ok((select count(*) = count(*) filter (where am = 'gin' and indisvalid and parent = 'document_chunks_content_tsv' and def = (select def from kw_idx where tab = 'document_chunks'))
                          and count(*) >= 2
                     from kw_idx where tab <> 'document_chunks'),
  'every partition has the same valid index, attached to the parent index');
select pg_temp.ok((select array_agg(c.relname::text order by c.relname) from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'public.document_chunks'::regclass)
  = (select array_agg(tab order by tab) from kw_idx where tab <> 'document_chunks'),
  'the partitions with a keyword index are exactly the partitions of document_chunks');

-- ===========================================================================================
-- Part 2. Behaviour.
--
-- Documents. nA and nB are NCLT orders, hid an unpublished supplied-text NCLT order (hidden from
-- authenticated while the law listing is active), bN and bS national and state Bills, pq a
-- Parliamentary Question, unidx an unindexed Bill, nf a document without a feature.
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at, metadata) values
  ('f1000000-0000-4000-8000-000000000001', 'hy-nclt-a', 'NCLT A', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'a', 4, now(), '{}'),
  ('f1000000-0000-4000-8000-000000000002', 'hy-nclt-b', 'NCLT B', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'a', 4, now(), '{}'),
  ('f1000000-0000-4000-8000-000000000003', 'law:trib:IBBI_NCLT:hy-hidden', 'Hidden NCLT', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'a', 4, now(), '{"origin": "supplied-text"}'),
  ('f2000000-0000-4000-8000-000000000001', 'hy-bill-n', 'Bill N', 'national', 'Bill Passage Probability Index', 'x', 'a', 4, now(), '{}'),
  ('f2000000-0000-4000-8000-000000000002', 'hy-bill-s', 'Bill S', 'state', 'Bill Passage Probability Index', 'x', 'a', 4, now(), '{}'),
  ('f2000000-0000-4000-8000-000000000003', 'hy-bill-unindexed', 'Unindexed bill', 'national', 'Bill Passage Probability Index', 'x', 'a', 4, null, '{}'),
  ('f3000000-0000-4000-8000-000000000001', 'hy-pq', 'PQ', 'national', 'Parliamentary Question Database', 'x', 'a', 4, now(), '{}'),
  ('f4000000-0000-4000-8000-000000000001', 'hy-nofeature', 'No feature', null, null, 'x', 'a', 4, now(), '{}');

-- A writer sets desk_feature to its document's, as chunk_commit does; the trigger fills the other facets.
-- 160 vector-near chunks (distance 0.004 k from axis 1): 140 in the two NCLT orders (so an NCLT vector
-- search is saturated by them), 20 in the other searchable documents. Chunk 3 holds the identifier.
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, 'near' || k, k, 0, 4, case when k = 3 then 'filler passage ' || k || ' mentions zq4417 once' else 'filler passage ' || k end,
       pg_temp.cone(1, 0.004 * k, k), 4
  from generate_series(1, 160) k
  join documents d on d.id = (case when k <= 140 then (case when k % 2 = 1 then 'f1000000-0000-4000-8000-000000000001' else 'f1000000-0000-4000-8000-000000000002' end)
                                   else (array['f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002',
                                               'f3000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001'])[1 + k % 4] end)::uuid;
-- The identifier's other chunks are vector-far (distance 0.70 + 0.02 i, outside the 100 nearest) and sit
-- in every kind of document, searchable or not.
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, h, 1000 + i, 0, 4, content, case when h = 'far-null' then null else pg_temp.cone(1, 0.70 + 0.02 * i, 500 + i) end, 4
  from (values
    ('f1000000-0000-4000-8000-000000000001', 'far-nclt', 'petition zq4417 admitted, zq4417 recorded', 1),
    ('f2000000-0000-4000-8000-000000000001', 'far-bill', 'bill ref zq4417', 2),
    ('f2000000-0000-4000-8000-000000000002', 'far-state', 'state bill zq4417 pending', 3),
    ('f3000000-0000-4000-8000-000000000001', 'far-pq', 'question on zq4417', 4),
    ('f4000000-0000-4000-8000-000000000001', 'far-nofeature', 'a note about zq4417', 5),
    ('f1000000-0000-4000-8000-000000000003', 'far-hidden', 'hidden order zq4417', 6),
    ('f2000000-0000-4000-8000-000000000003', 'far-unindexed', 'unindexed zq4417', 7),
    ('f2000000-0000-4000-8000-000000000001', 'far-null', 'zq4417 not yet embedded', 8),
    ('f1000000-0000-4000-8000-000000000002', 'far-other', 'unrelated tribunal text', 9),
    ('f1000000-0000-4000-8000-000000000001', 'far-both', 'zq4417 and vexilla together', 10),
    ('f1000000-0000-4000-8000-000000000002', 'far-vexilla', 'only vexilla here', 11),
    ('f1000000-0000-4000-8000-000000000003', 'far-hidden-vexilla', 'hidden vexilla', 12)
  ) v(doc, h, content, i) join documents d on d.id = v.doc::uuid;
-- Document frequency: 'commonword' is in 350 chunks, 'edgea' in 301 of them, 'edgeb' in 300 (the rare-terms
-- boundary is at most 300), and 'filler' is in all 160 near chunks and these 350 (not rare).
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, 'edge' || j, 2000 + j, 0, 4,
       'commonword filler' || case when j <= 301 then ' edgea' else '' end || case when j <= 300 then ' edgeb' else '' end,
       pg_temp.cone(1, 0.9705 + 0.00008 * j, 700 + j), 4
  from generate_series(1, 350) j
  join documents d on d.id = (case when j % 2 = 1 then 'f1000000-0000-4000-8000-000000000001' else 'f1000000-0000-4000-8000-000000000002' end)::uuid;
-- Crowding and thresholds. 'padword' is in 150 visible NCLT chunks, vector-far, so a padword search has more keyword
-- candidates than the cut of 100. The hidden order has 30 chunks with 'probeword' (twice each, so they would outrank
-- the padword chunks), one with the phrase 'zorbaxan quillfeather', 5 with 'onlyhidden', and 20 with 'edgehid',
-- a word that is also in 290 visible chunks: 290 readable chunks (rare) but 310 in all (not rare if hidden ones count).
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, 'pad' || k, 3000 + k, 0, 4, 'padword crowd ' || k, pg_temp.cone(1, 0.62 + 0.002 * k, 1200 + k), 4
  from generate_series(1, 150) k
  join documents d on d.id = (case when k % 2 = 1 then 'f1000000-0000-4000-8000-000000000001' else 'f1000000-0000-4000-8000-000000000002' end)::uuid;
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, 'edgehid' || k, 4000 + k, 0, 4, 'edgehid crowd2 ' || k, pg_temp.cone(1, 0.55 + 0.001 * k, 1600 + k), 4
  from generate_series(1, 290) k
  join documents d on d.id = (case when k % 2 = 1 then 'f1000000-0000-4000-8000-000000000001' else 'f1000000-0000-4000-8000-000000000002' end)::uuid;
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, h.hash || k, h.base + k, 0, 4, h.text || ' ' || k, pg_temp.cone(1, 0.93 + 0.0004 * (h.base / 1000 * 10 + k), 2000 + h.base + k), 4
  from (values ('hprobe', 5000, 'probeword probeword hidden', 30), ('hphrase', 6000, 'the zorbaxan quillfeather hidden', 1),
               ('honly', 7000, 'onlyhidden hidden', 5), ('hedge', 8000, 'edgehid hidden', 20)) h(hash, base, text, n)
  cross join lateral generate_series(1, h.n) k
  join documents d on d.id = 'f1000000-0000-4000-8000-000000000003'::uuid;
analyze documents; analyze document_chunks;

update law_listing_settings set seeded = true, active = true;
create temp table q(name text primary key, v vector);
insert into q values ('near', pg_temp.cone(1, 0, 0)), ('side', pg_temp.cone(1, 0.3, 77));
grant select on q to authenticated, service_role;
-- Document frequency of every lexeme, over all chunks (the owner's view, as the helper has it).
create temp table df as
  select lex, (select count(*) from document_chunks c where to_tsvector('simple'::regconfig, c.content) @@ quote_literal(lex)::tsquery) as n
    from (select distinct unnest(tsvector_to_array(to_tsvector('simple'::regconfig, content))) as lex from document_chunks) x;
grant select on df to authenticated, service_role;
select pg_temp.ok((select n from df where lex = 'edgeb') = 300 and (select n from df where lex = 'edgea') = 301
  and (select n from df where lex = 'commonword') = 350 and (select n from df where lex = 'zq4417') = 10 and (select n from df where lex = 'vexilla') = 3
  and (select n from df where lex = 'padword') = 150 and (select n from df where lex = 'probeword') = 30 and (select n from df where lex = 'zorbaxan') = 1
  and (select n from df where lex = 'edgehid') = 310 and (select n from df where lex = 'onlyhidden') = 5,
  'the seeded document frequencies over all chunks are the intended ones (edgeb 300, edgea 301, commonword 350, zq4417 10, vexilla 3, padword 150, probeword 30, edgehid 310 of which 290 readable, onlyhidden 5)');

create function pg_temp.cid(h text) returns uuid language sql as $$ select id from document_chunks where chunk_hash = h $$;
create function pg_temp.cids(hs text[]) returns uuid[] language sql as $$ select array_agg(pg_temp.cid(h) order by o) from unnest(hs) with ordinality t(h, o) $$;
-- The rows of a query, as jsonb in order (every column, so "the same rows" means the same rows).
create function pg_temp.rowsj(q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  execute 'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (' || q || ') t' into r;
  return r;
end $$;
create function pg_temp.idsof(j jsonb) returns uuid[] language sql as $$ select array_agg((e->>'id')::uuid order by o) from jsonb_array_elements(j) with ordinality t(e, o) $$;
-- hybrid and match_documents with the same arguments.
create function pg_temp.h(qv text, qtext text, n int default 40, ids uuid[] default null, tier text default null, feat text default null) returns jsonb language sql as $$
  select pg_temp.rowsj(format('select * from match_documents_hybrid(%L::vector, %L, %L, %L::uuid[], %L, %L)', (select v::text from q where name = qv), qtext, n, ids, tier, feat)) $$;
create function pg_temp.v(qv text, n int default 40, ids uuid[] default null, tier text default null, feat text default null) returns jsonb language sql as $$
  select pg_temp.rowsj(format('select * from match_documents(%L::vector, %L, %L::uuid[], %L, %L)', (select v::text from q where name = qv), n, ids, tier, feat)) $$;

-- The oracle for an NCLT feature search: reciprocal rank fusion, k = 60, in plain SQL, as the invoking role (so
-- every count and every chunk is the caller's: nothing hidden can enter). Vector side: match_documents' own 100
-- rows. Keyword side: the first 4000 characters of the text; a term is rare when it is in 1 to 300 chunks the
-- caller can read; at most 64 terms (a digit first, then the longest); the best 100 chunks of the scope matching
-- the OR of the rare terms by ts_rank_cd (ties by id), ranked 1..n.
create function pg_temp.oracle(qv text, qtext text, n int, tier text) returns uuid[] language plpgsql as $$
declare
  c_nclt constant text := 'NCLT / NCLAT (Insolvency)';
  v_n int := least(greatest(coalesce(n, 40), 1), 200);
  v_q tsquery; v_vec uuid[]; v_res uuid[];
begin
  select string_agg(quote_literal(t.lex), ' | ')::tsquery into v_q
    from (select x.lex from (select distinct unnest(tsvector_to_array(to_tsvector('simple'::regconfig, left(qtext, 4000)))) as lex) x
           order by (x.lex ~ '[0-9]') desc, length(x.lex) desc, x.lex limit 64) t
   where (select count(*) from (select 1 from document_chunks c where to_tsvector('simple'::regconfig, c.content) @@ quote_literal(t.lex)::tsquery limit 301) z) between 1 and 300;
  if qtext is null or v_q is null then
    return pg_temp.idsof(pg_temp.v(qv, v_n, null, tier, c_nclt));
  end if;
  v_vec := pg_temp.idsof(pg_temp.v(qv, 100, null, tier, c_nclt));
  with vec as (select e.id, e.o as rn from unnest(coalesce(v_vec, '{}')) with ordinality e(id, o)),
       kw as (select s.id, row_number() over (order by s.rank desc, s.id) rn
                from (select c.id, ts_rank_cd(to_tsvector('simple'::regconfig, c.content), v_q) as rank
                        from document_chunks c join documents d on d.id = c.document_id
                       where c.desk_feature = c_nclt and c.embedding is not null and d.indexed_at is not null
                         and (tier is null or d.desk_tier = tier) and to_tsvector('simple'::regconfig, c.content) @@ v_q
                       order by 2 desc, 1 limit 100) s),
       fused as (select coalesce(v.id, k.id) id, v.rn vr, k.rn kr, coalesce(1.0 / (60 + v.rn), 0) + coalesce(1.0 / (60 + k.rn), 0) score
                   from vec v full join kw k on k.id = v.id)
  select array_agg(id order by score desc, vr nulls last, kr nulls last, id) into v_res
    from (select * from fused order by score desc, vr nulls last, kr nulls last, id limit v_n) f;
  return v_res;
end $$;

-- The vector side is exact on these few rows: no index scans (GIN is bitmap-only, unaffected).
set local enable_indexscan = off;
set local hnsw.ef_search = 40;
set local hnsw.iterative_scan = 'strict_order';

-- 1. Outside the NCLT feature the function returns exactly match_documents' rows (every column, in order).
create temp table same_cases(label text primary key, qv text, qtext text, n int, ids uuid[], tier text, feat text);
insert into same_cases values
  ('unscoped',              'near', 'zq4417',            40,   null, null,       null),
  ('unscoped-side',         'side', 'zq4417 vexilla',    40,   null, null,       null),
  ('unscoped-10',           'near', 'zq4417',            10,   null, null,       null),
  ('tier-national',         'near', 'zq4417',            40,   null, 'national', null),
  ('tier-state',            'near', 'zq4417',            40,   null, 'state',    null),
  ('tier-law',              'near', 'zq4417',            40,   null, 'law',      null),
  ('feature-bills',         'near', 'zq4417',            40,   null, null, 'Bill Passage Probability Index'),
  ('feature-bills-state',   'near', 'zq4417',            40,   null, 'state', 'Bill Passage Probability Index'),
  ('feature-pq',            'near', 'zq4417',            40,   null, null, 'Parliamentary Question Database'),
  ('feature-none',          'near', 'zq4417',            40,   null, null, 'Industry Updates (Ministry Data)'),
  ('ids',                   'near', 'zq4417',            40,   array['f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001']::uuid[], null, null),
  ('ids-nclt-with-feature', 'near', 'zq4417',            40,   array['f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002']::uuid[], null, 'NCLT / NCLAT (Insolvency)'),
  ('ids-hidden',            'near', 'zq4417',            40,   array['f1000000-0000-4000-8000-000000000003']::uuid[], null, null),
  ('ids-unindexed',         'near', 'zq4417',            40,   array['f2000000-0000-4000-8000-000000000003']::uuid[], null, null),
  ('empty-ids-other',       'near', 'zq4417',            40,   array[]::uuid[], null, 'Parliamentary Question Database'),
  ('count-1',               'near', 'zq4417',            1,    null, null,       null),
  ('count-0',               'near', 'zq4417',            0,    null, null,       null),
  ('count-null',            'near', 'zq4417',            null, null, null,       null),
  ('count-big',             'near', 'zq4417',            1000, null, null,       null),
  ('null-text',             'near', null,                40,   null, null,       null),
  ('empty-text',            'near', '',                  40,   null, null,       null);
grant select on same_cases to authenticated;
set local role authenticated;
create temp table same_got(label text primary key, h jsonb, v jsonb);
grant all on same_got to authenticated;
insert into same_got select label, pg_temp.h(qv, qtext, n, ids, tier, feat), pg_temp.v(qv, coalesce(n, 40), ids, tier, feat) from same_cases;
-- NCLT feature searches that have no keyword terms are the vector result too.
insert into same_got select 'nclt-null-text', pg_temp.h('near', null, 40, null, null, 'NCLT / NCLAT (Insolvency)'), pg_temp.v('near', 40, null, null, 'NCLT / NCLAT (Insolvency)');
insert into same_got select 'nclt-empty-text', pg_temp.h('near', '   ', 40, null, null, 'NCLT / NCLAT (Insolvency)'), pg_temp.v('near', 40, null, null, 'NCLT / NCLAT (Insolvency)');
insert into same_got select 'nclt-common-word', pg_temp.h('near', 'commonword filler', 40, null, null, 'NCLT / NCLAT (Insolvency)'), pg_temp.v('near', 40, null, null, 'NCLT / NCLAT (Insolvency)');
insert into same_got select 'nclt-unknown-word', pg_temp.h('near', 'qqqzzzxxx', 40, null, null, 'NCLT / NCLAT (Insolvency)'), pg_temp.v('near', 40, null, null, 'NCLT / NCLAT (Insolvency)');
insert into same_got select 'nclt-punctuation', pg_temp.h('near', '!!! ... ---', 40, null, null, 'NCLT / NCLAT (Insolvency)'), pg_temp.v('near', 40, null, null, 'NCLT / NCLAT (Insolvency)');
insert into same_got select 'nclt-df-301', pg_temp.h('near', 'edgea', 40, null, null, 'NCLT / NCLAT (Insolvency)'), pg_temp.v('near', 40, null, null, 'NCLT / NCLAT (Insolvency)');
insert into same_got select 'nclt-tier-without-rows', pg_temp.h('near', 'zq4417', 40, null, 'national', 'NCLT / NCLAT (Insolvency)'), pg_temp.v('near', 40, null, 'national', 'NCLT / NCLAT (Insolvency)');
reset role;
do $$
declare r record;
begin
  for r in select label from same_got where h is distinct from v loop
    raise exception 'FAIL: hybrid differs from match_documents in scope %', r.label;
  end loop;
  raise notice 'PASS: outside an NCLT keyword search the rows are exactly match_documents'' rows, every column, in order (% scopes)', (select count(*) from same_got);
end $$;
select pg_temp.ok((select array_agg(label order by label) from same_got where jsonb_array_length(v) = 0)
  = array['feature-none', 'ids-hidden', 'ids-unindexed', 'nclt-tier-without-rows'],
  'the comparison is not vacuous: every scope returns rows except the four with nothing visible');

-- 2. An NCLT feature search: equal to the oracle, row for row.
create temp table nclt_cases(label text primary key, qv text, qtext text, n int, tier text);
insert into nclt_cases values
  ('identifier',        'near', 'zq4417',                          40,  null),
  ('identifier-10',     'near', 'zq4417',                          10,  null),
  ('identifier-side',   'side', 'zq4417',                          40,  null),
  ('tier-law',          'near', 'zq4417',                          40,  'law'),
  ('or-two-rare-terms', 'near', 'zq4417 vexilla',                  40,  null),
  ('common-word-added', 'near', 'commonword zq4417',               40,  null),
  ('filler-added',      'near', 'zq4417 filler',                   40,  null),
  ('unknown-word-added','near', 'qqqzzzxxx zq4417',                40,  null),
  ('df-300',            'near', 'edgeb',                           40,  null),
  ('df-300-with-id',    'near', 'edgeb zq4417',                    40,  null),
  ('rare-passage',      'near', 'zq4417 passage',                  40,  null),
  ('case-and-punctuation','near', 'ZQ4417, (Vexilla)!',            40,  null),
  ('count-1',           'near', 'zq4417',                          1,   null),
  ('count-big',         'near', 'zq4417',                          1000,null);
-- The term cap: 64 distinct terms, those with a digit first, then the longest. 70 long made-up words with a digit
-- fill the cap and push the identifier out; 63 of them leave room for it.
-- Text with quotes, backslashes and SQL-looking input: no error, and the same answer as the identifier alone (the other
-- tokens are in no readable chunk or in too many).
insert into nclt_cases values
  ('quotes',           'near', 'zq4417''s "q" O''Brien',              40,  null),
  ('backslashes',      'near', E'zq4417 back\\slash \\\\srv\\share C:\\temp',  40,  null),
  ('sql-looking',      'near', 'zq4417''); drop table document_chunks; --', 40, null),
  ('tsquery-syntax',   'near', 'zq4417 & !vexilla | (a <-> b) :* ''',    40,  null),
  ('crowd-pad',        'near', 'padword',                         200, null),
  ('crowd-pad-probe',  'near', 'padword probeword',               200, null),
  ('crowd-pad-phrase', 'near', 'padword zorbaxan quillfeather',   200, null),
  ('crowd-pad-only',   'near', 'padword onlyhidden',              200, null),
  ('edgehid',          'near', 'edgehid',                         200, null),
  ('onlyhidden',       'near', 'onlyhidden',                      40,  null),
  ('probeword',        'near', 'probeword',                       40,  null),
  ('oversize-ignored', 'near', repeat('filler ', 700) || 'zq4417', 40,  null),
  ('oversize-kept',    'near', 'zq4417 ' || repeat('filler ', 700), 40, null),
  ('oversize-huge',    'near', repeat('qqqq ', 40000) || 'zq4417', 40,  null);
insert into nclt_cases select 'cap-full', 'near', 'zq4417 ' || string_agg('nonexistentword' || lpad(i::text, 3, '0'), ' '), 40, null from generate_series(1, 70) i;
insert into nclt_cases select 'cap-edge', 'near', 'zq4417 ' || string_agg('nonexistentword' || lpad(i::text, 3, '0'), ' '), 40, null from generate_series(1, 63) i;
grant select on nclt_cases to authenticated;
set local role authenticated;
create temp table nclt_got(label text primary key, want uuid[], got uuid[]);
grant all on nclt_got to authenticated;
insert into nclt_got select label, pg_temp.oracle(qv, qtext, n, tier),
       pg_temp.idsof(pg_temp.h(qv, qtext, n, null, tier, 'NCLT / NCLAT (Insolvency)')) from nclt_cases;
reset role;
do $$
declare r record;
begin
  for r in select label, want, got from nclt_got where want is distinct from got loop
    raise exception 'FAIL: NCLT hybrid differs from the oracle in case %: want % got %', r.label, r.want, r.got;
  end loop;
  raise notice 'PASS: an NCLT feature search equals the independent RRF oracle, row for row, in all % cases', (select count(*) from nclt_got);
end $$;
select pg_temp.ok((select count(*) from nclt_got where want is not null) = (select count(*) from nclt_got), 'the oracle returned rows in every case');

-- The oracle and the vector result differ exactly where keyword rows are expected, so the rule is not vacuous.
set local role authenticated;
create temp table vec_ref(label text primary key, ids uuid[]);
grant all on vec_ref to authenticated;
create function pg_temp.vecref(l text) returns uuid[] language sql stable as $$ select ids from vec_ref where label = l $$;
insert into vec_ref select 'nclt-40', pg_temp.idsof(pg_temp.v('near', 40, null, null, 'NCLT / NCLAT (Insolvency)'));
insert into vec_ref select 'nclt-100', pg_temp.idsof(pg_temp.v('near', 100, null, null, 'NCLT / NCLAT (Insolvency)'));
insert into vec_ref select 'nclt-200', pg_temp.idsof(pg_temp.v('near', 200, null, null, 'NCLT / NCLAT (Insolvency)'));
reset role;
select pg_temp.ok((select got from nclt_got where label = 'identifier') && pg_temp.cids(array['far-nclt', 'far-both'])
  and not (pg_temp.cids(array['far-nclt', 'far-both']) && (select ids from vec_ref where label = 'nclt-40')),
  'a keyword-only match (the identifier''s far NCLT chunks, outside the 100 nearest) is returned; the vector search alone does not return it');
select pg_temp.ok((select got from nclt_got where label = 'identifier') && pg_temp.cids(array['near3'])
  and (select array_position(got, pg_temp.cid('near3')) from nclt_got where label = 'identifier') <= 3,
  'the chunk that matches both sides is in the first three rows');
select pg_temp.ok(not ((select got from nclt_got where label = 'identifier') && pg_temp.cids(array['far-bill', 'far-state', 'far-pq', 'far-nofeature', 'far-hidden', 'far-unindexed', 'far-null'])),
  'only NCLT chunks: no other feature, no hidden order, no unindexed chunk, no chunk without a vector');
select pg_temp.ok((select got from nclt_got where label = 'or-two-rare-terms') @> pg_temp.cids(array['far-both', 'far-vexilla', 'far-nclt'])
  and (select array_position(got, pg_temp.cid('far-both')) from nclt_got where label = 'or-two-rare-terms')
      < (select array_position(got, pg_temp.cid('far-vexilla')) from nclt_got where label = 'or-two-rare-terms'),
  'rare terms are OR''d: a chunk with either term is returned, the one with both ranks above the one with one');
select pg_temp.ok((select got from nclt_got where label = 'common-word-added') = (select got from nclt_got where label = 'identifier')
  and (select got from nclt_got where label = 'filler-added') = (select got from nclt_got where label = 'identifier')
  and (select got from nclt_got where label = 'unknown-word-added') = (select got from nclt_got where label = 'identifier'),
  'a common word (350 or 510 chunks) and a word in no chunk add nothing');
select pg_temp.ok((select got from nclt_got where label = 'df-300') is distinct from (select ids from vec_ref where label = 'nclt-40')
  and (select count(*) from same_got where label = 'nclt-df-301' and h = v) = 1,
  'the boundary: a word in 300 chunks is rare (keyword rows join), a word in 301 is not (the vector result)');
select pg_temp.ok((select got from nclt_got where label = 'case-and-punctuation') = (select got from nclt_got where label = 'or-two-rare-terms'),
  'case and punctuation are ignored, as by the simple configuration');
select pg_temp.ok((select got from nclt_got where label = 'cap-full') = (select ids from vec_ref where label = 'nclt-40')
  and (select got from nclt_got where label = 'cap-edge') is distinct from (select ids from vec_ref where label = 'nclt-40'),
  'the term cap: with 70 digit-bearing long words the identifier is outside the 64 used; with 63 it is the 64th');

-- Quotes, backslashes and SQL-looking text: no error, and the same rows as the identifier alone.
select pg_temp.ok((select got from nclt_got where label = 'quotes') = (select got from nclt_got where label = 'identifier')
  and (select got from nclt_got where label = 'backslashes') = (select got from nclt_got where label = 'identifier')
  and (select got from nclt_got where label = 'sql-looking') = (select got from nclt_got where label = 'identifier')
  and (select got from nclt_got where label = 'tsquery-syntax') is not null,
  'quotes, backslashes, SQL-looking and tsquery-operator text: no error, the identifier''s rows (and the oracle agrees in each)');
-- Oversized text: only the first 4000 characters are used.
select pg_temp.ok((select got from nclt_got where label = 'oversize-ignored') = (select ids from vec_ref where label = 'nclt-40')
  and (select got from nclt_got where label = 'oversize-huge') = (select ids from vec_ref where label = 'nclt-40')
  and (select got from nclt_got where label = 'oversize-kept') = (select got from nclt_got where label = 'identifier'),
  'text is cut to 4000 characters before it is analysed: an identifier after them is ignored (even after 200 000 characters), one before them is used');
-- The crowding case. The keyword-only rows of an answer are the rows that are not among the 100 vector rows. The
-- hidden order''s words must not change how many there are: with them in the text, the count is what it is without.
create temp table keyword_only as
  select g.label, (select count(*) from unnest(g.got) u where u <> all (pg_temp.vecref('nclt-100'))) as n
    from nclt_got g where g.label like 'crowd-%';
select pg_temp.ok((select n from keyword_only where label = 'crowd-pad') = 100
  and (select count(distinct n) from keyword_only) = 1,
  'crowding: 100 keyword-only rows for the padword (150 readable chunks, cut at 100), the same number with a hidden order''s word, phrase or never-readable word added to the text');
select pg_temp.ok((select got from nclt_got where label = 'crowd-pad-probe') = (select got from nclt_got where label = 'crowd-pad')
  and (select got from nclt_got where label = 'crowd-pad-phrase') = (select got from nclt_got where label = 'crowd-pad')
  and (select got from nclt_got where label = 'crowd-pad-only') = (select got from nclt_got where label = 'crowd-pad'),
  'and the very same rows: a word that is only in hidden chunks changes nothing');
select pg_temp.ok((select got from nclt_got where label = 'onlyhidden') = (select ids from vec_ref where label = 'nclt-40')
  and (select got from nclt_got where label = 'probeword') = (select ids from vec_ref where label = 'nclt-40'),
  'a text whose only words are in hidden chunks is the vector result');
-- The rare-word threshold counts readable chunks only: edgehid is in 290 readable and 20 hidden chunks.
select pg_temp.ok((select got from nclt_got where label = 'edgehid') is distinct from (select ids from vec_ref where label = 'nclt-200')
  and (select count(*) from unnest((select got from nclt_got where label = 'edgehid')) u where u <> all (pg_temp.vecref('nclt-100'))) = 100,
  'the rare-word threshold ignores hidden chunks: edgehid (290 readable, 310 in all) is rare and brings 100 keyword rows');

-- 3. The access check: RLS and the law serving policy hide the same chunks from the function and from the helper.
-- The unpublished order is hidden from authenticated while the law listing is active, visible to service_role
-- (which bypasses RLS) and to the owner, and visible again once the listing is off.
create temp table hid(state text, who text, fn text, hidden int, total int);
grant all on hid to authenticated, service_role;
create function pg_temp.hid_rows(st text, rl text) returns void language plpgsql as $$
declare v_hidden uuid := pg_temp.cid('far-hidden'); v_hv uuid := pg_temp.cid('far-hidden-vexilla'); a uuid[];
begin
  perform set_config('role', rl, true);
  a := pg_temp.idsof(pg_temp.h('near', 'zq4417 vexilla', 40, null, null, 'NCLT / NCLAT (Insolvency)'));
  insert into hid values (st, rl, 'hybrid', (select count(*) from unnest(coalesce(a, '{}')) u where u in (v_hidden, v_hv)), cardinality(a));
  a := array(select id from retrieval_internal.hybrid_keyword_ids('zq4417 vexilla', null, 'NCLT / NCLAT (Insolvency)'));
  insert into hid values (st, rl, 'helper', (select count(*) from unnest(coalesce(a, '{}')) u where u in (v_hidden, v_hv)), cardinality(a));
  perform set_config('role', 'postgres', true);
end $$;
select pg_temp.hid_rows('listing active', 'authenticated');
select pg_temp.hid_rows('listing active', 'service_role');
select pg_temp.hid_rows('listing active', 'postgres');
update law_listing_settings set active = false;
select pg_temp.hid_rows('listing off', 'authenticated');
update law_listing_settings set active = true;
select pg_temp.ok((select array_agg(row(who, fn, hidden)::text order by who, fn) from hid where state = 'listing active')
  = array['(authenticated,helper,0)', '(authenticated,hybrid,0)', '(postgres,helper,0)', '(postgres,hybrid,0)', '(service_role,helper,0)', '(service_role,hybrid,0)'],
  'listing active: neither the search function nor the helper returns the unpublished order''s chunks, to authenticated or to the callers that bypass RLS (the helper applies authenticated''s rule to everyone)');
select pg_temp.ok((select array_agg(row(fn, hidden)::text order by fn) from hid where state = 'listing off' and who = 'authenticated')
  = array['(helper,2)', '(hybrid,2)'],
  'listing off: both return them (the hiding above is not vacuous)');
select pg_temp.ok((select min(total) from hid where fn = 'hybrid') >= 5 and (select min(total) from hid where fn = 'helper') >= 4 and (select min(total) from hid where fn = 'helper' and state = 'listing active') = 4, 'every one of those calls returned rows (the helper: the four readable matches)');

-- The helper called directly: ids and consecutive ranks of readable chunks, nothing else.
set local role authenticated;
create temp table direct_h as select * from retrieval_internal.hybrid_keyword_ids('zq4417', null, 'NCLT / NCLAT (Insolvency)');
create temp table direct_h_all as select * from retrieval_internal.hybrid_keyword_ids('zq4417', null, null);
reset role;
create function pg_temp.ids_of_direct() returns uuid[] language sql stable as $$ select array_agg(id) from direct_h $$;
select pg_temp.ok((select array_agg(keyword_rank order by keyword_rank) from direct_h) = array[1, 2, 3]
  and (select array_agg(id) from direct_h) @> pg_temp.cids(array['near3', 'far-nclt', 'far-both']) and (select count(*) from direct_h) = 3
  and pg_temp.cid('far-hidden') <> all (pg_temp.ids_of_direct()),
  'called directly: only the three readable NCLT chunks that have the identifier, ranks 1 to 3 (the hidden one is not returned)');
select pg_temp.ok((select array_agg(id) from direct_h_all) @> pg_temp.cids(array['near3', 'far-nclt', 'far-both', 'far-bill', 'far-state', 'far-pq', 'far-nofeature'])
  and (select count(*) from direct_h_all) = 7,
  'with no feature, every readable indexed and embedded chunk with the identifier');
select pg_temp.ok(not exists (select 1 from direct_h_all h where h.id in (select id from document_chunks where document_id = 'f2000000-0000-4000-8000-000000000003' or embedding is null)),
  'never an unindexed chunk or one without a vector');

-- 4. The helper's copy of the publication rule admits exactly what authenticated can read. The matrix of
-- law_documents_serving_set (every kind of document the rule distinguishes, six listing states), one chunk each
-- with its own word; the helper, asked for all twelve words, must return exactly the chunks authenticated reads,
-- to authenticated and to the callers that bypass RLS alike. Hidden counts per state are those of that fixture.
insert into law_records (id, row_key, record_type, forum, order_date, source_url, row_data, visible) values
  ('e1000000-0000-4000-8000-000000000001', 'fx-visible', 'tribunal_order', 'NCLT', '2026-07-08', 'https://ibbi.gov.in/uploads/order/v.pdf', '{}', true),
  ('e1000000-0000-4000-8000-000000000002', 'fx-hidden', 'tribunal_order', 'NCLT', '2026-07-08', 'https://ibbi.gov.in/uploads/order/h.pdf', '{}', false),
  ('e1000000-0000-4000-8000-000000000003', 'fx-visible-2', 'tribunal_order', 'NCLT', '2026-07-08', 'https://ibbi.gov.in/uploads/order/v2.pdf', '{}', true);
create temp table mx_kinds(n int primary key, source_key text, tier text, metadata jsonb, record uuid);
insert into mx_kinds values
  (1,  'fx-national',                       'national', '{}',                              null),
  (2,  'law:hc:fx/2',                       'law',      '{"origin": "supplied-text"}',     null),
  (3,  'law:trib:IBBI_NCLT:fx-3',           'law',      '{"origin": "supplied-text"}',     'e1000000-0000-4000-8000-000000000001'),
  (4,  'law:trib:IBBI_NCLT:fx-4',           'law',      '{"origin": "supplied-text"}',     'e1000000-0000-4000-8000-000000000002'),
  (5,  'law:trib:IBBI_NCLT:fx-5',           'law',      '{"origin": "supplied-text"}',     null),
  (6,  'law:trib:IBBI_NCLT:fx-6',           'law',      '{"origin": "pdf"}',               null),
  (7,  'law:trib:IBBI_NCLT:fx-7',           'law',      '{}',                              null),
  (8,  'law:trib:IBBI_NCLT:fx-8',           'law',      '{"origin": null}',                null),
  (9,  'x-law:trib:IBBI_NCLT:fx-9',         'law',      '{"origin": "supplied-text"}',     null),
  (10, 'law:trib:IBBI_NCLT:fx-10',          'law',      '{"origin": "Supplied-Text"}',     null),
  (11, 'law:trib:IBBI_NCLT:fx-11',          'law',      '{}',                              'e1000000-0000-4000-8000-000000000003'),
  (12, 'law:trib:ibbi_nclt:fx-12',          'law',      '{"origin": "supplied-text"}',     null);
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, indexed_at, metadata)
select ('e2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, source_key, 'Matrix ' || n, tier,
       case when tier = 'law' then 'NCLT / NCLAT (Insolvency)' else 'Bill Passage Probability Index' end, 'x', 'text', now(), metadata
  from mx_kinds;
insert into law_document_links (document_id, record_id, text_sha256, evidence_sha256)
select ('e2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, record, 'x', repeat('c', 64) from mx_kinds where record is not null;
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, 'mx' || k.n, 1, 0, 4, 'mxword' || lpad(k.n::text, 2, '0'), pg_temp.cone(1, 0.5 + 0.01 * k.n, 900 + k.n), 4
  from mx_kinds k join documents d on d.id = ('e2000000-0000-4000-8000-' || lpad(k.n::text, 12, '0'))::uuid;
create temp table mx_seen(state text, who text, ids uuid[], readable uuid[]);
grant all on mx_seen to authenticated, service_role;
create function pg_temp.mx_check(st text) returns void language plpgsql as $$
declare txt text := (select string_agg('mxword' || lpad(n::text, 2, '0'), ' ' order by n) from mx_kinds); r text; a uuid[]; b uuid[];
begin
  perform set_config('role', 'authenticated', true);
  b := array(select c.id from document_chunks c where c.chunk_hash ~ '^mx[0-9]+$' order by c.id);
  perform set_config('role', 'postgres', true);
  foreach r in array array['authenticated', 'service_role', 'postgres'] loop
    perform set_config('role', r, true);
    a := array(select h.id from retrieval_internal.hybrid_keyword_ids(txt, null, null) h order by h.id);
    perform set_config('role', 'postgres', true);
    insert into mx_seen values (st, r, a, b);
  end loop;
end $$;
update law_listing_settings set seeded = false, active = false;
select pg_temp.mx_check('listing inactive');
update law_listing_settings set seeded = true, active = true;
select pg_temp.mx_check('listing active');
update law_records set visible = false where id = 'e1000000-0000-4000-8000-000000000001';
select pg_temp.mx_check('active, a published order''s record hidden');
delete from law_document_links where record_id = 'e1000000-0000-4000-8000-000000000003';
select pg_temp.mx_check('active, an origin-less order''s link removed');
update law_records set visible = true where id = 'e1000000-0000-4000-8000-000000000002';
select pg_temp.mx_check('active, a hidden record made visible');
update law_listing_settings set active = false;
select pg_temp.mx_check('listing deactivated again');
update law_listing_settings set seeded = true, active = true;
do $$
declare r record;
begin
  for r in select state, who from mx_seen where ids is distinct from readable loop
    raise exception 'FAIL: in state "%" the helper called by % returns other chunks than authenticated can read', r.state, r.who;
  end loop;
  raise notice 'PASS: in all six listing states the helper returns exactly the chunks authenticated reads (matrix of 12 kinds of document), to authenticated, service_role and the owner';
end $$;
select pg_temp.ok((select array_agg(h order by o) from (select 12 - cardinality(readable) as h, case state when 'listing inactive' then 1 when 'listing active' then 2 when 'active, a published order''s record hidden' then 3
                    when 'active, an origin-less order''s link removed' then 4 when 'active, a hidden record made visible' then 5 else 6 end as o from mx_seen where who = 'authenticated') x) = array[0, 4, 5, 6, 5, 0]
  and (select count(distinct readable) from mx_seen where who = 'authenticated') = 5,
  'the matrix is not vacuous: 0, 4, 5, 6, 5 and 0 documents hidden across the six states, five different readable sets');

-- The caller's role and settings are what they were.
set local role authenticated;
select pg_temp.ok(current_setting('role') = 'authenticated' and current_user = 'authenticated' and session_user = 'postgres',
  'after the helper, the caller is still authenticated');
reset role;
select pg_temp.ok(current_setting('hnsw.ef_search') = '40' and current_setting('hnsw.iterative_scan') = 'strict_order',
  'the caller''s ef_search and iterative_scan are restored after every search');
-- The function carries its own search_path (the vector is passed through q, not cast under pg_catalog).
set local search_path = pg_catalog;
set local role authenticated;
select pg_temp.ok((select count(*) from public.match_documents_hybrid((select v from q where name = 'near'), 'zq4417', 5, null, null, 'NCLT / NCLAT (Insolvency)')) = 5,
  'five rows with a caller search_path that names neither public nor extensions');
reset role;
set local search_path = public, extensions;

-- anon is refused by the function and the helper.
set local role anon;
select pg_temp.fails($q$select * from match_documents_hybrid((select v from q where name = 'near'), 'zq4417', 5, null, null, 'NCLT / NCLAT (Insolvency)')$q$, '42501', 'anon cannot search');
select pg_temp.fails($q$select * from retrieval_internal.hybrid_keyword_ids('zq4417', null, null)$q$, '42501', 'anon cannot call the helper (no usage on the schema)');
reset role;

-- ===========================================================================================
-- Part 3. The guards, each against the defect it guards.

-- (a) The plan. The helper's candidate scan reads the GIN index and no chunk partition sequentially. The same
-- predicate written directly as authenticated (the original design) cannot use the index under RLS (the match
-- operator is not leakproof) and scans every partition. Run with seqscan off, so a seq scan means no index path.
create function pg_temp.seq_scans() returns bigint language sql as $$
  select coalesce(sum(pg_stat_get_xact_numscans(c.oid)), 0)::bigint
    from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'public.document_chunks'::regclass
$$;
create function pg_temp.gin_scans() returns bigint language sql as $$
  select coalesce(sum(pg_stat_get_xact_numscans(k.oid)), 0)::bigint from pg_class k where k.relname like 'document_chunks%to_tsvector_idx'
$$;
create function public.hy_direct_probe(q tsquery) returns bigint language sql stable security invoker set search_path = public, extensions as $$
  select count(*) from (select 1 from public.document_chunks where to_tsvector('simple'::regconfig, content) @@ q limit 2001) x
$$;
grant execute on function public.hy_direct_probe(tsquery) to authenticated;
create temp table plan_stats(label text primary key, seq bigint, gin bigint);
grant all on plan_stats to authenticated;
set local enable_seqscan = off;
set local enable_indexscan = on;
set local role authenticated;
do $$
declare s0 bigint; g0 bigint; n bigint;
begin
  -- Two words in no chunk: the helper probes both and stops (no candidate search): the baseline of index scans.
  s0 := pg_temp.seq_scans(); g0 := pg_temp.gin_scans();
  select count(*) into n from retrieval_internal.hybrid_keyword_ids('qqqaaa qqqbbb', null, 'NCLT / NCLAT (Insolvency)');
  insert into plan_stats values ('probes only', pg_temp.seq_scans() - s0, pg_temp.gin_scans() - g0);
  -- Two rare words: the same two probes and the candidate search.
  s0 := pg_temp.seq_scans(); g0 := pg_temp.gin_scans();
  select count(*) into n from retrieval_internal.hybrid_keyword_ids('zq4417 vexilla', null, 'NCLT / NCLAT (Insolvency)');
  insert into plan_stats values ('helper', pg_temp.seq_scans() - s0, pg_temp.gin_scans() - g0);
  s0 := pg_temp.seq_scans(); g0 := pg_temp.gin_scans();
  select public.hy_direct_probe(to_tsquery('simple', 'zq4417 | vexilla')) into n;
  insert into plan_stats values ('direct', pg_temp.seq_scans() - s0, pg_temp.gin_scans() - g0);
end $$;
reset role;
set local enable_seqscan = on;
set local enable_indexscan = off;
select pg_temp.ok((select seq = 0 from plan_stats where label = 'helper') and (select seq = 0 from plan_stats where label = 'probes only')
  and (select gin from plan_stats where label = 'probes only') > 0
  and (select gin from plan_stats where label = 'helper') > (select gin from plan_stats where label = 'probes only'),
  'the helper, called as authenticated: no chunk partition is scanned sequentially, the probes read the GIN index, and so does the candidate search (more index scans than the probes alone)');
select pg_temp.ok((select seq > 0 and gin = 0 from plan_stats where label = 'direct'),
  'the check can fail: the same keyword predicate run directly as authenticated scans the partitions sequentially and never reads the GIN index');

-- (b) anon and the exposure of the schema. Granting anon the schema and the function makes the helper callable:
-- the ACL is what refuses it, and the migration grants neither. (That the API does not expose the schema is
-- checked by run.sh against supabase/config.toml.)
grant usage on schema retrieval_internal to anon;
grant execute on function retrieval_internal.hybrid_keyword_ids(text, text, text) to anon;
select pg_temp.ok(has_schema_privilege('anon', 'retrieval_internal', 'usage') and has_function_privilege('anon', 'retrieval_internal.hybrid_keyword_ids(text, text, text)', 'execute'),
  'the check can fail: once granted, anon holds usage on the schema and execute on the helper');
set local role anon;
create temp table anon_served as select * from retrieval_internal.hybrid_keyword_ids('zq4417', null, null);
reset role;
select pg_temp.ok((select count(*) from anon_served) = 7, 'and is then served (the schema ACL is what refuses it)');
revoke execute on function retrieval_internal.hybrid_keyword_ids(text, text, text) from anon;
revoke usage on schema retrieval_internal from anon;
select pg_temp.ok(not has_schema_privilege('anon', 'retrieval_internal', 'usage') and not has_function_privilege('anon', 'retrieval_internal.hybrid_keyword_ids(text, text, text)', 'execute'),
  'as migrated: anon holds neither');

-- (c) Shadowing. Names a definer function reads must not resolve to the caller's temp objects. A definer function
-- without a fixed search_path (pg_temp implicitly first) is shadowed, for a table and for a type; the helper is not.
create function public.hy_shadowable() returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from document_chunks
$$;
create function public.hy_shadowable_cast() returns text language sql stable security definer set search_path = public as $$
  select '(x)'::tsquery::text
$$;
grant execute on function public.hy_shadowable(), public.hy_shadowable_cast() to authenticated;
set local role authenticated;
create temp table before_shadow as select count(*) as n, (select array_agg(id order by keyword_rank) from retrieval_internal.hybrid_keyword_ids('zq4417 vexilla', null, 'NCLT / NCLAT (Insolvency)')) as ids
  from public.document_chunks;
reset role;
set local role authenticated;
create temp table document_chunks (id uuid, document_id uuid, content text, embedding vector(1536), desk_feature text);
create temp table documents (id uuid, indexed_at timestamptz, desk_tier text);
insert into pg_temp.document_chunks values (gen_random_uuid(), gen_random_uuid(), 'zq4417 forged', null, 'NCLT / NCLAT (Insolvency)');
create type pg_temp.tsquery as (a text);
discard plans;
create temp table shadow_result as
  select public.hy_shadowable() as shadowable, public.hy_shadowable_cast() as shadow_cast,
         (select array_agg(id order by keyword_rank) from retrieval_internal.hybrid_keyword_ids('zq4417 vexilla', null, 'NCLT / NCLAT (Insolvency)')) as ids;
reset role;
drop type pg_temp.tsquery;
discard plans;
select pg_temp.ok((select shadowable = 1 from shadow_result),
  'the check can fail: a definer function with search_path = public reads the caller''s temp table instead of document_chunks');
select pg_temp.ok((select shadow_cast = '(x)' from shadow_result),
  'the check can fail: the same function casts to the caller''s temp type tsquery instead of the catalog''s');
select pg_temp.ok((select ids from shadow_result) = (select ids from before_shadow) and (select ids from before_shadow) is not null
  and (select cardinality(ids) from before_shadow) = 4,
  'with a temp document_chunks, documents and tsquery in place the helper still reads the real tables: its answer is unchanged');

-- (d) Nothing else reaches the helper. No other function, view or policy mentions it (so it has one caller), and the
-- scan can see a caller when there is one.
create function pg_temp.helper_mentions() returns text language sql as $$
  select string_agg(x.what, ', ' order by x.what) from (
    select 'function ' || p.oid::regprocedure::text as what from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.prosrc like '%hybrid_keyword_ids%' and n.nspname !~ '^pg_temp'
       and p.oid <> 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)'::regprocedure
    union all select 'view ' || schemaname || '.' || viewname from pg_views where definition like '%hybrid_keyword_ids%'
    union all select 'policy ' || polname from pg_policy where pg_get_expr(polqual, polrelid) like '%hybrid_keyword_ids%'
  ) x
$$;
select pg_temp.ok((select pg_temp.helper_mentions() is null), 'no function, view or policy other than match_documents_hybrid mentions the helper');
create function public.hy_second_caller() returns bigint language sql stable as $$ select count(*) from retrieval_internal.hybrid_keyword_ids('zq4417', null, null) $$;
select pg_temp.ok((select pg_temp.helper_mentions() = 'function hy_second_caller()' or pg_temp.helper_mentions() like 'function public.hy_second_caller()'), 'the check can fail: a second caller is found');
drop function public.hy_second_caller();
select pg_temp.ok((select pg_temp.helper_mentions() is null), 'and not found once dropped');

-- (e) Default privileges. ALTER DEFAULT PRIVILEGES IN SCHEMA ... REVOKE cannot cancel PostgreSQL's built-in
-- PUBLIC default (tried: no pg_default_acl entry results and a function added later keeps PUBLIC execute), so the
-- migration does not pretend to. What holds, and is asserted: such a function would be unreachable by anon and PUBLIC
-- (no usage on the schema) and the schema holds exactly the helper now; a function added to it must revoke
-- explicitly, as the helper does (the checks at the top: no PUBLIC, no anon execute).
set local role nter_migrator;
create function retrieval_internal.hy_later() returns int language sql as $$ select 1 $$;
reset role;
select pg_temp.ok(not has_schema_privilege('anon', 'retrieval_internal', 'usage')
  and not exists (select 1 from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'retrieval_internal' and a.grantee = 0)
  and (select count(*) from pg_proc where pronamespace = 'retrieval_internal'::regnamespace) = 2,
  'a function added to the schema later is unreachable by anon and PUBLIC (no usage on the schema); it would need its own revoke from authenticated');
drop function retrieval_internal.hy_later();
select pg_temp.ok((select count(*) from pg_proc where pronamespace = 'retrieval_internal'::regnamespace) = 1, 'and the schema again holds exactly the helper');

commit;
