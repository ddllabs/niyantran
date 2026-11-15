-- ============================================================================
-- Feature F341: Phase 3 File Lifecycle Test Fixture
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', label;
  END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;

DO $$
DECLARE
  v_user_a uuid := '00000000-0000-4000-8000-0000000000a1';
  v_folder_id uuid := '10000000-0000-4000-8000-0000000000a1';
  v_file_id uuid;
  v_prep jsonb;
  v_restore jsonb;
  v_purge jsonb;
  v_used bigint;
BEGIN
  -- Ensure User A exists in auth.users and user_profiles
  INSERT INTO auth.users (id, email) VALUES (v_user_a, 'tenant.a@example.test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_profiles (user_id, email, plan) VALUES (v_user_a, 'tenant.a@example.test', 'explorer')
  ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan;

  -- Authenticate as User A
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- 1. User A creates folder 'Research'
  INSERT INTO public.user_folders (id, user_id, name, path, depth)
  VALUES (v_folder_id, v_user_a, 'Research', '/Research', 0);
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.user_folders WHERE id = v_folder_id AND name = 'Research'), 'Folder Research created');

  -- 2. User A uploads PDF inside folder
  v_prep := public.user_file_prepare_upload('Sample_Document.pdf', 1048576::bigint, 'application/pdf', v_folder_id);
  v_file_id := (v_prep->>'file_id')::uuid;
  PERFORM public.user_file_complete_upload(v_file_id, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.user_files WHERE id = v_file_id AND folder_id = v_folder_id), 'File uploaded in Research folder');

  -- Index file & add chunk
  UPDATE public.user_files SET index_status = 'indexed' WHERE id = v_file_id;
  INSERT INTO public.user_file_chunks (id, user_id, file_id, chunk_index, chunk_hash, page_start, page_end, content, text_hash, embedding)
  VALUES (gen_random_uuid(), v_user_a, v_file_id, 0, repeat('a', 64), 1, 1, 'Sample content about Indian regulatory filings', repeat('a', 64), (SELECT array_agg(0.01::real) FROM generate_series(1, 1536))::vector);
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.user_file_chunks WHERE file_id = v_file_id), 'File chunk created');

  -- 3. Rename file
  UPDATE public.user_files SET name = 'Renamed_Document.pdf', updated_at = now() WHERE id = v_file_id;
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.user_files WHERE id = v_file_id AND name = 'Renamed_Document.pdf'), 'File successfully renamed');

  -- 4. Trash the parent folder 'Research'
  PERFORM public.user_folder_soft_delete(v_folder_id);
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.user_folders WHERE id = v_folder_id AND deleted_at IS NOT NULL), 'Folder Research is in trash');
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.user_files WHERE id = v_file_id AND deleted_at IS NOT NULL), 'Contained file recursively marked in trash');

  -- 5. Restore file to root when parent folder is still trashed
  v_restore := public.user_file_restore(v_file_id);
  PERFORM pg_temp.assert_true((v_restore->>'ok')::boolean = true, 'File restoration RPC succeeded');
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.user_files WHERE id = v_file_id AND deleted_at IS NULL AND folder_id IS NULL), 'File restored to root because parent folder was trashed');

  -- Re-trash file for empty trash testing
  UPDATE public.user_files SET deleted_at = now() WHERE id = v_file_id;

  -- 6. User A empties trash
  v_purge := public.user_files_empty_trash();
  PERFORM pg_temp.assert_true((v_purge->>'ok')::boolean = true, 'Empty trash RPC executed');

  -- 7. Verify database cleanup
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.user_files WHERE id = v_file_id), 'Permanently deleted file purged from user_files');
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.user_file_chunks WHERE file_id = v_file_id), 'Permanently deleted file chunks cascaded from user_file_chunks');
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.user_folders WHERE id = v_folder_id), 'Permanently deleted folder purged from user_folders');

  -- Verify quota recalculation
  SELECT COALESCE(SUM(size_bytes), 0) INTO v_used FROM public.user_files WHERE user_id = v_user_a;
  PERFORM pg_temp.assert_true(v_used = 0, 'User A storage quota returned to 0 bytes after empty trash');
END;
$$;

ROLLBACK;
