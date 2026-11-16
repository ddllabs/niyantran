-- ============================================================================
-- Feature F341: Phase 4 Quota & Worker Reliability Test Fixture
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
  v_free_user uuid := '11111111-1111-4111-a111-111111111111';
  v_pro_user  uuid := '33333333-3333-4333-a333-333333333333';
  v_max_user  uuid := '44444444-4444-4444-a444-444444444444';
  v_quota bigint;
  v_prep jsonb;
  v_claimed RECORD;
  v_job_id bigint;
  v_file_id uuid;
BEGIN
  PERFORM set_config('search_path', 'public, extensions', true);
  -- Insert auth.users first
  INSERT INTO auth.users (id, email) VALUES
    (v_free_user, 'explorer@example.test'),
    (v_pro_user,  'pro@example.test'),
    (v_max_user,  'enterprise@example.test')
  ON CONFLICT (id) DO NOTHING;

  -- Set up user profiles with valid app_plan enum values (explorer, professional, enterprise)
  INSERT INTO public.user_profiles (user_id, plan, email)
  VALUES 
    (v_free_user, 'explorer', 'explorer@example.test'),
    (v_pro_user,  'professional', 'pro@example.test'),
    (v_max_user,  'enterprise', 'enterprise@example.test')
  ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan;

  -- 1. Quota Tiers Verification
  v_quota := public.user_storage_quota_bytes(v_free_user);
  PERFORM pg_temp.assert_true(v_quota = 524288000, 'Explorer (Free) tier has 500MB quota (524288000 bytes)');

  v_quota := public.user_storage_quota_bytes(v_pro_user);
  PERFORM pg_temp.assert_true(v_quota = 5368709120, 'Professional tier has 5GB quota (5368709120 bytes)');

  v_quota := public.user_storage_quota_bytes(v_max_user);
  PERFORM pg_temp.assert_true(v_quota = 53687091200, 'Enterprise tier has 50GB quota (53687091200 bytes)');

  -- 2. Max File Size (50 MB) Enforcement
  -- Switch session to v_free_user
  PERFORM set_config('request.jwt.claim.sub', v_free_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- 50MB (52428800 bytes) should succeed
  v_prep := public.user_file_prepare_upload('valid_50mb.pdf', 52428800::bigint, 'application/pdf');
  PERFORM pg_temp.assert_true((v_prep->>'ok')::boolean = true, 'Upload preparation for exactly 50MB succeeds');
  v_file_id := (v_prep->>'file_id')::uuid;

  -- Complete upload and queue indexing
  PERFORM public.user_file_complete_upload(v_file_id, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  
  INSERT INTO public.user_file_jobs (file_id, user_id, status, step)
  VALUES (v_file_id, v_free_user, 'queued', 'ocr')
  RETURNING id INTO v_job_id;
  
  UPDATE public.user_files SET index_status = 'indexing_queued' WHERE id = v_file_id;
  PERFORM pg_temp.assert_true(v_job_id IS NOT NULL, 'Indexing job created for file');

  -- 50MB + 1 byte should fail with 22023
  PERFORM pg_temp.rejected(
    format('SELECT public.user_file_prepare_upload(''too_large.pdf'', 52428801::bigint, ''application/pdf'')'),
    '22023',
    'Upload preparation for 50MB + 1 byte rejected with file_too_large 22023'
  );

  -- 3. Worker Leasing & Stale-Job Recovery
  -- Worker 1 claims the job
  SELECT * INTO v_claimed FROM public.user_file_claim('worker-alpha', 1);
  PERFORM pg_temp.assert_true(v_claimed.id IS NOT NULL, 'Worker Alpha claims queued job');
  PERFORM pg_temp.assert_true(v_claimed.id = v_job_id, 'Claimed job matches job_id');

  -- Simulate Worker 1 crashing / lease expiring: set lease_expires_at to past
  UPDATE public.user_file_jobs
  SET lease_expires_at = now() - interval '10 seconds'
  WHERE id = v_job_id;

  -- Worker 2 attempts to claim: should recover the stale running job
  SELECT * INTO v_claimed FROM public.user_file_claim('worker-beta', 1);
  PERFORM pg_temp.assert_true(v_claimed.id IS NOT NULL, 'Worker Beta recovers stale job');
  PERFORM pg_temp.assert_true(v_claimed.id = v_job_id, 'Worker Beta takes over same job');

  -- Worker 1 attempts to advance: should be fenced out (55P03)
  PERFORM pg_temp.rejected(
    format('SELECT public.user_file_advance(%s, %L, ''ocr'', ''running'')', v_job_id, 'worker-alpha'),
    '55P03',
    'Worker Alpha is fenced out after lease expiry and takeover'
  );

  -- Worker 2 completes the job successfully
  PERFORM public.user_file_advance(v_job_id, 'worker-beta', 'commit', 'completed');
  
  -- Verify file transitioned to indexed
  PERFORM pg_temp.assert_true(
    EXISTS (SELECT 1 FROM public.user_files WHERE id = v_file_id AND index_status = 'indexed'),
    'File index_status successfully updated to indexed upon job completion'
  );
END;
$$;

ROLLBACK;
