-- F285: a partition of document_chunks for a feature, made by one function instead of by hand.
--
-- Why. A feature with no partition of its own lands in the default partition. Past about 100,000 chunks there it can
-- raise FEATURE_SEARCH_RECOVERY_LIMIT, and moving it later needs its ingestion stopped and its vector index rebuilt
-- (the move procedure is in the header of 20261101120000_document_chunks_partitioned.sql, "Adding a partition later").
-- The bulk runner refuses a load that would take a feature without a partition past that line and names this function.
-- A partition read directly bypasses the parent's policies, so one made by hand without the revoke and row-level
-- security lines of 20261101120000_document_chunks_partitioned.sql would be readable by anon.
--
-- What public.create_document_chunks_partition(p_feature text) does, in one transaction:
--   * refuses (not_parent_owner) unless current_user owns public.document_chunks;
--   * refuses a null or blank feature;
--   * when a partition already lists the feature, returns its name and changes nothing, but first checks it: row-level
--     security enabled, and no grant to public, anon, authenticated or service_role; otherwise it refuses
--     (existing_partition_unprotected) rather than vouch for it;
--   * refuses (default_partition_holds_feature) when the default partition already holds rows of the feature: moving
--     rows is out of scope here and needs that feature's ingestion stopped; nothing is changed;
--   * otherwise creates the partition, enables row level security on it, revokes every privilege from public, anon,
--     authenticated and service_role (the parent carries the grants and the policies; a partition carries neither).
-- The partition's indexes (the HNSW one included) and the facet trigger are cloned from the parent by PARTITION OF; the
-- fixture proves it. It drops and moves nothing.
--
-- Not called from any request path. Execute is revoked from public, anon, authenticated and service_role: only the
-- owner of document_chunks runs it, by hand, before the load. It is SECURITY INVOKER.
-- Creating a partition while a default partition exists locks the default partition (it is scanned for the feature), so
-- the function waits at most 2 s for a lock (the app's search limit is 4 s) and runs at most 30 s. On a timeout the whole
-- call rolls back with nothing changed, and the owner retries.
--
-- Rollback. While the new partition is empty: `drop table public.<name>;` (the name the function returned) and, to
-- remove the function, `drop function public.create_document_chunks_partition(text);`. Once the partition holds rows it
-- is effectively one-way: dropping it deletes those chunks, and moving them back to the default partition means copying
-- them out, dropping the partition and re-inserting them with the feature's ingestion stopped, then rebuilding the
-- default partition's vector index.

create or replace function public.create_document_chunks_partition(p_feature text)
returns text
language plpgsql
set search_path = pg_catalog, public, extensions
as $$
declare
  v_bound text;
  v_existing text;
  v_name text;
begin
  if current_user::name is distinct from
     (select pg_get_userbyid(relowner) from pg_class where oid = 'public.document_chunks'::regclass)::name then
    raise exception 'create_document_chunks_partition: not_parent_owner: run it as the owner of public.document_chunks';
  end if;
  if p_feature is null or btrim(p_feature) = '' then
    raise exception 'create_document_chunks_partition: the feature must not be blank';
  end if;
  perform set_config('lock_timeout', '2s', true);
  perform set_config('statement_timeout', '30s', true);
  v_bound := format('FOR VALUES IN (%L)', p_feature);

  -- The bound pg_get_expr prints may carry a ::text cast on the literal; compare without it.
  select c.relname into v_existing
    from pg_inherits i join pg_class c on c.oid = i.inhrelid
   where i.inhparent = 'public.document_chunks'::regclass
     and replace(pg_get_expr(c.relpartbound, c.oid), '''::text', '''') = v_bound
   limit 1;
  if v_existing is not null then
    if not (select relrowsecurity from pg_class where oid = format('public.%I', v_existing)::regclass)
       or exists (select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                   where c.oid = format('public.%I', v_existing)::regclass
                     and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))))
    then
      raise exception 'create_document_chunks_partition: existing_partition_unprotected: % lacks row-level security or grants to public, anon, authenticated or service_role', v_existing;
    end if;
    return v_existing;
  end if;

  if exists (select 1 from public.document_chunks_default where desk_feature = p_feature) then
    raise exception 'create_document_chunks_partition: default_partition_holds_feature: %', p_feature
      using detail = 'The default partition already holds chunks of this feature. Moving them needs the feature''s '
                     'ingestion stopped and is not done by this function.';
  end if;

  v_name := 'document_chunks_p_'
    || left(regexp_replace(lower(p_feature), '[^a-z0-9]+', '_', 'g'), 30)
    || '_' || left(md5(p_feature), 8);

  execute format('create table public.%I partition of public.document_chunks for values in (%L)', v_name, p_feature);
  execute format('alter table public.%I enable row level security', v_name);
  execute format('revoke all on table public.%I from public, anon, authenticated, service_role', v_name);
  return v_name;
end
$$;

revoke all on function public.create_document_chunks_partition(text) from public, anon, authenticated, service_role;
