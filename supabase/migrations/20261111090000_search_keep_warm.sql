-- Keeping NCLT search warm (T9 precondition; docs/specs/2026-11-11-search-keep-warm.md).
--
-- On NTER a hybrid search straight after the cache was evicted (a day of bulk loading, or a restart) read 103,664
-- vector-index blocks from disk and took 5.5 s. Nothing reloads the cache afterwards: pg_prewarm is not installed and
-- is not in shared_preload_libraries, so there is no autoprewarm. This adds the extension and one function that reads
-- NCLT's whole search set back into cache: its vector index, keyword index and table, and the table's TOAST relation
-- and TOAST index (the embeddings are stored out of line, attstorage 'e', and hybrid reads them for up to 2,000
-- candidates per search). About 3.0 GB on NTER's 8 GB; the developer chose this on 2026-11-11.
-- The schedule is not in this migration (as the other cron jobs): the runbook creates the pg_cron job
-- `search-keep-warm`, every 10 minutes, running `select public.search_keep_warm()`.
--
--   * create extension pg_prewarm in schema extensions. Execute on all its functions (pg_prewarm and the autoprewarm
--     ones) is revoked from public, anon and authenticated, and nobody else is granted it: pg_prewarm reads any
--     relation the caller can select, which is not an API surface. Only the owner keeps it (the cron job runs as
--     postgres). The same goes for public.search_keep_warm().
--   * public.search_keep_warm() returns jsonb: one entry per relation with `blocks` (the blocks requested of
--     pg_prewarm, not a count of blocks that really had to be read from disk). The three named relations are a fixed
--     list; the TOAST relation and its index are found from pg_class.reltoastrelid and pg_index, never by name. One
--     that does not exist (to_regclass is null, or no TOAST relation) is skipped with a WARNING naming it, so a
--     rename shows in the logs. It tries pg_prewarm(rel, 'prefetch') (asks the kernel to read ahead into the OS page
--     cache, not shared_buffers) and, where the build has no prefetch (SQLSTATE 0A000, feature_not_supported,
--     "prefetch is not supported by this build"), uses 'read' (into shared_buffers). Any other error is raised.
--     Security invoker: pg_prewarm needs SELECT on the relation, so it runs as its caller. lock_timeout 2 s, so it
--     never queues behind DDL on the partition and blocks everything behind it.
--   * The migration ends by checking its own grants and fails (so the apply fails, and rolls back) if public, anon or
--     authenticated can execute any pg_prewarm function or search_keep_warm(), or if postgres cannot execute
--     extensions.pg_prewarm. Where the extension's functions are owned by another role the revokes could otherwise do
--     nothing, silently.
--
-- Rollback: select cron.unschedule('search-keep-warm'); drop function public.search_keep_warm();
-- drop extension pg_prewarm; delete the migration history row. Nothing else depends on them.

begin;

create extension if not exists pg_prewarm with schema extensions;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_catalog.pg_depend d
      join pg_catalog.pg_proc p on p.oid = d.objid and d.classid = 'pg_catalog.pg_proc'::regclass
      join pg_catalog.pg_extension e on e.oid = d.refobjid and d.refclassid = 'pg_catalog.pg_extension'::regclass
     where e.extname = 'pg_prewarm' and d.deptype = 'e'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

create or replace function public.search_keep_warm()
returns jsonb
language plpgsql volatile security invoker set search_path = '' set lock_timeout = '2s' as $$
declare
  tbl constant regclass := pg_catalog.to_regclass('public.document_chunks_nclt');
  toast_rel oid;
  rels text[] := array[
    'public.document_chunks_nclt_embedding_halfvec_hnsw',
    'public.document_chunks_nclt_to_tsvector_idx',
    'public.document_chunks_nclt'
  ];
  rel text;
  oid_ regclass;
  blocks bigint;
  result jsonb := '[]'::jsonb;
begin
  -- The table's TOAST relation and its index, from the catalogs.
  if tbl is not null then
    select c.reltoastrelid into toast_rel from pg_catalog.pg_class c where c.oid = tbl;
    if toast_rel is not null and toast_rel <> 0 then
      rels := rels || toast_rel::regclass::text;
      select i.indexrelid::regclass::text into rel from pg_catalog.pg_index i where i.indrelid = toast_rel limit 1;
      if rel is not null then rels := rels || rel; end if;
    end if;
  end if;
  if array_length(rels, 1) < 5 then
    raise warning 'search_keep_warm: NCLT TOAST relation or its index not found';
  end if;
  foreach rel in array rels loop
    oid_ := pg_catalog.to_regclass(rel);
    if oid_ is null then
      raise warning 'search_keep_warm: relation % not found, skipped', rel;
      continue;
    end if;
    begin
      -- 'prefetch' targets the OS page cache (not shared_buffers); it returns the blocks requested.
      blocks := extensions.pg_prewarm(oid_, 'prefetch');
    exception when feature_not_supported then
      blocks := extensions.pg_prewarm(oid_, 'read');
    end;
    result := result || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('relation', rel, 'blocks', blocks));
  end loop;
  return result;
end $$;

revoke execute on function public.search_keep_warm() from public, anon, authenticated;

-- self-check begin
do $$
declare f record; r text;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig, p.proowner, p.proacl
      from pg_catalog.pg_depend d
      join pg_catalog.pg_proc p on p.oid = d.objid and d.classid = 'pg_catalog.pg_proc'::regclass
      join pg_catalog.pg_extension e on e.oid = d.refobjid and d.refclassid = 'pg_catalog.pg_extension'::regclass
     where e.extname = 'pg_prewarm' and d.deptype = 'e'
    union all
    select p.oid, p.oid::regprocedure, p.proowner, p.proacl
      from pg_catalog.pg_proc p where p.oid = 'public.search_keep_warm()'::regprocedure
  loop
    if exists (select 1 from pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
                where a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception 'search_keep_warm self-check: PUBLIC can execute %', f.sig;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_catalog.pg_roles where rolname = r)
         and pg_catalog.has_function_privilege(r, f.oid, 'execute') then
        raise exception 'search_keep_warm self-check: % can execute %', r, f.sig;
      end if;
    end loop;
  end loop;
  if not pg_catalog.has_function_privilege('postgres', 'extensions.pg_prewarm(regclass,text,text,bigint,bigint)'::regprocedure, 'execute') then
    raise exception 'search_keep_warm self-check: postgres cannot execute extensions.pg_prewarm';
  end if;
end $$;
-- self-check end

commit;
