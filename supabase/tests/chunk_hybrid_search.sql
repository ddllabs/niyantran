-- Disposable local fixture for 20261102120000_chunk_hybrid_search (F278 step 4, plan
-- docs/plans/2026-11-02-phase-c-hybrid-and-registration.md task C1).
-- Chain: document_chunks_partitions' chain (the law listing, the partitioned document_chunks of
-- 20261101120000 and the policy set of 20261101110000) + the migration, as a non-superuser.
--
--   Part 1  what the migration creates: the keyword index on the parent and on every partition, in
--           the one text configuration the function uses; the function's signature, result columns,
--           security, search_path, volatility and grants (anon denied).
--   Part 2  behaviour on a small seeded corpus, as `authenticated` under RLS and the law serving
--           policy. The vector side is made exact (enable_indexscan off, so the HNSW indexes are not
--           used on these few rows; match_documents' approximate passes are its own fixtures'
--           business), and an independent oracle written in plain SQL (reciprocal rank fusion over
--           the same scope, k = 60, 100 candidates a side) must equal the function row for row, in
--           every scope: unscoped, tier, feature, document ids, and combinations. A keyword-only
--           match (an identifier whose chunk the vector search ranks far outside its candidates)
--           is returned; nothing outside the scope, hidden by RLS or the law policy, unindexed or
--           without a vector is returned; null, empty and no-lexeme text return the vector result
--           unchanged; the caller's hnsw settings are restored.
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

select pg_temp.ok(to_regprocedure('public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)') is not null,
  'match_documents_hybrid(query_embedding, query_text, match_count, p_document_ids, p_desk_tier, p_desk_feature) exists');
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
  'security invoker, stable, set-returning, the same fixed search_path as match_documents');
select pg_temp.ok(not has_function_privilege('anon', 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)', 'execute')
  and has_function_privilege('service_role', 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                   where p.oid = 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)'::regprocedure and a.grantee = 0),
  'executable by authenticated and service_role; not by anon or PUBLIC');

-- The constants the measurement chose (docs/research/2026-11-02-hybrid-search.md): changing one is a decision to re-measure.
select pg_temp.ok((select position('c_rrf_k constant int := 60;' in prosrc) > 0 and position('c_candidates constant int := 100;' in prosrc) > 0
                          and position('c_keyword_cap constant int := 2000;' in prosrc) > 0
                     from pg_proc where oid = 'public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)'::regprocedure),
  'the fusion constant (60), the candidates per side (100) and the keyword cap (2000) are the documented ones');

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
select pg_temp.ok((select def ~ '^USING gin \(to_tsvector\(''(simple|english)''::regconfig, content\)\)$' from kw_idx where tab = 'document_chunks'),
  'the index is on the expression to_tsvector(<config>::regconfig, content): no stored column');
select pg_temp.ok((select count(*) = count(*) filter (where am = 'gin' and indisvalid and parent = 'document_chunks_content_tsv' and def = (select def from kw_idx where tab = 'document_chunks'))
                          and count(*) >= 2
                     from kw_idx where tab <> 'document_chunks'),
  'every partition has the same valid index, attached to the parent index');
select pg_temp.ok((select array_agg(c.relname::text order by c.relname) from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'public.document_chunks'::regclass)
  = (select array_agg(tab order by tab) from kw_idx where tab <> 'document_chunks'),
  'the partitions with a keyword index are exactly the partitions of document_chunks');
select pg_temp.ok(pg_get_functiondef('public.match_documents_hybrid(extensions.vector, text, integer, uuid[], text, text)'::regprocedure)
  like '%to_tsvector(' || quote_literal((select substring(def from 'to_tsvector\(''([a-z]+)''') from kw_idx where tab = 'document_chunks')) || '::regconfig, c.content)%',
  'the function ranks and matches on exactly the indexed expression, in the same configuration');

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

-- 130 vector-near chunks (distance 0.004 k from axis 1) spread over the six searchable documents;
-- chunk 3 also holds the identifier. The identifier's other chunks are vector-far (distance
-- 0.70 + 0.02 i, outside the 100 nearest) and sit in every kind of document, searchable or not.
-- (A writer sets desk_feature to its document's, as chunk_commit does; the trigger fills the other facets.)
insert into document_chunks (document_id, desk_feature, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select d.id, d.desk_feature, 'near' || k, k, 0, 4, case when k = 3 then 'filler passage ' || k || ' mentions zq4417 once' else 'filler passage ' || k end,
       pg_temp.cone(1, 0.004 * k, k), 4
  from generate_series(1, 130) k
  join documents d on d.id = (array['f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001',
              'f2000000-0000-4000-8000-000000000002', 'f3000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001'])[1 + k % 6]::uuid;
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
    ('f2000000-0000-4000-8000-000000000001', 'far-phrase', 'the quorum vexilla was recorded', 10),
    ('f2000000-0000-4000-8000-000000000001', 'far-reversed', 'vexilla and quorum, reversed', 11),
    ('f2000000-0000-4000-8000-000000000001', 'far-quorum', 'only the quorum', 12)
  ) v(doc, h, content, i) join documents d on d.id = v.doc::uuid;
analyze documents; analyze document_chunks;

update law_listing_settings set seeded = true, active = true;
create temp table cfg as
  select (select substring(def from 'to_tsvector\(''([a-z]+)''') from kw_idx where tab = 'document_chunks')::regconfig as c;
grant select on cfg to authenticated, service_role;
create temp table q(name text primary key, v vector);
insert into q values ('near', pg_temp.cone(1, 0, 0)), ('side', pg_temp.cone(1, 0.3, 77));
grant select on q to authenticated, service_role;
create temp table want(label text primary key, ids uuid[]);
create temp table got(label text primary key, ids uuid[]);
grant all on want, got to authenticated, service_role;

-- The oracle: reciprocal rank fusion in plain SQL, as the invoking role (RLS applies). Vector side:
-- the 100 nearest eligible chunks, ranked by the distance match_documents ranks by (halfvec when
-- unscoped, full precision when scoped). Keyword side: websearch_to_tsquery matches ranked by
-- ts_rank_cd, ties by id. Scope as match_documents: document ids win over a feature.
create function pg_temp.oracle(qv vector, qtext text, n int, ids uuid[], tier text, feat text) returns uuid[] language sql as $$
  with scope as (
    select c.id, c.content, c.embedding, c.document_id,
           case when coalesce(cardinality(ids), 0) = 0 and feat is null
                then (c.embedding::halfvec(1536)) <=> (qv::halfvec(1536)) else c.embedding <=> qv end as dist
      from document_chunks c join documents d on d.id = c.document_id
     where c.embedding is not null and d.indexed_at is not null
       and (coalesce(cardinality(ids), 0) = 0 or c.document_id = any (ids))
       and (coalesce(cardinality(ids), 0) > 0 or feat is null or c.desk_feature = feat)
       and (tier is null or d.desk_tier = tier)),
  vec as (select id, row_number() over (order by dist, id) rn from scope order by dist, id limit 100),
  kw as (select id, row_number() over (order by ts_rank_cd(to_tsvector((select c from cfg), content), websearch_to_tsquery((select c from cfg), qtext)) desc, id) rn
           from scope
          where nullif(trim(qtext), '') is not null
            and numnode(websearch_to_tsquery((select c from cfg), qtext)) > 0
            and to_tsvector((select c from cfg), content) @@ websearch_to_tsquery((select c from cfg), qtext)),
  fused as (select coalesce(v.id, k.id) id, v.rn vr, k.rn kr, coalesce(1.0 / (60 + v.rn), 0) + coalesce(1.0 / (60 + k.rn), 0) score
              from vec v full join (select * from kw limit 1000) k on k.id = v.id)
  select array_agg(id order by score desc, vr nulls last, kr nulls last, id)
    from (select * from fused order by score desc, vr nulls last, kr nulls last, id limit n) f
$$;
-- The function's rows, in order.
create function pg_temp.hybrid(qv vector, qtext text, n int default 40, ids uuid[] default null, tier text default null, feat text default null)
returns uuid[] language sql as $$
  select array_agg(id order by ord) from (select id, row_number() over () ord from match_documents_hybrid(qv, qtext, n, ids, tier, feat)) f
$$;
create function pg_temp.vector_only(qv vector, n int default 40, ids uuid[] default null, tier text default null, feat text default null)
returns uuid[] language sql as $$
  select array_agg(id order by ord) from (select id, row_number() over () ord from match_documents(qv, n, ids, tier, feat)) f
$$;
create function pg_temp.g(l text) returns uuid[] language sql as $$ select ids from got where label = l $$;
create function pg_temp.cid(h text) returns uuid language sql as $$ select id from document_chunks where chunk_hash = h $$;
create function pg_temp.cids(hs text[]) returns uuid[] language sql as $$ select array_agg(pg_temp.cid(h) order by o) from unnest(hs) with ordinality t(h, o) $$;

-- The vector side is exact on these few rows: no index scans (GIN is bitmap-only, unaffected).
set local enable_indexscan = off;
set local hnsw.ef_search = 40;
set local hnsw.iterative_scan = 'strict_order';
set local role authenticated;

-- 1. A keyword-only match: the identifier's far chunks are outside the vector search's reach.
insert into got values ('v-unscoped', pg_temp.vector_only((select v from q where name = 'near'), 40));
insert into got values ('h-unscoped', pg_temp.hybrid((select v from q where name = 'near'), 'zq4417', 40));
reset role;
select pg_temp.ok(not (pg_temp.cids(array['far-nclt', 'far-bill', 'far-state', 'far-pq', 'far-nofeature']) && (select ids from got where label = 'v-unscoped')),
  'vector search alone does not return the identifier''s far chunks (they are keyword-only matches)');
select pg_temp.ok(pg_temp.cids(array['far-nclt', 'far-bill', 'far-state', 'far-pq', 'far-nofeature']) <@ (select ids from got where label = 'h-unscoped'),
  'hybrid returns all five searchable keyword-only matches');
select pg_temp.ok(pg_temp.cid('near3') = any ((select ids from got where label = 'h-unscoped')[1:3]),
  'the chunk that matches both sides (near chunk 3) is in the first three rows');
select pg_temp.ok(not (pg_temp.cids(array['far-hidden', 'far-unindexed', 'far-null']) && (select ids from got where label = 'h-unscoped')),
  'hidden by the law policy, unindexed and without a vector: none returned');
select pg_temp.ok(cardinality((select ids from got where label = 'h-unscoped')) = 40, 'match_count rows come back');

-- 2. The oracle equals the function, row for row, in every scope.
create temp table cases(label text primary key, qtext text, n int, ids uuid[], tier text, feat text, qv text);
grant all on cases to authenticated, service_role;
insert into cases values
  ('unscoped',            'zq4417',            40,  null, null,       null, 'near'),
  ('unscoped-10',         'zq4417',            10,  null, null,       null, 'near'),
  ('unscoped-side',       'zq4417',            40,  null, null,       null, 'side'),
  ('tier-national',       'zq4417',            40,  null, 'national', null, 'near'),
  ('tier-state',          'zq4417',            40,  null, 'state',    null, 'near'),
  ('feature-nclt',        'zq4417',            40,  null, null, 'NCLT / NCLAT (Insolvency)', 'near'),
  ('feature-bills',       'zq4417',            40,  null, null, 'Bill Passage Probability Index', 'near'),
  ('feature-bills-state', 'zq4417',            40,  null, 'state', 'Bill Passage Probability Index', 'near'),
  ('feature-pq',          'zq4417',            40,  null, null, 'Parliamentary Question Database', 'near'),
  ('feature-none',        'zq4417',            40,  null, null, 'Industry Updates (Ministry Data)', 'near'),
  ('ids',                 'zq4417',            40,  array['f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001']::uuid[], null, null, 'near'),
  ('ids-ignore-feature',  'zq4417',            40,  array['f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001']::uuid[], null, 'Parliamentary Question Database', 'near'),
  ('ids-with-tier',       'zq4417',            40,  array['f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001']::uuid[], 'law', null, 'near'),
  ('ids-unindexed',       'zq4417',            40,  array['f2000000-0000-4000-8000-000000000003']::uuid[], null, null, 'near'),
  ('ids-hidden',          'zq4417',            40,  array['f1000000-0000-4000-8000-000000000003']::uuid[], null, null, 'near'),
  ('empty-ids',           'zq4417',            40,  array[]::uuid[], null, null, 'near'),
  ('phrase',              '"quorum vexilla"',  40,  null, null,       null, 'near'),
  ('two-terms',           'quorum vexilla',    40,  null, null,       null, 'near'),
  ('negation',            'quorum -vexilla',   40,  null, null,       null, 'near'),
  ('no-match',            'qqqzzzxxx',         40,  null, null,       null, 'near'),
  ('count-1',             'zq4417',            1,   null, null,       null, 'near'),
  ('count-0',             'zq4417',            0,   null, null,       null, 'near'),
  ('count-null',          'zq4417',            null, null, null,      null, 'near'),
  ('count-big',           'zq4417',            1000, null, null,      null, 'near');
set local role authenticated;
insert into want select label, pg_temp.oracle((select v from q where name = qv), qtext, least(greatest(coalesce(n, 40), 1), 200), ids, tier, feat) from cases;
insert into got select label || '#', pg_temp.hybrid((select v from q where name = qv), qtext, n, ids, tier, feat) from cases;
reset role;
do $$
declare r record;
begin
  for r in select w.label, w.ids as want, g.ids as got from want w join got g on g.label = w.label || '#' where w.ids is distinct from g.ids loop
    raise exception 'FAIL: hybrid differs from the oracle in scope %: want % got %', r.label, r.want, r.got;
  end loop;
  raise notice 'PASS: hybrid equals the independent RRF oracle, row for row, in all 24 scopes and count edge cases';
end $$;
select pg_temp.ok((select count(*) from want where ids is not null) = 21
  and (select array_agg(label order by label) from want where ids is null) = array['feature-none', 'ids-hidden', 'ids-unindexed'],
  'the comparison is not vacuous: 21 scopes return rows, the three with nothing visible return none');
select pg_temp.ok((select cardinality(ids) from got where label = 'count-0#') = 1
  and (select cardinality(ids) from got where label = 'count-1#') = 1
  and (select cardinality(ids) from got where label = 'count-null#') = 40
  and (select cardinality(ids) from got where label = 'unscoped-10#') = 10,
  'match_count: 0 becomes 1, null means 40');
select pg_temp.ok((select cardinality(ids) from got where label = 'count-big#') = 105,
  'match_count above 200 is clamped to 200: 105 rows exist (100 vector candidates and the 5 keyword-only matches)');

-- 3. Scope is respected on the keyword side.
select pg_temp.ok((select ids from got where label = 'feature-nclt#') && pg_temp.cids(array['far-nclt'])
  and not ((select ids from got where label = 'feature-nclt#') && pg_temp.cids(array['far-bill', 'far-state', 'far-pq', 'far-nofeature'])),
  'feature: only NCLT chunks, including the keyword-only NCLT match');
select pg_temp.ok(not ((select ids from got where label = 'tier-state#') && pg_temp.cids(array['far-nclt', 'far-bill', 'far-pq', 'far-nofeature']))
  and (select ids from got where label = 'tier-state#') && pg_temp.cids(array['far-state']),
  'tier: only state-tier chunks');
select pg_temp.ok((select ids from got where label = 'feature-bills-state#') && pg_temp.cids(array['far-state'])
  and not ((select ids from got where label = 'feature-bills-state#') && pg_temp.cids(array['far-bill'])),
  'feature and tier together: the state Bill only');
select pg_temp.ok((select ids from got where label = 'ids#') && pg_temp.cids(array['far-nclt', 'far-bill'])
  and not ((select ids from got where label = 'ids#') && pg_temp.cids(array['far-state', 'far-pq', 'far-nofeature']))
  and not exists (select 1 from document_chunks c where c.id = any (pg_temp.g('ids#'))
                    and c.document_id not in ('f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001')),
  'document ids: only the named documents, including their keyword-only matches');
select pg_temp.ok((select ids from got where label = 'ids#') = (select ids from got where label = 'ids-ignore-feature#'),
  'document ids win over a feature, as in match_documents');
select pg_temp.ok((select ids from got where label = 'ids-with-tier#') is not null
  and not exists (select 1 from document_chunks c where c.id = any (pg_temp.g('ids-with-tier#')) and c.document_id <> 'f1000000-0000-4000-8000-000000000001'),
  'document ids and a tier together: the tier filters the named documents');
select pg_temp.ok((select ids from got where label = 'empty-ids#') = (select ids from got where label = 'unscoped#'),
  'an empty document id array means unscoped, as in match_documents');
select pg_temp.ok((select ids from got where label = 'feature-none#') is null,
  'a feature without chunks returns nothing, not a keyword match from another feature');

-- 4. Websearch syntax is honoured on the keyword side (the chunks involved are vector-far, so only
-- the keyword search can bring them).
select pg_temp.ok((select ids from got where label = 'phrase#') && pg_temp.cids(array['far-phrase'])
  and not ((select ids from got where label = 'phrase#') && pg_temp.cids(array['far-reversed', 'far-quorum'])),
  'a quoted phrase matches only the chunk with the words adjacent, in order');
select pg_temp.ok((select ids from got where label = 'two-terms#') @> pg_temp.cids(array['far-phrase', 'far-reversed'])
  and not ((select ids from got where label = 'two-terms#') && pg_temp.cids(array['far-quorum'])),
  'two words without quotes match every chunk that has both');
select pg_temp.ok((select ids from got where label = 'negation#') && pg_temp.cids(array['far-quorum'])
  and not ((select ids from got where label = 'negation#') && pg_temp.cids(array['far-phrase', 'far-reversed'])),
  'a negated word excludes the chunks that have it');

-- 5. Text that gives no keyword search returns the vector result unchanged.
set local role authenticated;
insert into got select 'null-text', pg_temp.hybrid((select v from q where name = 'near'), null);
insert into got select 'empty-text', pg_temp.hybrid((select v from q where name = 'near'), '');
insert into got select 'blank-text', pg_temp.hybrid((select v from q where name = 'near'), E'  \n\t ');
insert into got select 'punctuation-text', pg_temp.hybrid((select v from q where name = 'near'), '!!! ... ---');
insert into got select 'v-feature', pg_temp.vector_only((select v from q where name = 'near'), 40, null, null, 'NCLT / NCLAT (Insolvency)');
insert into got select 'null-text-feature', pg_temp.hybrid((select v from q where name = 'near'), null, 40, null, null, 'NCLT / NCLAT (Insolvency)');
insert into got select 'v-ids', pg_temp.vector_only((select v from q where name = 'near'), 40, array['f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001']::uuid[]);
insert into got select 'null-text-ids', pg_temp.hybrid((select v from q where name = 'near'), null, 40, array['f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001']::uuid[]);
insert into got select 'v-tier', pg_temp.vector_only((select v from q where name = 'near'), 40, null, 'state');
insert into got select 'empty-text-tier', pg_temp.hybrid((select v from q where name = 'near'), '', 40, null, 'state');
reset role;
select pg_temp.ok((select ids from got where label = 'v-unscoped') is not null
  and (select ids from got where label = 'null-text') = (select ids from got where label = 'v-unscoped')
  and (select ids from got where label = 'empty-text') = (select ids from got where label = 'v-unscoped')
  and (select ids from got where label = 'blank-text') = (select ids from got where label = 'v-unscoped')
  and (select ids from got where label = 'punctuation-text') = (select ids from got where label = 'v-unscoped'),
  'null, empty, blank and no-lexeme text: exactly the match_documents rows, in order');
select pg_temp.ok((select ids from got where label = 'v-feature') is not null
  and (select ids from got where label = 'null-text-feature') = (select ids from got where label = 'v-feature')
  and (select ids from got where label = 'null-text-ids') = (select ids from got where label = 'v-ids')
  and (select ids from got where label = 'empty-text-tier') = (select ids from got where label = 'v-tier'),
  'the same in a feature, a document-id and a tier scope');
select pg_temp.ok((select ids from got where label = 'no-match#') = (select ids from got where label = 'v-unscoped'),
  'text that matches no chunk: the vector result');

-- 6. The access check: RLS and the law serving policy hide the same rows as match_documents.
-- The unpublished order is hidden from authenticated while the law listing is active, visible to
-- service_role (which bypasses RLS) and visible again once the listing is off.
create temp table hid(state text, role text, fn text, n int);
grant all on hid to authenticated, service_role;
create function pg_temp.hid_rows(st text, rl text) returns void language plpgsql as $$
begin
  perform set_config('role', rl, true);
  insert into hid select st, rl, 'match_documents', count(*) from match_documents((select v from q where name = 'near'), 40, array['f1000000-0000-4000-8000-000000000003']::uuid[]);
  insert into hid select st, rl, 'hybrid', count(*) from match_documents_hybrid((select v from q where name = 'near'), 'zq4417', 40, array['f1000000-0000-4000-8000-000000000003']::uuid[]);
  insert into hid select st, rl, 'hybrid-feature', count(*) from match_documents_hybrid((select v from q where name = 'near'), 'zq4417', 40, null, null, 'NCLT / NCLAT (Insolvency)') h
    where h.document_id = 'f1000000-0000-4000-8000-000000000003';
  perform set_config('role', 'postgres', true);
end $$;
select pg_temp.hid_rows('listing active', 'authenticated');
select pg_temp.hid_rows('listing active', 'service_role');
update law_listing_settings set active = false;
select pg_temp.hid_rows('listing off', 'authenticated');
update law_listing_settings set active = true;
select pg_temp.ok((select array_agg(row(role, fn, n)::text order by role, fn) from hid where state = 'listing active')
  = array['(authenticated,hybrid,0)', '(authenticated,hybrid-feature,0)', '(authenticated,match_documents,0)',
          '(service_role,hybrid,1)', '(service_role,hybrid-feature,1)', '(service_role,match_documents,1)'],
  'listing active: the unpublished order''s chunk is hidden from authenticated in both functions, visible to service_role in both');
select pg_temp.ok((select array_agg(row(fn, n)::text order by fn) from hid where state = 'listing off')
  = array['(hybrid,1)', '(hybrid-feature,1)', '(match_documents,1)'],
  'listing off: visible to authenticated in both functions (the hiding above is not vacuous)');

-- 7. Privileges and settings.
set local role anon;
select pg_temp.fails($q$select * from match_documents_hybrid(pg_temp.cone(1, 0, 0), 'zq4417')$q$, '42501', 'anon cannot search');
reset role;
select pg_temp.ok(current_setting('hnsw.ef_search') = '40' and current_setting('hnsw.iterative_scan') = 'strict_order',
  'the caller''s ef_search and iterative_scan are restored after every search');
set local search_path = pg_catalog;
set local role authenticated;
select pg_temp.ok((select count(*) from public.match_documents_hybrid((select v from q where name = 'near'), 'zq4417', 5)) = 5,
  'five rows with a caller search_path that names neither public nor extensions (the function carries its own)');
reset role;
set local search_path = public, extensions;

-- 8. The keyword predicate, as the function writes it, is served by the GIN index of every partition.
create function pg_temp.plan(q text) returns text language plpgsql as $$
declare l text; res text := '';
begin
  for l in execute 'explain ' || q loop res := res || l || E'\n'; end loop;
  return res;
end $$;
set local enable_seqscan = off;
select pg_temp.ok((select bool_and(pg_temp.plan(format(
          'select id from document_chunks where to_tsvector(%1$L::regconfig, content) @@ websearch_to_tsquery(%1$L::regconfig, %2$L)', (select c::text from cfg), 'zq4417')) like '%' || k.name || '%')
                     from kw_idx k where k.tab <> 'document_chunks'),
  'the planner reads each partition''s keyword index for the function''s predicate');

commit;
