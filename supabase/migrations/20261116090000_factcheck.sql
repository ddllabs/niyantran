-- Live TV fact-check: sessions, claims, and the credit functions (open-work F344, slice 1, task T3;
-- docs/specs/2026-11-15-live-tv-fact-check.md, docs/plans/2026-11-15-f344-live-tv-fact-check-slice-1.md).
--
-- A user buys a block of 5, 10 or 15 minutes. The block's credits are HELD at the start and CHARGED at the end for the
-- minutes used, through the existing credit ledger. Nothing in the existing credit functions changes.
--
--   * public.factcheck_sessions and public.factcheck_claims, row-level security on both. authenticated may read its own
--     rows and delete its own settled live sessions (claims go with them). service_role may read sessions and read, insert
--     and update claims; every write to a session goes through the functions below, so a leaked service key cannot
--     rewrite a charge.
--   * private.factcheck_hold_keys: each session's hold is a credit_holds row under a random key ('fc:' + uuid) that is
--     never returned to any caller. The research chat takes its turn_key from the client, so a guessable hold key would
--     let a chat turn release a fact-check hold early (settle_turn_credits sets settled_at on the key it is given).
--   * private.factcheck_rate: per-USER, per-action, per-calendar-minute call counts for factcheck_touch, and
--     private.factcheck_budget: per-session counts of accepted extract and check calls over the session's life.
--   * public.factcheck_start, factcheck_touch, factcheck_settle, factcheck_settle_expired (service_role only), and
--     private.factcheck_flag / private.factcheck_settle_locked.
--
-- The hold. reserve_turn_credits computes available = balance - the sum of credit_holds that are unsettled, unexpired
-- and not shadow-blocked. A fact-check hold is such a row, at the current inr_per_credit, expiring 30 minutes after the
-- block's end. credit_sweep visits only expired holds, so it cannot reach a running session's hold; if the cron job
-- stalled for more than 30 minutes the sweep would mark the hold swept with nothing charged (credit_charge_turn finds no
-- research turn for the key and returns zero) and the next settle would still charge, because settling never depends on
-- the hold's state. Settling sets settled_at and swept_at, so the hold stops counting and does not block the operations
-- that wait for unswept holds (the unused top-up review, the unit conversion).
--
-- The charge. minutes used = whole minutes, rounded up, between started_at and the earlier of now and
-- last_activity_at + 15 s; at least 1, at most minutes_bought. The ledger entry is a 'charge' with turn_key
-- 'factcheck:<session id>', drawn from the usable lots by private.credit_draw exactly as a chat charge is (earliest expiry
-- first, expired lots skipped, any shortfall becomes debt). The amount is converted from the hold's credit unit to the
-- current one if they differ. Idempotency comes from the session row (status under its lock), never from the ledger.
--
-- Lock order: the wallet row first (private.credit_refresh), then the session row. factcheck_touch never takes the
-- wallet lock. 'transcribe' locks the session row FOR UPDATE. 'extract' and 'check' read it without a lock, but their
-- budget insert (private.factcheck_budget references the session) takes a key-share lock on the session row until the
-- transaction ends. So an extract or check may wait for an in-flight settle or transcribe, and those may wait for it,
-- but it holds no other lock (the wallet, another session) that either needs: no cycle is possible. Within a touch
-- the order is always session row, then the session's budget row, then the user's rate row.
--
-- Flag. app_flags row 'livetv_factcheck' = {"enabled": true, "audience": "admin"|"all", "credits_per_minute": n}.
-- A missing row, a non-object, enabled other than JSON true, an audience other than the two, or a price that is not a
-- number above 0 and at most 5000 (rounded to 4 places) is OFF. The price is never taken from a request.
--
-- Limits of factcheck_touch. Per USER (all their sessions together) per calendar minute: transcribe 10 (pieces can be
-- as short as 8 s, and retries count), extract 6, check 20. Over the whole life of a session, with m the minutes a
-- settlement would charge now (minutes_used once settled; one private helper shared with settle), extract is accepted
-- at most 3m + 2 times and check at most 8m + 4 times, then 'budget'; a refused call counts nothing. While the flag is
-- off every action answers 'off' (settle and settle_expired are unaffected: a running session is still charged).
-- Price agreement: factcheck_start's optional last argument is the price the caller showed the user; if it differs from
-- the flag's, nothing is created and 'price_changed' returns the current price. 'extract' and 'check'
-- stay allowed until 120 seconds after the end of the CHARGE (the settled end, or for a running session the earlier of
-- the block's end and 15 seconds after the last accepted transcribe), so a session that does not transcribe cannot keep
-- using them while being charged one minute. factcheck_settle_expired also deletes rate rows over an hour old.
--
-- Cron: factcheck-settle-expired every 5 minutes, scheduled below only where pg_cron exists.
--
-- Down (manual; nothing else depends on these objects):
--   begin;
--   select cron.unschedule('factcheck-settle-expired');   -- where pg_cron exists
--   drop function public.factcheck_start(uuid, text, text, text, numeric, integer, boolean, numeric),
--     public.factcheck_touch(uuid, uuid, text), public.factcheck_settle(uuid, uuid), public.factcheck_settle_expired(),
--     private.factcheck_settle_locked(uuid, uuid), private.factcheck_charge_minutes(timestamptz, timestamptz, integer, timestamptz),
--     private.factcheck_flag();
--   drop table private.factcheck_budget, private.factcheck_rate, private.factcheck_hold_keys, public.factcheck_claims, public.factcheck_sessions;
--   commit;
--   -- Holds and ledger entries already made stay (credit_holds rows under 'fc:' keys are settled or swept).

BEGIN;

-- 1. Tables -----------------------------------------------------------------------------------------------------------
CREATE TABLE public.factcheck_sessions (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id           text          NOT NULL CHECK (char_length(video_id) BETWEEN 1 AND 32),
  channel_id         text          NOT NULL CHECK (char_length(channel_id) BETWEEN 1 AND 64),
  video_kind         text          NOT NULL CHECK (video_kind IN ('live', 'recorded')),
  start_position_s   numeric       CHECK (start_position_s BETWEEN 0 AND 10000000),
  minutes_bought     integer       NOT NULL CHECK (minutes_bought IN (5, 10, 15)),
  credits_per_minute numeric(14,4) NOT NULL CHECK (credits_per_minute > 0),
  credits_held       numeric(14,4) NOT NULL CHECK (credits_held > 0),
  credits_charged    numeric(14,4),
  minutes_used       integer,
  started_at         timestamptz   NOT NULL DEFAULT now(),
  last_activity_at   timestamptz   NOT NULL DEFAULT now(),
  ended_at           timestamptz,
  status             text          NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled')),
  CONSTRAINT factcheck_sessions_id_user UNIQUE (id, user_id),
  CONSTRAINT factcheck_sessions_activity CHECK (last_activity_at >= started_at),
  CONSTRAINT factcheck_sessions_settlement CHECK (
    (status = 'active' AND minutes_used IS NULL AND credits_charged IS NULL AND ended_at IS NULL)
    OR (status = 'settled' AND minutes_used BETWEEN 1 AND minutes_bought AND credits_charged > 0 AND ended_at IS NOT NULL))
);
CREATE INDEX factcheck_sessions_user_time ON public.factcheck_sessions (user_id, started_at DESC);
CREATE UNIQUE INDEX factcheck_sessions_one_active ON public.factcheck_sessions (user_id) WHERE status = 'active';

CREATE TABLE public.factcheck_claims (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL,
  user_id     uuid        NOT NULL,
  video_id    text        NOT NULL CHECK (char_length(video_id) BETWEEN 1 AND 32),
  video_kind  text        NOT NULL CHECK (video_kind IN ('live', 'recorded')),
  position_s  numeric     CHECK (position_s BETWEEN 0 AND 10000000),
  spoken_at   timestamptz NOT NULL,
  quote       text        NOT NULL CHECK (char_length(quote) BETWEEN 1 AND 300),
  claim_en    text        NOT NULL CHECK (char_length(claim_en) BETWEEN 1 AND 500),
  claimant    text        CHECK (char_length(claimant) <= 200),
  reported_by text        CHECK (char_length(reported_by) <= 200),
  kind        text        NOT NULL CHECK (kind IN ('claim', 'opinion', 'prediction', 'question')),
  status      text        NOT NULL CHECK (status IN ('pending', 'checked', 'needs_context', 'not_checkable', 'error')),
  verdict     text        CHECK (verdict IN ('supported', 'contradicted', 'partly_true', 'no_evidence', 'opinion')),
  reason      text        CHECK (char_length(reason) <= 400),
  sources     jsonb       NOT NULL DEFAULT '[]'::jsonb
              CHECK (CASE WHEN jsonb_typeof(sources) = 'array' THEN jsonb_array_length(sources) <= 8 ELSE false END),
  checked_at  timestamptz,
  supersedes  uuid        REFERENCES public.factcheck_claims(id) ON DELETE SET NULL,
  -- A claim belongs to a session of the same user; the session's cascade removes its claims.
  CONSTRAINT factcheck_claims_session_user FOREIGN KEY (session_id, user_id)
    REFERENCES public.factcheck_sessions (id, user_id) ON DELETE CASCADE
);
CREATE INDEX factcheck_claims_session_time ON public.factcheck_claims (session_id, spoken_at);
CREATE INDEX factcheck_claims_video_position ON public.factcheck_claims (video_id, position_s);
CREATE INDEX factcheck_claims_user ON public.factcheck_claims (user_id);
CREATE INDEX factcheck_claims_supersedes ON public.factcheck_claims (supersedes) WHERE supersedes IS NOT NULL;

CREATE TABLE private.factcheck_hold_keys (
  session_id uuid PRIMARY KEY REFERENCES public.factcheck_sessions(id) ON DELETE CASCADE,
  turn_key   text NOT NULL UNIQUE
);

CREATE TABLE private.factcheck_rate (
  user_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action  text        NOT NULL CHECK (action IN ('transcribe', 'extract', 'check')),
  minute  timestamptz NOT NULL,
  n       integer     NOT NULL CHECK (n > 0),
  PRIMARY KEY (user_id, action, minute)
);
CREATE INDEX factcheck_rate_minute ON private.factcheck_rate (minute);

CREATE TABLE private.factcheck_budget (
  session_id uuid    NOT NULL REFERENCES public.factcheck_sessions(id) ON DELETE CASCADE,
  action     text    NOT NULL CHECK (action IN ('extract', 'check')),
  n          integer NOT NULL CHECK (n >= 0),
  PRIMARY KEY (session_id, action)
);

-- 2. Privileges and row-level security --------------------------------------------------------------------------------
ALTER TABLE public.factcheck_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factcheck_claims   ENABLE ROW LEVEL SECURITY;

CREATE POLICY factcheck_sessions_select ON public.factcheck_sessions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY factcheck_sessions_delete ON public.factcheck_sessions FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND video_kind = 'live' AND status = 'settled');
CREATE POLICY factcheck_claims_select ON public.factcheck_claims FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Supabase's default privileges grant ALL on new tables to the API roles: reset them, then grant only what is needed.
REVOKE ALL ON public.factcheck_sessions, public.factcheck_claims FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON public.factcheck_sessions TO authenticated;
GRANT SELECT ON public.factcheck_claims TO authenticated;
GRANT SELECT ON public.factcheck_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.factcheck_claims TO service_role;
REVOKE ALL ON private.factcheck_hold_keys, private.factcheck_rate, private.factcheck_budget
  FROM PUBLIC, anon, authenticated, service_role;

-- 3. Private helpers --------------------------------------------------------------------------------------------------
-- The flag, or NULL when the feature is off for any reason. Never raises.
CREATE FUNCTION private.factcheck_flag() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  v jsonb;
  c numeric;
BEGIN
  SELECT f.value INTO v FROM public.app_flags f WHERE f.key = 'livetv_factcheck';
  IF v IS NULL OR jsonb_typeof(v) <> 'object' THEN
    RETURN NULL;
  END IF;
  IF (v -> 'enabled') IS DISTINCT FROM 'true'::jsonb THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(v -> 'audience') IS DISTINCT FROM 'string' OR (v ->> 'audience') NOT IN ('admin', 'all') THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(v -> 'credits_per_minute') IS DISTINCT FROM 'number' THEN
    RETURN NULL;
  END IF;
  c := (v ->> 'credits_per_minute')::numeric;
  IF c <= 0 OR c > 5000 THEN
    RETURN NULL;
  END IF;
  c := round(c, 4);
  IF c <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('audience', v ->> 'audience', 'cpm', c);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- The whole minutes a settlement charges: from started_at to the earliest of now, 15 s after the last activity and the
-- end of the block, rounded up, at least 1 and at most the minutes bought. Shared by settle and by the touch budget so
-- they cannot drift.
CREATE FUNCTION private.factcheck_charge_minutes(p_started timestamptz, p_last timestamptz, p_bought integer,
  p_now timestamptz) RETURNS integer
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT greatest(1, least(p_bought, ceil(extract(epoch FROM (
    least(p_now, p_last + interval '15 seconds', p_started + make_interval(mins => p_bought)) - p_started)) / 60)::integer));
$$;

-- Settles one session. The caller holds the wallet lock (private.credit_refresh).
CREATE FUNCTION private.factcheck_settle_locked(p_user uuid, p_session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  s public.credit_settings := private.credit_config();
  f public.factcheck_sessions;
  h public.credit_holds;
  v_key text;
  v_has_hold boolean;
  v_end timestamptz;
  v_min integer;
  v_amount numeric(14,4);
  v_ledger uuid;
  v_balance numeric;
BEGIN
  SELECT * INTO f FROM public.factcheck_sessions WHERE id = p_session AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF f.status = 'settled' THEN
    SELECT w.balance INTO v_balance FROM public.credit_wallets w WHERE w.user_id = p_user;
    RETURN jsonb_build_object('ok', true, 'repeated', true, 'minutes_used', f.minutes_used,
                              'credits_charged', f.credits_charged, 'balance', v_balance);
  END IF;

  v_end := least(now(), f.last_activity_at + interval '15 seconds');
  v_min := private.factcheck_charge_minutes(f.started_at, f.last_activity_at, f.minutes_bought, now());

  SELECT k.turn_key INTO v_key FROM private.factcheck_hold_keys k WHERE k.session_id = f.id;
  SELECT * INTO h FROM public.credit_holds x WHERE x.user_id = p_user AND x.turn_key = v_key FOR UPDATE;
  v_has_hold := FOUND;

  v_amount := round(v_min * f.credits_per_minute, 4);
  IF v_has_hold THEN
    -- The price was set in the unit the hold was made in; the ledger is in the current one. After a unit conversion
    -- credits_charged is therefore in the current unit and need not equal minutes_used * credits_per_minute.
    v_amount := private.credit_current_amount(v_amount, h.inr_per_credit);
  END IF;

  v_ledger := private.credit_entry(p_user, 'charge', -v_amount, NULL, 'factcheck:' || f.id, NULL,
                                   s.usd_to_inr, s.inr_per_credit, NULL, 'live tv fact-check');
  PERFORM private.credit_draw(p_user, v_amount, v_ledger, 'charge', now());

  IF v_has_hold THEN
    UPDATE public.credit_holds SET settled_at = coalesce(settled_at, now()), swept_at = coalesce(swept_at, now())
    WHERE user_id = p_user AND turn_key = v_key;
  END IF;
  UPDATE public.factcheck_sessions
  SET status = 'settled', minutes_used = v_min, credits_charged = v_amount, ended_at = v_end
  WHERE id = f.id;

  SELECT w.balance INTO v_balance FROM public.credit_wallets w WHERE w.user_id = p_user;
  RETURN jsonb_build_object('ok', true, 'repeated', false, 'minutes_used', v_min, 'credits_charged', v_amount,
                            'balance', v_balance);
END;
$$;

-- 4. Public functions (service_role only) -----------------------------------------------------------------------------
CREATE FUNCTION public.factcheck_start(p_user uuid, p_video_id text, p_channel_id text, p_video_kind text,
  p_start_position_s numeric, p_minutes integer, p_is_admin boolean, p_expected_cpm numeric DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  s public.credit_settings;
  fl jsonb;
  w public.credit_wallets;
  r record;
  v_cpm numeric(14,4);
  v_needed numeric(14,4);
  v_held numeric;
  v_available numeric;
  v_id uuid := gen_random_uuid();
  v_key text := 'fc:' || gen_random_uuid();
  v_ends timestamptz;
  v_active uuid;
BEGIN
  IF p_user IS NULL OR p_video_id IS NULL OR char_length(p_video_id) NOT BETWEEN 1 AND 32
     OR p_channel_id IS NULL OR char_length(p_channel_id) NOT BETWEEN 1 AND 64
     OR p_video_kind IS NULL OR p_video_kind NOT IN ('live', 'recorded')
     OR (p_start_position_s IS NOT NULL AND NOT (p_start_position_s BETWEEN 0 AND 10000000))
     OR (p_expected_cpm IS NOT NULL AND NOT (p_expected_cpm BETWEEN 0 AND 5000)) THEN
    RAISE EXCEPTION 'A user, a video, a channel and a video kind are required' USING ERRCODE = '22023';
  END IF;

  fl := private.factcheck_flag();
  IF fl IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'off');
  END IF;
  IF fl ->> 'audience' = 'admin' AND NOT coalesce(p_is_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  IF p_minutes IS NULL OR p_minutes NOT IN (5, 10, 15) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_minutes');
  END IF;
  v_cpm := (fl ->> 'cpm')::numeric;
  IF p_expected_cpm IS NOT NULL AND round(p_expected_cpm, 4) <> v_cpm THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'price_changed', 'credits_per_minute', v_cpm);
  END IF;
  v_needed := round(p_minutes * v_cpm, 4);

  s := private.credit_config();
  PERFORM private.credit_refresh(p_user, now());

  -- Sessions of this user that have run out (the block and its grace are over, or the tab went quiet) are settled first.
  FOR r IN
    SELECT x.id FROM public.factcheck_sessions x
    WHERE x.user_id = p_user AND x.status = 'active'
      AND (now() > x.started_at + make_interval(mins => x.minutes_bought) + interval '15 seconds'
           OR x.last_activity_at < now() - interval '3 minutes')
    ORDER BY x.started_at, x.id
  LOOP
    PERFORM private.factcheck_settle_locked(p_user, r.id);
  END LOOP;

  SELECT x.id INTO v_active FROM public.factcheck_sessions x WHERE x.user_id = p_user AND x.status = 'active';
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_active', 'session_id', v_active);
  END IF;

  SELECT * INTO w FROM public.credit_wallets WHERE user_id = p_user;
  SELECT coalesce(sum(private.credit_current_amount(x.credits, x.inr_per_credit)), 0) INTO v_held
  FROM public.credit_holds x WHERE x.user_id = p_user AND x.settled_at IS NULL
    AND x.expires_at > now() AND NOT x.shadow_blocked;
  v_available := w.balance - v_held;
  IF v_available < v_needed THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient', 'needed', v_needed, 'available', v_available);
  END IF;

  v_ends := now() + make_interval(mins => p_minutes);
  BEGIN
    INSERT INTO public.factcheck_sessions (id, user_id, video_id, channel_id, video_kind, start_position_s,
      minutes_bought, credits_per_minute, credits_held, started_at, last_activity_at)
    VALUES (v_id, p_user, p_video_id, p_channel_id, p_video_kind, p_start_position_s,
      p_minutes, v_cpm, v_needed, now(), now());
  EXCEPTION WHEN unique_violation THEN
    SELECT x.id INTO v_active FROM public.factcheck_sessions x WHERE x.user_id = p_user AND x.status = 'active';
    RETURN jsonb_build_object('ok', false, 'reason', 'already_active', 'session_id', v_active);
  END;
  INSERT INTO private.factcheck_hold_keys (session_id, turn_key) VALUES (v_id, v_key);
  INSERT INTO public.credit_holds (user_id, turn_key, credits, inr_per_credit, expires_at, shadow_blocked)
  VALUES (p_user, v_key, v_needed, s.inr_per_credit, v_ends + interval '30 minutes', false);

  RETURN jsonb_build_object('ok', true, 'session_id', v_id, 'credits_per_minute', v_cpm,
                            'credits_held', v_needed, 'ends_at', v_ends);
END;
$$;

-- Called for every piece of work. Answers 'off' while the flag is off. Counts the call against the user's per-minute
-- limit and, for extract and check, the session's budget (a refused call counts nothing), and, for 'transcribe',
-- keeps the session alive. 'extract' and 'check' stay allowed for 120 seconds after the end of the charge (verdicts
-- for the last sentences arrive after the block closes) and never move last_activity_at, so they never extend the charge.
CREATE FUNCTION public.factcheck_touch(p_user uuid, p_session uuid, p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  f public.factcheck_sessions;
  v_limit integer;
  v_n integer;
  v_m integer;
  v_budget integer;
  v_block_end timestamptz;
BEGIN
  IF p_user IS NULL OR p_session IS NULL OR p_action IS NULL OR p_action NOT IN ('transcribe', 'extract', 'check') THEN
    RAISE EXCEPTION 'A user, a session and an action (transcribe, extract or check) are required' USING ERRCODE = '22023';
  END IF;
  IF private.factcheck_flag() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'off');
  END IF;

  IF p_action = 'transcribe' THEN
    SELECT * INTO f FROM public.factcheck_sessions WHERE id = p_session AND user_id = p_user FOR UPDATE;
  ELSE
    SELECT * INTO f FROM public.factcheck_sessions WHERE id = p_session AND user_id = p_user;
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  v_block_end := f.started_at + make_interval(mins => f.minutes_bought);
  IF p_action = 'transcribe' THEN
    IF f.status <> 'active' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'settled');
    END IF;
    IF now() > v_block_end + interval '15 seconds' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'ended');
    END IF;
  ELSIF now() > coalesce(f.ended_at, least(v_block_end, f.last_activity_at + interval '15 seconds'))
                + interval '120 seconds' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ended');
  END IF;

  IF p_action <> 'transcribe' THEN
    -- The session's whole-life budget, tied to the minutes that are (or will be) charged. Counted first, and given
    -- back below if the user's per-minute limit refuses the call.
    v_m := CASE WHEN f.status = 'settled' THEN f.minutes_used
                ELSE private.factcheck_charge_minutes(f.started_at, f.last_activity_at, f.minutes_bought, now()) END;
    v_budget := CASE p_action WHEN 'extract' THEN 3 * v_m + 2 ELSE 8 * v_m + 4 END;
    v_n := NULL;
    INSERT INTO private.factcheck_budget AS b (session_id, action, n) VALUES (f.id, p_action, 1)
    ON CONFLICT (session_id, action) DO UPDATE SET n = b.n + 1 WHERE b.n < v_budget
    RETURNING b.n INTO v_n;
    IF v_n IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'budget');
    END IF;
  END IF;

  v_limit := CASE p_action WHEN 'transcribe' THEN 10 WHEN 'extract' THEN 6 ELSE 20 END;
  v_n := NULL;
  INSERT INTO private.factcheck_rate AS c (user_id, action, minute, n)
  VALUES (p_user, p_action, date_trunc('minute', now()), 1)
  ON CONFLICT (user_id, action, minute) DO UPDATE SET n = c.n + 1 WHERE c.n < v_limit
  RETURNING c.n INTO v_n;
  IF v_n IS NULL THEN
    IF p_action <> 'transcribe' THEN
      UPDATE private.factcheck_budget SET n = n - 1 WHERE session_id = f.id AND action = p_action;
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  IF p_action = 'transcribe' THEN
    UPDATE public.factcheck_sessions SET last_activity_at = now() WHERE id = f.id;
  END IF;
  RETURN jsonb_build_object('ok', true,
           'seconds_left', greatest(0, ceil(extract(epoch FROM (v_block_end - now()))))::integer);
END;
$$;

CREATE FUNCTION public.factcheck_settle(p_user uuid, p_session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
BEGIN
  IF p_user IS NULL OR p_session IS NULL THEN
    RAISE EXCEPTION 'A user and a session are required' USING ERRCODE = '22023';
  END IF;
  PERFORM private.credit_config();
  PERFORM private.credit_refresh(p_user, now());
  RETURN private.factcheck_settle_locked(p_user, p_session);
END;
$$;

-- Settles sessions whose block ended more than a minute ago, and sessions that have been quiet for over 3 minutes. The
-- charge rule is the same as for a stop. One session's failure (for example credit writes paused) does not stop the rest;
-- each failure is a WARNING and the run ends with one WARNING naming how many failed. Rate rows over an hour old are
-- deleted first.
CREATE FUNCTION public.factcheck_settle_expired() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  r record;
  v_res jsonb;
  v_done integer := 0;
  v_seen integer := 0;
  v_failed integer := 0;
BEGIN
  DELETE FROM private.factcheck_rate WHERE minute < now() - interval '1 hour';
  FOR r IN
    SELECT x.id, x.user_id FROM public.factcheck_sessions x
    WHERE x.status = 'active'
      AND (now() > x.started_at + make_interval(mins => x.minutes_bought + 1)
           OR x.last_activity_at < now() - interval '3 minutes')
    ORDER BY x.started_at, x.id
    LIMIT 50
  LOOP
    v_seen := v_seen + 1;
    BEGIN
      PERFORM private.credit_config();
      PERFORM private.credit_refresh(r.user_id, now());
      v_res := private.factcheck_settle_locked(r.user_id, r.id);
      IF v_res ->> 'ok' = 'true' AND v_res ->> 'repeated' = 'false' THEN
        v_done := v_done + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING 'factcheck_settle_expired: session % not settled (% %)', r.id, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  IF v_failed > 0 THEN
    RAISE WARNING 'factcheck_settle_expired: % of % sessions not settled', v_failed, v_seen;
  END IF;
  RETURN v_done;
END;
$$;

REVOKE ALL ON FUNCTION
  public.factcheck_start(uuid, text, text, text, numeric, integer, boolean, numeric),
  public.factcheck_touch(uuid, uuid, text),
  public.factcheck_settle(uuid, uuid),
  public.factcheck_settle_expired(),
  private.factcheck_flag(),
  private.factcheck_charge_minutes(timestamptz, timestamptz, integer, timestamptz),
  private.factcheck_settle_locked(uuid, uuid)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.factcheck_start(uuid, text, text, text, numeric, integer, boolean, numeric),
  public.factcheck_touch(uuid, uuid, text),
  public.factcheck_settle(uuid, uuid),
  public.factcheck_settle_expired()
TO service_role;

-- 5. Schedule ---------------------------------------------------------------------------------------------------------
-- Every 5 minutes, so a closed tab cannot leave a block uncharged or a hold standing. Idempotent: an existing job of
-- this name is replaced. Skipped where pg_cron is not installed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'factcheck-settle-expired';
    PERFORM cron.schedule('factcheck-settle-expired', '*/5 * * * *', 'select public.factcheck_settle_expired()');
  END IF;
END;
$$;

COMMIT;
