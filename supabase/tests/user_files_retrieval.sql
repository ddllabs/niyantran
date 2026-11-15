-- ============================================================================
-- Feature F341: User Retrieval & Citation Isolation Test Fixture
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
  v_admin  uuid := '00000000-0000-4000-8000-0000000000f9';
  v_file_a uuid := '20000000-0000-4000-8000-0000000000a1';
  v_query_vec vector(1536);
  v_count int;
BEGIN
  -- Insert users
  INSERT INTO auth.users (id, email) VALUES
    (v_user_a, 'tenant.a@example.test'),
    (v_user_b, 'tenant.b@example.test'),
    (v_admin,  'admin@example.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_profiles (user_id, email, role, plan) VALUES
    (v_user_a, 'tenant.a@example.test', 'user', 'explorer'),
    (v_user_b, 'tenant.b@example.test', 'user', 'explorer'),
    (v_admin,  'admin@example.test',    'admin', 'enterprise')
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

  -- Create vector of 1536 dimensions
  SELECT array_agg(0.01::real)::vector INTO v_query_vec FROM generate_series(1, 1536);

  -- 1. Setup User A file and chunks as User A
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.user_files (id, user_id, name, storage_path, mime_type, size_bytes, upload_status, index_status)
  VALUES (v_file_a, v_user_a, 'UserA_Report.pdf', '00000000-0000-4000-8000-0000000000a1/UserA_Report.pdf', 'application/pdf', 1048576, 'uploaded', 'indexed');

  INSERT INTO public.user_file_chunks (id, user_id, file_id, chunk_index, chunk_hash, page_start, page_end, content, text_hash, embedding)
  VALUES (gen_random_uuid(), v_user_a, v_file_a, 0, repeat('a', 64), 1, 2, 'Confidential financial audit data for User A', repeat('a', 64), v_query_vec);

  -- 2. Verify User A can retrieve User A's private chunk
  SELECT COUNT(*) INTO v_count FROM public.match_user_files(v_query_vec, 0.1, 10);
  PERFORM pg_temp.assert_true(v_count = 1, 'User A retrieves their own indexed private chunk');

  -- 3. Switch to User B: Must return 0 chunks
  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  SELECT COUNT(*) INTO v_count FROM public.match_user_files(v_query_vec, 0.1, 10);
  PERFORM pg_temp.assert_true(v_count = 0, 'User B cannot retrieve User A private chunk (0 results)');

  -- 4. Switch to Admin: Must return 0 chunks (Platform admin does not bypass private-file RAG)
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SELECT COUNT(*) INTO v_count FROM public.match_user_files(v_query_vec, 0.1, 10);
  PERFORM pg_temp.assert_true(v_count = 0, 'Platform admin cannot bypass private file RAG (0 results)');

  -- 5. Switch back to User A and trash the file
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  UPDATE public.user_files SET deleted_at = now() WHERE id = v_file_a;

  -- Verify trashed file is excluded from vector search
  SELECT COUNT(*) INTO v_count FROM public.match_user_files(v_query_vec, 0.1, 10);
  PERFORM pg_temp.assert_true(v_count = 0, 'Trashed file is immediately excluded from match_user_files');

  -- 6. Restore file and verify it becomes retrievable again
  PERFORM public.user_file_restore(v_file_a);
  SELECT COUNT(*) INTO v_count FROM public.match_user_files(v_query_vec, 0.1, 10);
  PERFORM pg_temp.assert_true(v_count = 1, 'Restored file is retrievable again');
END;
$$;

ROLLBACK;
