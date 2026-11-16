-- ============================================================================
-- NIYANTRAN AI FILE MANAGER (F341) — PRODUCTION SUPABASE DASHBOARD SQL
-- Idempotent, safe to paste repeatedly in Supabase Dashboard SQL Editor.
-- Does NOT produce "already exists" or missing column errors.
-- ============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA extensions;

-- 2. STORAGE BUCKET: 'user-files' (Private, 50 MB per-file limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('user-files', 'user-files', false, 52428800, null)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800;

-- 3. STORAGE OBJECT RLS POLICIES (Idempotent: Drop and recreate)
DROP POLICY IF EXISTS user_files_storage_select ON storage.objects;
CREATE POLICY user_files_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));

DROP POLICY IF EXISTS user_files_storage_insert ON storage.objects;
CREATE POLICY user_files_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));

DROP POLICY IF EXISTS user_files_storage_update ON storage.objects;
CREATE POLICY user_files_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text))
  WITH CHECK (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));

DROP POLICY IF EXISTS user_files_storage_delete ON storage.objects;
CREATE POLICY user_files_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'user-files' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));

-- 4. TABLES (IF NOT EXISTS)
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

CREATE TABLE IF NOT EXISTS public.user_files (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id            uuid DEFAULT NULL,
  name                 text NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 255 AND name NOT LIKE '%/%'),
  storage_path         text NOT NULL,
  mime_type            text NOT NULL,
  size_bytes           bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
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

ALTER TABLE public.user_files ADD COLUMN IF NOT EXISTS upload_status text NOT NULL DEFAULT 'pending_upload';
ALTER TABLE public.user_files ADD COLUMN IF NOT EXISTS index_status text NOT NULL DEFAULT 'not_indexed';
ALTER TABLE public.user_files ADD COLUMN IF NOT EXISTS index_error text DEFAULT NULL;
ALTER TABLE public.user_files ADD COLUMN IF NOT EXISTS indexed_at timestamptz DEFAULT NULL;
ALTER TABLE public.user_files ADD COLUMN IF NOT EXISTS page_count int DEFAULT NULL;
ALTER TABLE public.user_files ADD COLUMN IF NOT EXISTS extract_hash text DEFAULT NULL;
ALTER TABLE public.user_files ADD COLUMN IF NOT EXISTS artifact_meta jsonb DEFAULT NULL;
ALTER TABLE public.user_files ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;
ALTER TABLE public.user_files ADD COLUMN IF NOT EXISTS deleted_by_folder_id uuid DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_user_files_user_active
  ON public.user_files(user_id, folder_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_files_trash
  ON public.user_files(user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_files_unique_active_name
  ON public.user_files(user_id, COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  WHERE deleted_at IS NULL;

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

-- Ensure all columns exist even if user_file_jobs was created in an earlier partial run
ALTER TABLE public.user_file_jobs ADD COLUMN IF NOT EXISTS claimed_by text DEFAULT NULL;
ALTER TABLE public.user_file_jobs ADD COLUMN IF NOT EXISTS claimed_at timestamptz DEFAULT NULL;
ALTER TABLE public.user_file_jobs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz DEFAULT NULL;
ALTER TABLE public.user_file_jobs ADD COLUMN IF NOT EXISTS error_message text DEFAULT NULL;
ALTER TABLE public.user_file_jobs ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0;
ALTER TABLE public.user_file_jobs ADD COLUMN IF NOT EXISTS max_attempts int NOT NULL DEFAULT 3;
ALTER TABLE public.user_file_jobs ADD COLUMN IF NOT EXISTS credits_hold_paise bigint NOT NULL DEFAULT 0;
ALTER TABLE public.user_file_jobs ADD COLUMN IF NOT EXISTS credits_settled_paise bigint NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS idx_user_file_jobs_running;
CREATE INDEX IF NOT EXISTS idx_user_file_jobs_queue
  ON public.user_file_jobs(status, lease_expires_at)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_user_file_jobs_user_running
  ON public.user_file_jobs(user_id, status)
  WHERE status = 'running';

-- 5. ROW LEVEL SECURITY (RLS)
ALTER TABLE public.user_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_file_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_file_jobs ENABLE ROW LEVEL SECURITY;

-- Owner Policies (Drop and recreate)
DROP POLICY IF EXISTS user_folders_owner_all ON public.user_folders;
CREATE POLICY user_folders_owner_all ON public.user_folders
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS user_files_owner_all ON public.user_files;
CREATE POLICY user_files_owner_all ON public.user_files
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS user_file_chunks_owner_all ON public.user_file_chunks;
CREATE POLICY user_file_chunks_owner_all ON public.user_file_chunks
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS user_file_jobs_owner_all ON public.user_file_jobs;
CREATE POLICY user_file_jobs_owner_all ON public.user_file_jobs
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Service Role Policies (Drop and recreate)
DROP POLICY IF EXISTS user_folders_service_all ON public.user_folders;
CREATE POLICY user_folders_service_all ON public.user_folders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS user_files_service_all ON public.user_files;
CREATE POLICY user_files_service_all ON public.user_files
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS user_file_chunks_service_all ON public.user_file_chunks;
CREATE POLICY user_file_chunks_service_all ON public.user_file_chunks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS user_file_jobs_service_all ON public.user_file_jobs;
CREATE POLICY user_file_jobs_service_all ON public.user_file_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. FUNCTIONS & RPCS

-- A. Quota Ceiling Calculation (returns limit: e.g. 500 MB)
CREATE OR REPLACE FUNCTION public.user_storage_quota_bytes(p_user_id uuid DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := COALESCE(p_user_id, (SELECT auth.uid()));
  v_ent jsonb;
  v_plan text;
  v_status text;
  v_lapsed boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 524288000; -- 500 MB default
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
$$;

-- B. Used Storage Calculation (sums active, in-flight, trashed files; excludes failed/stale)
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

  IF (SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) <> v_uid THEN
    RAISE EXCEPTION 'unauthorized: cannot inspect storage usage of another user' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(size_bytes), 0) INTO v_used
  FROM public.user_files
  WHERE user_id = v_uid
    AND upload_status <> 'upload_failed'
    AND NOT (upload_status = 'pending_upload' AND created_at < (now() - interval '2 hours'));

  RETURN v_used;
END;
$$;

-- C. Prepare Upload RPC
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
$$;

-- D. Complete Upload RPC
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
$$;

-- E. Empty Trash RPC (Immediate Permanent Purge)
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
$$;

-- 7. EXPLICIT GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_folders TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_files TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_file_chunks TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_file_jobs TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.user_storage_quota_bytes(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_storage_used_bytes(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_file_prepare_upload(text, bigint, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_file_complete_upload(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_files_empty_trash() TO authenticated, service_role;
