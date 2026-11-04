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
--           Also: oversized text, quotes and backslashes in the text, that no other function mentions
--           the helper, that ts_rank_cd is applied only after the rule and the word budget, and that the
--           budget holds (the rarest words whose readable counts fit in 2000 are kept, digit-bearing words
--           first, and every match of them is ranked, so the best match is kept).
--   Part 3  the guards, each proved against the defect it guards: the helper's plan reads the GIN
--           index and never scans a chunk partition sequentially (a direct keyword query as
--           authenticated does); anon is refused by the schema's ACL (and is served once granted);
--           a temp table or type cannot shadow what the helper reads (a function without the fixed
--           search_path is shadowed); and the helper refuses to run when an access policy on documents or
--           document_chunks (text, name, role, mode, a new one) no longer is the one its copy of the rule
--           was written against, with a terse error that names nothing internal, also for the empty-text
--           call the migration makes as its last statement.
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
  and to_regprocedure('retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text)') is not null,
  'match_documents_hybrid(...) and retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text) exist');

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
                          and pg_get_function_result(p.oid) = 'TABLE(list_name text, id uuid, list_rank integer)'
                     from pg_proc p where p.oid = 'retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text)'::regprocedure),
  'the helper is a stable security definer returning (list_name text, id uuid, list_rank integer), search_path pg_catalog, pg_temp, force_custom_plan');
select pg_temp.ok(has_function_privilege('authenticated', 'retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text)', 'execute')
  and has_function_privilege('service_role', 'retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text)', 'execute')
  and not has_function_privilege('anon', 'retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text)'::regprocedure and a.grantee = 0),
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
                    where p.oid = 'retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text)'::regprocedure
                      and c.oid in ('public.document_chunks'::regclass, 'public.documents'::regclass)),
  'the helper''s owner owns (or is a member of the owner of) document_chunks and documents, so its candidate scan is not filtered by RLS');

-- The constants the measurement chose (docs/research/2026-11-02-hybrid-search.md).
select pg_temp.ok((select position('c_rrf_k constant int := 60;' in prosrc) > 0 and position('c_candidates constant int := 100;' in prosrc) > 0
                          and position('c_nclt constant text := ''NCLT / NCLAT (Insolvency)'';' in prosrc) > 0
                     from pg_proc where oid = 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)'::regprocedure)
  and (select position('c_rare_df_max constant int := 300;' in prosrc) > 0 and position('c_query_max constant int := 4000;' in prosrc) > 0 and position('c_match_budget constant int := 2000;' in prosrc) > 0
              and position('c_candidates constant int := 100;' in prosrc) > 0 and position('c_max_terms constant int := 64;' in prosrc) > 0
              and position('c_name_df_max constant int := 50;' in prosrc) > 0 and position('c_month_max_chunks constant int := 20000;' in prosrc) > 0
         from pg_proc where oid = 'retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text)'::regprocedure),
  'pinned: fusion constant 60, 100 candidates a list, NCLT only; rare = in at most 300 readable chunks, 64 terms, 4000 characters of text, a word budget of 2000 readable chunks; a name is in the title of at most 50 readable documents; a month has no list above 20,000 chunks');

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
  ('f1000000-0000-4000-8000-000000000001', 'hy-nclt-a', 'NCLT A zq4417 vexilla padword probeword zorbaxan quillfeather edgeb edgehid capw1 capw2 capw3 capw4 capw5 capw6 capw7 capw8', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'a', 4, now(), '{}'),
  ('f1000000-0000-4000-8000-000000000002', 'hy-nclt-b', 'NCLT B zq4417 vexilla padword probeword zorbaxan quillfeather edgeb edgehid capw1 capw2 capw3 capw4 capw5 capw6 capw7 capw8', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'a', 4, now(), '{}'),
  ('f1000000-0000-4000-8000-000000000003', 'law:trib:IBBI_NCLT:hy-hidden', 'Hidden NCLT hiddentitleword gatefifty', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'a', 4, now(), '{"origin": "supplied-text"}'),
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
-- The word budget. 'capw1'..'capw3' are each in 200 readable NCLT chunks and 'capw4'..'capw8' each in 290, 2050 readable
-- chunks in all, more than the budget of 2000. The budget keeps capw1..capw7 (200 x 3 + 290 x 4 = 1760) and not capw8 (290
-- more). capw8's chunks are the NEAREST to the question of all of them (distance 0.90, the others 0.93 and more), so if capw8
-- were kept they would head the keyword list; with the words in the titles of A and B, every capw word is a name.
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, 'capw' || x.j, 9000 + x.j, 0, 4, 'capw' || x.w || case when x.w = 8 then ' capw8' else '' end,
       pg_temp.cone(1, case when x.w = 8 then 0.90 + 0.00002 * (x.j - 1760) else 0.93 + 0.00003 * x.j end, 3000 + x.j), 4
  from (select j, case when j <= 600 then (j - 1) / 200 + 1 else (j - 601) / 290 + 4 end as w from generate_series(1, 2050) j) x
  join documents d on d.id = (case when x.j % 2 = 1 then 'f1000000-0000-4000-8000-000000000001' else 'f1000000-0000-4000-8000-000000000002' end)::uuid;

-- Round 2. The title gate: a rare word is searched only if it is in the title of 1 to 50 documents the caller can read.
-- A and B carry the words above in their titles (2 documents each). Two words for the boundary: 'gatefifty' is in the titles
-- of 50 readable orders and of the unpublished one (51 if that were counted), 'gatefiftyone' in 51 readable titles; each
-- readable order has one chunk with both words. 'hiddentitleword' is in the unpublished order's title only (and in a
-- chunk of A), 'unidxtitleword' in an unindexed order's title only (and in a chunk of A): neither is a name.
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at, metadata)
select ('f6000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'hy-gate-' || i,
       'Gate doc ' || i || case when i <= 50 then ' gatefifty' else '' end || ' gatefiftyone', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'a', 4, now(), '{}'
  from generate_series(1, 51) i;
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, 'gate' || i, 11000 + i, 0, 4, 'gatefifty gatefiftyone gatechunk ' || i, pg_temp.cone(1, 0.85 + 0.001 * i, 5000 + i), 4
  from generate_series(1, 51) i
  join documents d on d.id = ('f6000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, v.h, v.i, 0, 4, v.content, pg_temp.cone(1, v.dist, 5100 + v.i), 4
  from (values ('f1000000-0000-4000-8000-000000000003', 'gate-hidden', 11100, 'gatefifty in the unpublished order', 0.83),
               ('f1000000-0000-4000-8000-000000000001', 'far-hiddentitle', 11101, 'hiddentitleword is only in a hidden title', 0.84),
               ('f1000000-0000-4000-8000-000000000001', 'far-unidxtitle', 11102, 'unidxtitleword is only in an unindexed title', 0.845)) v(doc, h, i, content, dist)
  join documents d on d.id = v.doc::uuid;
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at, metadata) values
  ('f6000000-0000-4000-8000-000000000101', 'hy-gate-unindexed', 'Unindexed order unidxtitleword', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'a', 4, null, '{}');

-- Round 2. The month list: an NCLT order for each month of 2024 dated the 15th (June has 130 chunks, March 90, the others 2),
-- the boundary days 2024-02-29 and 2024-04-01, March 2023, an unpublished order dated 2024-03-20 (30 chunks, NEARER to
-- the question than the readable ones, so a leak would head the list), an unindexed order dated 2024-03-05 (5 chunks, also
-- nearer), and a Bills document dated 2024-03-12 (another feature). The month chunks are vector-far (distance 0.75 and more).
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at, metadata)
select ('f5000000-0000-4000-8000-' || lpad(m::text, 12, '0'))::uuid, 'hy-month-' || m, 'Month doc ' || m, 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'a', 4, now(),
       jsonb_build_object('citation', jsonb_build_object('order_date', format('2024-%s-15', lpad(m::text, 2, '0'))))
  from generate_series(1, 12) m;
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at, metadata) values
  ('f5000000-0000-4000-8000-000000000101', 'hy-month-feb29', 'Month doc feb29', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'a', 4, now(), '{"citation": {"order_date": "2024-02-29"}}'),
  ('f5000000-0000-4000-8000-000000000102', 'hy-month-apr01', 'Month doc apr01', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'a', 4, now(), '{"citation": {"order_date": "2024-04-01"}}'),
  ('f5000000-0000-4000-8000-000000000103', 'hy-month-2023', 'Month doc 2023', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'a', 4, now(), '{"citation": {"order_date": "2023-03-15"}}'),
  ('f5000000-0000-4000-8000-000000000104', 'law:trib:IBBI_NCLT:hy-month-hidden', 'Month hidden', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'a', 4, now(), '{"origin": "supplied-text", "citation": {"order_date": "2024-03-20"}}'),
  ('f5000000-0000-4000-8000-000000000105', 'hy-month-unindexed', 'Month unindexed', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'a', 4, null, '{"citation": {"order_date": "2024-03-05"}}'),
  ('f2000000-0000-4000-8000-000000000011', 'hy-month-bill', 'Month bill', 'national', 'Bill Passage Probability Index', 'x', 'a', 4, now(), '{"citation": {"introduced_on": "2024-03-12"}}');
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, 'mo-' || mo.sk || '-' || k, 12000 + k, 0, 4, 'monthrow ' || k, pg_temp.cone(1, mo.base + 0.0007 * k, 6000 + k + 1000 * length(mo.sk)), 4
  from (select 'hy-month-' || m as sk, case m when 3 then 90 when 6 then 130 else 2 end as n, 0.75 as base from generate_series(1, 12) m
        union all select * from (values ('hy-month-feb29', 2, 0.75), ('hy-month-apr01', 2, 0.75), ('hy-month-2023', 2, 0.75),
                                        ('law:trib:IBBI_NCLT:hy-month-hidden', 30, 0.50), ('hy-month-unindexed', 5, 0.55), ('hy-month-bill', 1, 0.75)) z(sk, n, base)) mo
  join documents d on d.source_key = mo.sk
 cross join lateral generate_series(1, mo.n) k;
analyze documents; analyze document_chunks;

update law_listing_settings set seeded = true, active = true;
create temp table q(name text primary key, v vector);
insert into q values ('near', pg_temp.cone(1, 0, 0)), ('side', pg_temp.cone(1, 0.3, 77));
grant select on q to authenticated, service_role, anon;
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

-- The oracle for an NCLT feature search: three-list reciprocal rank fusion, k = 60, weight 1, in plain SQL, as the invoking
-- role (so every count, title and chunk is the caller's: nothing hidden can enter). Vector side: match_documents' own 100
-- rows. Keyword side: the first 4000 characters of the text; at most 64 terms are looked at (a digit first, then the
-- longest); a term is rare when it is in 1 to 300 chunks the caller can read; of the rare terms, those with a digit first,
-- then the others, each group by ascending count (ties by the term), a term is kept when the kept terms' counts stay
-- within 2000; of the kept terms, those in the title of 1 to 50 indexed NCLT documents the caller can read are names; the
-- nearest 100 chunks (halfvec cosine distance, ties by id) of the scope matching the OR of the names. Month side: the first
-- "<month> <year>" of the text (a table of month names, the pair found by a scan of the lower-cased text), the nearest 100
-- chunks of the scope whose facet date is in that month. Ranked 1..n in each list.
create temp table month_names(name text primary key, m int);
insert into month_names values ('january', 1), ('jan', 1), ('february', 2), ('feb', 2), ('march', 3), ('mar', 3), ('april', 4), ('apr', 4),
  ('may', 5), ('june', 6), ('jun', 6), ('july', 7), ('jul', 7), ('august', 8), ('aug', 8), ('september', 9), ('sept', 9), ('sep', 9),
  ('october', 10), ('oct', 10), ('november', 11), ('nov', 11), ('december', 12), ('dec', 12);
grant select on month_names to authenticated, service_role;
create function pg_temp.oracle_month(qtext text) returns date language sql stable as $$
  select make_date(r.mt[2]::int, mn.m, 1)
    from regexp_matches(lower(left(qtext, 4000)), '(?:^|[^a-z0-9_])([a-z]+)\.?,?\s+(?:of\s+)?((?:19|20)[0-9][0-9])(?![a-z0-9_])', 'g') with ordinality r(mt, o)
    join month_names mn on mn.name = r.mt[1]
   order by r.o limit 1
$$;
create function pg_temp.oracle(qv text, qtext text, n int, tier text) returns uuid[] language plpgsql as $$
declare
  c_nclt constant text := 'NCLT / NCLAT (Insolvency)';
  v_n int := least(greatest(coalesce(n, 40), 1), 200);
  v_qv vector := (select v from q where name = qv);
  v_q tsquery; v_vec uuid[]; v_kw uuid[] := '{}'; v_mo uuid[] := '{}'; v_res uuid[];
  v_used int := 0; v_kept text[] := '{}'; w record; v_titles int; v_from date;
begin
  for w in
    select r.lex, r.df
      from (select t.lex, (select count(*) from (select 1 from document_chunks c where to_tsvector('simple'::regconfig, c.content) @@ quote_literal(t.lex)::tsquery limit 301) z) as df
              from (select x.lex from (select distinct unnest(tsvector_to_array(to_tsvector('simple'::regconfig, left(qtext, 4000)))) as lex) x
                     order by (x.lex ~ '[0-9]') desc, length(x.lex) desc, x.lex limit 64) t) r
     where r.df between 1 and 300
     order by (r.lex ~ '[0-9]') desc, r.df, r.lex
  loop
    if v_used + w.df <= 2000 then
      v_used := v_used + w.df;
      select count(*) into v_titles from documents d
       where d.desk_feature = c_nclt and d.indexed_at is not null and to_tsvector('simple'::regconfig, d.title) @@ quote_literal(w.lex)::tsquery;
      if v_titles between 1 and 50 then v_kept := v_kept || quote_literal(w.lex); end if;
    end if;
  end loop;
  v_q := nullif(array_to_string(v_kept, ' | '), '')::tsquery;
  if v_q is not null then
    v_kw := array(select c.id from document_chunks c join documents d on d.id = c.document_id
                   where c.desk_feature = c_nclt and c.embedding is not null and d.indexed_at is not null
                     and (tier is null or d.desk_tier = tier) and to_tsvector('simple'::regconfig, c.content) @@ v_q
                   order by (c.embedding::halfvec(1536)) <=> (v_qv::halfvec(1536)), c.id limit 100);
  end if;
  v_from := pg_temp.oracle_month(qtext);
  if v_from is not null then
    v_mo := array(select c.id from document_chunks c join documents d on d.id = c.document_id
                   where c.desk_feature = c_nclt and c.embedding is not null and d.indexed_at is not null
                     and (tier is null or d.desk_tier = tier) and c.doc_date >= v_from and c.doc_date < (v_from + interval '1 month')::date
                   order by (c.embedding::halfvec(1536)) <=> (v_qv::halfvec(1536)), c.id limit 100);
  end if;
  if cardinality(v_kw) = 0 and cardinality(v_mo) = 0 then
    return pg_temp.idsof(pg_temp.v(qv, v_n, null, tier, c_nclt));
  end if;
  v_vec := pg_temp.idsof(pg_temp.v(qv, 100, null, tier, c_nclt));
  with vec as (select e.id, e.o as rn from unnest(coalesce(v_vec, '{}')) with ordinality e(id, o)),
       kw as (select e.id, e.o as rn from unnest(v_kw) with ordinality e(id, o)),
       mo as (select e.id, e.o as rn from unnest(v_mo) with ordinality e(id, o)),
       fused as (select u.id, v.rn vr, k.rn kr, m.rn mr,
                        coalesce(1.0 / (60 + v.rn), 0) + coalesce(1.0 / (60 + k.rn), 0) + coalesce(1.0 / (60 + m.rn), 0) score
                   from (select id from vec union select id from kw union select id from mo) u
                   left join vec v on v.id = u.id left join kw k on k.id = u.id left join mo m on m.id = u.id)
  select array_agg(id order by score desc, vr nulls last, kr nulls last, mr nulls last, id) into v_res
    from (select * from fused order by score desc, vr nulls last, kr nulls last, mr nulls last, id limit v_n) f;
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
  ('oversize-huge',    'near', repeat('qqqq ', 40000) || 'zq4417', 40,  null),
  -- The word budget (the capw words, see the seed): more readable matches than 2000; capw8 does not fit.
  ('budget-best',      'near', 'capw1 capw2 capw3 capw4 capw5 capw6 capw7 capw8', 40, null),
  ('budget-mixed',     'near', 'capw8 capw7 capw6 capw5 capw4 capw3 capw2 capw1 zq4417 vexilla', 40, null);
insert into nclt_cases select 'cap-full', 'near', 'zq4417 ' || string_agg('nonexistentword' || lpad(i::text, 3, '0'), ' '), 40, null from generate_series(1, 70) i;
insert into nclt_cases select 'cap-edge', 'near', 'zq4417 ' || string_agg('nonexistentword' || lpad(i::text, 3, '0'), ' '), 40, null from generate_series(1, 63) i;
-- Round 2: the name gate (change B) and the month list (change C).
insert into nclt_cases values
  ('stray-only',          'near', 'passage',                                  40,  null),
  ('gate-fifty',          'near', 'gatefifty',                                200, null),
  ('gate-fiftyone',       'near', 'gatefiftyone',                             40,  null),
  ('gate-hidden-title',   'near', 'hiddentitleword',                          40,  null),
  ('gate-unindexed-title','near', 'unidxtitleword',                           40,  null),
  ('gate-two',            'near', 'zq4417 gatefifty',                         200, null),
  ('gate-all',            'near', 'zq4417 gatefifty gatefiftyone hiddentitleword unidxtitleword passage', 200, null),
  ('month-march',         'near', 'march 2024',                               200, null),
  ('month-march-id',      'near', 'in March of 2024 zq4417',                  40,  null),
  ('month-june',          'near', 'June 2024',                                40,  null),
  ('month-june-200',      'near', 'June 2024',                                200, null),
  ('month-tier-law',      'near', 'mar 2024',                                 40,  'law'),
  ('month-side',          'side', 'March 2024 vexilla',                       40,  null),
  ('month-sept',          'near', 'Sept. 2024',                               40,  null),
  ('month-no-year',       'near', 'in march of the year',                     40,  null),
  ('month-year-2023',     'near', 'march 2023',                               40,  null),
  ('month-first-wins',    'near', 'february 2024 and march 2024',             40,  null),
  ('month-dec',           'near', 'dec 2024',                                 40,  null),
  ('month-with-gate',     'near', 'gatefifty june 2024',                      200, null),
  ('month-feb-boundary',  'near', 'February 2024',                            40,  null),
  ('month-apr-boundary',  'near', 'April 2024',                               40,  null);
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

-- Round 2, change B: only names search. A rare word that is in no title (or in more than 50, or only in the title of an
-- unpublished or an unindexed order) adds nothing: the answer is the one without it.
select pg_temp.ok((select got from nclt_got where label = 'rare-passage') = (select got from nclt_got where label = 'identifier')
  and (select got from nclt_got where label = 'stray-only') = (select ids from vec_ref where label = 'nclt-40'),
  'a rare word that is in no title ("passage", 160 chunks) is not searched: alone it is the vector result, with a name the name''s rows');
select pg_temp.ok((select got from nclt_got where label = 'gate-fifty') is distinct from (select ids from vec_ref where label = 'nclt-40')
  and (select got from nclt_got where label = 'gate-fifty') @> (select array_agg(c.id) from document_chunks c where c.chunk_hash ~ '^gate[0-9]+$')
  and not ((select got from nclt_got where label = 'gate-fifty') @> array[pg_temp.cid('gate-hidden')]),
  'the boundary of the gate: a word in the titles of 50 readable orders (51 with the unpublished order''s) is a name, and its chunks are returned (not the unpublished order''s)');
select pg_temp.ok((select got from nclt_got where label = 'gate-fiftyone') = (select ids from vec_ref where label = 'nclt-40'),
  'a word in 51 readable titles is not a name: the vector result');
select pg_temp.ok((select got from nclt_got where label = 'gate-hidden-title') = (select ids from vec_ref where label = 'nclt-40')
  and (select got from nclt_got where label = 'gate-unindexed-title') = (select ids from vec_ref where label = 'nclt-40'),
  'a word whose only title is an unpublished order''s, or an unindexed order''s, is not a name (the readable chunk that has it is not returned)');
select pg_temp.ok((select got from nclt_got where label = 'gate-all') = (select got from nclt_got where label = 'gate-two'),
  'in a text of names and non-names, only the names search');

-- Round 2, change A: the keyword candidates are the nearest to the question, not those a text score or an id would pick.
-- 'padword' is in 150 readable chunks, the nearest 100 by distance (the helper takes them by halfvec distance, ties by id) are
-- not the first 100 by id.
create temp table pad_order as
  select (select array_agg(x.id order by x.d, x.id)
            from (select c.id, (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'near')::halfvec(1536)) as d
                    from document_chunks c where c.chunk_hash ~ '^pad[0-9]+$' order by 2, 1 limit 100) x) as near100,
         (select array_agg(id order by id) from (select id from document_chunks where chunk_hash ~ '^pad[0-9]+$' order by id limit 100) y) as id100;
set local role authenticated;
create temp table pad_got as
  select (select array_agg(id order by list_rank) from retrieval_internal.hybrid_candidate_ids('padword', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)') where list_name = 'keyword') as ids,
         (select array_agg(list_rank order by list_rank) from retrieval_internal.hybrid_candidate_ids('padword', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)') where list_name = 'keyword') as ranks;
reset role;
select pg_temp.ok((select ids from pad_got) = (select near100 from pad_order)
  and (select ranks from pad_got) = (select array_agg(i) from generate_series(1, 100) i)
  and (select array_agg(u order by u) from unnest((select near100 from pad_order)) u) is distinct from (select id100 from pad_order),
  'the keyword list is the 100 chunks nearest to the question (150 match), best first, ranks 1 to 100, and not the first 100 by id');

-- Round 2, change C: the month list. What it holds, per spelling, for a table of texts (accepted spellings of every month
-- and year, and texts that must not parse). Expected: the readable chunks of NCLT orders dated in that month of that year.
create temp table parse_cases(txt text, y int, m int);
insert into parse_cases values
  ('January 2024', 2024, 1), ('jan 2024', 2024, 1), ('FEBRUARY 2024', 2024, 2), ('feb. 2024', 2024, 2), ('March 2024', 2024, 3), ('mar 2024', 2024, 3),
  ('April, 2024', 2024, 4), ('apr 2024', 2024, 4), ('May 2024', 2024, 5), ('JUNE 2024', 2024, 6), ('Jun 2024', 2024, 6), ('july 2024', 2024, 7),
  ('Jul 2024', 2024, 7), ('August 2024', 2024, 8), ('aug 2024', 2024, 8), ('September 2024', 2024, 9), ('sep 2024', 2024, 9), ('Sept. 2024', 2024, 9),
  ('October 2024', 2024, 10), ('oct 2024', 2024, 10), ('November 2024', 2024, 11), ('nov 2024', 2024, 11), ('December 2024', 2024, 12), ('dec 2024', 2024, 12),
  ('in March of 2024', 2024, 3), ('Order of  March,   2024 etc', 2024, 3), (E'March\n2024', 2024, 3), ('(March 2024)', 2024, 3), ('dated 15 March 2024.', 2024, 3),
  ('march 2023', 2023, 3), ('february 2024 and march 2024', 2024, 2), ('may 2024 march 2025', 2024, 5), ('march march 2024', 2024, 3),
  ('march 24', null, null), ('march2024', null, null), ('marching 2024', null, null), ('mayor 2024', null, null), ('marc 2024', null, null),
  ('march 20245', null, null), ('march 2024x', null, null), ('march 1899', null, null), ('march 2100', null, null), ('maybe 2024', null, null),
  ('octopus 2024', null, null), ('decade 2024', null, null), ('augusta 2024', null, null), ('novel 2024', null, null), ('jane 2024', null, null),
  ('sapt 2024', null, null), ('xmarch 2024', null, null), ('_march 2024', null, null), ('march-2024', null, null), ('march and april', null, null), ('2024', null, null);
grant select on parse_cases to authenticated;
set local role authenticated;
create temp table parse_got as
  select c.txt, c.y, c.m,
         (select coalesce(array_agg(h.id order by h.id), '{}') from retrieval_internal.hybrid_candidate_ids(c.txt, (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)') h where h.list_name = 'month') as got,
         case when c.m is null then '{}'::uuid[]
              else (select coalesce(array_agg(x.id order by x.id), '{}') from document_chunks x join documents xd on xd.id = x.document_id
                     where x.desk_feature = 'NCLT / NCLAT (Insolvency)' and x.embedding is not null and xd.indexed_at is not null
                       and x.doc_date >= make_date(c.y, c.m, 1) and x.doc_date < (make_date(c.y, c.m, 1) + interval '1 month')::date) end as want
    from parse_cases c;
reset role;
do $$
declare r record;
begin
  for r in select * from parse_got where (m is null and cardinality(got) <> 0)
                                      or (m is not null and m <> 6 and (got is distinct from want or cardinality(want) = 0))
                                      or (m = 6 and (cardinality(got) <> 100 or not got <@ want)) loop
    raise exception 'FAIL: the month list of %: got % rows, want % rows', r.txt, cardinality(r.got), cardinality(r.want);
  end loop;
  raise notice 'PASS: the month is parsed from % texts: every month name and abbreviation, with a comma, a full stop, "of", spaces and a newline, the first pair wins, and texts that are not a month and a four-digit year (1900 to 2099) give no list', (select count(*) from parse_got);
end $$;
select pg_temp.ok((select count(*) from parse_got where m is not null) >= 30 and (select count(distinct m) from parse_got) = 12 and (select count(*) from parse_got where m is null) >= 20
  and (select min(cardinality(want)) from parse_got where m is not null) >= 2,
  'the table is not vacuous: 12 months and the rejected texts, every accepted one expecting rows');
-- The cut and the exclusions: March 2024 holds 90 readable chunks (and 30 unpublished and 5 unindexed ones, nearer to the
-- question, and a Bills chunk of that date), June 130.
create temp table month_expect as
  select (select array_agg(id order by id) from document_chunks where chunk_hash ~ '^mo-hy-month-3-[0-9]+$') as march,
         (select array_agg(id order by id) from document_chunks where chunk_hash ~ '^mo-hy-month-6-[0-9]+$') as june,
         (select array_agg(x.id) from (select c.id from document_chunks c where c.chunk_hash ~ '^mo-hy-month-6-[0-9]+$'
                                        order by (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'near')::halfvec(1536)), c.id limit 100) x) as june100;
select pg_temp.ok((select cardinality(march) = 90 and cardinality(june) = 130 from month_expect), 'the month seed: 90 readable March chunks, 130 June');
select pg_temp.ok((select got from nclt_got where label = 'month-march') @> (select march from month_expect)
  and (select cardinality(march) from month_expect) = (select count(*) from unnest((select got from nclt_got where label = 'month-march')) u where u <> all (pg_temp.vecref('nclt-100'))) ,
  'March 2024: the month list brings in the 90 readable March chunks and nothing else (the unpublished order''s 30 and the unindexed order''s 5, nearer to the question, are not in the answer)');
select pg_temp.ok((select got from nclt_got where label = 'month-june-200') @> (select june100 from month_expect)
  and (select count(*) from unnest((select got from nclt_got where label = 'month-june-200')) u where u <> all (pg_temp.vecref('nclt-100'))) = 100,
  'June 2024 (130 chunks): the month list is cut to the nearest 100');
select pg_temp.ok((select got from nclt_got where label = 'month-no-year') = (select ids from vec_ref where label = 'nclt-40'),
  'a month without a year is no list: the vector result');
select pg_temp.ok((select got from nclt_got where label = 'month-march') is distinct from (select ids from vec_ref where label = 'nclt-40')
  and (select got from nclt_got where label = 'month-year-2023') is distinct from (select got from nclt_got where label = 'month-march')
  and (select got from nclt_got where label = 'month-first-wins') = (select got from nclt_got where label = 'month-feb-boundary'),
  'the month list changes the answer, the year matters, and the first month of a text is the one used');
select pg_temp.ok(not ((select got from nclt_got where label = 'month-march') && (select array_agg(id) from document_chunks where chunk_hash ~ '^mo-(hy-month-(feb29|apr01|2023|bill)|law:trib:IBBI_NCLT:hy-month-hidden|hy-month-unindexed)-')),
  'only the month: 29 February, 1 April, March 2023, a Bills document of March 2024, an unpublished order, an unindexed order are not in the March list');
-- The fusion adds the month list as a third list, which is a list and not a filter: a chunk of another month stays in the
-- answer when the vector side has it.
select pg_temp.ok(exists (select 1 from unnest((select got from nclt_got where label = 'month-march')) u where u = any (pg_temp.vecref('nclt-100'))),
  'the month list is fused, not a filter: chunks of the vector side outside the month remain');

-- The cap on a month (c_month_max_chunks, 20,000, cannot be seeded): variants of the helper with a cap of 90 and of 89, made
-- from the helper's own definition, show what the cap counts. March 2024 has 90 readable chunks and, besides, 30 unpublished
-- and 5 unindexed ones: at 90 it has a list (the cap is inclusive and counts readable, indexed chunks only), at 89 it has none;
-- June (130) has none at 90; the real helper gives March 90 and June 100.
create function pg_temp.make_cap_variant(nm text, cap int) returns void language plpgsql as $$
declare d text := pg_get_functiondef('retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text)'::regprocedure);
begin
  if position('c_month_max_chunks constant int := 20000;' in d) = 0 then raise exception 'FAIL: the cap is not where the fixture expects it'; end if;
  execute replace(replace(d, 'retrieval_internal.hybrid_candidate_ids', 'pg_temp.' || nm), 'c_month_max_chunks constant int := 20000;', 'c_month_max_chunks constant int := ' || cap || ';');
end $$;
select pg_temp.make_cap_variant('hy_cap90', 90);
select pg_temp.make_cap_variant('hy_cap89', 89);
set local role authenticated;
create temp table cap_month as
  select (select count(*) from pg_temp.hy_cap90('march 2024', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)') where list_name = 'month') as march90,
         (select count(*) from pg_temp.hy_cap89('march 2024', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)') where list_name = 'month') as march89,
         (select count(*) from pg_temp.hy_cap90('june 2024', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)') where list_name = 'month') as june90,
         (select count(*) from retrieval_internal.hybrid_candidate_ids('march 2024', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)') where list_name = 'month') as march,
         (select count(*) from retrieval_internal.hybrid_candidate_ids('june 2024', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)') where list_name = 'month') as june;
reset role;
select pg_temp.ok((select row(march90, march89, june90, march, june)::text from cap_month) = '(90,0,0,90,100)',
  'the cap on a month: inclusive, counted over readable indexed chunks only (90 of 125 in March), a month above it has no list');

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
  a := array(select id from retrieval_internal.hybrid_candidate_ids('zq4417 vexilla', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)'));
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

-- Round 2: the month list and the title gate hide the same orders. The unpublished order (dated 2024-03-20, 30 chunks nearer
-- to the question than the readable ones) is in no caller's month list while the listing is active; with the listing off it
-- is, and then 'gatefifty' (50 readable titles + its title) is no longer a name and 'hiddentitleword' becomes one.
create temp table hid2(state text, who text, month_hidden int, month_unidx int, month_total int, gate_rows int, title_rows int);
grant all on hid2 to authenticated, service_role;
create function pg_temp.hid2_rows(st text, rl text) returns void language plpgsql as $$
declare vq vector := (select v from q where name = 'near');
        hid_ids uuid[] := array(select id from document_chunks where chunk_hash ~ '^mo-law:trib:IBBI_NCLT:hy-month-hidden-[0-9]+$');
        unidx_ids uuid[] := array(select id from document_chunks where chunk_hash ~ '^mo-hy-month-unindexed-[0-9]+$');
        m uuid[]; g int; t int;
begin
  perform set_config('role', rl, true);
  m := array(select h.id from retrieval_internal.hybrid_candidate_ids('march 2024', vq, null, 'NCLT / NCLAT (Insolvency)') h where h.list_name = 'month');
  g := (select count(*) from retrieval_internal.hybrid_candidate_ids('gatefifty', vq, null, 'NCLT / NCLAT (Insolvency)') h where h.list_name = 'keyword');
  t := (select count(*) from retrieval_internal.hybrid_candidate_ids('hiddentitleword', vq, null, 'NCLT / NCLAT (Insolvency)') h where h.list_name = 'keyword');
  perform set_config('role', 'postgres', true);
  insert into hid2 values (st, rl, (select count(*) from unnest(m) u where u = any (hid_ids)), (select count(*) from unnest(m) u where u = any (unidx_ids)), cardinality(m), g, t);
end $$;
select pg_temp.hid2_rows('listing active', 'authenticated');
select pg_temp.hid2_rows('listing active', 'service_role');
select pg_temp.hid2_rows('listing active', 'postgres');
update law_listing_settings set active = false;
select pg_temp.hid2_rows('listing off', 'authenticated');
update law_listing_settings set active = true;
select pg_temp.ok((select array_agg(row(who, month_hidden, month_unidx, month_total, gate_rows, title_rows)::text order by who) from hid2 where state = 'listing active')
  = array['(authenticated,0,0,90,51,0)', '(postgres,0,0,90,51,0)', '(service_role,0,0,90,51,0)'],
  'listing active: the month list is the 90 readable March chunks, without the unpublished order''s 30 or the unindexed order''s 5, for authenticated and for the callers that bypass RLS; "gatefifty" is a name (51 chunk rows) and "hiddentitleword" is not');
select pg_temp.ok((select row(month_hidden, month_unidx, month_total, gate_rows, title_rows)::text from hid2 where state = 'listing off') = '(30,0,100,0,1)',
  'listing off: the month list (100 of 120) holds the 30 unpublished chunks, which head it (an unindexed order''s never), "gatefifty" is in 51 readable titles and no longer a name, and "hiddentitleword" is now a name (the hiding above is not vacuous)');

-- The helper called directly: ids and consecutive ranks of readable chunks, nothing else.
set local role authenticated;
create temp table direct_h as select * from retrieval_internal.hybrid_candidate_ids('zq4417', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)');
create temp table direct_h_all as select * from retrieval_internal.hybrid_candidate_ids('zq4417', (select v from q where name = 'near'), null, null);
reset role;
create function pg_temp.ids_of_direct() returns uuid[] language sql stable as $$ select array_agg(id) from direct_h $$;
select pg_temp.ok((select array_agg(list_rank order by list_rank) from direct_h where list_name = 'keyword') = array[1, 2, 3] and (select count(*) from direct_h where list_name <> 'keyword') = 0
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
select ('e2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, source_key, 'Matrix ' || n || ' mxword' || lpad(n::text, 2, '0'), tier,
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
    a := array(select h.id from retrieval_internal.hybrid_candidate_ids(txt, (select v from q where name = 'near'), null, null) h order by h.id);
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
select pg_temp.fails($q$select * from retrieval_internal.hybrid_candidate_ids('zq4417', (select v from q where name = 'near'), null, null)$q$, '42501', 'anon cannot call the helper (no usage on the schema)');
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
  select count(*) into n from retrieval_internal.hybrid_candidate_ids('qqqaaa qqqbbb', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)');
  insert into plan_stats values ('probes only', pg_temp.seq_scans() - s0, pg_temp.gin_scans() - g0);
  -- Two rare words: the same two probes and the candidate search.
  s0 := pg_temp.seq_scans(); g0 := pg_temp.gin_scans();
  select count(*) into n from retrieval_internal.hybrid_candidate_ids('zq4417 vexilla', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)');
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
-- The rank lookup reads only the scope's partition: an NCLT search scans no btree index of another partition (the probes
-- read every partition's keyword index, which is GIN and not counted here). The earlier lookup, by id with IS NOT DISTINCT
-- FROM on the feature, could not prune and probed every partition's key for each row. A call with no feature, whose
-- matches are in three partitions, shows that the count sees such lookups.
create function pg_temp.other_btree_scans() returns bigint language sql as $$
  select coalesce(sum(pg_stat_get_xact_numscans(i.indexrelid)), 0)::bigint
    from pg_inherits h join pg_class p on p.oid = h.inhrelid join pg_index i on i.indrelid = p.oid
    join pg_class k on k.oid = i.indexrelid join pg_am am on am.oid = k.relam
   where h.inhparent = 'public.document_chunks'::regclass and am.amname = 'btree'
     and pg_get_expr(p.relpartbound, p.oid) <> 'FOR VALUES IN (''NCLT / NCLAT (Insolvency)'')'
$$;
create temp table prune_stats(label text primary key, other bigint, n bigint);
grant all on prune_stats to authenticated;
set local enable_seqscan = off;
set local enable_indexscan = on;
set local role authenticated;
do $$
declare o0 bigint; n bigint;
begin
  o0 := pg_temp.other_btree_scans();
  select count(*) into n from retrieval_internal.hybrid_candidate_ids('zq4417 vexilla', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)');
  insert into prune_stats values ('nclt', pg_temp.other_btree_scans() - o0, n);
  o0 := pg_temp.other_btree_scans();
  select count(*) into n from retrieval_internal.hybrid_candidate_ids('zq4417', (select v from q where name = 'near'), null, null);
  insert into prune_stats values ('no feature', pg_temp.other_btree_scans() - o0, n);
  o0 := pg_temp.other_btree_scans();
  select count(*) into n from retrieval_internal.hybrid_candidate_ids('zq4417 march 2024', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)');
  insert into prune_stats values ('nclt month', pg_temp.other_btree_scans() - o0, n);
end $$;
reset role;
set local enable_seqscan = on;
set local enable_indexscan = off;
select pg_temp.ok((select other = 0 and n = 4 from prune_stats where label = 'nclt'),
  'the rank lookup of an NCLT search reads only the NCLT partition: no btree index of another partition is scanned (its four matches are ranked)');
select pg_temp.ok((select other = 0 and n = 93 from prune_stats where label = 'nclt month'),
  'and so does the month scan: with the keyword list (3 chunks) and the month list (90), no btree index of another partition is scanned');
select pg_temp.ok((select other > 0 and n = 7 from prune_stats where label = 'no feature'),
  'the check can fail: a call with no feature, whose seven matches are in three partitions (one with no feature), looks rows up in the others');

-- The month list's scan reads the btree on (desk_feature, doc_date) of the NCLT partition and no partition sequentially. The
-- control: with index and bitmap scans off the same call reads sequentially and no date index, so the counters can see the
-- difference.
create function pg_temp.date_idx_scans() returns bigint language sql as $$
  select coalesce(sum(pg_stat_get_xact_numscans(i.indexrelid)), 0)::bigint
    from pg_index i join pg_class t on t.oid = i.indrelid join pg_inherits h on h.inhrelid = t.oid
   where h.inhparent = 'public.document_chunks'::regclass and pg_get_indexdef(i.indexrelid) like '%(desk_feature, doc_date)%'
$$;
create temp table month_plan(label text primary key, seq bigint, date_idx bigint, n bigint);
grant all on month_plan to authenticated;
set local enable_seqscan = off;
set local enable_indexscan = on;
set local role authenticated;
do $$
declare s0 bigint; d0 bigint; n bigint;
begin
  s0 := pg_temp.seq_scans(); d0 := pg_temp.date_idx_scans();
  select count(*) into n from retrieval_internal.hybrid_candidate_ids('march 2024', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)');
  insert into month_plan values ('index', pg_temp.seq_scans() - s0, pg_temp.date_idx_scans() - d0, n);
end $$;
reset role;
set local enable_seqscan = on;
set local enable_indexscan = off;
set local enable_bitmapscan = off;
set local role authenticated;
do $$
declare s0 bigint; d0 bigint; n bigint;
begin
  s0 := pg_temp.seq_scans(); d0 := pg_temp.date_idx_scans();
  select count(*) into n from retrieval_internal.hybrid_candidate_ids('march 2024', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)');
  insert into month_plan values ('no index', pg_temp.seq_scans() - s0, pg_temp.date_idx_scans() - d0, n);
end $$;
reset role;
set local enable_bitmapscan = on;
select pg_temp.ok((select seq = 0 and date_idx > 0 and n = 90 from month_plan where label = 'index'),
  'the month list''s scan, called as authenticated: no chunk partition is scanned sequentially, the btree on (desk_feature, doc_date) is used');
select pg_temp.ok((select seq > 0 and date_idx = 0 and n = 90 from month_plan where label = 'no index'),
  'the check can fail: with index and bitmap scans off the same call scans sequentially and reads no date index');

-- (b) anon and the exposure of the schema. Granting anon the schema and the function makes the helper callable:
-- the ACL is what refuses it, and the migration grants neither. (That the API does not expose the schema is
-- checked by run.sh against supabase/config.toml.)
grant usage on schema retrieval_internal to anon;
grant execute on function retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text) to anon;
select pg_temp.ok(has_schema_privilege('anon', 'retrieval_internal', 'usage') and has_function_privilege('anon', 'retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text)', 'execute'),
  'the check can fail: once granted, anon holds usage on the schema and execute on the helper');
set local role anon;
create temp table anon_served as select * from retrieval_internal.hybrid_candidate_ids('zq4417', (select v from q where name = 'near'), null, null);
reset role;
select pg_temp.ok((select count(*) from anon_served) = 7, 'and is then served (the schema ACL is what refuses it)');
revoke execute on function retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text) from anon;
revoke usage on schema retrieval_internal from anon;
select pg_temp.ok(not has_schema_privilege('anon', 'retrieval_internal', 'usage') and not has_function_privilege('anon', 'retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text)', 'execute'),
  'as migrated: anon holds neither');

-- (c) What the body must do, in what order (pinned by text: a fixture cannot reach the branches, and run.sh mutates the
-- migration to show that the behavioural checks above fail without each of them). There is no text score: ts_rank_cd is not
-- used. The distance (the operator on halfvec) is computed only after the hidden-document filter and the word budget, and
-- for the month list inside a scan that already carries the filter. The filter is the subplan form in each of its four places
-- (the probe, the titles, the keyword scan, the month scan), never = any (v_hidden). A null hidden list, which the coalesce
-- rules out today, is refused right after it is built.
select pg_temp.ok((select position('ts_rank_cd' in prosrc) = 0
                          and (length(prosrc) - length(replace(prosrc, 'not in (select h.id from unnest(v_hidden) h(id))', ''))) / length('not in (select h.id from unnest(v_hidden) h(id))') = 4
                          and (length(prosrc) - length(replace(prosrc, 'operator(extensions.<=>)', ''))) / length('operator(extensions.<=>)') = 2
                          and position('operator(extensions.<=>)' in prosrc) > position('v_sum + v_df <= c_match_budget' in prosrc) and position('v_sum + v_df <= c_match_budget' in prosrc) > 0
                          and position('operator(extensions.<=>)' in prosrc) > position('c.document_id is not null and c.document_id not in (select h.id from unnest(v_hidden) h(id))' in prosrc)
                          and position('any (v_hidden)' in prosrc) = 0
                          and position('if v_hidden is null then' in prosrc) > position('into v_hidden' in prosrc)
                          and position('into v_hidden' in prosrc) > 0
                          and position('order by k.dist, k.id' in prosrc) > 0
                          and position('d.id not in (select h.id from unnest(v_hidden) h(id))' in prosrc) > 0
                     from pg_proc where oid = 'retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text)'::regprocedure),
  'the helper: no ts_rank_cd; the distance appears twice (keyword list, month list), after the hidden filter and the word budget; the hidden filter is a subplan over unnest in all four places (probe, titles, keyword scan, month scan), never = any (v_hidden); a null hidden list is refused right after it is built');

-- (d) The word budget. The eight capw words are in 2050 readable NCLT chunks, more than 2000. Kept, rarest first while they
-- fit: capw1..capw3 (200 each), capw4..capw7 (290 each), 1760 in all; capw8 (290 more) is not. Every match of the kept words
-- is ordered by distance, so the list is the 100 nearest of them, and no capw8 chunk is in it although capw8's chunks are
-- the nearest of all (the seed puts them at distance 0.90, the others at 0.93 and more). With zq4417 (9 readable) and
-- vexilla (2) added: zq4417 is kept first (a digit, rarest), capw8 still does not fit, and vexilla (no digit, after every
-- digit word) still does, so the nearest chunks are those of zq4417 and vexilla (distance 0.012 to 0.92) and then capw chunks.
set local role authenticated;
create temp table cap_got as
  select (select array_agg(id order by list_rank) from retrieval_internal.hybrid_candidate_ids('capw1 capw2 capw3 capw4 capw5 capw6 capw7 capw8', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)') where list_name = 'keyword') as best,
         (select array_agg(id order by list_rank) from retrieval_internal.hybrid_candidate_ids('capw8 capw7 capw6 capw5 capw4 capw3 capw2 capw1 zq4417 vexilla', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)') where list_name = 'keyword') as mixed;
create temp table cap_want as
  select (select array_agg(id order by d, id) from (
            select c.id, (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'near')::halfvec(1536)) as d
              from document_chunks c join documents dd on dd.id = c.document_id
             where c.desk_feature = 'NCLT / NCLAT (Insolvency)' and c.embedding is not null and dd.indexed_at is not null
               and to_tsvector('simple'::regconfig, c.content) @@ to_tsquery('simple', 'capw1 | capw2 | capw3 | capw4 | capw5 | capw6 | capw7')
             order by 2, 1 limit 100) x) as best,
         (select array_agg(id order by d, id) from (
            select c.id, (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'near')::halfvec(1536)) as d
              from document_chunks c join documents dd on dd.id = c.document_id
             where c.desk_feature = 'NCLT / NCLAT (Insolvency)' and c.embedding is not null and dd.indexed_at is not null
               and to_tsvector('simple'::regconfig, c.content) @@ to_tsquery('simple', 'zq4417 | vexilla | capw1 | capw2 | capw3 | capw4 | capw5 | capw6 | capw7')
             order by 2, 1 limit 100) x) as mixed,
         (select array_agg(n order by w) from (select w, (select count(*) from document_chunks c where to_tsvector('simple'::regconfig, c.content) @@ to_tsquery('simple', w)) as n
                                                 from unnest(array['capw1', 'capw2', 'capw3', 'capw4', 'capw5', 'capw6', 'capw7', 'capw8']) w) z) as dfs,
         (select count(*) from document_chunks c where to_tsvector('simple'::regconfig, c.content) @@ to_tsquery('simple', 'capw1 | capw2 | capw3 | capw4 | capw5 | capw6 | capw7 | capw8')) as matches_all,
         (select count(*) from document_chunks c where to_tsvector('simple'::regconfig, c.content) @@ to_tsquery('simple', 'capw1 | capw2 | capw3 | capw4 | capw5 | capw6 | capw7')) as matches_kept,
         array(select c.id from document_chunks c where to_tsvector('simple'::regconfig, c.content) @@ to_tsquery('simple', 'capw8')) as capw8_ids;
reset role;
select pg_temp.ok((select dfs from cap_want) = array[200, 200, 200, 290, 290, 290, 290, 290]::bigint[]
  and (select matches_all from cap_want) = 2050 and (select matches_kept from cap_want) = 1760
  and (select cardinality(capw8_ids) from cap_want) = 290,
  'the budget seed is as intended: readable counts 200 x 3 and 290 x 5; the eight words match 2050 readable chunks (over 2000), the seven kept 1760');
select pg_temp.ok((select best from cap_got) = (select best from cap_want) and (select cardinality(best) from cap_got) = 100
  and not ((select best from cap_got) && (select capw8_ids from cap_want)),
  'the budget: of eight words matching 2050 readable chunks the seven rarest that fit are kept and the list is the nearest 100 of their matches; no capw8 chunk is in it although they are the nearest of all');
select pg_temp.ok((select mixed from cap_got) = (select mixed from cap_want) and (select cardinality(mixed) from cap_got) = 100
  and not ((select mixed from cap_got) && (select capw8_ids from cap_want))
  and (select mixed from cap_got) @> pg_temp.cids(array['near3', 'far-nclt', 'far-both', 'far-vexilla']),
  'only the words that fit are searched when many exceed the budget: zq4417 and vexilla are kept (their chunks head the list), capw8 is not (no capw8 chunk)');

-- (e) Drift. The helper's copy of the publication rule was written against exact access policies on documents and
-- document_chunks (name, mode, roles, text). It refuses to run when any of them is different, or another is added, and so does
-- the search function for an NCLT search (other scopes never call it). Each change is made, checked, and undone.
create temp table orig_pol as select polrelid as tab, polname::text as name, pg_get_expr(polqual, polrelid) as qual
  from pg_policy where polrelid in ('public.documents'::regclass, 'public.document_chunks'::regclass);
create function pg_temp.pol_qual(t text, n text) returns text language sql as $$ select qual from orig_pol where tab = t::regclass and name = n $$;
-- The error a statement raises: SQLSTATE, message, detail, hint (what PostgREST would pass to the client).
create function pg_temp.err_of(q text) returns text[] language plpgsql as $$
declare v_state text; v_msg text; v_detail text; v_hint text;
begin
  execute q;
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return array[v_state, v_msg, coalesce(v_detail, ''), coalesce(v_hint, '')];
end $$;
create function pg_temp.drift_case(label text, mutate text, restore text) returns void language plpgsql as $$
begin
  execute mutate;
  perform pg_temp.fails('select * from retrieval_internal.hybrid_candidate_ids(''zq4417'', (select v from q where name = ''near''), null, null)', '55000', 'drift refused by the helper: ' || label);
  -- The call the migration makes as its last statement: an empty text still runs the check (it comes first).
  perform pg_temp.fails('select * from retrieval_internal.hybrid_candidate_ids('''', null, null, null)', '55000', 'drift refused by the migration''s own call (empty text): ' || label);
  perform pg_temp.fails($q$select * from match_documents_hybrid((select v from q where name = 'near'), 'zq4417', 5, null, null, 'NCLT / NCLAT (Insolvency)')$q$,
                        '55000', 'drift refused by the search function (NCLT): ' || label);
  -- The error the client sees is terse and names nothing internal: no detail, no hint.
  perform pg_temp.ok(pg_temp.err_of($q$select * from match_documents_hybrid((select v from q where name = 'near'), 'zq4417', 5, null, null, 'NCLT / NCLAT (Insolvency)')$q$)
                       = array['55000', 'keyword search unavailable', '', ''], 'the refusal is terse (message only, no detail or hint): ' || label);
  perform pg_temp.ok(jsonb_array_length(pg_temp.h('near', 'zq4417', 5, null, null, 'Parliamentary Question Database')) = 5, 'other scopes do not call the helper: ' || label);
  execute restore;
  perform pg_temp.ok((select count(*) from retrieval_internal.hybrid_candidate_ids('zq4417', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)')) = 3, 'after undoing it the helper runs again: ' || label);
  perform pg_temp.ok((select count(*) from retrieval_internal.hybrid_candidate_ids('', null, null, null)) = 0, 'and so does the migration''s own call (no row): ' || label);
end $$;
select pg_temp.drift_case('the restrictive document policy loosened',
  'alter policy law_documents_serving on public.documents using (true)',
  format('alter policy law_documents_serving on public.documents using (%s)', pg_temp.pol_qual('public.documents', 'law_documents_serving')));
select pg_temp.drift_case('the chunk policy loosened',
  'alter policy law_chunks_serving on public.document_chunks using (true)',
  format('alter policy law_chunks_serving on public.document_chunks using (%s)', pg_temp.pol_qual('public.document_chunks', 'law_chunks_serving')));
select pg_temp.drift_case('a policy added',
  'create policy hy_extra on public.documents for select to authenticated using (false)', 'drop policy hy_extra on public.documents');
select pg_temp.drift_case('a policy''s roles widened',
  'alter policy documents_read on public.documents to authenticated, anon', 'alter policy documents_read on public.documents to authenticated');
select pg_temp.drift_case('a policy renamed',
  'alter policy law_documents_serving on public.documents rename to law_documents_serving_x', 'alter policy law_documents_serving_x on public.documents rename to law_documents_serving');
select pg_temp.drift_case('the restrictive chunk policy made permissive',
  format('drop policy law_chunks_serving on public.document_chunks; create policy law_chunks_serving on public.document_chunks for select to authenticated using (%s)', pg_temp.pol_qual('public.document_chunks', 'law_chunks_serving')),
  format('drop policy law_chunks_serving on public.document_chunks; create policy law_chunks_serving on public.document_chunks as restrictive for select to authenticated using (%s)', pg_temp.pol_qual('public.document_chunks', 'law_chunks_serving')));

-- (f) Shadowing. (Last of the guards that use the tables: it leaves temp tables named like them.) Names a definer function reads must not resolve to the caller's temp objects. A definer function
-- without a fixed search_path (pg_temp implicitly first) is shadowed, for a table and for a type; the helper is not.
create function public.hy_shadowable() returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from document_chunks
$$;
create function public.hy_shadowable_cast() returns text language sql stable security definer set search_path = public as $$
  select '(x)'::tsquery::text
$$;
grant execute on function public.hy_shadowable(), public.hy_shadowable_cast() to authenticated;
set local role authenticated;
create temp table before_shadow as select count(*) as n, (select array_agg(id order by list_rank) from retrieval_internal.hybrid_candidate_ids('zq4417 vexilla', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)') where list_name = 'keyword') as ids
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
         (select array_agg(id order by list_rank) from retrieval_internal.hybrid_candidate_ids('zq4417 vexilla', (select v from q where name = 'near'), null, 'NCLT / NCLAT (Insolvency)') where list_name = 'keyword') as ids;
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

-- (g) Nothing else reaches the helper. No other function, view or policy mentions it (so it has one caller), and the
-- scan can see a caller when there is one.
create function pg_temp.helper_mentions() returns text language sql as $$
  select string_agg(x.what, ', ' order by x.what) from (
    select 'function ' || p.oid::regprocedure::text as what from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.prosrc like '%hybrid_candidate_ids%' and n.nspname !~ '^pg_temp'
       and p.oid <> 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)'::regprocedure
       and p.oid <> 'retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text)'::regprocedure
    union all select 'view ' || schemaname || '.' || viewname from pg_views where definition like '%hybrid_candidate_ids%'
    union all select 'policy ' || polname from pg_policy where pg_get_expr(polqual, polrelid) like '%hybrid_candidate_ids%'
  ) x
$$;
select pg_temp.ok((select pg_temp.helper_mentions() is null), 'no function, view or policy other than match_documents_hybrid mentions the helper');
create function public.hy_second_caller() returns bigint language sql stable as $$ select count(*) from retrieval_internal.hybrid_candidate_ids('zq4417', (select v from q where name = 'near'), null, null) $$;
select pg_temp.ok((select pg_temp.helper_mentions() = 'function hy_second_caller()' or pg_temp.helper_mentions() like 'function public.hy_second_caller()'), 'the check can fail: a second caller is found');
drop function public.hy_second_caller();
select pg_temp.ok((select pg_temp.helper_mentions() is null), 'and not found once dropped');

-- (h) Default privileges. ALTER DEFAULT PRIVILEGES IN SCHEMA ... REVOKE cannot cancel PostgreSQL's built-in
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
