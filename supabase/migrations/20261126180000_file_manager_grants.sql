-- File-manager grants narrowed to the roles that use them (F412). Spec: docs/specs/2026-11-26-file-manager-grants.md.
--
-- 20261126150000_file_manager_schema (F411) adopted NTER's file-manager schema as it ran, grants included. Read on
-- NTER 2026-11-26: anon holds every table privilege on user_folders, user_files, user_file_chunks and user_file_jobs and
-- every privilege on user_file_jobs_id_seq; seven SECURITY INVOKER functions (match_user_files,
-- user_file_complete_upload, user_file_prepare_upload, user_file_restore, user_file_verify_index_validity,
-- user_files_empty_trash, user_folder_soft_delete) are executable by PUBLIC and anon. No policy admits anon, so anon
-- reads and writes no rows today; every caller of these objects (the file manager, the source reader, private-file
-- retrieval, the mobile app) acts for a signed-in user, and the worker uses the service role.
--
-- WHAT THIS CHANGES:
--   * anon loses every privilege on the four tables and the sequence.
--   * PUBLIC and anon lose execute on the seven functions; authenticated and service_role keep it.
--   * Nothing else: authenticated and service_role keep the table and sequence privileges they have, the eight other
--     file-manager functions' grants are untouched, and no row, policy or function body changes.
--   * A self-check at the end raises (and so undoes everything) if anon keeps any privilege on these objects, if PUBLIC
--     can execute any file-manager function, or if authenticated or service_role lost one they need.
-- A signed-out request to these tables or functions now gets "permission denied" (42501) instead of no rows.
--
-- APPLY on NTER: by psql as postgres, with the history row inserted by hand under 20261126180000 (rollback-runbook.md;
-- never `supabase db push`, F283). Then:
--   select has_table_privilege('anon','public.user_files','select'),
--          has_function_privilege('anon','public.user_files_empty_trash()','execute');   -- false, false
--
-- DOWN (restores the wider grants; only to undo a fault this change caused):
--   grant select, insert, update, delete, truncate, references, trigger on table public.user_folders, public.user_files,
--     public.user_file_chunks, public.user_file_jobs to anon;
--   grant usage, select, update on sequence public.user_file_jobs_id_seq to anon;
--   grant execute on function public.match_user_files(extensions.vector, double precision, integer, uuid[]),
--     public.user_file_complete_upload(uuid, text), public.user_file_prepare_upload(text, bigint, text, uuid),
--     public.user_file_restore(uuid), public.user_file_verify_index_validity(uuid), public.user_files_empty_trash(),
--     public.user_folder_soft_delete(uuid) to public, anon;
-- (NTER on PostgreSQL 17 also had MAINTAIN for anon on the four tables: add `grant maintain on table ... to anon`.)

begin;

revoke all on table public.user_folders, public.user_files, public.user_file_chunks, public.user_file_jobs from anon;
revoke all on sequence public.user_file_jobs_id_seq from anon;

revoke execute on function public.match_user_files(extensions.vector, double precision, integer, uuid[]),
  public.user_file_complete_upload(uuid, text), public.user_file_prepare_upload(text, bigint, text, uuid),
  public.user_file_restore(uuid), public.user_file_verify_index_validity(uuid), public.user_files_empty_trash(),
  public.user_folder_soft_delete(uuid) from public, anon;
grant execute on function public.match_user_files(extensions.vector, double precision, integer, uuid[]),
  public.user_file_complete_upload(uuid, text), public.user_file_prepare_upload(text, bigint, text, uuid),
  public.user_file_restore(uuid), public.user_file_verify_index_validity(uuid), public.user_files_empty_trash(),
  public.user_folder_soft_delete(uuid) to authenticated, service_role;

do $check$
declare
  v_bad text;
begin
  -- anon: no privilege of any kind on the tables or the sequence.
  select string_agg(c.relname || ':' || a.privilege_type, ', ') into v_bad
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.oid in ('public.user_folders'::regclass, 'public.user_files'::regclass, 'public.user_file_chunks'::regclass,
                   'public.user_file_jobs'::regclass, 'public.user_file_jobs_id_seq'::regclass)
     and a.grantee = 'anon'::regrole;
  if v_bad is not null then raise exception 'F412 self-check: anon still holds %', v_bad; end if;

  -- No file-manager function is executable by anon or listed for PUBLIC.
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname ~ '^user_(file|folder|storage)' or p.proname = 'match_user_files')
     and (has_function_privilege('anon', p.oid, 'execute')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0));
  if v_bad is not null then raise exception 'F412 self-check: anon or PUBLIC can still execute %', v_bad; end if;

  -- The roles that use them keep what they need.
  if not (has_table_privilege('authenticated', 'public.user_files', 'select,insert,update,delete')
          and has_table_privilege('authenticated', 'public.user_folders', 'select,insert,update,delete')
          and has_table_privilege('authenticated', 'public.user_file_chunks', 'select')
          and has_table_privilege('authenticated', 'public.user_file_jobs', 'select')
          and has_table_privilege('service_role', 'public.user_file_jobs', 'select,insert,update,delete')
          and has_sequence_privilege('service_role', 'public.user_file_jobs_id_seq', 'usage')) then
    raise exception 'F412 self-check: authenticated or service_role lost a table or sequence privilege';
  end if;
  select string_agg(f, ', ') into v_bad
    from unnest(array['public.match_user_files(extensions.vector,double precision,integer,uuid[])',
                      'public.user_file_complete_upload(uuid,text)', 'public.user_file_prepare_upload(text,bigint,text,uuid)',
                      'public.user_file_restore(uuid)', 'public.user_file_verify_index_validity(uuid)',
                      'public.user_files_empty_trash()', 'public.user_folder_soft_delete(uuid)']) f
   where not (has_function_privilege('authenticated', f, 'execute') and has_function_privilege('service_role', f, 'execute'));
  if v_bad is not null then raise exception 'F412 self-check: authenticated or service_role cannot execute %', v_bad; end if;
end
$check$;

commit;
