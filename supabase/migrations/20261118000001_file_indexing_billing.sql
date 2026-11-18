-- Migration: 20261118000001_file_indexing_billing.sql
-- Status: Proposed Additive Migration (STAGED LOCALLY FOR REVIEW)
-- Purpose: Integrates server-authoritative credit holds, wallet debits, and ledger accounting
--          for private file indexing without modifying existing chat turn billing or table schemas.

BEGIN;

-- 0. Clean up deprecated function signatures to avoid PostgREST overload ambiguity
DROP FUNCTION IF EXISTS public.user_file_settle_credits(bigint, bigint);
DROP FUNCTION IF EXISTS public.user_file_claim(text, int);

-- 1. Hardened Enqueue RPC with Atomic Pre-flight Credit Hold
CREATE OR REPLACE FUNCTION public.user_file_enqueue_indexing(p_file_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
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
$$;

-- 2. Hardened Server-Authoritative Settlement RPC (SERVICE_ROLE ONLY)
CREATE OR REPLACE FUNCTION public.user_file_settle_credits(
  p_job_id bigint,
  p_actual_cost_paise bigint,
  p_final_status text DEFAULT 'completed',
  p_ocr_pages int DEFAULT NULL,
  p_embed_tokens int DEFAULT NULL,
  p_actual_cost_usd numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
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
$$;

-- 3. Cancellation RPC (Releases Reserved Credits Safely)
CREATE OR REPLACE FUNCTION public.user_file_job_cancel(p_job_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
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
$$;

-- 4. Retry RPC with Balance Re-Verification
CREATE OR REPLACE FUNCTION public.user_file_job_retry(p_job_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
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
$$;

-- 5. Updated Claim RPC supporting configurable p_lease_seconds
CREATE OR REPLACE FUNCTION public.user_file_claim(
  p_worker_id text,
  p_limit int DEFAULT 1,
  p_lease_seconds int DEFAULT 300
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
$$;

-- 6. Strict Privilege Grants and Revocations
-- Worker-only queue, advance, and settlement functions MUST ONLY be accessible by background workers (service_role)
REVOKE ALL ON FUNCTION public.user_file_settle_credits(bigint, bigint, text, int, int, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_file_settle_credits(bigint, bigint, text, int, int, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.user_file_claim(text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_file_claim(text, int, int) TO service_role;

REVOKE ALL ON FUNCTION public.user_file_advance(bigint, text, text, text, text, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_file_advance(bigint, text, text, text, text, int, text) TO service_role;

-- User lifecycle functions (enqueue, cancel, retry) are for authenticated users & service_role
REVOKE ALL ON FUNCTION public.user_file_enqueue_indexing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_file_enqueue_indexing(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.user_file_job_cancel(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_file_job_cancel(bigint) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.user_file_job_retry(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_file_job_retry(bigint) TO authenticated, service_role;

COMMIT;
