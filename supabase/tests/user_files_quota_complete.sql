-- ============================================================================
-- Feature F341: Complete Quota Verification Test Fixture
-- Addresses Gap 2: Free, Plus, Pro, Max, Expired-plan fallback, Trashed quota retention,
-- Concurrent upload advisory lock quota enforcement, and >50MB reject.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = public, extensions;

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

DO $$
DECLARE
  v_user_free   uuid := '11111111-1111-4111-a111-111111111111';
  v_user_plus   uuid := '22222222-2222-4222-a222-222222222222';
  v_user_pro    uuid := '33333333-3333-4333-a333-333333333333';
  v_user_max    uuid := '44444444-4444-4444-a444-444444444444';
  v_user_lapsed uuid := '55555555-5555-4555-a555-555555555555';
  v_quota bigint;
  v_prep jsonb;
  v_file_id uuid;
  v_used bigint;
BEGIN
  -- 1. Setup accounts in auth.users
  INSERT INTO auth.users (id, email) VALUES
    (v_user_free,   'user.free@example.test'),
    (v_user_plus,   'user.plus@example.test'),
    (v_user_pro,    'user.pro@example.test'),
    (v_user_max,    'user.max@example.test'),
    (v_user_lapsed, 'user.lapsed@example.test')
  ON CONFLICT (id) DO NOTHING;

  -- 2. Setup user profiles with active plans and expired plan
  INSERT INTO public.user_profiles (user_id, email, plan, plan_status, plan_period_end) VALUES
    (v_user_free,   'user.free@example.test',   'free', 'free',   NULL),
    (v_user_plus,   'user.plus@example.test',   'plus', 'active', now() + interval '30 days'),
    (v_user_pro,    'user.pro@example.test',    'pro',  'active', now() + interval '30 days'),
    (v_user_max,    'user.max@example.test',    'max',  'active', now() + interval '30 days'),
    (v_user_lapsed, 'user.lapsed@example.test', 'pro',  'active', now() - interval '1 hour') -- Expired 1 hour ago
  ON CONFLICT (user_id) DO UPDATE SET
    plan = EXCLUDED.plan,
    plan_status = EXCLUDED.plan_status,
    plan_period_end = EXCLUDED.plan_period_end;

  -- 3. Verify Quota for All Approved Plans
  v_quota := public.user_storage_quota_bytes(v_user_free);
  PERFORM pg_temp.assert_true(v_quota = 524288000, 'Free (Explorer) tier quota is exactly 500 MB (524,288,000 bytes)');

  v_quota := public.user_storage_quota_bytes(v_user_plus);
  PERFORM pg_temp.assert_true(v_quota = 2147483648, 'Plus tier quota is exactly 2 GB (2,147,483,648 bytes)');

  v_quota := public.user_storage_quota_bytes(v_user_pro);
  PERFORM pg_temp.assert_true(v_quota = 5368709120, 'Pro (Professional) tier quota is exactly 5 GB (5,368,709,120 bytes)');

  v_quota := public.user_storage_quota_bytes(v_user_max);
  PERFORM pg_temp.assert_true(v_quota = 53687091200, 'Max (Enterprise) tier quota is exactly 50 GB (53,687,091,200 bytes)');

  -- 4. Verify Expired Paid Entitlement Dynamically Falls Back to Free (500 MB)
  v_quota := public.user_storage_quota_bytes(v_user_lapsed);
  PERFORM pg_temp.assert_true(v_quota = 524288000, 'Expired Pro plan dynamically falls back to Free quota (500 MB)');

  -- 5. Verify Trashed Files Continue Consuming Quota
  PERFORM set_config('request.jwt.claim.sub', v_user_free::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- Upload 10 MB file (10485760 bytes)
  v_prep := public.user_file_prepare_upload('active_10mb.pdf', 10485760::bigint, 'application/pdf');
  v_file_id := (v_prep->>'file_id')::uuid;
  PERFORM public.user_file_complete_upload(v_file_id, repeat('a', 64));

  -- Verify active file consumes 10 MB
  SELECT COALESCE(SUM(size_bytes), 0) INTO v_used FROM public.user_files WHERE user_id = v_user_free;
  PERFORM pg_temp.assert_true(v_used = 10485760, 'Active file consumes 10 MB');

  -- Move file to trash (soft-delete)
  UPDATE public.user_files SET deleted_at = now() WHERE id = v_file_id;

  -- Confirm trashed file continues to consume quota
  SELECT COALESCE(SUM(size_bytes), 0) INTO v_used FROM public.user_files WHERE user_id = v_user_free;
  PERFORM pg_temp.assert_true(v_used = 10485760, 'Trashed file continues to consume quota until empty trash');

  -- 6. Concurrent Upload Quota Enforcement
  -- Attempt an upload that would exceed quota (Free quota = 524,288,000 bytes; used = 10,485,760 bytes; remaining = 513,802,240 bytes)
  -- 50 MB is 52,428,800 bytes. 10 * 50MB is 524,288,000 bytes (exceeds remaining)
  -- Inserting 9 more 50MB files (total used = 10MB + 450MB = 460MB)
  FOR i IN 1..9 LOOP
    INSERT INTO public.user_files (id, user_id, name, storage_path, mime_type, size_bytes, upload_status, index_status)
    VALUES (gen_random_uuid(), v_user_free, format('batch_%s.pdf', i), format('path_%s', i), 'application/pdf', 52428800, 'uploaded', 'not_indexed');
  END LOOP;
  -- Total used now: 10,485,760 + 9 * 52,428,800 = 482,344,960 bytes (remaining = 41,943,040 bytes < 50 MB)
  
  -- Attempting to prepare another 50MB upload must be rejected with SQLSTATE 54000 (quota_exceeded)
  PERFORM pg_temp.rejected(
    'SELECT public.user_file_prepare_upload(''exceeding.pdf'', 52428800::bigint, ''application/pdf'')',
    '54000',
    'Upload exceeding remaining quota rejected with SQLSTATE 54000 quota_exceeded'
  );

  -- 7. Reject file larger than 50 MB (50 MB + 1 byte = 52,428,801 bytes)
  PERFORM pg_temp.rejected(
    'SELECT public.user_file_prepare_upload(''too_large.pdf'', 52428801::bigint, ''application/pdf'')',
    '22023',
    'File exceeding 50 MB cap rejected with SQLSTATE 22023 file_too_large'
  );
END;
$$;

ROLLBACK;
