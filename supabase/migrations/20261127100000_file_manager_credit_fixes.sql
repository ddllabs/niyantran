-- File-manager credit functions: no double charge, and cancel only before the worker starts (F413).
-- Review: docs/research/2026-11-27-f413-file-manager-credit-review.md. Spec: docs/specs/2026-11-27-file-manager-credit-fixes.md.
--
-- The four functions below are F411's text (NTER's, 2026-11-26) with only the changes marked "F413" in them:
--   * One active job per file: a partial unique index on user_file_jobs (file_id) for queued and running jobs.
--     enqueue and retry turn a clash into their existing duplicate_job error (23505). Before this, two concurrent
--     enqueues for one file both passed the existence check and created two jobs and two holds (review, finding 1).
--   * Settle once per attempt: user_file_jobs.settled_attempt records the attempt_count a settlement was made for, and a
--     repeated settle for the same attempt returns already_settled and charges nothing. Before this, only a completed
--     job charged above 0 was protected, so a repeated settle of a failed job charged again (finding 2).
--   * The job row adds each attempt's charge to credits_settled_paise instead of overwriting it (finding 4).
--   * Retry re-arms the hold at the current rate and clears its sweep mark, as reserve_turn_credits does (finding 5).
--   * Cancel refuses a running job (job_running, P0001): a job the worker has claimed runs to the end and is billed,
--     the developer's design. A queued job is cancelled as before, its hold released, and nothing is charged. Before
--     this, cancelling a running job told the user its hold was released while the worker went on, charged in full
--     and set the job back to completed (finding 3).
-- Unchanged: signatures, SECURITY DEFINER, search_path, grants (CREATE OR REPLACE keeps them), the flag gate, the hold
-- estimate, the charge arithmetic, user_file_advance and user_file_claim. Not addressed here: a 30-minute hold can lapse
-- on a long job (finding 6, still open under F413) and the declared file size (F414).
-- A self-check at the end raises, and so undoes everything, if the index, the column, a marked change or a grant is
-- not as stated.
--
-- APPLY on NTER: by psql as postgres (or the route used for F410 and F412), with the history row inserted by hand
-- under 20261127100000 (rollback-runbook.md; never `supabase db push`, F283). user_file_jobs had no rows on 2026-11-27,
-- so the index builds at once. The file_indexing_billing flag stays off until this is applied.
--
-- DOWN (only to undo a fault this change caused): re-run the four CREATE OR REPLACE FUNCTION statements for these
-- functions in 20261126150000_file_manager_schema.sql, then
--   drop index if exists public.user_file_jobs_one_active_per_file;
--   alter table public.user_file_jobs drop column if exists settled_attempt;

begin;

alter table public.user_file_jobs add column if not exists settled_attempt integer;
comment on column public.user_file_jobs.settled_attempt is
  'F413: the attempt_count a credit settlement was made for; a repeated settlement for the same attempt charges nothing.';
create unique index if not exists user_file_jobs_one_active_per_file
  on public.user_file_jobs (file_id) where status in ('queued', 'running');

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

  -- Create job with authoritative hold amount. F413: the unique index user_file_jobs_one_active_per_file allows one
  -- queued or running job per file; a concurrent call that passed the check above stops here.
  BEGIN
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
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_job: an indexing job is already active for file %', p_file_id USING ERRCODE = '23505';
  END;

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

  -- F413: only a queued job can be cancelled. Once the worker has claimed it, it runs to the end and is billed.
  IF v_job.status = 'running' THEN
    RAISE EXCEPTION 'job_running: the job has started; a started job runs to the end and is billed' USING ERRCODE = 'P0001';
  END IF;
  IF v_job.status <> 'queued' THEN
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
      inr_per_credit = s.inr_per_credit,   -- F413: at the current rate, as reserve_turn_credits does
      expires_at = now() + interval '30 minutes',
      settled_at = NULL,
      swept_at = NULL,                     -- F413: armed again, so not yet swept
      shadow_blocked = false;

  -- Reset job state to queued. F413: refused if another job for the file is already active.
  BEGIN
  UPDATE public.user_file_jobs
  SET status = 'queued',
      step = 'ocr',
      error_message = NULL,
      updated_at = now()
  WHERE id = p_job_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_job: an indexing job is already active for file %', v_job.file_id USING ERRCODE = '23505';
  END;

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

  -- Guard against duplicate settlement. F413: each attempt is settled once; a repeated call for the same attempt
  -- (attempt_count unchanged since the last settlement) charges nothing.
  IF (v_job.settled_attempt IS NOT NULL AND v_job.settled_attempt = v_job.attempt_count)
     OR (v_job.status = 'completed' AND v_job.credits_settled_paise > 0) THEN
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
  SET credits_settled_paise = COALESCE(credits_settled_paise, 0) + v_charge_paise,   -- F413: every attempt's charge
      settled_attempt = attempt_count,
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

do $check$
declare
  v_enq regprocedure := 'public.user_file_enqueue_indexing(uuid)'::regprocedure;
  v_can regprocedure := 'public.user_file_job_cancel(bigint)'::regprocedure;
  v_ret regprocedure := 'public.user_file_job_retry(bigint)'::regprocedure;
  v_set regprocedure := 'public.user_file_settle_credits(bigint,bigint,text,integer,integer,numeric)'::regprocedure;
begin
  if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                 where c.oid = 'public.user_file_jobs_one_active_per_file'::regclass and i.indisunique
                   and i.indrelid = 'public.user_file_jobs'::regclass
                   and pg_get_expr(i.indpred, i.indrelid) ~ 'queued' and pg_get_expr(i.indpred, i.indrelid) ~ 'running') then
    raise exception 'F413 self-check: the one-active-job-per-file index is missing or not unique and partial';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.user_file_jobs'::regclass
                 and attname = 'settled_attempt' and not attisdropped) then
    raise exception 'F413 self-check: user_file_jobs.settled_attempt is missing';
  end if;
  if not ((select prosrc from pg_proc where oid = v_enq) ~ 'EXCEPTION WHEN unique_violation'
          and (select prosrc from pg_proc where oid = v_can) ~ 'job_running'
          and (select prosrc from pg_proc where oid = v_ret) ~ 'swept_at = NULL'
          and (select prosrc from pg_proc where oid = v_set) ~ 'settled_attempt = attempt_count') then
    raise exception 'F413 self-check: a function lacks its F413 change';
  end if;
  if not (has_function_privilege('authenticated', v_enq, 'execute') and has_function_privilege('authenticated', v_can, 'execute')
          and has_function_privilege('authenticated', v_ret, 'execute') and has_function_privilege('service_role', v_set, 'execute')
          and not has_function_privilege('authenticated', v_set, 'execute')
          and not has_function_privilege('anon', v_enq, 'execute') and not has_function_privilege('anon', v_set, 'execute')) then
    raise exception 'F413 self-check: a credit function''s grants changed';
  end if;
end
$check$;

commit;
