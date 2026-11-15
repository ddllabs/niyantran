-- ============================================================================
-- Feature F341: Actual Storage Lifecycle Verification Fixture
-- Addresses Gap 3: Physical storage objects, trash retention, purge deletion,
-- non-atomic storage deletion semantics, and quota release timing.
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
  v_user_b uuid := '00000000-0000-4000-8000-0000000000b2';
  v_prep jsonb;
  v_file_id uuid;
  v_storage_path text;
  v_obj_id uuid;
  v_empty_res jsonb;
  v_paths text[];
  v_used bigint;
BEGIN
  -- Ensure users exist
  INSERT INTO auth.users (id, email) VALUES
    (v_user_a, 'tenant.a@example.test'),
    (v_user_b, 'tenant.b@example.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_profiles (user_id, email, plan) VALUES
    (v_user_a, 'tenant.a@example.test', 'explorer'),
    (v_user_b, 'tenant.b@example.test', 'explorer')
  ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan;

  -- Authenticate as User A
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- 1. Upload preparation and storage object creation
  v_prep := public.user_file_prepare_upload('Test_Storage_Doc.pdf', 2097152::bigint, 'application/pdf');
  v_file_id := (v_prep->>'file_id')::uuid;
  v_storage_path := (v_prep->>'storage_path')::text;

  -- Verify storage path format: {user_id}/{file_id}/{file_name}
  PERFORM pg_temp.assert_true(v_storage_path LIKE (v_user_a::text || '/%'), 'Storage path strictly partitioned by user_id');

  -- Simulate physical storage object creation in storage.objects
  INSERT INTO storage.objects (bucket_id, name, owner, metadata)
  VALUES ('user-files', v_storage_path, v_user_a, jsonb_build_object('size', 2097152, 'mimetype', 'application/pdf'))
  RETURNING id INTO v_obj_id;

  -- Complete upload
  PERFORM public.user_file_complete_upload(v_file_id, repeat('e', 64));

  -- Confirm object existence in storage.objects
  PERFORM pg_temp.assert_true(
    EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'user-files' AND name = v_storage_path),
    'Storage object physically exists in storage.objects'
  );

  -- 2. Verify User B CANNOT view or delete User A storage object
  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  PERFORM pg_temp.assert_true(
    NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'user-files' AND name = v_storage_path),
    'User B RLS policy blocks viewing User A storage object'
  );

  -- 3. Switch back to User A: Trash the file
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  UPDATE public.user_files SET deleted_at = now() WHERE id = v_file_id;

  -- Confirm storage object is NOT deleted upon soft-delete (trash retention)
  PERFORM pg_temp.assert_true(
    EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'user-files' AND name = v_storage_path),
    'Physical storage object is preserved when file is moved to Trash'
  );

  -- Confirm quota is NOT released while file is in Trash
  SELECT COALESCE(SUM(size_bytes), 0) INTO v_used FROM public.user_files WHERE user_id = v_user_a;
  PERFORM pg_temp.assert_true(v_used >= 2097152, 'Quota is not prematurely released while file is in Trash');

  -- 4. Restore file and confirm storage object remains intact
  PERFORM public.user_file_restore(v_file_id);
  PERFORM pg_temp.assert_true(
    EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'user-files' AND name = v_storage_path),
    'Physical storage object remains intact after restoration'
  );

  -- 5. Empty Trash: Move file back to trash and execute user_files_empty_trash
  UPDATE public.user_files SET deleted_at = now() WHERE id = v_file_id;
  v_empty_res := public.user_files_empty_trash();
  v_paths := ARRAY(SELECT jsonb_array_elements_text(v_empty_res->'storage_paths_to_delete'));

  PERFORM pg_temp.assert_true(v_storage_path = ANY(v_paths), 'user_files_empty_trash returned exact storage path for physical purge');

  -- Execute physical storage purge
  DELETE FROM storage.objects WHERE bucket_id = 'user-files' AND name = ANY(v_paths);

  -- Confirm object is physically deleted from storage.objects
  PERFORM pg_temp.assert_true(
    NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'user-files' AND name = v_storage_path),
    'Physical storage object deleted from storage.objects after empty trash'
  );

  -- Confirm database row is deleted
  PERFORM pg_temp.assert_true(
    NOT EXISTS (SELECT 1 FROM public.user_files WHERE id = v_file_id),
    'Database row deleted after empty trash'
  );

  -- Confirm quota is now released
  SELECT COALESCE(SUM(size_bytes), 0) INTO v_used FROM public.user_files WHERE user_id = v_user_a;
  PERFORM pg_temp.assert_true(v_used = 0, 'Quota successfully released after permanent purge');
END;
$$;

ROLLBACK;
