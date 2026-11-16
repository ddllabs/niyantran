-- Migration: 20261115000001_private_file_manager.sql
-- Status: Normative. Feature F341: Private File Manager & Knowledge Integration.
-- References: ADR 0006, docs/specs/private-file-manager-functionality.md,
--             docs/plans/2026-11-14-private-file-manager.md.
--
-- Adds:
--   1. Storage bucket 'user-files' (private, 50 MB file limit) with owner-isolated RLS.
--   2. Tables: user_folders, user_files, user_file_chunks, user_file_jobs.
--   3. Strict owner RLS using InitPlan pattern (SELECT auth.uid()). Platform admins barred.
--   4. Quota functions (user_storage_quota_bytes, user_file_prepare_upload, user_file_complete_upload).
--   5. Ingestion settings partitioned concurrency (corpus_max_running, user_file_max_running, max_running_per_user).
--   6. Ingestion claim, advance, and credit settlement RPCs.
--   7. Dual-source vector RAG retrieval RPC: match_user_files.
--   8. Trash, restore, hierarchy recovery, and atomic empty trash RPCs.

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Storage bucket 'user-files'
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('user-files', 'user-files', false, 52428800, null)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800;

-- Storage object RLS policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'user_files_storage_select'
  ) THEN
    CREATE POLICY user_files_storage_select ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'user_files_storage_insert'
  ) THEN
    CREATE POLICY user_files_storage_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'user_files_storage_update'
  ) THEN
    CREATE POLICY user_files_storage_update ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text))
      WITH CHECK (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'user_files_storage_delete'
  ) THEN
    CREATE POLICY user_files_storage_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables: user_folders, user_files, user_file_chunks, user_file_jobs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_folders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id            uuid DEFAULT NULL,
  name                 text NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 255 AND name NOT LIKE '%/%'),
  path                 text NOT NULL,
  depth                int NOT NULL DEFAULT 0 CHECK (depth >= 0 AND depth <= 20),
  system_key           text DEFAULT NULL CHECK (system_key IS NULL OR system_key IN ('artifacts')),
  deleted_at           timestamptz DEFAULT NULL,
  deleted_by_folder_id uuid DEFAULT NULL REFERENCES public.user_folders(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_folders_owner_unique UNIQUE (id, user_id),
  CONSTRAINT user_folders_parent_owner_fk FOREIGN KEY (parent_id, user_id)
    REFERENCES public.user_folders(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_folders_user_active
  ON public.user_folders(user_id, parent_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_folders_trash
  ON public.user_folders(user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_folders_unique_active_name
  ON public.user_folders(user_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  WHERE deleted_at IS NULL;

-- user_files table
CREATE TABLE IF NOT EXISTS public.user_files (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id            uuid DEFAULT NULL,
  name                 text NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 255 AND name NOT LIKE '%/%'),
  storage_path         text NOT NULL,
  mime_type            text NOT NULL,
  size_bytes           bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800), -- 50 MB upload cap
  sha256               text DEFAULT NULL CHECK (sha256 IS NULL OR length(sha256) = 64),
  upload_status        text NOT NULL DEFAULT 'pending_upload'
                       CHECK (upload_status IN ('pending_upload', 'uploading', 'uploaded', 'upload_failed')),
  index_status         text NOT NULL DEFAULT 'not_indexed'
                       CHECK (index_status IN ('not_indexed', 'unsupported', 'indexing_queued', 'indexing_extracting', 'indexing_chunking', 'indexed', 'indexing_failed')),
  index_error          text DEFAULT NULL,
  indexed_at           timestamptz DEFAULT NULL,
  page_count           int DEFAULT NULL CHECK (page_count IS NULL OR page_count >= 0),
  extract_hash         text DEFAULT NULL,
  artifact_meta        jsonb DEFAULT NULL,
  deleted_at           timestamptz DEFAULT NULL,
  deleted_by_folder_id uuid DEFAULT NULL REFERENCES public.user_folders(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_files_owner_unique UNIQUE (id, user_id),
  CONSTRAINT user_files_folder_owner_fk FOREIGN KEY (folder_id, user_id)
    REFERENCES public.user_folders(id, user_id) ON DELETE CASCADE,
  CONSTRAINT user_files_storage_path_owner_chk
    CHECK ((regexp_match(storage_path, '^([0-9a-f-]{36})/'))[1] = user_id::text)
);

CREATE INDEX IF NOT EXISTS idx_user_files_user_active
  ON public.user_files(user_id, folder_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_files_trash
  ON public.user_files(user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_files_unique_active_name
  ON public.user_files(user_id, COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  WHERE deleted_at IS NULL;

-- user_file_chunks table
CREATE TABLE IF NOT EXISTS public.user_file_chunks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_id              uuid NOT NULL,
  chunk_index          int NOT NULL CHECK (chunk_index >= 0),
  chunk_hash           text NOT NULL CHECK (length(chunk_hash) = 64),
  page_start           int NOT NULL CHECK (page_start >= 1),
  page_end             int NOT NULL CHECK (page_end >= page_start),
  content              text NOT NULL,
  text_hash            text NOT NULL CHECK (length(text_hash) = 64),
  embedding            extensions.vector(1536) NOT NULL,
  token_count          int DEFAULT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_file_chunks_file_owner_fk FOREIGN KEY (file_id, user_id)
    REFERENCES public.user_files(id, user_id) ON DELETE CASCADE,
  CONSTRAINT user_file_chunks_unique_hash UNIQUE (file_id, chunk_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_file_chunks_file
  ON public.user_file_chunks(file_id);

CREATE INDEX IF NOT EXISTS idx_user_file_chunks_embedding
  ON public.user_file_chunks USING hnsw (embedding extensions.vector_cosine_ops);

-- user_file_jobs table
CREATE TABLE IF NOT EXISTS public.user_file_jobs (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_id              uuid NOT NULL,
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status               text NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  step                 text NOT NULL DEFAULT 'ocr'
                       CHECK (step IN ('ocr', 'compose', 'chunk', 'embed', 'commit')),
  attempt_count        int NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 3),
  max_attempts         int NOT NULL DEFAULT 3,
  claimed_by           text DEFAULT NULL,
  claimed_at           timestamptz DEFAULT NULL,
  lease_expires_at     timestamptz DEFAULT NULL,
  error_message        text DEFAULT NULL,
  credits_hold_paise   bigint NOT NULL DEFAULT 0,
  credits_settled_paise bigint NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_file_jobs_file_owner_fk FOREIGN KEY (file_id, user_id)
    REFERENCES public.user_files(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_file_jobs_queue
  ON public.user_file_jobs(status, lease_expires_at)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_user_file_jobs_user_running
  ON public.user_file_jobs(user_id, status)
  WHERE status = 'running';

-- ---------------------------------------------------------------------------
-- 3. Row Level Security (RLS)
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_folders FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_files FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_file_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_file_chunks FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_file_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_file_jobs FORCE ROW LEVEL SECURITY;

-- Owner-only policies (InitPlan pattern: (SELECT auth.uid()))
CREATE POLICY user_folders_owner_all ON public.user_folders
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY user_files_owner_all ON public.user_files
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY user_file_chunks_owner_all ON public.user_file_chunks
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY user_file_jobs_owner_all ON public.user_file_jobs
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Service role access & Worker bypass policies
GRANT ALL ON public.user_folders TO service_role;
GRANT ALL ON public.user_files TO service_role;
GRANT ALL ON public.user_file_chunks TO service_role;
GRANT ALL ON public.user_file_jobs TO service_role;

CREATE POLICY user_folders_service_all ON public.user_folders
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY user_files_service_all ON public.user_files
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY user_file_chunks_service_all ON public.user_file_chunks
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY user_file_jobs_service_all ON public.user_file_jobs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'nter_migrator') THEN
    CREATE POLICY user_folders_migrator_all ON public.user_folders FOR ALL TO nter_migrator USING (true) WITH CHECK (true);
    CREATE POLICY user_files_migrator_all ON public.user_files FOR ALL TO nter_migrator USING (true) WITH CHECK (true);
    CREATE POLICY user_file_chunks_migrator_all ON public.user_file_chunks FOR ALL TO nter_migrator USING (true) WITH CHECK (true);
    CREATE POLICY user_file_jobs_migrator_all ON public.user_file_jobs FOR ALL TO nter_migrator USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE POLICY user_folders_postgres_all ON public.user_folders FOR ALL TO postgres USING (true) WITH CHECK (true);
    CREATE POLICY user_files_postgres_all ON public.user_files FOR ALL TO postgres USING (true) WITH CHECK (true);
    CREATE POLICY user_file_chunks_postgres_all ON public.user_file_chunks FOR ALL TO postgres USING (true) WITH CHECK (true);
    CREATE POLICY user_file_jobs_postgres_all ON public.user_file_jobs FOR ALL TO postgres USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Storage Quota & Upload Reservation RPCs
-- ---------------------------------------------------------------------------

-- Quota calculation based on public.entitlement_from(user_profiles)
CREATE OR REPLACE FUNCTION public.user_storage_quota_bytes(p_user_id uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ent jsonb;
  v_plan text;
  v_status text;
  v_lapsed boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 524288000; -- 500 MB default
  END IF;

  IF to_regproc('public.entitlement_from') IS NOT NULL THEN
    EXECUTE 'SELECT public.entitlement_from(p) FROM public.user_profiles p WHERE p.user_id = $1'
      INTO v_ent USING p_user_id;
  ELSE
    SELECT jsonb_build_object('plan', p.plan, 'status', 'active', 'lapsed', false)
      INTO v_ent
      FROM public.user_profiles p
      WHERE p.user_id = p_user_id;
  END IF;

  IF v_ent IS NULL THEN
    RETURN 524288000;
  END IF;

  v_plan := lower(COALESCE(v_ent->>'plan', 'free'));
  v_status := lower(COALESCE(v_ent->>'status', 'free'));
  v_lapsed := COALESCE((v_ent->>'lapsed')::boolean, false);

  -- Expired or lapsed paid plan dynamically falls back to Free quota
  IF v_lapsed IS TRUE OR v_status = 'free' OR v_plan IN ('free', 'explorer') THEN
    RETURN 524288000; -- 500 MB (Approved)
  ELSIF v_plan IN ('plus') THEN
    RETURN 2147483648; -- 2 GB (Proposed)
  ELSIF v_plan IN ('pro', 'professional') THEN
    RETURN 5368709120; -- 5 GB (Approved)
  ELSIF v_plan IN ('max', 'enterprise') THEN
    RETURN 53687091200; -- 50 GB configurable (Proposed baseline)
  ELSE
    RETURN 524288000;
  END IF;
END;
$$;

-- Used storage calculation helper (sums active, in-flight, and trashed files)
CREATE OR REPLACE FUNCTION public.user_storage_used_bytes(p_user_id uuid DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := COALESCE(p_user_id, (SELECT auth.uid()));
  v_used bigint;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  -- Caller cannot query another tenant's usage unless service_role/superuser
  IF (SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) <> v_uid THEN
    RAISE EXCEPTION 'unauthorized: cannot inspect storage usage of another user' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(size_bytes), 0) INTO v_used
  FROM public.user_files
  WHERE user_id = v_uid;

  RETURN v_used;
END;
$$;

-- Prepare upload RPC with concurrency-safe advisory lock
CREATE OR REPLACE FUNCTION public.user_file_prepare_upload(
  p_name text,
  p_size_bytes bigint,
  p_mime_type text,
  p_folder_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
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

  -- Acquire transaction advisory lock on user_id to prevent concurrent quota races
  PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text));

  v_allowed_quota := public.user_storage_quota_bytes(v_user_id);

  -- Current used storage includes active, in-flight, and trashed files
  SELECT COALESCE(SUM(size_bytes), 0) INTO v_current_used
  FROM public.user_files
  WHERE user_id = v_user_id;

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
$$;

-- Complete upload RPC
CREATE OR REPLACE FUNCTION public.user_file_complete_upload(
  p_file_id uuid,
  p_sha256 text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_file RECORD;
  v_new_index_status text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized: session missing' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_file
  FROM public.user_files
  WHERE id = p_file_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'file_not_found: file does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF v_file.mime_type = 'application/pdf' THEN
    v_new_index_status := 'not_indexed';
  ELSE
    v_new_index_status := 'unsupported';
  END IF;

  UPDATE public.user_files
  SET upload_status = 'uploaded',
      index_status = v_new_index_status,
      sha256 = COALESCE(p_sha256, sha256),
      updated_at = now()
  WHERE id = p_file_id AND user_id = v_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'file_id', p_file_id,
    'upload_status', 'uploaded',
    'index_status', v_new_index_status
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Ingestion Settings & Partitioned Concurrency
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ingest_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  max_running int NOT NULL DEFAULT 2,
  claim_batch int NOT NULL DEFAULT 1,
  decision_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ingest_settings (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.ingest_settings
  ADD COLUMN IF NOT EXISTS corpus_max_running int NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS user_file_max_running int NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_running_per_user int NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- 6. Ingestion Claim, Advance & Settlement RPCs
-- ---------------------------------------------------------------------------

-- Claim user file indexing job
CREATE OR REPLACE FUNCTION public.user_file_claim(
  p_worker_id text,
  p_limit int DEFAULT 1
)
RETURNS SETOF public.user_file_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_max_user_file_running int := 2;
  v_max_per_user int := 1;
  v_current_running int;
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
      lease_expires_at = now() + interval '300 seconds',
      attempt_count = uj.attempt_count + 1,
      updated_at = now()
  FROM candidates c
  WHERE uj.id = c.id
  RETURNING uj.*;
END;
$$;

-- Advance user file job RPC
CREATE OR REPLACE FUNCTION public.user_file_advance(
  p_job_id bigint,
  p_worker_id text,
  p_step text,
  p_status text,
  p_error text DEFAULT NULL,
  p_page_count int DEFAULT NULL,
  p_extract_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

-- Settle credits RPC
CREATE OR REPLACE FUNCTION public.user_file_settle_credits(
  p_job_id bigint,
  p_actual_cost_paise bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job RECORD;
BEGIN
  SELECT * INTO v_job
  FROM public.user_file_jobs
  WHERE id = p_job_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found: job % does not exist', p_job_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.user_file_jobs
  SET credits_settled_paise = p_actual_cost_paise,
      updated_at = now()
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', p_job_id,
    'credits_settled_paise', p_actual_cost_paise
  );
END;
$$;

-- Enqueue user file indexing RPC
CREATE OR REPLACE FUNCTION public.user_file_enqueue_indexing(p_file_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_file RECORD;
  v_job_id bigint;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated: authentication required' USING ERRCODE = '42501';
  END IF;

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

  -- Create job in user_file_jobs
  INSERT INTO public.user_file_jobs (file_id, user_id, status, step)
  VALUES (p_file_id, v_user_id, 'queued', 'ocr')
  RETURNING id INTO v_job_id;

  -- Sync user_files.index_status
  UPDATE public.user_files
  SET index_status = 'indexing_queued', updated_at = now()
  WHERE id = p_file_id;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', v_job_id,
    'file_id', p_file_id,
    'status', 'queued'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Dual-Source Vector Retrieval RPC: match_user_files
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.match_user_files(
  query_embedding extensions.vector(1536),
  match_threshold float DEFAULT 0.2,
  match_count int DEFAULT 10,
  filter_file_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  file_id uuid,
  user_id uuid,
  chunk_index int,
  chunk_hash text,
  page_start int,
  page_end int,
  content text,
  text_hash text,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
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
$$;

-- ---------------------------------------------------------------------------
-- 8. Trash, Restore & Empty Trash RPCs
-- ---------------------------------------------------------------------------

-- Recursive folder soft-delete
CREATE OR REPLACE FUNCTION public.user_folder_soft_delete(p_folder_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
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
$$;

-- Verify index validity on restore
CREATE OR REPLACE FUNCTION public.user_file_verify_index_validity(p_file_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
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
$$;

-- Restore file RPC
CREATE OR REPLACE FUNCTION public.user_file_restore(p_file_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
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
$$;

-- Empty Trash RPC (Immediate Permanent Purge)
CREATE OR REPLACE FUNCTION public.user_files_empty_trash()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
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

  -- Delete files (Cascades to user_file_chunks and user_file_jobs)
  IF v_purged_file_count > 0 THEN
    DELETE FROM public.user_files
    WHERE id = ANY(v_file_ids) AND user_id = v_user_id;
  END IF;

  -- Delete folders in Trash
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
$$;

-- ---------------------------------------------------------------------------
-- 9. Explicit RPC & Table Grants for Authenticated and Service Roles
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_folders TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_files TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_file_chunks TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_file_jobs TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.user_storage_quota_bytes(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_storage_used_bytes(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_file_prepare_upload(text, bigint, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_file_complete_upload(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_file_claim(text, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_file_advance(bigint, text, text, text, text, int, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_file_settle_credits(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_file_enqueue_indexing(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_user_files(extensions.vector, float, int, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_folder_soft_delete(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_file_verify_index_validity(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_file_restore(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_files_empty_trash() TO authenticated, service_role;

COMMIT;

