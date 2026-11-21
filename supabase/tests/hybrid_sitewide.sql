-- Disposable local fixture for 20261124100000_hybrid_sitewide (F393; spec docs/specs/2026-11-21-hybrid-sitewide.md).
-- Chain: chunk_hybrid_search's chain (the law listing, the partitioned document_chunks, the policy set, the NCLT
-- hybrid migration) + the migration, all applied as a non-superuser.
--
--   Part 1  what the migration creates: the flag table (no row, RLS, grants), the private helper (security definer,
--           fixed search_path, ids and ranks only, no PUBLIC or anon execute), the schema holding exactly two
--           functions, the replaced search function's properties and grants.
--   Part 2  a desk without a flag row (or with a disabled one) returns exactly what match_documents returns, for
--           every scope, and a flag row on one desk changes no other desk.
--   Part 3  a flagged desk uses the hybrid path: the keyword list is the rule's, fusion is reciprocal rank fusion
--           (checked against an independent re-implementation), no rare word or too few words falls back to the
--           vector rows, the tier is honoured.
--   Part 4  the access rules, as `authenticated` under RLS: an unpublished order's chunks never appear, never change
--           which words are rare, and the policy-drift guard fails the keyword path closed; anon is refused;
--           authenticated cannot write the flag table.
--   Part 5  the rule's parts: a rarer word weighs more, a candidate holds two of the words, 2000 chunks is rare and
--           2001 is not, other desks and chunks without a vector are never candidates, and the helper reads the keyword index.
--   Part 6  NCLT keeps its own rule, with or without a flag row of its own.
--
-- Vacuity: run.sh rebuilds the chain without the migration and this file must fail at its first assertion (the
-- flag table does not exist); keep part 1 first. run.sh also mutates the migration once per defect.
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
create function pg_temp.cone(axis int, d float8, k int) returns vector language sql immutable as $$
  select (array_fill(0::real, array[axis - 1])
          || array[1::real, (r * cos(k * 2.39996323))::real, (r * sin(k * 2.39996323))::real]
          || array_fill(0::real, array[1536 - axis - 2]))::vector(1536)
    from (select sqrt(1 / (1 - d) ^ 2 - 1) as r) x
$$;

-- ===========================================================================================
-- Part 1. What the migration creates.
select pg_temp.ok(to_regclass('public.hybrid_search_desks') is not null
  and to_regprocedure('retrieval_internal.keyword_candidate_ids(text, extensions.vector, text, text)') is not null,
  'the flag table and the private helper exist');
select pg_temp.ok((select count(*) from public.hybrid_search_desks) = 0, 'the migration inserts no flag row for any desk');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.hybrid_search_desks'::regclass), 'row-level security is on for the flag table');
select pg_temp.ok(has_table_privilege('authenticated', 'public.hybrid_search_desks', 'select')
  and not has_table_privilege('authenticated', 'public.hybrid_search_desks', 'insert')
  and not has_table_privilege('authenticated', 'public.hybrid_search_desks', 'update')
  and not has_table_privilege('authenticated', 'public.hybrid_search_desks', 'delete')
  and not has_table_privilege('anon', 'public.hybrid_search_desks', 'select')
  and has_table_privilege('service_role', 'public.hybrid_search_desks', 'insert')
  and has_table_privilege('service_role', 'public.hybrid_search_desks', 'delete'),
  'flag table: authenticated reads only, anon nothing, service_role writes');
select pg_temp.ok((select prosecdef and proconfig @> array['search_path=pg_catalog, pg_temp', 'plan_cache_mode=force_custom_plan']
                     from pg_proc where oid = 'retrieval_internal.keyword_candidate_ids(text, extensions.vector, text, text)'::regprocedure),
  'the helper is security definer with search_path = pg_catalog, pg_temp and custom plans');
select pg_temp.ok(has_function_privilege('authenticated', 'retrieval_internal.keyword_candidate_ids(text, extensions.vector, text, text)', 'execute')
  and has_function_privilege('service_role', 'retrieval_internal.keyword_candidate_ids(text, extensions.vector, text, text)', 'execute')
  and not has_function_privilege('anon', 'retrieval_internal.keyword_candidate_ids(text, extensions.vector, text, text)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                   where p.oid = 'retrieval_internal.keyword_candidate_ids(text, extensions.vector, text, text)'::regprocedure and a.grantee = 0),
  'the helper: authenticated and service_role may execute it; anon and PUBLIC may not');
select pg_temp.ok((select count(*) from pg_proc where pronamespace = 'retrieval_internal'::regnamespace) = 3
  and not exists (select 1 from pg_class where relnamespace = 'retrieval_internal'::regnamespace),
  'schema retrieval_internal holds the three helpers and no table or view');
-- R3: one place for the hidden-document rule. The list returns ids the caller may not read, so only the definer helpers
-- (which run as its owner) may call it.
select pg_temp.ok(to_regprocedure('retrieval_internal.hidden_document_ids()') is not null
  and (select prosecdef and proconfig @> array['search_path=pg_catalog, pg_temp'] from pg_proc where oid = 'retrieval_internal.hidden_document_ids()'::regprocedure)
  and not has_function_privilege('authenticated', 'retrieval_internal.hidden_document_ids()', 'execute')
  and not has_function_privilege('service_role', 'retrieval_internal.hidden_document_ids()', 'execute')
  and not has_function_privilege('anon', 'retrieval_internal.hidden_document_ids()', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                   where p.oid = 'retrieval_internal.hidden_document_ids()'::regprocedure and a.grantee = 0),
  'the hidden-document list is a security definer function that no role but its owner may execute');
-- R3: the rule is copied from the NCLT helper (which this migration leaves alone); the two copies must be the same text.
select pg_temp.ok((select regexp_replace(substring(prosrc from 'select coalesce\(array_agg\(d\.id\), ''\{\}''\) into v_hidden.*?is not true;'), '\s+', ' ', 'g')
                     from pg_proc where oid = 'retrieval_internal.hidden_document_ids()'::regprocedure) like 'select coalesce(array_agg(d.id)%is not true;'
  and (select regexp_replace(substring(prosrc from 'select coalesce\(array_agg\(d\.id\), ''\{\}''\) into v_hidden.*?is not true;'), '\s+', ' ', 'g')
         from pg_proc where oid = 'retrieval_internal.hidden_document_ids()'::regprocedure)
    = (select regexp_replace(substring(prosrc from 'select coalesce\(array_agg\(d\.id\), ''\{\}''\) into v_hidden.*?is not true;'), '\s+', ' ', 'g')
         from pg_proc where oid = 'retrieval_internal.hybrid_candidate_ids(text, extensions.vector, text, text)'::regprocedure),
  'the hidden-document query is the same text as the NCLT helper''s copy of the publication rule');
select pg_temp.ok((select not prosecdef and proconfig @> array['search_path=public, extensions'] and prorettype = 'record'::regtype
                     from pg_proc where oid = 'match_documents_hybrid(extensions.vector, text, int, uuid[], text, text)'::regprocedure),
  'match_documents_hybrid is still security invoker with its search_path');
select pg_temp.ok(has_function_privilege('authenticated', 'match_documents_hybrid(extensions.vector, text, int, uuid[], text, text)', 'execute')
  and has_function_privilege('service_role', 'match_documents_hybrid(extensions.vector, text, int, uuid[], text, text)', 'execute')
  and not has_function_privilege('anon', 'match_documents_hybrid(extensions.vector, text, int, uuid[], text, text)', 'execute'),
  'match_documents_hybrid: authenticated and service_role may execute it; anon may not');

-- ===========================================================================================
-- Seed. Desks: REG (Regulatory) is flagged later; PQ never is; NCLT keeps its own rule.
-- R1, R2 indexed national; RU unindexed; RS state tier; RH an unpublished NCLT order filed under REG (hidden from authenticated
-- while the law listing is active); P1 a PQ document; NA an NCLT order whose title holds the name word 'nclname'.
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at, metadata) values
  ('a1000000-0000-4000-8000-000000000001', 'hs-reg-1', 'Reg one', 'national', 'Regulatory Body Watch (RBI SEBI TRAI CCI)', 'x', 'a', 4, now(), '{}'),
  ('a1000000-0000-4000-8000-000000000002', 'hs-reg-2', 'Reg two', 'national', 'Regulatory Body Watch (RBI SEBI TRAI CCI)', 'x', 'a', 4, now(), '{}'),
  ('a1000000-0000-4000-8000-000000000003', 'hs-reg-unindexed', 'Reg unindexed', 'national', 'Regulatory Body Watch (RBI SEBI TRAI CCI)', 'x', 'a', 4, null, '{}'),
  ('a1000000-0000-4000-8000-000000000004', 'hs-reg-state', 'Reg state', 'state', 'Regulatory Body Watch (RBI SEBI TRAI CCI)', 'x', 'a', 4, now(), '{}'),
  ('a1000000-0000-4000-8000-000000000005', 'law:trib:IBBI_NCLT:hs-hidden', 'Reg hidden', 'national', 'Regulatory Body Watch (RBI SEBI TRAI CCI)', 'x', 'a', 4, now(), '{"origin": "supplied-text"}'),
  ('a2000000-0000-4000-8000-000000000001', 'hs-pq', 'PQ one', 'national', 'Parliamentary Question Database', 'x', 'a', 4, now(), '{}'),
  ('a3000000-0000-4000-8000-000000000001', 'hs-nclt-a', 'Order nclname', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'a', 4, now(), '{}'),
  ('a4000000-0000-4000-8000-000000000001', 'hs-other', 'Other desk document', 'national', 'Some Other Desk', 'x', 'a', 4, now(), '{}');

-- Vector-near fillers saturate each desk's vector search (distance 0.004 k from axis 1): 130 for REG and NCLT, 30 for PQ.
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, 'near-' || v.p || k, k, 0, 4, 'filler passage ' || k, pg_temp.cone(1, 0.004 * k + case v.p when 'r' then 0 when 'p' then 0.0013 else 0.0027 end, k), 4
  from (values ('r', 130, 'hs-reg-'), ('p', 30, 'hs-pq'), ('n', 130, 'hs-nclt-a')) v(p, n, sk)
 cross join lateral generate_series(1, v.n) k
  join documents d on d.source_key = case when v.p = 'r' then v.sk || (1 + k % 2) else v.sk end;

-- Target chunks, all vector-far (outside the first 100 of any vector search).
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, v.h, 1000 + v.i, 0, 4, v.content, case when v.dist is null then null else pg_temp.cone(1, v.dist, 500 + v.i) end, 4
  from (values
    ('hs-reg-1',          't1',   1, 'zqalpha zqbeta together', 0.70),
    ('hs-reg-2',          't2',   2, 'zqalpha only', 0.71),
    ('hs-reg-2',          't3',   3, 'zqbeta alone', 0.72),
    ('hs-reg-unindexed',  'tu',   4, 'zqalpha zqbeta unindexed', 0.60),
    ('hs-reg-state',      'ts',   5, 'zqalpha zqbeta state tier', 0.65),
    ('law:trib:IBBI_NCLT:hs-hidden', 'th', 6, 'zqalpha zqbeta hidword hidden', 0.50),
    ('law:trib:IBBI_NCLT:hs-hidden', 'th2', 7, 'hidword hidden extra', 0.51),
    ('hs-reg-1',          'tn',   8, 'zqalpha zqbeta not embedded', null),
    ('hs-pq',             'tp',   9, 'zqalpha zqbeta in another desk', 0.60),
    ('hs-reg-1',          'xa',  10, 'rarew midw', 0.90),
    ('hs-reg-2',          'x2',  11, 'rarew', 0.80),
    ('hs-reg-2',          'xb',  12, 'midw midw2', 0.75),
    ('hs-nclt-a',         'n1',  13, 'nclname only', 0.70),
    ('hs-nclt-a',         'n2',  14, 'ncother only', 0.71)) v(sk, h, i, content, dist)
  join documents d on d.source_key = v.sk;
-- 'midw' and 'midw2' are in 50 and 49 chunks of REG (a mid-rarity pair), 'rarew' in 2.
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, 'mid-' || k, 2000 + k, 0, 4, 'midw midw2 pair ' || k, pg_temp.cone(1, 0.76 + 0.0001 * k, 800 + k), 4
  from generate_series(1, 48) k join documents d on d.source_key = 'hs-reg-2';
-- 2001 chunks hold 'edgebad', the first 2000 also 'edgeok': 2000 chunks is rare, 2001 is not.
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, 'edge-' || k, 3000 + k, 0, 4, 'cwd' || case when k <= 2000 then ' edgeok' else '' end || ' edgebad ' || k,
       pg_temp.cone(1, 0.60 + 0.00004 * k, 1000 + k), 4
  from generate_series(1, 2001) k join documents d on d.source_key = 'hs-reg-1';
-- 400 chunks hold both 'tiealpha' and 'tiebeta': one score for all of them, so a cut at 300 must keep the ties (R1 of the
-- review; the chunk ids are random, so an id cut and a distance cut disagree). Distances spread from 0.20 to 0.60.
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, 'tie-' || k, 5000 + k, 0, 4, 'tiealpha tiebeta together',
       pg_temp.cone(1, 0.20 + 0.001 * k, 2000 + k), 4
  from generate_series(1, 400) k join documents d on d.source_key = 'hs-reg-2';
-- 30000 chunks hold 'cmnw' (no vector): a word this common makes the default planner prefer a sequential scan for a probe
-- that stops after 2001 matches, unless the helper forbids it (R2 of the review).
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, 'cm-' || k, 6000 + k, 0, 4, 'cmnw common filler', null, 4
  from generate_series(1, 30000) k join documents d on d.source_key = 'hs-reg-2';
analyze documents; analyze document_chunks;
update law_listing_settings set seeded = true, active = true;

create temp table q(name text primary key, v vector);
insert into q values ('near', pg_temp.cone(1, 0, 0));
grant select on q to authenticated, service_role, anon;
create function pg_temp.cid(h text) returns uuid language sql security definer as $$ select id from document_chunks where chunk_hash = h $$;
create function pg_temp.rowsj(q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  execute 'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (' || q || ') t' into r;
  return r;
end $$;
create function pg_temp.idsof(j jsonb) returns uuid[] language sql as $$ select coalesce(array_agg((e->>'id')::uuid order by o), '{}') from jsonb_array_elements(j) with ordinality t(e, o) $$;
create function pg_temp.h(qtext text, n int default 40, ids uuid[] default null, tier text default null, feat text default null) returns jsonb language sql as $$
  select pg_temp.rowsj(format('select * from match_documents_hybrid(%L::vector, %L, %L, %L::uuid[], %L, %L)', (select v::text from q where name = 'near'), qtext, n, ids, tier, feat)) $$;
create function pg_temp.v(n int default 40, ids uuid[] default null, tier text default null, feat text default null) returns jsonb language sql as $$
  select pg_temp.rowsj(format('select * from match_documents(%L::vector, %L, %L::uuid[], %L, %L)', (select v::text from q where name = 'near'), n, ids, tier, feat)) $$;
-- The keyword list of the helper, in order.
create function pg_temp.kw(qtext text, tier text, feat text) returns uuid[] language sql as $$
  select coalesce(array_agg(id order by list_rank), '{}') from retrieval_internal.keyword_candidate_ids(qtext, (select v from q where name = 'near'), tier, feat) $$;
-- Independent re-implementation of the fusion: reciprocal rank fusion, k = 60, weight 1 per list.
create function pg_temp.fuse(vec uuid[], kw uuid[], n int) returns uuid[] language sql as $$
  select coalesce(array_agg(t.id order by t.score desc, t.vr nulls last, t.kr nulls last, t.id), '{}')
    from (select u.id, v.o as vr, k.o as kr, coalesce(1.0 / (60 + v.o), 0) + coalesce(1.0 / (60 + k.o), 0) as score
            from (select unnest(vec) as id union select unnest(kw)) u
            left join unnest(vec) with ordinality v(id, o) on v.id = u.id
            left join unnest(kw) with ordinality k(id, o) on k.id = u.id
           order by 4 desc, 2 nulls last, 3 nulls last, 1 limit n) t $$;

-- The vector side is exact on these few rows.
set local enable_indexscan = off;
set local hnsw.ef_search = 40;
set local hnsw.iterative_scan = 'strict_order';

-- ===========================================================================================
-- Part 2. A desk without a flag row (or a disabled one) returns exactly match_documents' rows.
create temp table same_cases(label text primary key, qtext text, n int, ids uuid[], tier text, feat text);
insert into same_cases values
  ('reg',            'zqalpha zqbeta', 40,   null, null,       'Regulatory Body Watch (RBI SEBI TRAI CCI)'),
  ('reg-tier',       'zqalpha zqbeta', 40,   null, 'national', 'Regulatory Body Watch (RBI SEBI TRAI CCI)'),
  ('reg-10',         'zqalpha zqbeta', 10,   null, null,       'Regulatory Body Watch (RBI SEBI TRAI CCI)'),
  ('reg-ids',        'zqalpha zqbeta', 40,   array['a1000000-0000-4000-8000-000000000001']::uuid[], null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)'),
  ('pq',             'zqalpha zqbeta', 40,   null, null,       'Parliamentary Question Database'),
  ('unscoped',       'zqalpha zqbeta', 40,   null, null,       null),
  ('tier',           'zqalpha zqbeta', 40,   null, 'national', null),
  ('unknown-desk',   'zqalpha zqbeta', 40,   null, null,       'No Such Desk'),
  ('null-text',      null,             40,   null, null,       'Regulatory Body Watch (RBI SEBI TRAI CCI)'),
  ('empty-text',     '',               40,   null, null,       'Regulatory Body Watch (RBI SEBI TRAI CCI)');
grant select on same_cases to authenticated;
set local role authenticated;
create temp table same_got(stage text, label text, h jsonb, v jsonb, primary key (stage, label));
grant all on same_got to authenticated;
insert into same_got select 'none', label, pg_temp.h(qtext, n, ids, tier, feat), pg_temp.v(coalesce(n, 40), ids, tier, feat) from same_cases;
reset role;
-- A disabled row for Regulatory, and an enabled row for a desk that is not searched here: still exactly match_documents.
insert into hybrid_search_desks (desk_feature, enabled) values ('Regulatory Body Watch (RBI SEBI TRAI CCI)', false), ('Some Other Desk', true);
set local role authenticated;
insert into same_got select 'disabled', label, pg_temp.h(qtext, n, ids, tier, feat), pg_temp.v(coalesce(n, 40), ids, tier, feat) from same_cases;
reset role;
select pg_temp.ok((select count(*) from same_got where stage = 'none') = 10 and (select bool_and(h = v) from same_got where stage = 'none')
  and (select bool_and(jsonb_array_length(h) > 0) from same_got where stage = 'none' and label <> 'unknown-desk'),
  'no flag row: every scope returns exactly the rows (every column, in order) of match_documents');
select pg_temp.ok((select bool_and(h = v) from same_got where stage = 'disabled'),
  'a disabled row, and a row for another desk: every scope still returns exactly the rows of match_documents');
-- A row for Regulatory changes no other desk, no unscoped search and no search that names document ids.
update hybrid_search_desks set enabled = true where desk_feature = 'Regulatory Body Watch (RBI SEBI TRAI CCI)';
set local role authenticated;
insert into same_got select 'enabled', label, pg_temp.h(qtext, n, ids, tier, feat), pg_temp.v(coalesce(n, 40), ids, tier, feat)
  from same_cases where label in ('reg-ids', 'pq', 'unscoped', 'tier', 'unknown-desk', 'null-text', 'empty-text');
reset role;
select pg_temp.ok((select count(*) = 7 and bool_and(h = v) from same_got where stage = 'enabled'),
  'with Regulatory enabled: PQ, unscoped, tier-only, an unknown desk, document ids, and a null or empty text are still exactly match_documents');

-- ===========================================================================================
-- Part 3. A flagged desk uses the hybrid path.
set local role authenticated;
create temp table reg_got(label text primary key, h jsonb);
grant all on reg_got to authenticated;
insert into reg_got values
  ('both',      pg_temp.h('zqalpha zqbeta', 40, null, null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')),
  ('both-nat',  pg_temp.h('zqalpha zqbeta', 40, null, 'national', 'Regulatory Body Watch (RBI SEBI TRAI CCI)')),
  ('one',       pg_temp.h('zqalpha', 40, null, null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')),
  ('none',      pg_temp.h('qqqaaa qqqbbb', 40, null, null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')),
  ('common',    pg_temp.h('filler passage', 40, null, null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)'));
create temp table want(label text primary key, ids uuid[]);
grant all on want to authenticated;
insert into want values
  ('both',     pg_temp.fuse(pg_temp.idsof(pg_temp.v(100, null, null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')), array[pg_temp.cid('ts'), pg_temp.cid('t1')], 40)),
  ('both-nat', pg_temp.fuse(pg_temp.idsof(pg_temp.v(100, null, 'national', 'Regulatory Body Watch (RBI SEBI TRAI CCI)')), array[pg_temp.cid('t1')], 40));
reset role;
select pg_temp.ok((select pg_temp.idsof(h) = (select ids from want where label = 'both') from reg_got where label = 'both'),
  'flagged desk, two rare words: the rows are the reciprocal rank fusion of the vector rows and the keyword list (the chunks holding both words)');
select pg_temp.ok((select pg_temp.idsof(h) = (select ids from want where label = 'both-nat') from reg_got where label = 'both-nat')
  and not (pg_temp.cid('ts') = any (select unnest(pg_temp.idsof(h)) from reg_got where label = 'both-nat')),
  'the tier is honoured: with tier national the state-tier chunk is not a candidate');
select pg_temp.ok(not (pg_temp.cid('t1') = any (pg_temp.idsof(pg_temp.v(40, null, null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)'))))
  and pg_temp.cid('t1') = any (select unnest(pg_temp.idsof(h)) from reg_got where label = 'both'),
  'the check can fail: vector only does not return the chunk the keyword list adds');
select pg_temp.ok(pg_temp.cid('t2') <> all (select unnest(pg_temp.idsof(h)) from reg_got where label = 'both')
  and pg_temp.cid('t3') <> all (select unnest(pg_temp.idsof(h)) from reg_got where label = 'both'),
  'a chunk holding only one of two rare words is not a candidate');
select pg_temp.ok(pg_temp.cid('t1') = any (select unnest(pg_temp.idsof(h)) from reg_got where label = 'one')
  and pg_temp.cid('t2') = any (select unnest(pg_temp.idsof(h)) from reg_got where label = 'one'),
  'one rare word in the question: one word is enough');
select pg_temp.ok((select pg_temp.idsof(h) = pg_temp.idsof(pg_temp.v(40, null, null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')) from reg_got where label = 'none'),
  'no question word found in any chunk: exactly the vector rows');
select pg_temp.ok((select pg_temp.idsof(h) = pg_temp.idsof(pg_temp.v(40, null, null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')) from reg_got where label = 'common'),
  'a keyword list that agrees with the vector order (the filler chunks hold both words, nearest first) leaves the vector rows unchanged');

-- ===========================================================================================
-- Part 4. The access rules.
set local role authenticated;
select pg_temp.ok(pg_temp.cid('th') <> all (select unnest(pg_temp.idsof(h)) from reg_got where label = 'both')
  and pg_temp.cid('th') <> all (pg_temp.kw('zqalpha zqbeta', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')),
  'an unpublished order''s chunk (nearer than the readable ones) is neither in the helper''s list nor in the rows');
-- 'hidword' is only in the unpublished order. If hidden chunks were counted it would be a rare word, two words would be
-- required and only the hidden chunk would qualify: the readable chunks holding 'zqalpha' would be lost.
select pg_temp.ok(pg_temp.kw('hidword zqalpha', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)') @> array[pg_temp.cid('t1'), pg_temp.cid('t2')]
  and pg_temp.cid('th') <> all (pg_temp.kw('hidword zqalpha', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')),
  'an unpublished order cannot make a word rare: its words are not counted, so the readable chunks keep their candidacy');
select pg_temp.ok(pg_temp.kw('hidword', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)') = '{}',
  'a word found only in an unpublished order yields nothing');
select pg_temp.ok(pg_temp.cid('tu') <> all (pg_temp.kw('zqalpha zqbeta', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')),
  'chunks of an unindexed document are not candidates');
select pg_temp.ok(pg_temp.kw('zqalpha zqbeta', null, null) = '{}',
  'a call that names no desk gets no keyword list');
reset role;
-- The policy-drift guard: an access policy that is not the one the copy of the rule was written against stops the keyword path.
create policy hs_extra on public.documents for select to authenticated using (true);
set local role authenticated;
select pg_temp.fails($q$select * from match_documents_hybrid((select v from q where name = 'near'), 'zqalpha zqbeta', 5, null, null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')$q$, '55000',
  'a changed access policy: the keyword path of a flagged desk fails closed (SQLSTATE 55000)');
select pg_temp.fails($q$select * from retrieval_internal.keyword_candidate_ids('zqalpha', (select v from q where name = 'near'), null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')$q$, '55000',
  'a changed access policy: the helper refuses');
select pg_temp.ok(jsonb_array_length(pg_temp.h('zqalpha zqbeta', 5, null, null, 'Parliamentary Question Database')) = 5,
  'a desk without a flag row never reaches the helper, so it still answers');
reset role;
drop policy hs_extra on public.documents;
-- anon and writes.
set local role anon;
select pg_temp.fails($q$select * from match_documents_hybrid((select v from q where name = 'near'), 'zqalpha', 5, null, null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')$q$, '42501', 'anon cannot search');
select pg_temp.fails($q$select * from retrieval_internal.keyword_candidate_ids('zqalpha', (select v from q where name = 'near'), null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')$q$, '42501', 'anon cannot call the helper');
select pg_temp.fails($q$select * from public.hybrid_search_desks$q$, '42501', 'anon cannot read the flag table');
reset role;
set local role authenticated;
select pg_temp.ok((select count(*) from public.hybrid_search_desks) = 2, 'authenticated can read the flag rows (the Edge Function does)');
select pg_temp.fails($q$insert into public.hybrid_search_desks (desk_feature) values ('Another')$q$, '42501', 'authenticated cannot add a flag row');
select pg_temp.fails($q$delete from public.hybrid_search_desks$q$, '42501', 'authenticated cannot delete a flag row');
reset role;
select pg_temp.fails($q$insert into public.hybrid_search_desks (desk_feature, hybrid_ms) values ('Parliamentary Question Database', 100)$q$, '23514', 'a budget outside 500 to 4000 ms is refused');
-- O3: NCLT has its own rule and switch, and a name that is no desk would switch nothing.
select pg_temp.fails($q$insert into public.hybrid_search_desks (desk_feature) values ('NCLT / NCLAT (Insolvency)')$q$, '23514', 'a row for NCLT is refused: it keeps its own rule and its own switch');
select pg_temp.fails($q$insert into public.hybrid_search_desks (desk_feature) values ('No Such Desk Anywhere')$q$, '23514', 'a row for a name that no document carries is refused');
select pg_temp.fails($q$update public.hybrid_search_desks set desk_feature = 'No Such Desk Anywhere' where desk_feature = 'Some Other Desk'$q$, '23514', 'a row cannot be renamed to a name that no document carries');
select pg_temp.fails($q$update public.hybrid_search_desks set desk_feature = 'NCLT / NCLAT (Insolvency)' where desk_feature = 'Some Other Desk'$q$, '23514', 'a row cannot be renamed to NCLT');
set local role service_role;
insert into public.hybrid_search_desks (desk_feature) values ('Parliamentary Question Database');
delete from public.hybrid_search_desks where desk_feature = 'Parliamentary Question Database';
reset role;
select pg_temp.ok(true, 'service_role can add and remove a row for a desk that holds documents');
select pg_temp.ok((select count(*) from public.hybrid_search_desks) = 2, 'the refused rows left the flag table as it was');

-- ===========================================================================================
-- Part 5. The rule's parts.
set local role authenticated;
-- Rarity: 'rarew' is in 2 chunks, 'midw' in 50, 'midw2' in 49. xa holds rarew + midw; xb and the 48 pair chunks hold midw + midw2;
-- x2 holds rarew alone. xa is the FARTHEST from the question, so only the score can put it first.
select pg_temp.ok((pg_temp.kw('rarew midw midw2', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)'))[1] = pg_temp.cid('xa')
  and pg_temp.cid('x2') <> all (pg_temp.kw('rarew midw midw2', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)'))
  and pg_temp.cid('xb') = any (pg_temp.kw('rarew midw midw2', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')),
  'a rarer word weighs more (the chunk with the rarest word heads the list although it is the farthest), and a chunk with one of three words is out');
select pg_temp.ok(cardinality(pg_temp.kw('midw midw2', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')) = 49
  and (pg_temp.kw('midw midw2', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)'))[1] = pg_temp.cid('xb'),
  'equal scores are ordered by similarity to the question (the nearest of the pair chunks is xb)');
select pg_temp.ok(cardinality(pg_temp.kw('edgeok', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')) = 100,
  'a word in 2000 chunks is rare: its first 100 chunks are the list');
select pg_temp.ok(pg_temp.kw('edgebad', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)') = '{}',
  'a word in 2001 chunks is not rare: no list');
select pg_temp.ok(pg_temp.cid('tp') <> all (pg_temp.kw('zqalpha zqbeta', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)'))
  and pg_temp.kw('zqalpha zqbeta', null, 'Parliamentary Question Database') = array[pg_temp.cid('tp')],
  'the list is of the desk searched: another desk''s chunk is not in it, and is the only one in its own desk''s');
select pg_temp.ok(pg_temp.cid('tn') <> all (pg_temp.kw('zqalpha zqbeta', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)')),
  'a chunk without a vector is not a candidate');
select pg_temp.ok(pg_temp.kw('zqalpha zqbeta', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)') = array[pg_temp.cid('ts'), pg_temp.cid('t1')],
  'the list for two rare words is exactly the readable, embedded, indexed chunks holding both, nearest first');
select pg_temp.ok(pg_temp.kw('zqbeta ' || repeat('zqalpha ', 600), null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)') = array[pg_temp.cid('ts'), pg_temp.cid('t1')]
  and pg_temp.kw($$qq'alpha \ "qqbeta"; drop table x --$$, null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)') = '{}',
  'a long text and quotes, backslashes and punctuation in the text are harmless');
-- The index. Mirror of the NCLT fixture's plan guard: the helper never scans a chunk partition sequentially; the same predicate
-- written directly as authenticated does.
reset role;
create function pg_temp.seq_scans() returns bigint language sql as $$
  select coalesce(sum(pg_stat_get_xact_numscans(c.oid)), 0)::bigint
    from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'public.document_chunks'::regclass
$$;
create function pg_temp.gin_scans() returns bigint language sql as $$
  select coalesce(sum(pg_stat_get_xact_numscans(k.oid)), 0)::bigint from pg_class k where k.relname like 'document_chunks%to_tsvector_idx'
$$;
create function public.hs_direct_probe(q tsquery) returns bigint language sql stable security invoker set search_path = public, extensions as $$
  select count(*) from (select 1 from public.document_chunks where to_tsvector('simple'::regconfig, content) @@ q limit 2001) x
$$;
grant execute on function public.hs_direct_probe(tsquery) to authenticated;
create temp table plan_stats(label text primary key, seq bigint, gin bigint);
grant all on plan_stats to authenticated;
set local role authenticated;
do $$
declare s0 bigint; g0 bigint; n bigint;
begin
  s0 := pg_temp.seq_scans(); g0 := pg_temp.gin_scans();
  select count(*) into n from retrieval_internal.keyword_candidate_ids('qqqaaa qqqbbb', (select v from q where name = 'near'), null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)');
  insert into plan_stats values ('probes only', pg_temp.seq_scans() - s0, pg_temp.gin_scans() - g0);
  s0 := pg_temp.seq_scans(); g0 := pg_temp.gin_scans();
  select count(*) into n from retrieval_internal.keyword_candidate_ids('zqalpha zqbeta', (select v from q where name = 'near'), null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)');
  insert into plan_stats values ('helper', pg_temp.seq_scans() - s0, pg_temp.gin_scans() - g0);
  s0 := pg_temp.seq_scans(); g0 := pg_temp.gin_scans();
  select count(*) into n from retrieval_internal.keyword_candidate_ids('cmnw', (select v from q where name = 'near'), null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)');
  insert into plan_stats values ('common word', pg_temp.seq_scans() - s0, pg_temp.gin_scans() - g0);
  s0 := pg_temp.seq_scans(); g0 := pg_temp.gin_scans();
  select public.hs_direct_probe(to_tsquery('simple', 'zqalpha | zqbeta')) into n;
  insert into plan_stats values ('direct', pg_temp.seq_scans() - s0, pg_temp.gin_scans() - g0);
end $$;
reset role;
select pg_temp.ok((select seq = 0 from plan_stats where label = 'helper') and (select seq = 0 from plan_stats where label = 'probes only')
  and (select gin from plan_stats where label = 'probes only') > 0
  and (select gin from plan_stats where label = 'helper') > (select gin from plan_stats where label = 'probes only'),
  'the helper, called as authenticated: no chunk partition is scanned sequentially; the probes and the candidate scan read the GIN index');
-- The session keeps its default planner settings here (sequential scans allowed); with them the default planner scans the
-- partition sequentially for a word in 30000 of its chunks (it expects to find 2001 matches early), so only the helper's
-- own settings can keep the probe off a sequential scan. (The bitmap plan it then takes may read the desk's btree index
-- instead of the keyword index: both are bitmap scans, about 12 ms against 200 ms measured on a 40,000-chunk partition.)
select pg_temp.ok((select seq = 0 from plan_stats where label = 'common word')
  and (select count(*) from plan_stats where label = 'common word') = 1,
  'a word in tens of thousands of chunks is probed without a sequential scan, with the session''s default planner settings (R2)');
select pg_temp.ok((select seq > 0 and gin = 0 from plan_stats where label = 'direct'),
  'the check can fail: the same keyword predicate run directly as authenticated scans the partitions sequentially');
drop function public.hs_direct_probe(tsquery);

-- R1. Ties at the cut: 400 chunks with one score; the list is the 100 nearest of them (the cut at 300 keeps every tie).
select pg_temp.ok((select count(*) from document_chunks where chunk_hash like 'tie-%') = 400
  and pg_temp.kw('tiealpha tiebeta', null, 'Regulatory Body Watch (RBI SEBI TRAI CCI)') =
      (select array_agg(t.id order by t.dist, t.id) from
         (select c.id, (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'near')::halfvec(1536)) as dist
            from document_chunks c where c.chunk_hash like 'tie-%'
           order by 2, 1 limit 100) t),
  'more than 300 chunks tie on score: the list is the 100 nearest of all the tied chunks, not the first 300 by chunk id');

-- ===========================================================================================
-- Part 6. NCLT keeps its own rule. 'nclname' is in the title of one NCLT order (a name), 'ncother' is not: the NCLT rule
-- searches the name only and so returns the chunk holding it; the general rule needs both words and would return neither.
-- (A flag row for NCLT cannot exist, part 4, so the general rule is never reachable for it.)
set local role authenticated;
create temp table nclt_got(label text primary key, ids uuid[]);
grant all on nclt_got to authenticated;
insert into nclt_got values ('plain', pg_temp.idsof(pg_temp.h('nclname ncother', 40, null, null, 'NCLT / NCLAT (Insolvency)')));
reset role;
select pg_temp.ok((select ids from nclt_got where label = 'plain') @> array[pg_temp.cid('n1')]
  and not (select ids from nclt_got where label = 'plain') @> array[pg_temp.cid('n2')],
  'NCLT: the title-gated name rule runs (the general rule would return neither chunk)');

rollback;
