-- Fact-check session lengths of 1 and 2 minutes (migration 20261119090000; open-work F350).
-- PostgreSQL assertions, no pgTAP. Run only in a disposable database, through run.sh, which applies the migration as a
-- non-superuser (nter_migrator). Bootstrap: the factcheck_fail_reason chain, then 20261119090000_factcheck_session_lengths.sql.
-- The vacuity check drops the last: the first assertion fails.
-- Users (00000000-0000-4000-8000-0000000fd0NN): one per started session, because a user may hold one active session.
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
CREATE FUNCTION pg_temp.u(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-0000000fd' || lpad(n::text, 3, '0'))::uuid;
$$;
CREATE FUNCTION pg_temp.mkuser(n integer, credits numeric) RETURNS uuid LANGUAGE plpgsql AS $$
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
CREATE FUNCTION pg_temp.st(p_user uuid, p_minutes integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.factcheck_start(p_user, 'vid1', 'chan1', 'live', NULL, p_minutes, true);
$$;

-- The flag row: on, admins only, 2 credits a minute.
INSERT INTO public.app_flags (key, value) VALUES ('livetv_factcheck', '{"enabled":true,"audience":"admin","credits_per_minute":2}');

-- 1. The table CHECK -------------------------------------------------------------------------------------------------------------
SELECT pg_temp.mkuser(1, 1000);
INSERT INTO public.factcheck_sessions (user_id, video_id, channel_id, video_kind, minutes_bought, credits_per_minute, credits_held)
SELECT pg_temp.u(1), 'v', 'c', 'live', 1, 2, 2;
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.factcheck_sessions WHERE minutes_bought = 1), 'the table accepts minutes_bought 1');
DELETE FROM public.factcheck_sessions;
INSERT INTO public.factcheck_sessions (user_id, video_id, channel_id, video_kind, minutes_bought, credits_per_minute, credits_held)
SELECT pg_temp.u(1), 'v', 'c', 'live', 2, 2, 4;
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.factcheck_sessions WHERE minutes_bought = 2), 'the table accepts minutes_bought 2');
DELETE FROM public.factcheck_sessions;
DO $$
DECLARE m integer;
BEGIN
  FOREACH m IN ARRAY ARRAY[0, 3, 4, 20, -1] LOOP
    PERFORM pg_temp.rejected(format('INSERT INTO public.factcheck_sessions (user_id, video_id, channel_id, video_kind, minutes_bought, credits_per_minute, credits_held) VALUES (%L, ''v'', ''c'', ''live'', %s, 2, 2)', pg_temp.u(1), m),
      '23514', 'the table still refuses minutes_bought ' || m);
  END LOOP;
END;
$$;
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND min(c.conname) = 'factcheck_sessions_minutes_bought_check'
  FROM pg_constraint c WHERE c.conrelid = 'public.factcheck_sessions'::regclass AND c.contype = 'c' AND array_length(c.conkey, 1) = 1
    AND c.conkey[1] = (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attname = 'minutes_bought')),
  'exactly one CHECK on minutes_bought, under the explicit name');

-- 2. factcheck_start -------------------------------------------------------------------------------------------------------------
SELECT pg_temp.mkuser(n, 1000) FROM generate_series(2, 12) n;
DO $$
DECLARE r jsonb; m integer; n integer := 2;
BEGIN
  FOREACH m IN ARRAY ARRAY[1, 2, 5, 10, 15] LOOP
    r := pg_temp.st(pg_temp.u(n), m);
    PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND (r ->> 'credits_held')::numeric = m * 2
      AND (SELECT minutes_bought = m AND credits_held = m * 2 FROM public.factcheck_sessions WHERE id = (r ->> 'session_id')::uuid)
      AND (SELECT sum(credits) = m * 2 FROM public.credit_holds WHERE user_id = pg_temp.u(n) AND settled_at IS NULL),
      format('%s minutes starts and holds %s credits: %s', m, m * 2, r));
    n := n + 1;
  END LOOP;
  FOREACH m IN ARRAY ARRAY[0, 3, 4, 7, 20, 30] LOOP
    r := pg_temp.st(pg_temp.u(n), m);
    PERFORM pg_temp.assert_true(r = '{"ok": false, "reason": "bad_minutes"}'::jsonb, format('%s minutes is bad_minutes: %s', m, r));
  END LOOP;
  r := pg_temp.st(pg_temp.u(n), NULL);
  PERFORM pg_temp.assert_true(r = '{"ok": false, "reason": "bad_minutes"}'::jsonb, 'NULL minutes is bad_minutes: ' || r::text);
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_sessions WHERE user_id = pg_temp.u(n))
    AND NOT EXISTS (SELECT FROM public.credit_holds WHERE user_id = pg_temp.u(n)), 'a refused length creates no session and no hold');
END;
$$;

-- 3. A 1-minute session settled at once is charged one minute ------------------------------------------------------------------
SELECT pg_temp.mkuser(20, 1000);
DO $$
DECLARE u uuid := pg_temp.u(20); r jsonb; sid uuid;
BEGIN
  r := pg_temp.st(u, 1);
  sid := (r ->> 'session_id')::uuid;
  r := public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND (r ->> 'minutes_used')::int = 1 AND (r ->> 'credits_charged')::numeric = 2
    AND (r ->> 'balance')::numeric = 998, 'a 1-minute session settled at once is charged one minute: ' || r::text);
  PERFORM pg_temp.assert_true((SELECT status = 'settled' AND minutes_used = 1 AND credits_charged = 2 FROM public.factcheck_sessions WHERE id = sid),
    'the session records minutes_used 1');
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM public.credit_holds WHERE user_id = u AND settled_at IS NULL), 'the hold is released');
END;
$$;

-- 4. A 1-minute session's extract budget is 3 x 1 + 2 = 5 ----------------------------------------------------------------------
SELECT pg_temp.mkuser(21, 1000);
DO $$
DECLARE u uuid := pg_temp.u(21); sid uuid := (pg_temp.st(u, 1) ->> 'session_id')::uuid; r jsonb; i integer;
BEGIN
  FOR i IN 1..5 LOOP
    r := public.factcheck_touch(u, sid, 'extract');
    PERFORM pg_temp.assert_true(r ->> 'ok' = 'true', format('extract call %s of a 1-minute session is allowed: %s', i, r));
  END LOOP;
  r := public.factcheck_touch(u, sid, 'extract');
  PERFORM pg_temp.assert_true(r = '{"ok": false, "reason": "budget"}'::jsonb, 'the 6th extract call is refused as budget (the rate limit is 6): ' || r::text);
END;
$$;

-- 4b. A backdated 1-minute session is settled by the sweep ----------------------------------------------------------------------
SELECT pg_temp.mkuser(23, 1000);
DO $$
DECLARE u uuid := pg_temp.u(23); sid uuid := (pg_temp.st(u, 1) ->> 'session_id')::uuid; n integer;
BEGIN
  UPDATE public.factcheck_sessions SET started_at = now() - interval '10 minutes', last_activity_at = now() - interval '9 minutes' WHERE id = sid;
  n := public.factcheck_settle_expired();
  PERFORM pg_temp.assert_true(n = 1, 'the sweep settles the one expired session: ' || n);
  PERFORM pg_temp.assert_true((SELECT status = 'settled' AND minutes_used = 1 AND credits_charged = 2 FROM public.factcheck_sessions WHERE id = sid),
    'a backdated 1-minute session is charged one minute at 2 credits');
  PERFORM pg_temp.assert_true((SELECT count(*) = 1 FROM public.credit_holds WHERE user_id = u AND settled_at IS NOT NULL)
    AND NOT EXISTS (SELECT FROM public.credit_holds WHERE user_id = u AND settled_at IS NULL)
    AND (SELECT balance = 998 FROM public.credit_wallets WHERE user_id = u), 'its hold is settled and the wallet is charged 2');
END;
$$;

-- 5. The function is otherwise what it was --------------------------------------------------------------------------------------
SELECT pg_temp.assert_true((SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""', 'TimeZone=UTC'] AND p.pronargs = 8 AND p.pronargdefaults = 1
  AND p.prorettype = 'jsonb'::regtype AND l.lanname = 'plpgsql'
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = 'public.factcheck_start(uuid,text,text,text,numeric,integer,boolean,numeric)'::regprocedure),
  'factcheck_start is SECURITY DEFINER, plpgsql, returns jsonb, keeps both SET clauses and the one default');
SELECT pg_temp.mkuser(22, 1000);
SELECT pg_temp.assert_true(public.factcheck_start(pg_temp.u(22), 'vid1', 'chan1', 'live', NULL, 2, true) ->> 'ok' = 'true',
  'called without the last argument, the default (no expected price) still works');
DO $$
DECLARE actor text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['anon', 'authenticated', 'public'] LOOP
    PERFORM pg_temp.assert_true(NOT has_function_privilege(actor, 'public.factcheck_start(uuid,text,text,text,numeric,integer,boolean,numeric)', 'EXECUTE'),
      actor || ' still cannot execute factcheck_start');
  END LOOP;
  PERFORM pg_temp.assert_true(has_function_privilege('service_role', 'public.factcheck_start(uuid,text,text,text,numeric,integer,boolean,numeric)', 'EXECUTE'),
    'service_role can still execute factcheck_start');
END;
$$;
ROLLBACK;
