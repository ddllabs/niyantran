-- Fact-check session lengths of 20 and 30 minutes (migration 20261120090000; open-work F361).
-- PostgreSQL assertions, no pgTAP. Run only in a disposable database, through run.sh, which applies the migration as a
-- non-superuser (nter_migrator). Bootstrap: the factcheck_lengths chain (so lengths 1 to 15 already exist), then
-- 20261120090000_factcheck_session_lengths_20_30.sql. The vacuity check drops the last: the first assertion fails.
-- Users (00000000-0000-4000-8000-0000000feNNN): one per started session, because a user may hold one active session.
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
  SELECT ('00000000-0000-4000-8000-0000000fe' || lpad(n::text, 3, '0'))::uuid;
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
DO $$
DECLARE m integer;
BEGIN
  FOREACH m IN ARRAY ARRAY[1, 2, 5, 10, 15, 20, 30] LOOP
    EXECUTE format('INSERT INTO public.factcheck_sessions (user_id, video_id, channel_id, video_kind, minutes_bought, credits_per_minute, credits_held) VALUES (%L, ''v'', ''c'', ''live'', %s, 2, %s)', pg_temp.u(1), m, m * 2);
    PERFORM pg_temp.assert_true((SELECT count(*) = 1 FROM public.factcheck_sessions WHERE minutes_bought = m), 'the table accepts minutes_bought ' || m);
    DELETE FROM public.factcheck_sessions;
  END LOOP;
  FOREACH m IN ARRAY ARRAY[0, 3, 4, 6, 25, 31, 45, 60, -1] LOOP
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
SELECT pg_temp.mkuser(n, 1000) FROM generate_series(2, 30) n;
DO $$
DECLARE r jsonb; m integer; n integer := 2;
BEGIN
  FOREACH m IN ARRAY ARRAY[1, 2, 5, 10, 15, 20, 30] LOOP
    r := pg_temp.st(pg_temp.u(n), m);
    PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND (r ->> 'credits_held')::numeric = m * 2
      AND (SELECT minutes_bought = m AND credits_held = m * 2 FROM public.factcheck_sessions WHERE id = (r ->> 'session_id')::uuid)
      AND (SELECT sum(credits) = m * 2 FROM public.credit_holds WHERE user_id = pg_temp.u(n) AND settled_at IS NULL),
      format('%s minutes starts and holds %s credits: %s', m, m * 2, r));
    n := n + 1;
  END LOOP;
  FOREACH m IN ARRAY ARRAY[0, 3, 4, 7, 25, 31, 40, 45, 60] LOOP
    r := pg_temp.st(pg_temp.u(n), m);
    PERFORM pg_temp.assert_true(r = '{"ok": false, "reason": "bad_minutes"}'::jsonb, format('%s minutes is bad_minutes: %s', m, r));
  END LOOP;
  r := pg_temp.st(pg_temp.u(n), NULL);
  PERFORM pg_temp.assert_true(r = '{"ok": false, "reason": "bad_minutes"}'::jsonb, 'NULL minutes is bad_minutes: ' || r::text);
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_sessions WHERE user_id = pg_temp.u(n))
    AND NOT EXISTS (SELECT FROM public.credit_holds WHERE user_id = pg_temp.u(n)), 'a refused length creates no session and no hold');
END;
$$;

-- 3. The hold of a 30-minute session is 60 credits, it ends 30 minutes out, and a balance of 59 cannot start it ------------------
SELECT pg_temp.mkuser(40, 59);
SELECT pg_temp.mkuser(41, 60);
DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp.st(pg_temp.u(40), 30);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'false' AND r ->> 'reason' = 'insufficient' AND (r ->> 'needed')::numeric = 60, '59 credits cannot start 30 minutes: ' || r::text);
  r := pg_temp.st(pg_temp.u(41), 30);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND (r ->> 'ends_at')::timestamptz BETWEEN now() + interval '29 minutes 59 seconds' AND now() + interval '30 minutes 1 second',
    '60 credits start 30 minutes and it ends 30 minutes out: ' || r::text);
  PERFORM pg_temp.assert_true((SELECT expires_at BETWEEN now() + interval '59 minutes 59 seconds' AND now() + interval '60 minutes 1 second'
    FROM public.credit_holds WHERE user_id = pg_temp.u(41) AND settled_at IS NULL), 'the hold outlives the block by 30 minutes');
END;
$$;

-- 4. Settlement: the charge never exceeds the minutes bought ---------------------------------------------------------------------
-- (a) settled at once: one minute.
SELECT pg_temp.mkuser(50, 1000);
SELECT pg_temp.mkuser(51, 1000);
SELECT pg_temp.mkuser(52, 1000);
SELECT pg_temp.mkuser(53, 1000);
SELECT pg_temp.mkuser(54, 1000);
DO $$
DECLARE u uuid; r jsonb; sid uuid;
BEGIN
  u := pg_temp.u(50);
  sid := (pg_temp.st(u, 30) ->> 'session_id')::uuid;
  r := public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND (r ->> 'minutes_used')::int = 1 AND (r ->> 'credits_charged')::numeric = 2 AND (r ->> 'balance')::numeric = 998,
    'a 30-minute session settled at once is charged one minute: ' || r::text);

  -- (b) 30 minutes bought, 12.5 minutes of use: 13 minutes, 26 credits.
  u := pg_temp.u(51);
  sid := (pg_temp.st(u, 30) ->> 'session_id')::uuid;
  UPDATE public.factcheck_sessions SET started_at = now() - interval '12 minutes 30 seconds', last_activity_at = now() WHERE id = sid;
  r := public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true((r ->> 'minutes_used')::int = 13 AND (r ->> 'credits_charged')::numeric = 26 AND (r ->> 'balance')::numeric = 974,
    'a 30-minute session used for 12.5 minutes is charged 13 minutes, 26 credits: ' || r::text);

  -- (c) 30 minutes bought, the tab still sending at minute 40: charged 30 minutes, 60 credits, no more.
  u := pg_temp.u(52);
  sid := (pg_temp.st(u, 30) ->> 'session_id')::uuid;
  UPDATE public.factcheck_sessions SET started_at = now() - interval '40 minutes', last_activity_at = now() WHERE id = sid;
  r := public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true((r ->> 'minutes_used')::int = 30 AND (r ->> 'credits_charged')::numeric = 60 AND (r ->> 'balance')::numeric = 940,
    'a 30-minute session still active 40 minutes after its start is charged 30 minutes, 60 credits, never more: ' || r::text);

  -- (d) 20 minutes bought, still active at minute 35: 20 minutes, 40 credits.
  u := pg_temp.u(53);
  sid := (pg_temp.st(u, 20) ->> 'session_id')::uuid;
  UPDATE public.factcheck_sessions SET started_at = now() - interval '35 minutes', last_activity_at = now() WHERE id = sid;
  r := public.factcheck_settle(u, sid);
  PERFORM pg_temp.assert_true((r ->> 'minutes_used')::int = 20 AND (r ->> 'credits_charged')::numeric = 40 AND (r ->> 'balance')::numeric = 960,
    'a 20-minute session is charged at most 20 minutes, 40 credits: ' || r::text);
  PERFORM pg_temp.assert_true((SELECT bool_and(status = 'settled' AND minutes_used <= minutes_bought AND credits_charged <= minutes_bought * credits_per_minute AND credits_charged = credits_held - (minutes_bought - minutes_used) * credits_per_minute)
    FROM public.factcheck_sessions WHERE user_id IN (pg_temp.u(50), pg_temp.u(51), pg_temp.u(52), pg_temp.u(53))),
    'every settled session was charged at most minutes bought x price, and the unused part of the hold was released');
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM public.credit_holds WHERE user_id IN (pg_temp.u(50), pg_temp.u(51), pg_temp.u(52), pg_temp.u(53)) AND settled_at IS NULL),
    'all four holds are settled');

  -- (e) The sweep: a 30-minute session, abandoned 29.5 minutes in, is settled for 30 minutes (60), found by the 3-minute quiet rule
  --     not by the block end.
  u := pg_temp.u(54);
  sid := (pg_temp.st(u, 30) ->> 'session_id')::uuid;
  UPDATE public.factcheck_sessions SET started_at = now() - interval '33 minutes', last_activity_at = now() - interval '3 minutes 30 seconds' WHERE id = sid;
  PERFORM pg_temp.assert_true(public.factcheck_settle_expired() >= 1, 'the sweep settles it');
  PERFORM pg_temp.assert_true((SELECT status = 'settled' AND minutes_used = 30 AND credits_charged = 60 FROM public.factcheck_sessions WHERE id = sid),
    'a 30-minute session abandoned 29.5 minutes in is charged 30 minutes, 60 credits');
END;
$$;

-- 5. The sweep waits for the whole block: a 30-minute session 20 minutes in, still sending, is not settled early ---------------------
SELECT pg_temp.mkuser(55, 1000);
SELECT pg_temp.mkuser(56, 1000);
DO $$
DECLARE u uuid := pg_temp.u(55); sid uuid := (pg_temp.st(pg_temp.u(55), 30) ->> 'session_id')::uuid; sid2 uuid;
BEGIN
  UPDATE public.factcheck_sessions SET started_at = now() - interval '20 minutes', last_activity_at = now() WHERE id = sid;
  PERFORM public.factcheck_settle_expired();
  PERFORM pg_temp.assert_true((SELECT status = 'active' FROM public.factcheck_sessions WHERE id = sid), 'a 30-minute session 20 minutes in and still sending is not swept');
  -- A 30-minute session past block end + 1 minute is swept even if it kept sending.
  sid2 := (pg_temp.st(pg_temp.u(56), 30) ->> 'session_id')::uuid;
  UPDATE public.factcheck_sessions SET started_at = now() - interval '31 minutes 10 seconds', last_activity_at = now() WHERE id = sid2;
  PERFORM public.factcheck_settle_expired();
  PERFORM pg_temp.assert_true((SELECT status = 'settled' AND minutes_used = 30 AND credits_charged = 60 FROM public.factcheck_sessions WHERE id = sid2),
    'a 30-minute session past its block end plus a minute is swept and charged 30 minutes');
END;
$$;

-- 6. The per-session budget grows with the minutes charged, and a refused call counts nothing -------------------------------------
-- A 30-minute session used for 29.5 minutes is charged 30 minutes: extract 3 x 30 + 2 = 92 calls, check 8 x 30 + 4 = 244.
-- The per-user rate limit (extract 6, check 20 a minute) is cleared between batches so that only the budget is under test.
SELECT pg_temp.mkuser(60, 1000);
DO $$
DECLARE u uuid := pg_temp.u(60); sid uuid := (pg_temp.st(pg_temp.u(60), 30) ->> 'session_id')::uuid; r jsonb; i integer; okn integer := 0;
BEGIN
  UPDATE public.factcheck_sessions SET started_at = now() - interval '29 minutes 30 seconds', last_activity_at = now() WHERE id = sid;
  FOR i IN 1..100 LOOP
    DELETE FROM private.factcheck_rate WHERE user_id = u;
    r := public.factcheck_touch(u, sid, 'extract');
    IF r ->> 'ok' = 'true' THEN okn := okn + 1; ELSE EXIT; END IF;
  END LOOP;
  PERFORM pg_temp.assert_true(okn = 92 AND r = '{"ok": false, "reason": "budget"}'::jsonb, format('extract is accepted 92 times (3 x 30 + 2), then budget: accepted %s, last %s', okn, r));
  okn := 0;
  FOR i IN 1..260 LOOP
    DELETE FROM private.factcheck_rate WHERE user_id = u;
    r := public.factcheck_touch(u, sid, 'check');
    IF r ->> 'ok' = 'true' THEN okn := okn + 1; ELSE EXIT; END IF;
  END LOOP;
  PERFORM pg_temp.assert_true(okn = 244 AND r = '{"ok": false, "reason": "budget"}'::jsonb, format('check is accepted 244 times (8 x 30 + 4), then budget: accepted %s, last %s', okn, r));
END;
$$;
-- The per-user per-minute limits are unchanged by the longer lengths: extract 6, transcribe 10, check 20.
SELECT pg_temp.mkuser(61, 1000);
DO $$
DECLARE u uuid := pg_temp.u(61); sid uuid := (pg_temp.st(pg_temp.u(61), 30) ->> 'session_id')::uuid; r jsonb; i integer; okn integer := 0;
BEGIN
  UPDATE public.factcheck_sessions SET started_at = now() - interval '29 minutes 30 seconds', last_activity_at = now() WHERE id = sid;
  FOR i IN 1..10 LOOP
    r := public.factcheck_touch(u, sid, 'extract');
    IF r ->> 'ok' = 'true' THEN okn := okn + 1; END IF;
  END LOOP;
  PERFORM pg_temp.assert_true(okn = 6 AND r = '{"ok": false, "reason": "rate_limited"}'::jsonb, 'a 30-minute session still gets at most 6 extract calls a minute: ' || okn || ' ' || r::text);
END;
$$;

-- 7. The function is otherwise what it was --------------------------------------------------------------------------------------
SELECT pg_temp.assert_true((SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""', 'TimeZone=UTC'] AND p.pronargs = 8 AND p.pronargdefaults = 1
  AND p.prorettype = 'jsonb'::regtype AND l.lanname = 'plpgsql'
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = 'public.factcheck_start(uuid,text,text,text,numeric,integer,boolean,numeric)'::regprocedure),
  'factcheck_start is SECURITY DEFINER, plpgsql, returns jsonb, keeps both SET clauses and the one default');
SELECT pg_temp.mkuser(62, 1000);
SELECT pg_temp.assert_true(public.factcheck_start(pg_temp.u(62), 'vid1', 'chan1', 'live', NULL, 20, true) ->> 'ok' = 'true',
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

-- 8. The function source is the one whose md5 the migration records as its own (so its second run, and a rollback to this text, pass the guard) ---
SELECT pg_temp.assert_true((SELECT md5(p.prosrc) = '3932b5a554b1da43590ecb3e712452e1' FROM pg_proc p
  WHERE p.oid = 'public.factcheck_start(uuid,text,text,text,numeric,integer,boolean,numeric)'::regprocedure),
  'factcheck_start source is the one whose md5 the migration records');
-- 9. The stored-piece cap scales with the block: greatest(120, 10 x minutes_bought) ----------------------------------------------------
-- A piece carries about 9 s of new audio, so a 30-minute recorded session needs about 200. The cap of 120 stays for blocks up to 12 minutes.
DELETE FROM public.app_flags WHERE key = 'livetv_factcheck';
INSERT INTO public.app_flags (key, value) VALUES ('livetv_factcheck',
  '{"enabled":true,"audience":"all","credits_per_minute":2,"recheck_credits":100,"share_recorded":true,"unlock_credits_per_minute":100}');
SELECT pg_temp.mkuser(70, 1000);
SELECT pg_temp.mkuser(71, 1000);
SELECT pg_temp.mkuser(72, 1000);
SELECT pg_temp.mkuser(73, 1000);
CREATE FUNCTION pg_temp.shared_session(p_user uuid, p_minutes integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r jsonb := public.factcheck_start(p_user, 'vid1', 'chan1', 'recorded', 0, p_minutes, true); sid uuid;
BEGIN
  IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: start refused: %', r; END IF;
  sid := (r ->> 'session_id')::uuid;
  r := public.factcheck_mark_shareable(p_user, sid);
  IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: mark refused: %', r; END IF;
  RETURN sid;
END;
$$;
CREATE FUNCTION pg_temp.put(p_user uuid, p_sid uuid, p_no integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.factcheck_piece_store(p_user, p_sid, p_no, (p_no - 1) * 9, p_no * 9, 'Line ' || p_no);
$$;
DO $$
DECLARE u uuid; sid uuid; i integer; r jsonb;
BEGIN
  -- 30 minutes: pieces 1 to 300 are stored, the 301st is refused.
  u := pg_temp.u(70); sid := pg_temp.shared_session(u, 30);
  FOR i IN 1..300 LOOP
    r := pg_temp.put(u, sid, i);
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: piece % of a 30-minute session refused: %', i, r; END IF;
    IF i IN (120, 121) THEN PERFORM pg_temp.assert_true(true, format('piece %s of a 30-minute session is stored', i)); END IF;
  END LOOP;
  PERFORM pg_temp.assert_true((SELECT count(*) = 300 FROM private.factcheck_pieces WHERE session_id = sid), 'the 300th piece of a 30-minute session is stored (300 rows)');
  r := pg_temp.put(u, sid, 301);
  PERFORM pg_temp.assert_true(r = '{"ok": false, "reason": "bad_piece"}'::jsonb, 'the 301st piece of a 30-minute session is refused: ' || r::text);
  -- 20 minutes: cap 200.
  u := pg_temp.u(71); sid := pg_temp.shared_session(u, 20);
  FOR i IN 1..200 LOOP
    r := pg_temp.put(u, sid, i);
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: piece % of a 20-minute session refused: %', i, r; END IF;
  END LOOP;
  r := pg_temp.put(u, sid, 201);
  PERFORM pg_temp.assert_true(r ->> 'reason' = 'bad_piece', 'a 20-minute session stores 200 pieces and refuses the 201st');
  -- 5 minutes: unchanged, the 121st is refused.
  u := pg_temp.u(72); sid := pg_temp.shared_session(u, 5);
  FOR i IN 1..120 LOOP
    r := pg_temp.put(u, sid, i);
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: piece % of a 5-minute session refused: %', i, r; END IF;
  END LOOP;
  r := pg_temp.put(u, sid, 121);
  PERFORM pg_temp.assert_true(r = '{"ok": false, "reason": "bad_piece"}'::jsonb, 'the 121st piece of a 5-minute session is still refused: ' || r::text);
  -- 15 minutes: cap 150.
  u := pg_temp.u(73); sid := pg_temp.shared_session(u, 15);
  FOR i IN 1..150 LOOP
    r := pg_temp.put(u, sid, i);
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: piece % of a 15-minute session refused: %', i, r; END IF;
  END LOOP;
  PERFORM pg_temp.assert_true(pg_temp.put(u, sid, 151) ->> 'reason' = 'bad_piece', 'a 15-minute session stores 150 pieces and refuses the 151st');
END;
$$;
SELECT pg_temp.assert_true((SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""', 'TimeZone=UTC'] AND p.pronargs = 6 AND p.pronargdefaults = 0
  AND p.prorettype = 'jsonb'::regtype AND l.lanname = 'plpgsql'
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = 'public.factcheck_piece_store(uuid,uuid,integer,numeric,numeric,text)'::regprocedure),
  'factcheck_piece_store is SECURITY DEFINER, plpgsql, returns jsonb, keeps both SET clauses');
DO $$
DECLARE actor text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['anon', 'authenticated', 'public'] LOOP
    PERFORM pg_temp.assert_true(NOT has_function_privilege(actor, 'public.factcheck_piece_store(uuid,uuid,integer,numeric,numeric,text)', 'EXECUTE'),
      actor || ' still cannot execute factcheck_piece_store');
  END LOOP;
  PERFORM pg_temp.assert_true(has_function_privilege('service_role', 'public.factcheck_piece_store(uuid,uuid,integer,numeric,numeric,text)', 'EXECUTE'),
    'service_role can still execute factcheck_piece_store');
END;
$$;
SELECT pg_temp.assert_true((SELECT md5(p.prosrc) = '6ce637e72e5ec62faa9d067204c9622a' FROM pg_proc p
  WHERE p.oid = 'public.factcheck_piece_store(uuid,uuid,integer,numeric,numeric,text)'::regprocedure),
  'factcheck_piece_store source is the one whose md5 the migration records');
ROLLBACK;
