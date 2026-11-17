-- Disposable local fixture (F285): public.create_document_chunks_partition(text), the one reviewed way to give a feature
-- a partition of document_chunks of its own.
-- Chain: document_chunks_partitions' chain (the partitioned table with its four partitions), then
-- 20261114090000_create_document_chunks_partition as a non-superuser.
--
-- Proves: only the owner of document_chunks can run it; the new partition has exactly the grants, row-level security, policies (none), HNSW index and facet trigger
-- the existing partitions have; anon and authenticated cannot read it directly; the function is idempotent, refuses a
-- blank feature and a feature whose rows already sit in the default partition (changing nothing), and is executable by
-- none of public, anon, authenticated or service_role; a chunk of the feature is routed to the new partition.
--
-- Vacuity: run.sh rebuilds the chain without the migration and this file must fail (the function does not exist).
\set ON_ERROR_STOP on
begin;
set local search_path = public, extensions;

create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$
begin
  if v is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
-- q must fail with SQLSTATE state (and, when given, a message containing pattern).
create function pg_temp.fails(q text, state text, label text, pattern text default null) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlstate <> state or (pattern is not null and position(pattern in sqlerrm) = 0) then
      raise exception 'FAIL: % (expected SQLSTATE %, got %: %)', label, state, sqlstate, sqlerrm;
    end if;
    raise notice 'PASS: %', label;
    return;
  end;
  raise exception 'FAIL: % (accepted: %)', label, q;
end $$;
create function pg_temp.privs(r text, t text) returns text language sql as $$
  select coalesce(string_agg(p, ',' order by o), '')
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) with ordinality x(p, o)
   where has_table_privilege(r, 'public.' || t, p)
$$;
-- A table's grants other than the owner's, as role:privilege.
create function pg_temp.acl(t regclass) returns text[] language sql as $$
  select coalesce(array_agg(format('%s:%s', coalesce(r.rolname, 'PUBLIC'), a.privilege_type)
                            order by format('%s:%s', coalesce(r.rolname, 'PUBLIC'), a.privilege_type)), '{}')
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
         left join pg_roles r on r.oid = a.grantee
   where c.oid = t and a.grantee <> c.relowner
$$;

-- The function exists and nobody but its owner can run it.
select pg_temp.ok(to_regprocedure('public.create_document_chunks_partition(text)') is not null, 'the function exists');
select pg_temp.ok(not has_function_privilege('anon', 'public.create_document_chunks_partition(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.create_document_chunks_partition(text)', 'execute')
  and not has_function_privilege('service_role', 'public.create_document_chunks_partition(text)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                   where p.oid = 'public.create_document_chunks_partition(text)'::regprocedure and a.grantee = 0),
  'execute is held by none of public, anon, authenticated, service_role');
set local role anon;
select pg_temp.fails($q$select public.create_document_chunks_partition('Fixture Feature X')$q$, '42501', 'anon cannot run it');
reset role;
set local role authenticated;
select pg_temp.fails($q$select public.create_document_chunks_partition('Fixture Feature X')$q$, '42501', 'authenticated cannot run it');
reset role;
set local role service_role;
select pg_temp.fails($q$select public.create_document_chunks_partition('Fixture Feature X')$q$, '42501', 'service_role cannot run it');
reset role;

-- Only the owner of document_chunks (nter_migrator here, which also carries the Supabase-style default privileges that
-- grant every new table to anon, authenticated and service_role) may run it. The fixture's session user, postgres, is a
-- superuser and not the owner, so it is refused. The default privileges of postgres are the same, so the table revoke is
-- proved below under the owner's own defaults.
select pg_temp.fails($q$select public.create_document_chunks_partition('Fixture Feature X')$q$, 'P0001',
  'a caller that does not own document_chunks is refused', 'not_parent_owner');
select pg_temp.ok((select pg_get_userbyid(relowner) from pg_class where oid = 'public.document_chunks'::regclass) = 'nter_migrator'
  and exists (select 1 from pg_default_acl where defaclrole = 'nter_migrator'::regrole and defaclnamespace = 'public'::regnamespace
              and defaclobjtype = 'r' and defaclacl::text like '%anon=%' and defaclacl::text like '%authenticated=%' and defaclacl::text like '%service_role=%'),
  'the parent is owned by nter_migrator, whose default privileges grant new tables to anon, authenticated and service_role');
set local role nter_migrator;

-- A blank feature is refused.
select pg_temp.fails($q$select public.create_document_chunks_partition('  ')$q$, 'P0001', 'a blank feature is refused', 'must not be blank');
select pg_temp.fails($q$select public.create_document_chunks_partition(null)$q$, 'P0001', 'a null feature is refused', 'must not be blank');

-- Creation.
create temp table made as select public.create_document_chunks_partition('Fixture Feature A (Test)') as name;
reset role;
select pg_temp.ok((select name from made) like 'document_chunks\_p\_fixture\_feature\_a\_test\_%', 'it returns the new partition''s name');
select pg_temp.ok((select pg_get_expr(c.relpartbound, c.oid) from pg_class c where c.oid = to_regclass('public.' || (select name from made)))
  = 'FOR VALUES IN (''Fixture Feature A (Test)'')', 'the partition lists the feature');
select pg_temp.ok((select i.inhparent from pg_inherits i where i.inhrelid = to_regclass('public.' || (select name from made))) = 'public.document_chunks'::regclass,
  'it is a partition of document_chunks');

-- The same grants, row-level security and policies as an existing partition.
select pg_temp.ok((select c.relrowsecurity and r.relrowsecurity and c.relforcerowsecurity = r.relforcerowsecurity from pg_class c, pg_class r
                    where c.oid = to_regclass('public.' || (select name from made)) and r.oid = 'public.document_chunks_regulatory'::regclass),
  'row-level security is enabled, as on the existing partitions');
select pg_temp.ok(pg_temp.acl(to_regclass('public.' || (select name from made))) = pg_temp.acl('public.document_chunks_regulatory'::regclass),
  'the table grants equal the existing partitions'' (' || coalesce(array_to_string(pg_temp.acl('public.document_chunks_regulatory'::regclass), ','), 'none') || ')');
select pg_temp.ok((select bool_and(pg_temp.privs(r, (select name from made)) = '' and pg_temp.privs(r, 'document_chunks_regulatory') = '')
                     from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon, authenticated and service_role hold no table privilege on it, as on the existing partitions');
select pg_temp.ok(not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r
                               where has_any_column_privilege(r, 'public.' || (select name from made), 'SELECT,INSERT,UPDATE,REFERENCES')),
  'no column privilege either');
select pg_temp.ok(not exists (select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = to_regclass('public.' || (select name from made)) and a.grantee = 0),
  'nothing granted to PUBLIC');
select pg_temp.ok(not exists (select 1 from pg_policy where polrelid = to_regclass('public.' || (select name from made))),
  'no policy on it, as on the existing partitions (the parent carries them)');

-- The same local indexes (a child of each of the parent's) and the facet trigger.
create temp table idx as
  select t.relname::text as tab, regexp_replace(pg_get_indexdef(c.oid), '^.* USING ', 'USING ') as def, c.reloptions, i.indisvalid,
         (select p.relname::text from pg_inherits h join pg_class p on p.oid = h.inhparent where h.inhrelid = c.oid) as parent
    from pg_index i join pg_class c on c.oid = i.indexrelid join pg_class t on t.oid = i.indrelid
   where t.relnamespace = 'public'::regnamespace;
select pg_temp.ok((select count(*) from idx where tab = (select name from made) and parent is not null and indisvalid)
  = (select count(*) from idx where tab = 'document_chunks_regulatory' and parent is not null and indisvalid)
  and (select count(*) from idx where tab = (select name from made)) = 7,
  'it has the same seven local indexes as an existing partition, each attached to the parent''s');
select pg_temp.ok((select array_agg(def order by def) from idx where tab = (select name from made))
  = (select array_agg(def order by def) from idx where tab = 'document_chunks_regulatory'),
  'the index definitions equal an existing partition''s, the HNSW one included');
select pg_temp.ok((select reloptions from idx where tab = (select name from made) and def like 'USING hnsw%')
  is not distinct from (select reloptions from idx where tab = 'document_chunks_regulatory' and def like 'USING hnsw%'),
  'the HNSW index has the same storage parameters');
select pg_temp.ok((select count(*) from pg_trigger t where t.tgrelid = to_regclass('public.' || (select name from made)) and not t.tgisinternal
                      and pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE%document_chunks_fill_facets%') = 1,
  'the facet trigger is on it');

-- Anon and authenticated cannot read it directly.
select set_config('fx.name', (select name from made), true);
set local role anon;
select pg_temp.fails(format('select count(*) from public.%I', current_setting('fx.name')), '42501', 'anon cannot read the partition directly');
reset role;
set local role authenticated;
select pg_temp.fails(format('select count(*) from public.%I', current_setting('fx.name')), '42501', 'authenticated cannot read the partition directly');
reset role;
set local role service_role;
select pg_temp.fails(format('select count(*) from public.%I', current_setting('fx.name')), '42501', 'service_role cannot read the partition directly either');
reset role;

-- Idempotent: the same call changes nothing and returns the same name.
set local role nter_migrator;
create temp table before_again as select count(*) as parts from pg_inherits where inhparent = 'public.document_chunks'::regclass;
select pg_temp.ok(public.create_document_chunks_partition('Fixture Feature A (Test)') = (select name from made), 'a second call returns the same partition');
select pg_temp.ok((select count(*) from pg_inherits where inhparent = 'public.document_chunks'::regclass) = (select parts from before_again),
  'and creates nothing');
select pg_temp.ok(public.create_document_chunks_partition('NCLT / NCLAT (Insolvency)') = 'document_chunks_nclt',
  'a feature that already has a hand-made partition returns that one''s name');

reset role;

-- A hand-made partition of the feature (no revoke, no row-level security) is refused, not returned, until it is protected.
set local role nter_migrator;
create table public.fx_handmade partition of public.document_chunks for values in ('Fixture Feature H');
select pg_temp.fails($q$select public.create_document_chunks_partition('Fixture Feature H')$q$, 'P0001',
  'a hand-made partition without row-level security or the revoke is refused', 'existing_partition_unprotected');
alter table public.fx_handmade enable row level security;
select pg_temp.fails($q$select public.create_document_chunks_partition('Fixture Feature H')$q$, 'P0001',
  'with row-level security but still granted to anon, authenticated and service_role it is refused', 'existing_partition_unprotected');
revoke all on table public.fx_handmade from public, anon, authenticated, service_role;
select pg_temp.ok(public.create_document_chunks_partition('Fixture Feature H') = 'fx_handmade', 'once protected it is returned');
reset role;

-- A chunk of the feature is routed to the new partition.
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at, metadata) values
  ('f1000000-0000-4000-8000-000000000001', 'fx-a', 'A', 'national', 'Fixture Feature A (Test)', 'x', 'aaaa', 4, now(), '{}');
insert into document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, chunker_version, desk_feature)
  values ('f1000000-0000-4000-8000-000000000001', 'ha', 0, 0, 4, 'aaaa', 4, 'Fixture Feature A (Test)');
select pg_temp.ok((select tableoid::regclass::text from document_chunks where chunk_hash = 'ha') = 'public.' || (select name from made)
                  or (select tableoid::regclass::text from document_chunks where chunk_hash = 'ha') = (select name from made),
  'a chunk of the feature lands in the new partition');

-- Refused while the default partition holds rows of the feature; nothing is created.
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at, metadata) values
  ('f1000000-0000-4000-8000-000000000002', 'fx-b', 'B', 'national', 'Fixture Feature B (Test)', 'y', 'bbbb', 4, now(), '{}');
insert into document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, chunker_version, desk_feature)
  values ('f1000000-0000-4000-8000-000000000002', 'hb', 0, 0, 4, 'bbbb', 4, 'Fixture Feature B (Test)');
select pg_temp.ok((select count(*) from document_chunks_default where desk_feature = 'Fixture Feature B (Test)') = 1, 'the chunk of feature B sits in the default partition');
create temp table before_refusal as select count(*) as parts from pg_inherits where inhparent = 'public.document_chunks'::regclass;
set local role nter_migrator;
select pg_temp.fails($q$select public.create_document_chunks_partition('Fixture Feature B (Test)')$q$, 'P0001',
  'a feature already in the default partition is refused', 'default_partition_holds_feature');
reset role;
select pg_temp.ok((select count(*) from pg_inherits where inhparent = 'public.document_chunks'::regclass) = (select parts from before_refusal)
  and (select count(*) from document_chunks_default where desk_feature = 'Fixture Feature B (Test)') = 1,
  'the refusal created nothing and moved nothing');

rollback;
