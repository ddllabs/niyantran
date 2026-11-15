-- Live TV fact-check: tables, credit functions, row-level security (migration 20261116090000; open-work F344,
-- slice 1, task T3). PostgreSQL assertions, no pgTAP. Run only in a disposable database, through run.sh, which applies
-- the migration as a non-superuser (nter_migrator).
-- Bootstrap: the latest credit and billing chain (billing_manual_grace's), the Storage stub and app_flags, then
-- 20261116090000_factcheck.sql as a non-superuser. The vacuity check drops the last: the first assertion fails.
--
-- Time: now() is fixed for the whole transaction, so the fixture moves a session's timestamps into the past instead
-- (UPDATE factcheck_sessions SET started_at = now() - ...). Holds and rates are moved the same way.
-- Two sessions racing cannot be shown inside one transaction; factcheck_concurrency.sh does that.
--
-- Users (00000000-0000-4000-8000-0000000fc0NN): 01 main flow, flag, hold, sweep, charge; 02 audience all; 03
-- insufficient; 04 exhausts chat; 05 unit conversion; 06 cap at minutes bought; 07 debt; 08 minimum one minute; 09
-- activity cap; 10-13 settle_expired; 14 paused credit writes; 15 start settles its own; 16 expired lot; 17 earliest
-- expiry first; 18 rate limits; 19 extract/check windows; 20 no extension; 21 spoofed chat key; 22 and 23 row-level
-- security; 24 account deletion; 25 touch states.
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

-- The ledger, wallet, lot and draw invariants of the credit system, over every wallet.
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
  RAISE NOTICE 'PASS: % - invariants hold over % wallets', label, (SELECT count(*) FROM public.credit_wallets);
END;
$$;

-- A user, with a topup lot of the given size that expires in a year.
CREATE FUNCTION pg_temp.u(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-0000000fc' || lpad(n::text, 3, '0'))::uuid;
$$;
CREATE FUNCTION pg_temp.mkuser(n integer, credits numeric DEFAULT 0) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := pg_temp.u(n);
BEGIN
  INSERT INTO auth.users (id, email, created_at) VALUES (v, v::text || '@example.invalid', now());
  PERFORM private.credit_wallet(v);
  IF credits > 0 THEN
    PERFORM private.credit_mint(v, 'topup', credits, now() - interval '1 minute', now() + interval '12 months',
      'fx:' || v, NULL, 'grant', NULL, NULL, NULL);
  END IF;
  RETURN v;
END;
$$;

-- The flag row; NULL removes it.
CREATE FUNCTION pg_temp.setflag(v jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.app_flags WHERE key = 'livetv_factcheck';
  IF v IS NOT NULL THEN
    INSERT INTO public.app_flags (key, value) VALUES ('livetv_factcheck', v);
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.st(p_user uuid, p_minutes integer, p_admin boolean DEFAULT true) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.factcheck_start(p_user, 'vid1', 'chan1', 'live', NULL, p_minutes, p_admin);
$$;
-- Starts and returns the session id, failing the fixture if the start was refused.
CREATE FUNCTION pg_temp.run(p_user uuid, p_minutes integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r jsonb := pg_temp.st(p_user, p_minutes);
BEGIN
  IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: start refused: %', r; END IF;
  RETURN (r ->> 'session_id')::uuid;
END;
$$;
CREATE FUNCTION pg_temp.sid(p_user uuid) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.factcheck_sessions WHERE user_id = p_user AND status = 'active';
$$;
-- Moves an active session's start and last activity into the past.
CREATE FUNCTION pg_temp.age(p_session uuid, p_started interval, p_last interval) RETURNS void LANGUAGE sql AS $$
  UPDATE public.factcheck_sessions SET started_at = now() - p_started, last_activity_at = now() - p_last WHERE id = p_session;
$$;
CREATE FUNCTION pg_temp.charges(p_user uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.credit_ledger WHERE user_id = p_user AND kind = 'charge';
$$;
CREATE FUNCTION pg_temp.balance(p_user uuid) RETURNS numeric LANGUAGE sql AS $$
  SELECT balance FROM public.credit_wallets WHERE user_id = p_user;
$$;
-- A session written directly (as the owner), for the row-level security and touch cases.
CREATE FUNCTION pg_temp.sess(p_user uuid, p_kind text, p_status text, p_started interval DEFAULT interval '1 hour',
                             p_bought integer DEFAULT 5) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.factcheck_sessions (id, user_id, video_id, channel_id, video_kind, minutes_bought,
    credits_per_minute, credits_held, started_at, last_activity_at, ended_at, status, minutes_used, credits_charged)
  VALUES (v, p_user, 'vid', 'chan', p_kind, p_bought, 1, p_bought, now() - p_started, now() - p_started,
    CASE p_status WHEN 'settled' THEN now() - p_started + interval '1 minute' END, p_status,
    CASE p_status WHEN 'settled' THEN 1 END, CASE p_status WHEN 'settled' THEN 1 END);
  RETURN v;
END;
$$;
CREATE FUNCTION pg_temp.claim(p_session uuid, p_user uuid, p_text text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.factcheck_claims (session_id, user_id, video_id, video_kind, spoken_at, quote, claim_en, kind, status)
  VALUES (p_session, p_user, 'vid', 'live', now(), p_text, p_text, 'claim', 'pending') RETURNING id;
$$;

-- 0. The objects exist, and who may do what -------------------------------------------------------------------------------
SELECT pg_temp.assert_true(to_regclass('public.factcheck_sessions') IS NOT NULL
  AND to_regclass('public.factcheck_claims') IS NOT NULL
  AND to_regclass('private.factcheck_hold_keys') IS NOT NULL AND to_regclass('private.factcheck_rate') IS NOT NULL
  AND to_regclass('private.factcheck_budget') IS NOT NULL,
  'the tables exist');
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.factcheck_sessions'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.factcheck_claims'::regclass), 'row-level security is on');
SELECT pg_temp.assert_true((SELECT array_agg(policyname || ':' || cmd ORDER BY policyname) FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('factcheck_sessions', 'factcheck_claims'))
  = ARRAY['factcheck_claims_select:SELECT', 'factcheck_sessions_delete:DELETE', 'factcheck_sessions_select:SELECT'],
  'exactly a select policy on each table and one delete policy on sessions');

DO $$
DECLARE actor text; privilege text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['anon', 'public'] LOOP
    FOREACH privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, 'public.factcheck_sessions', privilege)
        AND NOT has_table_privilege(actor, 'public.factcheck_claims', privilege), actor || ' cannot ' || privilege);
    END LOOP;
  END LOOP;
  FOREACH privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated', 'public.factcheck_sessions', privilege)
      AND NOT has_table_privilege('authenticated', 'public.factcheck_claims', privilege),
      'authenticated cannot ' || privilege || ' either table');
  END LOOP;
  PERFORM pg_temp.assert_true(has_table_privilege('authenticated', 'public.factcheck_sessions', 'SELECT')
    AND has_table_privilege('authenticated', 'public.factcheck_sessions', 'DELETE')
    AND has_table_privilege('authenticated', 'public.factcheck_claims', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.factcheck_claims', 'DELETE'),
    'authenticated reads both tables and deletes only sessions (row-level security narrows it)');
  PERFORM pg_temp.assert_true(has_table_privilege('service_role', 'public.factcheck_sessions', 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.factcheck_sessions', 'INSERT')
    AND NOT has_table_privilege('service_role', 'public.factcheck_sessions', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.factcheck_sessions', 'DELETE'),
    'service_role only reads sessions: every write goes through the functions');
  PERFORM pg_temp.assert_true(has_table_privilege('service_role', 'public.factcheck_claims', 'SELECT')
    AND has_table_privilege('service_role', 'public.factcheck_claims', 'INSERT')
    AND has_table_privilege('service_role', 'public.factcheck_claims', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.factcheck_claims', 'DELETE'),
    'service_role reads, inserts and updates claims and cannot delete them');
  FOREACH actor IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'public'] LOOP
    PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, 'private.factcheck_hold_keys', 'SELECT')
      AND NOT has_table_privilege(actor, 'private.factcheck_rate', 'SELECT')
      AND NOT has_table_privilege(actor, 'private.factcheck_budget', 'SELECT')
      AND NOT has_schema_privilege(actor, 'private', 'USAGE'), actor || ' reaches nothing in private');
  END LOOP;
  FOREACH actor IN ARRAY ARRAY['anon', 'authenticated', 'public'] LOOP
    PERFORM pg_temp.assert_true(
      NOT has_function_privilege(actor, 'public.factcheck_start(uuid,text,text,text,numeric,integer,boolean,numeric)', 'EXECUTE')
      AND NOT has_function_privilege(actor, 'public.factcheck_touch(uuid,uuid,text)', 'EXECUTE')
      AND NOT has_function_privilege(actor, 'public.factcheck_settle(uuid,uuid)', 'EXECUTE')
      AND NOT has_function_privilege(actor, 'public.factcheck_settle_expired()', 'EXECUTE'),
      actor || ' cannot call any fact-check function');
  END LOOP;
  PERFORM pg_temp.assert_true(
    has_function_privilege('service_role', 'public.factcheck_start(uuid,text,text,text,numeric,integer,boolean,numeric)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.factcheck_touch(uuid,uuid,text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.factcheck_settle(uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.factcheck_settle_expired()', 'EXECUTE'),
    'service_role can call the four fact-check functions');
  PERFORM pg_temp.assert_true(
    NOT has_function_privilege('service_role', 'private.factcheck_flag()', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'private.factcheck_settle_locked(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'private.factcheck_flag()', 'EXECUTE'),
    'the helpers are private');
END;
$$;

-- Table constraints.
SELECT pg_temp.mkuser(25, 0);
SELECT pg_temp.rejected($q$INSERT INTO public.factcheck_sessions (user_id, video_id, channel_id, video_kind, minutes_bought, credits_per_minute, credits_held)
  VALUES (pg_temp.u(25), 'v', 'c', 'live', 7, 1, 7)$q$, '23514', 'minutes bought must be 5, 10 or 15');
SELECT pg_temp.rejected($q$INSERT INTO public.factcheck_sessions (user_id, video_id, channel_id, video_kind, minutes_bought, credits_per_minute, credits_held)
  VALUES (pg_temp.u(25), repeat('v', 33), 'c', 'live', 5, 1, 5)$q$, '23514', 'a video id is at most 32 characters');
SELECT pg_temp.rejected($q$INSERT INTO public.factcheck_sessions (user_id, video_id, channel_id, video_kind, minutes_bought, credits_per_minute, credits_held, status)
  VALUES (pg_temp.u(25), 'v', 'c', 'live', 5, 1, 5, 'settled')$q$, '23514', 'a settled session must carry its settlement');

-- 1. The flag: anything but a well-formed, enabled row is off ---------------------------------------------------------------
SELECT pg_temp.mkuser(1, 1000);
SELECT pg_temp.setflag(NULL);
DO $$
DECLARE
  v_flag jsonb;
  v_case integer := 0;
  r jsonb;
  cases jsonb[] := ARRAY[
    NULL::jsonb,
    '{}', 'null', 'true', '"on"', '[1]',
    '{"enabled":false,"audience":"admin","credits_per_minute":2}',
    '{"enabled":"true","audience":"admin","credits_per_minute":2}',
    '{"enabled":1,"audience":"admin","credits_per_minute":2}',
    '{"audience":"admin","credits_per_minute":2}',
    '{"enabled":true,"credits_per_minute":2}',
    '{"enabled":true,"audience":"nobody","credits_per_minute":2}',
    '{"enabled":true,"audience":["admin"],"credits_per_minute":2}',
    '{"enabled":true,"audience":"admin"}',
    '{"enabled":true,"audience":"admin","credits_per_minute":0}',
    '{"enabled":true,"audience":"admin","credits_per_minute":-1}',
    '{"enabled":true,"audience":"admin","credits_per_minute":"2"}',
    '{"enabled":true,"audience":"admin","credits_per_minute":null}',
    '{"enabled":true,"audience":"admin","credits_per_minute":5001}',
    '{"enabled":true,"audience":"admin","credits_per_minute":100001}',
    '{"enabled":true,"audience":"admin","credits_per_minute":1e400}',
    '{"enabled":true,"audience":"admin","credits_per_minute":0.00001}'
  ];
BEGIN
  FOREACH v_flag IN ARRAY cases LOOP
    v_case := v_case + 1;
    PERFORM pg_temp.setflag(v_flag);
    r := pg_temp.st(pg_temp.u(1), 10);
    PERFORM pg_temp.assert_true(r = '{"ok": false, "reason": "off"}'::jsonb,
      'flag case ' || v_case || ' (' || coalesce(v_flag::text, 'no row') || ') is off: ' || r::text);
  END LOOP;
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_sessions) AND NOT EXISTS (SELECT FROM private.factcheck_hold_keys)
    AND NOT EXISTS (SELECT FROM public.credit_holds WHERE user_id = pg_temp.u(1)), 'an off start creates no session and no hold');
  -- The cap itself is on: 5000 a minute is a price (the user cannot afford it, which is not 'off').
  PERFORM pg_temp.setflag('{"enabled":true,"audience":"admin","credits_per_minute":5000}');
  r := pg_temp.st(pg_temp.u(1), 5);
  PERFORM pg_temp.assert_true(r ->> 'reason' = 'insufficient' AND (r ->> 'needed')::numeric = 25000, 'a price of 5000 a minute is still on: ' || r::text);
END;
$$;
SELECT pg_temp.setflag('{"enabled":true,"audience":"admin","credits_per_minute":2}');

-- 2. start refuses --------------------------------------------------------------------------------------------------------
SELECT pg_temp.assert_true(pg_temp.st(pg_temp.u(1), 10, false) = '{"ok": false, "reason": "not_allowed"}'::jsonb,
  'audience admin: a non-admin is refused');
SELECT pg_temp.assert_true(public.factcheck_start(pg_temp.u(1), 'vid1', 'chan1', 'live', NULL, 10, NULL) = '{"ok": false, "reason": "not_allowed"}'::jsonb,
  'audience admin: an unknown admin flag counts as not admin');
SELECT pg_temp.assert_true(pg_temp.st(pg_temp.u(1), 0) ->> 'reason' = 'bad_minutes' AND pg_temp.st(pg_temp.u(1), 4) ->> 'reason' = 'bad_minutes'
  AND pg_temp.st(pg_temp.u(1), 20) ->> 'reason' = 'bad_minutes' AND pg_temp.st(pg_temp.u(1), NULL) ->> 'reason' = 'bad_minutes',
  'minutes other than 5, 10, 15 are refused');
SELECT pg_temp.rejected($q$SELECT public.factcheck_start(NULL, 'v', 'c', 'live', NULL, 5, true)$q$, '22023', 'a missing user raises');
SELECT pg_temp.rejected($q$SELECT public.factcheck_start(pg_temp.u(1), '', 'c', 'live', NULL, 5, true)$q$, '22023', 'an empty video id raises');
SELECT pg_temp.rejected($q$SELECT public.factcheck_start(pg_temp.u(1), repeat('v', 33), 'c', 'live', NULL, 5, true)$q$, '22023', 'a long video id raises');
SELECT pg_temp.rejected($q$SELECT public.factcheck_start(pg_temp.u(1), 'v', 'c', 'other', NULL, 5, true)$q$, '22023', 'a bad video kind raises');
SELECT pg_temp.rejected($q$SELECT public.factcheck_start(pg_temp.u(1), 'v', 'c', 'live', -1, 5, true)$q$, '22023', 'a negative position raises');
SELECT pg_temp.rejected($q$SELECT public.factcheck_start(pg_temp.u(1), 'v', 'c', 'recorded', 'NaN', 5, true)$q$, '22023', 'a NaN position raises');
SELECT pg_temp.rejected($q$SELECT public.factcheck_start(pg_temp.u(1), 'v', 'c', 'recorded', 'Infinity', 5, true)$q$, '22023', 'an infinite position raises');
SELECT pg_temp.rejected($q$SELECT public.factcheck_start(pg_temp.u(1), 'v', 'c', 'recorded', 10000001, 5, true)$q$, '22023', 'a position past 10,000,000 s raises');
SELECT pg_temp.rejected($q$INSERT INTO public.factcheck_sessions (user_id, video_id, channel_id, video_kind, start_position_s, minutes_bought, credits_per_minute, credits_held)
  VALUES (pg_temp.u(25), 'v', 'c', 'recorded', 'NaN', 5, 1, 5)$q$, '23514', 'the table refuses a NaN start position');
SELECT pg_temp.rejected($q$INSERT INTO public.factcheck_sessions (user_id, video_id, channel_id, video_kind, start_position_s, minutes_bought, credits_per_minute, credits_held)
  VALUES (pg_temp.u(25), 'v', 'c', 'recorded', 'Infinity', 5, 1, 5)$q$, '23514', 'the table refuses an infinite start position');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_sessions), 'no refusal created a session');

SELECT pg_temp.mkuser(2, 500);
SELECT pg_temp.setflag('{"enabled":true,"audience":"all","credits_per_minute":2}');
SELECT pg_temp.assert_true(pg_temp.st(pg_temp.u(2), 5, false) ->> 'ok' = 'true', 'audience all: a non-admin may start');
SELECT pg_temp.setflag('{"enabled":true,"audience":"admin","credits_per_minute":2}');

SELECT pg_temp.mkuser(3, 10);
SELECT pg_temp.assert_true(pg_temp.st(pg_temp.u(3), 10) = jsonb_build_object('ok', false, 'reason', 'insufficient', 'needed', 20, 'available', 10),
  'insufficient credits: refused with what was needed and what is available');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_sessions WHERE user_id = pg_temp.u(3))
  AND NOT EXISTS (SELECT FROM public.credit_holds WHERE user_id = pg_temp.u(3)), 'an insufficient start creates nothing');

-- 3. A start: the session, the hold, and what the research chat then sees ------------------------------------------------
DO $$
DECLARE
  u uuid := pg_temp.u(1);
  c0 jsonb;
  r jsonb;
  s record;
  h record;
  k text;
  v_rate numeric;
BEGIN
  -- Before: the research chat sees all 1000. (Its hold is settled again so it does not count below.)
  c0 := public.reserve_turn_credits(u, 'c0', true);
  PERFORM pg_temp.assert_true((c0 ->> 'available')::numeric = 1000, 'before the fact-check the chat sees 1000 available');
  PERFORM public.settle_turn_credits(u, 'c0');

  r := pg_temp.st(u, 10);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND (r ->> 'credits_per_minute')::numeric = 2 AND (r ->> 'credits_held')::numeric = 20
    AND (r ->> 'ends_at')::timestamptz = now() + interval '10 minutes' AND (r ->> 'session_id') IS NOT NULL,
    'start returns the session, the price, the credits held and the end: ' || r::text);
  PERFORM pg_temp.assert_true(r::text NOT LIKE '%fc:%' AND pg_temp.st(u, 10)::text NOT LIKE '%fc:%', 'a start never returns the hold key');
  SELECT * INTO s FROM public.factcheck_sessions WHERE id = (r ->> 'session_id')::uuid;
  PERFORM pg_temp.assert_true(s.user_id = u AND s.status = 'active' AND s.minutes_bought = 10 AND s.credits_per_minute = 2
    AND s.credits_held = 20 AND s.credits_charged IS NULL AND s.minutes_used IS NULL AND s.ended_at IS NULL
    AND s.started_at = now() AND s.last_activity_at = now() AND s.video_id = 'vid1' AND s.channel_id = 'chan1' AND s.video_kind = 'live',
    'the session row is written');
  SELECT turn_key INTO k FROM private.factcheck_hold_keys WHERE session_id = s.id;
  SELECT inr_per_credit INTO v_rate FROM public.credit_settings WHERE id;
  SELECT * INTO h FROM public.credit_holds WHERE user_id = u AND turn_key = k;
  PERFORM pg_temp.assert_true(k ~ '^fc:[0-9a-f-]{36}$' AND k <> 'factcheck:' || s.id AND h.credits = 20 AND h.inr_per_credit = v_rate
    AND h.settled_at IS NULL AND h.swept_at IS NULL AND NOT h.shadow_blocked
    AND h.expires_at = now() + interval '10 minutes' + interval '30 minutes',
    'the hold is under a random private key, in the current unit, and lasts until 30 minutes after the block');

  -- The hold counts for the chat and for the credits page.
  PERFORM set_config('request.jwt.claim.sub', u::text, true);
  PERFORM pg_temp.assert_true((public.my_credits() ->> 'held')::numeric = 20, 'my_credits shows the hold');
  c0 := public.reserve_turn_credits(u, 'c1', true);
  PERFORM pg_temp.assert_true((c0 ->> 'available')::numeric = 980 AND (c0 ->> 'ok') = 'true',
    'the hold lowers what the research chat sees available: 1000 -> 980');
  PERFORM public.settle_turn_credits(u, 'c1');

  r := pg_temp.st(u, 10);
  PERFORM pg_temp.assert_true(r = jsonb_build_object('ok', false, 'reason', 'already_active', 'session_id', s.id),
    'a second start is refused while one session is active, and names that session: ' || r::text);
  PERFORM pg_temp.assert_true((SELECT count(*) FROM public.factcheck_sessions WHERE user_id = u) = 1
    AND (SELECT count(*) FROM private.factcheck_hold_keys WHERE session_id = s.id) = 1, 'still one session and one key');
END;
$$;

-- A block that takes everything leaves the chat nothing.
SELECT pg_temp.mkuser(4, 30);
DO $$
DECLARE u uuid := pg_temp.u(4); c jsonb;
BEGIN
  PERFORM pg_temp.run(u, 15);
  c := public.reserve_turn_credits(u, 'cx', true);
  PERFORM pg_temp.assert_true(c ->> 'ok' = 'false' AND c ->> 'reason' = 'credits_exhausted' AND (c ->> 'available')::numeric = 0,
    'a block that holds every credit leaves the research chat refused with credits_exhausted');
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM public.credit_holds WHERE user_id = u AND turn_key = 'cx'), 'and the refused chat turn made no hold');
END;
$$;

-- 4. A chat turn cannot release or ride on a fact-check hold ------------------------------------------------------------------
DO $$
DECLARE
  u uuid := pg_temp.u(1);
  sid uuid := pg_temp.sid(pg_temp.u(1));
  c jsonb;
BEGIN
  c := public.reserve_turn_credits(u, 'factcheck:' || sid, true);
  PERFORM pg_temp.assert_true(c ->> 'ok' = 'true' AND (c ->> 'available')::numeric = 980,
    'a chat turn keyed with the session id gets its own hold, on top of the fact-check hold');
  PERFORM public.settle_turn_credits(u, 'factcheck:' || sid);
  PERFORM pg_temp.assert_true((SELECT count(*) FROM public.credit_holds WHERE user_id = u AND turn_key LIKE 'fc:%' AND settled_at IS NULL) = 1
    AND (SELECT credits = 20 FROM public.credit_holds WHERE user_id = u AND turn_key LIKE 'fc:%'),
    'settling that chat turn leaves the fact-check hold standing and unchanged');
END;
$$;

-- 5. The existing sweep does not free a fact-check hold ----------------------------------------------------------------------
DO $$
DECLARE u uuid := pg_temp.u(1); n bigint;
BEGIN
  n := pg_temp.charges(u);
  PERFORM private.credit_sweep(u, now() + interval '6 minutes');
  PERFORM pg_temp.assert_true((SELECT swept_at IS NULL AND settled_at IS NULL FROM public.credit_holds WHERE user_id = u AND turn_key LIKE 'fc:%'),
    'six minutes into the block the chat sweep leaves the hold alone');
  PERFORM set_config('request.jwt.claim.sub', u::text, true);
  PERFORM pg_temp.assert_true((public.my_credits() ->> 'held')::numeric = 20, 'and it still counts as held');
  -- The failsafe: a cron outage past the hold's life lets the sweep drop it, charging nothing.
  PERFORM private.credit_sweep(u, now() + interval '41 minutes');
  PERFORM pg_temp.assert_true((SELECT swept_at IS NOT NULL FROM public.credit_holds WHERE user_id = u AND turn_key LIKE 'fc:%')
    AND pg_temp.charges(u) = n, 'only after the hold has expired does the sweep touch it, and it charges nothing');
END;
$$;

-- 6. Settle: the charge ------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  u uuid := pg_temp.u(1);
  sid uuid := pg_temp.sid(pg_temp.u(1));
  r jsonb;
  r2 jsonb;
  e record;
  v_rate numeric;
  v_usd numeric;
  v_lots_before numeric;
BEGIN
  SELECT sum(remaining) INTO v_lots_before FROM public.credit_lots WHERE user_id = u AND closed_at IS NULL;
  PERFORM pg_temp.age(sid, interval '450 seconds', interval '1 second');
  r := public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true(r::text NOT LIKE '%fc:%', 'a settle never returns the hold key');
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND (r ->> 'minutes_used')::int = 8 AND (r ->> 'credits_charged')::numeric = 16
    AND (r ->> 'balance')::numeric = 984, 'settle charges the minutes used: 7.5 minutes is 8 minutes at 2 = 16: ' || r::text);
  SELECT * INTO e FROM public.credit_ledger WHERE user_id = u AND kind = 'charge';
  SELECT inr_per_credit, usd_to_inr INTO v_rate, v_usd FROM public.credit_settings WHERE id;
  PERFORM pg_temp.assert_true(pg_temp.charges(u) = 1 AND e.credits = -16 AND e.turn_key = 'factcheck:' || sid AND e.lot_id IS NULL
    AND e.request_id IS NULL AND e.inr_per_credit = v_rate AND e.usd_to_inr = v_usd,
    'one charge entry, keyed factcheck:<session>, at the current rates');
  PERFORM pg_temp.assert_true((SELECT sum(remaining) FROM public.credit_lots WHERE user_id = u AND closed_at IS NULL) = v_lots_before - 16
    AND (SELECT sum(credits) FROM public.credit_lot_draws WHERE ledger_id = e.id AND reason = 'charge') = 16, 'the lots paid it');
  PERFORM pg_temp.assert_true((SELECT status = 'settled' AND minutes_used = 8 AND credits_charged = 16 AND ended_at = now()
    FROM public.factcheck_sessions WHERE id = sid), 'the session is settled');
  PERFORM pg_temp.assert_true((SELECT settled_at IS NOT NULL FROM public.credit_holds WHERE user_id = u AND turn_key LIKE 'fc:%'),
    'the hold is released (it had been swept by the failsafe sweep above)');
  PERFORM set_config('request.jwt.claim.sub', u::text, true);
  PERFORM pg_temp.assert_true((public.my_credits() ->> 'held')::numeric = 0, 'nothing is held after the settle');
  PERFORM pg_temp.invariants('after the first settle');

  r2 := public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true(r2 ->> 'ok' = 'true' AND (r2 ->> 'minutes_used')::int = 8 AND (r2 ->> 'credits_charged')::numeric = 16
    AND (r2 ->> 'balance')::numeric = 984 AND pg_temp.charges(u) = 1 AND pg_temp.balance(u) = 984,
    'settling again returns the same result and charges nothing more');
  PERFORM pg_temp.assert_true(r2::text NOT LIKE '%fc:%' AND public.factcheck_settle(pg_temp.u(2), sid)::text NOT LIKE '%fc:%', 'a repeated or refused settle never returns the hold key');
  PERFORM pg_temp.assert_true(public.factcheck_settle(pg_temp.u(2), sid) ->> 'reason' = 'not_found'
    AND public.factcheck_settle(u, gen_random_uuid()) ->> 'reason' = 'not_found', 'another user''s or an unknown session is not_found');
  PERFORM pg_temp.rejected(format('SELECT public.factcheck_settle(NULL, %L)', sid), '22023', 'settle with no user raises');
  PERFORM pg_temp.assert_true(pg_temp.st(u, 5) ->> 'ok' = 'true', 'after a settle the user may start again');
END;
$$;
SELECT public.factcheck_settle(pg_temp.u(1), pg_temp.sid(pg_temp.u(1)));

-- The settle works whatever the state of the hold, and the unit travels with the hold.
SELECT pg_temp.mkuser(5, 1000);
DO $$
DECLARE u uuid := pg_temp.u(5); sid uuid; r jsonb;
BEGIN
  sid := pg_temp.run(u, 5);
  UPDATE public.credit_holds SET inr_per_credit = inr_per_credit * 10 WHERE user_id = u AND turn_key LIKE 'fc:%';
  PERFORM pg_temp.age(sid, interval '30 seconds', interval '1 second');
  r := public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true((r ->> 'minutes_used')::int = 1 AND (r ->> 'credits_charged')::numeric = 20,
    'a hold made in a unit 10 times larger charges the price converted to the current unit: ' || r::text);
  PERFORM pg_temp.invariants('after a converted charge');
END;
$$;

-- Caps: at most the minutes bought, at least one, and only up to the last activity.
SELECT pg_temp.mkuser(6, 100);
DO $$
DECLARE u uuid := pg_temp.u(6); sid uuid; r jsonb;
BEGIN
  sid := pg_temp.run(u, 5);
  PERFORM pg_temp.age(sid, interval '20 minutes', interval '1 second');
  r := public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true((r ->> 'minutes_used')::int = 5 AND (r ->> 'credits_charged')::numeric = 10, 'never more than the minutes bought: ' || r::text);
END;
$$;
SELECT pg_temp.mkuser(8, 50);
DO $$
DECLARE u uuid := pg_temp.u(8); sid uuid; r jsonb;
BEGIN
  sid := pg_temp.run(u, 10);
  PERFORM pg_temp.assert_true((SELECT settled_at IS NULL AND swept_at IS NULL FROM public.credit_holds WHERE user_id = u AND turn_key LIKE 'fc:%'),
    'before the settle the hold stands, unsettled and unswept');
  r := public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true((r ->> 'minutes_used')::int = 1 AND (r ->> 'credits_charged')::numeric = 2, 'a session stopped at once is charged one minute: ' || r::text);
  PERFORM pg_temp.assert_true((SELECT settled_at = now() AND swept_at = now() FROM public.credit_holds WHERE user_id = u AND turn_key LIKE 'fc:%'),
    'the settle releases and sweeps the hold');
END;
$$;
SELECT pg_temp.mkuser(9, 500);
DO $$
DECLARE u uuid := pg_temp.u(9); sid uuid; r jsonb;
BEGIN
  -- Started 480 s ago, last heard 315 s ago: charged up to 15 s after that, 180 s = 3 minutes.
  sid := pg_temp.run(u, 10);
  PERFORM pg_temp.age(sid, interval '480 seconds', interval '315 seconds');
  r := public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true((r ->> 'minutes_used')::int = 3, 'charged only to 15 s after the last activity: 180 s is 3 minutes: ' || r::text);
  -- 181 s is 4 minutes.
  sid := pg_temp.run(u, 10);
  PERFORM pg_temp.age(sid, interval '480 seconds', interval '314 seconds');
  r := public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true((r ->> 'minutes_used')::int = 4, '181 s is 4 minutes: ' || r::text);
END;
$$;

-- Debt: the balance fell below the charge after the start.
SELECT pg_temp.mkuser(7, 40);
DO $$
DECLARE u uuid := pg_temp.u(7); sid uuid; r jsonb; e uuid;
BEGIN
  sid := pg_temp.run(u, 15);
  e := private.credit_entry(u, 'adjustment', -30, NULL, NULL, gen_random_uuid(), NULL, NULL, u, 'fixture');
  PERFORM private.credit_draw(u, 30, e, 'removal', now());
  PERFORM pg_temp.age(sid, interval '15 minutes', interval '1 second');
  r := public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true((r ->> 'credits_charged')::numeric = 30 AND (r ->> 'balance')::numeric = -20
    AND (SELECT debt = 20 FROM public.credit_wallets WHERE user_id = u), 'a charge above the balance leaves debt: ' || r::text);
  PERFORM pg_temp.invariants('after a charge into debt');
END;
$$;

-- Lots: earliest expiry first, and an expired lot is not drawn.
SELECT pg_temp.mkuser(16, 0);
SELECT pg_temp.mkuser(17, 0);
DO $$
DECLARE u uuid; sid uuid; soon uuid; later uuid;
BEGIN
  u := pg_temp.u(17);
  soon := private.credit_mint(u, 'topup', 100, now() - interval '2 hours', now() + interval '1 hour', 'soon', NULL, 'grant', NULL, NULL, NULL);
  later := private.credit_mint(u, 'topup', 100, now() - interval '2 hours', now() + interval '12 months', 'later', NULL, 'grant', NULL, NULL, NULL);
  sid := pg_temp.run(u, 5);
  PERFORM pg_temp.age(sid, interval '5 minutes', interval '1 second');
  PERFORM public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true((SELECT remaining = 90 FROM public.credit_lots WHERE id = soon) AND (SELECT remaining = 100 FROM public.credit_lots WHERE id = later),
    'the charge is drawn from the lot that expires first');
  PERFORM pg_temp.invariants('after an earliest-expiry draw');

  u := pg_temp.u(16);
  soon := private.credit_mint(u, 'topup', 100, now() - interval '2 hours', now() + interval '1 hour', 'soon', NULL, 'grant', NULL, NULL, NULL);
  later := private.credit_mint(u, 'topup', 100, now() - interval '2 hours', now() + interval '12 months', 'later', NULL, 'grant', NULL, NULL, NULL);
  sid := pg_temp.run(u, 10);
  UPDATE public.credit_lots SET expires_at = now() - interval '1 second' WHERE id = soon;
  PERFORM pg_temp.age(sid, interval '10 minutes', interval '1 second');
  PERFORM public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true((SELECT remaining = 0 AND closed_at IS NOT NULL FROM public.credit_lots WHERE id = soon)
    AND (SELECT remaining = 80 FROM public.credit_lots WHERE id = later)
    AND NOT EXISTS (SELECT FROM public.credit_lot_draws d JOIN public.credit_ledger l ON l.id = d.ledger_id
                    WHERE l.user_id = u AND l.kind = 'charge' AND d.lot_id = soon),
    'a lot that expired during the block is not drawn from');
  PERFORM pg_temp.invariants('after a charge past an expired lot');
END;
$$;

-- start settles the user's own sessions that have run out.
SELECT pg_temp.mkuser(15, 200);
DO $$
DECLARE u uuid := pg_temp.u(15); old uuid; r jsonb;
BEGIN
  old := pg_temp.run(u, 5);
  PERFORM pg_temp.age(old, interval '10 minutes', interval '9 minutes 50 seconds');
  r := pg_temp.st(u, 5);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND (r ->> 'session_id')::uuid <> old, 'a session that has run out does not block the next start');
  PERFORM pg_temp.assert_true((SELECT status = 'settled' AND minutes_used = 1 AND credits_charged = 2 FROM public.factcheck_sessions WHERE id = old)
    AND pg_temp.charges(u) = 1, 'and was settled and charged first');
  PERFORM pg_temp.invariants('after start settled the old session');
END;
$$;

-- 7. factcheck_settle_expired ------------------------------------------------------------------------------------------------
SELECT pg_temp.mkuser(10, 100);
SELECT pg_temp.mkuser(11, 100);
SELECT pg_temp.mkuser(12, 100);
SELECT pg_temp.mkuser(13, 100);
SELECT pg_temp.mkuser(14, 100);
DO $$
DECLARE s10 uuid; s11 uuid; s12 uuid; s13 uuid; n integer;
BEGIN
  -- Leave nothing else for the job to find.
  PERFORM public.factcheck_settle(user_id, id) FROM public.factcheck_sessions WHERE status = 'active' AND user_id IN (pg_temp.u(1), pg_temp.u(2), pg_temp.u(4), pg_temp.u(15));
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_sessions WHERE status = 'active'), 'no other session is running');

  s10 := pg_temp.run(pg_temp.u(10), 5);   -- the block is over by more than a minute, but the tab was heard 30 s ago
  PERFORM pg_temp.age(s10, interval '7 minutes', interval '30 seconds');
  s11 := pg_temp.run(pg_temp.u(11), 15);  -- quiet for 4 minutes
  PERFORM pg_temp.age(s11, interval '6 minutes', interval '4 minutes');
  s12 := pg_temp.run(pg_temp.u(12), 10);  -- running
  PERFORM pg_temp.age(s12, interval '2 minutes', interval '20 seconds');
  s13 := pg_temp.run(pg_temp.u(13), 10);  -- quiet for exactly 3 minutes: not more than 3
  PERFORM pg_temp.age(s13, interval '5 minutes', interval '180 seconds');

  n := public.factcheck_settle_expired();
  PERFORM pg_temp.assert_true(n = 2, 'the job settles the abandoned and the quiet sessions: ' || n);
  PERFORM pg_temp.assert_true((SELECT status = 'settled' AND minutes_used = 5 AND credits_charged = 10 FROM public.factcheck_sessions WHERE id = s10),
    'an ended block is charged up to 15 s after its last activity, at most the minutes bought');
  PERFORM pg_temp.assert_true((SELECT status = 'settled' AND minutes_used = 3 AND credits_charged = 6 FROM public.factcheck_sessions WHERE id = s11),
    'a session quiet for over 3 minutes is charged to its last activity: 135 s is 3 minutes');
  PERFORM pg_temp.assert_true((SELECT status = 'active' FROM public.factcheck_sessions WHERE id = s12)
    AND (SELECT status = 'active' FROM public.factcheck_sessions WHERE id = s13), 'a running session and one quiet for exactly 3 minutes are left alone');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM public.credit_holds WHERE user_id IN (pg_temp.u(10), pg_temp.u(11)) AND settled_at IS NOT NULL AND swept_at IS NOT NULL) = 2
    AND pg_temp.charges(pg_temp.u(10)) = 1 AND pg_temp.charges(pg_temp.u(11)) = 1, 'their holds are released and each was charged once');
  PERFORM pg_temp.assert_true(public.factcheck_settle_expired() = 0, 'a second run settles nothing');
  PERFORM pg_temp.invariants('after the job');
END;
$$;
-- Paused credit writes are survived, not raised.
DO $$
DECLARE s uuid; n integer;
BEGIN
  s := pg_temp.run(pg_temp.u(14), 5);
  PERFORM pg_temp.age(s, interval '10 minutes', interval '9 minutes');
  UPDATE private.credit_epoch SET paused = true;
  n := public.factcheck_settle_expired();
  PERFORM pg_temp.assert_true(n = 0 AND (SELECT status = 'active' FROM public.factcheck_sessions WHERE id = s),
    'with credit writes paused the job raises nothing and leaves the session for the next run');
  UPDATE private.credit_epoch SET paused = false;
  n := public.factcheck_settle_expired();
  PERFORM pg_temp.assert_true(n = 1 AND (SELECT status = 'settled' FROM public.factcheck_sessions WHERE id = s),
    'and settles it once writes resume (settled ' || n || ', status ' || (SELECT status FROM public.factcheck_sessions WHERE id = s) || ')');
END;
$$;
-- One failure does not stop the job: exactly one session fails (a fixture-only trigger raises on settling it), the
-- other two in the same run are settled, and the failed one has no charge. Rate rows over an hour old go.
SELECT pg_temp.mkuser(26, 100);
SELECT pg_temp.mkuser(27, 100);
SELECT pg_temp.mkuser(28, 100);
CREATE FUNCTION public.fx_fail_one() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id::text = current_setting('fx.bad_session', true) AND NEW.status = 'settled' THEN
    RAISE EXCEPTION 'fixture failure' USING ERRCODE = 'XX001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fx_fail_one BEFORE UPDATE ON public.factcheck_sessions FOR EACH ROW EXECUTE FUNCTION public.fx_fail_one();
DO $$
DECLARE bad uuid; g1 uuid; g2 uuid; n integer;
BEGIN
  bad := pg_temp.run(pg_temp.u(26), 5);
  g1 := pg_temp.run(pg_temp.u(27), 5);
  g2 := pg_temp.run(pg_temp.u(28), 5);
  PERFORM pg_temp.age(bad, interval '20 minutes', interval '19 minutes');  -- the oldest, so it is tried first
  PERFORM pg_temp.age(g1, interval '10 minutes', interval '9 minutes');
  PERFORM pg_temp.age(g2, interval '9 minutes', interval '8 minutes');
  PERFORM set_config('fx.bad_session', bad::text, true);
  INSERT INTO private.factcheck_rate (user_id, action, minute, n) VALUES
    (pg_temp.u(26), 'check', now() - interval '2 hours', 3), (pg_temp.u(26), 'extract', now() - interval '30 minutes', 2);
  n := public.factcheck_settle_expired();
  PERFORM pg_temp.assert_true(n = 2 AND (SELECT status = 'settled' FROM public.factcheck_sessions WHERE id = g1)
    AND (SELECT status = 'settled' FROM public.factcheck_sessions WHERE id = g2), 'a session that fails does not stop the others in the run: ' || n);
  PERFORM pg_temp.assert_true((SELECT status = 'active' FROM public.factcheck_sessions WHERE id = bad)
    AND pg_temp.charges(pg_temp.u(26)) = 0 AND pg_temp.balance(pg_temp.u(26)) = 100
    AND (SELECT settled_at IS NULL FROM public.credit_holds WHERE user_id = pg_temp.u(26) AND turn_key LIKE 'fc:%'),
    'and the failed one is untouched: no charge, hold standing');
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM private.factcheck_rate WHERE user_id = pg_temp.u(26) AND minute < now() - interval '1 hour')
    AND EXISTS (SELECT FROM private.factcheck_rate WHERE user_id = pg_temp.u(26) AND action = 'extract'),
    'rate rows over an hour old are deleted and newer ones kept');
END;
$$;
DROP TRIGGER fx_fail_one ON public.factcheck_sessions;
DROP FUNCTION public.fx_fail_one();
SELECT public.factcheck_settle_expired();

-- 8. factcheck_touch -------------------------------------------------------------------------------------------------------------
SELECT pg_temp.mkuser(18, 500);
SELECT pg_temp.mkuser(19, 500);
SELECT pg_temp.mkuser(20, 500);
SELECT pg_temp.mkuser(21, 500);
DO $$
DECLARE u uuid := pg_temp.u(19); sid uuid; r jsonb;
BEGIN
  sid := pg_temp.run(u, 5);
  PERFORM pg_temp.age(sid, interval '2 minutes', interval '1 minute');
  r := public.factcheck_touch(u, sid, 'transcribe');
  PERFORM pg_temp.assert_true(r = '{"ok": true, "seconds_left": 180}'::jsonb
    AND (SELECT last_activity_at = now() FROM public.factcheck_sessions WHERE id = sid), 'transcribe: ok, 180 s left, and the activity moves: ' || r::text);
  PERFORM pg_temp.assert_true(r::text NOT LIKE '%fc:%' AND public.factcheck_touch(pg_temp.u(18), sid, 'check')::text NOT LIKE '%fc:%', 'a touch never returns the hold key');
  PERFORM pg_temp.assert_true(public.factcheck_touch(pg_temp.u(18), sid, 'transcribe') ->> 'reason' = 'not_found'
    AND public.factcheck_touch(u, gen_random_uuid(), 'transcribe') ->> 'reason' = 'not_found'
    AND public.factcheck_touch(pg_temp.u(18), sid, 'extract') ->> 'reason' = 'not_found', 'another user''s or an unknown session is not_found');
  PERFORM pg_temp.rejected(format('SELECT public.factcheck_touch(%L, %L, %L)', u, sid, 'other'), '22023', 'an unknown action raises');
  PERFORM pg_temp.rejected(format('SELECT public.factcheck_touch(%L, %L, NULL)', u, sid), '22023', 'a missing action raises');
  PERFORM pg_temp.rejected(format('SELECT public.factcheck_touch(NULL, %L, %L)', sid, 'check'), '22023', 'a missing user raises');

  -- transcribe is allowed to 15 s past the block, not after.
  PERFORM pg_temp.age(sid, interval '315 seconds', interval '1 second');
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'transcribe') ->> 'ok' = 'true', 'transcribe: still ok 15 s past the block');
  PERFORM pg_temp.age(sid, interval '316 seconds', interval '1 second');
  r := public.factcheck_touch(u, sid, 'transcribe');
  PERFORM pg_temp.assert_true(r = '{"ok": false, "reason": "ended"}'::jsonb
    AND (SELECT last_activity_at = now() - interval '1 second' FROM public.factcheck_sessions WHERE id = sid),
    'transcribe: ended 16 s past the block, and the activity does not move');
  PERFORM public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'transcribe') ->> 'reason' = 'settled', 'transcribe after the settle is settled');
END;
$$;

-- Rates, per USER and calendar minute: transcribe 10, extract 6, check 20.
DO $$
DECLARE u uuid := pg_temp.u(18); sid uuid; i integer; r jsonb; la timestamptz;
BEGIN
  sid := pg_temp.run(u, 15);
  PERFORM pg_temp.age(sid, interval '10 minutes', interval '30 seconds');   -- m = 10: the budgets are not the limit here
  FOR i IN 1..10 LOOP
    r := public.factcheck_touch(u, sid, 'transcribe');
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: transcribe % was refused: %', i, r; END IF;
  END LOOP;
  PERFORM pg_temp.age(sid, interval '10 minutes', interval '30 seconds');
  SELECT last_activity_at INTO la FROM public.factcheck_sessions WHERE id = sid;
  r := public.factcheck_touch(u, sid, 'transcribe');
  PERFORM pg_temp.assert_true(r = '{"ok": false, "reason": "rate_limited"}'::jsonb
    AND (SELECT last_activity_at = la FROM public.factcheck_sessions WHERE id = sid),
    'the 11th transcribe in a minute is rate_limited and does not move the activity');
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'extract') ->> 'ok' = 'true', 'the limits are per action');

  FOR i IN 2..6 LOOP
    r := public.factcheck_touch(u, sid, 'extract');
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: extract % was refused: %', i, r; END IF;
  END LOOP;
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'extract') ->> 'reason' = 'rate_limited', 'the 7th extract in a minute is rate_limited');

  FOR i IN 1..20 LOOP
    r := public.factcheck_touch(u, sid, 'check');
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: check % was refused: %', i, r; END IF;
  END LOOP;
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'check') ->> 'reason' = 'rate_limited', 'the 21st check in a minute is rate_limited');
  PERFORM pg_temp.assert_true((SELECT n FROM private.factcheck_rate WHERE user_id = u AND action = 'transcribe') = 10
    AND (SELECT n FROM private.factcheck_rate WHERE user_id = u AND action = 'extract') = 6
    AND (SELECT n FROM private.factcheck_rate WHERE user_id = u AND action = 'check') = 20, 'refused calls are not counted');
  PERFORM pg_temp.assert_true((SELECT n FROM private.factcheck_budget WHERE session_id = sid AND action = 'extract') = 6
    AND (SELECT n FROM private.factcheck_budget WHERE session_id = sid AND action = 'check') = 20,
    'and a call refused by the rate limit gives its budget back');

  -- The next calendar minute starts again.
  UPDATE private.factcheck_rate SET minute = minute - interval '1 minute' WHERE user_id = u;
  r := jsonb_build_array(public.factcheck_touch(u, sid, 'transcribe'), public.factcheck_touch(u, sid, 'extract'),
                         public.factcheck_touch(u, sid, 'check'));
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM jsonb_array_elements(r) e WHERE e ->> 'ok' <> 'true')
    AND (SELECT n FROM private.factcheck_rate WHERE user_id = u AND action = 'check' AND minute = date_trunc('minute', now())) = 1,
    'a different minute resets each count: ' || r::text);
END;
$$;

-- extract and check run on after the block closes, for 120 s, and never extend the charge.
DO $$
DECLARE u uuid := pg_temp.u(20); sid uuid; r jsonb; la timestamptz;
BEGIN
  sid := pg_temp.run(u, 10);
  PERFORM pg_temp.age(sid, interval '4 minutes', interval '100 seconds');
  SELECT last_activity_at INTO la FROM public.factcheck_sessions WHERE id = sid;
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'extract') ->> 'ok' = 'true' AND public.factcheck_touch(u, sid, 'check') ->> 'ok' = 'true'
    AND (SELECT last_activity_at = la FROM public.factcheck_sessions WHERE id = sid),
    'extract and check do not move last_activity_at');
  r := public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true((r ->> 'minutes_used')::int = 3, 'so they do not extend the charge: 155 s is 3 minutes, not the 4 of now: ' || r::text);
END;
$$;
DO $$
DECLARE u uuid := pg_temp.u(21); sid uuid; r jsonb;
BEGIN
  sid := pg_temp.run(u, 5);
  PERFORM pg_temp.age(sid, interval '4 minutes', interval '10 seconds');
  PERFORM public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'extract') ->> 'ok' = 'true' AND public.factcheck_touch(u, sid, 'check') ->> 'ok' = 'true',
    'extract and check are allowed right after the settle');
  UPDATE public.factcheck_sessions SET ended_at = now() - interval '119 seconds' WHERE id = sid;
  UPDATE private.factcheck_rate SET minute = minute - interval '1 minute' WHERE user_id = u;
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'extract') ->> 'ok' = 'true' AND public.factcheck_touch(u, sid, 'check') ->> 'ok' = 'true',
    'and 119 s after the end');
  UPDATE public.factcheck_sessions SET ended_at = now() - interval '121 seconds' WHERE id = sid;
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'extract') = '{"ok": false, "reason": "ended"}'::jsonb
    AND public.factcheck_touch(u, sid, 'check') = '{"ok": false, "reason": "ended"}'::jsonb, 'but not 121 s after the end');
  PERFORM pg_temp.assert_true((SELECT minutes_used = 4 AND credits_charged = 8 FROM public.factcheck_sessions WHERE id = sid) AND pg_temp.charges(u) = 1,
    'and nothing was charged again');
END;
$$;
-- extract and check follow the end of the CHARGE: a session that transcribed to the end of its block gets 120 s after the
-- block; one that never transcribed is being charged one minute and gets them only to 135 s from its start.
SELECT pg_temp.mkuser(22, 500);
SELECT pg_temp.mkuser(29, 500);
SELECT pg_temp.mkuser(30, 500);
DO $$
DECLARE u uuid := pg_temp.u(22); sid uuid;
BEGIN
  sid := pg_temp.run(u, 5);
  PERFORM pg_temp.age(sid, interval '5 minutes 119 seconds', interval '124 seconds');
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'extract') ->> 'ok' = 'true' AND public.factcheck_touch(u, sid, 'check') ->> 'ok' = 'true',
    'a session that transcribed to its block''s end gets extract and check 119 s after the block');
  PERFORM pg_temp.age(sid, interval '5 minutes 121 seconds', interval '126 seconds');
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'extract') ->> 'reason' = 'ended'
    AND public.factcheck_touch(u, sid, 'check') ->> 'reason' = 'ended', 'and not 121 s after the block');
  PERFORM public.factcheck_settle(u, sid);
END;
$$;
DO $$
DECLARE u uuid := pg_temp.u(29); sid uuid; r jsonb;
BEGIN
  sid := pg_temp.run(u, 10);
  PERFORM pg_temp.age(sid, interval '134 seconds', interval '134 seconds');
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'extract') ->> 'ok' = 'true' AND public.factcheck_touch(u, sid, 'check') ->> 'ok' = 'true',
    'a session that never transcribed still gets extract and check at 134 s (15 s + 120 s from its start)');
  PERFORM pg_temp.age(sid, interval '136 seconds', interval '136 seconds');
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'extract') = '{"ok": false, "reason": "ended"}'::jsonb
    AND public.factcheck_touch(u, sid, 'check') = '{"ok": false, "reason": "ended"}'::jsonb,
    'but not at 136 s: it is charged one minute and does not get the whole block of free work');
  r := public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true((r ->> 'minutes_used')::int = 1, 'and its charge is one minute: ' || r::text);
END;
$$;
DO $$
DECLARE u uuid := pg_temp.u(30); sid uuid;
BEGIN
  sid := pg_temp.run(u, 10);
  PERFORM pg_temp.age(sid, interval '8 minutes', interval '5 seconds');
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'extract') ->> 'ok' = 'true' AND public.factcheck_touch(u, sid, 'check') ->> 'ok' = 'true',
    'a session that is transcribing gets extract and check throughout its block');
  PERFORM pg_temp.age(sid, interval '8 minutes', interval '134 seconds');
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'extract') ->> 'ok' = 'true' AND public.factcheck_touch(u, sid, 'check') ->> 'ok' = 'true',
    'and until 120 s after its last accepted piece plus 15 s (134 s after the piece)');
  PERFORM pg_temp.age(sid, interval '8 minutes', interval '136 seconds');
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, sid, 'extract') ->> 'reason' = 'ended'
    AND public.factcheck_touch(u, sid, 'check') ->> 'reason' = 'ended', 'but not at 136 s after it');
  PERFORM public.factcheck_settle(u, sid);
END;
$$;

-- 8b. What bounds paid work: per-user limits, the per-session budget, the kill switch, the price, the active id --------------
SELECT pg_temp.mkuser(31, 500);
SELECT pg_temp.mkuser(32, 500);
SELECT pg_temp.mkuser(33, 500);
SELECT pg_temp.mkuser(34, 500);
SELECT pg_temp.mkuser(35, 500);
SELECT pg_temp.mkuser(36, 500);
SELECT pg_temp.mkuser(37, 500);

-- The audit's chain: start, stop at once (one minute charged), then keep using the settled session; and a new session at once.
DO $$
DECLARE u uuid := pg_temp.u(31); a uuid; b uuid; i integer; r jsonb;
BEGIN
  a := pg_temp.run(u, 10);
  r := public.factcheck_settle(u, a);
  PERFORM pg_temp.assert_true((r ->> 'minutes_used')::int = 1, 'the audit chain: stopped at once, one minute charged');
  FOR i IN 1..5 LOOP
    r := public.factcheck_touch(u, a, 'extract');
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: extract % on the settled session was refused: %', i, r; END IF;
  END LOOP;
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, a, 'extract') = '{"ok": false, "reason": "budget"}'::jsonb,
    'the 6th extract on a session charged one minute is refused with budget (3m + 2 = 5)');
  FOR i IN 1..12 LOOP
    r := public.factcheck_touch(u, a, 'check');
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: check % on the settled session was refused: %', i, r; END IF;
  END LOOP;
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, a, 'check') = '{"ok": false, "reason": "budget"}'::jsonb,
    'the 13th check is refused with budget (8m + 4 = 12)');
  PERFORM pg_temp.assert_true((SELECT n FROM private.factcheck_budget WHERE session_id = a AND action = 'extract') = 5
    AND (SELECT n FROM private.factcheck_budget WHERE session_id = a AND action = 'check') = 12
    AND (SELECT n FROM private.factcheck_rate WHERE user_id = u AND action = 'extract') = 5
    AND (SELECT n FROM private.factcheck_rate WHERE user_id = u AND action = 'check') = 12,
    'a budget refusal counts nothing, neither against the budget nor the minute');
  -- A second session started at once shares the user's minute limits (6 extracts, 20 checks) and has its own budget.
  b := pg_temp.run(u, 10);
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, b, 'extract') ->> 'ok' = 'true'
    AND public.factcheck_touch(u, b, 'extract') = '{"ok": false, "reason": "rate_limited"}'::jsonb,
    'a new session at once gets one more extract this minute (6 for the user) and then rate_limited');
  FOR i IN 1..8 LOOP
    r := public.factcheck_touch(u, b, 'check');
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: check % on the new session was refused: %', i, r; END IF;
  END LOOP;
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, b, 'check') ->> 'reason' = 'rate_limited',
    'and 8 more checks (20 for the user) and then rate_limited');
  PERFORM pg_temp.assert_true((SELECT n FROM private.factcheck_budget WHERE session_id = b AND action = 'extract') = 1
    AND (SELECT n FROM private.factcheck_budget WHERE session_id = b AND action = 'check') = 8, 'its budget counts only what was accepted');
  PERFORM public.factcheck_settle(u, b);
END;
$$;

-- The budget grows with the minutes that are charged.
DO $$
DECLARE u uuid := pg_temp.u(32); s uuid; i integer; r jsonb;
BEGIN
  s := pg_temp.run(u, 15);
  PERFORM pg_temp.age(s, interval '170 seconds', interval '1 second');   -- a settlement now would charge 3 minutes
  FOR i IN 1..11 LOOP
    DELETE FROM private.factcheck_rate WHERE user_id = u;                -- a fresh minute each time
    r := public.factcheck_touch(u, s, 'extract');
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: extract % at m = 3 was refused: %', i, r; END IF;
  END LOOP;
  DELETE FROM private.factcheck_rate WHERE user_id = u;
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, s, 'extract') ->> 'reason' = 'budget', 'at m = 3 the 12th extract is refused (3m + 2 = 11)');
  FOR i IN 1..28 LOOP
    DELETE FROM private.factcheck_rate WHERE user_id = u;
    r := public.factcheck_touch(u, s, 'check');
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: check % at m = 3 was refused: %', i, r; END IF;
  END LOOP;
  DELETE FROM private.factcheck_rate WHERE user_id = u;
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, s, 'check') ->> 'reason' = 'budget', 'at m = 3 the 29th check is refused (8m + 4 = 28)');
  PERFORM pg_temp.assert_true((SELECT n FROM private.factcheck_budget WHERE session_id = s AND action = 'extract') = 11
    AND (SELECT n FROM private.factcheck_budget WHERE session_id = s AND action = 'check') = 28, 'and the refusals counted nothing');
  PERFORM pg_temp.age(s, interval '290 seconds', interval '1 second');   -- now 5 minutes: 17 extracts, 44 checks
  DELETE FROM private.factcheck_rate WHERE user_id = u;
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, s, 'extract') ->> 'ok' = 'true' AND public.factcheck_touch(u, s, 'check') ->> 'ok' = 'true',
    'when more minutes are charged the budget grows');
  r := public.factcheck_settle(u, s);
  PERFORM pg_temp.assert_true((r ->> 'minutes_used')::int = 5, 'the session is settled at 5 minutes');
  FOR i IN 1..4 LOOP   -- 12 extracts so far; 17 = 3 * 5 + 2 allowed after the settle, on minutes_used
    DELETE FROM private.factcheck_rate WHERE user_id = u;
    r := public.factcheck_touch(u, s, 'extract');
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: extract % after the settle at 5 minutes was refused: %', 12 + i, r; END IF;
  END LOOP;
  DELETE FROM private.factcheck_rate WHERE user_id = u;
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, s, 'extract') ->> 'ok' = 'true'
    AND public.factcheck_touch(u, s, 'extract') ->> 'reason' = 'budget',
    'a settled session''s budget follows its minutes_used: the 17th extract is accepted and the 18th refused');
END;
$$;

-- The minute limits belong to the user across sessions, and not to anyone else.
DO $$
DECLARE u uuid := pg_temp.u(33); v uuid := pg_temp.u(34); a uuid; b uuid; c uuid; i integer;
BEGIN
  a := pg_temp.run(u, 10);
  PERFORM public.factcheck_settle(u, a);
  b := pg_temp.run(u, 10);
  c := pg_temp.run(v, 10);
  FOR i IN 1..3 LOOP
    IF public.factcheck_touch(u, a, 'extract') ->> 'ok' <> 'true' OR public.factcheck_touch(u, b, 'extract') ->> 'ok' <> 'true' THEN
      RAISE EXCEPTION 'FAIL: extract % across two sessions was refused', i;
    END IF;
  END LOOP;
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, b, 'extract') ->> 'reason' = 'rate_limited'
    AND public.factcheck_touch(u, a, 'extract') ->> 'reason' = 'rate_limited',
    'six extracts across two sessions of one user hit the user''s limit on either');
  PERFORM pg_temp.assert_true((SELECT n FROM private.factcheck_budget WHERE session_id = b AND action = 'extract') = 3,
    'the refused call gave its budget back');
  PERFORM pg_temp.assert_true(public.factcheck_touch(v, c, 'extract') ->> 'ok' = 'true', 'another user is not limited by the first');
  PERFORM public.factcheck_settle(u, b);
  PERFORM public.factcheck_settle(v, c);
END;
$$;

-- The kill switch: touch answers off for every action, settle and the job still charge.
DO $$
DECLARE u uuid := pg_temp.u(35); w uuid := pg_temp.u(36); s uuid; t uuid; act text; r jsonb; n integer;
BEGIN
  s := pg_temp.run(u, 10);
  PERFORM pg_temp.age(s, interval '2 minutes', interval '1 second');
  t := pg_temp.run(w, 5);
  PERFORM pg_temp.age(t, interval '10 minutes', interval '9 minutes');
  PERFORM pg_temp.setflag('{"enabled":false,"audience":"admin","credits_per_minute":2}');
  FOREACH act IN ARRAY ARRAY['transcribe', 'extract', 'check'] LOOP
    PERFORM pg_temp.assert_true(public.factcheck_touch(u, s, act) = '{"ok": false, "reason": "off"}'::jsonb
      AND public.factcheck_touch(u, gen_random_uuid(), act) = '{"ok": false, "reason": "off"}'::jsonb,
      'flag disabled: ' || act || ' answers off');
  END LOOP;
  PERFORM pg_temp.setflag('{"enabled":"true","audience":"admin","credits_per_minute":2}');
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, s, 'transcribe') ->> 'reason' = 'off', 'a malformed flag is off for touch too');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM private.factcheck_rate WHERE user_id = u) = 0
    AND (SELECT last_activity_at = now() - interval '1 second' FROM public.factcheck_sessions WHERE id = s), 'and an off touch counts and moves nothing');
  r := public.factcheck_settle(u, s);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND (r ->> 'minutes_used')::int = 2 AND (r ->> 'credits_charged')::numeric = 4,
    'with the flag off a running session is still charged for what it used: ' || r::text);
  n := public.factcheck_settle_expired();
  PERFORM pg_temp.assert_true(n >= 1 AND (SELECT status = 'settled' FROM public.factcheck_sessions WHERE id = t), 'and settle_expired still settles: ' || n);
  PERFORM pg_temp.setflag('{"enabled":true,"audience":"admin","credits_per_minute":2}');
  s := pg_temp.run(u, 5);
  PERFORM pg_temp.assert_true(public.factcheck_touch(u, s, 'check') ->> 'ok' = 'true', 'with the flag back on, touch works again (the audience is not rechecked)');
  PERFORM public.factcheck_settle(u, s);
END;
$$;

-- The price the user saw.
DO $$
DECLARE u uuid := pg_temp.u(37); r jsonb; s uuid;
BEGIN
  r := public.factcheck_start(u, 'vid1', 'chan1', 'live', NULL, 10, true, 3);
  PERFORM pg_temp.assert_true(r = jsonb_build_object('ok', false, 'reason', 'price_changed', 'credits_per_minute', 2),
    'a different expected price is refused with the current price: ' || r::text);
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_sessions WHERE user_id = u)
    AND NOT EXISTS (SELECT FROM public.credit_holds WHERE user_id = u), 'and creates nothing');
  PERFORM pg_temp.assert_true(public.factcheck_start(u, 'vid1', 'chan1', 'live', NULL, 10, true, 0) ->> 'reason' = 'price_changed', 'an expected price of 0 is a mismatch');
  r := public.factcheck_start(u, 'vid1', 'chan1', 'live', NULL, 10, true, 2);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true', 'the matching price starts the session');
  s := (r ->> 'session_id')::uuid;
  PERFORM public.factcheck_settle(u, s);
  r := public.factcheck_start(u, 'vid1', 'chan1', 'live', NULL, 10, true, NULL);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true', 'no expected price starts as before');
  PERFORM public.factcheck_settle(u, (r ->> 'session_id')::uuid);
  PERFORM pg_temp.rejected(format('SELECT public.factcheck_start(%L, %L, %L, %L, NULL, 5, true, %L)', u, 'v', 'c', 'live', 'NaN'), '22023', 'a NaN expected price raises');
  PERFORM pg_temp.rejected(format('SELECT public.factcheck_start(%L, %L, %L, %L, NULL, 5, true, %L)', u, 'v', 'c', 'live', 'Infinity'), '22023', 'an infinite expected price raises');
  PERFORM pg_temp.rejected(format('SELECT public.factcheck_start(%L, %L, %L, %L, NULL, 5, true, -1)', u, 'v', 'c', 'live'), '22023', 'a negative expected price raises');
  PERFORM pg_temp.rejected(format('SELECT public.factcheck_start(%L, %L, %L, %L, NULL, 5, true, 5001)', u, 'v', 'c', 'live'), '22023', 'an expected price over the cap raises');
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_sessions WHERE user_id = u AND status = 'active'), 'nothing was left running');
END;
$$;

-- 9. Row-level security -----------------------------------------------------------------------------------------------------------
SELECT pg_temp.mkuser(23, 0);
SELECT pg_temp.mkuser(24, 0);
DO $$
DECLARE
  a uuid := pg_temp.u(23); b uuid := pg_temp.u(24);
  a_live uuid; a_rec uuid; a_act uuid; b_live uuid;
BEGIN
  a_live := pg_temp.sess(a, 'live', 'settled', interval '3 hours');
  a_rec := pg_temp.sess(a, 'recorded', 'settled', interval '2 hours');
  a_act := pg_temp.sess(a, 'live', 'active', interval '1 minute');
  b_live := pg_temp.sess(b, 'live', 'settled', interval '3 hours');
  PERFORM pg_temp.claim(a_live, a, 'a-live-claim');
  PERFORM pg_temp.claim(a_rec, a, 'a-rec-claim');
  PERFORM pg_temp.claim(b_live, b, 'b-live-claim');
  CREATE TEMP TABLE rls_ids (k text PRIMARY KEY, id uuid);
  GRANT ALL ON rls_ids TO anon, authenticated, service_role;
  INSERT INTO rls_ids VALUES ('a_live', a_live), ('a_rec', a_rec), ('a_act', a_act), ('b_live', b_live);
END;
$$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000fc023';
SELECT pg_temp.assert_true((SELECT count(*) FROM public.factcheck_sessions) = 3 AND NOT EXISTS (SELECT FROM public.factcheck_sessions WHERE user_id <> auth.uid()),
  'user A reads exactly A''s three sessions');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.factcheck_claims) = 2 AND NOT EXISTS (SELECT FROM public.factcheck_claims WHERE quote = 'b-live-claim'),
  'user A reads A''s claims and not B''s');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000fc024';
SELECT pg_temp.assert_true((SELECT count(*) FROM public.factcheck_sessions) = 1 AND NOT EXISTS (SELECT FROM public.factcheck_sessions WHERE user_id <> auth.uid())
  AND (SELECT count(*) FROM public.factcheck_claims) = 1 AND NOT EXISTS (SELECT FROM public.factcheck_claims WHERE quote LIKE 'a-%'),
  'user B reads only B''s session and claim');
RESET ROLE;

-- Deletes: only one's own settled live sessions.
DO $$
DECLARE n integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(23)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  DELETE FROM public.factcheck_sessions WHERE id = (SELECT id FROM rls_ids WHERE k = 'b_live');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.assert_true(n = 0, 'A cannot delete B''s session');
  DELETE FROM public.factcheck_sessions WHERE id = (SELECT id FROM rls_ids WHERE k = 'a_act');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.assert_true(n = 0, 'A cannot delete their own running session');
  DELETE FROM public.factcheck_sessions WHERE id = (SELECT id FROM rls_ids WHERE k = 'a_rec');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.assert_true(n = 0, 'A cannot delete their own recorded-video session');
  DELETE FROM public.factcheck_sessions WHERE id = (SELECT id FROM rls_ids WHERE k = 'a_live');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.assert_true(n = 1, 'A can delete their own settled live session');
  PERFORM pg_temp.rejected($q$UPDATE public.factcheck_sessions SET credits_charged = 1$q$, '42501', 'authenticated cannot update sessions');
  PERFORM pg_temp.rejected($q$INSERT INTO public.factcheck_sessions (user_id, video_id, channel_id, video_kind, minutes_bought, credits_per_minute, credits_held)
    VALUES (auth.uid(), 'v', 'c', 'live', 5, 1, 5)$q$, '42501', 'authenticated cannot insert sessions');
  PERFORM pg_temp.rejected($q$INSERT INTO public.factcheck_claims (session_id, user_id, video_id, video_kind, spoken_at, quote, claim_en, kind, status)
    VALUES (gen_random_uuid(), auth.uid(), 'v', 'live', now(), 'q', 'c', 'claim', 'pending')$q$, '42501', 'authenticated cannot insert claims');
  PERFORM pg_temp.rejected($q$UPDATE public.factcheck_claims SET reason = 'x'$q$, '42501', 'authenticated cannot update claims');
  PERFORM pg_temp.rejected($q$DELETE FROM public.factcheck_claims$q$, '42501', 'authenticated cannot delete claims directly');
  PERFORM pg_temp.rejected($q$SELECT * FROM private.factcheck_hold_keys$q$, '42501', 'authenticated cannot read the hold keys');
  PERFORM pg_temp.rejected($q$SELECT public.factcheck_settle_expired()$q$, '42501', 'authenticated cannot call factcheck_settle_expired');
  PERFORM pg_temp.rejected($q$SELECT public.factcheck_start(auth.uid(), 'v', 'c', 'live', NULL, 5, true)$q$, '42501', 'authenticated cannot call factcheck_start');
  PERFORM pg_temp.rejected($q$SELECT public.factcheck_touch(auth.uid(), gen_random_uuid(), 'check')$q$, '42501', 'authenticated cannot call factcheck_touch');
  PERFORM pg_temp.rejected($q$SELECT public.factcheck_settle(auth.uid(), gen_random_uuid())$q$, '42501', 'authenticated cannot call factcheck_settle');
  EXECUTE 'RESET ROLE';
END;
$$;
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_claims WHERE quote = 'a-live-claim')
  AND EXISTS (SELECT FROM public.factcheck_claims WHERE quote = 'a-rec-claim') AND EXISTS (SELECT FROM public.factcheck_claims WHERE quote = 'b-live-claim'),
  'deleting a session removed its claims and no one else''s');

SET LOCAL ROLE anon;
SELECT pg_temp.rejected($q$SELECT * FROM public.factcheck_sessions$q$, '42501', 'anon cannot read sessions');
SELECT pg_temp.rejected($q$SELECT * FROM public.factcheck_claims$q$, '42501', 'anon cannot read claims');
RESET ROLE;

-- service_role: reads sessions, writes only claims.
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT count(*) FROM public.factcheck_sessions) > 0, 'service_role reads sessions');
SELECT pg_temp.rejected($q$UPDATE public.factcheck_sessions SET credits_charged = 99$q$, '42501', 'service_role cannot rewrite a charge');
SELECT pg_temp.rejected($q$DELETE FROM public.factcheck_sessions$q$, '42501', 'service_role cannot delete sessions');
SELECT pg_temp.rejected($q$DELETE FROM public.factcheck_claims$q$, '42501', 'service_role cannot delete claims');
SELECT pg_temp.rejected($q$SELECT * FROM private.factcheck_rate$q$, '42501', 'service_role cannot read the rate table');
RESET ROLE;

SET LOCAL ROLE service_role;
INSERT INTO public.factcheck_claims (session_id, user_id, video_id, video_kind, spoken_at, quote, claim_en, kind, status)
SELECT id, pg_temp.u(23), 'v', 'live', now(), 'written-by-service', 'c', 'claim', 'pending' FROM rls_ids WHERE k = 'a_act';
UPDATE public.factcheck_claims SET status = 'checked', verdict = 'supported', reason = 'because', sources = '[{"url":"https://example.invalid/a","title":"A"}]', checked_at = now()
WHERE quote = 'written-by-service';
SELECT pg_temp.assert_true((SELECT verdict = 'supported' FROM public.factcheck_claims WHERE quote = 'written-by-service'), 'service_role inserts and updates claims');
SELECT pg_temp.rejected(format($q$INSERT INTO public.factcheck_claims (session_id, user_id, video_id, video_kind, spoken_at, quote, claim_en, kind, status)
  VALUES (%L, %L, 'v', 'live', now(), 'q', 'c', 'claim', 'pending')$q$, (SELECT id FROM rls_ids WHERE k = 'a_act'), pg_temp.u(24)),
  '23503', 'a claim must belong to a session of the same user');
RESET ROLE;

SELECT pg_temp.rejected(format($q$INSERT INTO public.factcheck_claims (session_id, user_id, video_id, video_kind, spoken_at, quote, claim_en, kind, status)
  VALUES (%L, %L, 'v', 'live', now(), repeat('q', 301), 'c', 'claim', 'pending')$q$, (SELECT id FROM rls_ids WHERE k = 'a_act'), pg_temp.u(23)),
  '23514', 'a quote is at most 300 characters');
SELECT pg_temp.rejected(format($q$INSERT INTO public.factcheck_claims (session_id, user_id, video_id, video_kind, position_s, spoken_at, quote, claim_en, kind, status)
  VALUES (%L, %L, 'v', 'recorded', 'NaN', now(), 'q', 'c', 'claim', 'pending')$q$, (SELECT id FROM rls_ids WHERE k = 'a_act'), pg_temp.u(23)),
  '23514', 'a claim position may not be NaN');
SELECT pg_temp.rejected(format($q$INSERT INTO public.factcheck_claims (session_id, user_id, video_id, video_kind, position_s, spoken_at, quote, claim_en, kind, status)
  VALUES (%L, %L, 'v', 'recorded', 'Infinity', now(), 'q', 'c', 'claim', 'pending')$q$, (SELECT id FROM rls_ids WHERE k = 'a_act'), pg_temp.u(23)),
  '23514', 'a claim position may not be infinite');
SELECT pg_temp.rejected(format($q$INSERT INTO public.factcheck_claims (session_id, user_id, video_id, video_kind, spoken_at, quote, claim_en, kind, status, verdict)
  VALUES (%L, %L, 'v', 'live', now(), 'q', 'c', 'claim', 'checked', 'maybe')$q$, (SELECT id FROM rls_ids WHERE k = 'a_act'), pg_temp.u(23)),
  '23514', 'a verdict must be one of the five labels');
SELECT pg_temp.rejected(format($q$INSERT INTO public.factcheck_claims (session_id, user_id, video_id, video_kind, spoken_at, quote, claim_en, kind, status, sources)
  VALUES (%L, %L, 'v', 'live', now(), 'q', 'c', 'claim', 'pending', '[1,2,3,4,5,6,7,8,9]')$q$, (SELECT id FROM rls_ids WHERE k = 'a_act'), pg_temp.u(23)),
  '23514', 'at most 8 sources');
SELECT pg_temp.rejected($q$INSERT INTO public.factcheck_sessions (user_id, video_id, channel_id, video_kind, minutes_bought, credits_per_minute, credits_held)
  VALUES (pg_temp.u(23), 'v', 'c', 'live', 5, 1, 5)$q$, '23505', 'a second running session for one user is refused by the index');

-- Account deletion removes everything of the user's.
DO $$
DECLARE u uuid := pg_temp.u(23);
BEGIN
  DELETE FROM auth.users WHERE id = u;
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_sessions WHERE user_id = u)
    AND NOT EXISTS (SELECT FROM public.factcheck_claims WHERE user_id = u), 'deleting the account removes its sessions and claims');
END;
$$;
DO $$
DECLARE u uuid := pg_temp.u(12); sid uuid := pg_temp.sid(pg_temp.u(12));
BEGIN
  PERFORM pg_temp.assert_true(sid IS NOT NULL AND EXISTS (SELECT FROM private.factcheck_hold_keys WHERE session_id = sid), 'a running session has its hold key');
  INSERT INTO private.factcheck_rate (user_id, action, minute, n) VALUES (u, 'check', now(), 1);
  INSERT INTO private.factcheck_budget (session_id, action, n) VALUES (sid, 'check', 1);
  DELETE FROM auth.users WHERE id = u;
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM private.factcheck_hold_keys WHERE session_id = sid)
    AND NOT EXISTS (SELECT FROM public.credit_holds WHERE user_id = u)
    AND NOT EXISTS (SELECT FROM private.factcheck_rate WHERE user_id = u)
    AND NOT EXISTS (SELECT FROM private.factcheck_budget WHERE session_id = sid),
    'deleting the account removes the hold key, the hold, the rate rows and the budget rows');
END;
$$;

SELECT pg_temp.invariants('at the end');
ROLLBACK;
