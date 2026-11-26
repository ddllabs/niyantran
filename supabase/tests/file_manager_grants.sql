-- F412: the file-manager grants narrowed to the roles that use them. Disposable fixture.
-- run.sh's chain: file_manager_schema's (bootstrap_auth.sql, bootstrap_storage.sql, bootstrap_file_manager_deps.sql,
-- 20261126090000_user_storage_own_user and 20261126150000_file_manager_schema), then 20261126180000_file_manager_grants,
-- all migrations as a non-superuser. Spec: docs/specs/2026-11-26-file-manager-grants.md.
-- (a) The grants on the four tables, the job sequence and the fifteen file-manager functions must equal the 25 lines
-- below: F411's capture of NTER without anon, and without PUBLIC and anon on the seven SECURITY INVOKER functions. Any
-- missing or extra line is printed, then the fixture fails. (b) Behaviour: anon is refused the tables and
-- match_user_files with 42501 (before F412 it was admitted and saw no rows); a signed-in user still reads and writes
-- its own rows and runs its functions. Without the migration anon still holds its grants, and (a) fails first.
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end$$;

-- (a) The grants, line by line.
create temp table fg_expected (line text not null);
insert into fg_expected select unnest(string_to_array($fgexp$fnacl|match_user_files(query_embedding vector, match_threshold double precision, match_count integer, filter_file_ids uuid[])|authenticated,service_role
fnacl|user_file_advance(p_job_id bigint, p_worker_id text, p_step text, p_status text, p_error text, p_page_count integer, p_extract_hash text)|service_role
fnacl|user_file_claim(p_worker_id text, p_limit integer, p_lease_seconds integer)|service_role
fnacl|user_file_complete_upload(p_file_id uuid, p_sha256 text)|authenticated,service_role
fnacl|user_file_enqueue_indexing(p_file_id uuid)|authenticated,service_role
fnacl|user_file_job_cancel(p_job_id bigint)|authenticated,service_role
fnacl|user_file_job_retry(p_job_id bigint)|authenticated,service_role
fnacl|user_file_prepare_upload(p_name text, p_size_bytes bigint, p_mime_type text, p_folder_id uuid)|authenticated,service_role
fnacl|user_file_restore(p_file_id uuid)|authenticated,service_role
fnacl|user_file_settle_credits(p_job_id bigint, p_actual_cost_paise bigint, p_final_status text, p_ocr_pages integer, p_embed_tokens integer, p_actual_cost_usd numeric)|service_role
fnacl|user_file_verify_index_validity(p_file_id uuid)|authenticated,service_role
fnacl|user_files_empty_trash()|authenticated,service_role
fnacl|user_folder_soft_delete(p_folder_id uuid)|authenticated,service_role
fnacl|user_storage_quota_bytes(p_user_id uuid)|authenticated,service_role
fnacl|user_storage_used_bytes(p_user_id uuid)|authenticated,service_role
seqacl|user_file_jobs_id_seq|authenticated|SELECT,UPDATE,USAGE
seqacl|user_file_jobs_id_seq|service_role|SELECT,UPDATE,USAGE
tblacl|user_file_chunks|authenticated|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_file_chunks|service_role|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_file_jobs|authenticated|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_file_jobs|service_role|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_files|authenticated|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_files|service_role|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_folders|authenticated|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_folders|service_role|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE$fgexp$, E'\n'));
select pg_temp.ok((select count(*) = 25 from fg_expected), 'the expected grants have 25 lines');

-- The same queries as file_manager_schema.sql's fnacl, tblacl and seqacl lines.
set local search_path = public, extensions;
create temp table fg_actual as
with tbl(n) as (values ('user_folders'), ('user_files'), ('user_file_chunks'), ('user_file_jobs')),
fns as (select p.oid, p.proname, p.proacl, p.proowner, pg_get_function_identity_arguments(p.oid) args
        from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname ~ '^user_(file|folder|storage)' or p.proname='match_user_files')),
lines as (
 select 'fnacl|'||proname||'('||args||')|'||coalesce((select string_agg(g, ',' order by g) from (select case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end g
     from aclexplode(coalesce(proacl, acldefault('f',proowner))) a where a.privilege_type='EXECUTE' and a.grantee<>proowner and a.grantee<>'postgres'::regrole) s),'') line from fns
 union all select 'tblacl|'||c.relname||'|'||pg_get_userbyid(a.grantee)||'|'||string_agg(a.privilege_type, ',' order by a.privilege_type)
   from pg_class c, aclexplode(c.relacl) a where c.oid in (select ('public.'||n)::regclass from tbl) and a.grantee not in (c.relowner, 'postgres'::regrole)
     and a.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER') group by c.relname, a.grantee
 union all select 'seqacl|'||c.relname||'|'||pg_get_userbyid(a.grantee)||'|'||string_agg(a.privilege_type, ',' order by a.privilege_type)
   from pg_class c, aclexplode(c.relacl) a where c.oid='public.user_file_jobs_id_seq'::regclass and a.grantee not in (c.relowner, 'postgres'::regrole) group by c.relname, a.grantee)
select line from lines order by line;
do $$ declare r record; n int := 0; begin
  for r in select 'missing: ' || line as l from (select line from fg_expected except select line from fg_actual) m
           union all select 'extra:   ' || line from (select line from fg_actual except select line from fg_expected) x order by 1 loop
    raise notice 'DIFF %', r.l; n := n + 1;
  end loop;
  if n > 0 then raise exception 'FAIL the file-manager grants differ from F412''s in % line(s), listed above', n; end if;
  raise notice 'PASS the file-manager grants are F412''s, all 25 lines';
end $$;
-- MAINTAIN (PostgreSQL 17) is outside the lines above; anon must not hold it either.
select pg_temp.ok(not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
  where c.oid in ('public.user_folders'::regclass, 'public.user_files'::regclass, 'public.user_file_chunks'::regclass,
                  'public.user_file_jobs'::regclass, 'public.user_file_jobs_id_seq'::regclass) and a.grantee = 'anon'::regrole),
  'anon holds no privilege of any kind on the four tables or the job sequence');

-- (b) Behaviour. A is a signed-in user.
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a');

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a"}', true);
set local role authenticated;
insert into public.user_folders (user_id, name, path) values ('00000000-0000-0000-0000-00000000000a', 'Docs', '/Docs');
insert into public.user_files (user_id, name, storage_path, mime_type, size_bytes)
  values ('00000000-0000-0000-0000-00000000000a', 'a.pdf', '00000000-0000-0000-0000-00000000000a/a.pdf', 'application/pdf', 100);
select pg_temp.ok((select count(*) = 1 from public.user_files) and (select count(*) = 1 from public.user_folders)
  and (select count(*) = 0 from public.user_file_jobs) and (select count(*) = 0 from public.user_file_chunks),
  'A still reads and writes its own file and folder rows, and reads jobs and chunks');
select pg_temp.ok((select (public.user_files_empty_trash() ->> 'ok')::boolean), 'A still runs user_files_empty_trash');
select pg_temp.ok((select count(*) = 0 from public.match_user_files(array_fill(0, array[1536])::extensions.vector)),
  'A still runs match_user_files');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$ begin perform count(*) from public.user_files;
  raise exception 'FAIL anon read user_files';
exception when insufficient_privilege then raise notice 'PASS anon is refused user_files (was: admitted, no rows)'; end $$;
do $$ begin perform count(*) from public.user_file_jobs;
  raise exception 'FAIL anon read user_file_jobs';
exception when insufficient_privilege then raise notice 'PASS anon is refused user_file_jobs'; end $$;
do $$ begin perform nextval('public.user_file_jobs_id_seq');
  raise exception 'FAIL anon advanced the job sequence';
exception when insufficient_privilege then raise notice 'PASS anon is refused the job sequence'; end $$;
do $$ begin perform public.match_user_files(array_fill(0, array[1536])::extensions.vector);
  raise exception 'FAIL anon ran match_user_files';
exception when insufficient_privilege then raise notice 'PASS anon is refused match_user_files (was: admitted, no rows)'; end $$;
reset role;

-- The worker keeps the service role's access.
select pg_temp.ok(has_table_privilege('service_role', 'public.user_file_jobs', 'select,insert,update,delete')
  and has_function_privilege('service_role', 'public.user_file_claim(text,integer,integer)', 'execute')
  and has_function_privilege('service_role', 'public.match_user_files(extensions.vector,double precision,integer,uuid[])', 'execute'),
  'service_role keeps the jobs table, user_file_claim and match_user_files');
rollback;
