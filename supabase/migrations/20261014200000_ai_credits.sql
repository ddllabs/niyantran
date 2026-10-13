-- AI credits (open-work F111; docs/specs/2026-10-14-ai-credits.md §1-§5, §7, §12;
-- docs/decisions/0011-per-user-credit-ledger.md).
--
-- Every AI answer spends credits from the user's own wallet. This migration
-- adds the wallet, its lots and its append-only ledger, and the functions that
-- reserve before a turn, settle after it, sweep late log rows, mint plan,
-- signup and rollover lots lazily, and let an admin adjust a balance:
--
--   * credit_settings (one row) and credit_plan_allowances hold every rate and
--     allowance; nothing is copied into code. Seeds: ₹95 per USD, ₹0.10 per
--     credit, 10% rollover, 1,000 signup credits for 30 days, top-ups for 12
--     months, a 300-credit hold for 5 minutes, launch_at = when this runs;
--     plus 2,000, pro 6,500, max 75,000 a month.
--   * credit_wallets (balance, debt), credit_lots, credit_ledger,
--     credit_charge_rows (one row per charged model_call_logs row, so a row is
--     never charged twice), credit_lot_draws and credit_holds. RLS is on with
--     no policies; anon and authenticated hold nothing; service_role only reads
--     (every writer is a SECURITY DEFINER function). Nobody may INSERT, UPDATE
--     or DELETE the ledger directly; only the auth.users ON DELETE CASCADE
--     removes its rows (FK actions run as the table owner).
--   * public: reserve_turn_credits, settle_turn_credits, admin_adjust_credits
--     and the plan_grants trigger credits_on_plan_grant (service_role only);
--     my_credits and my_conversation_credits (authenticated only). Every
--     helper is in the private schema, which only the owner can use, because
--     Supabase's default privileges grant EXECUTE on new public functions to
--     anon and authenticated. Every function is SECURITY DEFINER with
--     search_path '' and TimeZone UTC.
--   * Every writer locks the user's wallet row (never user_profiles) and then
--     runs the §3 order: sweep expired holds, expire lots (minting their
--     rollovers), mint due lots, repay debt. A plan grant already holds the
--     profile lock (grant_paid_plan / grant_manual_plan), so the one lock order
--     is profile, then wallet.
--   * Two private tables: credit_launch_grants records, at launch, each paid
--     profile that has no plan_grants row (spec §4 launch backfill), and
--     credit_turn_messages remembers each turn's assistant message (filled by a
--     trigger on research_turns), because deleting a conversation sets
--     research_turns.assistant_message_id to NULL and settle must still find
--     the turn's log rows.
--   * Dollar leaks (§7): authenticated loses SELECT (table and column grants)
--     on model_call_logs and chat_turn_traces, and the cost keys (cost_usd,
--     web_search_cost_usd, cost_usd_from) are stripped at any depth from saved
--     chat_messages.usage. guard_research_result makes completed answers
--     immutable, so private.credit_scrub_usage() disables that one trigger for
--     its single UPDATE and re-enables it. ALTER TABLE ... DISABLE TRIGGER takes
--     SHARE ROW EXCLUSIVE on chat_messages, held until commit; it conflicts
--     with the ROW EXCLUSIVE lock every INSERT, UPDATE and DELETE takes, so no
--     other writer runs while the guard is off (readers are not blocked).
--     A BEFORE INSERT OR UPDATE trigger, credit_strip_usage_cost, then strips
--     the same keys from every new write, so dollars cannot be saved again
--     before research-chat stops sending them. Its name sorts before
--     research_result_immutable, and BEFORE triggers fire in name order, so a
--     completed answer is compared after the strip.
--   * model_call_logs gains an index on message_id, which settle and sweep read.
--
-- Down (manual; drops only what this migration added and restores the two
-- revoked grants. The usage scrub is not reversible: the stripped figures
-- remain in model_call_logs.cost_usd):
--   begin;
--   drop trigger credits_on_plan_grant on public.plan_grants;
--   drop trigger credit_remember_turn_message on public.research_turns;
--   drop trigger credit_strip_usage_cost on public.chat_messages;
--   drop function public.reserve_turn_credits(uuid, text, boolean), public.settle_turn_credits(uuid, text),
--     public.admin_adjust_credits(uuid, numeric, text, text, uuid, uuid), public.credits_on_plan_grant(),
--     public.my_credits(), public.my_conversation_credits(uuid);
--   drop function private.credit_refresh(uuid, timestamptz, boolean), private.credit_sweep(uuid, timestamptz),
--     private.credit_charge_turn(uuid, text, timestamptz), private.credit_mint_due(uuid, timestamptz),
--     private.credit_due_cycles(uuid, timestamptz), private.credit_end_monthly(uuid, timestamptz),
--     private.credit_expire(uuid, timestamptz), private.credit_close_lot(uuid, timestamptz, boolean),
--     private.credit_repay(uuid, timestamptz), private.credit_draw(uuid, numeric, uuid, text, timestamptz),
--     private.credit_mint(uuid, text, numeric, timestamptz, timestamptz, text, public.app_plan, text, uuid, uuid, text),
--     private.credit_entry(uuid, text, numeric, uuid, text, uuid, numeric, numeric, uuid, text),
--     private.credit_wallet(uuid), private.credit_config(), private.credit_launch_backfill(),
--     private.credit_remember_turn_message(), private.credit_scrub_usage(), private.credit_strip_usage(),
--     private.credit_strip_cost(jsonb);
--   drop table private.credit_turn_messages, private.credit_launch_grants;
--   drop schema private;   -- refuses if anything else has been put there since
--   drop table public.credit_holds, public.credit_lot_draws, public.credit_charge_rows, public.credit_ledger,
--     public.credit_lots, public.credit_wallets, public.credit_plan_allowances, public.credit_settings;
--   drop index public.model_call_logs_message;
--   grant select on public.model_call_logs, public.chat_turn_traces to authenticated;
--   commit;

BEGIN;

-- 0. Private schema: only its owner may use it ------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

-- 1. Settings and allowances -----------------------------------------------------------------
CREATE TABLE public.credit_settings (
  id             boolean       PRIMARY KEY DEFAULT true CHECK (id),
  usd_to_inr     numeric(12,4) NOT NULL CHECK (usd_to_inr > 0),
  inr_per_credit numeric(12,4) NOT NULL CHECK (inr_per_credit > 0),
  rollover_pct   numeric(5,2)  NOT NULL CHECK (rollover_pct BETWEEN 0 AND 100),
  signup_credits numeric(14,4) NOT NULL CHECK (signup_credits >= 0),
  signup_valid   interval      NOT NULL CHECK (signup_valid > interval '0'),
  topup_valid    interval      NOT NULL CHECK (topup_valid > interval '0'),
  hold_credits   numeric(14,4) NOT NULL CHECK (hold_credits > 0),
  hold_minutes   integer       NOT NULL CHECK (hold_minutes > 0),
  launch_at      timestamptz   NOT NULL,
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  updated_by     uuid          REFERENCES auth.users(id) ON DELETE SET NULL
);
INSERT INTO public.credit_settings (usd_to_inr, inr_per_credit, rollover_pct, signup_credits, signup_valid,
                                    topup_valid, hold_credits, hold_minutes, launch_at)
VALUES (95, 0.10, 10, 1000, interval '30 days', interval '12 months', 300, 5, now());

CREATE TABLE public.credit_plan_allowances (
  plan            public.app_plan PRIMARY KEY CHECK (plan <> 'free'),
  monthly_credits numeric(14,4)   NOT NULL CHECK (monthly_credits > 0)
);
INSERT INTO public.credit_plan_allowances (plan, monthly_credits)
VALUES ('plus', 2000), ('pro', 6500), ('max', 75000);

-- 2. Wallets, lots, ledger -----------------------------------------------------------------------
CREATE TABLE public.credit_wallets (
  user_id    uuid          PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance    numeric(14,4) NOT NULL DEFAULT 0,
  debt       numeric(14,4) NOT NULL DEFAULT 0 CHECK (debt >= 0),
  updated_at timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE public.credit_lots (
  id         uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       text            NOT NULL CHECK (kind IN ('signup', 'monthly', 'rollover', 'topup', 'adjustment')),
  granted    numeric(14,4)   NOT NULL CHECK (granted > 0),
  remaining  numeric(14,4)   NOT NULL,
  starts_at  timestamptz     NOT NULL,
  expires_at timestamptz     NOT NULL,
  source_key text            NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
  plan       public.app_plan,
  created_by uuid,
  note       text,
  closed_at  timestamptz,
  created_at timestamptz     NOT NULL DEFAULT now(),
  CONSTRAINT credit_lots_remaining_check CHECK (remaining >= 0 AND remaining <= granted),
  CONSTRAINT credit_lots_window_check CHECK (starts_at < expires_at),
  CONSTRAINT credit_lots_source_key UNIQUE (user_id, source_key)
);
CREATE INDEX credit_lots_open ON public.credit_lots (user_id, expires_at) WHERE closed_at IS NULL;

CREATE TABLE public.credit_ledger (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind           text          NOT NULL CHECK (kind IN ('grant', 'charge', 'expiry', 'adjustment')),
  credits        numeric(14,4) NOT NULL,
  lot_id         uuid          REFERENCES public.credit_lots(id) ON DELETE CASCADE,
  turn_key       text,
  request_id     uuid          UNIQUE,
  usd_to_inr     numeric(12,4),
  inr_per_credit numeric(12,4),
  created_by     uuid,
  note           text,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT credit_ledger_kind_shape CHECK (CASE kind
    WHEN 'grant'      THEN credits > 0 AND lot_id IS NOT NULL AND turn_key IS NULL
    WHEN 'charge'     THEN credits <= 0 AND turn_key IS NOT NULL AND lot_id IS NULL AND request_id IS NULL
    WHEN 'expiry'     THEN credits < 0 AND lot_id IS NOT NULL AND turn_key IS NULL AND request_id IS NULL
    WHEN 'adjustment' THEN credits <> 0 AND request_id IS NOT NULL AND created_by IS NOT NULL AND turn_key IS NULL
  END),
  -- A charge stores the rate it used; nothing else carries one.
  CONSTRAINT credit_ledger_rate_check CHECK (
    (kind = 'charge') = (usd_to_inr IS NOT NULL) AND (usd_to_inr IS NULL) = (inr_per_credit IS NULL))
);
CREATE INDEX credit_ledger_user_time ON public.credit_ledger (user_id, created_at DESC);
CREATE INDEX credit_ledger_user_turn ON public.credit_ledger (user_id, turn_key) WHERE kind = 'charge';
CREATE INDEX credit_ledger_lot ON public.credit_ledger (lot_id) WHERE lot_id IS NOT NULL;

-- No foreign key to model_call_logs: a charge outlives its log row.
CREATE TABLE public.credit_charge_rows (
  model_call_log_id uuid          PRIMARY KEY,
  ledger_id         uuid          NOT NULL REFERENCES public.credit_ledger(id) ON DELETE CASCADE,
  cost_usd          numeric(12,6) NOT NULL CHECK (cost_usd >= 0)
);
CREATE INDEX credit_charge_rows_ledger ON public.credit_charge_rows (ledger_id);

CREATE TABLE public.credit_lot_draws (
  id         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id     uuid          NOT NULL REFERENCES public.credit_lots(id) ON DELETE CASCADE,
  ledger_id  uuid          REFERENCES public.credit_ledger(id) ON DELETE CASCADE,
  reason     text          NOT NULL CHECK (reason IN ('charge', 'removal', 'repayment')),
  credits    numeric(14,4) NOT NULL CHECK (credits > 0),
  created_at timestamptz   NOT NULL DEFAULT now(),
  -- A repayment moves credits from a lot to the debt and is not a ledger entry.
  CONSTRAINT credit_lot_draws_ledger_check CHECK ((reason = 'repayment') = (ledger_id IS NULL))
);
CREATE INDEX credit_lot_draws_lot ON public.credit_lot_draws (lot_id);
CREATE INDEX credit_lot_draws_ledger ON public.credit_lot_draws (ledger_id) WHERE ledger_id IS NOT NULL;

CREATE TABLE public.credit_holds (
  user_id        uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  turn_key       text          NOT NULL CHECK (length(turn_key) BETWEEN 1 AND 64 AND length(btrim(turn_key)) > 0),
  credits        numeric(14,4) NOT NULL CHECK (credits > 0),
  created_at     timestamptz   NOT NULL DEFAULT now(),
  expires_at     timestamptz   NOT NULL,
  settled_at     timestamptz,
  swept_at       timestamptz,
  shadow_blocked boolean       NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, turn_key)
);

CREATE TABLE private.credit_launch_grants (
  user_id    uuid            PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan       public.app_plan NOT NULL,
  period_end timestamptz,
  created_at timestamptz     NOT NULL
);

CREATE TABLE private.credit_turn_messages (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  turn_key   text NOT NULL,
  message_id uuid NOT NULL,
  PRIMARY KEY (user_id, turn_key)
);

CREATE INDEX model_call_logs_message ON public.model_call_logs (message_id);

-- 3. Table privileges ------------------------------------------------------------------------------
ALTER TABLE public.credit_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_plan_allowances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_wallets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_lots            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_charge_rows     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_lot_draws       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_holds           ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_settings, public.credit_plan_allowances, public.credit_wallets, public.credit_lots,
  public.credit_ledger, public.credit_charge_rows, public.credit_lot_draws, public.credit_holds
  FROM PUBLIC, anon, authenticated, service_role;
-- service_role only reads: every write goes through the SECURITY DEFINER
-- functions below, so a leaked service key cannot rewrite a balance.
GRANT SELECT ON public.credit_settings, public.credit_plan_allowances, public.credit_wallets, public.credit_lots,
  public.credit_ledger, public.credit_charge_rows, public.credit_lot_draws, public.credit_holds TO service_role;
REVOKE ALL ON private.credit_launch_grants, private.credit_turn_messages FROM PUBLIC, anon, authenticated, service_role;

-- Dollar leaks: signed-in users no longer read call logs or traces. Table-only
-- REVOKE would leave column grants, so clear those too (as 0013 does).
REVOKE ALL ON public.model_call_logs, public.chat_turn_traces FROM PUBLIC, anon, authenticated;
DO $$
DECLARE
  relation text;
  columns text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['model_call_logs', 'chat_turn_traces'] LOOP
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO columns
    FROM pg_attribute
    WHERE attrelid = format('public.%I', relation)::regclass AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON public.%I FROM PUBLIC, anon, authenticated', columns, relation);
  END LOOP;
END;
$$;

-- 4. Private helpers -------------------------------------------------------------------------------
-- Every helper assumes its caller holds the wallet lock (private.credit_wallet).

CREATE FUNCTION private.credit_config() RETURNS public.credit_settings
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE s public.credit_settings;
BEGIN
  SELECT * INTO s FROM public.credit_settings WHERE id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit settings are missing' USING ERRCODE = 'P0002';
  END IF;
  RETURN s;
END;
$$;

-- Creates the wallet on first use and locks it for the transaction.
CREATE FUNCTION private.credit_wallet(p_user uuid) RETURNS public.credit_wallets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE w public.credit_wallets;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'A user is required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.credit_wallets (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO w FROM public.credit_wallets WHERE user_id = p_user FOR UPDATE;
  RETURN w;
END;
$$;

-- One ledger entry, and the balance moves by exactly its credits.
CREATE FUNCTION private.credit_entry(p_user uuid, p_kind text, p_credits numeric, p_lot uuid, p_turn_key text,
  p_request_id uuid, p_usd_to_inr numeric, p_inr_per_credit numeric, p_by uuid, p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.credit_ledger (user_id, kind, credits, lot_id, turn_key, request_id, usd_to_inr, inr_per_credit, created_by, note)
  VALUES (p_user, p_kind, p_credits, p_lot, p_turn_key, p_request_id, p_usd_to_inr, p_inr_per_credit, p_by, p_note)
  RETURNING id INTO v_id;
  UPDATE public.credit_wallets SET balance = balance + p_credits, updated_at = now() WHERE user_id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No wallet for this user' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_id;
END;
$$;

-- A new lot and its + entry; nothing when the source key was already minted.
CREATE FUNCTION private.credit_mint(p_user uuid, p_kind text, p_credits numeric, p_starts timestamptz, p_expires timestamptz,
  p_source_key text, p_plan public.app_plan, p_ledger_kind text, p_request_id uuid, p_by uuid, p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE v_lot uuid;
BEGIN
  INSERT INTO public.credit_lots (user_id, kind, granted, remaining, starts_at, expires_at, source_key, plan, created_by, note)
  VALUES (p_user, p_kind, p_credits, p_credits, p_starts, p_expires, p_source_key, p_plan, p_by, p_note)
  ON CONFLICT (user_id, source_key) DO NOTHING
  RETURNING id INTO v_lot;
  IF v_lot IS NOT NULL THEN
    PERFORM private.credit_entry(p_user, p_ledger_kind, p_credits, v_lot, NULL, p_request_id, NULL, NULL, p_by, p_note);
  END IF;
  RETURN v_lot;
END;
$$;

-- Draws a charge or removal from the usable lots, earliest expiry first. A lot
-- never goes below zero: whatever they cannot cover becomes debt.
CREATE FUNCTION private.credit_draw(p_user uuid, p_credits numeric, p_ledger uuid, p_reason text, p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  v_left numeric := p_credits;
  v_take numeric;
  l record;
BEGIN
  FOR l IN
    SELECT o.id, o.remaining FROM public.credit_lots o
    WHERE o.user_id = p_user AND o.closed_at IS NULL AND o.remaining > 0 AND o.starts_at <= p_now AND o.expires_at > p_now
    ORDER BY o.expires_at, o.starts_at, o.created_at, o.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := least(l.remaining, v_left);
    UPDATE public.credit_lots SET remaining = remaining - v_take WHERE id = l.id;
    INSERT INTO public.credit_lot_draws (lot_id, ledger_id, reason, credits) VALUES (l.id, p_ledger, p_reason, v_take);
    v_left := v_left - v_take;
  END LOOP;
  IF v_left > 0 THEN
    UPDATE public.credit_wallets SET debt = debt + v_left, updated_at = now() WHERE user_id = p_user;
  END IF;
END;
$$;

-- New credits pay off debt first. The draw moves credits between a lot and the
-- debt, so the balance (and the ledger) do not change.
CREATE FUNCTION private.credit_repay(p_user uuid, p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  v_debt numeric;
  v_take numeric;
  l record;
BEGIN
  SELECT w.debt INTO v_debt FROM public.credit_wallets w WHERE w.user_id = p_user;
  IF coalesce(v_debt, 0) <= 0 THEN
    RETURN;
  END IF;
  FOR l IN
    SELECT o.id, o.remaining FROM public.credit_lots o
    WHERE o.user_id = p_user AND o.closed_at IS NULL AND o.remaining > 0 AND o.starts_at <= p_now AND o.expires_at > p_now
    ORDER BY o.expires_at, o.starts_at, o.created_at, o.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_debt <= 0;
    v_take := least(l.remaining, v_debt);
    UPDATE public.credit_lots SET remaining = remaining - v_take WHERE id = l.id;
    INSERT INTO public.credit_lot_draws (lot_id, ledger_id, reason, credits) VALUES (l.id, NULL, 'repayment', v_take);
    v_debt := v_debt - v_take;
  END LOOP;
  UPDATE public.credit_wallets SET debt = v_debt, updated_at = now() WHERE user_id = p_user;
END;
$$;

-- Closes a lot. Its remainder becomes an expiry entry. At a monthly lot's
-- natural expiry, rollover_pct of the remainder becomes a rollover lot for one
-- month (never minted already expired); rollover lots never roll again, and a
-- lot ended by a plan change rolls nothing.
CREATE FUNCTION private.credit_close_lot(p_lot uuid, p_now timestamptz, p_natural boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  s public.credit_settings := private.credit_config();
  o public.credit_lots;
  v_roll numeric(14,4);
BEGIN
  SELECT * INTO o FROM public.credit_lots WHERE id = p_lot FOR UPDATE;
  IF NOT FOUND OR o.closed_at IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE public.credit_lots SET remaining = 0, closed_at = p_now WHERE id = o.id;
  IF o.remaining > 0 THEN
    PERFORM private.credit_entry(o.user_id, 'expiry', -o.remaining, o.id, NULL, NULL, NULL, NULL, NULL,
      CASE WHEN p_natural THEN 'expired' ELSE 'plan changed' END);
    IF p_natural AND o.kind = 'monthly' THEN
      v_roll := round(o.remaining * s.rollover_pct / 100, 4);
      IF v_roll > 0 AND o.expires_at + interval '1 month' > p_now THEN
        PERFORM private.credit_mint(o.user_id, 'rollover', v_roll, o.expires_at, o.expires_at + interval '1 month',
          'rollover:' || o.id, o.plan, 'grant', NULL, NULL, NULL);
      END IF;
    END IF;
  END IF;
END;
$$;

CREATE FUNCTION private.credit_expire(p_user uuid, p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE l record;
BEGIN
  FOR l IN
    SELECT o.id FROM public.credit_lots o
    WHERE o.user_id = p_user AND o.closed_at IS NULL AND o.expires_at <= p_now
    ORDER BY o.expires_at, o.id
  LOOP
    PERFORM private.credit_close_lot(l.id, p_now, true);
  END LOOP;
END;
$$;

-- A manual grant (to Free or to any plan) ends the open monthly lots at once,
-- with no rollover, so switching plans cannot accumulate credits.
CREATE FUNCTION private.credit_end_monthly(p_user uuid, p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE l record;
BEGIN
  FOR l IN
    SELECT o.id FROM public.credit_lots o
    WHERE o.user_id = p_user AND o.closed_at IS NULL AND o.kind = 'monthly'
    ORDER BY o.expires_at, o.id
  LOOP
    PERFORM private.credit_close_lot(l.id, p_now, false);
  END LOOP;
END;
$$;

-- The monthly cycles due at p_now (spec §4), current cycle only. Grants are
-- ordered by plan_grants.id, which is assigned under the profile lock, so id
-- order is the order grant_paid_plan saw them (created_at is the transaction
-- start and can be the other way round). The launch backfill row sorts first.
--  * A payment grant is exactly one cycle, [base, period_end). base follows
--    grant_paid_plan: the previous grant's period_end when that grant was the
--    same plan, active and ending after this grant was made; otherwise the
--    grant's created_at. A later manual grant cancels a cycle not yet started.
--  * A manual grant (and the launch backfill) runs monthly cycles from its
--    created_at, anchored there so month ends never drift, until its
--    period_end (or for ever), the next manual grant, or the base of the next
--    payment's cycle, whichever comes first: a plan paid for in advance takes
--    over when its paid month starts, with no gap.
CREATE FUNCTION private.credit_due_cycles(p_user uuid, p_now timestamptz)
RETURNS TABLE (source_key text, plan public.app_plan, credits numeric, starts_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
#variable_conflict use_column
DECLARE
  g record;
  n integer;
  v_base timestamptz;
  v_end timestamptz;
  v_cut timestamptz;
BEGIN
  FOR g IN
    WITH grants AS (
      SELECT 'grant:' || pg.id AS gkey, pg.id AS ord, pg.plan AS gplan, pg.status AS gstatus,
             pg.period_end AS gend, pg.source AS gsource, pg.created_at AS gat
      FROM public.plan_grants pg WHERE pg.user_id = p_user
      UNION ALL
      SELECT 'launch', 0, lg.plan, 'active', lg.period_end, 'manual', lg.created_at
      FROM private.credit_launch_grants lg WHERE lg.user_id = p_user
    ), ordered AS (
      SELECT gr.*,
             CASE WHEN lag(gr.gplan) OVER w = gr.gplan AND lag(gr.gstatus) OVER w = 'active' AND lag(gr.gend) OVER w > gr.gat
                  THEN lag(gr.gend) OVER w ELSE gr.gat END AS base
      FROM grants gr
      WINDOW w AS (ORDER BY gr.ord)
    )
    SELECT o.*, a.monthly_credits,
           (SELECT min(m.gat) FROM ordered m WHERE m.gsource = 'manual' AND m.ord > o.ord) AS next_manual_at,
           (SELECT p.base FROM ordered p WHERE p.gsource = 'payment' AND p.ord > o.ord ORDER BY p.ord LIMIT 1) AS next_payment_base
    FROM ordered o
    JOIN public.credit_plan_allowances a ON a.plan = o.gplan
    WHERE o.gstatus = 'active' AND o.gsource IN ('payment', 'manual')
  LOOP
    IF g.gsource = 'payment' THEN
      CONTINUE WHEN g.gend IS NULL;
      v_base := g.base;
      IF v_base <= p_now AND p_now < g.gend AND v_base < g.gend AND p_now < coalesce(g.next_manual_at, 'infinity') THEN
        source_key := g.gkey; plan := g.gplan; credits := g.monthly_credits; starts_at := v_base; expires_at := g.gend;
        RETURN NEXT;
      END IF;
    ELSE
      v_cut := least(coalesce(g.gend, 'infinity'), coalesce(g.next_manual_at, 'infinity'), coalesce(g.next_payment_base, 'infinity'));
      CONTINUE WHEN p_now < g.gat OR p_now >= v_cut;
      n := (extract(year FROM age(p_now, g.gat)) * 12 + extract(month FROM age(p_now, g.gat)))::integer;
      WHILE g.gat + make_interval(months => n + 1) <= p_now LOOP n := n + 1; END LOOP;
      WHILE n > 0 AND g.gat + make_interval(months => n) > p_now LOOP n := n - 1; END LOOP;
      v_base := g.gat + make_interval(months => n);
      v_end := least(g.gat + make_interval(months => n + 1), v_cut);
      IF v_base < v_end THEN
        source_key := g.gkey || ':' || n; plan := g.gplan; credits := g.monthly_credits; starts_at := v_base; expires_at := v_end;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- Mints the signup lot (once, confirmed email only, inside its window) and the
-- monthly lots due now.
CREATE FUNCTION private.credit_mint_due(p_user uuid, p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  s public.credit_settings := private.credit_config();
  u record;
  c record;
  v_end timestamptz;
BEGIN
  IF s.signup_credits > 0 AND NOT EXISTS (
       SELECT FROM public.credit_lots o WHERE o.user_id = p_user AND o.source_key = 'signup') THEN
    SELECT au.created_at, au.email_confirmed_at INTO u FROM auth.users au WHERE au.id = p_user;
    IF FOUND AND u.email_confirmed_at IS NOT NULL THEN
      v_end := greatest(u.created_at, s.launch_at) + s.signup_valid;
      IF p_now < v_end THEN
        PERFORM private.credit_mint(p_user, 'signup', s.signup_credits, p_now, v_end, 'signup', NULL, 'grant', NULL, NULL, NULL);
      END IF;
    END IF;
  END IF;
  FOR c IN SELECT * FROM private.credit_due_cycles(p_user, p_now) LOOP
    PERFORM private.credit_mint(p_user, 'monthly', c.credits, c.starts_at, c.expires_at, c.source_key, c.plan,
      'grant', NULL, NULL, NULL);
  END LOOP;
END;
$$;

-- Charges a turn's chargeable log rows that are not charged yet (spec §3.1),
-- as one ledger entry at the current rate. Returns {state:'pending'} while the
-- answer is running inside its deadline, else {state:'done', credits}.
CREATE FUNCTION private.credit_charge_turn(p_user uuid, p_turn_key text, p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  s public.credit_settings := private.credit_config();
  v_msg uuid;
  m record;
  v_status text;
  v_rows uuid[];
  v_cost numeric;
  v_credits numeric(14,4);
  v_ledger uuid;
BEGIN
  SELECT t.assistant_message_id INTO v_msg FROM public.research_turns t
  WHERE t.user_id = p_user AND t.turn_key = p_turn_key;
  IF v_msg IS NULL THEN
    -- The conversation was deleted (research_turns keeps a tombstone).
    SELECT x.message_id INTO v_msg FROM private.credit_turn_messages x
    WHERE x.user_id = p_user AND x.turn_key = p_turn_key;
  END IF;
  IF v_msg IS NULL THEN
    RETURN jsonb_build_object('state', 'done', 'credits', 0);   -- never claimed: nothing ran
  END IF;

  SELECT cm.status, cm.content, cm.execution_expires_at INTO m
  FROM public.chat_messages cm WHERE cm.id = v_msg AND cm.user_id = p_user;
  IF FOUND THEN
    v_status := m.status;
    IF v_status = 'running' THEN
      IF m.execution_expires_at > p_now THEN
        RETURN jsonb_build_object('state', 'pending');
      END IF;
      v_status := 'interrupted';
    END IF;
    -- A failure is free only when the user received nothing.
    IF NOT (v_status IN ('complete', 'truncated', 'cancelled')
            OR (v_status IN ('error', 'interrupted') AND length(btrim(coalesce(m.content, ''))) > 0)) THEN
      RETURN jsonb_build_object('state', 'done', 'credits', 0);
    END IF;
  END IF;
  -- (Not found: deleted with its conversation, and charged from its logs.)

  SELECT array_agg(l.id), sum(l.cost_usd) INTO v_rows, v_cost
  FROM public.model_call_logs l
  WHERE l.message_id = v_msg AND l.user_id = p_user
    AND l.purpose IN ('chat_answer', 'embedding')
    AND l.status IN ('success', 'aborted')
    AND l.cost_usd >= 0   -- a negative (bogus) cost is ignored, never charged
    AND NOT EXISTS (SELECT FROM public.credit_charge_rows c WHERE c.model_call_log_id = l.id);
  IF v_rows IS NULL THEN
    RETURN jsonb_build_object('state', 'done', 'credits', 0);
  END IF;

  v_credits := round(v_cost * s.usd_to_inr / s.inr_per_credit, 4);
  v_ledger := private.credit_entry(p_user, 'charge', -v_credits, NULL, p_turn_key, NULL, s.usd_to_inr, s.inr_per_credit, NULL, NULL);
  INSERT INTO public.credit_charge_rows (model_call_log_id, ledger_id, cost_usd)
  SELECT l.id, v_ledger, l.cost_usd FROM public.model_call_logs l WHERE l.id = ANY (v_rows);
  IF v_credits > 0 THEN
    PERFORM private.credit_draw(p_user, v_credits, v_ledger, 'charge', p_now);
  END IF;
  RETURN jsonb_build_object('state', 'done', 'credits', v_credits);
END;
$$;

-- One final pass for every hold after it expires: charges any row that
-- committed late, then marks the hold swept. Holds still inside their window
-- are never touched, so a sweep cannot race the handler's flush.
CREATE FUNCTION private.credit_sweep(p_user uuid, p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE h record;
BEGIN
  FOR h IN
    SELECT x.turn_key FROM public.credit_holds x
    WHERE x.user_id = p_user AND x.swept_at IS NULL AND x.expires_at <= p_now
    ORDER BY x.expires_at, x.turn_key
  LOOP
    IF private.credit_charge_turn(p_user, h.turn_key, p_now) ->> 'state' <> 'pending' THEN
      UPDATE public.credit_holds SET swept_at = p_now WHERE user_id = p_user AND turn_key = h.turn_key;
    END IF;
  END LOOP;
END;
$$;

-- The fixed order every writer runs under the wallet lock (spec §3).
CREATE FUNCTION private.credit_refresh(p_user uuid, p_now timestamptz, p_end_monthly boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
BEGIN
  PERFORM private.credit_wallet(p_user);
  PERFORM private.credit_sweep(p_user, p_now);
  PERFORM private.credit_expire(p_user, p_now);
  IF p_end_monthly THEN
    PERFORM private.credit_end_monthly(p_user, p_now);
  END IF;
  PERFORM private.credit_mint_due(p_user, p_now);
  PERFORM private.credit_repay(p_user, p_now);
END;
$$;

-- Launch backfill: a profile on a paid plan with no plan_grants row is one
-- manual grant made at launch_at, ending at its plan_period_end.
CREATE FUNCTION private.credit_launch_backfill() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  s public.credit_settings := private.credit_config();
  n integer;
BEGIN
  INSERT INTO private.credit_launch_grants (user_id, plan, period_end, created_at)
  SELECT p.user_id, p.plan, p.plan_period_end, s.launch_at
  FROM public.user_profiles p
  WHERE p.plan_status = 'active' AND p.plan <> 'free'
    AND (p.plan_period_end IS NULL OR p.plan_period_end > s.launch_at)
    AND NOT EXISTS (SELECT FROM public.plan_grants g WHERE g.user_id = p.user_id)
  ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Remembers each claimed turn's assistant message, so a turn whose
-- conversation is deleted can still be charged from its logs.
CREATE FUNCTION private.credit_remember_turn_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
BEGIN
  INSERT INTO private.credit_turn_messages (user_id, turn_key, message_id)
  VALUES (NEW.user_id, NEW.turn_key, NEW.assistant_message_id)
  ON CONFLICT (user_id, turn_key) DO NOTHING;
  RETURN NULL;
END;
$$;
CREATE TRIGGER credit_remember_turn_message
AFTER INSERT OR UPDATE OF assistant_message_id ON public.research_turns
FOR EACH ROW WHEN (NEW.assistant_message_id IS NOT NULL)
EXECUTE FUNCTION private.credit_remember_turn_message();

CREATE FUNCTION private.credit_strip_cost(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
BEGIN
  CASE jsonb_typeof(p)
    WHEN 'object' THEN
      RETURN (SELECT coalesce(jsonb_object_agg(e.key, private.credit_strip_cost(e.value)), '{}'::jsonb)
              FROM jsonb_each(p) e
              WHERE e.key NOT IN ('cost_usd', 'web_search_cost_usd', 'cost_usd_from'));
    WHEN 'array' THEN
      RETURN (SELECT coalesce(jsonb_agg(private.credit_strip_cost(a.value) ORDER BY a.n), '[]'::jsonb)
              FROM jsonb_array_elements(p) WITH ORDINALITY a(value, n));
    ELSE
      RETURN p;
  END CASE;
END;
$$;

-- Strips every cost key from saved usage. guard_research_result makes a
-- completed answer immutable, so its trigger is off for this one UPDATE only.
-- DISABLE TRIGGER takes SHARE ROW EXCLUSIVE on chat_messages until commit,
-- which conflicts with the ROW EXCLUSIVE lock of every INSERT, UPDATE and
-- DELETE, so no other session writes while the guard is off; an error rolls
-- the DISABLE back with the rest.
CREATE FUNCTION private.credit_scrub_usage() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE n integer;
BEGIN
  ALTER TABLE public.chat_messages DISABLE TRIGGER research_result_immutable;
  UPDATE public.chat_messages SET usage = private.credit_strip_cost(usage)
  WHERE jsonb_path_exists(usage, 'strict $.**.cost_usd')
     OR jsonb_path_exists(usage, 'strict $.**.web_search_cost_usd')
     OR jsonb_path_exists(usage, 'strict $.**.cost_usd_from');
  GET DIAGNOSTICS n = ROW_COUNT;
  ALTER TABLE public.chat_messages ENABLE TRIGGER research_result_immutable;
  RETURN n;
END;
$$;

-- Strips the cost keys from every write to chat_messages.usage, so dollars
-- cannot be saved again before research-chat stops sending them. Named to fire
-- before research_result_immutable (BEFORE triggers run in name order).
CREATE FUNCTION private.credit_strip_usage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
BEGIN
  IF jsonb_path_exists(NEW.usage, 'strict $.**.cost_usd')
     OR jsonb_path_exists(NEW.usage, 'strict $.**.web_search_cost_usd')
     OR jsonb_path_exists(NEW.usage, 'strict $.**.cost_usd_from') THEN
    NEW.usage := private.credit_strip_cost(NEW.usage);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER credit_strip_usage_cost
BEFORE INSERT OR UPDATE ON public.chat_messages
FOR EACH ROW WHEN (NEW.usage IS NOT NULL)
EXECUTE FUNCTION private.credit_strip_usage();

-- 5. Public functions ---------------------------------------------------------------------------------

-- Reserve before the turn is claimed (spec §3). Blocked when available <= 0:
-- enforced, no hold; shadow, a shadow_blocked hold that never counts against
-- other turns. Turn keys are chosen by the client, so an existing hold is
-- returned as it is only while it is live (unsettled, unswept, unexpired and
-- not shadow-blocked) or when a turn was already claimed under the key (the
-- claim then only replays it). Any other existing hold is checked again and,
-- unless blocked under enforcement, refreshed in place.
CREATE FUNCTION public.reserve_turn_credits(p_user uuid, p_turn_key text, p_enforced boolean) RETURNS jsonb
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
  SELECT coalesce(sum(x.credits), 0) INTO v_held FROM public.credit_holds x
  WHERE x.user_id = p_user AND x.settled_at IS NULL AND x.expires_at > now() AND NOT x.shadow_blocked;
  v_available := w.balance - v_held;

  SELECT * INTO h FROM public.credit_holds WHERE user_id = p_user AND turn_key = p_turn_key FOR UPDATE;
  v_existing := FOUND;
  IF v_existing AND (
       (h.settled_at IS NULL AND h.swept_at IS NULL AND h.expires_at > now() AND NOT h.shadow_blocked)
       OR EXISTS (SELECT FROM public.research_turns t WHERE t.user_id = p_user AND t.turn_key = p_turn_key)) THEN
    RETURN jsonb_build_object('ok', NOT h.shadow_blocked,
             'hold', jsonb_build_object('credits', h.credits, 'expires_at', h.expires_at),
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
    SET credits = v_credits, expires_at = now() + make_interval(mins => s.hold_minutes), shadow_blocked = v_shadow,
        settled_at = NULL, swept_at = NULL
    WHERE user_id = p_user AND turn_key = p_turn_key
    RETURNING * INTO h;
  ELSE
    INSERT INTO public.credit_holds (user_id, turn_key, credits, expires_at, shadow_blocked)
    VALUES (p_user, p_turn_key, v_credits, now() + make_interval(mins => s.hold_minutes), v_shadow)
    RETURNING * INTO h;
  END IF;
  RETURN jsonb_build_object('ok', NOT v_shadow, 'hold', jsonb_build_object('credits', h.credits, 'expires_at', h.expires_at),
           'available', v_available, 'balance', w.balance)
      || CASE WHEN v_shadow THEN jsonb_build_object('reason', 'credits_exhausted') ELSE '{}'::jsonb END;
END;
$$;

-- Settle after the log flush (spec §3 step 4). Idempotent: a repeat charges
-- nothing new and returns the turn's total.
CREATE FUNCTION public.settle_turn_credits(p_user uuid, p_turn_key text) RETURNS jsonb
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
  SELECT count(*) > 0, coalesce(-sum(e.credits), 0) INTO v_charged, v_total
  FROM public.credit_ledger e WHERE e.user_id = p_user AND e.kind = 'charge' AND e.turn_key = p_turn_key;
  SELECT w.balance INTO v_balance FROM public.credit_wallets w WHERE w.user_id = p_user;
  RETURN jsonb_build_object('state', CASE WHEN v_charged THEN 'charged' ELSE 'free' END,
           'credits', v_total, 'balance', v_balance);
END;
$$;

-- An admin grant or removal (spec §9), through the admin route. A repeated
-- request id returns the first result and changes nothing.
CREATE FUNCTION public.admin_adjust_credits(p_user uuid, p_credits numeric, p_kind text, p_reason text,
  p_admin uuid, p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  s public.credit_settings;
  e public.credit_ledger;
  v_credits numeric(14,4) := p_credits;
  v_ledger_kind text := CASE p_kind WHEN 'topup' THEN 'grant' ELSE 'adjustment' END;
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
  IF v_credits IS NULL OR v_credits = 0 THEN
    RAISE EXCEPTION 'Credits must not be zero' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'topup' AND v_credits < 0 THEN
    RAISE EXCEPTION 'A top-up must be positive' USING ERRCODE = '22023';
  END IF;
  s := private.credit_config();
  PERFORM private.credit_wallet(p_user);

  SELECT * INTO e FROM public.credit_ledger WHERE request_id = p_request_id;
  IF FOUND THEN
    IF e.user_id <> p_user OR e.credits <> v_credits OR e.kind <> v_ledger_kind THEN
      RAISE EXCEPTION 'This request id was already used for a different adjustment' USING ERRCODE = '22023';
    END IF;
    v_repeated := true;
  ELSE
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
  END IF;

  SELECT o.expires_at INTO v_expires FROM public.credit_lots o WHERE o.id = e.lot_id;
  SELECT w.balance INTO v_balance FROM public.credit_wallets w WHERE w.user_id = p_user;
  RETURN jsonb_build_object('ok', true, 'repeated', v_repeated, 'request_id', e.request_id,
           'kind', CASE e.kind WHEN 'grant' THEN 'topup' ELSE 'adjustment' END,
           'credits', e.credits, 'lot_id', e.lot_id, 'expires_at', v_expires, 'balance', v_balance);
END;
$$;

-- plan_grants trigger (spec §4, §5): a payment grant becomes its one cycle; a
-- manual grant also ends the open monthly lots. Runs inside grant_paid_plan /
-- grant_manual_plan, after their profile lock: profile, then wallet.
CREATE FUNCTION public.credits_on_plan_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
BEGIN
  PERFORM private.credit_refresh(NEW.user_id, now(), NEW.source = 'manual');
  RETURN NULL;
END;
$$;
CREATE TRIGGER credits_on_plan_grant
AFTER INSERT ON public.plan_grants
FOR EACH ROW EXECUTE FUNCTION public.credits_on_plan_grant();

-- The signed-in user's credits (spec §7). It writes (sweeps, expires and
-- mints for the caller only), so it is VOLATILE; its only input is auth.uid().
-- No dollars and no exchange rate; only the published rupees per credit.
CREATE FUNCTION public.my_credits() RETURNS jsonb
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
    SELECT o.granted, o.expires_at INTO v_allowance, v_ends FROM public.credit_lots o
    WHERE o.user_id = uid AND o.source_key = 'signup' AND o.closed_at IS NULL;
  END IF;

  SELECT coalesce(sum(x.credits), 0) INTO v_held FROM public.credit_holds x
  WHERE x.user_id = uid AND x.settled_at IS NULL AND x.expires_at > now() AND NOT x.shadow_blocked;

  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', o.kind, 'remaining', o.remaining, 'expires_at', o.expires_at)
                            ORDER BY o.expires_at, o.kind), '[]'::jsonb) INTO v_lots
  FROM public.credit_lots o WHERE o.user_id = uid AND o.closed_at IS NULL AND o.remaining > 0;

  SELECT coalesce(jsonb_agg(jsonb_build_object('conversation_id', r.conversation_id, 'title', r.title,
                                               'credits', r.credits, 'created_at', r.created_at)
                            ORDER BY r.created_at DESC, r.turn_key), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT e.turn_key, -sum(e.credits) AS credits, max(e.created_at) AS created_at, t.conversation_id, c.title
    FROM public.credit_ledger e
    LEFT JOIN public.research_turns t ON t.user_id = e.user_id AND t.turn_key = e.turn_key
    LEFT JOIN public.conversations c ON c.id = t.conversation_id AND c.user_id = e.user_id
    WHERE e.user_id = uid AND e.kind = 'charge'
    GROUP BY e.turn_key, t.conversation_id, c.title
    HAVING sum(e.credits) < 0
    ORDER BY max(e.created_at) DESC, e.turn_key
    LIMIT 20
  ) r;

  RETURN jsonb_build_object('balance', w.balance, 'held', v_held, 'debt', w.debt, 'plan', v_plan,
           -- The published value of one credit in rupees, for the UI's rupee hint; never dollars.
           'inr_per_credit', (SELECT cs.inr_per_credit FROM public.credit_settings cs WHERE cs.id),
           'cycle', jsonb_build_object('allowance', v_allowance, 'ends_at', v_ends),
           'lots', v_lots, 'recent', v_recent);
END;
$$;

-- Credits per answer in the caller's own conversation, read only.
CREATE FUNCTION public.my_conversation_credits(p_conversation uuid) RETURNS jsonb
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
  FROM (SELECT e.turn_key, -sum(e.credits) AS credits FROM public.credit_ledger e
        WHERE e.user_id = uid AND e.kind = 'charge' GROUP BY e.turn_key) x
  JOIN public.research_turns t ON t.user_id = uid AND t.turn_key = x.turn_key
  JOIN public.conversations c ON c.id = t.conversation_id AND c.user_id = uid
  JOIN public.chat_messages m ON m.id = t.assistant_message_id AND m.user_id = uid
  WHERE c.id = p_conversation;
  RETURN v;
END;
$$;

-- 6. Function privileges --------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.reserve_turn_credits(uuid, text, boolean),
  public.settle_turn_credits(uuid, text),
  public.admin_adjust_credits(uuid, numeric, text, text, uuid, uuid),
  public.credits_on_plan_grant(),
  public.my_credits(),
  public.my_conversation_credits(uuid)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.reserve_turn_credits(uuid, text, boolean),
  public.settle_turn_credits(uuid, text),
  public.admin_adjust_credits(uuid, numeric, text, text, uuid, uuid),
  public.credits_on_plan_grant()
TO service_role;
GRANT EXECUTE ON FUNCTION public.my_credits(), public.my_conversation_credits(uuid) TO authenticated;
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'private'::regnamespace LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END;
$$;

-- 7. Data: launch backfill and the usage scrub ----------------------------------------------------------
SELECT private.credit_launch_backfill();
SELECT private.credit_scrub_usage();

COMMIT;
