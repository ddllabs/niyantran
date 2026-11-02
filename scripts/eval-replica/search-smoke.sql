-- Smoke test for the replica's search functions: one match_documents call in each mode, as role
-- authenticated (under RLS and its 8 s statement timeout), using an existing chunk's embedding as the
-- query. Read-only. REPLICA ONLY:
--
--   docker exec -i niyantran-corpus-test-db psql -U postgres -d niyantran_retrieval_replica -q -f - < scripts/eval-replica/search-smoke.sql
--
-- Every row's `returned` should be 10 (or the most the feature holds), and no call may raise.
-- The feature chosen as "large" is the one with the most indexed chunks; whether it takes the exact
-- path (<= 15,000 chunks) or the HNSW helper (more) is in `feature_chunks`.
\set ON_ERROR_STOP on
\pset format aligned
\pset tuples_only off

select c.embedding::text as q, c.document_id::text as doc, d.desk_tier as tier
  from public.document_chunks c join public.documents d on d.id = c.document_id
 where c.embedding is not null and d.indexed_at is not null
 order by c.id limit 1
\gset

create temp table smoke_features as
  select d.desk_tier, d.desk_feature, count(*) as n
    from public.document_chunks c join public.documents d on d.id = c.document_id
   where c.embedding is not null and d.indexed_at is not null and d.desk_feature is not null
   group by 1, 2;
select desk_tier as small_tier, desk_feature as small_feature from smoke_features where n >= 40 order by n asc limit 1
\gset
select desk_tier as large_tier, desk_feature as large_feature from smoke_features order by n desc limit 1
\gset
grant select on smoke_features to authenticated;

set role authenticated;
select 'unscoped' as mode, count(*) as returned, count(distinct document_id) as documents, round(max(similarity)::numeric, 4) as top_similarity
  from public.match_documents(:'q'::extensions.vector, 10)
union all
select 'document ids', count(*), count(distinct document_id), round(max(similarity)::numeric, 4)
  from public.match_documents(:'q'::extensions.vector, 10, array[:'doc']::uuid[])
union all
select 'tier only', count(*), count(distinct document_id), round(max(similarity)::numeric, 4)
  from public.match_documents(:'q'::extensions.vector, 10, null, :'tier')
union all
select 'feature, small', count(*), count(distinct document_id), round(max(similarity)::numeric, 4)
  from public.match_documents(:'q'::extensions.vector, 10, null, null, :'small_feature')
union all
select 'feature, large', count(*), count(distinct document_id), round(max(similarity)::numeric, 4)
  from public.match_documents(:'q'::extensions.vector, 10, null, null, :'large_feature')
union all
select 'feature + tier, large', count(*), count(distinct document_id), round(max(similarity)::numeric, 4)
  from public.match_documents(:'q'::extensions.vector, 10, null, :'large_tier', :'large_feature');
select desk_feature as feature, n as feature_chunks, case when n <= 15000 then 'exact' else 'hnsw helper' end as path
  from smoke_features where desk_feature in (:'small_feature', :'large_feature') order by n;
