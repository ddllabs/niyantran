-- ============================================================================
-- Feature F341: Private File Manager & Knowledge Integration
-- Security & SQL Adversarial Test Fixture: user_files_isolation.sql
-- Status: Normative.
--
-- References:
--   - ADR 0006: Private File Manager & Storage Architecture
--   - docs/specs/private-file-manager-functionality.md
--   - docs/plans/2026-11-14-private-file-manager.md
--   - supabase/migrations/20261115000001_private_file_manager.sql
--
-- Disposable PostgreSQL assertions; run only against a disposable test DB.
-- Never run against a hosted project.
--
-- Test Coverage:
--   T-1: Cross-Tenant Isolation (user_folders, user_files, storage objects, admin isolation)
--   T-2: Cross-Tenant Nesting Rejected (composite foreign key 23503 on parent_id & folder_id)
--   T-3: Storage Quota & Advisory Lock Enforcement (prepare_upload, quota_exceeded 54000, trash counts)
--   T-4: Soft Delete & RAG Isolation (recursive soft-delete, vector search exclusion, cross-tenant RAG defense)
--   T-5: Index Validity on Restore (hierarchy recovery, chunk verification, tampering invalidation)
--   T-6: Empty Trash / Permanent Purge (cascade deletion, tenant safety, quota reclamation)
-- ============================================================================

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Test Harness Assertions & Setup
-- ---------------------------------------------------------------------------

CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', label;
  END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;

CREATE FUNCTION pg_temp.rejected(statement text, expected_state text, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF expected_state IS NOT NULL AND SQLSTATE <> expected_state THEN
      RAISE EXCEPTION 'FAIL: % (expected %, got %: %)', label, expected_state, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: % (%: %)', label, SQLSTATE, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % (statement was accepted unexpectedly)', label;
END;
$$;

-- Storage helper function stub if not present in test database
CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT string_to_array(name, '/');
$$;

-- Ensure ingest_settings singleton exists for fair-share/concurrency RPCs
DO $$
BEGIN
  IF to_regclass('public.ingest_settings') IS NOT NULL THEN
    INSERT INTO public.ingest_settings (singleton, corpus_max_running, user_file_max_running, max_running_per_user)
    VALUES (true, 2, 2, 1)
    ON CONFLICT (singleton) DO UPDATE SET
      user_file_max_running = 2,
      max_running_per_user = 1;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Disposable Test Users Setup
-- ---------------------------------------------------------------------------

-- User A: Tenant A
-- User B: Tenant B
-- Admin: Platform Administrator
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'tenant.a@example.test'),
  ('00000000-0000-4000-8000-0000000000b2', 'tenant.b@example.test'),
  ('00000000-0000-4000-8000-0000000000f9', 'platform.admin@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profiles (user_id, email, role, plan) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'tenant.a@example.test', 'user', 'explorer'),
  ('00000000-0000-4000-8000-0000000000b2', 'tenant.b@example.test', 'user', 'explorer'),
  ('00000000-0000-4000-8000-0000000000f9', 'platform.admin@example.test', 'admin', 'enterprise')
ON CONFLICT (user_id) DO UPDATE SET
  role = EXCLUDED.role,
  plan = EXCLUDED.plan;

-- Confirm RLS is enabled and forced on all Feature F341 tables
SELECT pg_temp.assert_true((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.user_folders'::regclass), 'user_folders has forced RLS');
SELECT pg_temp.assert_true((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.user_files'::regclass), 'user_files has forced RLS');
SELECT pg_temp.assert_true((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.user_file_chunks'::regclass), 'user_file_chunks has forced RLS');
SELECT pg_temp.assert_true((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.user_file_jobs'::regclass), 'user_file_jobs has forced RLS');

-- ---------------------------------------------------------------------------
-- T-1: Cross-Tenant Isolation
-- ---------------------------------------------------------------------------

-- Seed User B's resources as User B
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b2';
SET LOCAL request.jwt.claim.role = 'authenticated';

INSERT INTO public.user_folders (id, user_id, name, path, depth)
VALUES ('10000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000b2', 'Folder_B', '/Folder_B', 0);

INSERT INTO public.user_files (id, user_id, folder_id, name, storage_path, mime_type, size_bytes, upload_status, index_status)
VALUES (
  '20000000-0000-4000-8000-00000000000b',
  '00000000-0000-4000-8000-0000000000b2',
  '10000000-0000-4000-8000-00000000000b',
  'Secret_B.pdf',
  '00000000-0000-4000-8000-0000000000b2/20000000-0000-4000-8000-00000000000b/Secret_B.pdf',
  'application/pdf',
  1048576,
  'uploaded',
  'indexed'
);

INSERT INTO public.user_file_chunks (id, user_id, file_id, chunk_index, chunk_hash, page_start, page_end, content, text_hash, embedding)
VALUES (
  '30000000-0000-4000-8000-00000000000b',
  '00000000-0000-4000-8000-0000000000b2',
  '20000000-0000-4000-8000-00000000000b',
  0,
  repeat('b', 64),
  1,
  1,
  'User B confidential financial data',
  repeat('2', 64),
  array_fill(0.05::real, array[1536])::vector
);

INSERT INTO public.user_file_jobs (file_id, user_id, status, step)
VALUES (
  '20000000-0000-4000-8000-00000000000b',
  '00000000-0000-4000-8000-0000000000b2',
  'completed',
  'commit'
);

INSERT INTO storage.objects (bucket_id, name, owner)
VALUES (
  'user-files',
  '00000000-0000-4000-8000-0000000000b2/20000000-0000-4000-8000-00000000000b/Secret_B.pdf',
  '00000000-0000-4000-8000-0000000000b2'
);

-- User B verifies own resources are visible
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.user_folders WHERE id = '10000000-0000-4000-8000-00000000000b'), 'User B sees own folder');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.user_files WHERE id = '20000000-0000-4000-8000-00000000000b'), 'User B sees own file');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.user_file_chunks WHERE file_id = '20000000-0000-4000-8000-00000000000b'), 'User B sees own chunks');

-- Switch to User A
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
SET LOCAL request.jwt.claim.role = 'authenticated';

-- T-1.1: User A cannot SELECT User B's records
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.user_folders WHERE id = '10000000-0000-4000-8000-00000000000b'), 'User A cannot SELECT User B folder');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.user_files WHERE id = '20000000-0000-4000-8000-00000000000b'), 'User A cannot SELECT User B file');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.user_file_chunks WHERE file_id = '20000000-0000-4000-8000-00000000000b'), 'User A cannot SELECT User B chunks');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.user_file_jobs WHERE file_id = '20000000-0000-4000-8000-00000000000b'), 'User A cannot SELECT User B jobs');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM storage.objects WHERE bucket_id = 'user-files' AND name LIKE '00000000-0000-4000-8000-0000000000b2/%'), 'User A cannot SELECT User B storage objects');

-- T-1.2: User A cannot INSERT records belonging to User B (RLS WITH CHECK violation 42501)
SELECT pg_temp.rejected(
  $q$INSERT INTO public.user_folders (user_id, name, path, depth)
     VALUES ('00000000-0000-4000-8000-0000000000b2', 'Forged_Folder', '/Forged_Folder', 0)$q$,
  '42501',
  'User A cannot INSERT folder for User B'
);

SELECT pg_temp.rejected(
  $q$INSERT INTO public.user_files (user_id, name, storage_path, mime_type, size_bytes)
     VALUES ('00000000-0000-4000-8000-0000000000b2', 'Forged.pdf', '00000000-0000-4000-8000-0000000000b2/x/Forged.pdf', 'application/pdf', 100)$q$,
  '42501',
  'User A cannot INSERT file for User B'
);

SELECT pg_temp.rejected(
  $q$INSERT INTO public.user_file_chunks (user_id, file_id, chunk_index, chunk_hash, page_start, page_end, content, text_hash, embedding)
     VALUES ('00000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-00000000000b', 1, repeat('f', 64), 1, 1, 'Injected', repeat('3', 64), array_fill(0.01::real, array[1536])::vector)$q$,
  '42501',
  'User A cannot INSERT chunk for User B'
);

SELECT pg_temp.rejected(
  $q$INSERT INTO storage.objects (bucket_id, name, owner)
     VALUES ('user-files', '00000000-0000-4000-8000-0000000000b2/injected.pdf', '00000000-0000-4000-8000-0000000000a1')$q$,
  '42501',
  'User A cannot INSERT storage object into User B directory'
);

-- T-1.3: User A cannot UPDATE User B's records
DO $$
DECLARE touched int;
BEGIN
  UPDATE public.user_folders SET name = 'Hijacked_Folder' WHERE id = '10000000-0000-4000-8000-00000000000b';
  GET DIAGNOSTICS touched = ROW_COUNT;
  PERFORM pg_temp.assert_true(touched = 0, 'User A cannot UPDATE User B folder');

  UPDATE public.user_files SET name = 'Hijacked_File.pdf' WHERE id = '20000000-0000-4000-8000-00000000000b';
  GET DIAGNOSTICS touched = ROW_COUNT;
  PERFORM pg_temp.assert_true(touched = 0, 'User A cannot UPDATE User B file');

  UPDATE public.user_file_chunks SET content = 'Tampered' WHERE file_id = '20000000-0000-4000-8000-00000000000b';
  GET DIAGNOSTICS touched = ROW_COUNT;
  PERFORM pg_temp.assert_true(touched = 0, 'User A cannot UPDATE User B chunks');
END $$;

-- User A creates their own folder A
INSERT INTO public.user_folders (id, user_id, name, path, depth)
VALUES ('10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1', 'Folder_A', '/Folder_A', 0);

-- User A cannot reassign own folder to User B
SELECT pg_temp.rejected(
  $q$UPDATE public.user_folders SET user_id = '00000000-0000-4000-8000-0000000000b2'
     WHERE id = '10000000-0000-4000-8000-00000000000a'$q$,
  '42501',
  'User A cannot reassign folder ownership to User B'
);

-- T-1.4: User A cannot DELETE User B's records
DO $$
DECLARE touched int;
BEGIN
  DELETE FROM public.user_folders WHERE id = '10000000-0000-4000-8000-00000000000b';
  GET DIAGNOSTICS touched = ROW_COUNT;
  PERFORM pg_temp.assert_true(touched = 0, 'User A cannot DELETE User B folder');

  DELETE FROM public.user_files WHERE id = '20000000-0000-4000-8000-00000000000b';
  GET DIAGNOSTICS touched = ROW_COUNT;
  PERFORM pg_temp.assert_true(touched = 0, 'User A cannot DELETE User B file');
END $$;

-- T-1.5: Platform Admins CANNOT bypass private RLS
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000f9';
SET LOCAL request.jwt.claim.role = 'authenticated';

SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.user_folders WHERE user_id IN ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2')),
  'Platform admin cannot SELECT private user folders'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.user_files WHERE user_id IN ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2')),
  'Platform admin cannot SELECT private user files'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.user_file_chunks WHERE user_id IN ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2')),
  'Platform admin cannot SELECT private user file chunks'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM storage.objects WHERE bucket_id = 'user-files' AND (name LIKE '00000000-0000-4000-8000-0000000000a1/%' OR name LIKE '00000000-0000-4000-8000-0000000000b2/%')),
  'Platform admin cannot SELECT private user storage objects'
);

DO $$
DECLARE touched int;
BEGIN
  UPDATE public.user_folders SET name = 'Admin_Tamper' WHERE id = '10000000-0000-4000-8000-00000000000b';
  GET DIAGNOSTICS touched = ROW_COUNT;
  PERFORM pg_temp.assert_true(touched = 0, 'Platform admin cannot UPDATE private user folders');

  DELETE FROM public.user_files WHERE id = '20000000-0000-4000-8000-00000000000b';
  GET DIAGNOSTICS touched = ROW_COUNT;
  PERFORM pg_temp.assert_true(touched = 0, 'Platform admin cannot DELETE private user files');
END $$;

-- ---------------------------------------------------------------------------
-- T-2: Cross-Tenant Nesting Rejected
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
SET LOCAL request.jwt.claim.role = 'authenticated';

-- T-2.1: User A folder cannot nest under User B folder (composite FK 23503)
SELECT pg_temp.rejected(
  $q$INSERT INTO public.user_folders (id, user_id, parent_id, name, path, depth)
     VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000b', 'Illegal_Child', '/Folder_B/Illegal_Child', 1)$q$,
  '23503',
  'Composite FK user_folders_parent_owner_fk rejects nesting under User B folder'
);

-- T-2.2: User A folder UPDATE cannot reparent under User B folder (composite FK 23503)
SELECT pg_temp.rejected(
  $q$UPDATE public.user_folders SET parent_id = '10000000-0000-4000-8000-00000000000b'
     WHERE id = '10000000-0000-4000-8000-00000000000a'$q$,
  '23503',
  'Composite FK rejects updating parent_id to User B folder'
);

-- T-2.3: User A file cannot nest under User B folder (composite FK 23503)
SELECT pg_temp.rejected(
  $q$INSERT INTO public.user_files (id, user_id, folder_id, name, storage_path, mime_type, size_bytes)
     VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000b', 'Cross_File.pdf', '00000000-0000-4000-8000-0000000000a1/x/Cross_File.pdf', 'application/pdf', 1024)$q$,
  '23503',
  'Composite FK user_files_folder_owner_fk rejects file belonging to User B folder'
);

-- Create a valid file for User A
INSERT INTO public.user_files (id, user_id, folder_id, name, storage_path, mime_type, size_bytes, upload_status)
VALUES (
  '20000000-0000-4000-8000-00000000000a',
  '00000000-0000-4000-8000-0000000000a1',
  '10000000-0000-4000-8000-00000000000a',
  'File_A.pdf',
  '00000000-0000-4000-8000-0000000000a1/20000000-0000-4000-8000-00000000000a/File_A.pdf',
  'application/pdf',
  1024,
  'uploaded'
);

-- T-2.4: User A file UPDATE cannot reparent under User B folder (composite FK 23503)
SELECT pg_temp.rejected(
  $q$UPDATE public.user_files SET folder_id = '10000000-0000-4000-8000-00000000000b'
     WHERE id = '20000000-0000-4000-8000-00000000000a'$q$,
  '23503',
  'Composite FK rejects updating file folder_id to User B folder'
);

-- T-2.5: user_file_prepare_upload rejects parent folder owned by User B (P0002)
SELECT pg_temp.rejected(
  $q$SELECT public.user_file_prepare_upload('Injected.pdf', 1024, 'application/pdf', '10000000-0000-4000-8000-00000000000b')$q$,
  'P0002',
  'prepare_upload rejects parent folder owned by User B'
);

-- T-2.6: Storage path spoofing rejected by check constraint (23514)
SELECT pg_temp.rejected(
  $q$INSERT INTO public.user_files (id, user_id, folder_id, name, storage_path, mime_type, size_bytes)
     VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', 'Spoof_Path.pdf', '00000000-0000-4000-8000-0000000000b2/x/Spoof_Path.pdf', 'application/pdf', 1024)$q$,
  '23514',
  'user_files_storage_path_owner_chk rejects storage_path starting with another user UUID'
);

-- ---------------------------------------------------------------------------
-- T-3: Storage Quota & Advisory Lock Enforcement
-- ---------------------------------------------------------------------------

-- User A default quota is 500 MB (524,288,000 bytes)
SELECT pg_temp.assert_true(
  (SELECT public.user_storage_quota_bytes('00000000-0000-4000-8000-0000000000a1'::uuid) = 524288000),
  'User A default explorer quota is 500 MB (524288000 bytes)'
);

-- T-3.1: Reservation within quota succeeds
DO $$
DECLARE
  v_res jsonb;
  v_fid uuid;
BEGIN
  v_res := public.user_file_prepare_upload('Quota_Doc_1.pdf', 10485760, 'application/pdf', '10000000-0000-4000-8000-00000000000a');
  PERFORM pg_temp.assert_true((v_res->>'ok')::boolean = true, 'prepare_upload within quota returns ok');
  v_fid := (v_res->>'file_id')::uuid;

  -- Complete upload
  PERFORM public.user_file_complete_upload(v_fid, repeat('a', 64));
  PERFORM pg_temp.assert_true(
    (SELECT upload_status = 'uploaded' FROM public.user_files WHERE id = v_fid),
    'complete_upload marks file as uploaded'
  );
END $$;

-- T-3.2: Exceeding quota fails with error code 54000 (quota_exceeded)
-- Simulate existing usage near 500 MB by inserting 11 files of 50,000,000 bytes (550 MB total)
DO $$
DECLARE i int;
BEGIN
  FOR i IN 1..11 LOOP
    INSERT INTO public.user_files (
      id, user_id, folder_id, name, storage_path, mime_type, size_bytes, upload_status
    ) VALUES (
      gen_random_uuid(),
      '00000000-0000-4000-8000-0000000000a1',
      '10000000-0000-4000-8000-00000000000a',
      'Bulk_Fill_' || i || '.pdf',
      '00000000-0000-4000-8000-0000000000a1/' || gen_random_uuid() || '/Bulk_Fill_' || i || '.pdf',
      'application/pdf',
      50000000,
      'uploaded'
    );
  END LOOP;
END $$;

-- Current usage is now > 510 MB (> 524,288,000 bytes quota)
-- An upload reservation of 10 MB must fail with 54000
SELECT pg_temp.rejected(
  $q$SELECT public.user_file_prepare_upload('Over_Quota.pdf', 10485760, 'application/pdf')$q$,
  '54000',
  'prepare_upload exceeding quota fails with 54000 (quota_exceeded)'
);

-- T-3.3: Prove that files in Trash still count towards quota
-- Soft-delete one of the bulk fill files
DO $$
DECLARE v_target_id uuid;
BEGIN
  SELECT id INTO v_target_id FROM public.user_files
  WHERE user_id = '00000000-0000-4000-8000-0000000000a1' AND name = 'Bulk_Fill_1.pdf';

  UPDATE public.user_files SET deleted_at = now() WHERE id = v_target_id;
  PERFORM pg_temp.assert_true(
    (SELECT deleted_at IS NOT NULL FROM public.user_files WHERE id = v_target_id),
    'File Bulk_Fill_1 is in trash'
  );
END $$;

-- Even with file in trash, prepare_upload still fails with 54000 because trash counts
SELECT pg_temp.rejected(
  $q$SELECT public.user_file_prepare_upload('Over_Quota_After_Trash.pdf', 10485760, 'application/pdf')$q$,
  '54000',
  'Files in trash still count against quota (54000 raised)'
);

-- Clean up bulk files to keep test workspace manageable
DELETE FROM public.user_files
WHERE user_id = '00000000-0000-4000-8000-0000000000a1' AND name LIKE 'Bulk_Fill_%';

-- ---------------------------------------------------------------------------
-- T-4: Soft Delete & RAG Isolation
-- ---------------------------------------------------------------------------

-- Setup User A folder tree:
-- RootFolder
--   └── SubFolder
--         └── SubFile.pdf
--   └── RootFile.pdf
DO $$
DECLARE
  v_root_folder_id uuid := '11000000-0000-4000-8000-000000000001'::uuid;
  v_sub_folder_id  uuid := '11000000-0000-4000-8000-000000000002'::uuid;
  v_root_file_id   uuid := '21000000-0000-4000-8000-000000000001'::uuid;
  v_sub_file_id    uuid := '21000000-0000-4000-8000-000000000002'::uuid;
  v_vec vector(1536)    := array_fill(0.15::real, array[1536])::vector;
BEGIN
  INSERT INTO public.user_folders (id, user_id, parent_id, name, path, depth)
  VALUES (v_root_folder_id, '00000000-0000-4000-8000-0000000000a1', NULL, 'RootFolder', '/RootFolder', 0);

  INSERT INTO public.user_folders (id, user_id, parent_id, name, path, depth)
  VALUES (v_sub_folder_id, '00000000-0000-4000-8000-0000000000a1', v_root_folder_id, 'SubFolder', '/RootFolder/SubFolder', 1);

  INSERT INTO public.user_files (id, user_id, folder_id, name, storage_path, mime_type, size_bytes, upload_status, index_status, page_count, extract_hash)
  VALUES (v_root_file_id, '00000000-0000-4000-8000-0000000000a1', v_root_folder_id, 'RootFile.pdf', '00000000-0000-4000-8000-0000000000a1/' || v_root_file_id || '/RootFile.pdf', 'application/pdf', 2048, 'uploaded', 'indexed', 1, repeat('e', 64));

  INSERT INTO public.user_files (id, user_id, folder_id, name, storage_path, mime_type, size_bytes, upload_status, index_status, page_count, extract_hash)
  VALUES (v_sub_file_id, '00000000-0000-4000-8000-0000000000a1', v_sub_folder_id, 'SubFile.pdf', '00000000-0000-4000-8000-0000000000a1/' || v_sub_file_id || '/SubFile.pdf', 'application/pdf', 4096, 'uploaded', 'indexed', 1, repeat('f', 64));

  -- Insert chunks for both files
  INSERT INTO public.user_file_chunks (id, user_id, file_id, chunk_index, chunk_hash, page_start, page_end, content, text_hash, embedding)
  VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1', v_root_file_id, 0, repeat('1', 64), 1, 1, 'Contract clause section 1', repeat('a', 64), v_vec);

  INSERT INTO public.user_file_chunks (id, user_id, file_id, chunk_index, chunk_hash, page_start, page_end, content, text_hash, embedding)
  VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1', v_sub_file_id, 0, repeat('2', 64), 1, 1, 'Contract clause section 2', repeat('b', 64), v_vec);
END $$;

-- T-4.1: match_user_files retrieves active files
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 FROM public.match_user_files(array_fill(0.15::real, array[1536])::vector, 0.0, 10)),
  'User A match_user_files retrieves both active files'
);

-- T-4.2: Recursive soft delete via user_folder_soft_delete
DO $$
DECLARE
  v_del_res jsonb;
BEGIN
  v_del_res := public.user_folder_soft_delete('11000000-0000-4000-8000-000000000001'::uuid);
  PERFORM pg_temp.assert_true((v_del_res->>'ok')::boolean = true, 'user_folder_soft_delete returns ok');
  PERFORM pg_temp.assert_true((v_del_res->>'trashed_folders_count')::int = 2, 'user_folder_soft_delete trashed 2 folders');
  PERFORM pg_temp.assert_true((v_del_res->>'trashed_files_count')::int = 2, 'user_folder_soft_delete trashed 2 files');
END $$;

-- Verify all descendants have deleted_at IS NOT NULL
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 FROM public.user_folders WHERE id IN ('11000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002') AND deleted_at IS NOT NULL),
  'Both parent and child folders have deleted_at populated'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 FROM public.user_files WHERE id IN ('21000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002') AND deleted_at IS NOT NULL),
  'Both root and subfolder files have deleted_at populated'
);

SELECT pg_temp.assert_true(
  (SELECT deleted_by_folder_id = '11000000-0000-4000-8000-000000000001'::uuid FROM public.user_folders WHERE id = '11000000-0000-4000-8000-000000000002'),
  'Subfolder deleted_by_folder_id tracks parent folder deletion'
);

-- T-4.3: match_user_files strictly excludes trashed files
SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.match_user_files(array_fill(0.15::real, array[1536])::vector, 0.0, 10)),
  'match_user_files returns 0 results for soft-deleted files'
);

-- T-4.4: User B calling match_user_files cannot retrieve User A chunks under any circumstances
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b2';
SET LOCAL request.jwt.claim.role = 'authenticated';

SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.match_user_files(array_fill(0.15::real, array[1536])::vector, 0.0, 10) WHERE user_id = '00000000-0000-4000-8000-0000000000a1'),
  'User B match_user_files returns 0 matches for User A content'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.match_user_files(array_fill(0.15::real, array[1536])::vector, 0.0, 10, ARRAY['21000000-0000-4000-8000-000000000001'::uuid])),
  'User B cannot retrieve User A chunk even when providing User A file_id filter'
);

-- ---------------------------------------------------------------------------
-- T-5: Index Validity on Restore
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
SET LOCAL request.jwt.claim.role = 'authenticated';

-- T-5.1: Restore file when parent folder is still in trash (relocation to root)
DO $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.user_file_restore('21000000-0000-4000-8000-000000000002'::uuid);
  PERFORM pg_temp.assert_true((v_res->>'ok')::boolean = true, 'user_file_restore returns ok');
  PERFORM pg_temp.assert_true((v_res->>'relocated_to_root')::boolean = true, 'restoring file with trashed parent relocates to root');
  PERFORM pg_temp.assert_true((v_res->>'folder_id') IS NULL, 'restored file folder_id set to NULL (root)');
  PERFORM pg_temp.assert_true((v_res->'index_verification'->>'status') = 'indexed', 'index validity verification passed');
END $$;

-- Verify file record updated
SELECT pg_temp.assert_true(
  (SELECT deleted_at IS NULL AND deleted_by_folder_id IS NULL AND folder_id IS NULL AND index_status = 'indexed'
   FROM public.user_files WHERE id = '21000000-0000-4000-8000-000000000002'),
  'Restored file is active, at root, and marked indexed'
);

-- T-5.2: Index Validity Verification on Tampered / Missing Chunks
-- Move file back to trash
UPDATE public.user_files
SET deleted_at = now()
WHERE id = '21000000-0000-4000-8000-000000000002';

-- Tamper with file metadata: page_count = 5, but only 1 chunk exists in user_file_chunks
UPDATE public.user_files
SET page_count = 5
WHERE id = '21000000-0000-4000-8000-000000000002';

-- Restore file with mismatched chunk count
DO $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.user_file_restore('21000000-0000-4000-8000-000000000002'::uuid);
  PERFORM pg_temp.assert_true((v_res->>'ok')::boolean = true, 'user_file_restore succeeds in recovering file');
  PERFORM pg_temp.assert_true((v_res->'index_verification'->>'invalidated')::boolean = true, 'index_verification marks index invalidated');
  PERFORM pg_temp.assert_true((v_res->'index_verification'->>'reason') = 'chunk_count_mismatch', 'reason reported as chunk_count_mismatch');
END $$;

-- Verify index_status transitioned to not_indexed / indexing_failed and index_error recorded
SELECT pg_temp.assert_true(
  (SELECT index_status IN ('not_indexed', 'indexing_failed') AND index_status <> 'indexed' AND index_error LIKE '%chunk_count_mismatch%'
   FROM public.user_files WHERE id = '21000000-0000-4000-8000-000000000002'),
  'Tampered chunk count transitions index_status away from indexed and sets index_error'
);

-- T-5.3: Test zero chunks verification
UPDATE public.user_files SET index_status = 'indexed' WHERE id = '21000000-0000-4000-8000-000000000002';
DELETE FROM public.user_file_chunks
WHERE file_id = '21000000-0000-4000-8000-000000000002';

DO $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.user_file_verify_index_validity('21000000-0000-4000-8000-000000000002'::uuid);
  PERFORM pg_temp.assert_true((v_res->>'invalidated')::boolean = true, 'zero chunks causes invalidation');
  PERFORM pg_temp.assert_true((v_res->>'reason') = 'zero_chunks_found', 'reason reported as zero_chunks_found');
END $$;

-- ---------------------------------------------------------------------------
-- T-6: Empty Trash / Permanent Purge
-- ---------------------------------------------------------------------------

-- Seed User B trash records as User B
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b2';
SET LOCAL request.jwt.claim.role = 'authenticated';

INSERT INTO public.user_folders (id, user_id, name, path, depth, deleted_at)
VALUES ('12000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000b2', 'Trash_Folder_B', '/Trash_Folder_B', 0, now());

INSERT INTO public.user_files (id, user_id, folder_id, name, storage_path, mime_type, size_bytes, upload_status, deleted_at)
VALUES (
  '22000000-0000-4000-8000-00000000000b',
  '00000000-0000-4000-8000-0000000000b2',
  '12000000-0000-4000-8000-00000000000b',
  'Trash_File_B.pdf',
  '00000000-0000-4000-8000-0000000000b2/22000000-0000-4000-8000-00000000000b/Trash_File_B.pdf',
  'application/pdf',
  5000000,
  'uploaded',
  now()
);

INSERT INTO public.user_file_chunks (id, user_id, file_id, chunk_index, chunk_hash, page_start, page_end, content, text_hash, embedding)
VALUES (
  '32000000-0000-4000-8000-00000000000b',
  '00000000-0000-4000-8000-0000000000b2',
  '22000000-0000-4000-8000-00000000000b',
  0,
  repeat('c', 64),
  1,
  1,
  'User B Trashed Content',
  repeat('4', 64),
  array_fill(0.01::real, array[1536])::vector
);

INSERT INTO public.user_file_jobs (file_id, user_id, status, step)
VALUES ('22000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000b2', 'completed', 'commit');

-- Switch to User A
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
SET LOCAL request.jwt.claim.role = 'authenticated';

-- Ensure User A has known active file, trashed files, trashed folders, chunks and jobs
-- Trashed file 1
INSERT INTO public.user_files (id, user_id, folder_id, name, storage_path, mime_type, size_bytes, upload_status, deleted_at)
VALUES (
  '23000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-0000000000a1',
  '11000000-0000-4000-8000-000000000001',
  'Purge_Me_1.pdf',
  '00000000-0000-4000-8000-0000000000a1/23000000-0000-4000-8000-000000000001/Purge_Me_1.pdf',
  'application/pdf',
  2000000,
  'uploaded',
  now()
);

-- Trashed file 2
INSERT INTO public.user_files (id, user_id, folder_id, name, storage_path, mime_type, size_bytes, upload_status, deleted_at)
VALUES (
  '23000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-0000000000a1',
  '11000000-0000-4000-8000-000000000001',
  'Purge_Me_2.pdf',
  '00000000-0000-4000-8000-0000000000a1/23000000-0000-4000-8000-000000000002/Purge_Me_2.pdf',
  'application/pdf',
  3000000,
  'uploaded',
  now()
);

-- Add chunks and jobs for Purge_Me_1
INSERT INTO public.user_file_chunks (id, user_id, file_id, chunk_index, chunk_hash, page_start, page_end, content, text_hash, embedding)
VALUES (
  '33000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-0000000000a1',
  '23000000-0000-4000-8000-000000000001',
  0,
  repeat('d', 64),
  1,
  1,
  'To be permanently purged chunk',
  repeat('5', 64),
  array_fill(0.01::real, array[1536])::vector
);

INSERT INTO public.user_file_jobs (file_id, user_id, status, step)
VALUES ('23000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'completed', 'commit');

-- Measure User A storage usage before empty trash
DO $$
DECLARE
  v_bytes_before bigint;
  v_empty_res jsonb;
  v_bytes_after bigint;
  v_reclaimed bigint;
BEGIN
  SELECT COALESCE(SUM(size_bytes), 0) INTO v_bytes_before
  FROM public.user_files WHERE user_id = '00000000-0000-4000-8000-0000000000a1';

  -- T-6.1: Execute empty trash
  v_empty_res := public.user_files_empty_trash();
  PERFORM pg_temp.assert_true((v_empty_res->>'ok')::boolean = true, 'user_files_empty_trash returns ok');
  PERFORM pg_temp.assert_true((v_empty_res->>'purged_files')::int >= 2, 'user_files_empty_trash purged trashed files');
  PERFORM pg_temp.assert_true((v_empty_res->>'purged_folders')::int >= 1, 'user_files_empty_trash purged trashed folders');

  v_reclaimed := (v_empty_res->>'reclaimed_bytes')::bigint;
  PERFORM pg_temp.assert_true(v_reclaimed >= 5000000, 'reclaimed_bytes reflects purged file sizes');

  -- T-6.2: Storage quota is immediately freed up
  SELECT COALESCE(SUM(size_bytes), 0) INTO v_bytes_after
  FROM public.user_files WHERE user_id = '00000000-0000-4000-8000-0000000000a1';

  PERFORM pg_temp.assert_true(
    v_bytes_after = v_bytes_before - v_reclaimed,
    'Storage quota usage decremented exactly by reclaimed_bytes'
  );
END $$;

-- T-6.3: Verify cascade deletion in DB for User A
SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.user_files WHERE id IN ('23000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000002')),
  'User A trashed files are permanently deleted'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.user_file_chunks WHERE file_id = '23000000-0000-4000-8000-000000000001'),
  'user_file_chunks cascaded on file deletion'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.user_file_jobs WHERE file_id = '23000000-0000-4000-8000-000000000001'),
  'user_file_jobs cascaded on file deletion'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.user_folders WHERE id = '11000000-0000-4000-8000-000000000001'),
  'User A trashed folder is permanently deleted'
);

-- Active files of User A remain intact
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.user_files WHERE id = '21000000-0000-4000-8000-000000000002' AND deleted_at IS NULL),
  'Active file of User A remains untouched after empty trash'
);

-- T-6.4: User B's trashed records remain completely untouched
RESET ROLE;
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.user_files WHERE id = '22000000-0000-4000-8000-00000000000b' AND deleted_at IS NOT NULL),
  'User B trashed file remains completely untouched'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.user_folders WHERE id = '12000000-0000-4000-8000-00000000000b' AND deleted_at IS NOT NULL),
  'User B trashed folder remains completely untouched'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.user_file_chunks WHERE file_id = '22000000-0000-4000-8000-00000000000b'),
  'User B trashed chunks remain intact'
);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.user_file_jobs WHERE file_id = '22000000-0000-4000-8000-00000000000b'),
  'User B trashed jobs remain intact'
);

-- ---------------------------------------------------------------------------
-- 7. Rollback Transaction
-- ---------------------------------------------------------------------------

ROLLBACK;
