-- The private file-manager schema, adopted into main from NTER as it was live on 2026-11-26 (F411).
-- Spec: docs/specs/2026-11-26-file-manager-schema-adoption.md.
--
-- WHY: the schema (four tables, the user-files bucket and its policies, 15 functions, three ingest_settings columns)
-- was applied to NTER from the file-manager branch's supabase_dashboard_storage_setup.sql, pasted into the dashboard,
-- and later changed there. It was in no migration on main and had no history row, so a database built from main
-- lacked it and nothing on main described what production runs. No file on that branch reproduces NTER: five
-- functions (user_file_claim, user_file_enqueue_indexing, user_file_job_cancel, user_file_job_retry,
-- user_file_settle_credits) exist only on NTER, and the grants differ.
--
-- WHAT THIS IS: NTER's catalog, reproduced, not redesigned. Tables, constraints (by their live names), indexes,
-- row-level security (enabled and forced), policies, the bucket, function definitions and every grant match NTER as
-- read on 2026-11-26, after F410 (20261126090000) was applied. The fixture file_manager_schema.sql compares a catalog
-- fingerprint of a database built from this file with the one read from NTER, line by line. Function bodies keep
-- NTER's text except that NTER's carriage returns (the bodies were pasted from Windows) are not reproduced.
--
-- KNOWN AND KEPT AS LIVE (each is a follow-up, not changed here, so this file stays a faithful record):
--   * anon holds every table privilege on the four tables (row-level security has no anon policy, so anon reads and
--     writes no rows); the API roles hold USAGE, SELECT and UPDATE on user_file_jobs_id_seq.
--   * eight functions are executable by PUBLIC and anon; they are SECURITY INVOKER and rely on row-level security.
--   * four functions hold or settle credits (billing scope); they are adopted as they run on NTER, not reviewed.
--
-- ORDER: after 20261126090000_user_storage_own_user, which is a no-op on a database without these functions; this file
-- then creates user_storage_used_bytes and user_storage_quota_bytes with F410's bodies and grants.
--
-- APPLY ON NTER: NTER already has all of it. Check with the fingerprint query in the fixture (read-only) that NTER
-- still matches, then insert the history row by hand under 20261126150000 (rollback-runbook.md; never
-- `supabase db push`, F283). Running the file on NTER is not needed. It would be safe (every statement is
-- if-not-exists, create-or-replace or a drop-and-create of an identical policy, in one transaction) and would only
-- drop the carriage returns from the function bodies.
--
-- DOWN: none on NTER (it holds user data: files, folders, objects in the bucket). On a disposable database, drop the
-- four tables (cascade), the 15 functions, the four storage policies, the bucket row and the three ingest_settings
-- columns.

begin;

-- 1. ingest_settings: the file-manager worker's concurrency limits (ingest_settings itself is created on main by
--    20261001140000_ingestion_v2).
alter table public.ingest_settings
  add column if not exists corpus_max_running integer not null default 2,
  add column if not exists user_file_max_running integer not null default 2,
  add column if not exists max_running_per_user integer not null default 1;

-- 2. Tables, with every constraint under its live name.
create table if not exists public.user_folders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  parent_id uuid,
  name text NOT NULL,
  path text NOT NULL,
  depth integer NOT NULL DEFAULT 0,
  system_key text,
  deleted_at timestamp with time zone,
  deleted_by_folder_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_folders_pkey PRIMARY KEY (id),
  CONSTRAINT user_folders_owner_unique UNIQUE (id, user_id),
  CONSTRAINT user_folders_depth_check CHECK (((depth >= 0) AND (depth <= 20))),
  CONSTRAINT user_folders_name_check CHECK (((length(TRIM(BOTH FROM name)) > 0) AND (length(name) <= 255) AND (name !~~ '%/%'::text))),
  CONSTRAINT user_folders_system_key_check CHECK (((system_key IS NULL) OR (system_key = 'artifacts'::text))),
  CONSTRAINT user_folders_deleted_by_folder_id_fkey FOREIGN KEY (deleted_by_folder_id) REFERENCES public.user_folders(id) ON DELETE SET NULL,
  CONSTRAINT user_folders_parent_owner_fk FOREIGN KEY (parent_id, user_id) REFERENCES public.user_folders(id, user_id) ON DELETE CASCADE,
  CONSTRAINT user_folders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

create table if not exists public.user_files (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  folder_id uuid,
  name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text,
  upload_status text NOT NULL DEFAULT 'pending_upload'::text,
  index_status text NOT NULL DEFAULT 'not_indexed'::text,
  index_error text,
  indexed_at timestamp with time zone,
  page_count integer,
  extract_hash text,
  artifact_meta jsonb,
  deleted_at timestamp with time zone,
  deleted_by_folder_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_files_pkey PRIMARY KEY (id),
  CONSTRAINT user_files_owner_unique UNIQUE (id, user_id),
  CONSTRAINT user_files_index_status_check CHECK ((index_status = ANY (ARRAY['not_indexed'::text, 'unsupported'::text, 'indexing_queued'::text, 'indexing_extracting'::text, 'indexing_chunking'::text, 'indexed'::text, 'indexing_failed'::text]))),
  CONSTRAINT user_files_name_check CHECK (((length(TRIM(BOTH FROM name)) > 0) AND (length(name) <= 255) AND (name !~~ '%/%'::text))),
  CONSTRAINT user_files_page_count_check CHECK (((page_count IS NULL) OR (page_count >= 0))),
  CONSTRAINT user_files_sha256_check CHECK (((sha256 IS NULL) OR (length(sha256) = 64))),
  CONSTRAINT user_files_size_bytes_check CHECK (((size_bytes > 0) AND (size_bytes <= 52428800))),
  CONSTRAINT user_files_storage_path_owner_chk CHECK (((regexp_match(storage_path, '^([0-9a-f-]{36})/'::text))[1] = (user_id)::text)),
  CONSTRAINT user_files_upload_status_check CHECK ((upload_status = ANY (ARRAY['pending_upload'::text, 'uploading'::text, 'uploaded'::text, 'upload_failed'::text]))),
  CONSTRAINT user_files_deleted_by_folder_id_fkey FOREIGN KEY (deleted_by_folder_id) REFERENCES public.user_folders(id) ON DELETE SET NULL,
  CONSTRAINT user_files_folder_owner_fk FOREIGN KEY (folder_id, user_id) REFERENCES public.user_folders(id, user_id) ON DELETE CASCADE,
  CONSTRAINT user_files_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

create table if not exists public.user_file_chunks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  file_id uuid NOT NULL,
  chunk_index integer NOT NULL,
  chunk_hash text NOT NULL,
  page_start integer NOT NULL,
  page_end integer NOT NULL,
  content text NOT NULL,
  text_hash text NOT NULL,
  embedding extensions.vector(1536) NOT NULL,
  token_count integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_file_chunks_pkey PRIMARY KEY (id),
  CONSTRAINT user_file_chunks_unique_hash UNIQUE (file_id, chunk_hash),
  CONSTRAINT user_file_chunks_check CHECK ((page_end >= page_start)),
  CONSTRAINT user_file_chunks_chunk_hash_check CHECK ((length(chunk_hash) = 64)),
  CONSTRAINT user_file_chunks_chunk_index_check CHECK ((chunk_index >= 0)),
  CONSTRAINT user_file_chunks_page_start_check CHECK ((page_start >= 1)),
  CONSTRAINT user_file_chunks_text_hash_check CHECK ((length(text_hash) = 64)),
  CONSTRAINT user_file_chunks_file_owner_fk FOREIGN KEY (file_id, user_id) REFERENCES public.user_files(id, user_id) ON DELETE CASCADE,
  CONSTRAINT user_file_chunks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

create table if not exists public.user_file_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  file_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued'::text,
  step text NOT NULL DEFAULT 'ocr'::text,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  claimed_by text,
  claimed_at timestamp with time zone,
  lease_expires_at timestamp with time zone,
  error_message text,
  credits_hold_paise bigint NOT NULL DEFAULT 0,
  credits_settled_paise bigint NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_file_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT user_file_jobs_attempt_count_check CHECK (((attempt_count >= 0) AND (attempt_count <= 3))),
  CONSTRAINT user_file_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]))),
  CONSTRAINT user_file_jobs_step_check CHECK ((step = ANY (ARRAY['ocr'::text, 'compose'::text, 'chunk'::text, 'embed'::text, 'commit'::text]))),
  CONSTRAINT user_file_jobs_file_owner_fk FOREIGN KEY (file_id, user_id) REFERENCES public.user_files(id, user_id) ON DELETE CASCADE,
  CONSTRAINT user_file_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- 3. Row-level security, enabled and forced, as on NTER.
alter table public.user_folders enable row level security;
alter table public.user_folders force row level security;
alter table public.user_files enable row level security;
alter table public.user_files force row level security;
alter table public.user_file_chunks enable row level security;
alter table public.user_file_chunks force row level security;
alter table public.user_file_jobs enable row level security;
alter table public.user_file_jobs force row level security;

-- 4. Indexes that are not constraints.
create index if not exists idx_user_file_chunks_embedding ON public.user_file_chunks USING hnsw (embedding extensions.vector_cosine_ops);
create index if not exists idx_user_file_chunks_file ON public.user_file_chunks USING btree (file_id);
create index if not exists idx_user_file_jobs_queue ON public.user_file_jobs USING btree (status, lease_expires_at) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));
create index if not exists idx_user_file_jobs_user_running ON public.user_file_jobs USING btree (user_id, status) WHERE (status = 'running'::text);
create index if not exists idx_user_files_trash ON public.user_files USING btree (user_id, deleted_at) WHERE (deleted_at IS NOT NULL);
create unique index if not exists idx_user_files_unique_active_name ON public.user_files USING btree (user_id, COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) WHERE (deleted_at IS NULL);
create index if not exists idx_user_files_user_active ON public.user_files USING btree (user_id, folder_id) WHERE (deleted_at IS NULL);
create index if not exists idx_user_folders_trash ON public.user_folders USING btree (user_id, deleted_at) WHERE (deleted_at IS NOT NULL);
create unique index if not exists idx_user_folders_unique_active_name ON public.user_folders USING btree (user_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) WHERE (deleted_at IS NULL);
create index if not exists idx_user_folders_user_active ON public.user_folders USING btree (user_id, parent_id) WHERE (deleted_at IS NULL);

-- 5. Policies: the owner (authenticated, own rows), postgres and the service role, on each table; owner-folder
--    access to the user-files bucket.
drop policy if exists user_file_chunks_owner_all on public.user_file_chunks;
create policy user_file_chunks_owner_all on public.user_file_chunks as permissive for all to authenticated
  using (user_id = ( SELECT auth.uid() AS uid))
  with check (user_id = ( SELECT auth.uid() AS uid));
drop policy if exists user_file_chunks_postgres_all on public.user_file_chunks;
create policy user_file_chunks_postgres_all on public.user_file_chunks as permissive for all to postgres
  using (true)
  with check (true);
drop policy if exists user_file_chunks_service_all on public.user_file_chunks;
create policy user_file_chunks_service_all on public.user_file_chunks as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists user_file_jobs_owner_all on public.user_file_jobs;
create policy user_file_jobs_owner_all on public.user_file_jobs as permissive for all to authenticated
  using (user_id = ( SELECT auth.uid() AS uid))
  with check (user_id = ( SELECT auth.uid() AS uid));
drop policy if exists user_file_jobs_postgres_all on public.user_file_jobs;
create policy user_file_jobs_postgres_all on public.user_file_jobs as permissive for all to postgres
  using (true)
  with check (true);
drop policy if exists user_file_jobs_service_all on public.user_file_jobs;
create policy user_file_jobs_service_all on public.user_file_jobs as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists user_files_owner_all on public.user_files;
create policy user_files_owner_all on public.user_files as permissive for all to authenticated
  using (user_id = ( SELECT auth.uid() AS uid))
  with check (user_id = ( SELECT auth.uid() AS uid));
drop policy if exists user_files_postgres_all on public.user_files;
create policy user_files_postgres_all on public.user_files as permissive for all to postgres
  using (true)
  with check (true);
drop policy if exists user_files_service_all on public.user_files;
create policy user_files_service_all on public.user_files as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists user_folders_owner_all on public.user_folders;
create policy user_folders_owner_all on public.user_folders as permissive for all to authenticated
  using (user_id = ( SELECT auth.uid() AS uid))
  with check (user_id = ( SELECT auth.uid() AS uid));
drop policy if exists user_folders_postgres_all on public.user_folders;
create policy user_folders_postgres_all on public.user_folders as permissive for all to postgres
  using (true)
  with check (true);
drop policy if exists user_folders_service_all on public.user_folders;
create policy user_folders_service_all on public.user_folders as permissive for all to service_role
  using (true)
  with check (true);
drop policy if exists user_files_storage_delete on storage.objects;
create policy user_files_storage_delete on storage.objects as permissive for delete to authenticated
  using ((bucket_id = 'user-files'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)));
drop policy if exists user_files_storage_insert on storage.objects;
create policy user_files_storage_insert on storage.objects as permissive for insert to authenticated
  with check ((bucket_id = 'user-files'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)));
drop policy if exists user_files_storage_select on storage.objects;
create policy user_files_storage_select on storage.objects as permissive for select to authenticated
  using ((bucket_id = 'user-files'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)));
drop policy if exists user_files_storage_update on storage.objects;
create policy user_files_storage_update on storage.objects as permissive for update to authenticated
  using ((bucket_id = 'user-files'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)))
  with check ((bucket_id = 'user-files'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)));

-- 6. The private user-files bucket (50 MB per file, any type).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-files', 'user-files', false, 52428800, null)
on conflict (id) do nothing;

-- 7. Functions, as on NTER (bodies verbatim, carriage returns aside).
CREATE OR REPLACE FUNCTION public.user_storage_quota_bytes(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  DECLARE
    v_uid uuid := COALESCE(p_user_id, (SELECT auth.uid()));
    v_caller uuid := (SELECT auth.uid());
    v_role text := (SELECT auth.role());
    v_ent jsonb;
    v_plan text;
    v_status text;
    v_lapsed boolean;
  BEGIN
    IF v_uid IS NULL THEN
      RETURN 524288000; -- 500 MB default
    END IF;

    -- F410: a request made for an end user reads only its own quota (and so its own plan).
    IF (v_caller IS NOT NULL OR v_role IN ('anon', 'authenticated')) AND v_caller IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'unauthorized: cannot inspect the storage quota of another user' USING ERRCODE = '42501';
    END IF;

    IF to_regproc('public.entitlement_from') IS NOT NULL THEN
      EXECUTE 'SELECT public.entitlement_from(p) FROM public.user_profiles p WHERE p.user_id = $1'
        INTO v_ent USING v_uid;
    ELSE
      SELECT jsonb_build_object('plan', p.plan, 'status', 'active', 'lapsed', false)
        INTO v_ent
        FROM public.user_profiles p
        WHERE p.user_id = v_uid;
    END IF;

    IF v_ent IS NULL THEN
      RETURN 524288000;
    END IF;

    v_plan := lower(COALESCE(v_ent->>'plan', 'free'));
    v_status := lower(COALESCE(v_ent->>'status', 'free'));
    v_lapsed := COALESCE((v_ent->>'lapsed')::boolean, false);

    IF v_lapsed IS TRUE OR v_status = 'free' OR v_plan IN ('free', 'explorer') THEN
      RETURN 524288000;    -- 500 MB Free
    ELSIF v_plan IN ('plus') THEN
      RETURN 2147483648;   -- 2 GB Plus
    ELSIF v_plan IN ('pro', 'professional') THEN
      RETURN 5368709120;   -- 5 GB Pro
    ELSIF v_plan IN ('max', 'enterprise') THEN
      RETURN 53687091200;  -- 50 GB Max
    ELSE
      RETURN 524288000;
    END IF;
  END;
  $function$;

CREATE OR REPLACE FUNCTION public.user_storage_used_bytes(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  DECLARE
    v_uid uuid := COALESCE(p_user_id, (SELECT auth.uid()));
    v_caller uuid := (SELECT auth.uid());
    v_role text := (SELECT auth.role());
    v_used bigint;
  BEGIN
    IF v_uid IS NULL THEN
      RETURN 0;
    END IF;

    -- F410: a request made for an end user reads only its own usage, whether or not it carries a user id.
    IF (v_caller IS NOT NULL OR v_role IN ('anon', 'authenticated')) AND v_caller IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'unauthorized: cannot inspect storage usage of another user' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(SUM(size_bytes), 0) INTO v_used
    FROM public.user_files
    WHERE user_id = v_uid
      AND upload_status <> 'upload_failed'
      AND NOT (upload_status = 'pending_upload' AND created_at < (now() - interval '2 hours'));

    RETURN v_used;
  END;
  $function$;

CREATE OR REPLACE FUNCTION public.match_user_files(query_embedding extensions.vector, match_threshold double precision DEFAULT 0.2, match_count integer DEFAULT 10, filter_file_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(id uuid, file_id uuid, user_id uuid, chunk_index integer, chunk_hash text, page_start integer, page_end integer, content text, text_hash text, similarity double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT
    c.id,
    c.file_id,
    c.user_id,
    c.chunk_index,
    c.chunk_hash,
    c.page_start,
    c.page_end,
    c.content,
    c.text_hash,
    (1 - (c.embedding <=> query_embedding))::float AS similarity
  FROM public.user_file_chunks c
  INNER JOIN public.user_files f ON c.file_id = f.id
  WHERE f.user_id = (SELECT auth.uid())
    AND f.deleted_at IS NULL
    AND (filter_file_ids IS NULL OR f.id = ANY(filter_file_ids))
    AND (1 - (c.embedding <=> query_embedding)) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$function$;

CREATE OR REPLACE FUNCTION public.user_file_prepare_upload(p_name text, p_size_bytes bigint, p_mime_type text, p_folder_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_allowed_quota bigint;
  v_current_used bigint;
  v_file_id uuid := gen_random_uuid();
  v_storage_path text;
  v_clean_name text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized: session missing' USING ERRCODE = '42501';
  END IF;

  v_clean_name := trim(p_name);
  IF length(v_clean_name) = 0 OR length(v_clean_name) > 255 OR v_clean_name LIKE '%/%' THEN
    RAISE EXCEPTION 'invalid_file_name: file name must be 1-255 characters without slashes' USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes <= 0 OR p_size_bytes > 52428800 THEN
    RAISE EXCEPTION 'file_too_large: individual file size cannot exceed 50 MB (52,428,800 bytes)' USING ERRCODE = '22023';
  END IF;

  IF p_folder_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_folders
      WHERE id = p_folder_id AND user_id = v_user_id AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'folder_not_found: parent folder does not exist or is in trash' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text));

  v_allowed_quota := public.user_storage_quota_bytes(v_user_id);

  SELECT COALESCE(SUM(size_bytes), 0) INTO v_current_used
  FROM public.user_files
  WHERE user_id = v_user_id
    AND upload_status <> 'upload_failed'
    AND NOT (upload_status = 'pending_upload' AND created_at < (now() - interval '2 hours'));

  IF v_current_used + p_size_bytes > v_allowed_quota THEN
    RAISE EXCEPTION 'quota_exceeded: upload of % bytes exceeds account storage quota of % bytes (current usage: % bytes)',
      p_size_bytes, v_allowed_quota, v_current_used USING ERRCODE = '54000';
  END IF;

  v_storage_path := v_user_id::text || '/' || v_file_id::text || '/' || v_clean_name;

  INSERT INTO public.user_files (
    id, user_id, folder_id, name, storage_path, mime_type, size_bytes,
    upload_status, index_status, created_at, updated_at
  ) VALUES (
    v_file_id, v_user_id, p_folder_id, v_clean_name, v_storage_path, p_mime_type, p_size_bytes,
    'pending_upload', 'not_indexed', now(), now()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'file_id', v_file_id,
    'storage_path', v_storage_path,
    'quota_bytes', v_allowed_quota,
    'used_bytes', v_current_used + p_size_bytes
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_file_complete_upload(p_file_id uuid, p_sha256 text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_file RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized: session missing' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_file
  FROM public.user_files
  WHERE id = p_file_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'file_not_found: reservation % does not exist or access denied', p_file_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.user_files
  SET upload_status = 'uploaded',
      sha256 = COALESCE(p_sha256, sha256),
      updated_at = now()
  WHERE id = p_file_id;

  RETURN jsonb_build_object('ok', true, 'file_id', p_file_id, 'status', 'uploaded');
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_file_restore(p_file_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_file RECORD;
  v_parent_exists boolean := false;
  v_target_folder_id uuid := NULL;
  v_relocated boolean := false;
  v_notice text := NULL;
  v_verify_res jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized: session missing' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_file
  FROM public.user_files
  WHERE id = p_file_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'file_id', p_file_id, 'error', 'not_found');
  END IF;

  IF v_file.deleted_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'file_id', p_file_id, 'error', 'not_in_trash');
  END IF;

  IF v_file.folder_id IS NOT NULL THEN
    SELECT (deleted_at IS NULL) INTO v_parent_exists
    FROM public.user_folders
    WHERE id = v_file.folder_id AND user_id = v_user_id;

    IF v_parent_exists IS TRUE THEN
      v_target_folder_id := v_file.folder_id;
    ELSE
      v_target_folder_id := NULL;
      v_relocated := true;
      v_notice := 'Original parent folder is unavailable or deleted. Item restored to root directory.';
    END IF;
  END IF;

  UPDATE public.user_files
  SET deleted_at = NULL,
      deleted_by_folder_id = NULL,
      folder_id = v_target_folder_id,
      updated_at = clock_timestamp()
  WHERE id = p_file_id;

  v_verify_res := public.user_file_verify_index_validity(p_file_id);

  RETURN jsonb_build_object(
    'ok', true,
    'file_id', p_file_id,
    'relocated_to_root', v_relocated,
    'folder_id', v_target_folder_id,
    'notice', v_notice,
    'index_verification', v_verify_res
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_file_verify_index_validity(p_file_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_file RECORD;
  v_chunk_count int := 0;
  v_is_valid boolean := false;
  v_reason text := NULL;
BEGIN
  SELECT id, user_id, mime_type, extract_hash, page_count, index_status
  INTO v_file
  FROM public.user_files
  WHERE id = p_file_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'file_not_found');
  END IF;

  IF v_file.mime_type <> 'application/pdf' THEN
    UPDATE public.user_files SET index_status = 'unsupported' WHERE id = p_file_id;
    RETURN jsonb_build_object('ok', true, 'status', 'unsupported');
  END IF;

  IF v_file.index_status IN ('not_indexed', 'unsupported') OR v_file.extract_hash IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'status', 'not_indexed');
  END IF;

  SELECT COUNT(*) INTO v_chunk_count
  FROM public.user_file_chunks
  WHERE file_id = p_file_id AND user_id = v_user_id;

  IF v_chunk_count = 0 THEN
    v_is_valid := false;
    v_reason := 'zero_chunks_found';
  ELSIF v_file.page_count IS NOT NULL AND v_file.page_count > 0 AND v_chunk_count < v_file.page_count THEN
    v_is_valid := false;
    v_reason := 'chunk_count_mismatch';
  ELSIF v_file.extract_hash IS NULL OR length(v_file.extract_hash) < 64 THEN
    v_is_valid := false;
    v_reason := 'invalid_extract_hash';
  ELSE
    v_is_valid := true;
  END IF;

  IF v_is_valid THEN
    UPDATE public.user_files
    SET index_status = 'indexed',
        index_error = NULL
    WHERE id = p_file_id;
    RETURN jsonb_build_object('ok', true, 'status', 'indexed', 'chunk_count', v_chunk_count);
  ELSE
    UPDATE public.user_files
    SET index_status = 'not_indexed',
        index_error = 'Index integrity verification failed on restore: ' || v_reason
    WHERE id = p_file_id;
    RETURN jsonb_build_object('ok', true, 'status', 'not_indexed', 'invalidated', true, 'reason', v_reason);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_folder_soft_delete(p_folder_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_now timestamptz := clock_timestamp();
  v_folder_count int := 0;
  v_file_count int := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized: session missing' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_folders
    WHERE id = p_folder_id AND user_id = v_user_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'folder_not_found: folder does not exist or is already in trash' USING ERRCODE = 'P0002';
  END IF;

  WITH RECURSIVE folder_tree AS (
    SELECT id FROM public.user_folders
    WHERE id = p_folder_id AND user_id = v_user_id
    UNION ALL
    SELECT f.id FROM public.user_folders f
    INNER JOIN folder_tree ft ON f.parent_id = ft.id
    WHERE f.user_id = v_user_id AND f.deleted_at IS NULL
  ),
  updated_folders AS (
    UPDATE public.user_folders
    SET deleted_at = v_now,
        deleted_by_folder_id = CASE WHEN id = p_folder_id THEN NULL ELSE p_folder_id END
    WHERE id IN (SELECT id FROM folder_tree) AND deleted_at IS NULL
    RETURNING id
  ),
  updated_files AS (
    UPDATE public.user_files
    SET deleted_at = v_now,
        deleted_by_folder_id = p_folder_id
    WHERE folder_id IN (SELECT id FROM folder_tree) AND deleted_at IS NULL
    RETURNING id
  )
  SELECT
    (SELECT COUNT(*) FROM updated_folders),
    (SELECT COUNT(*) FROM updated_files)
  INTO v_folder_count, v_file_count;

  RETURN jsonb_build_object(
    'ok', true,
    'folder_id', p_folder_id,
    'trashed_at', v_now,
    'trashed_folders_count', v_folder_count,
    'trashed_files_count', v_file_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_files_empty_trash()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_file_ids uuid[];
  v_storage_paths text[];
  v_purged_file_count int := 0;
  v_purged_folder_count int := 0;
  v_reclaimed_bytes bigint := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized: session missing' USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE(ARRAY_AGG(id), '{}'),
    COALESCE(ARRAY_AGG(storage_path), '{}'),
    COALESCE(SUM(size_bytes), 0),
    COUNT(*)
  INTO v_file_ids, v_storage_paths, v_reclaimed_bytes, v_purged_file_count
  FROM public.user_files
  WHERE user_id = v_user_id AND deleted_at IS NOT NULL;

  IF v_purged_file_count > 0 THEN
    DELETE FROM public.user_files
    WHERE id = ANY(v_file_ids) AND user_id = v_user_id;
  END IF;

  WITH deleted_f AS (
    DELETE FROM public.user_folders
    WHERE user_id = v_user_id AND deleted_at IS NOT NULL
    RETURNING id
  )
  SELECT COUNT(*) INTO v_purged_folder_count FROM deleted_f;

  RETURN jsonb_build_object(
    'ok', true,
    'purged_files', v_purged_file_count,
    'purged_folders', v_purged_folder_count,
    'reclaimed_bytes', v_reclaimed_bytes,
    'storage_paths_to_delete', v_storage_paths
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_file_enqueue_indexing(p_file_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_file RECORD;
  v_job_id bigint;
  v_hold_paise bigint;
  v_wallet public.credit_wallets;
  v_held numeric;
  v_available numeric;
  s public.credit_settings := private.credit_config();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated: authentication required' USING ERRCODE = '42501';
  END IF;

  -- Server-side feature gate: Fail-closed if indexing & billing is not explicitly activated
  IF NOT COALESCE((SELECT (value = 'true'::jsonb) FROM public.app_flags WHERE key = 'file_indexing_billing'), false) THEN
    RAISE EXCEPTION 'feature_disabled: AI indexing and billing is temporarily disabled pending production rollout' USING ERRCODE = '55000';
  END IF;

  -- Verify file ownership and upload readiness
  SELECT * INTO v_file
  FROM public.user_files
  WHERE id = p_file_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'file_not_found: file % does not exist or access denied', p_file_id USING ERRCODE = 'P0002';
  END IF;

  IF v_file.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'file_trashed: cannot index a file in trash' USING ERRCODE = 'P0001';
  END IF;

  IF v_file.upload_status <> 'uploaded' THEN
    RAISE EXCEPTION 'upload_not_complete: file % is %', p_file_id, v_file.upload_status USING ERRCODE = 'P0001';
  END IF;

  -- Guard against duplicate concurrent active jobs for the same file
  IF EXISTS (
    SELECT 1 FROM public.user_file_jobs
    WHERE file_id = p_file_id AND status IN ('queued', 'running')
  ) THEN
    RAISE EXCEPTION 'duplicate_job: an indexing job is already active for file %', p_file_id USING ERRCODE = '23505';
  END IF;

  -- Calculate server-authoritative hold estimate (40 credits / ₹0.40 per estimated page, min 1 page)
  v_hold_paise := GREATEST(
    1,
    COALESCE(
      v_file.page_count,
      CEIL(COALESCE(v_file.size_bytes, 60000)::numeric / 60000.0)::bigint
    )
  ) * 40;

  -- Atomic wallet refresh and lock
  PERFORM private.credit_refresh(v_user_id, now());
  v_wallet := private.credit_wallet(v_user_id);

  -- Calculate current active holds
  SELECT coalesce(sum(private.credit_current_amount(h.credits, h.inr_per_credit)), 0) INTO v_held
  FROM public.credit_holds h
  WHERE h.user_id = v_user_id
    AND h.settled_at IS NULL
    AND h.expires_at > now()
    AND NOT h.shadow_blocked;

  v_available := v_wallet.balance - v_held;

  -- Enforce pre-flight balance check
  IF v_available < v_hold_paise THEN
    RAISE EXCEPTION 'credits_exhausted: available % credits is less than required hold % credits',
      v_available, v_hold_paise USING ERRCODE = 'P0001';
  END IF;

  -- Create job with authoritative hold amount
  INSERT INTO public.user_file_jobs (
    file_id,
    user_id,
    status,
    step,
    credits_hold_paise,
    credits_settled_paise
  )
  VALUES (
    p_file_id,
    v_user_id,
    'queued',
    'ocr',
    v_hold_paise,
    0
  )
  RETURNING id INTO v_job_id;

  -- Create atomic reservation in public.credit_holds (30-minute processing window)
  INSERT INTO public.credit_holds (
    user_id,
    turn_key,
    credits,
    inr_per_credit,
    expires_at,
    shadow_blocked
  )
  VALUES (
    v_user_id,
    'file_job:' || v_job_id,
    v_hold_paise,
    s.inr_per_credit,
    now() + interval '30 minutes',
    false
  );

  -- Sync file status
  UPDATE public.user_files
  SET index_status = 'indexing_queued', updated_at = now()
  WHERE id = p_file_id;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'job_id', v_job_id,
    'file_id', p_file_id,
    'status', 'queued',
    'credits_hold_paise', v_hold_paise,
    'available_balance', v_available - v_hold_paise
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_file_job_cancel(p_job_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_job RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job
  FROM public.user_file_jobs
  WHERE id = p_job_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found: job % does not exist or access denied', p_job_id USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status NOT IN ('queued', 'running') THEN
    RAISE EXCEPTION 'job_not_cancellable: job is in status %', v_job.status USING ERRCODE = 'P0001';
  END IF;

  -- Release full hold
  UPDATE public.credit_holds
  SET settled_at = now()
  WHERE user_id = v_user_id
    AND turn_key = 'file_job:' || p_job_id
    AND settled_at IS NULL;

  -- Update job status
  UPDATE public.user_file_jobs
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_job_id;

  -- Reset file index status
  UPDATE public.user_files
  SET index_status = 'not_indexed', updated_at = now()
  WHERE id = v_job.file_id;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'job_id', p_job_id,
    'status', 'cancelled',
    'released_credits', v_job.credits_hold_paise
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_file_job_retry(p_job_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_job RECORD;
  v_hold_paise bigint;
  v_wallet public.credit_wallets;
  v_held numeric;
  v_available numeric;
  s public.credit_settings := private.credit_config();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated: authentication required' USING ERRCODE = '42501';
  END IF;

  -- Server-side feature gate: Fail-closed if indexing & billing is not explicitly activated
  IF NOT COALESCE((SELECT (value = 'true'::jsonb) FROM public.app_flags WHERE key = 'file_indexing_billing'), false) THEN
    RAISE EXCEPTION 'feature_disabled: AI indexing and billing is temporarily disabled pending production rollout' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_job
  FROM public.user_file_jobs
  WHERE id = p_job_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found: job % does not exist or access denied', p_job_id USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status <> 'failed' THEN
    RAISE EXCEPTION 'job_not_retryable: only failed jobs can be retried (current status %)', v_job.status USING ERRCODE = 'P0001';
  END IF;

  IF v_job.attempt_count >= v_job.max_attempts THEN
    RAISE EXCEPTION 'max_attempts_exceeded: job % has reached max attempts %', p_job_id, v_job.max_attempts USING ERRCODE = 'P0001';
  END IF;

  v_hold_paise := GREATEST(1, COALESCE(v_job.credits_hold_paise, 40));

  -- Atomic wallet refresh and lock
  PERFORM private.credit_refresh(v_user_id, now());
  v_wallet := private.credit_wallet(v_user_id);

  SELECT coalesce(sum(private.credit_current_amount(h.credits, h.inr_per_credit)), 0) INTO v_held
  FROM public.credit_holds h
  WHERE h.user_id = v_user_id
    AND h.settled_at IS NULL
    AND h.expires_at > now()
    AND NOT h.shadow_blocked;

  v_available := v_wallet.balance - v_held;

  IF v_available < v_hold_paise THEN
    RAISE EXCEPTION 'credits_exhausted: available % credits is less than required hold % credits',
      v_available, v_hold_paise USING ERRCODE = 'P0001';
  END IF;

  -- Re-arm or insert hold
  INSERT INTO public.credit_holds (
    user_id,
    turn_key,
    credits,
    inr_per_credit,
    expires_at,
    shadow_blocked
  )
  VALUES (
    v_user_id,
    'file_job:' || p_job_id,
    v_hold_paise,
    s.inr_per_credit,
    now() + interval '30 minutes',
    false
  )
  ON CONFLICT (user_id, turn_key) DO UPDATE
  SET credits = v_hold_paise,
      expires_at = now() + interval '30 minutes',
      settled_at = NULL,
      shadow_blocked = false;

  -- Reset job state to queued
  UPDATE public.user_file_jobs
  SET status = 'queued',
      step = 'ocr',
      error_message = NULL,
      updated_at = now()
  WHERE id = p_job_id;

  -- Sync file status
  UPDATE public.user_files
  SET index_status = 'indexing_queued', updated_at = now()
  WHERE id = v_job.file_id;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'job_id', p_job_id,
    'status', 'queued'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_file_claim(p_worker_id text, p_limit integer DEFAULT 1, p_lease_seconds integer DEFAULT 300)
 RETURNS SETOF user_file_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_max_user_file_running int := 2;
  v_max_per_user int := 1;
  v_current_running int;
  v_lease_duration interval := (COALESCE(p_lease_seconds, 300) || ' seconds')::interval;
BEGIN
  -- Read settings
  SELECT user_file_max_running, max_running_per_user
  INTO v_max_user_file_running, v_max_per_user
  FROM public.ingest_settings LIMIT 1;

  v_max_user_file_running := COALESCE(v_max_user_file_running, 2);
  v_max_per_user := COALESCE(v_max_per_user, 1);

  -- Count currently active jobs with valid leases
  SELECT COUNT(*) INTO v_current_running
  FROM public.user_file_jobs
  WHERE status = 'running' AND lease_expires_at > now();

  IF v_current_running >= v_max_user_file_running THEN
    RETURN; -- Pool is full
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
    FROM public.user_file_jobs j
    WHERE (j.status = 'queued' OR (j.status = 'running' AND j.lease_expires_at <= now()))
      AND j.attempt_count < j.max_attempts
      -- Fair share check: user must not exceed max_running_per_user
      AND (
        SELECT COUNT(*)
        FROM public.user_file_jobs u
        WHERE u.user_id = j.user_id AND u.status = 'running' AND u.lease_expires_at > now()
      ) < v_max_per_user
    ORDER BY j.created_at ASC
    LIMIT LEAST(p_limit, v_max_user_file_running - v_current_running)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.user_file_jobs uj
  SET status = 'running',
      claimed_by = p_worker_id,
      claimed_at = now(),
      lease_expires_at = now() + v_lease_duration,
      attempt_count = uj.attempt_count + 1,
      updated_at = now()
  FROM candidates c
  WHERE uj.id = c.id
  RETURNING uj.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_file_advance(p_job_id bigint, p_worker_id text, p_step text, p_status text, p_error text DEFAULT NULL::text, p_page_count integer DEFAULT NULL::integer, p_extract_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_job RECORD;
  v_file_index_status text;
BEGIN
  SELECT * INTO v_job
  FROM public.user_file_jobs
  WHERE id = p_job_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found: job % does not exist', p_job_id USING ERRCODE = 'P0002';
  END IF;

  IF v_job.claimed_by IS DISTINCT FROM p_worker_id AND v_job.status = 'running' AND v_job.lease_expires_at > now() THEN
    RAISE EXCEPTION 'fenced_out: worker % does not hold active lease on job %', p_worker_id, p_job_id USING ERRCODE = '55P03';
  END IF;

  UPDATE public.user_file_jobs
  SET step = p_step,
      status = p_status,
      error_message = p_error,
      lease_expires_at = CASE WHEN p_status IN ('completed', 'failed', 'cancelled') THEN now() ELSE now() + interval '300 seconds' END,
      updated_at = now()
  WHERE id = p_job_id;

  -- Sync user_files.index_status
  IF p_status = 'completed' THEN
    v_file_index_status := 'indexed';
  ELSIF p_status = 'failed' THEN
    v_file_index_status := 'indexing_failed';
  ELSIF p_step = 'ocr' THEN
    v_file_index_status := 'indexing_extracting';
  ELSIF p_step IN ('compose', 'chunk', 'embed') THEN
    v_file_index_status := 'indexing_chunking';
  ELSE
    v_file_index_status := 'indexing_queued';
  END IF;

  UPDATE public.user_files
  SET index_status = v_file_index_status,
      index_error = p_error,
      indexed_at = CASE WHEN p_status = 'completed' THEN now() ELSE indexed_at END,
      page_count = COALESCE(p_page_count, page_count),
      extract_hash = COALESCE(p_extract_hash, extract_hash),
      updated_at = now()
  WHERE id = v_job.file_id;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', p_job_id,
    'status', p_status,
    'step', p_step,
    'file_index_status', v_file_index_status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_file_settle_credits(p_job_id bigint, p_actual_cost_paise bigint, p_final_status text DEFAULT 'completed'::text, p_ocr_pages integer DEFAULT NULL::integer, p_embed_tokens integer DEFAULT NULL::integer, p_actual_cost_usd numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_job RECORD;
  v_charge_paise bigint;
  v_ledger_id uuid := NULL;
  s public.credit_settings := private.credit_config();
BEGIN
  -- Lock job record
  SELECT * INTO v_job
  FROM public.user_file_jobs
  WHERE id = p_job_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found: job % does not exist', p_job_id USING ERRCODE = 'P0002';
  END IF;

  -- Guard against duplicate settlement
  IF v_job.status = 'completed' AND v_job.credits_settled_paise > 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'job_id', p_job_id,
      'credits_settled', v_job.credits_settled_paise,
      'credits_settled_paise', v_job.credits_settled_paise,
      'status', 'already_settled'
    );
  END IF;

  -- Authoritative calculation using database credit_settings if USD cost is provided,
  -- ensuring worker and database pricing cannot silently diverge if exchange rates change.
  IF p_actual_cost_usd IS NOT NULL THEN
    v_charge_paise := GREATEST(0, ROUND(p_actual_cost_usd * (s.usd_to_inr / s.inr_per_credit))::bigint);
  ELSE
    v_charge_paise := GREATEST(0, COALESCE(p_actual_cost_paise, 0));
  END IF;

  -- Atomic wallet lock & refresh
  PERFORM private.credit_refresh(v_job.user_id, now());

  -- If billable cost exists, execute ledger insert and wallet debit
  IF v_charge_paise > 0 THEN
    v_ledger_id := private.credit_entry(
      v_job.user_id,
      'charge',
      -v_charge_paise,
      NULL,
      'file_job:' || p_job_id,
      NULL,
      s.usd_to_inr,
      s.inr_per_credit,
      NULL,
      'Private file AI indexing job ' || p_job_id
    );

    -- FIFO lot deduction and debt attribution
    PERFORM private.credit_draw(v_job.user_id, v_charge_paise, v_ledger_id, 'charge', now());
  END IF;

  -- Mark hold as settled (immediately releases any unused reserved credits back to available balance)
  UPDATE public.credit_holds
  SET settled_at = now()
  WHERE user_id = v_job.user_id
    AND turn_key = 'file_job:' || p_job_id
    AND settled_at IS NULL;

  -- Update job record
  UPDATE public.user_file_jobs
  SET credits_settled_paise = v_charge_paise,
      status = COALESCE(p_final_status, 'completed'),
      updated_at = now()
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'job_id', p_job_id,
    'credits_settled', v_charge_paise,
    'credits_settled_paise', v_charge_paise,
    'credits_refunded', GREATEST(0, v_job.credits_hold_paise - v_charge_paise),
    'refunded_paise', GREATEST(0, v_job.credits_hold_paise - v_charge_paise),
    'ledger_entry_id', v_ledger_id
  );
END;
$function$;

-- 8. Grants, exactly as on NTER: every API role on the tables and the job id sequence; per function, only the roles
--    that may execute it on NTER.
grant select, insert, update, delete, truncate, references, trigger on table public.user_folders, public.user_files,
  public.user_file_chunks, public.user_file_jobs to anon, authenticated, service_role;
grant usage, select, update on sequence public.user_file_jobs_id_seq to anon, authenticated, service_role;
revoke all on function public.match_user_files(extensions.vector, double precision, integer, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.match_user_files(extensions.vector, double precision, integer, uuid[]) to public, anon, authenticated, service_role;
revoke all on function public.user_file_advance(bigint, text, text, text, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.user_file_advance(bigint, text, text, text, text, integer, text) to service_role;
revoke all on function public.user_file_claim(text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.user_file_claim(text, integer, integer) to service_role;
revoke all on function public.user_file_complete_upload(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.user_file_complete_upload(uuid, text) to public, anon, authenticated, service_role;
revoke all on function public.user_file_enqueue_indexing(uuid) from public, anon, authenticated, service_role;
grant execute on function public.user_file_enqueue_indexing(uuid) to authenticated, service_role;
revoke all on function public.user_file_job_cancel(bigint) from public, anon, authenticated, service_role;
grant execute on function public.user_file_job_cancel(bigint) to authenticated, service_role;
revoke all on function public.user_file_job_retry(bigint) from public, anon, authenticated, service_role;
grant execute on function public.user_file_job_retry(bigint) to authenticated, service_role;
revoke all on function public.user_file_prepare_upload(text, bigint, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.user_file_prepare_upload(text, bigint, text, uuid) to public, anon, authenticated, service_role;
revoke all on function public.user_file_restore(uuid) from public, anon, authenticated, service_role;
grant execute on function public.user_file_restore(uuid) to public, anon, authenticated, service_role;
revoke all on function public.user_file_settle_credits(bigint, bigint, text, integer, integer, numeric) from public, anon, authenticated, service_role;
grant execute on function public.user_file_settle_credits(bigint, bigint, text, integer, integer, numeric) to service_role;
revoke all on function public.user_file_verify_index_validity(uuid) from public, anon, authenticated, service_role;
grant execute on function public.user_file_verify_index_validity(uuid) to public, anon, authenticated, service_role;
revoke all on function public.user_files_empty_trash() from public, anon, authenticated, service_role;
grant execute on function public.user_files_empty_trash() to public, anon, authenticated, service_role;
revoke all on function public.user_folder_soft_delete(uuid) from public, anon, authenticated, service_role;
grant execute on function public.user_folder_soft_delete(uuid) to public, anon, authenticated, service_role;
revoke all on function public.user_storage_quota_bytes(uuid) from public, anon, authenticated, service_role;
grant execute on function public.user_storage_quota_bytes(uuid) to authenticated, service_role;
revoke all on function public.user_storage_used_bytes(uuid) from public, anon, authenticated, service_role;
grant execute on function public.user_storage_used_bytes(uuid) to authenticated, service_role;

commit;
