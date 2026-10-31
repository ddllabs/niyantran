-- AI credits (migration 20261014200000; open-work F111;
-- docs/specs/2026-10-14-ai-credits.md). PostgreSQL assertions, no pgTAP. Run
-- only in a disposable database, through run.sh, which applies the migration as
-- a non-superuser (nter_migrator).
-- Bootstrap: the least_privilege chain, research_turn_persistence,
-- signup_persona, plan_entitlements, inr_plans and web_search (the last two as
-- a non-superuser), bootstrap_ai_credits_seed.sql (data the migration must
-- process), then 20261014200000_ai_credits.sql as a non-superuser. The vacuity
-- check drops the last: the credit settings table is then missing, so the
-- first assertion fails.
--
-- The bootstrap's auth.users stub has neither created_at nor
-- email_confirmed_at (Supabase's table has both). This fixture adds them inside
-- its own transaction; nothing outside it changes.
--
-- Time: now() is fixed for the whole transaction. The public functions use
-- now(). Cycle and expiry tests call private.credit_refresh(user, at) with
-- chosen instants; holds are expired by moving their expires_at.
--
-- Users (00000000-0000-4000-8000-00000000c0xx): ff admin; 01 holds; 02 debt;
-- 03 what is charged; 04 settle and sweep; 05 lot order; 06 payments; 07 31
-- January payment; 08 31 January manual; 09 away three months; 0a re-subscribe;
-- 0b admin plan switches; 0c launch backfill; 0d top-ups; 0e deletion; 0f usage
-- scrub; 11-15 signup; 21 stale holds; 22 lock-order payments; 23 manual then
-- payment; 24-25 rollover cases; 26-27 launch then payment / manual; 28
-- negative cost; a1 seeded before the migration.
--
-- Two sessions racing (the wallet row lock) cannot be shown inside one
-- transaction; this fixture covers single-session behaviour only.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL TimeZone = 'UTC';

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

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
    IF SQLSTATE <> expected_state THEN
      RAISE EXCEPTION 'FAIL: % (expected %, got %: %)', label, expected_state, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % (statement was accepted)', label;
END;
$$;

-- Every §12 invariant, over every wallet, lot and ledger entry.
CREATE FUNCTION pg_temp.invariants(label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE bad text;
BEGIN
  SELECT string_agg(w.user_id::text, ', ') INTO bad FROM public.credit_wallets w
  WHERE w.balance <> coalesce((SELECT sum(l.credits) FROM public.credit_ledger l WHERE l.user_id = w.user_id), 0);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: % - balance is not the ledger sum for %', label, bad; END IF;

  SELECT string_agg(w.user_id::text, ', ') INTO bad FROM public.credit_wallets w
  WHERE w.balance <> coalesce((SELECT sum(o.remaining) FROM public.credit_lots o
                               WHERE o.user_id = w.user_id AND o.closed_at IS NULL), 0) - w.debt;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: % - balance is not open lots minus debt for %', label, bad; END IF;

  SELECT string_agg(o.id::text, ', ') INTO bad FROM public.credit_lots o
  WHERE o.granted - o.remaining <>
        coalesce((SELECT sum(d.credits) FROM public.credit_lot_draws d WHERE d.lot_id = o.id), 0)
      - coalesce((SELECT sum(e.credits) FROM public.credit_ledger e WHERE e.lot_id = o.id AND e.kind = 'expiry'), 0);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: % - granted - remaining is not draws + expiry for lot %', label, bad; END IF;

  SELECT string_agg(w.user_id::text, ', ') INTO bad FROM public.credit_wallets w
  WHERE w.debt <>
        - coalesce((SELECT sum(e.credits) FROM public.credit_ledger e WHERE e.user_id = w.user_id
                     AND (e.kind = 'charge' OR (e.kind = 'adjustment' AND e.credits < 0))), 0)
        - coalesce((SELECT sum(d.credits) FROM public.credit_lot_draws d JOIN public.credit_lots o ON o.id = d.lot_id
                     WHERE o.user_id = w.user_id), 0);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: % - debt is not (charges + removals) - draws for %', label, bad; END IF;

  IF EXISTS (SELECT FROM public.credit_lots WHERE remaining < 0 OR granted <= 0)
     OR EXISTS (SELECT FROM public.credit_ledger WHERE kind = 'grant' AND credits <= 0)
     OR EXISTS (SELECT FROM public.credit_wallets WHERE debt < 0) THEN
    RAISE EXCEPTION 'FAIL: % - a lot, grant or debt is negative', label;
  END IF;
  RAISE NOTICE 'PASS: % - invariants hold over % wallets', label, (SELECT count(*) FROM public.credit_wallets);
END;
$$;

CREATE FUNCTION pg_temp.mkuser(p_id uuid, p_confirmed boolean DEFAULT false, p_created timestamptz DEFAULT now())
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email, created_at, email_confirmed_at)
  VALUES (p_id, p_id::text || '@example.invalid', p_created, CASE WHEN p_confirmed THEN p_created END)
  RETURNING id;
$$;

-- A claimed turn with its assistant message in the given state. Returns the
-- assistant message id.
CREATE FUNCTION pg_temp.turn(p_user uuid, p_key text, p_status text, p_content text DEFAULT 'An answer.',
                             p_usage jsonb DEFAULT NULL, p_expires timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE conv uuid := gen_random_uuid(); um uuid; am uuid;
BEGIN
  INSERT INTO public.conversations (id, user_id, title) VALUES (conv, p_user, 'Conversation ' || p_key);
  INSERT INTO public.chat_messages (conversation_id, user_id, role, content, turn_key, created_at)
    VALUES (conv, p_user, 'user', 'A question.', p_key, clock_timestamp()) RETURNING id INTO um;
  INSERT INTO public.chat_messages (conversation_id, user_id, role, content, status, usage, execution_expires_at, created_at)
    VALUES (conv, p_user, 'assistant', p_content, p_status, p_usage,
            coalesce(p_expires, CASE WHEN p_status = 'running' THEN now() + interval '120 seconds' END), clock_timestamp())
    RETURNING id INTO am;
  INSERT INTO public.research_turns (user_id, turn_key, request_hash, conversation_id, user_message_id, assistant_message_id, execution_token)
    VALUES (p_user, p_key, encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), conv, um, am, gen_random_uuid());
  RETURN am;
END;
$$;

CREATE FUNCTION pg_temp.log(p_user uuid, p_message uuid, p_purpose text, p_status text, p_cost numeric)
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.model_call_logs (user_id, message_id, caller, purpose, status, cost_usd)
  VALUES (p_user, p_message, 'research-chat', p_purpose, p_status, p_cost)
  RETURNING id;
$$;

CREATE TEMP TABLE res (k text PRIMARY KEY, v jsonb);
GRANT ALL ON res TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.r(p_key text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM res WHERE k = p_key $$;
CREATE FUNCTION pg_temp.balance(p_user uuid) RETURNS numeric LANGUAGE sql AS $$
  SELECT balance FROM public.credit_wallets WHERE user_id = p_user $$;
CREATE FUNCTION pg_temp.turn_charged(p_user uuid, p_key text) RETURNS numeric LANGUAGE sql AS $$
  SELECT coalesce(-sum(credits), 0) FROM public.credit_ledger WHERE user_id = p_user AND kind = 'charge' AND turn_key = p_key $$;

SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c0ff');

-- 1. Settings, seeds and schema ------------------------------------------------------
SELECT pg_temp.assert_true((SELECT usd_to_inr = 95 AND inr_per_credit = 0.10 AND rollover_pct = 10
    AND signup_credits = 1000 AND signup_valid = interval '30 days' AND topup_valid = interval '12 months'
    AND hold_credits = 300 AND hold_minutes = 5
    AND launch_at <= now() AND launch_at > now() - interval '1 hour'
  FROM public.credit_settings), 'credit_settings holds the §1 seeds, launch_at is when the migration ran');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.credit_settings) = 1, 'credit_settings has one row');
SELECT pg_temp.rejected($q$INSERT INTO public.credit_settings (id, usd_to_inr, inr_per_credit, rollover_pct, signup_credits,
    signup_valid, topup_valid, hold_credits, hold_minutes, launch_at)
  VALUES (false, 95, 0.1, 10, 1000, '30 days', '12 months', 300, 5, now())$q$, '23514', 'a second settings row is refused');
SELECT pg_temp.assert_true((SELECT jsonb_object_agg(plan, monthly_credits) FROM public.credit_plan_allowances)
  = '{"plus": 2000, "pro": 6500, "max": 75000}'::jsonb, 'allowances: plus 2000, pro 6500, max 75000');
SELECT pg_temp.rejected($q$INSERT INTO public.credit_plan_allowances (plan, monthly_credits) VALUES ('free', 10)$q$,
  '23514', 'Free has no monthly allowance');
SELECT pg_temp.assert_true(EXISTS (SELECT FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'model_call_logs'
  AND indexdef LIKE '%(message_id)%'), 'model_call_logs is indexed on message_id');
SELECT pg_temp.assert_true((SELECT tgenabled = 'O' FROM pg_trigger WHERE tgname = 'research_result_immutable'),
  'the result immutability guard is enabled after the migration');
-- The migration's own data steps, over rows seeded before it ran
-- (bootstrap_ai_credits_seed.sql). No helper is called here.
SELECT pg_temp.assert_true(EXISTS (SELECT FROM private.credit_launch_grants WHERE user_id = '00000000-0000-4000-8000-00000000c0a1'
    AND plan = 'plus' AND period_end > now() AND created_at = (SELECT launch_at FROM public.credit_settings)),
  'the migration backfilled the seeded paid profile that has no plan_grants row');
SELECT pg_temp.assert_true((SELECT usage = '{"prompt_tokens": 7, "web_searches": 1, "observed": {"attempts_reporting": 2},
      "attempts": [{"model": "m"}, {"nested": [{"tokens": 3}]}]}'::jsonb AND status = 'complete' AND content = 'An answer.'
  FROM public.chat_messages WHERE id = 'd0000000-0000-4000-8000-0000000000a1'),
  'the migration stripped the seeded answer''s cost keys (top level, observed, arrays) and changed nothing else');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.chat_messages WHERE jsonb_path_exists(usage, 'strict $.**.cost_usd')
    OR jsonb_path_exists(usage, 'strict $.**.web_search_cost_usd') OR jsonb_path_exists(usage, 'strict $.**.cost_usd_from')),
  'after the migration no saved message carries a cost key');

-- 2. Privileges -----------------------------------------------------------------------
-- Every function the migration adds: those nter_migrator owns in public and
-- private (inr_plans and web_search only replace functions postgres owns).
CREATE TEMP TABLE added_fn AS
  SELECT p.oid, n.nspname, p.proname, p.oid::regprocedure::text AS sig, p.prosecdef, p.proconfig, p.proacl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'private') AND pg_get_userbyid(p.proowner) = 'nter_migrator';
SELECT pg_temp.assert_true((SELECT array_agg(proname::text ORDER BY proname) FROM added_fn WHERE nspname = 'public')
  = ARRAY['admin_adjust_credits', 'credits_on_plan_grant', 'my_conversation_credits', 'my_credits',
          'reserve_turn_credits', 'settle_turn_credits'], 'public gains exactly the six §12 functions, no helper');
SELECT pg_temp.assert_true((SELECT count(*) FROM added_fn WHERE nspname = 'private') >= 10, 'the helpers live in private');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM added_fn WHERE NOT prosecdef
    OR NOT (proconfig @> ARRAY['search_path=""', 'TimeZone=UTC'])),
  'every added function is SECURITY DEFINER with search_path '''' and TimeZone UTC');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM added_fn WHERE proacl IS NULL
    OR EXISTS (SELECT FROM aclexplode(proacl) a WHERE a.grantee = 0)), 'no added function is executable by PUBLIC');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM added_fn f WHERE
       has_function_privilege('anon', f.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', f.oid, 'EXECUTE')
       <> (f.nspname = 'public' AND f.proname IN ('my_credits', 'my_conversation_credits'))
    OR has_function_privilege('service_role', f.oid, 'EXECUTE')
       <> (f.nspname = 'public' AND f.proname NOT IN ('my_credits', 'my_conversation_credits'))),
  'has_function_privilege matches §12: anon none, authenticated only my_*, service_role the rest of public, private nobody');
SELECT pg_temp.assert_true(NOT has_schema_privilege('anon', 'private', 'USAGE')
  AND NOT has_schema_privilege('authenticated', 'private', 'USAGE')
  AND NOT has_schema_privilege('service_role', 'private', 'USAGE'), 'only the owner can use the private schema');

CREATE TEMP TABLE credit_tables (t text);
INSERT INTO credit_tables VALUES ('credit_settings'), ('credit_plan_allowances'), ('credit_wallets'), ('credit_lots'),
  ('credit_ledger'), ('credit_charge_rows'), ('credit_lot_draws'), ('credit_holds');
SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT FROM (SELECT 'public.' || t AS rel FROM credit_tables
               UNION ALL VALUES ('public.model_call_logs'), ('public.chat_turn_traces')) x,
              (VALUES ('anon'), ('authenticated')) r(role)
  WHERE has_table_privilege(r.role, x.rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_any_column_privilege(r.role, x.rel, 'SELECT,INSERT,UPDATE,REFERENCES')),
  'anon and authenticated hold no table or column privilege on credit tables, model_call_logs or chat_turn_traces');
SELECT pg_temp.assert_true(has_table_privilege('authenticated', 'public.model_pricing', 'SELECT'),
  'model_pricing stays readable for the model picker');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM credit_tables
  WHERE NOT has_table_privilege('service_role', 'public.' || t, 'SELECT')
     OR has_table_privilege('service_role', 'public.' || t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_any_column_privilege('service_role', 'public.' || t, 'INSERT,UPDATE,REFERENCES')),
  'service_role only reads the credit tables: no INSERT, UPDATE or DELETE, by table or by column (every writer is SECURITY DEFINER)');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM credit_tables c JOIN pg_class k ON k.oid = ('public.' || c.t)::regclass
  WHERE NOT k.relrowsecurity OR EXISTS (SELECT FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.t)),
  'every credit table has RLS on and no policy');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM pg_class k JOIN pg_namespace n ON n.oid = k.relnamespace,
    (VALUES ('anon'), ('authenticated'), ('service_role')) r(role)
  WHERE n.nspname = 'private' AND k.relkind = 'r'
    AND has_table_privilege(r.role, k.oid, 'SELECT,INSERT,UPDATE,DELETE')), 'nobody but the owner touches private tables');

-- 3. Holds -----------------------------------------------------------------------------
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c001');
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('hold.grant', public.admin_adjust_credits('00000000-0000-4000-8000-00000000c001', 25, 'adjustment',
  'Fixture credits', '00000000-0000-4000-8000-00000000c0ff', 'a0000000-0000-4000-8000-000000000001'));
INSERT INTO res VALUES ('hold.h1', public.reserve_turn_credits('00000000-0000-4000-8000-00000000c001', 'h1', true));
INSERT INTO res VALUES ('hold.h2', public.reserve_turn_credits('00000000-0000-4000-8000-00000000c001', 'h2', true));
INSERT INTO res VALUES ('hold.h1again', public.reserve_turn_credits('00000000-0000-4000-8000-00000000c001', 'h1', true));
INSERT INTO res VALUES ('hold.h3', public.reserve_turn_credits('00000000-0000-4000-8000-00000000c001', 'h3', false));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('hold.h1') @> '{"ok": true, "hold": {"credits": 25}, "available": 25, "balance": 25}',
  'balance 25: the first turn holds 25');
SELECT pg_temp.assert_true(pg_temp.r('hold.h2') @> '{"ok": false, "reason": "credits_exhausted", "available": 0, "balance": 25}'
  AND pg_temp.r('hold.h2') -> 'hold' = 'null'::jsonb, 'a second turn at the same time is blocked');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.credit_holds WHERE turn_key = 'h2'),
  'enforced and blocked: no hold is created');
SELECT pg_temp.assert_true(pg_temp.r('hold.h1again') -> 'hold' = pg_temp.r('hold.h1') -> 'hold'
  AND pg_temp.r('hold.h1again') ->> 'ok' = 'true'
  AND (SELECT count(*) FROM public.credit_holds WHERE turn_key = 'h1') = 1, 'the same turn reserved twice gets its first hold back');
SELECT pg_temp.assert_true(pg_temp.r('hold.h3') @> '{"ok": false, "reason": "credits_exhausted"}'
  AND (pg_temp.r('hold.h3') -> 'hold' ->> 'credits')::numeric = 300
  AND (SELECT shadow_blocked FROM public.credit_holds WHERE turn_key = 'h3'), 'shadow mode: a blocked turn still gets a shadow_blocked hold');
SELECT pg_temp.assert_true((SELECT expires_at = now() + interval '5 minutes' FROM public.credit_holds WHERE turn_key = 'h1'),
  'a hold lasts hold_minutes');
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c001',
  pg_temp.turn('00000000-0000-4000-8000-00000000c001', 'h3', 'complete'), 'chat_answer', 'success', 0.01);
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('hold.settle3', public.settle_turn_credits('00000000-0000-4000-8000-00000000c001', 'h3'));
INSERT INTO res VALUES ('hold.settle1', public.settle_turn_credits('00000000-0000-4000-8000-00000000c001', 'h1'));
INSERT INTO res VALUES ('hold.h4', public.reserve_turn_credits('00000000-0000-4000-8000-00000000c001', 'h4', true));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('hold.settle3') @> '{"state": "charged", "credits": 9.5, "balance": 15.5}',
  'the shadow-blocked turn is charged at settle');
SELECT pg_temp.assert_true(pg_temp.r('hold.settle1') @> '{"state": "free", "credits": 0}'
  AND (SELECT settled_at IS NOT NULL FROM public.credit_holds WHERE turn_key = 'h1'), 'a turn that never ran settles free');
SELECT pg_temp.assert_true(pg_temp.r('hold.h4') @> '{"ok": true, "hold": {"credits": 15.5}}',
  'settled holds stop counting; the next hold is min(available, hold_credits)');
SELECT pg_temp.rejected($q$SELECT public.reserve_turn_credits('00000000-0000-4000-8000-00000000c001', '', true)$q$, '22023',
  'an empty turn key is refused');
SELECT pg_temp.rejected($q$SELECT public.reserve_turn_credits('00000000-0000-4000-8000-00000000c001', 'h5', NULL)$q$, '22023',
  'a missing enforcement flag is refused');
SELECT pg_temp.rejected($q$SELECT public.reserve_turn_credits(NULL, 'h5', true)$q$, '22023', 'a missing user is refused');
SELECT pg_temp.invariants('holds');

-- 3b. A stale hold cannot be reused to pass the check (review C1) ----------------------
-- Turn keys are chosen by the client. A hold that has expired, been settled or
-- been swept is checked again, unless a turn was claimed under the key (the
-- claim then only replays it).
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c021');
SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c021', 1000, 'adjustment', 'Fixture credits', '00000000-0000-4000-8000-00000000c0ff',
  'a0000000-0000-4000-8000-000000000021');
SELECT public.reserve_turn_credits('00000000-0000-4000-8000-00000000c021', 'k1', true);
SELECT public.reserve_turn_credits('00000000-0000-4000-8000-00000000c021', 'k2', true);
SELECT public.reserve_turn_credits('00000000-0000-4000-8000-00000000c021', 'k3', true);
SELECT public.settle_turn_credits('00000000-0000-4000-8000-00000000c021', 'k2');
SELECT pg_temp.turn('00000000-0000-4000-8000-00000000c021', 'k3', 'complete');
UPDATE public.credit_holds SET expires_at = now() - interval '1 second'
  WHERE user_id = '00000000-0000-4000-8000-00000000c021' AND turn_key IN ('k1', 'k3');
SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c021', -1000, 'adjustment', 'Fixture removal', '00000000-0000-4000-8000-00000000c0ff',
  'a0000000-0000-4000-8000-000000000022');
INSERT INTO res VALUES ('c1.k1', public.reserve_turn_credits('00000000-0000-4000-8000-00000000c021', 'k1', true));
INSERT INTO res VALUES ('c1.k2', public.reserve_turn_credits('00000000-0000-4000-8000-00000000c021', 'k2', true));
INSERT INTO res VALUES ('c1.k3', public.reserve_turn_credits('00000000-0000-4000-8000-00000000c021', 'k3', true));
SELECT pg_temp.assert_true(pg_temp.r('c1.k1') @> '{"ok": false, "reason": "credits_exhausted", "balance": 0}'
  AND pg_temp.r('c1.k1') -> 'hold' = 'null'::jsonb, 'an expired hold for an unclaimed key is checked again: blocked at 0');
SELECT pg_temp.assert_true(pg_temp.r('c1.k2') @> '{"ok": false, "reason": "credits_exhausted"}',
  'a settled hold for an unclaimed key is checked again: blocked at 0');
SELECT pg_temp.assert_true(pg_temp.r('c1.k3') @> '{"ok": true, "hold": {"credits": 300}}',
  'a key whose turn was claimed gets its hold back as it is (the claim only replays the turn)');
INSERT INTO res VALUES ('c1.k1.shadow', public.reserve_turn_credits('00000000-0000-4000-8000-00000000c021', 'k1', false));
SELECT pg_temp.assert_true(pg_temp.r('c1.k1.shadow') @> '{"ok": false, "reason": "credits_exhausted", "hold": {"credits": 300}}'
  AND (SELECT shadow_blocked AND settled_at IS NULL AND swept_at IS NULL AND expires_at = now() + interval '5 minutes'
       FROM public.credit_holds WHERE user_id = '00000000-0000-4000-8000-00000000c021' AND turn_key = 'k1'),
  'in shadow mode the stale hold is refreshed in place as shadow_blocked');
SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c021', 500, 'adjustment', 'Fixture top-up', '00000000-0000-4000-8000-00000000c0ff',
  'a0000000-0000-4000-8000-000000000023');
INSERT INTO res VALUES ('c1.k1.recovered', public.reserve_turn_credits('00000000-0000-4000-8000-00000000c021', 'k1', false));
SELECT pg_temp.assert_true(pg_temp.r('c1.k1.recovered') @> '{"ok": true, "hold": {"credits": 300}, "balance": 500}'
  AND NOT (SELECT shadow_blocked FROM public.credit_holds WHERE user_id = '00000000-0000-4000-8000-00000000c021' AND turn_key = 'k1'),
  'a shadow-blocked key recovers once the balance is positive');
SELECT pg_temp.invariants('stale holds');

-- 4. Debt (worked example) and the rate frozen per charge --------------------------
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c002');
UPDATE public.credit_settings SET usd_to_inr = 100;   -- x1000, so $0.30 is exactly 300 credits
SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c002', 120, 'adjustment', 'Fixture credits',
  '00000000-0000-4000-8000-00000000c0ff', 'a0000000-0000-4000-8000-000000000002');
SELECT public.reserve_turn_credits('00000000-0000-4000-8000-00000000c002', 'd1', true);
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c002',
  pg_temp.turn('00000000-0000-4000-8000-00000000c002', 'd1', 'complete'), 'chat_answer', 'success', 0.30);
INSERT INTO res VALUES ('debt.settle', public.settle_turn_credits('00000000-0000-4000-8000-00000000c002', 'd1'));
UPDATE public.credit_settings SET usd_to_inr = 95;
SELECT pg_temp.assert_true(pg_temp.r('debt.settle') @> '{"state": "charged", "credits": 300, "balance": -180}',
  'a charge of 300 on lots of 120 leaves -180');
SELECT pg_temp.assert_true((SELECT debt = 180 AND balance = -180 FROM public.credit_wallets
  WHERE user_id = '00000000-0000-4000-8000-00000000c002'), 'the 180 not covered by lots is debt on the wallet');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.credit_lots
  WHERE user_id = '00000000-0000-4000-8000-00000000c002' AND remaining <> 0), 'the lots fall to 0, never below');
SELECT pg_temp.assert_true((SELECT usd_to_inr = 100 AND inr_per_credit = 0.10 FROM public.credit_ledger
  WHERE user_id = '00000000-0000-4000-8000-00000000c002' AND kind = 'charge'), 'the charge stores the rate it used');
INSERT INTO res VALUES ('debt.blocked', public.reserve_turn_credits('00000000-0000-4000-8000-00000000c002', 'd2', true));
SELECT pg_temp.assert_true(pg_temp.r('debt.blocked') @> '{"ok": false, "reason": "credits_exhausted", "balance": -180}',
  'at -180 the reserve is blocked');
SELECT pg_temp.invariants('debt');
CREATE TEMP TABLE debt_ledger_before AS
  SELECT count(*) AS n FROM public.credit_ledger WHERE user_id = '00000000-0000-4000-8000-00000000c002';
SET LOCAL ROLE service_role;
SELECT public.grant_paid_plan('00000000-0000-4000-8000-00000000c002', 'plus', 'month', 'pay_debt');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT balance = 1820 AND debt = 0 FROM public.credit_wallets
  WHERE user_id = '00000000-0000-4000-8000-00000000c002'), 'a 2,000 monthly lot leaves 1,820 and no debt');
SELECT pg_temp.assert_true((SELECT remaining = 1820 FROM public.credit_lots
  WHERE user_id = '00000000-0000-4000-8000-00000000c002' AND kind = 'monthly'), 'the monthly lot keeps 1,820');
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND sum(credits) = 180 AND bool_and(d.ledger_id IS NULL)
  FROM public.credit_lot_draws d JOIN public.credit_lots o ON o.id = d.lot_id
  WHERE o.user_id = '00000000-0000-4000-8000-00000000c002' AND d.reason = 'repayment'), 'the repayment is one draw of 180');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.credit_ledger WHERE user_id = '00000000-0000-4000-8000-00000000c002')
  = (SELECT n FROM debt_ledger_before) + 1, 'only the +2,000 grant is a ledger entry; the repayment is not');
SELECT pg_temp.assert_true(pg_temp.balance('00000000-0000-4000-8000-00000000c002')
  = (SELECT sum(credits) FROM public.credit_ledger WHERE user_id = '00000000-0000-4000-8000-00000000c002'),
  'the ledger still sums to the balance');
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c002',
  pg_temp.turn('00000000-0000-4000-8000-00000000c002', 'd3', 'complete'), 'chat_answer', 'success', 0.01);
SELECT public.settle_turn_credits('00000000-0000-4000-8000-00000000c002', 'd3');
SELECT pg_temp.assert_true((SELECT usd_to_inr = 95 AND credits = -9.5 FROM public.credit_ledger
  WHERE user_id = '00000000-0000-4000-8000-00000000c002' AND turn_key = 'd3'), 'a rate change applies to later charges only');
SELECT pg_temp.invariants('debt repaid');

-- 5. What is charged (§3.1) -------------------------------------------------------------
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c003');
SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c003', 10000, 'topup', 'Fixture credits',
  '00000000-0000-4000-8000-00000000c0ff', 'a0000000-0000-4000-8000-000000000003');
INSERT INTO res VALUES ('chg.a', public.reserve_turn_credits('00000000-0000-4000-8000-00000000c003', 'c_complete', true));
INSERT INTO res VALUES ('chg.b', public.reserve_turn_credits('00000000-0000-4000-8000-00000000c003', 'c_trunc', true));
SELECT pg_temp.assert_true(pg_temp.r('chg.a') @> '{"ok": true, "hold": {"credits": 300}}'
  AND pg_temp.r('chg.b') @> '{"ok": true, "hold": {"credits": 300}, "available": 9700}',
  'at a healthy balance answers run side by side, each holding 300');
CREATE TEMP TABLE chg (k text PRIMARY KEY, msg uuid);
INSERT INTO chg VALUES
  ('c_complete', pg_temp.turn('00000000-0000-4000-8000-00000000c003', 'c_complete', 'complete')),
  ('c_trunc', pg_temp.turn('00000000-0000-4000-8000-00000000c003', 'c_trunc', 'truncated')),
  ('c_cancel', pg_temp.turn('00000000-0000-4000-8000-00000000c003', 'c_cancel', 'cancelled', '')),
  ('c_err_empty', pg_temp.turn('00000000-0000-4000-8000-00000000c003', 'c_err_empty', 'error', '  ')),
  ('c_err_text', pg_temp.turn('00000000-0000-4000-8000-00000000c003', 'c_err_text', 'error', 'Part of an answer')),
  ('c_int_empty', pg_temp.turn('00000000-0000-4000-8000-00000000c003', 'c_int_empty', 'interrupted', '')),
  ('c_int_text', pg_temp.turn('00000000-0000-4000-8000-00000000c003', 'c_int_text', 'interrupted', 'Part of an answer')),
  ('c_repair', pg_temp.turn('00000000-0000-4000-8000-00000000c003', 'c_repair', 'complete')),
  ('c_nocost', pg_temp.turn('00000000-0000-4000-8000-00000000c003', 'c_nocost', 'complete')),
  ('c_running', pg_temp.turn('00000000-0000-4000-8000-00000000c003', 'c_running', 'running', '')),
  ('c_overdue', pg_temp.turn('00000000-0000-4000-8000-00000000c003', 'c_overdue', 'running', '', NULL, now() - interval '1 second'));
-- complete: success, embedding and aborted rows count; repair, error and uncosted rows never.
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c003', msg, 'chat_answer', 'success', 0.01) FROM chg WHERE k = 'c_complete';
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c003', msg, 'embedding', 'success', 0.001) FROM chg WHERE k = 'c_complete';
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c003', msg, 'chat_answer', 'aborted', 0.002) FROM chg WHERE k = 'c_complete';
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c003', msg, 'citation_repair', 'success', 0.005) FROM chg WHERE k = 'c_complete';
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c003', msg, 'chat_answer', 'error', 0.003) FROM chg WHERE k = 'c_complete';
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c003', msg, 'chat_answer', 'success', NULL) FROM chg WHERE k = 'c_complete';
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c003', msg, 'chat_answer', 'success', 0.004) FROM chg WHERE k = 'c_trunc';
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c003', msg, 'chat_answer', 'success', 0.002) FROM chg WHERE k = 'c_cancel';
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c003', msg, 'chat_answer', 'aborted', 0.001) FROM chg WHERE k = 'c_cancel';
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c003', msg, 'chat_answer', 'success', 0.01) FROM chg
  WHERE k IN ('c_err_empty', 'c_err_text', 'c_int_empty', 'c_int_text', 'c_running', 'c_overdue');
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c003', msg, 'citation_repair', 'success', 0.02) FROM chg WHERE k = 'c_repair';
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c003', msg, 'chat_answer', 'success', NULL) FROM chg WHERE k = 'c_nocost';
INSERT INTO res SELECT 'chg.' || k, public.settle_turn_credits('00000000-0000-4000-8000-00000000c003', k) FROM chg;
SELECT pg_temp.assert_true(pg_temp.r('chg.c_complete') @> '{"state": "charged", "credits": 12.35}',
  'complete: chat_answer and embedding rows, success or aborted, with a cost (12.35 = $0.013 x 950)');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.credit_charge_rows c JOIN public.model_call_logs l ON l.id = c.model_call_log_id
  WHERE l.message_id = (SELECT msg FROM chg WHERE k = 'c_complete')) = 3, 'complete: exactly the three chargeable rows are recorded');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.credit_charge_rows c JOIN public.model_call_logs l ON l.id = c.model_call_log_id
  WHERE l.purpose = 'citation_repair' OR l.status = 'error' OR l.cost_usd IS NULL), 'repair, error and uncosted rows are never charged');
SELECT pg_temp.assert_true(pg_temp.r('chg.c_trunc') @> '{"state": "charged", "credits": 3.8}', 'truncated: charged');
SELECT pg_temp.assert_true(pg_temp.r('chg.c_cancel') @> '{"state": "charged", "credits": 2.85}',
  'cancelled (Stop): everything spent up to Stop, including the aborted round');
SELECT pg_temp.assert_true(pg_temp.r('chg.c_err_empty') @> '{"state": "free", "credits": 0}', 'error with no saved text: free');
SELECT pg_temp.assert_true(pg_temp.r('chg.c_err_text') @> '{"state": "charged", "credits": 9.5}', 'error with saved text: charged');
SELECT pg_temp.assert_true(pg_temp.r('chg.c_int_empty') @> '{"state": "free", "credits": 0}', 'interrupted with no saved text: free');
SELECT pg_temp.assert_true(pg_temp.r('chg.c_int_text') @> '{"state": "charged", "credits": 9.5}', 'interrupted with saved text: charged');
SELECT pg_temp.assert_true(pg_temp.r('chg.c_repair') @> '{"credits": 0}' AND pg_temp.turn_charged('00000000-0000-4000-8000-00000000c003', 'c_repair') = 0,
  'a turn with only a repair row costs nothing');
SELECT pg_temp.assert_true(pg_temp.r('chg.c_nocost') @> '{"credits": 0}', 'a success row with no cost is not charged as zero or anything else');
SELECT pg_temp.assert_true(pg_temp.r('chg.c_running') = '{"state": "pending"}'::jsonb
  AND pg_temp.turn_charged('00000000-0000-4000-8000-00000000c003', 'c_running') = 0, 'running inside its deadline: pending, nothing charged');
SELECT pg_temp.assert_true(pg_temp.r('chg.c_overdue') @> '{"state": "free", "credits": 0}',
  'running past its deadline settles as interrupted (no text: free)');
SELECT pg_temp.assert_true(pg_temp.balance('00000000-0000-4000-8000-00000000c003') = 10000 - 12.35 - 3.8 - 2.85 - 9.5 - 9.5,
  'the wallet moved by exactly the charged turns');
SELECT pg_temp.invariants('what is charged');

-- 5b. A negative cost is ignored, not charged and not fatal (review M4) ----------------------
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c028');
SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c028', 100, 'topup', 'Fixture credits', '00000000-0000-4000-8000-00000000c0ff',
  'a0000000-0000-4000-8000-000000000028');
SELECT public.reserve_turn_credits('00000000-0000-4000-8000-00000000c028', 'n1', true);
CREATE TEMP TABLE neg AS SELECT pg_temp.turn('00000000-0000-4000-8000-00000000c028', 'n1', 'complete') AS msg;
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c028', msg, 'chat_answer', 'success', 0.01) FROM neg;
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c028', msg, 'chat_answer', 'success', -0.5) FROM neg;
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c028', msg, 'embedding', 'success', -0.1) FROM neg;
INSERT INTO res VALUES ('neg.settle', public.settle_turn_credits('00000000-0000-4000-8000-00000000c028', 'n1'));
SELECT pg_temp.assert_true(pg_temp.r('neg.settle') @> '{"state": "charged", "credits": 9.5, "balance": 90.5}'
  AND NOT EXISTS (SELECT FROM public.credit_charge_rows c JOIN public.model_call_logs l ON l.id = c.model_call_log_id
                  WHERE l.cost_usd < 0), 'a row with a negative cost is neither charged nor fatal');
UPDATE public.credit_holds SET expires_at = now() - interval '1 second' WHERE user_id = '00000000-0000-4000-8000-00000000c028';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c028', true);
INSERT INTO res VALUES ('neg.mine', public.my_credits());
RESET ROLE;
SELECT pg_temp.assert_true((pg_temp.r('neg.mine') ->> 'balance')::numeric = 90.5
  AND (SELECT swept_at IS NOT NULL FROM public.credit_holds WHERE user_id = '00000000-0000-4000-8000-00000000c028'),
  'the user''s refresh and sweep keep working over the negative row');
SELECT pg_temp.invariants('negative cost');

-- 6. Settle and sweep ----------------------------------------------------------------------
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c004');
SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c004', 1000, 'topup', 'Fixture credits',
  '00000000-0000-4000-8000-00000000c0ff', 'a0000000-0000-4000-8000-000000000004');
SELECT public.reserve_turn_credits('00000000-0000-4000-8000-00000000c004', 'l1', true);
CREATE TEMP TABLE late (k text PRIMARY KEY, msg uuid);
INSERT INTO late VALUES ('l1', pg_temp.turn('00000000-0000-4000-8000-00000000c004', 'l1', 'complete'));
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c004', msg, 'chat_answer', 'success', 0.01) FROM late WHERE k = 'l1';
INSERT INTO res VALUES ('late.s1', public.settle_turn_credits('00000000-0000-4000-8000-00000000c004', 'l1'));
CREATE TEMP TABLE late_ledger AS SELECT count(*) AS n FROM public.credit_ledger WHERE user_id = '00000000-0000-4000-8000-00000000c004';
INSERT INTO res VALUES ('late.s2', public.settle_turn_credits('00000000-0000-4000-8000-00000000c004', 'l1'));
SELECT pg_temp.assert_true(pg_temp.r('late.s1') @> '{"state": "charged", "credits": 9.5, "balance": 990.5}'
  AND pg_temp.r('late.s2') = pg_temp.r('late.s1')
  AND (SELECT count(*) FROM public.credit_ledger WHERE user_id = '00000000-0000-4000-8000-00000000c004') = (SELECT n FROM late_ledger),
  'settle is idempotent: the same answer, no new entry');
-- A row that commits after the settle: the sweep leaves it until the hold expires.
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c004', msg, 'chat_answer', 'success', 0.02) FROM late WHERE k = 'l1';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c004', true);
INSERT INTO res VALUES ('late.read1', public.my_credits());
RESET ROLE;
SELECT pg_temp.assert_true((pg_temp.r('late.read1') ->> 'balance')::numeric = 990.5
  AND (SELECT swept_at IS NULL FROM public.credit_holds WHERE turn_key = 'l1'), 'before the hold expires the sweep does not touch it');
UPDATE public.credit_holds SET expires_at = now() - interval '1 second'
  WHERE user_id = '00000000-0000-4000-8000-00000000c004' AND turn_key = 'l1';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c004', true);
INSERT INTO res VALUES ('late.read2', public.my_credits());
INSERT INTO res VALUES ('late.read3', public.my_credits());
RESET ROLE;
SELECT pg_temp.assert_true((pg_temp.r('late.read2') ->> 'balance')::numeric = 971.5
  AND (SELECT swept_at = now() FROM public.credit_holds WHERE turn_key = 'l1'), 'after expiry the sweep charges the late row');
SELECT pg_temp.assert_true((pg_temp.r('late.read3') ->> 'balance')::numeric = 971.5
  AND pg_temp.turn_charged('00000000-0000-4000-8000-00000000c004', 'l1') = 28.5
  AND (SELECT count(*) FROM public.credit_ledger WHERE user_id = '00000000-0000-4000-8000-00000000c004' AND turn_key = 'l1') = 2,
  'the late row is charged once');
SELECT public.reserve_turn_credits('00000000-0000-4000-8000-00000000c004', 'l9', true);
SELECT pg_temp.assert_true(pg_temp.turn_charged('00000000-0000-4000-8000-00000000c004', 'l1') = 28.5, 'a later reserve does not charge it again');
-- A conversation deleted before the log flush is still charged from its logs.
SELECT public.reserve_turn_credits('00000000-0000-4000-8000-00000000c004', 'l2', true);
INSERT INTO late VALUES ('l2', pg_temp.turn('00000000-0000-4000-8000-00000000c004', 'l2', 'complete'));
DELETE FROM public.conversations WHERE id = (SELECT conversation_id FROM public.research_turns
  WHERE user_id = '00000000-0000-4000-8000-00000000c004' AND turn_key = 'l2');
SELECT pg_temp.assert_true((SELECT assistant_message_id IS NULL AND conversation_id IS NULL FROM public.research_turns
  WHERE user_id = '00000000-0000-4000-8000-00000000c004' AND turn_key = 'l2'), 'deleting the conversation unlinks the turn');
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c004', msg, 'chat_answer', 'success', 0.01) FROM late WHERE k = 'l2';
INSERT INTO res VALUES ('late.del', public.settle_turn_credits('00000000-0000-4000-8000-00000000c004', 'l2'));
SELECT pg_temp.assert_true(pg_temp.r('late.del') @> '{"state": "charged", "credits": 9.5}', 'a deleted conversation is charged from its logs');
-- Reading credits back, as the user.
CREATE TEMP TABLE late_conv AS SELECT conversation_id FROM public.research_turns
  WHERE turn_key = 'l1' AND user_id = '00000000-0000-4000-8000-00000000c004';
GRANT SELECT ON late_conv TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c004', true);
INSERT INTO res VALUES ('late.mine', public.my_credits());
INSERT INTO res SELECT 'late.conv', public.my_conversation_credits(conversation_id) FROM late_conv;
SELECT pg_temp.rejected($q$SELECT * FROM public.credit_ledger$q$, '42501', 'a user cannot read the ledger');
SELECT pg_temp.rejected($q$SELECT * FROM public.credit_wallets$q$, '42501', 'a user cannot read wallets');
SELECT pg_temp.rejected($q$SELECT * FROM public.model_call_logs$q$, '42501', 'a user can no longer read model_call_logs');
SELECT pg_temp.rejected($q$SELECT * FROM public.chat_turn_traces$q$, '42501', 'a user can no longer read chat_turn_traces');
SELECT pg_temp.rejected($q$SELECT public.settle_turn_credits('00000000-0000-4000-8000-00000000c004', 'l1')$q$, '42501',
  'a user cannot settle');
SELECT pg_temp.rejected($q$SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c004', 1000, 'topup', 'x',
  '00000000-0000-4000-8000-00000000c004', gen_random_uuid())$q$, '42501', 'a user cannot grant themselves credits');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c001', true);
INSERT INTO res SELECT 'late.conv.other', public.my_conversation_credits(conversation_id) FROM late_conv;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.rejected($q$SELECT public.my_credits()$q$, '42501', 'my_credits needs a signed-in user');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.rejected($q$SELECT public.my_credits()$q$, '42501', 'anon cannot read credits');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.r('late.mine')) k)
  = ARRAY['balance', 'cycle', 'debt', 'held', 'inr_per_credit', 'lots', 'plan', 'recent', 'used_this_cycle'],
  'my_credits returns the §12 keys');
SELECT pg_temp.assert_true((pg_temp.r('late.mine') - 'inr_per_credit')::text !~* '(usd|cost|rate|inr)',
  'my_credits carries no dollars and no exchange rate');
SELECT pg_temp.assert_true((pg_temp.r('late.mine') ->> 'inr_per_credit')::numeric = 0.10,
  'my_credits gives the published rupees per credit for the rupee hint');
SELECT pg_temp.assert_true(pg_temp.r('late.mine') @> '{"balance": 962, "held": 300, "debt": 0, "plan": "free"}',
  'my_credits: balance, held (the unsettled l9 hold), debt and plan');
SELECT pg_temp.assert_true(pg_temp.r('late.mine') -> 'lots' = jsonb_build_array(jsonb_build_object('kind', 'topup', 'remaining', 962,
  'expires_at', (SELECT expires_at FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c004'))),
  'my_credits lists the lots with kind, remaining and expiry');
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.r('late.mine') -> 'recent') = 2
  AND pg_temp.r('late.mine') -> 'recent' @> jsonb_build_array(jsonb_build_object('credits', 28.5, 'title', 'Conversation l1'),
                                                             jsonb_build_object('credits', 9.5, 'conversation_id', NULL)),
  'my_credits lists recent charged answers, a deleted conversation without a title');
SELECT pg_temp.assert_true(pg_temp.r('late.conv') = jsonb_build_array(jsonb_build_object('message_id', (SELECT msg FROM late WHERE k = 'l1'),
  'credits', 28.5)), 'my_conversation_credits gives the credits per answer');
SELECT pg_temp.assert_true(pg_temp.r('late.conv.other') = '[]'::jsonb, 'another user reads nothing of that conversation');
SELECT pg_temp.invariants('settle and sweep');

-- 7. Lot order --------------------------------------------------------------------------------
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c005');
SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c005', 100, 'topup', 'Fixture top-up',
  '00000000-0000-4000-8000-00000000c0ff', 'a0000000-0000-4000-8000-000000000051');
SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c005', 100, 'adjustment', 'Fixture adjustment',
  '00000000-0000-4000-8000-00000000c0ff', 'a0000000-0000-4000-8000-000000000052');
SELECT pg_temp.assert_true((SELECT expires_at = now() + interval '12 months' FROM public.credit_lots
  WHERE user_id = '00000000-0000-4000-8000-00000000c005' AND kind = 'adjustment'), 'an adjustment lot is valid 12 months');
UPDATE public.credit_lots SET expires_at = now() + interval '20 days'
  WHERE user_id = '00000000-0000-4000-8000-00000000c005' AND kind = 'adjustment';
SET LOCAL ROLE service_role;
SELECT public.grant_manual_plan('00000000-0000-4000-8000-00000000c005', 'plus', NULL, '00000000-0000-4000-8000-00000000c0ff');
RESET ROLE;
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c005',
  pg_temp.turn('00000000-0000-4000-8000-00000000c005', 'o1', 'complete'), 'chat_answer', 'success', 0.15);  -- 142.5
SELECT public.settle_turn_credits('00000000-0000-4000-8000-00000000c005', 'o1');
SELECT pg_temp.assert_true((SELECT jsonb_object_agg(kind, remaining) FROM public.credit_lots
  WHERE user_id = '00000000-0000-4000-8000-00000000c005') = '{"adjustment": 0, "monthly": 1957.5, "topup": 100}'::jsonb,
  'spending draws the earliest-expiring usable lot first: adjustment (20 days), then monthly, top-up untouched');
SELECT pg_temp.invariants('lot order');

-- 8. Payments: one lot each, early renewal, upgrade, admin to Free ---------------------
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c006');
SET LOCAL ROLE service_role;
SELECT public.grant_paid_plan('00000000-0000-4000-8000-00000000c006', 'plus', 'month', 'p6_1');
SELECT public.grant_paid_plan('00000000-0000-4000-8000-00000000c006', 'plus', 'month', 'p6_2');
SELECT public.grant_paid_plan('00000000-0000-4000-8000-00000000c006', 'plus', 'month', 'p6_1');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND min(source_key) = 'grant:' || (SELECT id FROM public.plan_grants WHERE payment_id = 'p6_1')
    AND min(expires_at) = now() + interval '1 month' AND min(granted) = 2000
  FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c006'), 'a payment mints exactly one lot, for its own month');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM private.credit_due_cycles('00000000-0000-4000-8000-00000000c006', now())
    WHERE source_key = 'grant:' || (SELECT id FROM public.plan_grants WHERE payment_id = 'p6_2')),
  'an early renewal''s lot is not usable before its base');
SELECT pg_temp.assert_true((SELECT starts_at = now() + interval '1 month' AND expires_at = now() + interval '1 month' + interval '1 month'
  FROM private.credit_due_cycles('00000000-0000-4000-8000-00000000c006', now() + interval '1 month')
  WHERE source_key = 'grant:' || (SELECT id FROM public.plan_grants WHERE payment_id = 'p6_2')),
  'the renewal''s cycle starts where the paid month ends');
SET LOCAL ROLE service_role;
SELECT public.grant_paid_plan('00000000-0000-4000-8000-00000000c006', 'pro', 'month', 'p6_3');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT jsonb_object_agg(plan, remaining) FROM public.credit_lots
  WHERE user_id = '00000000-0000-4000-8000-00000000c006' AND closed_at IS NULL) = '{"plus": 2000, "pro": 6500}'::jsonb
  AND pg_temp.balance('00000000-0000-4000-8000-00000000c006') = 8500, 'a paid upgrade keeps the old lot to its own expiry');
SET LOCAL ROLE service_role;
SELECT public.grant_manual_plan('00000000-0000-4000-8000-00000000c006', 'free', NULL, '00000000-0000-4000-8000-00000000c0ff');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c006'
    AND (closed_at IS NULL OR kind = 'rollover'))
  AND pg_temp.balance('00000000-0000-4000-8000-00000000c006') = 0
  AND (SELECT sum(credits) FROM public.credit_ledger WHERE user_id = '00000000-0000-4000-8000-00000000c006' AND kind = 'expiry') = -8500,
  'an admin grant to Free ends the open monthly lots at once, with no rollover');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM private.credit_due_cycles('00000000-0000-4000-8000-00000000c006', now() + interval '1 month 1 day')),
  'the queued renewal is not minted after the admin took the plan away');
SELECT pg_temp.invariants('payments');

-- 9. Admin switching plans cannot mint credits ------------------------------------------
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c00b');
SET LOCAL ROLE service_role;
SELECT public.grant_manual_plan('00000000-0000-4000-8000-00000000c00b', 'plus', NULL, '00000000-0000-4000-8000-00000000c0ff');
SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c00b', -500, 'adjustment', 'Fixture removal',
  '00000000-0000-4000-8000-00000000c0ff', 'a0000000-0000-4000-8000-0000000000b1');
SELECT public.grant_manual_plan('00000000-0000-4000-8000-00000000c00b', 'pro', NULL, '00000000-0000-4000-8000-00000000c0ff');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT jsonb_object_agg(plan, remaining) FROM public.credit_lots
  WHERE user_id = '00000000-0000-4000-8000-00000000c00b' AND closed_at IS NULL) = '{"pro": 6500}'::jsonb
  AND (SELECT credits FROM public.credit_ledger e JOIN public.credit_lots o ON o.id = e.lot_id
       WHERE e.user_id = '00000000-0000-4000-8000-00000000c00b' AND e.kind = 'expiry' AND o.plan = 'plus') = -1500,
  'an admin grant to another plan ends the open monthly lot (1,500 left) at once');
SET LOCAL ROLE service_role;
SELECT public.grant_manual_plan('00000000-0000-4000-8000-00000000c00b', 'plus', NULL, '00000000-0000-4000-8000-00000000c0ff');
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.balance('00000000-0000-4000-8000-00000000c00b') = 2000
  AND NOT EXISTS (SELECT FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c00b' AND kind = 'rollover'),
  'switching back and forth leaves one month''s credits and no rollover');
SELECT pg_temp.invariants('admin switches');

-- 10. Cycles over time -----------------------------------------------------------------------
-- A plan paid on 31 January, renewed early: each lot is exactly its payment's month.
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c007');
INSERT INTO public.plan_grants (user_id, plan, status, period_end, source, payment_id, created_at) VALUES
  ('00000000-0000-4000-8000-00000000c007', 'plus', 'active', '2026-02-28 10:00+00', 'payment', 'jan_1', '2026-01-31 10:00+00'),
  ('00000000-0000-4000-8000-00000000c007', 'plus', 'active', '2026-03-28 10:00+00', 'payment', 'jan_2', '2026-02-20 09:00+00');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c007', '2026-02-10 00:00+00');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c007', '2026-03-01 00:00+00');
SELECT pg_temp.assert_true((SELECT array_agg(starts_at || '..' || expires_at ORDER BY starts_at) FROM public.credit_lots
  WHERE user_id = '00000000-0000-4000-8000-00000000c007' AND kind = 'monthly')
  = ARRAY['2026-01-31 10:00:00+00..2026-02-28 10:00:00+00', '2026-02-28 10:00:00+00..2026-03-28 10:00:00+00'],
  'a plan paid on 31 January: the lots are the paid months back to back, nothing drifts or overlaps');
-- A manual grant made on 31 January: cycles are anchored to the grant, so month ends never drift.
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c008');
INSERT INTO public.plan_grants (user_id, plan, status, period_end, source, created_at)
  VALUES ('00000000-0000-4000-8000-00000000c008', 'plus', 'active', NULL, 'manual', '2026-01-31 10:00+00');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c008', '2026-03-30 00:00+00');
SELECT pg_temp.assert_true((SELECT starts_at = '2026-02-28 10:00+00' AND expires_at = '2026-03-31 10:00+00'
  FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c008'
    AND source_key = 'grant:' || (SELECT id FROM public.plan_grants WHERE user_id = '00000000-0000-4000-8000-00000000c008') || ':1'),
  'manual cycle 1 from 31 January runs 28 February to 31 March');
-- Mint cycle 8 at a fixed time: the insert trigger refreshes at now(), which is not always inside cycle 8.
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c008', '2026-10-15 00:00+00');
SELECT pg_temp.assert_true((SELECT starts_at = '2026-09-30 10:00+00' AND expires_at = '2026-10-31 10:00+00'
  FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c008'
    AND source_key = 'grant:' || (SELECT id FROM public.plan_grants WHERE user_id = '00000000-0000-4000-8000-00000000c008') || ':8'),
  'manual cycle 8 still ends on the 31st (no drift after short months)');
-- Away for three months: only the current cycle is minted.
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c009');
INSERT INTO public.plan_grants (user_id, plan, status, period_end, source, created_at)
  VALUES ('00000000-0000-4000-8000-00000000c009', 'pro', 'active', NULL, 'manual', now() - interval '3 months 5 days');
-- Expect the grant's own date + 3 months: now() - '3 months 5 days' clamps at month ends, so now() - 5 days is not always it.
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND min(source_key) LIKE 'grant:%:3'
    AND min(starts_at) = (SELECT created_at + interval '3 months' FROM public.plan_grants WHERE user_id = '00000000-0000-4000-8000-00000000c009')
  FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c009'),
  'a user away for three months gets the current cycle only');
-- Re-subscribing after a lapse, rollover, and a rollover never rolls.
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c00a');
INSERT INTO public.plan_grants (user_id, plan, status, period_end, source, payment_id, created_at) VALUES
  ('00000000-0000-4000-8000-00000000c00a', 'plus', 'active', '2026-02-01 00:00+00', 'payment', 'rs_1', '2026-01-01 00:00+00'),
  ('00000000-0000-4000-8000-00000000c00a', 'plus', 'active', '2026-04-10 00:00+00', 'payment', 'rs_2', '2026-03-10 00:00+00');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c00a', '2026-01-05 00:00+00');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c00a', '2026-01-06 00:00+00');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c00a') = 1,
  'refreshing again mints nothing more for the same payment');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c00a', '2026-02-15 00:00+00');
SELECT pg_temp.assert_true((SELECT granted = 200 AND remaining = 200 AND starts_at = '2026-02-01 00:00+00'
    AND expires_at = '2026-03-01 00:00+00' AND closed_at IS NULL
  FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c00a' AND kind = 'rollover'),
  '10% of the unused 2,000 rolls over for one month, even after the plan lapsed');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c00a', '2026-03-11 00:00+00');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c00a', '2026-03-12 00:00+00');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c00a' AND kind = 'rollover') = 1
  AND (SELECT closed_at IS NOT NULL FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c00a' AND kind = 'rollover'),
  'the rollover lot expires and never rolls again');
SELECT pg_temp.assert_true((SELECT array_agg(source_key || '@' || starts_at ORDER BY starts_at) FROM public.credit_lots
  WHERE user_id = '00000000-0000-4000-8000-00000000c00a' AND kind = 'monthly')
  = ARRAY['grant:' || (SELECT id FROM public.plan_grants WHERE payment_id = 'rs_1') || '@2026-01-01 00:00:00+00',
          'grant:' || (SELECT id FROM public.plan_grants WHERE payment_id = 'rs_2') || '@2026-03-10 00:00:00+00'],
  're-subscribing after a lapse is one new lot starting on the payment day');
SELECT pg_temp.assert_true(pg_temp.balance('00000000-0000-4000-8000-00000000c00a') = 2000, 'after the lapse only the new month remains');
-- Two payments whose transactions started in one order and took the profile
-- lock in the other: plan_grants.id is the lock order (review I1).
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c022');
INSERT INTO public.plan_grants (user_id, plan, status, period_end, source, payment_id, created_at) VALUES
  ('00000000-0000-4000-8000-00000000c022', 'plus', 'active', '2026-02-01 00:00+00', 'payment', 'i1_0', '2026-01-01 00:00+00');
INSERT INTO public.plan_grants (user_id, plan, status, period_end, source, payment_id, created_at) VALUES
  ('00000000-0000-4000-8000-00000000c022', 'plus', 'active', '2026-03-01 00:00+00', 'payment', 'i1_locked_first', '2026-01-20 00:00:00.002+00');
INSERT INTO public.plan_grants (user_id, plan, status, period_end, source, payment_id, created_at) VALUES
  ('00000000-0000-4000-8000-00000000c022', 'plus', 'active', '2026-04-01 00:00+00', 'payment', 'i1_started_first', '2026-01-20 00:00:00.001+00');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c022', '2026-01-21 00:00+00');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c022', '2026-02-15 00:00+00');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c022', '2026-03-15 00:00+00');
SELECT pg_temp.assert_true((SELECT array_agg(starts_at || '..' || expires_at ORDER BY starts_at) FROM public.credit_lots
  WHERE user_id = '00000000-0000-4000-8000-00000000c022' AND kind = 'monthly')
  = ARRAY['2026-01-01 00:00:00+00..2026-02-01 00:00:00+00', '2026-02-01 00:00:00+00..2026-03-01 00:00:00+00',
          '2026-03-01 00:00:00+00..2026-04-01 00:00:00+00'],
  'payments are ordered by plan_grants.id (lock order), not created_at: both paid months mint');
-- A manual plan paid for early: the manual months run until the paid month
-- starts, with no gap (review I2).
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c023');
INSERT INTO public.plan_grants (user_id, plan, status, period_end, source, created_at)
  VALUES ('00000000-0000-4000-8000-00000000c023', 'plus', 'active', '2026-04-01 00:00+00', 'manual', '2026-01-01 00:00+00');
INSERT INTO public.plan_grants (user_id, plan, status, period_end, source, payment_id, created_at)
  VALUES ('00000000-0000-4000-8000-00000000c023', 'plus', 'active', '2026-05-01 00:00+00', 'payment', 'i2_pay', '2026-01-10 00:00+00');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c023', '2026-01-05 00:00+00');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c023', '2026-01-15 00:00+00');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c023', '2026-02-15 00:00+00');
SELECT pg_temp.assert_true(EXISTS (SELECT FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c023' AND kind = 'monthly'
  AND closed_at IS NULL AND starts_at <= '2026-02-15 00:00+00' AND expires_at > '2026-02-15 00:00+00'),
  'on 15 February the manual plan''s monthly lot exists although a payment was made on 10 January');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c023', '2026-03-15 00:00+00');
SELECT pg_temp.assert_true(EXISTS (SELECT FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c023' AND kind = 'monthly'
  AND closed_at IS NULL AND starts_at <= '2026-03-15 00:00+00' AND expires_at > '2026-03-15 00:00+00'),
  'on 15 March as well');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c023', '2026-04-02 00:00+00');
SELECT pg_temp.assert_true((SELECT array_agg(source_key ~ '^grant:[0-9]+:[0-9]+$' ORDER BY starts_at) = ARRAY[true, true, true, false]
    AND array_agg(starts_at ORDER BY starts_at) = ARRAY['2026-01-01 00:00+00', '2026-02-01 00:00+00', '2026-03-01 00:00+00',
                                                         '2026-04-01 00:00+00']::timestamptz[]
    AND max(expires_at) = '2026-05-01 00:00+00'
  FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c023' AND kind = 'monthly'),
  'three manual months, then from 1 April the paid month, back to back');
-- A rollover that would already be expired when processed is not minted (review M7).
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c024');
INSERT INTO public.plan_grants (user_id, plan, status, period_end, source, payment_id, created_at)
  VALUES ('00000000-0000-4000-8000-00000000c024', 'plus', 'active', '2026-02-01 00:00+00', 'payment', 'm7a', '2026-01-01 00:00+00');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c024', '2026-01-05 00:00+00');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c024', '2026-03-05 00:00+00');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c024' AND kind = 'rollover')
  AND (SELECT sum(credits) FROM public.credit_ledger WHERE user_id = '00000000-0000-4000-8000-00000000c024' AND kind = 'expiry') = -2000,
  'processed after its rollover month had passed, an expired lot rolls nothing over');
-- A manual cycle's lot rolls over like a paid one (review M7).
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c025');
INSERT INTO public.plan_grants (user_id, plan, status, period_end, source, created_at)
  VALUES ('00000000-0000-4000-8000-00000000c025', 'pro', 'active', NULL, 'manual', now() - interval '1 month 5 days');
CREATE TEMP TABLE m7b AS SELECT id, expires_at FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c025' AND kind = 'monthly';
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c025', now() + interval '27 days');
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND min(o.granted) = 650 AND min(o.plan::text) = 'pro'
    AND min(o.source_key) = 'rollover:' || (SELECT id FROM m7b)
    AND min(o.starts_at) = (SELECT expires_at FROM m7b) AND min(o.expires_at) = (SELECT expires_at + interval '1 month' FROM m7b)
  FROM public.credit_lots o WHERE o.user_id = '00000000-0000-4000-8000-00000000c025' AND o.kind = 'rollover')
  AND (SELECT count(*) FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c025' AND kind = 'monthly') = 2,
  'a manual cycle''s lot rolls 10% over at its natural expiry, and the next cycle mints');
SELECT pg_temp.invariants('cycles');

-- 11. Launch backfill ---------------------------------------------------------------------
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c00c');
UPDATE public.user_profiles SET plan = 'pro', plan_status = 'active', plan_source = 'manual', plan_period_end = now() + interval '40 days'
  WHERE user_id = '00000000-0000-4000-8000-00000000c00c';
SELECT private.credit_launch_backfill();
SELECT private.credit_launch_backfill();
SELECT pg_temp.assert_true((SELECT array_agg(user_id ORDER BY user_id) FROM private.credit_launch_grants)
  = ARRAY['00000000-0000-4000-8000-00000000c00c', '00000000-0000-4000-8000-00000000c0a1']::uuid[],
  'only a paid profile with no plan_grants row is backfilled, once');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c00c', true);
INSERT INTO res VALUES ('launch.mine', public.my_credits());
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND min(granted) = 6500 AND min(source_key) = 'launch:0'
    AND min(starts_at) = (SELECT launch_at FROM public.credit_settings)
    AND min(expires_at) = (SELECT launch_at + interval '1 month' FROM public.credit_settings)
  FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c00c'),
  'a paid plan at launch with no plan_grants row gets its current cycle');
SELECT pg_temp.assert_true(pg_temp.r('launch.mine') @> '{"plan": "pro", "balance": 6500, "cycle": {"allowance": 6500}}'
  AND (pg_temp.r('launch.mine') -> 'cycle' ->> 'ends_at')::timestamptz = (SELECT launch_at + interval '1 month' FROM public.credit_settings),
  'my_credits shows the cycle allowance and end');
-- Launch backfill, then a payment for the same plan: the launch months run
-- until the paid month starts at the old period end (review M7, I2).
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c026');
UPDATE public.user_profiles SET plan = 'pro', plan_status = 'active', plan_source = 'manual', plan_period_end = now() + interval '40 days'
  WHERE user_id = '00000000-0000-4000-8000-00000000c026';
SELECT private.credit_launch_backfill();
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c026', now());
SET LOCAL ROLE service_role;
SELECT public.grant_paid_plan('00000000-0000-4000-8000-00000000c026', 'pro', 'month', 'm7_l26');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT array_agg(source_key) FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c026' AND closed_at IS NULL)
  = ARRAY['launch:0'], 'a payment during the launch grant keeps the launch lot and waits for the old period end');
SELECT pg_temp.assert_true(EXISTS (SELECT FROM private.credit_due_cycles('00000000-0000-4000-8000-00000000c026',
    (SELECT launch_at + interval '1 month 1 day' FROM public.credit_settings)) WHERE source_key = 'launch:1')
  AND (SELECT array_agg(source_key || '@' || (starts_at = now() + interval '40 days'))
       FROM private.credit_due_cycles('00000000-0000-4000-8000-00000000c026', now() + interval '41 days'))
      = ARRAY['grant:' || (SELECT id FROM public.plan_grants WHERE payment_id = 'm7_l26') || '@true'],
  'the launch months continue up to the old period end, then the paid month starts there');
-- Launch backfill, then an admin grant: the launch lot ends with no rollover.
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c027');
UPDATE public.user_profiles SET plan = 'plus', plan_status = 'active', plan_source = 'manual', plan_period_end = NULL
  WHERE user_id = '00000000-0000-4000-8000-00000000c027';
SELECT private.credit_launch_backfill();
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c027', now());
SET LOCAL ROLE service_role;
SELECT public.grant_manual_plan('00000000-0000-4000-8000-00000000c027', 'max', NULL, '00000000-0000-4000-8000-00000000c0ff');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT jsonb_object_agg(source_key LIKE 'launch:%', closed_at IS NULL) FROM public.credit_lots
    WHERE user_id = '00000000-0000-4000-8000-00000000c027') = '{"true": false, "false": true}'::jsonb
  AND pg_temp.balance('00000000-0000-4000-8000-00000000c027') = 75000
  AND NOT EXISTS (SELECT FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c027' AND kind = 'rollover')
  AND NOT EXISTS (SELECT FROM private.credit_due_cycles('00000000-0000-4000-8000-00000000c027', now() + interval '2 months') WHERE source_key LIKE 'launch:%'),
  'an admin grant after the launch backfill ends the launch lot (no rollover) and its months');
SELECT pg_temp.invariants('launch backfill');

-- 12. Signup lot ----------------------------------------------------------------------------
UPDATE public.credit_settings SET launch_at = now() - interval '10 days';
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c011', true, now() - interval '1 year');
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c012', true, now() - interval '5 days');
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c013', false, now() - interval '1 day');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c011', true);
SELECT public.my_credits();
SELECT public.my_credits();
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c012', true);
SELECT public.my_credits();
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c013', true);
INSERT INTO res VALUES ('signup.unconfirmed', public.my_credits());
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND min(granted) = 1000 AND min(source_key) = 'signup'
    AND min(expires_at) = now() + interval '20 days'
  FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c011'),
  'an account older than launch gets 1,000 credits once, to launch_at + 30 days');
SELECT pg_temp.assert_true((SELECT expires_at = now() + interval '25 days' FROM public.credit_lots
  WHERE user_id = '00000000-0000-4000-8000-00000000c012'), 'a new account gets them to created_at + 30 days');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c013')
  AND (pg_temp.r('signup.unconfirmed') ->> 'balance')::numeric = 0, 'an unconfirmed email gets nothing');
UPDATE auth.users SET email_confirmed_at = now() WHERE id = '00000000-0000-4000-8000-00000000c013';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c013', true);
INSERT INTO res VALUES ('signup.confirmed', public.my_credits());
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('signup.confirmed') @> '{"balance": 1000, "plan": "free", "cycle": {"allowance": 1000}}',
  'once confirmed, the signup lot is minted');
-- Spent or expired, it never comes back.
UPDATE public.credit_lots SET starts_at = now() - interval '40 days', expires_at = now() - interval '1 second'
  WHERE user_id = '00000000-0000-4000-8000-00000000c011';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c011', true);
INSERT INTO res VALUES ('signup.expired', public.my_credits());
RESET ROLE;
SELECT pg_temp.assert_true((pg_temp.r('signup.expired') ->> 'balance')::numeric = 0
  AND (SELECT count(*) FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c011') = 1
  AND (SELECT credits FROM public.credit_ledger WHERE user_id = '00000000-0000-4000-8000-00000000c011' AND kind = 'expiry') = -1000,
  'an expired signup lot becomes an expiry entry and is not minted again');
-- Not minted after greatest(created_at, launch_at) + 30 days.
UPDATE public.credit_settings SET launch_at = now() - interval '40 days';
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c014', true, now() - interval '45 days');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c014', now());
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c014'),
  'no signup lot after its window has passed');
UPDATE public.credit_settings SET launch_at = now() - interval '1 minute';
-- Supervisor decision (review M5): every confirmed user gets the signup lot,
-- whatever their plan.
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c015', true, now() - interval '2 days');
SET LOCAL ROLE service_role;
SELECT public.grant_paid_plan('00000000-0000-4000-8000-00000000c015', 'plus', 'month', 'm5_s15');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT array_agg(kind ORDER BY kind) FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c015')
  = ARRAY['monthly', 'signup'] AND pg_temp.balance('00000000-0000-4000-8000-00000000c015') = 3000,
  'a confirmed user on a paid plan also gets the signup lot');
SELECT pg_temp.invariants('signup');

-- 13. Top-ups and admin adjustments -----------------------------------------------------------
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c00d');
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('top.1', public.admin_adjust_credits('00000000-0000-4000-8000-00000000c00d', 500, 'topup', 'Manual top-up',
  '00000000-0000-4000-8000-00000000c0ff', 'a0000000-0000-4000-8000-0000000000d1'));
INSERT INTO res VALUES ('top.2', public.admin_adjust_credits('00000000-0000-4000-8000-00000000c00d', 500, 'topup', 'Manual top-up',
  '00000000-0000-4000-8000-00000000c0ff', 'a0000000-0000-4000-8000-0000000000d1'));
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND min(expires_at) = now() + interval '12 months' AND min(kind) = 'topup'
    AND min(note) = 'Manual top-up' AND min(created_by::text) = '00000000-0000-4000-8000-00000000c0ff'
  FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c00d'), 'a top-up lot is valid 12 months');
SELECT pg_temp.assert_true(pg_temp.r('top.2') - 'repeated' = pg_temp.r('top.1') - 'repeated'
  AND pg_temp.r('top.2') ->> 'repeated' = 'true'
  AND (SELECT count(*) FROM public.credit_ledger WHERE request_id = 'a0000000-0000-4000-8000-0000000000d1') = 1
  AND (SELECT created_by::text FROM public.credit_ledger WHERE request_id = 'a0000000-0000-4000-8000-0000000000d1') = '00000000-0000-4000-8000-00000000c0ff',
  'a repeated request id grants once and returns the first result; the ledger records the admin');
SELECT pg_temp.rejected($q$SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c00d', 900, 'topup', 'Other',
  '00000000-0000-4000-8000-00000000c0ff', 'a0000000-0000-4000-8000-0000000000d1')$q$, '22023', 'a request id reused for a different adjustment is refused');
SELECT pg_temp.rejected($q$SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c00d', 10, 'topup', '   ',
  '00000000-0000-4000-8000-00000000c0ff', gen_random_uuid())$q$, '22023', 'an empty reason is refused');
SELECT pg_temp.rejected($q$SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c00d', 10, 'bonus', 'Why',
  '00000000-0000-4000-8000-00000000c0ff', gen_random_uuid())$q$, '22023', 'an unknown kind is refused');
SELECT pg_temp.rejected($q$SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c00d', -10, 'topup', 'Why',
  '00000000-0000-4000-8000-00000000c0ff', gen_random_uuid())$q$, '22023', 'a negative top-up is refused');
SELECT pg_temp.rejected($q$SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c00d', 0, 'adjustment', 'Why',
  '00000000-0000-4000-8000-00000000c0ff', gen_random_uuid())$q$, '22023', 'a zero adjustment is refused');
SELECT pg_temp.rejected($q$SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c00d', 10, 'adjustment', 'Why',
  NULL, gen_random_uuid())$q$, '22023', 'an adjustment without its admin is refused');
INSERT INTO res VALUES ('top.remove', public.admin_adjust_credits('00000000-0000-4000-8000-00000000c00d', -700, 'adjustment', 'Removal',
  '00000000-0000-4000-8000-00000000c0ff', 'a0000000-0000-4000-8000-0000000000d2'));
SELECT pg_temp.assert_true((SELECT balance = -200 AND debt = 200 FROM public.credit_wallets WHERE user_id = '00000000-0000-4000-8000-00000000c00d')
  AND (SELECT sum(credits) = 500 FROM public.credit_lot_draws d JOIN public.credit_lots o ON o.id = d.lot_id
       WHERE o.user_id = '00000000-0000-4000-8000-00000000c00d' AND d.reason = 'removal'),
  'a negative adjustment draws the lots and leaves the rest as debt');
SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c00d', 300, 'adjustment', 'Goodwill',
  '00000000-0000-4000-8000-00000000c0ff', 'a0000000-0000-4000-8000-0000000000d3');
SELECT pg_temp.assert_true(pg_temp.balance('00000000-0000-4000-8000-00000000c00d') = 100
  AND (SELECT debt = 0 FROM public.credit_wallets WHERE user_id = '00000000-0000-4000-8000-00000000c00d'),
  'a positive adjustment repays the debt first');
SELECT pg_temp.assert_true(public.reserve_turn_credits('00000000-0000-4000-8000-00000000c00d', 't1', true)
  @> '{"ok": true, "hold": {"credits": 100}}', 'a low balance holds what is available');
SELECT pg_temp.invariants('top-ups and adjustments');

-- 14. The ledger is append-only; deleting an account cascades its credit rows -------------------
SET LOCAL ROLE service_role;
SELECT pg_temp.rejected($q$UPDATE public.credit_ledger SET credits = 0$q$, '42501', 'service_role cannot UPDATE the ledger');
SELECT pg_temp.rejected($q$DELETE FROM public.credit_ledger$q$, '42501', 'service_role cannot DELETE from the ledger');
SELECT pg_temp.rejected($q$DELETE FROM public.credit_lots$q$, '42501', 'service_role cannot DELETE lots');
SELECT pg_temp.rejected($q$UPDATE public.credit_lots SET granted = 1$q$, '42501', 'service_role cannot change a lot''s grant');
SELECT pg_temp.rejected($q$UPDATE public.credit_wallets SET balance = 1000000$q$, '42501', 'service_role cannot write a balance');
SELECT pg_temp.rejected($q$INSERT INTO public.credit_ledger (user_id, kind, credits, turn_key, usd_to_inr, inr_per_credit)
  VALUES ('00000000-0000-4000-8000-00000000c0ff', 'charge', 0, 'x', 95, 0.1)$q$, '42501', 'service_role cannot insert into the ledger');
SELECT pg_temp.rejected($q$INSERT INTO public.credit_lots (user_id, kind, granted, remaining, starts_at, expires_at, source_key)
  VALUES ('00000000-0000-4000-8000-00000000c0ff', 'topup', 1, 1, now(), now() + interval '1 day', 'x')$q$, '42501',
  'service_role cannot mint a lot directly');
RESET ROLE;
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c00e');
SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c00e', 100, 'adjustment', 'Fixture credits',
  '00000000-0000-4000-8000-00000000c0ff', 'a0000000-0000-4000-8000-0000000000e1');
SELECT public.reserve_turn_credits('00000000-0000-4000-8000-00000000c00e', 'e1', true);
SELECT pg_temp.log('00000000-0000-4000-8000-00000000c00e',
  pg_temp.turn('00000000-0000-4000-8000-00000000c00e', 'e1', 'complete'), 'chat_answer', 'success', 0.2);
SELECT public.settle_turn_credits('00000000-0000-4000-8000-00000000c00e', 'e1');
CREATE TEMP TABLE gone AS SELECT id FROM public.credit_ledger WHERE user_id = '00000000-0000-4000-8000-00000000c00e';
SELECT pg_temp.assert_true((SELECT count(*) FROM public.credit_charge_rows WHERE ledger_id IN (SELECT id FROM gone)) = 1
  AND (SELECT debt = 90 FROM public.credit_wallets WHERE user_id = '00000000-0000-4000-8000-00000000c00e'), 'the account has credit rows and debt');
GRANT SELECT, DELETE ON auth.users TO service_role;
SET LOCAL ROLE service_role;
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-00000000c00e';
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.credit_wallets WHERE user_id = '00000000-0000-4000-8000-00000000c00e')
  AND NOT EXISTS (SELECT FROM public.credit_lots WHERE user_id = '00000000-0000-4000-8000-00000000c00e')
  AND NOT EXISTS (SELECT FROM public.credit_ledger WHERE user_id = '00000000-0000-4000-8000-00000000c00e')
  AND NOT EXISTS (SELECT FROM public.credit_holds WHERE user_id = '00000000-0000-4000-8000-00000000c00e')
  AND NOT EXISTS (SELECT FROM public.credit_charge_rows WHERE ledger_id IN (SELECT id FROM gone))
  AND NOT EXISTS (SELECT FROM public.credit_lot_draws WHERE ledger_id IN (SELECT id FROM gone))
  AND NOT EXISTS (SELECT FROM private.credit_turn_messages WHERE user_id = '00000000-0000-4000-8000-00000000c00e')
  AND EXISTS (SELECT FROM public.model_call_logs WHERE user_id = '00000000-0000-4000-8000-00000000c00e'),
  'deleting the account (by a role with no DELETE on the ledger) cascades every credit row; the call logs survive');
SELECT pg_temp.invariants('account deletion');

-- 15. No dollars in saved messages (review M3: stripped on every write) ------------------------
SELECT pg_temp.assert_true((SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger
    WHERE tgrelid = 'public.chat_messages'::regclass AND NOT tgisinternal AND tgenabled = 'O')
  = ARRAY['credit_strip_usage_cost', 'research_result_immutable'],
  'the cost strip and the immutability guard are enabled; BEFORE triggers run in name order, so the strip runs first');
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c00f');
CREATE TEMP TABLE scrub AS SELECT pg_temp.turn('00000000-0000-4000-8000-00000000c00f', 's1', 'complete', 'An answer.',
  '{"prompt_tokens": 10, "cost_usd": 0.01, "web_searches": 1, "web_search_cost_usd": 0.002,
    "observed": {"cost_usd": 0.005, "cost_usd_from": 2, "attempts_reporting": 1},
    "attempts": [{"cost_usd": 1, "model": "m"}]}'::jsonb) AS msg;
SELECT pg_temp.assert_true((SELECT usage FROM public.chat_messages WHERE id = (SELECT msg FROM scrub))
  = '{"prompt_tokens": 10, "web_searches": 1, "observed": {"attempts_reporting": 1}, "attempts": [{"model": "m"}]}'::jsonb,
  'an insert carrying cost keys stores none, at any depth, and keeps everything else');
-- Adding only a cost key to a completed answer is stripped before the guard
-- compares the row, so it is a no-op rather than a dollar written back (and
-- it would raise if the guard ran first).
UPDATE public.chat_messages SET usage = usage || '{"cost_usd": 3}' WHERE id = (SELECT msg FROM scrub);
SELECT pg_temp.assert_true((SELECT usage FROM public.chat_messages WHERE id = (SELECT msg FROM scrub))
  = '{"prompt_tokens": 10, "web_searches": 1, "observed": {"attempts_reporting": 1}, "attempts": [{"model": "m"}]}'::jsonb,
  'an update cannot write dollars back');
SELECT pg_temp.rejected($q$UPDATE public.chat_messages SET content = 'changed' WHERE id = (SELECT msg FROM scrub)$q$, '23514',
  'a completed answer is still immutable');
CREATE TEMP TABLE running AS SELECT pg_temp.turn('00000000-0000-4000-8000-00000000c00f', 's3', 'running', '') AS msg;
SELECT public.finalize_research_turn('00000000-0000-4000-8000-00000000c00f', 's3',
  (SELECT execution_token FROM public.research_turns WHERE user_id = '00000000-0000-4000-8000-00000000c00f' AND turn_key = 's3'),
  '{"status": "complete", "content": "Done.", "sources": [], "follow_ups": [], "activity": [],
    "usage": {"prompt_tokens": 5, "cost_usd": 0.3, "observed": {"cost_usd_from": 1}}}'::jsonb);
SELECT pg_temp.assert_true((SELECT status = 'complete' AND content = 'Done.' AND usage = '{"prompt_tokens": 5, "observed": {}}'::jsonb
  FROM public.chat_messages WHERE id = (SELECT msg FROM running)), 'finalizing a running answer still works and stores no dollars');
SELECT pg_temp.rejected($q$UPDATE public.chat_messages SET content = 'changed' WHERE id = (SELECT msg FROM running)$q$, '23514',
  'the finalized answer is immutable');
-- The migration's scrub helper, over a row written while the strip was off.
ALTER TABLE public.chat_messages DISABLE TRIGGER credit_strip_usage_cost;
SELECT pg_temp.turn('00000000-0000-4000-8000-00000000c00f', 's2', 'complete', 'An answer.', '{"cost_usd": null, "list": [{"cost_usd_from": 1, "n": 2}]}'::jsonb);
ALTER TABLE public.chat_messages ENABLE TRIGGER credit_strip_usage_cost;
SELECT pg_temp.assert_true(private.credit_scrub_usage() = 1, 'the scrub rewrites exactly the rows carrying a cost key');
SELECT pg_temp.assert_true((SELECT bool_and(tgenabled = 'O') FROM pg_trigger WHERE tgname IN ('research_result_immutable', 'credit_strip_usage_cost')),
  'the scrub leaves both triggers enabled');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c00f', true);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.chat_messages) > 0
  AND NOT EXISTS (SELECT FROM public.chat_messages WHERE jsonb_path_exists(usage, 'strict $.**.cost_usd')
    OR jsonb_path_exists(usage, 'strict $.**.web_search_cost_usd') OR jsonb_path_exists(usage, 'strict $.**.cost_usd_from')),
  'as the user, no saved message matches strict $.**.cost_usd (or the other cost keys)');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.chat_messages WHERE jsonb_path_exists(usage, 'strict $.**.cost_usd')
    OR jsonb_path_exists(usage, 'strict $.**.web_search_cost_usd') OR jsonb_path_exists(usage, 'strict $.**.cost_usd_from')),
  'no saved message anywhere carries a cost key');

-- 16. Credits used this cycle (review R, I2) -----------------------------------------------------
-- Each charge is settled now(); the fixture back-dates a ledger entry's created_at
-- to place it in time (as superuser; no role can do this in a real database).
CREATE FUNCTION pg_temp.charge_at(p_user uuid, p_key text, p_cost numeric, p_at timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.log(p_user, pg_temp.turn(p_user, p_key, 'complete'), 'chat_answer', 'success', p_cost);
  PERFORM public.settle_turn_credits(p_user, p_key);
  UPDATE public.credit_ledger SET created_at = p_at WHERE user_id = p_user AND kind = 'charge' AND turn_key = p_key;
END;
$$;
-- Plus: a cycle that began 5 days ago; one answer in the previous cycle, two in this one.
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c031');
SET LOCAL ROLE service_role;
SELECT public.grant_manual_plan('00000000-0000-4000-8000-00000000c031', 'plus', NULL, '00000000-0000-4000-8000-00000000c0ff');
RESET ROLE;
UPDATE public.credit_lots SET starts_at = now() - interval '5 days'
  WHERE user_id = '00000000-0000-4000-8000-00000000c031' AND kind = 'monthly';
SELECT pg_temp.charge_at('00000000-0000-4000-8000-00000000c031', 'u1', 0.01, now() - interval '6 days');   -- 9.5, previous cycle
SELECT pg_temp.charge_at('00000000-0000-4000-8000-00000000c031', 'u2', 0.02, now() - interval '1 day');    -- 19
SELECT pg_temp.charge_at('00000000-0000-4000-8000-00000000c031', 'u3', 0.03, now());                       -- 28.5
SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000c031', -50, 'adjustment', 'Not an answer',
  '00000000-0000-4000-8000-00000000c0ff', 'a0000000-0000-4000-8000-000000000311');
-- Free: the signup lot minted 2 days ago; one charge before it (shadow mode, before
-- the email was confirmed), two since.
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c032', true, now() - interval '3 days');
SELECT private.credit_refresh('00000000-0000-4000-8000-00000000c032', now() - interval '2 days');
SELECT pg_temp.charge_at('00000000-0000-4000-8000-00000000c032', 'f0', 0.04, now() - interval '2 days 1 hour');  -- 38, before
SELECT pg_temp.charge_at('00000000-0000-4000-8000-00000000c032', 'f1', 0.01, now() - interval '1 day');          -- 9.5
SELECT pg_temp.charge_at('00000000-0000-4000-8000-00000000c032', 'f2', 0.02, now());                             -- 19
-- No lots (an unconfirmed email), charged once in shadow mode.
SELECT pg_temp.mkuser('00000000-0000-4000-8000-00000000c033');
SELECT pg_temp.charge_at('00000000-0000-4000-8000-00000000c033', 'n1', 0.01, now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c031', true);
INSERT INTO res VALUES ('used.plus', public.my_credits());
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c032', true);
INSERT INTO res VALUES ('used.free', public.my_credits());
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c033', true);
INSERT INTO res VALUES ('used.none', public.my_credits());
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('used.plus') @> '{"plan": "plus", "used_this_cycle": 47.5, "cycle": {"allowance": 2000}}',
  'Plus: used_this_cycle is this cycle''s two answers (19 + 28.5), not the previous cycle''s or an adjustment');
SELECT pg_temp.assert_true(pg_temp.r('used.free') @> '{"plan": "free", "used_this_cycle": 28.5, "cycle": {"allowance": 1000}}',
  'Free: used_this_cycle counts the answers charged since the signup lot began');
SELECT pg_temp.assert_true(pg_temp.r('used.none') ? 'used_this_cycle'
  AND pg_temp.r('used.none') -> 'used_this_cycle' = 'null'::jsonb
  AND pg_temp.turn_charged('00000000-0000-4000-8000-00000000c033', 'n1') = 9.5,
  'with no monthly or signup lot there is no cycle: used_this_cycle is null although an answer was charged');
SELECT pg_temp.assert_true((pg_temp.r('used.plus') - 'inr_per_credit')::text !~* '(usd|cost|rate|inr)',
  'used_this_cycle adds no dollars');
SELECT pg_temp.invariants('used this cycle');

ROLLBACK;
