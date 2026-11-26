-- F411: the file-manager schema built from main matches NTER's, and its access rules hold. Disposable fixture.
-- run.sh's chain: bootstrap_auth.sql, bootstrap_storage.sql, bootstrap_file_manager_deps.sql (stand-ins: the vector
-- extension, storage.foldername, ingest_settings, the credit tables' types), then 20261126090000_user_storage_own_user
-- and 20261126150000_file_manager_schema, both as a non-superuser. Spec: docs/specs/2026-11-26-file-manager-schema-adoption.md.
-- (a) A catalog fingerprint of the result (columns, row-level security, constraints, indexes, policies, function
-- definitions and grants, table and sequence grants, the bucket, three ingest_settings columns; owners left out) must
-- equal the 178 lines read from NTER on 2026-11-26, after F410. Any missing or extra line is printed, then the fixture
-- fails. (b) Behaviour: owners see only their own rows, anon sees and writes nothing, the bucket admits an object only
-- under its owner's folder, and F410 still holds. Without the migration the tables are missing and (a) fails first.
\set ON_ERROR_STOP on
begin;
set search_path = public, extensions;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end$$;

-- (a) The catalog, line by line, against NTER's.
create temp table fm_expected (line text not null);
insert into fm_expected select unnest(string_to_array($fmexp$bucket|user-files|user-files|false|52428800|
col|user_file_chunks|01|id|uuid|true||gen_random_uuid()
col|user_file_chunks|02|user_id|uuid|true||
col|user_file_chunks|03|file_id|uuid|true||
col|user_file_chunks|04|chunk_index|integer|true||
col|user_file_chunks|05|chunk_hash|text|true||
col|user_file_chunks|06|page_start|integer|true||
col|user_file_chunks|07|page_end|integer|true||
col|user_file_chunks|08|content|text|true||
col|user_file_chunks|09|text_hash|text|true||
col|user_file_chunks|10|embedding|vector(1536)|true||
col|user_file_chunks|11|token_count|integer|false||
col|user_file_chunks|12|created_at|timestamp with time zone|true||now()
col|user_file_jobs|01|id|bigint|true|a|
col|user_file_jobs|02|file_id|uuid|true||
col|user_file_jobs|03|user_id|uuid|true||
col|user_file_jobs|04|status|text|true||'queued'::text
col|user_file_jobs|05|step|text|true||'ocr'::text
col|user_file_jobs|06|attempt_count|integer|true||0
col|user_file_jobs|07|max_attempts|integer|true||3
col|user_file_jobs|08|claimed_by|text|false||
col|user_file_jobs|09|claimed_at|timestamp with time zone|false||
col|user_file_jobs|10|lease_expires_at|timestamp with time zone|false||
col|user_file_jobs|11|error_message|text|false||
col|user_file_jobs|12|credits_hold_paise|bigint|true||0
col|user_file_jobs|13|credits_settled_paise|bigint|true||0
col|user_file_jobs|14|created_at|timestamp with time zone|true||now()
col|user_file_jobs|15|updated_at|timestamp with time zone|true||now()
col|user_files|01|id|uuid|true||gen_random_uuid()
col|user_files|02|user_id|uuid|true||
col|user_files|03|folder_id|uuid|false||
col|user_files|04|name|text|true||
col|user_files|05|storage_path|text|true||
col|user_files|06|mime_type|text|true||
col|user_files|07|size_bytes|bigint|true||
col|user_files|08|sha256|text|false||
col|user_files|09|upload_status|text|true||'pending_upload'::text
col|user_files|10|index_status|text|true||'not_indexed'::text
col|user_files|11|index_error|text|false||
col|user_files|12|indexed_at|timestamp with time zone|false||
col|user_files|13|page_count|integer|false||
col|user_files|14|extract_hash|text|false||
col|user_files|15|artifact_meta|jsonb|false||
col|user_files|16|deleted_at|timestamp with time zone|false||
col|user_files|17|deleted_by_folder_id|uuid|false||
col|user_files|18|created_at|timestamp with time zone|true||now()
col|user_files|19|updated_at|timestamp with time zone|true||now()
col|user_folders|01|id|uuid|true||gen_random_uuid()
col|user_folders|02|user_id|uuid|true||
col|user_folders|03|parent_id|uuid|false||
col|user_folders|04|name|text|true||
col|user_folders|05|path|text|true||
col|user_folders|06|depth|integer|true||0
col|user_folders|07|system_key|text|false||
col|user_folders|08|deleted_at|timestamp with time zone|false||
col|user_folders|09|deleted_by_folder_id|uuid|false||
col|user_folders|10|created_at|timestamp with time zone|true||now()
col|user_folders|11|updated_at|timestamp with time zone|true||now()
con|user_file_chunks|user_file_chunks_check|CHECK ((page_end >= page_start))
con|user_file_chunks|user_file_chunks_chunk_hash_check|CHECK ((length(chunk_hash) = 64))
con|user_file_chunks|user_file_chunks_chunk_index_check|CHECK ((chunk_index >= 0))
con|user_file_chunks|user_file_chunks_file_owner_fk|FOREIGN KEY (file_id, user_id) REFERENCES user_files(id, user_id) ON DELETE CASCADE
con|user_file_chunks|user_file_chunks_page_start_check|CHECK ((page_start >= 1))
con|user_file_chunks|user_file_chunks_pkey|PRIMARY KEY (id)
con|user_file_chunks|user_file_chunks_text_hash_check|CHECK ((length(text_hash) = 64))
con|user_file_chunks|user_file_chunks_unique_hash|UNIQUE (file_id, chunk_hash)
con|user_file_chunks|user_file_chunks_user_id_fkey|FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
con|user_file_jobs|user_file_jobs_attempt_count_check|CHECK (((attempt_count >= 0) AND (attempt_count <= 3)))
con|user_file_jobs|user_file_jobs_file_owner_fk|FOREIGN KEY (file_id, user_id) REFERENCES user_files(id, user_id) ON DELETE CASCADE
con|user_file_jobs|user_file_jobs_pkey|PRIMARY KEY (id)
con|user_file_jobs|user_file_jobs_status_check|CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
con|user_file_jobs|user_file_jobs_step_check|CHECK ((step = ANY (ARRAY['ocr'::text, 'compose'::text, 'chunk'::text, 'embed'::text, 'commit'::text])))
con|user_file_jobs|user_file_jobs_user_id_fkey|FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
con|user_files|user_files_deleted_by_folder_id_fkey|FOREIGN KEY (deleted_by_folder_id) REFERENCES user_folders(id) ON DELETE SET NULL
con|user_files|user_files_folder_owner_fk|FOREIGN KEY (folder_id, user_id) REFERENCES user_folders(id, user_id) ON DELETE CASCADE
con|user_files|user_files_index_status_check|CHECK ((index_status = ANY (ARRAY['not_indexed'::text, 'unsupported'::text, 'indexing_queued'::text, 'indexing_extracting'::text, 'indexing_chunking'::text, 'indexed'::text, 'indexing_failed'::text])))
con|user_files|user_files_name_check|CHECK (((length(TRIM(BOTH FROM name)) > 0) AND (length(name) <= 255) AND (name !~~ '%/%'::text)))
con|user_files|user_files_owner_unique|UNIQUE (id, user_id)
con|user_files|user_files_page_count_check|CHECK (((page_count IS NULL) OR (page_count >= 0)))
con|user_files|user_files_pkey|PRIMARY KEY (id)
con|user_files|user_files_sha256_check|CHECK (((sha256 IS NULL) OR (length(sha256) = 64)))
con|user_files|user_files_size_bytes_check|CHECK (((size_bytes > 0) AND (size_bytes <= 52428800)))
con|user_files|user_files_storage_path_owner_chk|CHECK (((regexp_match(storage_path, '^([0-9a-f-]{36})/'::text))[1] = (user_id)::text))
con|user_files|user_files_upload_status_check|CHECK ((upload_status = ANY (ARRAY['pending_upload'::text, 'uploading'::text, 'uploaded'::text, 'upload_failed'::text])))
con|user_files|user_files_user_id_fkey|FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
con|user_folders|user_folders_deleted_by_folder_id_fkey|FOREIGN KEY (deleted_by_folder_id) REFERENCES user_folders(id) ON DELETE SET NULL
con|user_folders|user_folders_depth_check|CHECK (((depth >= 0) AND (depth <= 20)))
con|user_folders|user_folders_name_check|CHECK (((length(TRIM(BOTH FROM name)) > 0) AND (length(name) <= 255) AND (name !~~ '%/%'::text)))
con|user_folders|user_folders_owner_unique|UNIQUE (id, user_id)
con|user_folders|user_folders_parent_owner_fk|FOREIGN KEY (parent_id, user_id) REFERENCES user_folders(id, user_id) ON DELETE CASCADE
con|user_folders|user_folders_pkey|PRIMARY KEY (id)
con|user_folders|user_folders_system_key_check|CHECK (((system_key IS NULL) OR (system_key = 'artifacts'::text)))
con|user_folders|user_folders_user_id_fkey|FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
fnacl|match_user_files(query_embedding vector, match_threshold double precision, match_count integer, filter_file_ids uuid[])|PUBLIC,anon,authenticated,service_role
fnacl|user_file_advance(p_job_id bigint, p_worker_id text, p_step text, p_status text, p_error text, p_page_count integer, p_extract_hash text)|service_role
fnacl|user_file_claim(p_worker_id text, p_limit integer, p_lease_seconds integer)|service_role
fnacl|user_file_complete_upload(p_file_id uuid, p_sha256 text)|PUBLIC,anon,authenticated,service_role
fnacl|user_file_enqueue_indexing(p_file_id uuid)|authenticated,service_role
fnacl|user_file_job_cancel(p_job_id bigint)|authenticated,service_role
fnacl|user_file_job_retry(p_job_id bigint)|authenticated,service_role
fnacl|user_file_prepare_upload(p_name text, p_size_bytes bigint, p_mime_type text, p_folder_id uuid)|PUBLIC,anon,authenticated,service_role
fnacl|user_file_restore(p_file_id uuid)|PUBLIC,anon,authenticated,service_role
fnacl|user_file_settle_credits(p_job_id bigint, p_actual_cost_paise bigint, p_final_status text, p_ocr_pages integer, p_embed_tokens integer, p_actual_cost_usd numeric)|service_role
fnacl|user_file_verify_index_validity(p_file_id uuid)|PUBLIC,anon,authenticated,service_role
fnacl|user_files_empty_trash()|PUBLIC,anon,authenticated,service_role
fnacl|user_folder_soft_delete(p_folder_id uuid)|PUBLIC,anon,authenticated,service_role
fnacl|user_storage_quota_bytes(p_user_id uuid)|authenticated,service_role
fnacl|user_storage_used_bytes(p_user_id uuid)|authenticated,service_role
fn|match_user_files(query_embedding vector, match_threshold double precision, match_count integer, filter_file_ids uuid[])|9bdcd5eafa589442dad9e61834d7be2b
fn|user_file_advance(p_job_id bigint, p_worker_id text, p_step text, p_status text, p_error text, p_page_count integer, p_extract_hash text)|3d5a412f2f95a781ec3803e0c6e97523
fn|user_file_claim(p_worker_id text, p_limit integer, p_lease_seconds integer)|4a32275a4c2bae24c43487f3f7e3a549
fn|user_file_complete_upload(p_file_id uuid, p_sha256 text)|f22b3d0b52554fc162e71d81872881ee
fn|user_file_enqueue_indexing(p_file_id uuid)|f0d1ec95f7e1ab3785a20933cd48fa53
fn|user_file_job_cancel(p_job_id bigint)|5e443ed06c151054dcde10ce8caf60a3
fn|user_file_job_retry(p_job_id bigint)|077459c365dc124afff574476f814267
fn|user_file_prepare_upload(p_name text, p_size_bytes bigint, p_mime_type text, p_folder_id uuid)|ed9a2dc6cabc71feefe89cd231ffbab3
fn|user_file_restore(p_file_id uuid)|5700d6d28dc38b7d7f164226ec21ab40
fn|user_file_settle_credits(p_job_id bigint, p_actual_cost_paise bigint, p_final_status text, p_ocr_pages integer, p_embed_tokens integer, p_actual_cost_usd numeric)|bb84e1242662ab3f1ba3f22035abcae4
fn|user_file_verify_index_validity(p_file_id uuid)|8a93414444ac8640231b5d73fec577a4
fn|user_files_empty_trash()|b1769db7a6b581b652cc411314722651
fn|user_folder_soft_delete(p_folder_id uuid)|98c9695045901fc94cdc4727fde2a162
fn|user_storage_quota_bytes(p_user_id uuid)|1fb54dcad1168da88b42a5ed6d6f8047
fn|user_storage_used_bytes(p_user_id uuid)|b4d47b15771b7a520924c4ee0ef9c37a
idx|idx_user_file_chunks_embedding|CREATE INDEX idx_user_file_chunks_embedding ON public.user_file_chunks USING hnsw (embedding vector_cosine_ops)
idx|idx_user_file_chunks_file|CREATE INDEX idx_user_file_chunks_file ON public.user_file_chunks USING btree (file_id)
idx|idx_user_file_jobs_queue|CREATE INDEX idx_user_file_jobs_queue ON public.user_file_jobs USING btree (status, lease_expires_at) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]))
idx|idx_user_file_jobs_user_running|CREATE INDEX idx_user_file_jobs_user_running ON public.user_file_jobs USING btree (user_id, status) WHERE (status = 'running'::text)
idx|idx_user_files_trash|CREATE INDEX idx_user_files_trash ON public.user_files USING btree (user_id, deleted_at) WHERE (deleted_at IS NOT NULL)
idx|idx_user_files_unique_active_name|CREATE UNIQUE INDEX idx_user_files_unique_active_name ON public.user_files USING btree (user_id, COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) WHERE (deleted_at IS NULL)
idx|idx_user_files_user_active|CREATE INDEX idx_user_files_user_active ON public.user_files USING btree (user_id, folder_id) WHERE (deleted_at IS NULL)
idx|idx_user_folders_trash|CREATE INDEX idx_user_folders_trash ON public.user_folders USING btree (user_id, deleted_at) WHERE (deleted_at IS NOT NULL)
idx|idx_user_folders_unique_active_name|CREATE UNIQUE INDEX idx_user_folders_unique_active_name ON public.user_folders USING btree (user_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) WHERE (deleted_at IS NULL)
idx|idx_user_folders_user_active|CREATE INDEX idx_user_folders_user_active ON public.user_folders USING btree (user_id, parent_id) WHERE (deleted_at IS NULL)
idx|user_file_chunks_pkey|CREATE UNIQUE INDEX user_file_chunks_pkey ON public.user_file_chunks USING btree (id)
idx|user_file_chunks_unique_hash|CREATE UNIQUE INDEX user_file_chunks_unique_hash ON public.user_file_chunks USING btree (file_id, chunk_hash)
idx|user_file_jobs_pkey|CREATE UNIQUE INDEX user_file_jobs_pkey ON public.user_file_jobs USING btree (id)
idx|user_files_owner_unique|CREATE UNIQUE INDEX user_files_owner_unique ON public.user_files USING btree (id, user_id)
idx|user_files_pkey|CREATE UNIQUE INDEX user_files_pkey ON public.user_files USING btree (id)
idx|user_folders_owner_unique|CREATE UNIQUE INDEX user_folders_owner_unique ON public.user_folders USING btree (id, user_id)
idx|user_folders_pkey|CREATE UNIQUE INDEX user_folders_pkey ON public.user_folders USING btree (id)
ingest|corpus_max_running|integer|true|2
ingest|max_running_per_user|integer|true|1
ingest|user_file_max_running|integer|true|2
pol|public.user_file_chunks|user_file_chunks_owner_all|PERMISSIVE|ALL|authenticated|(user_id = ( SELECT auth.uid() AS uid))|(user_id = ( SELECT auth.uid() AS uid))
pol|public.user_file_chunks|user_file_chunks_postgres_all|PERMISSIVE|ALL|postgres|true|true
pol|public.user_file_chunks|user_file_chunks_service_all|PERMISSIVE|ALL|service_role|true|true
pol|public.user_file_jobs|user_file_jobs_owner_all|PERMISSIVE|ALL|authenticated|(user_id = ( SELECT auth.uid() AS uid))|(user_id = ( SELECT auth.uid() AS uid))
pol|public.user_file_jobs|user_file_jobs_postgres_all|PERMISSIVE|ALL|postgres|true|true
pol|public.user_file_jobs|user_file_jobs_service_all|PERMISSIVE|ALL|service_role|true|true
pol|public.user_files|user_files_owner_all|PERMISSIVE|ALL|authenticated|(user_id = ( SELECT auth.uid() AS uid))|(user_id = ( SELECT auth.uid() AS uid))
pol|public.user_files|user_files_postgres_all|PERMISSIVE|ALL|postgres|true|true
pol|public.user_files|user_files_service_all|PERMISSIVE|ALL|service_role|true|true
pol|public.user_folders|user_folders_owner_all|PERMISSIVE|ALL|authenticated|(user_id = ( SELECT auth.uid() AS uid))|(user_id = ( SELECT auth.uid() AS uid))
pol|public.user_folders|user_folders_postgres_all|PERMISSIVE|ALL|postgres|true|true
pol|public.user_folders|user_folders_service_all|PERMISSIVE|ALL|service_role|true|true
pol|storage.objects|user_files_storage_delete|PERMISSIVE|DELETE|authenticated|((bucket_id = 'user-files'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)))|
pol|storage.objects|user_files_storage_insert|PERMISSIVE|INSERT|authenticated||((bucket_id = 'user-files'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)))
pol|storage.objects|user_files_storage_select|PERMISSIVE|SELECT|authenticated|((bucket_id = 'user-files'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)))|
pol|storage.objects|user_files_storage_update|PERMISSIVE|UPDATE|authenticated|((bucket_id = 'user-files'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)))|((bucket_id = 'user-files'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)))
rls|user_file_chunks|true|true
rls|user_file_jobs|true|true
rls|user_files|true|true
rls|user_folders|true|true
seqacl|user_file_jobs_id_seq|anon|SELECT,UPDATE,USAGE
seqacl|user_file_jobs_id_seq|authenticated|SELECT,UPDATE,USAGE
seqacl|user_file_jobs_id_seq|service_role|SELECT,UPDATE,USAGE
tblacl|user_file_chunks|anon|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_file_chunks|authenticated|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_file_chunks|service_role|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_file_jobs|anon|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_file_jobs|authenticated|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_file_jobs|service_role|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_files|anon|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_files|authenticated|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_files|service_role|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_folders|anon|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_folders|authenticated|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
tblacl|user_folders|service_role|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE$fmexp$, E'\n'));
select pg_temp.ok((select count(*) = 178 from fm_expected), 'the expected fingerprint has NTER''s 178 lines');
create temp table fm_actual as
with tbl(n) as (values ('user_folders'),('user_files'),('user_file_chunks'),('user_file_jobs')),
fns as (select p.oid, p.proname::text proname, pg_get_function_identity_arguments(p.oid) args, p.proowner, p.proacl
        from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname ~ '^user_(file|folder|storage)' or p.proname='match_user_files')),
lines as (
 select 'col|'||c.relname||'|'||lpad(a.attnum::text,2,'0')||'|'||a.attname||'|'||format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull||'|'||a.attidentity::text||'|'||coalesce(pg_get_expr(d.adbin,d.adrelid),'') line
   from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
   where c.relnamespace='public'::regnamespace and c.relname in (select n from tbl)
 union all select 'rls|'||relname||'|'||relrowsecurity||'|'||relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname in (select n from tbl)
 union all select 'con|'||conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid) from pg_constraint where conrelid in (select ('public.'||n)::regclass from tbl)
 union all select 'idx|'||indexname||'|'||indexdef from pg_indexes where schemaname='public' and tablename in (select n from tbl)
 union all select 'pol|'||schemaname||'.'||tablename||'|'||policyname||'|'||permissive||'|'||cmd||'|'||array_to_string(roles,',')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies
   where (schemaname='public' and tablename in (select n from tbl)) or (schemaname='storage' and policyname like 'user_files%')
 union all select 'fn|'||proname||'('||args||')|'||md5(replace(pg_get_functiondef(oid), E'\r','')) from fns
 union all select 'fnacl|'||proname||'('||args||')|'||coalesce((select string_agg(g, ',' order by g) from (select case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end g
     from aclexplode(coalesce(proacl, acldefault('f',proowner))) a where a.privilege_type='EXECUTE' and a.grantee<>proowner and a.grantee<>'postgres'::regrole) s),'') from fns
 union all select 'tblacl|'||c.relname||'|'||pg_get_userbyid(a.grantee)||'|'||string_agg(a.privilege_type, ',' order by a.privilege_type)
   from pg_class c, aclexplode(c.relacl) a where c.oid in (select ('public.'||n)::regclass from tbl) and a.grantee not in (c.relowner, 'postgres'::regrole)
     and a.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER') group by c.relname, a.grantee
 union all select 'seqacl|'||c.relname||'|'||pg_get_userbyid(a.grantee)||'|'||string_agg(a.privilege_type, ',' order by a.privilege_type)
   from pg_class c, aclexplode(c.relacl) a where c.oid='public.user_file_jobs_id_seq'::regclass and a.grantee not in (c.relowner, 'postgres'::regrole) group by c.relname, a.grantee
 union all select 'bucket|'||id||'|'||name||'|'||coalesce(public::text,'')||'|'||coalesce(file_size_limit::text,'')||'|'||coalesce(allowed_mime_types::text,'') from storage.buckets where id='user-files'
 union all select 'ingest|'||a.attname||'|'||format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull||'|'||coalesce(pg_get_expr(d.adbin,d.adrelid),'')
   from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.ingest_settings'::regclass and a.attname in ('corpus_max_running','user_file_max_running','max_running_per_user'))
select line from lines order by line;
do $$ declare r record; n int := 0; begin
  for r in select 'missing: ' || line as l from (select line from fm_expected except select line from fm_actual) m
           union all select 'extra:   ' || line from (select line from fm_actual except select line from fm_expected) x order by 1 loop
    raise notice 'DIFF %', r.l; n := n + 1;
  end loop;
  if n > 0 then raise exception 'FAIL the file-manager catalog differs from NTER''s in % line(s), listed above', n; end if;
  raise notice 'PASS the file-manager catalog matches NTER''s, all 178 lines';
end $$;

-- (b) Behaviour. A and B are signed-in users.
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a"}', true);
set local role authenticated;
insert into public.user_folders (user_id, name, path) values ('00000000-0000-0000-0000-00000000000a', 'Docs', '/Docs');
insert into public.user_files (user_id, name, storage_path, mime_type, size_bytes)
  values ('00000000-0000-0000-0000-00000000000a', 'a.pdf', '00000000-0000-0000-0000-00000000000a/a.pdf', 'application/pdf', 100);
insert into storage.objects (bucket_id, name) values ('user-files', '00000000-0000-0000-0000-00000000000a/a.pdf');
do $$ begin
  insert into public.user_files (user_id, name, storage_path, mime_type, size_bytes)
    values ('00000000-0000-0000-0000-00000000000b', 'b.pdf', '00000000-0000-0000-0000-00000000000b/b.pdf', 'application/pdf', 100);
  raise exception 'FAIL A wrote a file row for B';
exception when insufficient_privilege then raise notice 'PASS A cannot write a file row for B';
end $$;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('user-files', '00000000-0000-0000-0000-00000000000b/x.pdf');
  raise exception 'FAIL A put an object in B''s folder';
exception when insufficient_privilege then raise notice 'PASS A cannot put an object in B''s folder of user-files';
end $$;
select pg_temp.ok((select count(*) = 1 from public.user_files) and (select count(*) = 1 from public.user_folders),
  'A sees its own file and folder');
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000b"}', true);
set local role authenticated;
select pg_temp.ok((select count(*) = 0 from public.user_files) and (select count(*) = 0 from public.user_folders)
  and (select count(*) = 0 from storage.objects where bucket_id = 'user-files'), 'B sees none of A''s files, folders or objects');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.ok((select count(*) = 0 from public.user_files) and (select count(*) = 0 from public.user_file_jobs),
  'anon sees no file or job rows (no policy admits anon)');
do $$ begin
  insert into public.user_folders (user_id, name, path) values ('00000000-0000-0000-0000-00000000000a', 'X', '/X');
  raise exception 'FAIL anon wrote a folder row';
exception when insufficient_privilege then raise notice 'PASS anon cannot write a folder row';
end $$;
do $$ begin perform public.user_storage_used_bytes('00000000-0000-0000-0000-00000000000a');
  raise exception 'FAIL anon read a user''s storage usage';
exception when insufficient_privilege then raise notice 'PASS anon is refused user_storage_used_bytes (F410)'; end $$;
reset role;

-- The worker's functions are the service role's alone.
select pg_temp.ok(not has_function_privilege('authenticated', 'public.user_file_claim(text,integer,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.user_file_settle_credits(bigint,bigint,text,integer,integer,numeric)', 'execute')
  and has_function_privilege('service_role', 'public.user_file_claim(text,integer,integer)', 'execute'),
  'user_file_claim and user_file_settle_credits are the service role''s only');
rollback;
