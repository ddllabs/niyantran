-- Keeping NCLT search warm. Disposable fixture. run.sh uses the bare bootstrap_auth chain (roles, extensions schema),
-- then 20261111090000_search_keep_warm (as a non-superuser). The function only looks relations up by name (and the
-- TOAST relation through the catalogs), so the fixture creates stand-ins with the exact names.
-- Spec: docs/specs/2026-11-11-search-keep-warm.md. Without the migration the function does not exist, so the vacuity check fails.
\set ON_ERROR_STOP on
begin;
set search_path=public,extensions;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end$$;

select pg_temp.ok((select not prosecdef and proconfig @> array['search_path=""','lock_timeout=2s']
   from pg_proc where oid='public.search_keep_warm()'::regprocedure),
  'function exists, is security invoker, has an empty search_path and a lock_timeout');

create table public.document_chunks_nclt(id int primary key, content text);
create index document_chunks_nclt_embedding_halfvec_hnsw on public.document_chunks_nclt(id);
create index document_chunks_nclt_to_tsvector_idx on public.document_chunks_nclt(content);
insert into public.document_chunks_nclt values (1,'insolvency resolution');

-- Run as postgres (the cron job's role): the three named relations, in order, blocks never negative; not the TOAST
-- relation (on NTER it does not stay cached in 8 GB: every prefetch re-read it, 2026-11-11).
select pg_temp.ok((select jsonb_array_length(public.search_keep_warm())=3
  and (select array_agg(e->>'relation' order by ord) from jsonb_array_elements(public.search_keep_warm()) with ordinality t(e,ord))
      =array['public.document_chunks_nclt_embedding_halfvec_hnsw','public.document_chunks_nclt_to_tsvector_idx','public.document_chunks_nclt']
  and (select bool_and((e->>'blocks')::bigint>=0) from jsonb_array_elements(public.search_keep_warm()) e)),
  'postgres gets the three named relations and not the TOAST relation, blocks >= 0');
select pg_temp.ok((select (e->>'blocks')::bigint>=1 from jsonb_array_elements(public.search_keep_warm()) e
   where e->>'relation'='public.document_chunks_nclt'),'the table reports blocks once it holds a row');

-- A missing relation is skipped (with a WARNING naming it), not an error.
alter index public.document_chunks_nclt_to_tsvector_idx rename to kw_renamed;
select pg_temp.ok((select jsonb_array_length(public.search_keep_warm())=2
  and not exists(select 1 from jsonb_array_elements(public.search_keep_warm()) e where e->>'relation' like '%tsvector_idx')),
  'a missing relation is skipped');
alter index public.kw_renamed rename to document_chunks_nclt_to_tsvector_idx;

-- The fallback is only on feature_not_supported (a schema-qualified pg_prewarm call cannot be stubbed, so the source is read).
select pg_temp.ok(exists(select 1 from pg_proc where oid='public.search_keep_warm()'::regprocedure
   and prosrc like '%feature_not_supported%' and prosrc like '%''read''%' and prosrc not like '%when others%'),
  'falls back to read only on feature_not_supported');

-- Privileges: the extension has exactly three functions; none is executable by PUBLIC, anon or authenticated; nobody
-- but the owner is granted anything; the function itself is the same.
create temp table kw_fns as
 select p.oid, p.proowner, p.proacl from pg_depend d join pg_extension e on e.oid=d.refobjid and d.refclassid='pg_extension'::regclass
   join pg_proc p on p.oid=d.objid and d.classid='pg_proc'::regclass where e.extname='pg_prewarm' and d.deptype='e'
 union all select oid, proowner, proacl from pg_proc where oid='public.search_keep_warm()'::regprocedure;
select pg_temp.ok((select count(*)=4 from kw_fns),'the extension has exactly three functions (plus search_keep_warm)');
-- The migration grants nothing; service_role may hold execute only through the platform's default privileges on new
-- functions in public (the fixture's role setup reproduces them), which it neither adds nor removes.
select pg_temp.ok(not exists(select 1 from kw_fns f, aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
   where a.grantee<>f.proowner and a.grantee<>(select oid from pg_roles where rolname='service_role')),
  'no grantee but the owner (and service_role by default privileges), and no PUBLIC');
select pg_temp.ok(not exists(select 1 from kw_fns f where has_function_privilege('anon',f.oid,'execute')
   or has_function_privilege('authenticated',f.oid,'execute')),'anon and authenticated cannot execute any of them');
select pg_temp.ok(not exists(select 1 from kw_fns f where f.oid<>'public.search_keep_warm()'::regprocedure
   and has_function_privilege('service_role',f.oid,'execute')),'the migration grants service_role nothing on the extension functions');
select pg_temp.ok(has_function_privilege('postgres','extensions.pg_prewarm(regclass,text,text,bigint,bigint)','execute'),'postgres can execute pg_prewarm');

set local role anon;
do $$ begin perform public.search_keep_warm(); raise exception 'FAIL anon ran it';
 exception when insufficient_privilege then raise notice 'PASS anon is refused the function'; end $$;
reset role;
set local role authenticated;
do $$ begin perform extensions.pg_prewarm('public.document_chunks_nclt'::regclass);
 raise exception 'FAIL authenticated ran pg_prewarm';
 exception when insufficient_privilege then raise notice 'PASS authenticated is refused pg_prewarm'; end $$;
reset role;

-- The migration's own self-check (its text, as pg_temp.selfcheck()): passes on the applied grants, and raises once a
-- grant to anon, to PUBLIC or to authenticated is added, or postgres loses pg_prewarm.
\i supabase/migrations/20261111090000_search_keep_warm.sql
select pg_temp.selfcheck();
select pg_temp.ok(true,'the self-check passes on the applied grants');
create function pg_temp.selfcheck_raises() returns boolean language plpgsql as $$begin
 perform pg_temp.selfcheck(); return false;
exception when raise_exception then return true; end$$;
grant execute on function public.search_keep_warm() to anon;
select pg_temp.ok(pg_temp.selfcheck_raises(),'the self-check raises when anon is granted search_keep_warm');
revoke execute on function public.search_keep_warm() from anon;
grant execute on function extensions.pg_prewarm(regclass,text,text,bigint,bigint) to authenticated;
select pg_temp.ok(pg_temp.selfcheck_raises(),'the self-check raises when authenticated is granted pg_prewarm');
revoke execute on function extensions.pg_prewarm(regclass,text,text,bigint,bigint) from authenticated;
grant execute on function extensions.autoprewarm_dump_now() to public;
select pg_temp.ok(pg_temp.selfcheck_raises(),'the self-check raises when PUBLIC is granted an autoprewarm function');
revoke execute on function extensions.autoprewarm_dump_now() from public;
select pg_temp.ok(not pg_temp.selfcheck_raises(),'the self-check passes again once the grants are removed');

-- As on Supabase: an extension function owned by another role (there supabase_admin), which granted PUBLIC execute
-- that the migrating role cannot revoke. The self-check, run as the migrating role, records it and does not raise;
-- it still raises for the function the migration owns.
create role sim_platform_admin;
alter function extensions.autoprewarm_dump_now() owner to sim_platform_admin;
grant execute on function extensions.autoprewarm_dump_now() to public;
set role nter_migrator;
select pg_temp.ok(not pg_temp.selfcheck_raises(),'a PUBLIC grant by another owner is recorded, not raised');
reset role;
grant execute on function public.search_keep_warm() to anon;
set role nter_migrator;
select pg_temp.ok(pg_temp.selfcheck_raises(),'the self-check still raises for the function the migration owns');
reset role;
rollback;
