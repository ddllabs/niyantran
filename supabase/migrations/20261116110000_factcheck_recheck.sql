-- Live TV fact-check: pay to check one verdict again (open-work F344, slice 3, single-verdict half;
-- docs/plans/2026-11-16-f344-recheck.md, task R1). Nothing existing is replaced: this migration adds a column, two private
-- tables, a private flag reader and two functions.
--
--   * public.factcheck_claims.recheck_credits (new, nullable, 0 < x <= 1000): the price a re-check row was begun at. It is
--     for display and audit only. The charge reads the price from private.factcheck_recheck_state, which only
--     factcheck_recheck_begin writes, so a service key that rewrites this column (service_role may update claims) cannot
--     change what is charged, and cannot make a row chargeable that was not begun: factcheck_recheck_charge refuses a row
--     with no state row.
--   * private.factcheck_recheck_state: one row per re-check row, made at begin (price, begun_at) and completed at charge
--     (the private ledger key 'fcr:<uuid>', the credits, the time). It is the idempotence record and the key store; the
--     key is never returned. Rows go with their claim (cascade), so deleting a session removes them; the ledger entry stays.
--   * private.factcheck_recheck_rate: re-checks begun per user per calendar minute (limit 6). The existing
--     private.factcheck_rate cannot hold the action 'recheck' (its CHECK lists three actions and an earlier migration is not
--     edited), so this is its own small table, cascading with the user.
--   * private.factcheck_recheck_flag(): on only when private.factcheck_flag() is on AND the flag row's recheck_credits is a
--     number above 0 and at most 1000 (rounded to 4 places). Never raises. private.factcheck_flag() is untouched.
--   * public.factcheck_recheck_begin(user, claim, is_admin, expected_credits): first collects the user's uncharged re-checks,
--     then checks, then inserts the new pending row; the new row is not charged and nothing is held.
--   * private.factcheck_recheck_charge_locked(user, claim): the charge itself, for a caller that holds the wallet lock.
--   * public.factcheck_recheck_collect(): charges the uncharged re-checks of every user (50 at a time, each in its own
--     sub-transaction, one WARNING with the count of failures); returns the number charged.
--   * public.factcheck_recheck_charge(user, claim): called once the new row holds a checked verdict; charges the price
--     stored at begin as a ledger 'charge' (note exactly 'live tv fact-check', key 'fcr:<uuid>'), drawn from the lots like
--     any charge (shortfall to debt); idempotent per claim under the claim's row lock.
--
-- Returns. begin: {ok:true, claim_id, recheck_credits} or {ok:false, reason} with reason one of off, not_allowed, not_found,
-- not_recheckable, price_changed (+ recheck_credits, the current price), insufficient (+ needed, available), rate_limited,
-- in_progress. charge: {ok:true, credits_charged, balance, repeated} or {ok:false, reason} with reason one of not_found,
-- not_chargeable. Neither returns a ledger key.
--
-- Which rows can be re-checked. The claim must be the user's and either status 'checked' (an original, or a successful
-- re-check: the newest successful row of a chain) or an ORIGINAL (supersedes null) with status 'error'. A re-check row that
-- ended in 'error' cannot itself be re-checked (not_recheckable): the caller re-checks the row it superseded. A claim is
-- 'not_recheckable' once a newer row that names it has status 'checked'; a newer row still 'pending' and younger than 90
-- seconds makes it 'in_progress'; newer rows in 'error', and pending ones older than 90 seconds (a re-check whose request
-- died), are ignored, so a failed attempt never blocks another. A re-check that ends in error is never charged.
--
-- Uncharged re-checks. The Edge Function calls factcheck_recheck_charge after saving a verdict and nothing retries it, so
-- (1) factcheck_recheck_begin, before anything else and under the wallet lock, charges every re-check row of the user that
-- is 'checked', has supersedes set, was begun here (has a private record) and is not charged yet, and (2)
-- public.factcheck_recheck_collect() does the same for every user and is scheduled every 5 minutes (factcheck-recheck-collect,
-- below, where pg_cron exists). Both use the same internal routine as the public charge, which is idempotent per claim.
-- factcheck_settle_expired, in an earlier migration, is not touched.
--
-- Lock order: the user's wallet row (private.credit_refresh), then the claim row. Begin and charge of one user are therefore
-- serialised; the per-minute count is read and written under that lock.
--
-- Down (manual): begin; select cron.unschedule('factcheck-recheck-collect');   -- where pg_cron exists
--   drop function public.factcheck_recheck_begin(uuid, uuid, boolean, numeric), public.factcheck_recheck_charge(uuid, uuid),
--   public.factcheck_recheck_collect(), private.factcheck_recheck_charge_locked(uuid, uuid), private.factcheck_recheck_flag();
--   drop table private.factcheck_recheck_rate, private.factcheck_recheck_state;
--   alter table public.factcheck_claims drop column recheck_credits; commit;
--   (Ledger entries already made stay.)

BEGIN;

ALTER TABLE public.factcheck_claims
  ADD COLUMN recheck_credits numeric(14,4) CHECK (recheck_credits > 0 AND recheck_credits <= 1000);

CREATE TABLE private.factcheck_recheck_state (
  claim_id        uuid          PRIMARY KEY REFERENCES public.factcheck_claims(id) ON DELETE CASCADE,
  price           numeric(14,4) NOT NULL CHECK (price > 0 AND price <= 1000),
  begun_at        timestamptz   NOT NULL DEFAULT now(),
  turn_key        text          UNIQUE,
  credits_charged numeric(14,4) CHECK (credits_charged > 0),
  charged_at      timestamptz,
  CONSTRAINT factcheck_recheck_state_charged CHECK ((turn_key IS NULL) = (credits_charged IS NULL)
                                                     AND (turn_key IS NULL) = (charged_at IS NULL))
);

CREATE TABLE private.factcheck_recheck_rate (
  user_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  minute  timestamptz NOT NULL,
  n       integer     NOT NULL CHECK (n > 0),
  PRIMARY KEY (user_id, minute)
);
CREATE INDEX factcheck_recheck_rate_minute ON private.factcheck_recheck_rate (minute);

REVOKE ALL ON private.factcheck_recheck_state, private.factcheck_recheck_rate
  FROM PUBLIC, anon, authenticated, service_role;

-- The re-check price and audience, or NULL when re-check is off for any reason. Never raises.
CREATE FUNCTION private.factcheck_recheck_flag() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  fl jsonb;
  v jsonb;
  c numeric;
BEGIN
  fl := private.factcheck_flag();
  IF fl IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT f.value INTO v FROM public.app_flags f WHERE f.key = 'livetv_factcheck';
  IF jsonb_typeof(v -> 'recheck_credits') IS DISTINCT FROM 'number' THEN
    RETURN NULL;
  END IF;
  c := (v ->> 'recheck_credits')::numeric;
  IF c <= 0 OR c > 1000 THEN
    RETURN NULL;
  END IF;
  c := round(c, 4);
  IF c <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('audience', fl ->> 'audience', 'price', c);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.factcheck_recheck_begin(p_user uuid, p_claim uuid, p_is_admin boolean, p_expected_credits numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  rf jsonb;
  v_price numeric(14,4);
  c public.factcheck_claims;
  w public.credit_wallets;
  v_held numeric;
  v_available numeric;
  v_n integer;
  v_new uuid := gen_random_uuid();
  uc record;
BEGIN
  IF p_user IS NULL OR p_claim IS NULL THEN
    RAISE EXCEPTION 'A user and a claim are required' USING ERRCODE = '22023';
  END IF;
  -- Before anything else, and whatever the flag says: the user's re-checks that hold a verdict and were never charged. The
  -- same lock order as a session settle: the wallet, then the claim rows.
  PERFORM private.credit_config();
  PERFORM private.credit_refresh(p_user, now());
  FOR uc IN
    SELECT x.id FROM public.factcheck_claims x JOIN private.factcheck_recheck_state s ON s.claim_id = x.id
    WHERE x.user_id = p_user AND x.status = 'checked' AND x.supersedes IS NOT NULL AND s.credits_charged IS NULL
    ORDER BY x.id
  LOOP
    PERFORM private.factcheck_recheck_charge_locked(p_user, uc.id);
  END LOOP;

  rf := private.factcheck_recheck_flag();
  IF rf IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'off');
  END IF;
  IF rf ->> 'audience' = 'admin' AND NOT coalesce(p_is_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  v_price := (rf ->> 'price')::numeric;

  SELECT * INTO c FROM public.factcheck_claims WHERE id = p_claim AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT (c.status = 'checked' OR (c.status = 'error' AND c.supersedes IS NULL))
     OR EXISTS (SELECT FROM public.factcheck_claims x WHERE x.supersedes = c.id AND x.status = 'checked') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_recheckable');
  END IF;
  IF p_expected_credits IS DISTINCT FROM v_price THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'price_changed', 'recheck_credits', v_price);
  END IF;

  -- Available as the research chat and factcheck_start count it: the balance less the holds that are live.
  SELECT * INTO w FROM public.credit_wallets WHERE user_id = p_user;
  SELECT coalesce(sum(private.credit_current_amount(x.credits, x.inr_per_credit)), 0) INTO v_held
  FROM public.credit_holds x WHERE x.user_id = p_user AND x.settled_at IS NULL
    AND x.expires_at > now() AND NOT x.shadow_blocked;
  v_available := w.balance - v_held;
  IF v_available < v_price THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient', 'needed', v_price, 'available', v_available);
  END IF;

  SELECT r.n INTO v_n FROM private.factcheck_recheck_rate r
  WHERE r.user_id = p_user AND r.minute = date_trunc('minute', now());
  IF coalesce(v_n, 0) >= 6 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  IF EXISTS (SELECT FROM public.factcheck_claims x JOIN private.factcheck_recheck_state s ON s.claim_id = x.id
             WHERE x.supersedes = c.id AND x.status = 'pending' AND s.begun_at > now() - interval '90 seconds') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'in_progress');
  END IF;

  INSERT INTO public.factcheck_claims (id, session_id, user_id, video_id, video_kind, position_s, spoken_at, quote, claim_en,
    claimant, reported_by, kind, status, supersedes, recheck_credits)
  VALUES (v_new, c.session_id, c.user_id, c.video_id, c.video_kind, c.position_s, c.spoken_at, c.quote, c.claim_en,
    c.claimant, c.reported_by, c.kind, 'pending', c.id, v_price);
  INSERT INTO private.factcheck_recheck_state (claim_id, price, begun_at) VALUES (v_new, v_price, now());
  INSERT INTO private.factcheck_recheck_rate (user_id, minute, n) VALUES (p_user, date_trunc('minute', now()), 1)
  ON CONFLICT (user_id, minute) DO UPDATE SET n = private.factcheck_recheck_rate.n + 1;
  DELETE FROM private.factcheck_recheck_rate WHERE user_id = p_user AND minute < now() - interval '1 hour';

  RETURN jsonb_build_object('ok', true, 'claim_id', v_new, 'recheck_credits', v_price);
END;
$$;

-- The charge, for a caller that holds the user's wallet lock. Idempotent per claim under the claim's row lock.
CREATE FUNCTION private.factcheck_recheck_charge_locked(p_user uuid, p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  s public.credit_settings := private.credit_config();
  c public.factcheck_claims;
  st private.factcheck_recheck_state;
  v_key text;
  v_ledger uuid;
  v_balance numeric;
BEGIN
  SELECT * INTO c FROM public.factcheck_claims WHERE id = p_claim AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  SELECT * INTO st FROM private.factcheck_recheck_state WHERE claim_id = c.id;
  SELECT w.balance INTO v_balance FROM public.credit_wallets w WHERE w.user_id = p_user;
  IF st.credits_charged IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'credits_charged', st.credits_charged, 'balance', v_balance, 'repeated', true);
  END IF;
  IF c.supersedes IS NULL OR c.status <> 'checked' OR st.claim_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_chargeable');
  END IF;

  v_key := 'fcr:' || gen_random_uuid();
  v_ledger := private.credit_entry(p_user, 'charge', -st.price, NULL, v_key, NULL, s.usd_to_inr, s.inr_per_credit, NULL,
                                   'live tv fact-check');
  PERFORM private.credit_draw(p_user, st.price, v_ledger, 'charge', now());
  UPDATE private.factcheck_recheck_state SET turn_key = v_key, credits_charged = st.price, charged_at = now()
  WHERE claim_id = c.id;
  SELECT w.balance INTO v_balance FROM public.credit_wallets w WHERE w.user_id = p_user;
  RETURN jsonb_build_object('ok', true, 'credits_charged', st.price, 'balance', v_balance, 'repeated', false);
END;
$$;

CREATE FUNCTION public.factcheck_recheck_charge(p_user uuid, p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
BEGIN
  IF p_user IS NULL OR p_claim IS NULL THEN
    RAISE EXCEPTION 'A user and a claim are required' USING ERRCODE = '22023';
  END IF;
  PERFORM private.credit_config();
  PERFORM private.credit_refresh(p_user, now());
  RETURN private.factcheck_recheck_charge_locked(p_user, p_claim);
END;
$$;

-- Charges the re-checks that hold a verdict and were never charged, for every user: the safety net for a charge call that
-- failed. 50 at a time; one failure does not stop the rest (each is its own sub-transaction, a WARNING each and one
-- summary WARNING with the count); returns the number charged.
CREATE FUNCTION public.factcheck_recheck_collect() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  r record;
  v_res jsonb;
  v_done integer := 0;
  v_seen integer := 0;
  v_failed integer := 0;
BEGIN
  FOR r IN
    SELECT x.id, x.user_id FROM public.factcheck_claims x JOIN private.factcheck_recheck_state s ON s.claim_id = x.id
    WHERE x.status = 'checked' AND x.supersedes IS NOT NULL AND s.credits_charged IS NULL
    ORDER BY s.begun_at, x.id
    LIMIT 50
  LOOP
    v_seen := v_seen + 1;
    BEGIN
      PERFORM private.credit_config();
      PERFORM private.credit_refresh(r.user_id, now());
      v_res := private.factcheck_recheck_charge_locked(r.user_id, r.id);
      IF v_res ->> 'ok' = 'true' AND v_res ->> 'repeated' = 'false' THEN
        v_done := v_done + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING 'factcheck_recheck_collect: claim % not charged (% %)', r.id, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  IF v_failed > 0 THEN
    RAISE WARNING 'factcheck_recheck_collect: % of % re-checks not charged', v_failed, v_seen;
  END IF;
  RETURN v_done;
END;
$$;

REVOKE ALL ON FUNCTION
  public.factcheck_recheck_begin(uuid, uuid, boolean, numeric),
  public.factcheck_recheck_charge(uuid, uuid),
  public.factcheck_recheck_collect(),
  private.factcheck_recheck_charge_locked(uuid, uuid),
  private.factcheck_recheck_flag()
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.factcheck_recheck_begin(uuid, uuid, boolean, numeric),
  public.factcheck_recheck_charge(uuid, uuid),
  public.factcheck_recheck_collect()
TO service_role;

-- Every 5 minutes; idempotent (an existing job of this name is replaced); skipped where pg_cron is not installed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'factcheck-recheck-collect';
    PERFORM cron.schedule('factcheck-recheck-collect', '*/5 * * * *', 'select public.factcheck_recheck_collect()');
  END IF;
END;
$$;

COMMIT;
