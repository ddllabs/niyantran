-- A refund of unlock credits is its own line in the usage history (migration 20261124090000; Live TV phase 2, track 3).
-- PostgreSQL assertions, no pgTAP. Run only in a disposable database, through run.sh, which applies the migration as a
-- non-superuser. Bootstrap: the factcheck_video_remove_refund chain (so an administrator's removal really refunds), then
-- 20261124090000_factcheck_refund_usage.sql. The vacuity check drops the last: the helper is missing and the first
-- assertion fails; the later assertions (the refund line in the list) would fail too.
-- Time: now() is fixed for the whole transaction, so every ledger entry shares one instant; rows are told apart by what they
-- are, never by order.
--
-- Users (00000000-0000-4000-8000-0000000feNNN): 01 and 02 run stretches of video VX, 03 pays for two of them, 04 for one,
-- 05 pays for a stretch of video VY (never removed), 06 has nothing but an administrator-style adjustment with the refund's note,
-- 07 administrator.
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
CREATE FUNCTION pg_temp.invariants(label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE bad text;
BEGIN
  SELECT string_agg(w.user_id::text, ', ') INTO bad FROM public.credit_wallets w
  WHERE w.balance <> coalesce((SELECT sum(l.credits) FROM public.credit_ledger l WHERE l.user_id = w.user_id), 0);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: % - balance is not the ledger sum for %', label, bad; END IF;
  SELECT string_agg(w.user_id::text, ', ') INTO bad FROM public.credit_wallets w
  WHERE w.balance <> coalesce((SELECT sum(o.remaining) FROM public.credit_lots o WHERE o.user_id = w.user_id AND o.closed_at IS NULL), 0) - w.debt;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: % - balance is not open lots minus debt for %', label, bad; END IF;
  SELECT string_agg(o.id::text, ', ') INTO bad FROM public.credit_lots o
  WHERE o.granted - o.remaining <>
        coalesce((SELECT sum(d.credits) FROM public.credit_lot_draws d WHERE d.lot_id = o.id), 0)
      - coalesce((SELECT sum(e.credits) FROM public.credit_ledger e WHERE e.lot_id = o.id AND e.kind = 'expiry'), 0);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: % - lot arithmetic for %', label, bad; END IF;
  SELECT string_agg(w.user_id::text, ', ') INTO bad FROM public.credit_wallets w
  WHERE w.debt <> - coalesce((SELECT sum(e.credits) FROM public.credit_ledger e WHERE e.user_id = w.user_id
                     AND (e.kind = 'charge' OR (e.kind = 'adjustment' AND e.credits < 0))), 0)
        - coalesce((SELECT sum(d.credits) FROM public.credit_lot_draws d JOIN public.credit_lots o ON o.id = d.lot_id WHERE o.user_id = w.user_id), 0);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: % - debt for %', label, bad; END IF;
  RAISE NOTICE 'PASS: % - invariants hold', label;
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
    PERFORM private.credit_mint(v, 'topup', credits, now() - interval '1 minute', now() + interval '12 months', 'fx:' || v, NULL, 'grant', NULL, NULL, NULL);
  END IF;
  RETURN v;
END;
$$;
CREATE FUNCTION pg_temp.setflag(v jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.app_flags WHERE key = 'livetv_factcheck';
  IF v IS NOT NULL THEN INSERT INTO public.app_flags (key, value) VALUES ('livetv_factcheck', v); END IF;
END;
$$;
CREATE FUNCTION pg_temp.on() RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.setflag('{"enabled":true,"audience":"all","credits_per_minute":2,"recheck_credits":100,"share_recorded":true,"unlock_credits_per_minute":100}');
$$;
-- A recorded session of the user over a video, marked shareable, with n pieces of len seconds from position base, settled.
CREATE FUNCTION pg_temp.run(p_user uuid, p_video text, p_n integer, p_len numeric DEFAULT 10, p_base numeric DEFAULT 0, p_settle boolean DEFAULT true,
                            p_share boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r jsonb := public.factcheck_start(p_user, p_video, 'chan', 'recorded', p_base, 5, true); sid uuid; i integer;
BEGIN
  IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: start refused: %', r; END IF;
  sid := (r ->> 'session_id')::uuid;
  IF p_share THEN
    r := public.factcheck_mark_shareable(p_user, sid);
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: mark refused: %', r; END IF;
    FOR i IN 0..p_n - 1 LOOP
      r := public.factcheck_piece_store(p_user, sid, i + 1, p_base + i * p_len, p_base + (i + 1) * p_len, 'Line ' || p_video || ' ' || i);
      IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: piece % refused: %', i, r; END IF;
    END LOOP;
  END IF;
  IF p_settle THEN
    PERFORM public.factcheck_settle(p_user, sid);
    UPDATE public.factcheck_sessions SET ended_at = now() - interval '10 minutes' WHERE id = sid;   -- past the 2-minute window
  END IF;
  RETURN sid;
END;
$$;
-- A stretch written directly (as the owner): a settled shareable recorded session with one piece.
CREATE FUNCTION pg_temp.bal(p_user uuid) RETURNS numeric LANGUAGE sql AS $$
  SELECT balance FROM public.credit_wallets WHERE user_id = p_user;
$$;
CREATE FUNCTION pg_temp.stretch(v jsonb, p_id uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(v -> 'stretches') e WHERE e ->> 'stretch_id' = p_id::text;
$$;
-- Calls the function with a role and a user, and puts the role back. A raised error ends the helper where it stands; the
-- caller's block undoes the role.
CREATE FUNCTION pg_temp.remove_as(p_role text, p_sub uuid, p_video text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  v := public.factcheck_video_remove(p_video);
  EXECUTE 'RESET ROLE';
  RETURN v;
END;
$$;
CREATE FUNCTION pg_temp.admin_remove(p_video text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.remove_as('authenticated', pg_temp.u(7), p_video);
$$;
-- What a user's own usage screens return, as that user.
-- p_kind defaults to the opt-in value 'all+refunds'; the snapshots and the no-opt-in checks pass 'all' or another value.
CREATE FUNCTION pg_temp.act(p_sub uuid, p_grouped boolean DEFAULT true, p_kind text DEFAULT 'all+refunds', p_model text DEFAULT NULL, p_status text DEFAULT 'all',
                            p_offset integer DEFAULT 0, p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_sub::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v := public.my_usage_activity(p_offset, p_limit, p_grouped, p_model, p_status, p_kind);
  EXECUTE 'RESET ROLE';
  RETURN v;
END;
$$;
CREATE FUNCTION pg_temp.others(p_sub uuid, p_grouped boolean) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(r ORDER BY r ->> 'created_at', r::text), '[]'::jsonb)
  FROM jsonb_array_elements(pg_temp.act(p_sub, p_grouped) -> 'rows') r WHERE r ->> 'feature' IS DISTINCT FROM 'factcheck_refund';
$$;
CREATE FUNCTION pg_temp.refunds(p_sub uuid, p_grouped boolean DEFAULT true, p_kind text DEFAULT 'all+refunds', p_model text DEFAULT NULL, p_status text DEFAULT 'all')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(r ORDER BY (r ->> 'credits')::numeric), '[]'::jsonb)
  FROM jsonb_array_elements(pg_temp.act(p_sub, p_grouped, p_kind, p_model, p_status) -> 'rows') r WHERE r ->> 'feature' = 'factcheck_refund';
$$;
-- The other reports, as the user, with the summary's end moved past the transaction's frozen now().
CREATE FUNCTION pg_temp.reports(p_sub uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_sub::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v := jsonb_build_object('summary', public.my_usage_summary(NULL, now() + interval '1 hour'),
                          'day', public.my_usage_timeseries(NULL, now() + interval '1 hour', 'day'),
                          'month', public.my_usage_timeseries(NULL, now() + interval '1 hour', 'month'),
                          'used', public.my_credits() -> 'used_this_cycle', 'recent', public.my_credits() -> 'recent');
  EXECUTE 'RESET ROLE';
  RETURN v;
END;
$$;
CREATE TEMP TABLE ids (k text PRIMARY KEY, id uuid);
CREATE TEMP TABLE snap (k text PRIMARY KEY, j jsonb);
CREATE TEMP TABLE res (j jsonb);

-- 0. The change itself (fails while the migration is missing) ---------------------------------------------------------------------
SELECT pg_temp.assert_true(to_regprocedure('private.factcheck_refunds(uuid)') IS NOT NULL, 'the refund helper exists');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'private.factcheck_refunds(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'private.factcheck_refunds(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'private.factcheck_refunds(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('public', 'private.factcheck_refunds(uuid)', 'EXECUTE'),
  'nobody can call the helper directly');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.my_usage_activity(integer,integer,boolean,text,text,text)') AND p.prosecdef AND p.provolatile = 's'
      AND p.prorettype = 'jsonb'::regtype AND p.proconfig @> ARRAY['search_path=""'] AND p.proconfig @> ARRAY['TimeZone=UTC']),
  'my_usage_activity keeps its signature, SECURITY DEFINER, STABLE, search_path and TimeZone');
SELECT pg_temp.assert_true(has_function_privilege('authenticated', 'public.my_usage_activity(integer,integer,boolean,text,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.my_usage_activity(integer,integer,boolean,text,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.my_usage_activity(integer,integer,boolean,text,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('public', 'public.my_usage_activity(integer,integer,boolean,text,text,text)', 'EXECUTE'),
  'only authenticated may execute my_usage_activity, as before');
SELECT pg_temp.assert_true((SELECT md5(prosrc) = 'a5b51b75e48ecd565cae8671b426a30f' FROM pg_proc WHERE oid = to_regprocedure('public.my_usage_activity(integer,integer,boolean,text,text,text)')),
  'the function source is the one whose md5 the migration''s guard names');

-- 1. Set-up: video VX with two stretches (100 and 200 credits), VY with one (100) ---------------------------------------------------
SELECT pg_temp.on();
SELECT pg_temp.mkuser(1, 500);
SELECT pg_temp.mkuser(2, 500);
SELECT pg_temp.mkuser(3, 1000);
SELECT pg_temp.mkuser(4, 500);
SELECT pg_temp.mkuser(5, 500);
SELECT pg_temp.mkuser(6, 100);
SELECT pg_temp.mkuser(7, 0);
UPDATE public.user_profiles SET role = 'admin', status = 'active' WHERE user_id = pg_temp.u(7);
DO $$
DECLARE sa uuid := pg_temp.run(pg_temp.u(1), 'VX', 3); sb uuid := pg_temp.run(pg_temp.u(2), 'VX', 9); sc uuid := pg_temp.run(pg_temp.u(1), 'VY', 3);
BEGIN
  INSERT INTO ids VALUES ('sa', sa), ('sb', sb), ('sc', sc);
  PERFORM pg_temp.assert_true(public.factcheck_unlock(pg_temp.u(3), sa, true, 100) ->> 'credits_charged' = '100.0000'
    AND public.factcheck_unlock(pg_temp.u(3), sb, true, 200) ->> 'credits_charged' = '200.0000', 'user 3 pays 100 and 200 for the two stretches of VX');
  PERFORM pg_temp.assert_true(public.factcheck_unlock(pg_temp.u(4), sb, true, 200) ->> 'credits_charged' = '200.0000', 'user 4 pays 200 for the second stretch');
  PERFORM pg_temp.assert_true(public.factcheck_unlock(pg_temp.u(5), sc, true, 100) ->> 'credits_charged' = '100.0000', 'user 5 pays 100 for the stretch of VY');
END;
$$;
-- User 6: an adjustment with the refund's note and kind, but not a refund of an unlock (its lot's source key says so).
SELECT private.credit_mint(pg_temp.u(6), 'adjustment', 50, now(), now() + interval '12 months', 'adj:other', NULL, 'adjustment', gen_random_uuid(), pg_temp.u(7),
  'live tv fact-check unlock refund');
SELECT pg_temp.invariants('after the unlocks');

-- 2. Before the removal: no user has a refund line; the charges are listed (the unlock charges are fact-check lines) ----------------
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM generate_series(1, 7) n, LATERAL jsonb_array_elements(pg_temp.act(pg_temp.u(n)) -> 'rows') r WHERE r ->> 'feature' = 'factcheck_refund'),
  'before any removal nobody has a refund line (grouped)');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM generate_series(1, 7) n, LATERAL jsonb_array_elements(pg_temp.act(pg_temp.u(n), false) -> 'rows') r WHERE r ->> 'feature' = 'factcheck_refund'),
  'nor per call');
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.act(pg_temp.u(3)) -> 'rows') = 2 AND (pg_temp.act(pg_temp.u(3)) ->> 'total')::int = 2,
  'user 3 lists their two unlock charges');
SELECT pg_temp.assert_true(pg_temp.refunds(pg_temp.u(6)) = '[]'::jsonb AND jsonb_array_length(pg_temp.act(pg_temp.u(6)) -> 'rows') = 0,
  'user 6''s look-alike adjustment (another source key) is no refund line and no other line');
INSERT INTO snap SELECT 'rep' || n, pg_temp.reports(pg_temp.u(n)) FROM generate_series(1, 7) n;
INSERT INTO snap SELECT 'g' || n, pg_temp.act(pg_temp.u(n), true, 'all') FROM generate_series(1, 7) n;
INSERT INTO snap SELECT 'c' || n, pg_temp.act(pg_temp.u(n), false, 'all') FROM generate_series(1, 7) n;
INSERT INTO snap SELECT 'bal' || n, to_jsonb(pg_temp.bal(pg_temp.u(n))) FROM generate_series(1, 7) n;

-- 3. An administrator removes VX: users 3 and 4 are refunded ----------------------------------------------------------------------
INSERT INTO res SELECT pg_temp.admin_remove('VX');
SELECT pg_temp.assert_true((SELECT (j ->> 'unlocks_refunded')::int = 3 AND (j ->> 'credits_refunded')::numeric = 500 FROM res), 'the removal refunded three unlocks, 500 credits');
SELECT pg_temp.invariants('after the removal');

-- 4. The refunded user sees each refund once, as its own line -------------------------------------------------------------------
DO $$
DECLARE g jsonb := pg_temp.refunds(pg_temp.u(3), true); c jsonb := pg_temp.refunds(pg_temp.u(3), false); r jsonb;
BEGIN
  PERFORM pg_temp.assert_true(jsonb_array_length(g) = 2 AND jsonb_array_length(c) = 2, 'user 3 has two refund lines, grouped and per call (one per refunded unlock)');
  PERFORM pg_temp.assert_true((SELECT array_agg((x ->> 'credits')::numeric ORDER BY (x ->> 'credits')::numeric) FROM jsonb_array_elements(g) x) = ARRAY[100, 200]::numeric[]
    AND (SELECT array_agg((x ->> 'credits')::numeric ORDER BY (x ->> 'credits')::numeric) FROM jsonb_array_elements(c) x) = ARRAY[100, 200]::numeric[],
    'the amounts are positive and are what each unlock cost (100 and 200)');
  FOR r IN SELECT jsonb_array_elements(g || c) LOOP
    PERFORM pg_temp.assert_true(r -> 'turn_key' = 'null'::jsonb AND r -> 'conversation_id' = 'null'::jsonb AND r -> 'title' = 'null'::jsonb
        AND r -> 'question' = 'null'::jsonb AND r ->> 'status' = 'succeeded' AND r -> 'model' = 'null'::jsonb AND (r ->> 'calls')::int = 0
        AND (r ->> 'tokens')::int = 0 AND r -> 'detail' = '[]'::jsonb AND r ->> 'video_id' = 'VX' AND r ->> 'channel' = 'chan'
        AND r ->> 'video_kind' = 'recorded' AND r ->> 'created_at' IS NOT NULL,
      'a refund line has no chat, turn, model, calls or tokens, and names the video, its channel and kind: ' || r::text);
    PERFORM pg_temp.assert_true((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k)
        = ARRAY['calls', 'channel', 'conversation_id', 'created_at', 'credits', 'detail', 'feature', 'model', 'question', 'status', 'title', 'tokens', 'turn_key', 'video_id', 'video_kind'],
      'and exactly the keys of a fact-check line plus video_id: ' || r::text);
  END LOOP;
END;
$$;
SELECT pg_temp.assert_true((pg_temp.act(pg_temp.u(3)) ->> 'total')::int = 4 AND (pg_temp.act(pg_temp.u(3), false) ->> 'total')::int = 4
    AND jsonb_array_length(pg_temp.act(pg_temp.u(3)) -> 'rows') = 4,
  'user 3''s list has the two charges and the two refunds: total 4 in both modes');
SELECT pg_temp.assert_true(pg_temp.refunds(pg_temp.u(4)) -> 0 ->> 'credits' = '200.0000' AND jsonb_array_length(pg_temp.refunds(pg_temp.u(4))) = 1,
  'user 4 has one refund line, 200');

-- 5. Nobody else sees it, and a user with no refund gets exactly what they got before ------------------------------------------------
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM generate_series(1, 7) n, LATERAL jsonb_array_elements(pg_temp.act(pg_temp.u(n)) -> 'rows') r
      WHERE r ->> 'feature' = 'factcheck_refund' AND n NOT IN (3, 4))
    AND NOT EXISTS (SELECT FROM generate_series(1, 7) n, LATERAL jsonb_array_elements(pg_temp.act(pg_temp.u(n), false) -> 'rows') r
      WHERE r ->> 'feature' = 'factcheck_refund' AND n NOT IN (3, 4)),
  'only users 3 and 4 have refund lines: the runners (1, 2), the user of VY (5), the look-alike (6) and the administrator (7) have none');
SELECT pg_temp.assert_true((SELECT bool_and(pg_temp.act(pg_temp.u(n), true) = (SELECT j FROM snap WHERE k = 'g' || n)
                                         AND pg_temp.act(pg_temp.u(n), false) = (SELECT j FROM snap WHERE k = 'c' || n)) FROM generate_series(1, 7) n WHERE n NOT IN (3, 4)),
  'for every user without a refund the activity list is byte for byte what it was before (both modes)');
SELECT pg_temp.assert_true(pg_temp.others(pg_temp.u(3), true) = (SELECT coalesce(jsonb_agg(r ORDER BY r ->> 'created_at', r::text), '[]'::jsonb) FROM snap, jsonb_array_elements(j -> 'rows') r WHERE k = 'g3')
    AND pg_temp.others(pg_temp.u(3), false) = (SELECT coalesce(jsonb_agg(r ORDER BY r ->> 'created_at', r::text), '[]'::jsonb) FROM snap, jsonb_array_elements(j -> 'rows') r WHERE k = 'c3')
    AND pg_temp.others(pg_temp.u(4), true) = (SELECT coalesce(jsonb_agg(r ORDER BY r ->> 'created_at', r::text), '[]'::jsonb) FROM snap, jsonb_array_elements(j -> 'rows') r WHERE k = 'g4'),
  'the refunded users'' other lines are unchanged');

-- 6. No total moves ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.assert_true((SELECT bool_and(pg_temp.reports(pg_temp.u(n)) = (SELECT j FROM snap WHERE k = 'rep' || n)) FROM generate_series(1, 7) n),
  'the summary, both timeseries, used_this_cycle and my_credits.recent are identical before and after for every user (the refund is counted nowhere)');
SELECT pg_temp.assert_true(pg_temp.bal(pg_temp.u(3)) = (SELECT (j)::numeric FROM snap WHERE k = 'bal3') + 300
    AND pg_temp.bal(pg_temp.u(4)) = (SELECT (j)::numeric FROM snap WHERE k = 'bal4') + 200,
  'the balances rose by exactly the refunds, so the lines show what the balance gained');

-- 7. Opt-in: without the request the output is exactly what it was, for EVERY user, refunded ones included -----------------------------
SELECT pg_temp.assert_true((SELECT bool_and(pg_temp.act(pg_temp.u(n), true, 'all') = (SELECT j FROM snap WHERE k = 'g' || n)
                                         AND pg_temp.act(pg_temp.u(n), false, 'all') = (SELECT j FROM snap WHERE k = 'c' || n)) FROM generate_series(1, 7) n),
  'asked for kind "all" (what an old browser sends), every user, refunded users included, gets byte for byte the list from before the removal (both modes)');
SELECT pg_temp.assert_true((SELECT bool_and(pg_temp.act(pg_temp.u(n), true, 'bogus') = (SELECT j FROM snap WHERE k = 'g' || n)
                                         AND pg_temp.act(pg_temp.u(n), false, NULL) = (SELECT j FROM snap WHERE k = 'c' || n)) FROM generate_series(1, 7) n),
  'an unknown or missing kind reads as "all" and shows no refund either');
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.refunds(pg_temp.u(3), true, 'factcheck')) = 0 AND jsonb_array_length(pg_temp.refunds(pg_temp.u(3), false, 'factcheck')) = 0
    AND jsonb_array_length(pg_temp.refunds(pg_temp.u(3), true, 'answers')) = 0 AND jsonb_array_length(pg_temp.refunds(pg_temp.u(3), false, 'dictation')) = 0
    AND jsonb_array_length(pg_temp.refunds(pg_temp.u(3), true, 'all')) = 0 AND jsonb_array_length(pg_temp.refunds(pg_temp.u(3), false, 'all')) = 0,
  'no other kind lists a refund');
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.refunds(pg_temp.u(3), true, 'all+refunds', 'factcheck')) = 2
    AND jsonb_array_length(pg_temp.refunds(pg_temp.u(3), false, 'all+refunds', 'factcheck')) = 2
    AND jsonb_array_length(pg_temp.refunds(pg_temp.u(3), true, 'all+refunds', 'openai/gpt-x')) = 0
    AND jsonb_array_length(pg_temp.refunds(pg_temp.u(3), false, 'all+refunds', 'openai/gpt-x')) = 0,
  'with the request, a model filter matches a refund only for "factcheck"');
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.refunds(pg_temp.u(3), true, 'all+refunds', NULL, 'succeeded')) = 2
    AND jsonb_array_length(pg_temp.refunds(pg_temp.u(3), true, 'all+refunds', NULL, 'failed')) = 0
    AND jsonb_array_length(pg_temp.refunds(pg_temp.u(3), false, 'all+refunds', NULL, 'failed')) = 0,
  'the status filter treats a refund as succeeded');

-- 8. Paging across a refund row: no row is repeated or dropped (all four of user 3's rows share one instant; the key breaks the tie) ----
DO $$
DECLARE is_grouped boolean; per_page integer; all_rows jsonb; got jsonb; skip integer; page jsonb;
BEGIN
  FOREACH is_grouped IN ARRAY ARRAY[true, false] LOOP
    all_rows := pg_temp.act(pg_temp.u(3), is_grouped) -> 'rows';
    FOREACH per_page IN ARRAY ARRAY[1, 3] LOOP
      got := '[]'::jsonb;
      FOR skip IN SELECT generate_series(0, 4, per_page) LOOP
        page := pg_temp.act(pg_temp.u(3), is_grouped, 'all+refunds', NULL, 'all', skip, per_page) -> 'rows';
        got := got || page;
      END LOOP;
      PERFORM pg_temp.assert_true(jsonb_array_length(got) = 4 AND (SELECT count(DISTINCT x::text) = 4 FROM jsonb_array_elements(got) x)
          AND (SELECT array_agg(x::text ORDER BY x::text) FROM jsonb_array_elements(got) x) = (SELECT array_agg(x::text ORDER BY x::text) FROM jsonb_array_elements(all_rows) x)
          AND got = all_rows,
        format('paging %s rows at a time (%s): the pages, in order, are exactly the full list, nothing repeated or dropped', per_page, CASE WHEN is_grouped THEN 'grouped' ELSE 'per call' END));
    END LOOP;
  END LOOP;
END;
$$;

-- 9. A second removal adds no line; the real deletion path (the runner deletes their session, the unlocks go by cascade) -----------------
SELECT pg_temp.admin_remove('VX');
SELECT pg_temp.assert_true(jsonb_array_length(pg_temp.refunds(pg_temp.u(3))) = 2 AND jsonb_array_length(pg_temp.refunds(pg_temp.u(4))) = 1, 'a second removal adds no refund line');
DELETE FROM public.factcheck_sessions WHERE id = (SELECT id FROM ids WHERE k = 'sb');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_unlocks WHERE session_id = (SELECT id FROM ids WHERE k = 'sb')),
  'deleting the session removed its unlocks by cascade');
DO $$
DECLARE r4 jsonb := pg_temp.refunds(pg_temp.u(4)); r3 jsonb := pg_temp.refunds(pg_temp.u(3));
BEGIN
  PERFORM pg_temp.assert_true(jsonb_array_length(r4) = 1 AND r4 -> 0 ->> 'credits' = '200.0000' AND r4 -> 0 -> 'video_id' = 'null'::jsonb
      AND r4 -> 0 -> 'channel' = 'null'::jsonb AND r4 -> 0 -> 'video_kind' = 'null'::jsonb,
    'user 4''s refund line stays after the session is gone, with null video, channel and kind: ' || r4::text);
  PERFORM pg_temp.assert_true(jsonb_array_length(r3) = 2 AND r3 -> 0 ->> 'credits' = '100.0000' AND r3 -> 0 ->> 'video_id' = 'VX' AND r3 -> 0 ->> 'channel' = 'chan'
      AND r3 -> 1 ->> 'credits' = '200.0000' AND r3 -> 1 -> 'video_id' = 'null'::jsonb AND r3 -> 1 -> 'channel' = 'null'::jsonb AND r3 -> 1 -> 'video_kind' = 'null'::jsonb,
    'user 3 keeps both lines; only the one whose session was deleted lost its video fields: ' || r3::text);
END;
$$;
SELECT pg_temp.invariants('at the end');
ROLLBACK;
