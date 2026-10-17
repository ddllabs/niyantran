-- One-paisa credit contract (F225). This migration is additive and does NOT
-- convert balances. The separate credit_paise_convert migration is the cutover.
-- Old ledger rows and their frozen charge rates are never updated.

CREATE TABLE private.credit_epoch (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  unit_version text NOT NULL CHECK (unit_version IN ('credit-ten-paise-v1', 'credit-paise-v2')),
  paused boolean NOT NULL DEFAULT false,
  cutover_at timestamptz
);
INSERT INTO private.credit_epoch (unit_version) VALUES ('credit-ten-paise-v1');
REVOKE ALL ON private.credit_epoch FROM PUBLIC, anon, authenticated, service_role;

-- These tables retain the interpretation of pre-cutover entries and the exact
-- old/new lot and wallet amounts. Account erasure still cascades.
CREATE TABLE private.credit_legacy_entries (
  ledger_id uuid PRIMARY KEY REFERENCES public.credit_ledger(id) ON DELETE CASCADE
);
CREATE TABLE private.credit_lot_conversions (
  old_lot_id uuid PRIMARY KEY REFERENCES public.credit_lots(id) ON DELETE CASCADE,
  new_lot_id uuid UNIQUE REFERENCES public.credit_lots(id) ON DELETE CASCADE,
  old_granted numeric(14,4) NOT NULL,
  old_remaining numeric(14,4) NOT NULL,
  CONSTRAINT credit_lot_conversion_shape CHECK (old_granted > 0 AND old_remaining >= 0
    AND ((old_remaining = 0) = (new_lot_id IS NULL)))
);
CREATE TABLE private.credit_wallet_conversions (
  user_id uuid PRIMARY KEY REFERENCES public.credit_wallets(user_id) ON DELETE CASCADE,
  old_balance numeric(14,4) NOT NULL,
  old_debt numeric(14,4) NOT NULL,
  new_balance numeric(14,4) NOT NULL,
  new_debt numeric(14,4) NOT NULL,
  CONSTRAINT credit_wallet_conversion_math CHECK (new_balance = old_balance * 10 AND new_debt = old_debt * 10)
);
REVOKE ALL ON private.credit_legacy_entries, private.credit_lot_conversions,
  private.credit_wallet_conversions FROM PUBLIC, anon, authenticated, service_role;

-- A hold keeps the unit in which it was made. Settled pre-cutover holds stay
-- historical; only a fresh reservation may replace its amount and rate.
ALTER TABLE public.credit_holds ADD COLUMN inr_per_credit numeric(10,4) NOT NULL DEFAULT 0.10;

-- Every credit writer enters through credit_config or credit_wallet. The SHARE
-- row lock is held to transaction end; conversion takes UPDATE on this row
-- before any wallet lock. Crucially, reserve/admin read config only AFTER it.
CREATE FUNCTION private.credit_write_gate() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC'
SET lock_timeout = '5s' AS $$
DECLARE v_paused boolean;
BEGIN
  SELECT paused INTO v_paused FROM private.credit_epoch WHERE id FOR SHARE;
  IF NOT FOUND OR v_paused THEN
    RAISE EXCEPTION 'Credit writes are paused' USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.credit_config() RETURNS public.credit_settings
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE s public.credit_settings;
BEGIN
  PERFORM private.credit_write_gate();
  SELECT * INTO s FROM public.credit_settings WHERE id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit settings are missing' USING ERRCODE = 'P0002';
  END IF;
  RETURN s;
END;
$$;

CREATE OR REPLACE FUNCTION private.credit_wallet(p_user uuid) RETURNS public.credit_wallets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE w public.credit_wallets;
BEGIN
  PERFORM private.credit_write_gate();
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'A user is required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.credit_wallets (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO w FROM public.credit_wallets WHERE user_id = p_user FOR UPDATE;
  RETURN w;
END;
$$;

-- Signed credit amount in the current unit. A charge is rounded once in its
-- original unit, so multiplying that result preserves its original economics.
CREATE FUNCTION private.credit_current_amount(p_credits numeric, p_rate numeric) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT round(p_credits * p_rate / s.inr_per_credit, 4)
  FROM public.credit_settings s WHERE s.id;
$$;

CREATE FUNCTION public.credit_unit() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT jsonb_build_object('unit_version', e.unit_version, 'inr_per_credit', s.inr_per_credit)
  FROM private.credit_epoch e CROSS JOIN public.credit_settings s WHERE e.id AND s.id;
$$;

-- A conversion debit is distinct from usage, natural expiry and admin removal.
ALTER TABLE public.credit_ledger DROP CONSTRAINT credit_ledger_kind_check;
ALTER TABLE public.credit_ledger ADD CONSTRAINT credit_ledger_kind_check
  CHECK (kind IN ('grant', 'charge', 'expiry', 'adjustment', 'redenomination'));
ALTER TABLE public.credit_ledger DROP CONSTRAINT credit_ledger_kind_shape;
ALTER TABLE public.credit_ledger ADD CONSTRAINT credit_ledger_kind_shape CHECK (CASE kind
  WHEN 'grant' THEN credits > 0 AND lot_id IS NOT NULL AND turn_key IS NULL
  WHEN 'charge' THEN credits <= 0 AND turn_key IS NOT NULL AND lot_id IS NULL AND request_id IS NULL
  WHEN 'expiry' THEN credits < 0 AND lot_id IS NOT NULL AND turn_key IS NULL AND request_id IS NULL
  WHEN 'adjustment' THEN credits <> 0 AND request_id IS NOT NULL AND created_by IS NOT NULL AND turn_key IS NULL
  WHEN 'redenomination' THEN credits < 0 AND turn_key IS NULL AND request_id IS NULL
    AND usd_to_inr IS NULL AND inr_per_credit IS NULL
  ELSE false END);

REVOKE ALL ON FUNCTION private.credit_write_gate(), private.credit_current_amount(numeric,numeric),
  public.credit_unit() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.credit_unit() TO authenticated, service_role;

-- Invoked only by the separately scheduled cutover migration. The epoch row
-- lock drains earlier writers and prevents later ones from reading old settings
-- until this transaction commits. The caller must pause new answer starts and
-- wait for all holds to be swept before applying that migration.
CREATE FUNCTION private.credit_convert_to_paise() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  v_epoch private.credit_epoch;
  v_now timestamptz;
  v_user record;
  v_lot record;
  v_new_lot uuid;
  v_wallets integer;
  v_lots integer;
  v_limit numeric := 9999999999.9999;
BEGIN
  SELECT * INTO v_epoch FROM private.credit_epoch WHERE id FOR UPDATE;
  IF NOT FOUND OR v_epoch.unit_version <> 'credit-ten-paise-v1' OR NOT v_epoch.paused THEN
    RAISE EXCEPTION 'Credit conversion requires the paused ten-paise epoch' USING ERRCODE = '55000';
  END IF;
  IF (SELECT inr_per_credit FROM public.credit_settings WHERE id) <> 0.10 THEN
    RAISE EXCEPTION 'Unexpected old credit rate' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT FROM private.credit_wallet_conversions)
     OR EXISTS (SELECT FROM private.credit_lot_conversions)
     OR EXISTS (SELECT FROM private.credit_legacy_entries) THEN
    RAISE EXCEPTION 'Credit conversion was already started' USING ERRCODE = '55000';
  END IF;

  -- The exclusive epoch lock keeps every other gated writer waiting. Let this
  -- transaction's own refresh calls through; rollback restores the old state.
  UPDATE private.credit_epoch SET paused = false WHERE id;
  v_now := clock_timestamp();
  IF EXISTS (SELECT FROM public.credit_holds h WHERE h.swept_at IS NULL AND h.expires_at > v_now)
     OR EXISTS (SELECT FROM public.research_turns t
                JOIN public.chat_messages m ON m.id = t.assistant_message_id
                WHERE m.status = 'running' AND m.execution_expires_at > v_now) THEN
    RAISE EXCEPTION 'Active credit holds or answers must drain before conversion' USING ERRCODE = '55000';
  END IF;

  -- Sweep the old epoch before its rate changes. Its own settlement guard is
  -- reached through credit_wallet and therefore shares this epoch lock.
  FOR v_user IN SELECT user_id FROM public.credit_wallets ORDER BY user_id LOOP
    PERFORM private.credit_refresh(v_user.user_id, v_now);
  END LOOP;
  IF EXISTS (SELECT FROM public.credit_holds h WHERE h.swept_at IS NULL)
     OR EXISTS (SELECT FROM public.credit_lots o WHERE o.closed_at IS NULL AND o.expires_at <= v_now) THEN
    RAISE EXCEPTION 'Unsettled holds or expired lots remain after old-rate refresh' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT FROM public.credit_wallets w
             WHERE w.balance <> coalesce((SELECT sum(e.credits) FROM public.credit_ledger e WHERE e.user_id = w.user_id), 0)
                OR w.balance <> coalesce((SELECT sum(o.remaining) FROM public.credit_lots o
                                         WHERE o.user_id = w.user_id AND o.closed_at IS NULL), 0) - w.debt) THEN
    RAISE EXCEPTION 'Old credit wallets do not reconcile' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT FROM public.credit_wallets w WHERE abs(w.balance * 10) > v_limit OR w.debt * 10 > v_limit)
     OR EXISTS (SELECT FROM public.credit_lots o WHERE o.closed_at IS NULL AND o.remaining * 10 > v_limit)
     OR (SELECT signup_credits * 10 > v_limit OR hold_credits * 10 > v_limit FROM public.credit_settings WHERE id)
     OR EXISTS (SELECT FROM public.credit_plan_allowances a WHERE a.monthly_credits * 10 > v_limit) THEN
    RAISE EXCEPTION 'Credit conversion exceeds numeric(14,4)' USING ERRCODE = '22003';
  END IF;

  INSERT INTO private.credit_legacy_entries (ledger_id) SELECT id FROM public.credit_ledger;
  INSERT INTO private.credit_wallet_conversions (user_id, old_balance, old_debt, new_balance, new_debt)
  SELECT user_id, balance, debt, balance * 10, debt * 10 FROM public.credit_wallets;
  GET DIAGNOSTICS v_wallets = ROW_COUNT;

  -- Bridge debt first. Otherwise a large positive lot could temporarily push
  -- its wallet above numeric(14,4) before the compensating debt debit lands.
  FOR v_user IN SELECT user_id, old_debt FROM private.credit_wallet_conversions WHERE old_debt > 0 ORDER BY user_id LOOP
    PERFORM private.credit_entry(v_user.user_id, 'redenomination', -9 * v_user.old_debt,
      NULL, NULL, NULL, NULL, NULL, NULL, 'ten-paise debt moved to one-paisa unit');
    UPDATE public.credit_wallets SET debt = v_user.old_debt * 10 WHERE user_id = v_user.user_id;
  END LOOP;

  FOR v_lot IN SELECT * FROM public.credit_lots WHERE closed_at IS NULL ORDER BY user_id, id LOOP
    v_new_lot := NULL;
    IF v_lot.remaining > 0 THEN
      UPDATE public.credit_lots SET remaining = 0, closed_at = v_now WHERE id = v_lot.id;
      PERFORM private.credit_entry(v_lot.user_id, 'redenomination', -v_lot.remaining,
        v_lot.id, NULL, NULL, NULL, NULL, NULL, 'ten-paise lot moved to one-paisa unit');
      v_new_lot := private.credit_mint(v_lot.user_id, v_lot.kind, v_lot.remaining * 10,
        v_lot.starts_at, v_lot.expires_at, 'redenom:v2:' || v_lot.id::text, v_lot.plan,
        'grant', NULL, v_lot.created_by, 'redenominated from lot ' || v_lot.id::text);
      IF v_new_lot IS NULL THEN
        RAISE EXCEPTION 'Duplicate conversion lot for %', v_lot.id USING ERRCODE = '23505';
      END IF;
    END IF;
    INSERT INTO private.credit_lot_conversions (old_lot_id, new_lot_id, old_granted, old_remaining)
    VALUES (v_lot.id, v_new_lot, v_lot.granted, v_lot.remaining);
  END LOOP;

  UPDATE public.credit_settings SET inr_per_credit = 0.01, signup_credits = signup_credits * 10,
    hold_credits = hold_credits * 10, updated_at = v_now WHERE id;
  ALTER TABLE public.credit_holds ALTER COLUMN inr_per_credit SET DEFAULT 0.01;
  UPDATE public.credit_plan_allowances SET monthly_credits = monthly_credits * 10;
  UPDATE private.credit_epoch SET unit_version = 'credit-paise-v2', cutover_at = v_now WHERE id;

  IF EXISTS (SELECT FROM private.credit_wallet_conversions c JOIN public.credit_wallets w USING (user_id)
             WHERE w.balance <> c.new_balance OR w.debt <> c.new_debt)
     OR EXISTS (SELECT FROM public.credit_wallets w
                 WHERE w.balance <> coalesce((SELECT sum(e.credits) FROM public.credit_ledger e WHERE e.user_id = w.user_id), 0)
                    OR w.balance <> coalesce((SELECT sum(o.remaining) FROM public.credit_lots o
                                             WHERE o.user_id = w.user_id AND o.closed_at IS NULL), 0) - w.debt)
     OR EXISTS (SELECT FROM public.credit_lots o WHERE o.granted - o.remaining <>
                coalesce((SELECT sum(d.credits) FROM public.credit_lot_draws d WHERE d.lot_id = o.id), 0)
                - coalesce((SELECT sum(e.credits) FROM public.credit_ledger e
                            WHERE e.lot_id = o.id AND e.kind IN ('expiry', 'redenomination')), 0))
     OR EXISTS (SELECT FROM public.credit_wallets w WHERE w.debt <>
                -coalesce((SELECT sum(e.credits) FROM public.credit_ledger e WHERE e.user_id = w.user_id
                          AND (e.kind = 'charge' OR (e.kind = 'adjustment' AND e.credits < 0)
                               OR (e.kind = 'redenomination' AND e.lot_id IS NULL))), 0)
                -coalesce((SELECT sum(d.credits) FROM public.credit_lot_draws d
                           JOIN public.credit_lots o ON o.id = d.lot_id WHERE o.user_id = w.user_id), 0)) THEN
    RAISE EXCEPTION 'Converted credit accounts do not reconcile' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_lots FROM private.credit_lot_conversions;
  RETURN jsonb_build_object('wallets', v_wallets, 'lots', v_lots, 'unit_version', 'credit-paise-v2');
END;
$$;
REVOKE ALL ON FUNCTION private.credit_convert_to_paise() FROM PUBLIC, anon, authenticated, service_role;

-- An idempotent replay of a historical hold returns its current-unit value;
-- its stored amount and rate remain unchanged. Refreshed holds get this epoch.
CREATE OR REPLACE FUNCTION public.reserve_turn_credits(p_user uuid, p_turn_key text, p_enforced boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  s public.credit_settings;
  w public.credit_wallets;
  h public.credit_holds;
  v_held numeric;
  v_available numeric;
  v_existing boolean;
  v_shadow boolean;
  v_credits numeric;
BEGIN
  IF p_user IS NULL OR p_enforced IS NULL OR p_turn_key IS NULL
     OR length(p_turn_key) NOT BETWEEN 1 AND 64 OR length(btrim(p_turn_key)) = 0 THEN
    RAISE EXCEPTION 'A user, a turn key and the enforcement flag are required' USING ERRCODE = '22023';
  END IF;
  s := private.credit_config();
  PERFORM private.credit_refresh(p_user, now());
  SELECT * INTO w FROM public.credit_wallets WHERE user_id = p_user;
  SELECT coalesce(sum(private.credit_current_amount(x.credits, x.inr_per_credit)), 0) INTO v_held
  FROM public.credit_holds x WHERE x.user_id = p_user AND x.settled_at IS NULL
    AND x.expires_at > now() AND NOT x.shadow_blocked;
  v_available := w.balance - v_held;

  SELECT * INTO h FROM public.credit_holds WHERE user_id = p_user AND turn_key = p_turn_key FOR UPDATE;
  v_existing := FOUND;
  IF v_existing AND (
       (h.settled_at IS NULL AND h.swept_at IS NULL AND h.expires_at > now() AND NOT h.shadow_blocked)
       OR EXISTS (SELECT FROM public.research_turns t WHERE t.user_id = p_user AND t.turn_key = p_turn_key)) THEN
    RETURN jsonb_build_object('ok', NOT h.shadow_blocked,
             'hold', jsonb_build_object('credits', private.credit_current_amount(h.credits, h.inr_per_credit),
                                        'expires_at', h.expires_at),
             'available', v_available, 'balance', w.balance)
        || CASE WHEN h.shadow_blocked THEN jsonb_build_object('reason', 'credits_exhausted') ELSE '{}'::jsonb END;
  END IF;

  IF v_available <= 0 AND p_enforced THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'credits_exhausted', 'hold', NULL,
             'available', v_available, 'balance', w.balance);
  END IF;
  v_shadow := v_available <= 0;
  v_credits := CASE WHEN v_shadow THEN s.hold_credits ELSE least(v_available, s.hold_credits) END;
  IF v_existing THEN
    UPDATE public.credit_holds
    SET credits = v_credits, inr_per_credit = s.inr_per_credit,
        expires_at = now() + make_interval(mins => s.hold_minutes), shadow_blocked = v_shadow,
        settled_at = NULL, swept_at = NULL
    WHERE user_id = p_user AND turn_key = p_turn_key
    RETURNING * INTO h;
  ELSE
    INSERT INTO public.credit_holds (user_id, turn_key, credits, inr_per_credit, expires_at, shadow_blocked)
    VALUES (p_user, p_turn_key, v_credits, s.inr_per_credit, now() + make_interval(mins => s.hold_minutes), v_shadow)
    RETURNING * INTO h;
  END IF;
  RETURN jsonb_build_object('ok', NOT v_shadow,
           'hold', jsonb_build_object('credits', h.credits, 'expires_at', h.expires_at),
           'available', v_available, 'balance', w.balance)
      || CASE WHEN v_shadow THEN jsonb_build_object('reason', 'credits_exhausted') ELSE '{}'::jsonb END;
END;
$$;

-- Existing readers, redefined to normalize each frozen charge before aggregation.
CREATE OR REPLACE FUNCTION public.settle_turn_credits(p_user uuid, p_turn_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  v_charged boolean;
  v_total numeric;
  v_balance numeric;
BEGIN
  IF p_user IS NULL OR p_turn_key IS NULL OR length(btrim(p_turn_key)) = 0 THEN
    RAISE EXCEPTION 'A user and a turn key are required' USING ERRCODE = '22023';
  END IF;
  PERFORM private.credit_refresh(p_user, now());
  IF private.credit_charge_turn(p_user, p_turn_key, now()) ->> 'state' = 'pending' THEN
    RETURN jsonb_build_object('state', 'pending');
  END IF;
  UPDATE public.credit_holds SET settled_at = now()
  WHERE user_id = p_user AND turn_key = p_turn_key AND settled_at IS NULL;
  SELECT count(*) > 0, coalesce(-sum(private.credit_current_amount(e.credits, e.inr_per_credit)), 0) INTO v_charged, v_total
  FROM public.credit_ledger e WHERE e.user_id = p_user AND e.kind = 'charge' AND e.turn_key = p_turn_key;
  SELECT w.balance INTO v_balance FROM public.credit_wallets w WHERE w.user_id = p_user;
  RETURN jsonb_build_object('state', CASE WHEN v_charged THEN 'charged' ELSE 'free' END,
           'credits', v_total, 'balance', v_balance);
END;
$$;

CREATE OR REPLACE FUNCTION public.my_conversation_credits(p_conversation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  v jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to read credits' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('message_id', t.assistant_message_id, 'credits', x.credits)
                            ORDER BY m.created_at), '[]'::jsonb) INTO v
  FROM (SELECT e.turn_key, -sum(private.credit_current_amount(e.credits, e.inr_per_credit)) AS credits FROM public.credit_ledger e
        WHERE e.user_id = uid AND e.kind = 'charge' GROUP BY e.turn_key) x
  JOIN public.research_turns t ON t.user_id = uid AND t.turn_key = x.turn_key
  JOIN public.conversations c ON c.id = t.conversation_id AND c.user_id = uid
  JOIN public.chat_messages m ON m.id = t.assistant_message_id AND m.user_id = uid
  WHERE c.id = p_conversation;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.my_credits() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  w public.credit_wallets;
  p public.user_profiles;
  v_plan text := 'free';
  v_allowance numeric;
  v_ends timestamptz;
  v_held numeric;
  v_lots jsonb;
  v_recent jsonb;
  v_cycle_start timestamptz;
  v_used numeric;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to read credits' USING ERRCODE = '42501';
  END IF;
  PERFORM private.credit_refresh(uid, now());
  SELECT * INTO w FROM public.credit_wallets WHERE user_id = uid;
  SELECT * INTO p FROM public.user_profiles WHERE user_id = uid;
  IF FOUND THEN
    v_plan := public.entitlement_from(p) ->> 'plan';
  END IF;

  SELECT a.monthly_credits INTO v_allowance FROM public.credit_plan_allowances a WHERE a.plan::text = v_plan;
  IF v_allowance IS NOT NULL THEN
    SELECT max(o.expires_at) INTO v_ends FROM public.credit_lots o
    WHERE o.user_id = uid AND o.kind = 'monthly' AND o.closed_at IS NULL;
    v_ends := coalesce(v_ends, p.plan_period_end);
  ELSE
    SELECT coalesce((SELECT c.old_granted * 10 FROM private.credit_lot_conversions c
                     WHERE c.old_lot_id = o.id OR c.new_lot_id = o.id), o.granted), o.expires_at
    INTO v_allowance, v_ends FROM public.credit_lots o
    WHERE o.user_id = uid AND o.kind = 'signup' AND o.closed_at IS NULL;
  END IF;

  -- Credits charged to answers this cycle (review R, I2). The cycle starts with the current open
  -- monthly lot (the latest-ending one, which also gives cycle.ends_at), else on Free with the open
  -- signup lot; with neither there is no cycle and the figure is null.
  SELECT o.starts_at INTO v_cycle_start FROM public.credit_lots o
  WHERE o.user_id = uid AND o.kind = 'monthly' AND o.closed_at IS NULL
  ORDER BY o.expires_at DESC, o.starts_at DESC LIMIT 1;
  IF v_cycle_start IS NULL THEN
    SELECT o.starts_at INTO v_cycle_start FROM public.credit_lots o
    WHERE o.user_id = uid AND o.kind = 'signup' AND o.closed_at IS NULL;
  END IF;
  IF v_cycle_start IS NOT NULL THEN
    SELECT coalesce(-sum(private.credit_current_amount(e.credits, e.inr_per_credit)), 0) INTO v_used FROM public.credit_ledger e
    WHERE e.user_id = uid AND e.kind = 'charge' AND e.created_at >= v_cycle_start;
  END IF;

  SELECT coalesce(sum(private.credit_current_amount(x.credits, x.inr_per_credit)), 0) INTO v_held FROM public.credit_holds x
  WHERE x.user_id = uid AND x.settled_at IS NULL AND x.expires_at > now() AND NOT x.shadow_blocked;

  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', o.kind, 'remaining', o.remaining, 'expires_at', o.expires_at)
                            ORDER BY o.expires_at, o.kind), '[]'::jsonb) INTO v_lots
  FROM public.credit_lots o WHERE o.user_id = uid AND o.closed_at IS NULL AND o.remaining > 0;

  WITH latest AS (
    SELECT e.turn_key, e.created_at FROM public.credit_ledger e
    WHERE e.user_id = uid AND e.kind = 'charge' AND e.credits < 0
    ORDER BY e.created_at DESC
    LIMIT 200
  ), turns AS (
    SELECT l.turn_key FROM latest l GROUP BY l.turn_key
  ), totals AS (
    SELECT e.turn_key, -sum(private.credit_current_amount(e.credits, e.inr_per_credit)) AS credits, max(e.created_at) AS created_at
    FROM turns k
    JOIN public.credit_ledger e ON e.user_id = uid AND e.kind = 'charge' AND e.turn_key = k.turn_key
    GROUP BY e.turn_key
    HAVING sum(private.credit_current_amount(e.credits, e.inr_per_credit)) < 0
    ORDER BY max(e.created_at) DESC, e.turn_key
    LIMIT 20
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('conversation_id', t.conversation_id, 'title', c.title,
                                               'credits', r.credits, 'created_at', r.created_at)
                            ORDER BY r.created_at DESC, r.turn_key), '[]'::jsonb) INTO v_recent
  FROM totals r
  LEFT JOIN public.research_turns t ON t.user_id = uid AND t.turn_key = r.turn_key
  LEFT JOIN public.conversations c ON c.id = t.conversation_id AND c.user_id = uid;

  RETURN jsonb_build_object('unit_version', (SELECT unit_version FROM private.credit_epoch WHERE id), 'balance', w.balance, 'held', v_held, 'debt', w.debt, 'plan', v_plan,
           -- The published value of one credit in rupees, for the UI's rupee hint; never dollars.
           'inr_per_credit', (SELECT cs.inr_per_credit FROM public.credit_settings cs WHERE cs.id),
           'cycle', jsonb_build_object('allowance', v_allowance, 'starts_at', v_cycle_start, 'ends_at', v_ends),
           'used_this_cycle', v_used, 'lots', v_lots, 'recent', v_recent);
END;
$$;

CREATE OR REPLACE FUNCTION private.credit_usage_charged(p_user uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (ledger_id uuid, charged_at timestamptz, turn_key text, model_call_log_id uuid, model text,
               caller text, credits numeric, web_search_credits numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT e.id, e.created_at, e.turn_key, c.model_call_log_id,
         private.credit_usage_model(l.model_requested, l.model_served),
         l.caller,
         CASE WHEN c.model_call_log_id IS NULL THEN -private.credit_current_amount(e.credits, e.inr_per_credit)
              WHEN t.cost > 0 THEN -private.credit_current_amount(e.credits, e.inr_per_credit) * c.cost_usd / t.cost
              ELSE 0 END,
         CASE WHEN t.cost > 0 AND coalesce(l.web_search_cost_usd, 0) > 0
              THEN least(-private.credit_current_amount(e.credits, e.inr_per_credit) * c.cost_usd / t.cost, -private.credit_current_amount(e.credits, e.inr_per_credit) * l.web_search_cost_usd / t.cost)
              ELSE 0 END
  FROM public.credit_ledger e
  LEFT JOIN public.credit_charge_rows c ON c.ledger_id = e.id
  LEFT JOIN LATERAL (SELECT sum(c2.cost_usd) AS cost FROM public.credit_charge_rows c2 WHERE c2.ledger_id = e.id) t ON true
  LEFT JOIN public.model_call_logs l ON l.id = c.model_call_log_id AND l.user_id = p_user
  WHERE e.user_id = p_user AND e.kind = 'charge' AND e.created_at >= p_from AND e.created_at < p_to;
$$;

CREATE OR REPLACE FUNCTION public.my_usage_summary(p_from timestamptz, p_to timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  v_to timestamptz := coalesce(p_to, now());
  v_from timestamptz;
  v jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to read credits' USING ERRCODE = '42501';
  END IF;
  v_from := greatest(coalesce(p_from, v_to - interval '10 years'), v_to - interval '10 years');
  IF v_from > v_to THEN
    v_from := v_to;
  END IF;

  WITH charged AS (
    SELECT * FROM private.credit_usage_charged(uid, v_from, v_to)
  ), calls AS (
    SELECT private.credit_usage_model(l.model_requested, l.model_served) AS model, l.caller, l.status,
           coalesce(l.total_tokens, coalesce(l.prompt_tokens, 0) + coalesce(l.completion_tokens, 0)) AS tokens,
           l.web_search_count AS searches
    FROM public.model_call_logs l
    WHERE l.user_id = uid AND l.created_at >= v_from AND l.created_at < v_to
      AND l.caller IN ('research-chat', 'transcribe-audio')
  ), models AS (
    SELECT x.model, private.credit_usage_provider(x.model) AS provider, round(sum(x.credits), 4) AS credits,
           sum(x.calls)::bigint AS calls, sum(x.tokens)::bigint AS tokens
    FROM (SELECT ch.model, ch.credits, 0 AS calls, 0 AS tokens FROM charged ch
          UNION ALL
          SELECT ca.model, 0, 1, ca.tokens FROM calls ca) x
    GROUP BY x.model
  ), turns AS (
    SELECT t.turn_key,
           EXISTS (SELECT FROM public.credit_ledger e
                   WHERE e.user_id = uid AND e.kind = 'charge' AND e.turn_key = t.turn_key AND e.credits < 0) AS charged
    FROM public.research_turns t
    WHERE t.user_id = uid AND t.created_at >= v_from AND t.created_at < v_to
  )
  SELECT jsonb_build_object(
    'credits', (SELECT coalesce(round(sum(ch.credits), 4), 0) FROM charged ch),
    'calls', (SELECT count(*) FROM calls),
    'failed_calls', (SELECT count(*) FROM calls ca WHERE ca.status = 'error'),
    'tokens', (SELECT coalesce(sum(ca.tokens), 0) FROM calls ca),
    'answers', (SELECT count(*) FROM turns),
    'answers_free', (SELECT count(*) FROM turns tu WHERE NOT tu.charged),
    'web_searches', (SELECT coalesce(sum(ca.searches), 0) FROM calls ca),
    'web_search_credits', (SELECT coalesce(round(sum(ch.web_search_credits), 4), 0) FROM charged ch),
    'models_used', (SELECT count(*) FROM models),
    'providers', (SELECT count(DISTINCT m.provider) FROM models m),
    'by_model', (SELECT coalesce(jsonb_agg(jsonb_build_object('model', m.model, 'provider', m.provider,
                   'credits', m.credits, 'calls', m.calls, 'tokens', m.tokens)
                   ORDER BY m.credits DESC, m.calls DESC, m.model), '[]'::jsonb) FROM models m),
    'by_feature', jsonb_build_array(
      jsonb_build_object('feature', 'research',
        'calls', (SELECT count(*) FROM calls ca WHERE ca.caller = 'research-chat'),
        'credits', (SELECT coalesce(round(sum(ch.credits), 4), 0) FROM charged ch
                    WHERE coalesce(ch.caller, 'research-chat') <> 'transcribe-audio'),
        'searches', (SELECT coalesce(sum(ca.searches), 0) FROM calls ca WHERE ca.caller = 'research-chat')),
      jsonb_build_object('feature', 'dictation',
        'calls', (SELECT count(*) FROM calls ca WHERE ca.caller = 'transcribe-audio'),
        'credits', (SELECT coalesce(round(sum(ch.credits), 4), 0) FROM charged ch WHERE ch.caller = 'transcribe-audio'),
        'searches', 0)),
    'lifetime_credits', (SELECT coalesce(-sum(private.credit_current_amount(e.credits, e.inr_per_credit)), 0) FROM public.credit_ledger e
                         WHERE e.user_id = uid AND e.kind = 'charge'))
  INTO v;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.my_usage_timeseries(p_from timestamptz, p_to timestamptz, p_bucket text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  v_bucket text := CASE WHEN p_bucket = 'month' THEN 'month' ELSE 'day' END;
  v_to timestamptz := coalesce(p_to, now());
  v_from timestamptz := p_from;
  v_series jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to read credits' USING ERRCODE = '42501';
  END IF;
  IF v_from IS NULL THEN
    SELECT least((SELECT min(e.created_at) FROM public.credit_ledger e WHERE e.user_id = uid AND e.kind = 'charge'),
                 (SELECT min(l.created_at) FROM public.model_call_logs l
                  WHERE l.user_id = uid AND l.caller IN ('research-chat', 'transcribe-audio')))
    INTO v_from;
    v_from := coalesce(v_from, v_to);
  END IF;
  v_from := greatest(v_from, v_to - CASE v_bucket WHEN 'month' THEN interval '10 years' ELSE interval '400 days' END);
  IF v_from >= v_to THEN
    RETURN jsonb_build_object('bucket', v_bucket, 'series', '[]'::jsonb);
  END IF;

  WITH buckets AS (
    SELECT g::date AS b
    FROM generate_series(private.credit_usage_bucket(v_from, v_bucket)::timestamp,
                         private.credit_usage_bucket(v_to - interval '1 microsecond', v_bucket)::timestamp,
                         CASE v_bucket WHEN 'month' THEN interval '1 month' ELSE interval '1 day' END) g
  ), cells AS (
    SELECT x.b, x.model, round(sum(x.credits), 4) AS credits, sum(x.calls)::bigint AS calls, sum(x.tokens)::bigint AS tokens
    FROM (
      SELECT private.credit_usage_bucket(ch.charged_at, v_bucket) AS b, ch.model, ch.credits, 0 AS calls, 0 AS tokens
      FROM private.credit_usage_charged(uid, v_from, v_to) ch
      UNION ALL
      SELECT private.credit_usage_bucket(l.created_at, v_bucket),
             private.credit_usage_model(l.model_requested, l.model_served), 0, 1,
             coalesce(l.total_tokens, coalesce(l.prompt_tokens, 0) + coalesce(l.completion_tokens, 0))
      FROM public.model_call_logs l
      WHERE l.user_id = uid AND l.created_at >= v_from AND l.created_at < v_to
        AND l.caller IN ('research-chat', 'transcribe-audio')
    ) x
    GROUP BY x.b, x.model
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('bucket_start', to_char(bk.b, 'YYYY-MM-DD'), 'model', c.model,
                                               'credits', coalesce(c.credits, 0), 'calls', coalesce(c.calls, 0),
                                               'tokens', coalesce(c.tokens, 0))
                            ORDER BY bk.b, c.model NULLS FIRST), '[]'::jsonb)
  INTO v_series
  FROM buckets bk
  LEFT JOIN cells c ON c.b = bk.b;
  RETURN jsonb_build_object('bucket', v_bucket, 'series', v_series);
END;
$$;

CREATE OR REPLACE FUNCTION public.my_usage_activity(p_offset integer, p_limit integer, p_grouped boolean, p_model text,
  p_status text, p_kind text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_model text := nullif(left(btrim(coalesce(p_model, '')), 200), '');
  v_status text := CASE WHEN p_status IN ('succeeded', 'failed') THEN p_status ELSE 'all' END;
  v_kind text := CASE WHEN p_kind IN ('answers', 'dictation') THEN p_kind ELSE 'all' END;
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to read credits' USING ERRCODE = '42501';
  END IF;

  IF coalesce(p_grouped, true) THEN
    WITH turns AS (
      SELECT t.turn_key AS key, t.created_at, t.conversation_id, t.user_message_id,
             coalesce(t.assistant_message_id, x.message_id) AS msg
      FROM public.research_turns t
      LEFT JOIN private.credit_turn_messages x ON x.user_id = t.user_id AND x.turn_key = t.turn_key
      WHERE t.user_id = uid AND v_kind IN ('all', 'answers')
    ), items AS (
      SELECT 'turn' AS item, tu.key, tu.created_at, tu.conversation_id, tu.user_message_id, tu.msg, NULL::uuid AS call_id,
             CASE
               WHEN m.id IS NOT NULL THEN CASE
                 WHEN m.status IN ('complete', 'truncated') THEN 'succeeded'
                 WHEN m.status = 'cancelled' THEN 'stopped'
                 WHEN m.status = 'running' AND m.execution_expires_at > now() THEN 'running'
                 ELSE 'failed' END
               WHEN EXISTS (SELECT FROM public.model_call_logs l WHERE l.message_id = tu.msg AND l.user_id = uid
                            AND l.purpose = 'chat_answer' AND l.status = 'success') THEN 'succeeded'
               ELSE 'failed'
             END AS status,
             (v_model IS NULL OR EXISTS (SELECT FROM public.model_call_logs l WHERE l.message_id = tu.msg AND l.user_id = uid
                AND private.credit_usage_model(l.model_requested, l.model_served) = v_model)) AS model_ok
      FROM turns tu
      LEFT JOIN public.chat_messages m ON m.id = tu.msg AND m.user_id = uid
      UNION ALL
      SELECT 'call', l.id::text, l.created_at, NULL, NULL, NULL, l.id,
             CASE l.status WHEN 'success' THEN 'succeeded' WHEN 'aborted' THEN 'stopped' ELSE 'failed' END,
             (v_model IS NULL OR private.credit_usage_model(l.model_requested, l.model_served) = v_model)
      FROM public.model_call_logs l
      WHERE l.user_id = uid AND l.caller = 'transcribe-audio' AND v_kind IN ('all', 'dictation')
    ), filtered AS (
      SELECT * FROM items i
      WHERE i.model_ok
        AND (v_status = 'all' OR (v_status = 'failed' AND i.status = 'failed')
             OR (v_status = 'succeeded' AND i.status IN ('succeeded', 'stopped')))
    ), page AS (
      SELECT * FROM filtered f ORDER BY f.created_at DESC, f.key DESC OFFSET v_offset LIMIT v_limit
    ), page_calls AS (
      -- The calls behind each page row: a turn's by its assistant message, a dictation row's itself.
      SELECT x.key, l.id, l.created_at, l.purpose, l.status, l.reasoning_effort,
             private.credit_usage_model(l.model_requested, l.model_served) AS model,
             coalesce(l.total_tokens, coalesce(l.prompt_tokens, 0) + coalesce(l.completion_tokens, 0)) AS tokens
      FROM (SELECT p.key, l0.id FROM page p JOIN public.model_call_logs l0 ON l0.message_id = p.msg AND l0.user_id = uid
            WHERE p.item = 'turn'
            UNION ALL
            SELECT p.key, p.call_id FROM page p WHERE p.item = 'call') x
      JOIN public.model_call_logs l ON l.id = x.id AND l.user_id = uid
    ), answer_call AS MATERIALIZED (
      -- The call that wrote the visible answer: the one the answer trace links, else the last
      -- successful chat_answer call, else (nothing succeeded) the last chat_answer call. Materialized:
      -- inlined into the join below, its subqueries ran once per call and page row (66 of 73 ms on a
      -- 50-row page in the local plan check), instead of once per page row.
      SELECT p.key,
             coalesce((SELECT tr.model_call_log_id FROM public.chat_turn_traces tr
                       WHERE tr.message_id = p.msg AND tr.user_id = uid AND tr.step_type = 'answer'
                         AND tr.model_call_log_id IS NOT NULL
                       ORDER BY tr.step_index DESC LIMIT 1),
                      (SELECT pc.id FROM page_calls pc WHERE pc.key = p.key AND pc.purpose = 'chat_answer'
                       ORDER BY (pc.status = 'success') DESC, pc.created_at DESC, pc.id DESC LIMIT 1)) AS id
      FROM page p WHERE p.item = 'turn'
    ), call_credits AS (
      SELECT pc.key, pc.id, pc.created_at, pc.purpose, pc.model, pc.tokens, pc.reasoning_effort,
             CASE pc.status WHEN 'success' THEN 'succeeded' WHEN 'aborted' THEN 'stopped' ELSE 'failed' END AS status,
             CASE WHEN pc.purpose = 'chat_answer' AND pc.id = a.id THEN 'answer'
                  WHEN pc.purpose IN ('chat_answer', 'embedding') THEN 'search'
                  WHEN pc.purpose = 'citation_repair' THEN 'repair'
                  WHEN pc.purpose = 'transcription' THEN 'dictation'
                  ELSE 'other' END AS role,
             cr.credits
      FROM page_calls pc
      LEFT JOIN answer_call a ON a.key = pc.key
      LEFT JOIN LATERAL (
        SELECT sum(CASE WHEN t.cost > 0 THEN -private.credit_current_amount(e.credits, e.inr_per_credit) * c.cost_usd / t.cost ELSE 0 END) AS credits
        FROM public.credit_charge_rows c
        JOIN public.credit_ledger e ON e.id = c.ledger_id AND e.user_id = uid AND e.kind = 'charge'
        CROSS JOIN LATERAL (SELECT sum(c2.cost_usd) AS cost FROM public.credit_charge_rows c2 WHERE c2.ledger_id = c.ledger_id) t
        WHERE c.model_call_log_id = pc.id
      ) cr ON true
    )
    SELECT (SELECT count(*) FROM filtered),
           coalesce(jsonb_agg(r.row ORDER BY r.created_at DESC, r.key DESC), '[]'::jsonb)
    INTO v_total, v_rows
    FROM (
      SELECT p.created_at, p.key, jsonb_build_object(
               'turn_key', CASE WHEN p.item = 'turn' THEN p.key END,
               'created_at', p.created_at,
               'conversation_id', c.id,
               'title', c.title,
               'question', CASE WHEN c.id IS NOT NULL THEN left(um.content, 500) END,
               'status', p.status,
               -- The answer's model, else the last chat_answer call's, else the last call's (dictation).
               'model', (SELECT cc.model FROM call_credits cc WHERE cc.key = p.key
                         ORDER BY (cc.role = 'answer') DESC, (cc.purpose = 'chat_answer') DESC, cc.created_at DESC, cc.id DESC
                         LIMIT 1),
               'calls', (SELECT count(*) FROM call_credits cc WHERE cc.key = p.key),
               'tokens', (SELECT coalesce(sum(cc.tokens), 0) FROM call_credits cc WHERE cc.key = p.key),
               'credits', CASE WHEN p.item = 'turn'
                            THEN (SELECT coalesce(-sum(private.credit_current_amount(e.credits, e.inr_per_credit)), 0) FROM public.credit_ledger e
                                  WHERE e.user_id = uid AND e.kind = 'charge' AND e.turn_key = p.key)
                            ELSE (SELECT coalesce(round(sum(cc.credits), 4), 0) FROM call_credits cc WHERE cc.key = p.key) END,
               'detail', (SELECT coalesce(jsonb_agg(jsonb_build_object('role', cc.role, 'model', cc.model,
                                    'effort', cc.reasoning_effort, 'tokens', cc.tokens,
                                    'credits', coalesce(round(cc.credits, 4), 0), 'free', cc.credits IS NULL,
                                    'status', cc.status) ORDER BY cc.created_at, cc.id), '[]'::jsonb)
                          FROM call_credits cc WHERE cc.key = p.key)) AS row
      FROM page p
      LEFT JOIN public.conversations c ON c.id = p.conversation_id AND c.user_id = uid
      LEFT JOIN public.chat_messages um ON um.id = p.user_message_id AND um.user_id = uid
    ) r;
  ELSE
    WITH items AS (
      SELECT l.id, l.created_at, l.message_id, l.conversation_id, l.reasoning_effort,
             private.credit_usage_model(l.model_requested, l.model_served) AS model,
             CASE l.status WHEN 'success' THEN 'succeeded' WHEN 'aborted' THEN 'stopped' ELSE 'failed' END AS status,
             coalesce(l.total_tokens, coalesce(l.prompt_tokens, 0) + coalesce(l.completion_tokens, 0)) AS tokens
      FROM public.model_call_logs l
      WHERE l.user_id = uid
        AND ((v_kind IN ('all', 'answers') AND l.caller = 'research-chat')
             OR (v_kind IN ('all', 'dictation') AND l.caller = 'transcribe-audio'))
    ), filtered AS (
      SELECT * FROM items i
      WHERE (v_model IS NULL OR i.model = v_model)
        AND (v_status = 'all' OR (v_status = 'failed' AND i.status = 'failed')
             OR (v_status = 'succeeded' AND i.status IN ('succeeded', 'stopped')))
    ), page AS (
      SELECT * FROM filtered f ORDER BY f.created_at DESC, f.id DESC OFFSET v_offset LIMIT v_limit
    )
    SELECT (SELECT count(*) FROM filtered),
           coalesce(jsonb_agg(r.row ORDER BY r.created_at DESC, r.id DESC), '[]'::jsonb)
    INTO v_total, v_rows
    FROM (
      SELECT p.created_at, p.id, jsonb_build_object(
               'turn_key', (SELECT x.turn_key FROM private.credit_turn_messages x
                            WHERE x.user_id = uid AND x.message_id = p.message_id LIMIT 1),
               'created_at', p.created_at,
               'conversation_id', c.id,
               'title', c.title,
               'question', NULL,
               'status', p.status,
               'model', p.model,
               'calls', 1,
               'tokens', p.tokens,
               'credits', coalesce(round(cr.credits, 4), 0),
               'detail', '[]'::jsonb) AS row
      FROM page p
      LEFT JOIN public.conversations c ON c.id = p.conversation_id AND c.user_id = uid
      LEFT JOIN LATERAL (
        SELECT sum(CASE WHEN t.cost > 0 THEN -private.credit_current_amount(e.credits, e.inr_per_credit) * ch.cost_usd / t.cost ELSE 0 END) AS credits
        FROM public.credit_charge_rows ch
        JOIN public.credit_ledger e ON e.id = ch.ledger_id AND e.user_id = uid AND e.kind = 'charge'
        CROSS JOIN LATERAL (SELECT sum(c2.cost_usd) AS cost FROM public.credit_charge_rows c2 WHERE c2.ledger_id = ch.ledger_id) t
        WHERE ch.model_call_log_id = p.id
      ) cr ON true
    ) r;
  END IF;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.model_credit_estimates()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET TimeZone = 'UTC'
AS $$
  WITH recent AS (
    SELECT l.id, l.user_id, l.turn_key, private.credit_current_amount(l.credits, l.inr_per_credit) AS credits
    FROM public.credit_ledger l
    WHERE l.kind = 'charge' AND l.created_at >= now() - interval '30 days'
  ), answers AS (
    SELECT r.user_id, r.turn_key, -sum(r.credits) AS credits
    FROM recent r
    GROUP BY r.user_id, r.turn_key
  ), answer_model AS (
    SELECT DISTINCT ON (r.user_id, r.turn_key) r.user_id, r.turn_key, m.model_requested
    FROM recent r
    JOIN public.credit_charge_rows c ON c.ledger_id = r.id
    JOIN public.model_call_logs m ON m.id = c.model_call_log_id
    WHERE m.purpose = 'chat_answer'
    ORDER BY r.user_id, r.turn_key, m.created_at, m.id
  ), measured AS (
    SELECT am.model_requested AS model_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY a.credits::double precision) AS median
    FROM answers a
    JOIN answer_model am USING (user_id, turn_key)
    GROUP BY am.model_requested
    HAVING count(*) >= 10
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('model_id', x.model_id, 'credits', x.credits, 'basis', x.basis)
                            ORDER BY x.sort_order, x.model_id), '[]'::jsonb)
  FROM (
    SELECT a.model_id, a.sort_order,
           CASE
             WHEN ms.model_id IS NOT NULL THEN greatest(1, round(ms.median))::integer
             WHEN p.prompt_usd IS NOT NULL AND p.completion_usd IS NOT NULL THEN
               greatest(1, round((p.prompt_usd * 30000 + p.completion_usd * 2000) * s.usd_to_inr / s.inr_per_credit))::integer
           END AS credits,
           CASE
             WHEN ms.model_id IS NOT NULL THEN 'measured'
             WHEN p.prompt_usd IS NOT NULL AND p.completion_usd IS NOT NULL THEN 'list_price'
             ELSE 'none'
           END AS basis
    FROM public.ai_models a
    CROSS JOIN public.credit_settings s
    LEFT JOIN measured ms ON ms.model_id = a.model_id
    LEFT JOIN public.model_pricing p ON p.model_id = a.model_id
    WHERE a.enabled
  ) x;
$$;

-- The request amount belongs to the epoch the browser read. A pre-cutover
-- request keeps its original number in the immutable ledger; replay compares
-- that original payload, then returns the equivalent current-unit number.
CREATE FUNCTION public.admin_adjust_credits_v2(p_user uuid, p_credits numeric, p_kind text, p_reason text,
  p_admin uuid, p_request_id uuid, p_unit_version text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  s public.credit_settings;
  e public.credit_ledger;
  v_epoch text;
  v_legacy boolean;
  v_ledger_kind text := CASE p_kind WHEN 'topup' THEN 'grant' ELSE 'adjustment' END;
  v_credits numeric(14,4) := p_credits;
  v_repeated boolean := false;
  v_ledger uuid;
  v_expires timestamptz;
  v_balance numeric;
BEGIN
  IF p_user IS NULL OR p_admin IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'A user, an admin and a request id are required' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('adjustment', 'topup') THEN
    RAISE EXCEPTION 'Kind must be adjustment or topup' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'A reason is required' USING ERRCODE = '22023';
  END IF;
  IF v_credits IS NULL OR v_credits = 0 OR (p_kind = 'topup' AND v_credits < 0) THEN
    RAISE EXCEPTION 'Credits must be nonzero and a top-up positive' USING ERRCODE = '22023';
  END IF;
  s := private.credit_config();
  PERFORM private.credit_wallet(p_user);
  SELECT unit_version INTO v_epoch FROM private.credit_epoch WHERE id;
  SELECT * INTO e FROM public.credit_ledger WHERE request_id = p_request_id;
  IF FOUND THEN
    SELECT EXISTS (SELECT FROM private.credit_legacy_entries x WHERE x.ledger_id = e.id) INTO v_legacy;
    IF e.user_id <> p_user OR e.credits <> v_credits OR e.kind <> v_ledger_kind
       OR e.created_by IS DISTINCT FROM p_admin OR e.note IS DISTINCT FROM btrim(p_reason)
       OR (v_legacy AND p_unit_version IS NOT NULL
           AND p_unit_version IS DISTINCT FROM 'credit-ten-paise-v1')
       OR (NOT v_legacy AND p_unit_version IS DISTINCT FROM v_epoch) THEN
      RAISE EXCEPTION 'This request id was already used for a different adjustment' USING ERRCODE = '22023';
    END IF;
    v_repeated := true;
  ELSE
    IF p_unit_version IS DISTINCT FROM v_epoch THEN
      RAISE EXCEPTION 'Credit unit changed; reload before adjusting credits' USING ERRCODE = '22023';
    END IF;
    PERFORM private.credit_refresh(p_user, now());
    IF v_credits > 0 THEN
      PERFORM private.credit_mint(p_user, p_kind, v_credits, now(),
        now() + CASE p_kind WHEN 'topup' THEN s.topup_valid ELSE interval '12 months' END,
        'admin:' || p_request_id, NULL, v_ledger_kind, p_request_id, p_admin, btrim(p_reason));
      PERFORM private.credit_repay(p_user, now());
    ELSE
      v_ledger := private.credit_entry(p_user, 'adjustment', v_credits, NULL, NULL, p_request_id, NULL, NULL,
        p_admin, btrim(p_reason));
      PERFORM private.credit_draw(p_user, -v_credits, v_ledger, 'removal', now());
    END IF;
    SELECT * INTO e FROM public.credit_ledger WHERE request_id = p_request_id;
    v_legacy := false;
  END IF;
  SELECT o.expires_at INTO v_expires FROM public.credit_lots o WHERE o.id = e.lot_id;
  SELECT w.balance INTO v_balance FROM public.credit_wallets w WHERE w.user_id = p_user;
  RETURN jsonb_build_object('ok', true, 'repeated', v_repeated, 'request_id', e.request_id,
    'kind', CASE e.kind WHEN 'grant' THEN 'topup' ELSE 'adjustment' END,
    'credits', CASE WHEN v_legacy THEN e.credits * 10 ELSE e.credits END,
    'lot_id', e.lot_id, 'expires_at', v_expires, 'balance', v_balance, 'unit_version', v_epoch);
END;
$$;

-- Old callers may replay their old request id after cutover, but cannot create
-- a new unversioned credit change then. Before cutover this is a v1 adapter.
CREATE OR REPLACE FUNCTION public.admin_adjust_credits(p_user uuid, p_credits numeric, p_kind text, p_reason text,
  p_admin uuid, p_request_id uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT public.admin_adjust_credits_v2(p_user, p_credits, p_kind, p_reason, p_admin, p_request_id,
    CASE WHEN (SELECT e.unit_version FROM private.credit_epoch e WHERE e.id) = 'credit-ten-paise-v1'
         THEN 'credit-ten-paise-v1' ELSE NULL END);
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_credits_v2(uuid,numeric,text,text,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits_v2(uuid,numeric,text,text,uuid,uuid,text) TO service_role;
