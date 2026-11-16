-- Shared fact-check results and paid unlock (migration 20261117090000; open-work F344, slice 2, task S1;
-- docs/plans/2026-11-16-f344-sharing.md). PostgreSQL assertions, no pgTAP. Run only in a disposable database, through run.sh,
-- which applies the migration as a non-superuser (nter_migrator).
-- Bootstrap: the factcheck_recheck chain (the credit and billing chain, the fact-check, report and re-check migrations), then
-- 20261117090000_factcheck_sharing.sql as a non-superuser. The vacuity check drops the last: the first assertion fails.
-- Time: now() is fixed for the whole transaction, so ages are moved by updating rows. Two calls racing cannot be shown in one
-- transaction: factcheck_sharing_concurrency.sh does that for the unlock.
--
-- Users (00000000-0000-4000-8000-0000000ff0NN): 01 A (runs a stretch), 02 B (runs another), 03 C (the viewer), 04 poor,
-- 05 re-check in flight, 06 held credits, 07 rate limits, 08 reports, 09 admin, 10 non-admin, 11 account deletion.
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
  SELECT ('00000000-0000-4000-8000-0000000ff' || lpad(n::text, 3, '0'))::uuid;
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
  IF p_settle THEN PERFORM public.factcheck_settle(p_user, sid); END IF;
  RETURN sid;
END;
$$;
-- A stretch written directly (as the owner): a settled shareable recorded session with one piece.
CREATE FUNCTION pg_temp.direct(p_user uuid, p_video text, p_ago interval DEFAULT interval '1 hour', p_kind text DEFAULT 'recorded',
                               p_shareable boolean DEFAULT true, p_status text DEFAULT 'settled') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.factcheck_sessions (id, user_id, video_id, channel_id, video_kind, minutes_bought, credits_per_minute, credits_held,
    started_at, last_activity_at, ended_at, status, minutes_used, credits_charged, shareable)
  VALUES (v, p_user, p_video, 'chan', p_kind, 5, 1, 5, now() - p_ago - interval '2 minutes', now() - p_ago - interval '2 minutes',
    CASE p_status WHEN 'settled' THEN now() - p_ago END, p_status, CASE p_status WHEN 'settled' THEN 1 END,
    CASE p_status WHEN 'settled' THEN 1 END, p_shareable);
  INSERT INTO private.factcheck_pieces (session_id, user_id, video_id, piece_no, pos_start_s, pos_end_s, text)
  VALUES (v, p_user, p_video, 1, 0, 10, 'Direct line ' || v);
  RETURN v;
END;
$$;
CREATE FUNCTION pg_temp.cl(p_session uuid, p_user uuid, p_status text, p_shared boolean, p_text text, p_hidden boolean DEFAULT false,
                           p_super uuid DEFAULT NULL, p_verdict text DEFAULT 'supported') RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.factcheck_claims (session_id, user_id, video_id, video_kind, position_s, spoken_at, quote, claim_en, claimant, reported_by,
    kind, status, verdict, reason, sources, checked_at, shared, hidden_at, supersedes)
  SELECT p_session, p_user, s.video_id, s.video_kind, 12.5, now() - interval '5 minutes', 'Quote ' || p_text, 'Claim ' || p_text, 'The Speaker',
    'The Channel', 'claim', p_status, CASE WHEN p_status = 'checked' THEN p_verdict END, CASE WHEN p_status = 'checked' THEN 'Because ' || p_text END,
    CASE WHEN p_status = 'checked' THEN '[{"url":"https://example.invalid/a","title":"A"}]'::jsonb ELSE '[]'::jsonb END,
    CASE WHEN p_status = 'checked' THEN now() - interval '4 minutes' END, p_shared, CASE WHEN p_hidden THEN now() END, p_super
  FROM public.factcheck_sessions s WHERE s.id = p_session
  RETURNING id;
$$;
CREATE FUNCTION pg_temp.fcr(p_user uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.credit_ledger WHERE user_id = p_user AND turn_key LIKE 'fcu:%';
$$;
CREATE FUNCTION pg_temp.bal(p_user uuid) RETURNS numeric LANGUAGE sql AS $$
  SELECT balance FROM public.credit_wallets WHERE user_id = p_user;
$$;
CREATE FUNCTION pg_temp.stretch(v jsonb, p_id uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(v -> 'stretches') e WHERE e ->> 'stretch_id' = p_id::text;
$$;

-- 0. The objects exist, and who may do what ---------------------------------------------------------------------------------
SELECT pg_temp.assert_true(to_regclass('private.factcheck_pieces') IS NOT NULL AND to_regclass('public.factcheck_unlocks') IS NOT NULL
  AND to_regclass('public.factcheck_reports') IS NOT NULL AND to_regclass('private.factcheck_unlock_keys') IS NOT NULL
  AND to_regclass('private.factcheck_unlock_rate') IS NOT NULL AND to_regclass('private.factcheck_view_rate') IS NOT NULL, 'the tables exist');
SELECT pg_temp.assert_true((SELECT column_default = 'false' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'factcheck_sessions' AND column_name = 'shareable')
  AND (SELECT column_default = 'false' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'factcheck_claims' AND column_name = 'shared')
  AND (SELECT is_nullable = 'YES' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'factcheck_claims' AND column_name = 'hidden_at'),
  'every existing session and claim stays private by default');
DO $$
DECLARE actor text; f text;
  svc text[] := ARRAY['public.factcheck_mark_shareable(uuid,uuid)', 'public.factcheck_piece_store(uuid,uuid,integer,numeric,numeric,text)',
    'public.factcheck_turn_pieces(uuid,uuid,integer,integer)', 'public.factcheck_video_view(uuid,text,boolean)',
    'public.factcheck_unlock(uuid,uuid,boolean,numeric)', 'public.factcheck_report(uuid,uuid,text)', 'public.factcheck_share_on(boolean)'];
BEGIN
  FOREACH f IN ARRAY svc LOOP
    PERFORM pg_temp.assert_true(has_function_privilege('service_role', f, 'EXECUTE') AND NOT has_function_privilege('authenticated', f, 'EXECUTE')
      AND NOT has_function_privilege('anon', f, 'EXECUTE') AND NOT has_function_privilege('public', f, 'EXECUTE'), f || ' is service_role only');
  END LOOP;
  PERFORM pg_temp.assert_true(has_function_privilege('authenticated', 'public.factcheck_claim_hide(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.factcheck_video_remove(text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.factcheck_report_dismiss(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.factcheck_report_dismiss(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('public', 'public.factcheck_report_dismiss(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.factcheck_claim_hide(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.factcheck_video_remove(text)', 'EXECUTE')
    AND NOT has_function_privilege('public', 'public.factcheck_claim_hide(uuid)', 'EXECUTE'), 'hide and remove are for signed-in users, checked inside');
  FOREACH actor IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'public'] LOOP
    PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, 'private.factcheck_pieces', 'SELECT') AND NOT has_table_privilege(actor, 'private.factcheck_unlock_keys', 'SELECT')
      AND NOT has_table_privilege(actor, 'private.factcheck_unlock_rate', 'SELECT') AND NOT has_table_privilege(actor, 'private.factcheck_view_rate', 'SELECT') AND NOT has_function_privilege(actor, 'private.factcheck_share_flag()', 'EXECUTE'),
      actor || ' reaches nothing private');
  END LOOP;
  FOREACH actor IN ARRAY ARRAY['anon', 'public'] LOOP
    PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, 'public.factcheck_unlocks', 'SELECT') AND NOT has_table_privilege(actor, 'public.factcheck_reports', 'SELECT'),
      actor || ' reads neither unlocks nor reports');
  END LOOP;
  PERFORM pg_temp.assert_true(has_table_privilege('authenticated', 'public.factcheck_unlocks', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.factcheck_unlocks', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.factcheck_unlocks', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.factcheck_unlocks', 'DELETE')
    AND has_table_privilege('authenticated', 'public.factcheck_reports', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.factcheck_reports', 'INSERT')
    AND NOT has_table_privilege('service_role', 'public.factcheck_unlocks', 'INSERT') AND NOT has_table_privilege('service_role', 'public.factcheck_reports', 'UPDATE'),
    'unlocks and reports are read-only to the API roles: written only by the functions');
END;
$$;

-- 1. The flag: sharing is on only with share_recorded exactly true and a price in (0, 1000] ----------------------------------------------
SELECT pg_temp.mkuser(1, 5000);
SELECT pg_temp.mkuser(2, 5000);
SELECT pg_temp.mkuser(3, 5000);
SELECT pg_temp.on();
DO $$
DECLARE
  a uuid := pg_temp.u(1); sid uuid; v_flag jsonb; v_case integer := 0; r jsonb; stretch uuid;
  cases jsonb[] := (ARRAY[
    '{"enabled":true,"audience":"all","credits_per_minute":2}',
    '{"enabled":true,"audience":"all","credits_per_minute":2,"unlock_credits_per_minute":100}',
    '{"enabled":true,"audience":"all","credits_per_minute":2,"share_recorded":true}',
    '{"enabled":true,"audience":"all","credits_per_minute":2,"share_recorded":false,"unlock_credits_per_minute":100}',
    '{"enabled":true,"audience":"all","credits_per_minute":2,"share_recorded":"true","unlock_credits_per_minute":100}',
    '{"enabled":true,"audience":"all","credits_per_minute":2,"share_recorded":1,"unlock_credits_per_minute":100}',
    '{"enabled":true,"audience":"all","credits_per_minute":2,"share_recorded":true,"unlock_credits_per_minute":0}',
    '{"enabled":true,"audience":"all","credits_per_minute":2,"share_recorded":true,"unlock_credits_per_minute":-5}',
    '{"enabled":true,"audience":"all","credits_per_minute":2,"share_recorded":true,"unlock_credits_per_minute":1000.0001}',
    '{"enabled":true,"audience":"all","credits_per_minute":2,"share_recorded":true,"unlock_credits_per_minute":"100"}',
    '{"enabled":true,"audience":"all","credits_per_minute":2,"share_recorded":true,"unlock_credits_per_minute":null}',
    '{"enabled":true,"audience":"all","credits_per_minute":2,"share_recorded":true,"unlock_credits_per_minute":1e400}',
    '{"enabled":true,"audience":"all","credits_per_minute":2,"share_recorded":true,"unlock_credits_per_minute":0.00001}',
    '{"enabled":false,"audience":"all","credits_per_minute":2,"share_recorded":true,"unlock_credits_per_minute":100}',
    '{"enabled":true,"audience":"all","share_recorded":true,"unlock_credits_per_minute":100}',
    '[1]', '"on"', 'null', '{}'
  ])::jsonb[];
BEGIN
  sid := public.factcheck_start(a, 'V0', 'chan', 'recorded', 0, 5, true) ->> 'session_id';
  stretch := pg_temp.direct(pg_temp.u(2), 'V0');
  FOREACH v_flag IN ARRAY cases LOOP
    v_case := v_case + 1;
    PERFORM pg_temp.setflag(v_flag);
    r := jsonb_build_array(public.factcheck_mark_shareable(a, sid), public.factcheck_video_view(a, 'V0', true), public.factcheck_unlock(a, stretch, true, 100),
                           public.factcheck_report(a, gen_random_uuid(), ''));
    PERFORM pg_temp.assert_true(public.factcheck_share_on(true) IS NOT DISTINCT FROM false AND public.factcheck_share_on(false) IS NOT DISTINCT FROM false
      AND public.factcheck_share_on(NULL) IS NOT DISTINCT FROM false, 'flag case ' || v_case || ' is off for share_on');
    PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM jsonb_array_elements(r) e WHERE e <> '{"ok": false, "reason": "off"}'::jsonb),
      'flag case ' || v_case || ' (' || v_flag::text || ') is off for mark, view, unlock and report: ' || r::text);
  END LOOP;
  PERFORM pg_temp.assert_true((SELECT NOT shareable FROM public.factcheck_sessions WHERE id = sid), 'nothing was marked shareable while off');
  PERFORM pg_temp.setflag('{"enabled":true,"audience":"all","credits_per_minute":2,"share_recorded":true,"unlock_credits_per_minute":1000}');
  PERFORM pg_temp.assert_true(public.factcheck_video_view(a, 'V0', true) ->> 'ok' = 'true' AND public.factcheck_share_on(false) IS NOT DISTINCT FROM true, 'a price of 1000 is a price');
  PERFORM pg_temp.setflag('{"enabled":true,"audience":"all","credits_per_minute":2,"share_recorded":true,"unlock_credits_per_minute":0.0001}');
  PERFORM pg_temp.assert_true(public.factcheck_video_view(a, 'V0', true) ->> 'ok' = 'true', 'and so is 0.0001');
  PERFORM pg_temp.on();
  PERFORM pg_temp.assert_true(public.factcheck_share_on(true) IS NOT DISTINCT FROM true AND public.factcheck_share_on(false) IS NOT DISTINCT FROM true AND public.factcheck_share_on(NULL) IS NOT DISTINCT FROM true,
    'share_on is true when sharing is on for everyone');
  PERFORM pg_temp.setflag('{"enabled":true,"audience":"admin","credits_per_minute":2,"share_recorded":true,"unlock_credits_per_minute":100}');
  PERFORM pg_temp.assert_true(public.factcheck_share_on(true) IS NOT DISTINCT FROM true AND public.factcheck_share_on(false) IS NOT DISTINCT FROM false AND public.factcheck_share_on(NULL) IS NOT DISTINCT FROM false,
    'audience admin: share_on is true for an admin only');
  PERFORM pg_temp.on();
  PERFORM public.factcheck_settle(a, sid);
END;
$$;

-- 2. mark_shareable ----------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE a uuid := pg_temp.u(1); b uuid := pg_temp.u(2); live uuid; rec uuid; r jsonb; sidb uuid;
BEGIN
  live := (public.factcheck_start(a, 'V1', 'chan', 'live', NULL, 5, true) ->> 'session_id')::uuid;
  PERFORM pg_temp.assert_true(public.factcheck_mark_shareable(a, live) = '{"ok": false, "reason": "not_recorded"}'::jsonb, 'a live session is not_recorded');
  PERFORM public.factcheck_settle(a, live);
  rec := (public.factcheck_start(a, 'V1', 'chan', 'recorded', 0, 5, true) ->> 'session_id')::uuid;
  PERFORM pg_temp.assert_true(public.factcheck_mark_shareable(b, rec) = '{"ok": false, "reason": "not_found"}'::jsonb, 'another user''s session is not_found');
  PERFORM pg_temp.assert_true(public.factcheck_mark_shareable(a, gen_random_uuid()) ->> 'reason' = 'not_found', 'an unknown session is not_found');
  PERFORM pg_temp.assert_true(public.factcheck_mark_shareable(a, live) ->> 'reason' = 'not_found', 'a settled session is not_found');
  r := public.factcheck_mark_shareable(a, rec);
  PERFORM pg_temp.assert_true(r = '{"ok": true}'::jsonb AND (SELECT shareable FROM public.factcheck_sessions WHERE id = rec), 'an active recorded session is marked shareable');
  PERFORM pg_temp.assert_true(public.factcheck_mark_shareable(a, rec) ->> 'ok' = 'true', 'marking again is harmless');
  PERFORM pg_temp.rejected($q$SELECT public.factcheck_mark_shareable(NULL, gen_random_uuid())$q$, '22023', 'a missing user raises');
  PERFORM public.factcheck_settle(a, rec);
END;
$$;

-- 3. piece_store ------------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  a uuid := pg_temp.u(1); b uuid := pg_temp.u(2); sid uuid; plain uuid; r jsonb; n bigint; i integer;
BEGIN
  plain := (public.factcheck_start(b, 'V2', 'chan', 'recorded', 0, 5, true) ->> 'session_id')::uuid;
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(b, plain, 1, 0, 10, 'x') = '{"ok": false, "reason": "not_shareable"}'::jsonb, 'a session not marked shareable stores nothing');
  PERFORM public.factcheck_settle(b, plain);
  sid := (public.factcheck_start(a, 'V2', 'chan', 'recorded', 0, 5, true) ->> 'session_id')::uuid;
  PERFORM public.factcheck_mark_shareable(a, sid);
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(b, sid, 1, 0, 10, 'x') ->> 'reason' = 'not_found'
    AND public.factcheck_piece_store(a, gen_random_uuid(), 1, 0, 10, 'x') ->> 'reason' = 'not_found', 'another user''s or an unknown session is not_found');
  r := public.factcheck_piece_store(a, sid, 1, 0, 10, 'First');
  PERFORM pg_temp.assert_true(r = '{"ok": true, "stored": true}'::jsonb, 'the first piece (number 1) is stored');
  -- the rules, each against the piece just stored (number 1, positions 0 to 10)
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 1, 10, 20, 'again') ->> 'reason' = 'bad_piece', 'a piece number already stored is bad_piece');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 0, 10, 20, 'x') ->> 'reason' = 'bad_piece' AND public.factcheck_piece_store(a, sid, -1, 10, 20, 'x') ->> 'reason' = 'bad_piece'
    AND public.factcheck_piece_store(a, sid, NULL, 10, 20, 'x') ->> 'reason' = 'bad_piece', 'piece number 0, a negative or a missing one is bad_piece');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 2, 10, 10.4, 'x') ->> 'reason' = 'bad_piece', 'a piece of 0.4 s is bad_piece');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 2, 10, 25.1, 'x') ->> 'reason' = 'bad_piece', 'a piece of 15.1 s is bad_piece');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 2, 12, 11, 'x') ->> 'reason' = 'bad_piece', 'a piece that ends before it starts is bad_piece');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 2, 7.9, 17.9, 'x') ->> 'reason' = 'bad_piece', 'a start more than 2 s before the lower neighbour''s end is bad_piece');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 2, 10, 20, '') ->> 'reason' = 'bad_piece' AND public.factcheck_piece_store(a, sid, 2, 10, 20, '   ') ->> 'reason' = 'bad_piece'
    AND public.factcheck_piece_store(a, sid, 2, 10, 20, NULL) ->> 'reason' = 'bad_piece', 'an empty text is bad_piece');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 2, 10, 20, repeat('x', 2001)) ->> 'reason' = 'bad_piece', 'a text over 2000 characters is bad_piece');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 2, 'NaN', 20, 'x') ->> 'reason' = 'bad_piece' AND public.factcheck_piece_store(a, sid, 2, 10, 'Infinity', 'x') ->> 'reason' = 'bad_piece'
    AND public.factcheck_piece_store(a, sid, 2, -1, 5, 'x') ->> 'reason' = 'bad_piece' AND public.factcheck_piece_store(a, sid, 2, NULL, 20, 'x') ->> 'reason' = 'bad_piece'
    AND public.factcheck_piece_store(a, sid, 2, 10000000, 10000001, 'x') ->> 'reason' = 'bad_piece', 'NaN, infinite, negative, over-range and missing positions are bad_piece');
  SELECT count(*) INTO n FROM private.factcheck_pieces WHERE session_id = sid;
  PERFORM pg_temp.assert_true(n = 1, 'refused pieces are not stored and the session goes on');
  -- the boundaries that are allowed
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 2, 8, 8.5, 'half a second') ->> 'ok' = 'true', 'a piece of exactly 0.5 s that starts exactly 2 s before the lower neighbour''s end is stored');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 3, 8.5, 23.5, repeat('y', 2000)) ->> 'ok' = 'true', 'a piece of exactly 15 s with a text of 2000 characters is stored');
  -- a forward jump (a seek) is accepted, whatever time has passed, and so is what follows it
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 4, 600, 610, 'after a seek') ->> 'ok' = 'true', 'a forward jump of 576 s is stored: a gap in the stretch');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 5, 610, 620, 'and on') ->> 'ok' = 'true', 'and the piece after it');
  -- out of order: number 7 arrives before number 6
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 7, 630, 640, 'seven') ->> 'ok' = 'true', 'piece 7 before piece 6 is stored');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 6, 620, 632.1, 'six too long') ->> 'reason' = 'bad_piece', 'piece 6 ending more than 2 s past the start of piece 7 is bad_piece');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 6, 620, 632, 'six') ->> 'ok' = 'true', 'piece 6 ending exactly 2 s past the start of piece 7 is stored');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 8, 640, 650, 'eight') ->> 'ok' = 'true', 'and the stream goes on in order afterwards');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 10, 670, 680, 'ten') ->> 'ok' = 'true', 'a missing number (9) does not stop it');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 9, 650, 672.1, 'nine too long') ->> 'reason' = 'bad_piece', 'piece 9 ending more than 2 s past the next stored piece''s start is bad_piece');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 9, 650, 662, 'nine') ->> 'ok' = 'true', 'piece 9 inside the gap is stored');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 11, 677.9, 690, 'eleven early') ->> 'reason' = 'bad_piece', 'a start more than 2 s before the nearest lower piece''s end (680) is bad_piece');
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 11, 678, 690, 'eleven') ->> 'ok' = 'true', 'exactly 2 s before is stored');
  -- at most 120 pieces
  FOR i IN 12..120 LOOP
    r := public.factcheck_piece_store(a, sid, i, 690 + (i - 12) * 10, 700 + (i - 12) * 10, 'p' || i);
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: piece % refused: %', i, r; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM private.factcheck_pieces WHERE session_id = sid;
  PERFORM pg_temp.assert_true(n = 120 AND public.factcheck_piece_store(a, sid, 121, 1780, 1790, 'one too many') ->> 'reason' = 'bad_piece', 'a session keeps at most 120 pieces: the 121st is bad_piece');
  -- a settled session stores no more
  PERFORM public.factcheck_settle(a, sid);
  PERFORM pg_temp.assert_true(public.factcheck_piece_store(a, sid, 122, 1790, 1800, 'late') = '{"ok": false, "reason": "settled"}'::jsonb, 'a settled session is settled');
  PERFORM pg_temp.rejected($q$SELECT public.factcheck_piece_store(NULL, gen_random_uuid(), 1, 0, 10, 'x')$q$, '22023', 'a missing user raises');
END;
$$;

-- 3b. Price counts non-overlapping stored speech ------------------------------------------------------------------------------------------
DO $$
DECLARE a uuid := pg_temp.u(1); sid uuid; i integer; r jsonb;
BEGIN
  sid := (public.factcheck_start(a, 'VOVL', 'chan', 'recorded', 0, 5, true) ->> 'session_id')::uuid;
  PERFORM public.factcheck_mark_shareable(a, sid);
  FOR i IN 1..66 LOOP   -- 10 s pieces, each overlapping the previous by 1 s: 10 + 65 x 9 = 595 s (summed naively: 660 s = 11 minutes)
    r := public.factcheck_piece_store(a, sid, i, (i - 1) * 9, (i - 1) * 9 + 10, 'ov ' || i);
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: overlapping piece % refused: %', i, r; END IF;
  END LOOP;
  PERFORM public.factcheck_settle(a, sid);
  PERFORM pg_temp.assert_true(private.factcheck_stretch_minutes(sid) = 10, '66 pieces of 10 s overlapping by 1 s are 595 s: 10 minutes, not 11: ' || coalesce(private.factcheck_stretch_minutes(sid)::text, 'null'));
  PERFORM pg_temp.assert_true((SELECT (e ->> 'minutes')::int = 10 AND (e ->> 'price')::numeric = 1000 FROM jsonb_array_elements(public.factcheck_video_view(pg_temp.u(3), 'VOVL', true) -> 'stretches') e),
    'the view shows 10 minutes and the price of 1000');
  -- a gap is not billed: two 10 s pieces 1000 s apart are 20 s, one minute
  sid := (public.factcheck_start(a, 'VGAP', 'chan', 'recorded', 0, 5, true) ->> 'session_id')::uuid;
  PERFORM public.factcheck_mark_shareable(a, sid);
  PERFORM public.factcheck_piece_store(a, sid, 1, 0, 10, 'g1');
  PERFORM public.factcheck_piece_store(a, sid, 2, 1000, 1010, 'g2');
  PERFORM public.factcheck_settle(a, sid);
  PERFORM pg_temp.assert_true(private.factcheck_stretch_minutes(sid) = 1, 'a gap in the stretch is not billed: 20 s of speech is 1 minute');
  -- a piece inside the previous one adds nothing, never a negative amount
  sid := (public.factcheck_start(a, 'VNEG', 'chan', 'recorded', 0, 5, true) ->> 'session_id')::uuid;
  PERFORM public.factcheck_mark_shareable(a, sid);
  PERFORM public.factcheck_piece_store(a, sid, 1, 0, 15, 'n1');
  PERFORM public.factcheck_piece_store(a, sid, 2, 13, 14.5, 'n2');
  PERFORM public.factcheck_piece_store(a, sid, 3, 14, 29, 'n3');
  PERFORM public.factcheck_settle(a, sid);
  PERFORM pg_temp.assert_true((SELECT count(*) FROM private.factcheck_pieces WHERE session_id = sid) = 3 AND private.factcheck_stretch_minutes(sid) = 1,
    'a piece inside the previous one counts nothing, never a negative amount');
END;
$$;

-- 4. turn_pieces ------------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE a uuid := pg_temp.u(1); b uuid := pg_temp.u(2); sid uuid := pg_temp.run(pg_temp.u(1), 'V3', 14, 10, 0, false); r jsonb;
BEGIN
  r := public.factcheck_turn_pieces(a, sid, 2, 4);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND jsonb_array_length(r -> 'pieces') = 3 AND r #>> '{pieces,0,piece_no}' = '2' AND r #>> '{pieces,2,piece_no}' = '4'
    AND (r #>> '{pieces,0,pos_start_s}')::numeric = 10 AND (r #>> '{pieces,0,pos_end_s}')::numeric = 20 AND r #>> '{pieces,0,text}' = 'Line V3 1', 'the pieces of a range, in order, with positions and text');
  PERFORM pg_temp.assert_true(jsonb_array_length(public.factcheck_turn_pieces(a, sid, 1, 12) -> 'pieces') = 12, 'a range of 12 is allowed');
  PERFORM pg_temp.assert_true(public.factcheck_turn_pieces(a, sid, 1, 13) = '{"ok": false, "reason": "bad_range"}'::jsonb, 'a range of 13 is bad_range');
  PERFORM pg_temp.assert_true(public.factcheck_turn_pieces(a, sid, 5, 4) ->> 'reason' = 'bad_range' AND public.factcheck_turn_pieces(a, sid, -1, 2) ->> 'reason' = 'bad_range'
    AND public.factcheck_turn_pieces(a, sid, NULL, 2) ->> 'reason' = 'bad_range', 'a reversed, negative or missing range is bad_range');
  PERFORM pg_temp.assert_true(public.factcheck_turn_pieces(b, sid, 0, 2) ->> 'reason' = 'not_found' AND public.factcheck_turn_pieces(a, gen_random_uuid(), 0, 2) ->> 'reason' = 'not_found',
    'another user''s or an unknown session is not_found');
  PERFORM pg_temp.assert_true(jsonb_array_length(public.factcheck_turn_pieces(a, sid, 30, 31) -> 'pieces') = 0, 'a range past the last piece is empty');
  PERFORM public.factcheck_settle(a, sid);
END;
$$;

-- 5. A claim is shared only from a shareable recorded session --------------------------------------------------------------------------
DO $$
DECLARE a uuid := pg_temp.u(1); priv uuid; live uuid; shr uuid; c uuid;
BEGIN
  priv := (public.factcheck_start(a, 'V4', 'chan', 'recorded', 0, 5, true) ->> 'session_id')::uuid;   -- recorded, not marked
  c := pg_temp.cl(priv, a, 'checked', true, 'p');
  PERFORM pg_temp.assert_true((SELECT NOT shared FROM public.factcheck_claims WHERE id = c), 'a claim inserted shared=true into a session not marked shareable is saved private');
  UPDATE public.factcheck_claims SET shared = true WHERE id = c;
  PERFORM pg_temp.assert_true((SELECT NOT shared FROM public.factcheck_claims WHERE id = c), 'and cannot be made shared by an update');
  PERFORM public.factcheck_settle(a, priv);
  live := (public.factcheck_start(a, 'V4', 'chan', 'live', NULL, 5, true) ->> 'session_id')::uuid;
  UPDATE public.factcheck_sessions SET shareable = true WHERE id = live;   -- even a live session set shareable by hand
  c := pg_temp.cl(live, a, 'checked', true, 'l');
  PERFORM pg_temp.assert_true((SELECT NOT shared FROM public.factcheck_claims WHERE id = c), 'a live session''s claim is never shared');
  PERFORM public.factcheck_settle(a, live);
  shr := pg_temp.run(a, 'V4', 2, 10, 0, false);
  c := pg_temp.cl(shr, a, 'checked', true, 's');
  PERFORM pg_temp.assert_true((SELECT shared FROM public.factcheck_claims WHERE id = c), 'a claim of a shareable recorded session can be shared');
  c := pg_temp.cl(shr, a, 'checked', false, 'n');
  PERFORM pg_temp.assert_true((SELECT NOT shared FROM public.factcheck_claims WHERE id = c), 'and one inserted private stays private');
  PERFORM public.factcheck_settle(a, shr);
END;
$$;

-- 6. The view -----------------------------------------------------------------------------------------------------------------------------
CREATE TEMP TABLE ids (k text PRIMARY KEY, id uuid);
GRANT ALL ON ids TO anon, authenticated, service_role;
DO $$
DECLARE
  a uuid := pg_temp.u(1); b uuid := pg_temp.u(2); c3 uuid := pg_temp.u(3);
  s1 uuid; s2 uuid; unsettled uuid; private_run uuid; live uuid; other uuid;
  c_ok uuid; c_hidden uuid; c_private uuid; c_pending uuid; c_chain uuid; c_chain2 uuid; c_forged uuid; c_noshare uuid; i integer;
BEGIN
  s1 := pg_temp.run(a, 'VV', 3, 10, 0);                 -- 30 s: 1 minute
  s2 := pg_temp.run(b, 'VV', 9, 15, 100);               -- 135 s: 3 minutes
  private_run := pg_temp.run(b, 'VV', 2, 10, 0, true, false);   -- recorded, never shareable
  other := pg_temp.run(a, 'VW', 2, 10, 0);
  unsettled := pg_temp.run(a, 'VV', 2, 10, 0, false);   -- active
  UPDATE public.factcheck_sessions SET ended_at = ended_at - interval '1 hour' WHERE id = s1;   -- s2 is newer
  c_ok := pg_temp.cl(s1, a, 'checked', true, 'ok');
  c_hidden := pg_temp.cl(s1, a, 'checked', true, 'hidden', true);
  c_private := pg_temp.cl(s1, a, 'checked', false, 'private');          -- a claim with shared = false in a shareable settled session
  c_pending := pg_temp.cl(s1, a, 'pending', true, 'pending');
  c_forged := pg_temp.cl(s1, a, 'checked', false, 'forged from browser text');
  c_chain := pg_temp.cl(s1, a, 'checked', true, 'chain', false, NULL, 'supported');
  c_chain2 := pg_temp.cl(s1, a, 'checked', true, 'chainpending', false, NULL, 'contradicted');
  PERFORM pg_temp.cl(s1, a, 'checked', false, 'chain', false, c_chain, 'partly_true');            -- re-check row (private flag as begin leaves it)
  PERFORM pg_temp.cl(s1, a, 'pending', false, 'chainpending', false, c_chain2);                      -- a pending re-check: not yet a result
  PERFORM pg_temp.cl(s2, b, 'checked', true, 'b-claim');
  PERFORM pg_temp.cl(unsettled, a, 'checked', true, 'unsettled-claim');
  PERFORM pg_temp.cl(private_run, b, 'checked', true, 'private-run-claim');
  PERFORM pg_temp.cl(other, a, 'checked', true, 'other-video-claim');
  INSERT INTO ids VALUES ('s1', s1), ('s2', s2), ('unsettled', unsettled), ('private_run', private_run), ('other', other), ('c_ok', c_ok), ('c_hidden', c_hidden),
    ('c_private', c_private), ('c_pending', c_pending), ('c_chain', c_chain), ('c_chain2', c_chain2), ('c_forged', c_forged);
END;
$$;
DO $$
DECLARE
  a uuid := pg_temp.u(1); b uuid := pg_temp.u(2); c3 uuid := pg_temp.u(3);
  s1 uuid := (SELECT id FROM ids WHERE k = 's1'); s2 uuid := (SELECT id FROM ids WHERE k = 's2');
  v jsonb; st jsonb; txt text; n integer;
BEGIN
  v := public.factcheck_video_view(c3, 'VV', true);
  PERFORM pg_temp.assert_true(v ->> 'ok' = 'true' AND (v ->> 'unlock_credits_per_minute')::numeric = 100 AND jsonb_array_length(v -> 'stretches') = 2,
    'the viewer sees exactly the two settled shareable stretches of the video (not the active, the private or the other video''s): ' || jsonb_array_length(v -> 'stretches'));
  PERFORM pg_temp.assert_true(v #>> '{stretches,0,stretch_id}' = s2::text AND v #>> '{stretches,1,stretch_id}' = s1::text, 'newest first');
  st := pg_temp.stretch(v, s1);
  PERFORM pg_temp.assert_true(st ->> 'access' = 'locked' AND (st ->> 'minutes')::int = 1 AND (st ->> 'price')::numeric = 100 AND (st ->> 'from_s')::numeric = 0 AND (st ->> 'to_s')::numeric = 30
    AND (st ->> 'claims_count')::int = 3 AND st ->> 'checked_on' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', 'stretch 1: locked, 1 minute, price 100, 0 to 30 s, three claims (ok, chain, chain with a pending re-check): ' || st::text);
  st := pg_temp.stretch(v, s2);
  PERFORM pg_temp.assert_true(st ->> 'access' = 'locked' AND (st ->> 'minutes')::int = 3 AND (st ->> 'price')::numeric = 300 AND (st ->> 'from_s')::numeric = 100 AND (st ->> 'to_s')::numeric = 235
    AND (st ->> 'claims_count')::int = 1, 'stretch 2: 135 s is 3 started minutes, price 300, 100 to 235 s: ' || st::text);
  txt := v::text;
  PERFORM pg_temp.assert_true(NOT (pg_temp.stretch(v, s1) ? 'lines') AND NOT (pg_temp.stretch(v, s1) ? 'claims') AND NOT (pg_temp.stretch(v, s2) ? 'lines') AND NOT (pg_temp.stretch(v, s2) ? 'claims'),
    'a locked stretch carries no lines and no claims');
  PERFORM pg_temp.assert_true(txt NOT LIKE '%Line VV%' AND txt NOT LIKE '%Quote %' AND txt NOT LIKE '%Claim %' AND txt NOT LIKE '%Because%', 'and none of their text appears anywhere in the answer');
  PERFORM pg_temp.assert_true(txt NOT LIKE '%' || a::text || '%' AND txt NOT LIKE '%' || b::text || '%' AND txt NOT LIKE '%' || c3::text || '%' AND txt NOT LIKE '%user_id%',
    'no user id appears in the answer, not the viewer''s, not the owners''');
  -- the owner reads the stretch free
  v := public.factcheck_video_view(a, 'VV', true);
  st := pg_temp.stretch(v, s1);
  PERFORM pg_temp.assert_true(st ->> 'access' = 'own' AND jsonb_array_length(st -> 'lines') = 3 AND st #>> '{lines,0,text}' = 'Line VV 0' AND (st #>> '{lines,1,pos_start_s}')::numeric = 10
    AND NOT (st #> '{lines,0}' ? 'text' AND st #> '{lines,0}' ? 'user_id'), 'the owner sees the lines of their own stretch, in order, with start positions');
  PERFORM pg_temp.assert_true(pg_temp.stretch(v, s2) ->> 'access' = 'locked', 'and another''s stays locked');
  -- the claims of an open stretch
  SELECT count(*) INTO n FROM jsonb_array_elements(st -> 'claims');
  PERFORM pg_temp.assert_true(n = 3, 'an open stretch returns only the shared, visible, non-pending claims: ' || n);
  PERFORM pg_temp.assert_true(EXISTS (SELECT FROM jsonb_array_elements(st -> 'claims') e WHERE e ->> 'id' = (SELECT id::text FROM ids WHERE k = 'c_ok')),
    'the shared claim is there');
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM jsonb_array_elements(st -> 'claims') e WHERE e ->> 'id' IN
    (SELECT id::text FROM ids WHERE k IN ('c_hidden', 'c_private', 'c_pending', 'c_forged'))), 'never a hidden claim, a claim with shared = false, a pending claim or a forged claim');
  PERFORM pg_temp.assert_true((SELECT e ->> 'verdict' FROM jsonb_array_elements(st -> 'claims') e WHERE e ->> 'id' = (SELECT id::text FROM ids WHERE k = 'c_chain')) = 'partly_true'
    AND (SELECT e ->> 'reason' FROM jsonb_array_elements(st -> 'claims') e WHERE e ->> 'id' = (SELECT id::text FROM ids WHERE k = 'c_chain')) = 'Because chain',
    'a re-checked claim returns the newest checked result under the original''s id');
  PERFORM pg_temp.assert_true((SELECT e ->> 'verdict' FROM jsonb_array_elements(st -> 'claims') e WHERE e ->> 'id' = (SELECT id::text FROM ids WHERE k = 'c_chain2')) = 'contradicted',
    'a re-check still pending is not a result: the original''s stays');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM jsonb_array_elements(st -> 'claims') e WHERE e ? 'user_id' OR e ? 'supersedes' OR e ? 'session_id') = 0, 'a claim carries no user, session or chain id');
  -- the viewer
  v := public.factcheck_video_view(c3, 'VV', true);
  -- audience
  PERFORM pg_temp.setflag('{"enabled":true,"audience":"admin","credits_per_minute":2,"share_recorded":true,"unlock_credits_per_minute":100}');
  PERFORM pg_temp.assert_true(public.factcheck_video_view(c3, 'VV', false) = '{"ok": false, "reason": "not_allowed"}'::jsonb AND public.factcheck_video_view(c3, 'VV', NULL) ->> 'reason' = 'not_allowed'
    AND public.factcheck_video_view(c3, 'VV', true) ->> 'ok' = 'true', 'audience admin: a non-admin is not_allowed');
  PERFORM pg_temp.on();
  PERFORM pg_temp.assert_true(public.factcheck_video_view(c3, 'NOVIDEO', true) = '{"ok": true, "stretches": [], "unlock_credits_per_minute": 100}'::jsonb, 'a video with nothing shared has no stretches');
  PERFORM pg_temp.rejected($q$SELECT public.factcheck_video_view(NULL, 'VV', true)$q$, '22023', 'a missing user raises');
END;
$$;
-- At most 50 stretches, newest first.
DO $$
DECLARE i integer; v jsonb;
BEGIN
  FOR i IN 1..52 LOOP PERFORM pg_temp.direct(pg_temp.u(2), 'VMANY', (i * interval '1 minute')); END LOOP;
  v := public.factcheck_video_view(pg_temp.u(2), 'VMANY', true);
  PERFORM pg_temp.assert_true(jsonb_array_length(v -> 'stretches') = 50 AND NOT EXISTS (SELECT FROM jsonb_array_elements(v -> 'stretches') e WHERE e ->> 'access' <> 'own'),
    'the runner sees all of their own stretches, at most 50: ' || jsonb_array_length(v -> 'stretches'));
  PERFORM pg_temp.assert_true(v #>> '{stretches,0,stretch_id}' = (SELECT id::text FROM public.factcheck_sessions WHERE video_id = 'VMANY' ORDER BY ended_at DESC, id LIMIT 1)
    AND v #>> '{stretches,49,stretch_id}' = (SELECT id::text FROM public.factcheck_sessions WHERE video_id = 'VMANY' ORDER BY ended_at DESC, id OFFSET 49 LIMIT 1), 'newest first');
  -- another viewer sees at most the 3 newest of that runner
  v := public.factcheck_video_view(pg_temp.u(3), 'VMANY', true);
  PERFORM pg_temp.assert_true(jsonb_array_length(v -> 'stretches') = 3 AND NOT EXISTS (SELECT FROM jsonb_array_elements(v -> 'stretches') e WHERE e ->> 'access' <> 'locked')
    AND (SELECT array_agg(e ->> 'stretch_id' ORDER BY ord) FROM jsonb_array_elements(v -> 'stretches') WITH ORDINALITY x(e, ord))
      = (SELECT array_agg(id::text ORDER BY ended_at DESC, id) FROM (SELECT id, ended_at FROM public.factcheck_sessions WHERE video_id = 'VMANY' ORDER BY ended_at DESC, id LIMIT 3) z),
    'a viewer sees only the 3 newest stretches of one runner on a video: ' || jsonb_array_length(v -> 'stretches'));
END;
$$;

-- A viewer's own stretches are all listed, and three of each other runner's.
DO $$
DECLARE i integer; v jsonb; u1 uuid := pg_temp.u(1); u2 uuid := pg_temp.u(2); c3 uuid := pg_temp.u(3); oldest uuid; ids2 uuid[] := '{}';
BEGIN
  FOR i IN 1..5 LOOP
    PERFORM pg_temp.direct(u1, 'VMIX', (i * interval '1 minute'));
    ids2 := ids2 || pg_temp.direct(u2, 'VMIX', (i * interval '1 minute') + interval '30 seconds');
  END LOOP;
  v := public.factcheck_video_view(u1, 'VMIX', true);
  PERFORM pg_temp.assert_true(jsonb_array_length(v -> 'stretches') = 8 AND (SELECT count(*) FROM jsonb_array_elements(v -> 'stretches') e WHERE e ->> 'access' = 'own') = 5,
    'a runner sees all 5 of their own and 3 of the other runner''s: ' || jsonb_array_length(v -> 'stretches'));
  v := public.factcheck_video_view(c3, 'VMIX', true);
  PERFORM pg_temp.assert_true(jsonb_array_length(v -> 'stretches') = 6, 'a viewer with none sees 3 of each runner: ' || jsonb_array_length(v -> 'stretches'));
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM jsonb_array_elements(v -> 'stretches') e WHERE e ->> 'stretch_id' = ids2[5]::text), 'and not the older ones');
  oldest := ids2[5];
  INSERT INTO public.factcheck_unlocks (user_id, session_id, video_id, credits_charged) VALUES (c3, oldest, 'VMIX', 100);
  v := public.factcheck_video_view(c3, 'VMIX', true);
  PERFORM pg_temp.assert_true(jsonb_array_length(v -> 'stretches') = 7 AND pg_temp.stretch(v, oldest) ->> 'access' = 'unlocked',
    'a stretch the viewer has paid for stays listed even when it is older than the 3 newest: ' || jsonb_array_length(v -> 'stretches'));
  DELETE FROM public.factcheck_unlocks WHERE user_id = c3 AND session_id = oldest;
END;
$$;
-- Listing is limited to 30 a minute per user.
SELECT pg_temp.mkuser(15, 0);
DO $$
DECLARE u uuid := pg_temp.u(15); i integer; r jsonb;
BEGIN
  FOR i IN 1..30 LOOP
    r := public.factcheck_video_view(u, 'NOVIDEO', true);
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: view % was refused: %', i, r; END IF;
  END LOOP;
  PERFORM pg_temp.assert_true(public.factcheck_video_view(u, 'NOVIDEO', true) = '{"ok": false, "reason": "rate_limited"}'::jsonb, 'the 31st listing in a minute is rate_limited');
  PERFORM pg_temp.assert_true(public.factcheck_video_view(pg_temp.u(3), 'NOVIDEO', true) ->> 'ok' = 'true', 'another user is not limited');
  PERFORM pg_temp.setflag(NULL);
  PERFORM pg_temp.assert_true(public.factcheck_video_view(u, 'NOVIDEO', true) ->> 'reason' = 'off', 'off is answered before the limit');
  PERFORM pg_temp.on();
  UPDATE private.factcheck_view_rate SET minute = minute - interval '1 minute' WHERE user_id = u;
  PERFORM pg_temp.assert_true(public.factcheck_video_view(u, 'NOVIDEO', true) ->> 'ok' = 'true', 'the next minute starts again');
  INSERT INTO private.factcheck_view_rate (user_id, minute, n) VALUES (u, now() - interval '3 hours', 2);
  PERFORM public.factcheck_video_view(u, 'NOVIDEO', true);
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM private.factcheck_view_rate WHERE user_id = u AND minute < now() - interval '1 hour'), 'old view-rate rows are pruned');
END;
$$;

-- 7. unlock --------------------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.mkuser(4, 120);
SELECT pg_temp.mkuser(5, 250);
SELECT pg_temp.mkuser(6, 320);
DO $$
DECLARE
  a uuid := pg_temp.u(1); c3 uuid := pg_temp.u(3); poor uuid := pg_temp.u(4);
  s1 uuid := (SELECT id FROM ids WHERE k = 's1'); s2 uuid := (SELECT id FROM ids WHERE k = 's2');
  r jsonb; r2 jsonb; bal numeric; ent record; v jsonb; st jsonb; v_rate numeric; v_usd numeric;
BEGIN
  PERFORM pg_temp.assert_true(public.factcheck_unlock(c3, gen_random_uuid(), true, 100) = '{"ok": false, "reason": "not_found"}'::jsonb, 'an unknown stretch is not_found');
  PERFORM pg_temp.assert_true(public.factcheck_unlock(c3, (SELECT id FROM ids WHERE k = 'unsettled'), true, 100) ->> 'reason' = 'not_found'
    AND public.factcheck_unlock(c3, (SELECT id FROM ids WHERE k = 'private_run'), true, 100) ->> 'reason' = 'not_found', 'an active stretch and a non-shareable one are not_found');
  PERFORM pg_temp.assert_true(public.factcheck_unlock(a, s1, true, 100) = '{"ok": false, "reason": "own"}'::jsonb AND pg_temp.fcr(a) = 0, 'the owner cannot unlock their own stretch');
  PERFORM pg_temp.setflag('{"enabled":true,"audience":"admin","credits_per_minute":2,"share_recorded":true,"unlock_credits_per_minute":100}');
  PERFORM pg_temp.assert_true(public.factcheck_unlock(c3, s1, false, 100) = '{"ok": false, "reason": "not_allowed"}'::jsonb, 'audience admin: a non-admin is not_allowed');
  PERFORM pg_temp.on();
  r := public.factcheck_unlock(c3, s1, true, 99);
  PERFORM pg_temp.assert_true(r = '{"ok": false, "reason": "price_changed", "price": 100.0000}'::jsonb OR (r ->> 'reason' = 'price_changed' AND (r ->> 'price')::numeric = 100), 'a different expected price is price_changed with the price: ' || r::text);
  PERFORM pg_temp.assert_true(public.factcheck_unlock(c3, s1, true, NULL) ->> 'reason' = 'price_changed' AND public.factcheck_unlock(c3, s1, true, 'NaN') ->> 'reason' = 'price_changed'
    AND public.factcheck_unlock(c3, s2, true, 100) ->> 'reason' = 'price_changed', 'no expected price, NaN, or the price of another stretch is price_changed');
  r := public.factcheck_unlock(poor, s2, true, 300);
  PERFORM pg_temp.assert_true(r ->> 'reason' = 'insufficient' AND (r ->> 'needed')::numeric = 300 AND (r ->> 'available')::numeric = 120 AND pg_temp.fcr(poor) = 0
    AND NOT EXISTS (SELECT FROM public.factcheck_unlocks WHERE user_id = poor), 'too few credits is insufficient, with what is needed and what is available, and charges nothing: ' || r::text);

  -- the charge
  bal := pg_temp.bal(c3);
  r := public.factcheck_unlock(c3, s1, true, 100);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND r ->> 'repeated' = 'false' AND (r ->> 'credits_charged')::numeric = 100 AND (r ->> 'balance')::numeric = bal - 100
    AND (SELECT count(*) FROM jsonb_object_keys(r)) = 4, 'the unlock charges the price: ' || r::text);
  PERFORM pg_temp.assert_true(r::text NOT LIKE '%fcu:%', 'and returns no key');
  SELECT * INTO ent FROM public.credit_ledger WHERE user_id = c3 AND turn_key LIKE 'fcu:%';
  SELECT inr_per_credit, usd_to_inr INTO v_rate, v_usd FROM public.credit_settings WHERE id;
  PERFORM pg_temp.assert_true(pg_temp.fcr(c3) = 1 AND ent.kind = 'charge' AND ent.credits = -100 AND ent.note = 'live tv fact-check' AND ent.turn_key ~ '^fcu:[0-9a-f-]{36}$'
    AND ent.lot_id IS NULL AND ent.request_id IS NULL AND ent.inr_per_credit = v_rate AND ent.usd_to_inr = v_usd, 'one charge entry: note exactly live tv fact-check, a private fcu: key, current rates');
  PERFORM pg_temp.assert_true((SELECT sum(credits) FROM public.credit_lot_draws WHERE ledger_id = ent.id AND reason = 'charge') = 100, 'the lots paid it');
  PERFORM pg_temp.assert_true((SELECT credits_charged = 100 AND video_id = 'VV' FROM public.factcheck_unlocks WHERE user_id = c3 AND session_id = s1)
    AND (SELECT turn_key = ent.turn_key FROM private.factcheck_unlock_keys k JOIN public.factcheck_unlocks u ON u.id = k.unlock_id WHERE u.user_id = c3), 'the unlock is recorded, the key kept privately');
  PERFORM pg_temp.invariants('after an unlock');
  r2 := public.factcheck_unlock(c3, s1, true, 100);
  PERFORM pg_temp.assert_true(r2 = '{"ok": true, "repeated": true}'::jsonb AND pg_temp.fcr(c3) = 1 AND pg_temp.bal(c3) = bal - 100, 'a second call is repeated and charges nothing');
  PERFORM pg_temp.assert_true(public.factcheck_unlock(c3, s1, true, 7) = '{"ok": true, "repeated": true}'::jsonb, 'even with a stale expected price');
  -- what the viewer now sees
  v := public.factcheck_video_view(c3, 'VV', true);
  st := pg_temp.stretch(v, s1);
  PERFORM pg_temp.assert_true(st ->> 'access' = 'unlocked' AND jsonb_array_length(st -> 'lines') = 3 AND jsonb_array_length(st -> 'claims') = 3 AND pg_temp.stretch(v, s2) ->> 'access' = 'locked'
    AND NOT (pg_temp.stretch(v, s2) ? 'claims'), 'the unlocked stretch opens, the other stays locked');
  PERFORM pg_temp.assert_true((SELECT e ->> 'verdict' FROM jsonb_array_elements(st -> 'claims') e WHERE e ->> 'id' = (SELECT id::text FROM ids WHERE k = 'c_chain')) = 'supported'
    AND (SELECT e ->> 'reason' FROM jsonb_array_elements(st -> 'claims') e WHERE e ->> 'id' = (SELECT id::text FROM ids WHERE k = 'c_chain')) = 'Because chain'
    AND (SELECT e ->> 'verdict' FROM jsonb_array_elements(pg_temp.stretch(public.factcheck_video_view(a, 'VV', true), s1) -> 'claims') e WHERE e ->> 'id' = (SELECT id::text FROM ids WHERE k = 'c_chain')) = 'partly_true',
    'an unlocked stretch shows the ORIGINAL checked result of a re-checked claim (the runner''s re-check does not replace it), the runner''s own view the newest');
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM jsonb_array_elements(st -> 'claims') e WHERE e ->> 'id' IN (SELECT id::text FROM ids WHERE k IN ('c_hidden', 'c_private', 'c_pending', 'c_forged'))),
    'REGRESSION: even after the unlock, a claim with shared = false, a forged one, a hidden one and a pending one are never returned');
  PERFORM pg_temp.assert_true(v::text NOT LIKE '%' || a::text || '%' AND v::text NOT LIKE '%' || pg_temp.u(2)::text || '%', 'and no user id');
  -- the reports list the charge as a fact-check row with no session detail
  PERFORM set_config('request.jwt.claim.sub', c3::text, true);
  PERFORM pg_temp.assert_true((SELECT count(*) FROM jsonb_array_elements(public.my_usage_activity(0, 100, true, NULL, 'all', 'factcheck') -> 'rows') e
                               WHERE (e ->> 'credits')::numeric = 100 AND e ->> 'feature' = 'factcheck' AND jsonb_typeof(e -> 'channel') = 'null' AND jsonb_typeof(e -> 'turn_key') = 'null') = 1,
    'the usage reports list the unlock as a fact-check row with no channel or key');
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;
-- Credits in flight and held count against what is available.
DO $$
DECLARE u uuid := pg_temp.u(5); h uuid := pg_temp.u(6); s2 uuid := (SELECT id FROM ids WHERE k = 's2'); sid uuid; c uuid; kk uuid; r jsonb; hs uuid;
BEGIN
  sid := pg_temp.direct(u, 'VF', interval '2 hours', 'live');   -- a settled live session of the user, only to hang a claim on
  c := pg_temp.cl(sid, u, 'checked', false, 'for recheck');
  kk := (public.factcheck_recheck_begin(u, c, true, 100) ->> 'claim_id')::uuid;
  r := public.factcheck_unlock(u, s2, true, 300);
  PERFORM pg_temp.assert_true(r ->> 'reason' = 'insufficient' AND (r ->> 'available')::numeric = 150 AND pg_temp.fcr(u) = 0, 'a re-check begun and not charged is owed: 250 less 100 is 150, not enough for 300: ' || r::text);
  UPDATE public.factcheck_claims SET status = 'error' WHERE id = kk;
  r := public.factcheck_unlock(u, s2, true, 300);
  PERFORM pg_temp.assert_true(r ->> 'reason' = 'insufficient' AND (r ->> 'available')::numeric = 250, 'when it ends in error it is no longer owed: all 250 are available again: ' || r::text);
  -- a running session's hold
  hs := (public.factcheck_start(h, 'VH', 'chan', 'live', NULL, 15, true) ->> 'session_id')::uuid;     -- holds 30
  r := public.factcheck_unlock(h, s2, true, 300);
  PERFORM pg_temp.assert_true(r ->> 'reason' = 'insufficient' AND (r ->> 'available')::numeric = 290, 'a running session''s hold (30 of 320) is counted: ' || r::text);
  PERFORM public.factcheck_settle(h, hs);
END;
$$;
-- An owed re-check (a verdict nobody charged) is collected first.
SELECT pg_temp.mkuser(12, 1000);
DO $$
DECLARE u uuid := pg_temp.u(12); sid uuid := pg_temp.direct(pg_temp.u(12), 'VO', interval '2 hours', 'live'); c uuid; kk uuid; s1 uuid := (SELECT id FROM ids WHERE k = 's1'); r jsonb;
BEGIN
  c := pg_temp.cl(sid, u, 'checked', false, 'owed');
  kk := (public.factcheck_recheck_begin(u, c, true, 100) ->> 'claim_id')::uuid;
  UPDATE public.factcheck_claims SET status = 'checked', verdict = 'supported', reason = 'r', sources = '[]', checked_at = now() WHERE id = kk;
  r := public.factcheck_unlock(u, s1, true, 100);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND (SELECT credits_charged = 100 FROM private.factcheck_recheck_state WHERE claim_id = kk) AND pg_temp.bal(u) = 800,
    'the unlock collects the owed re-check first: 1000 - 100 - 100 = 800: ' || r::text);
END;
$$;
-- Debt: the balance fell below the price after the check.
SELECT pg_temp.mkuser(13, 100);
DO $$
DECLARE u uuid := pg_temp.u(13); s1 uuid := (SELECT id FROM ids WHERE k = 's1'); r jsonb;
BEGIN
  PERFORM public.factcheck_unlock(u, s1, true, 100);   -- spends the 100
  PERFORM pg_temp.assert_true(pg_temp.bal(u) = 0 AND pg_temp.fcr(u) = 1, 'the first unlock spends everything');
  r := public.factcheck_unlock(u, (SELECT id FROM ids WHERE k = 's2'), true, 300);
  PERFORM pg_temp.assert_true(r ->> 'reason' = 'insufficient' AND (r ->> 'available')::numeric = 0, 'and a second is insufficient (the price is never charged into debt)');
  PERFORM pg_temp.invariants('after a spent balance');
END;
$$;
-- Credit writes paused: the unlock raises and changes nothing.
SELECT pg_temp.mkuser(14, 1000);
DO $$
DECLARE u uuid := pg_temp.u(14); s2 uuid := (SELECT id FROM ids WHERE k = 's2'); bal numeric := 1000;
BEGIN
  UPDATE private.credit_epoch SET paused = true;
  PERFORM pg_temp.rejected(format('SELECT public.factcheck_unlock(%L, %L, true, 300)', u, s2), '55000', 'with credit writes paused the unlock raises');
  UPDATE private.credit_epoch SET paused = false;
  PERFORM pg_temp.assert_true(pg_temp.bal(u) = bal AND NOT EXISTS (SELECT FROM public.factcheck_unlocks WHERE user_id = u) AND pg_temp.fcr(u) = 0, 'and nothing changed');
END;
$$;
-- Rate limit: 6 a minute.
SELECT pg_temp.mkuser(7, 100000);
DO $$
DECLARE u uuid := pg_temp.u(7); i integer; ids uuid[] := '{}'; r jsonb;
BEGIN
  FOR i IN 1..8 LOOP ids := ids || pg_temp.direct(pg_temp.u(2), 'VRATE', interval '1 hour' + i * interval '1 minute'); END LOOP;
  FOR i IN 1..6 LOOP
    r := public.factcheck_unlock(u, ids[i], true, 100);
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: unlock % was refused: %', i, r; END IF;
  END LOOP;
  r := public.factcheck_unlock(u, ids[7], true, 100);
  PERFORM pg_temp.assert_true(r = '{"ok": false, "reason": "rate_limited"}'::jsonb AND pg_temp.fcr(u) = 6, 'the 7th unlock in a minute is rate_limited and charges nothing');
  UPDATE private.factcheck_unlock_rate SET minute = minute - interval '1 minute' WHERE user_id = u;
  PERFORM pg_temp.assert_true(public.factcheck_unlock(u, ids[7], true, 100) ->> 'ok' = 'true', 'the next minute starts again');
  INSERT INTO private.factcheck_unlock_rate (user_id, minute, n) VALUES (u, now() - interval '3 hours', 2);
  PERFORM public.factcheck_unlock(u, ids[8], true, 100);
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM private.factcheck_unlock_rate WHERE user_id = u AND minute < now() - interval '1 hour'), 'old rate rows are pruned');
  PERFORM pg_temp.assert_true(public.factcheck_unlock(pg_temp.u(3), (SELECT id FROM ids WHERE k = 's2'), true, 300) ->> 'ok' = 'true', 'another user is not limited');
END;
$$;

-- 8. report -------------------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.mkuser(8, 100);
DO $$
DECLARE
  a uuid := pg_temp.u(1); c3 uuid := pg_temp.u(3); n8 uuid := pg_temp.u(8);
  c_ok uuid := (SELECT id FROM ids WHERE k = 'c_ok'); c_hidden uuid := (SELECT id FROM ids WHERE k = 'c_hidden'); c_private uuid := (SELECT id FROM ids WHERE k = 'c_private');
  c_pending uuid := (SELECT id FROM ids WHERE k = 'c_pending'); r jsonb; own uuid; i integer; v jsonb; st jsonb;
BEGIN
  PERFORM pg_temp.assert_true(public.factcheck_report(n8, c_ok, 'wrong') = '{"ok": false, "reason": "not_found"}'::jsonb, 'a claim of a stretch the user did not unlock is not_found');
  PERFORM pg_temp.assert_true(public.factcheck_report(c3, gen_random_uuid(), '') ->> 'reason' = 'not_found' AND public.factcheck_report(c3, c_hidden, '') ->> 'reason' = 'not_found'
    AND public.factcheck_report(c3, c_private, '') ->> 'reason' = 'not_found' AND public.factcheck_report(c3, c_pending, '') ->> 'reason' = 'not_found',
    'an unknown, a hidden, a private and a pending claim are not_found even for a user who unlocked the stretch');
  PERFORM pg_temp.rejected(format('SELECT public.factcheck_report(%L, %L, %L)', c3, c_ok, repeat('x', 301)), '22023', 'a reason over 300 characters raises');
  r := public.factcheck_report(c3, c_ok, 'This is wrong');
  PERFORM pg_temp.assert_true(r = '{"ok": true}'::jsonb AND (SELECT reason = 'This is wrong' FROM public.factcheck_reports WHERE claim_id = c_ok AND user_id = c3), 'a user who unlocked the stretch can report its claim');
  PERFORM pg_temp.assert_true(public.factcheck_report(c3, c_ok, '') = '{"ok": false, "reason": "already"}'::jsonb, 'a second report of the same claim is already');
  v := public.factcheck_video_view(a, 'VV', true);
  PERFORM pg_temp.assert_true((SELECT e ->> 'reported' FROM jsonb_array_elements(pg_temp.stretch(v, (SELECT id FROM ids WHERE k = 's1')) -> 'claims') e WHERE e ->> 'id' = c_ok::text) = 'true'
    AND (SELECT e ->> 'reported' FROM jsonb_array_elements(pg_temp.stretch(v, (SELECT id FROM ids WHERE k = 's1')) -> 'claims') e WHERE e ->> 'id' = (SELECT id::text FROM ids WHERE k = 'c_chain')) = 'false',
    'a reported verdict is marked reported for everyone, others are not');
  PERFORM pg_temp.assert_true(public.factcheck_report(a, c_ok, '') ->> 'ok' = 'true', 'the owner can report an own claim too');
  PERFORM pg_temp.assert_true(public.factcheck_report(a, c_private, 'own private claim') ->> 'ok' = 'true', 'including one that was never shared');
  -- 10 a day
  FOR i IN 1..12 LOOP own := pg_temp.cl((SELECT id FROM ids WHERE k = 's1'), a, 'checked', false, 'rate ' || i); END LOOP;
  DELETE FROM public.factcheck_reports WHERE user_id = a;
  FOR i IN 1..10 LOOP
    r := public.factcheck_report(a, (SELECT c.id FROM public.factcheck_claims c WHERE c.user_id = a AND c.quote = 'Quote rate ' || i), '');
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: report % was refused: %', i, r; END IF;
  END LOOP;
  r := public.factcheck_report(a, (SELECT c.id FROM public.factcheck_claims c WHERE c.user_id = a AND c.quote = 'Quote rate 11'), '');
  PERFORM pg_temp.assert_true(r = '{"ok": false, "reason": "rate_limited"}'::jsonb, 'the 11th report in a day is rate_limited');
  UPDATE public.factcheck_reports SET created_at = now() - interval '25 hours' WHERE user_id = a;
  PERFORM pg_temp.assert_true(public.factcheck_report(a, (SELECT c.id FROM public.factcheck_claims c WHERE c.user_id = a AND c.quote = 'Quote rate 11'), '') ->> 'ok' = 'true', 'reports older than 24 hours no longer count');
  PERFORM pg_temp.assert_true(public.factcheck_report(c3, c_ok, '') ->> 'reason' = 'already', 'independence: another user''s count is their own');
END;
$$;

-- 9. hide and remove (platform admins only) ------------------------------------------------------------------------------------------
SELECT pg_temp.mkuser(9, 0);
SELECT pg_temp.mkuser(10, 0);
UPDATE public.user_profiles SET role = 'admin', status = 'active' WHERE user_id = pg_temp.u(9);
UPDATE public.user_profiles SET status = 'active' WHERE user_id = pg_temp.u(10);
SELECT pg_temp.assert_true((SELECT role = 'admin' FROM public.user_profiles WHERE user_id = pg_temp.u(9)), 'the fixture''s admin account is an admin');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000ff00a';
SELECT pg_temp.rejected(format('SELECT public.factcheck_claim_hide(%L)', (SELECT id FROM ids WHERE k = 'c_ok')), '42501', 'a signed-in non-admin cannot hide a claim');
SELECT pg_temp.rejected($q$SELECT public.factcheck_video_remove('VV')$q$, '42501', 'nor remove a video');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.rejected($q$SELECT public.factcheck_video_remove('VV')$q$, '42501', 'anon cannot call remove');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000ff009';
SELECT pg_temp.assert_true(public.factcheck_claim_hide((SELECT id FROM ids WHERE k = 'c_ok')) = '{"ok": true}'::jsonb, 'an admin hides a claim');
SELECT pg_temp.assert_true(public.factcheck_claim_hide(gen_random_uuid()) = '{"ok": false, "reason": "not_found"}'::jsonb, 'an unknown claim is not_found');
RESET ROLE;
DO $$
DECLARE c_ok uuid := (SELECT id FROM ids WHERE k = 'c_ok'); s1 uuid := (SELECT id FROM ids WHERE k = 's1'); v jsonb; st jsonb; at1 timestamptz;
BEGIN
  PERFORM pg_temp.assert_true((SELECT hidden_at IS NOT NULL FROM public.factcheck_claims WHERE id = c_ok) AND NOT EXISTS (SELECT FROM public.factcheck_reports WHERE claim_id = c_ok AND handled_at IS NULL)
    AND (SELECT count(*) FROM public.factcheck_reports WHERE claim_id = c_ok AND handled_at IS NOT NULL) >= 1, 'the claim is hidden and its reports are handled');
  v := public.factcheck_video_view(pg_temp.u(3), 'VV', true);
  st := pg_temp.stretch(v, s1);
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM jsonb_array_elements(st -> 'claims') e WHERE e ->> 'id' = c_ok::text) AND (st ->> 'claims_count')::int = 2,
    'a hidden claim is gone from the view and from the count');
  UPDATE public.factcheck_claims SET hidden_at = now() - interval '1 day' WHERE id = c_ok;
  at1 := (SELECT hidden_at FROM public.factcheck_claims WHERE id = c_ok);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff009', true);
  PERFORM public.factcheck_claim_hide(c_ok);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert_true((SELECT hidden_at = at1 FROM public.factcheck_claims WHERE id = c_ok), 'hiding twice changes nothing');
END;
$$;
-- Dismissing reports: "reported" shows only while an unhandled report exists.
CREATE FUNCTION pg_temp.reported(p_viewer uuid, p_claim uuid) RETURNS text LANGUAGE sql AS $$
  SELECT e ->> 'reported' FROM jsonb_array_elements(pg_temp.stretch(public.factcheck_video_view(p_viewer, 'VV', true), (SELECT id FROM ids WHERE k = 's1')) -> 'claims') e
  WHERE e ->> 'id' = p_claim::text;
$$;
DO $$
DECLARE c_chain uuid := (SELECT id FROM ids WHERE k = 'c_chain'); a uuid := pg_temp.u(1); c3 uuid := pg_temp.u(3); r jsonb;
BEGIN
  PERFORM public.factcheck_report(c3, c_chain, 'dubious');
  PERFORM pg_temp.assert_true(pg_temp.reported(a, c_chain) = 'true', 'a claim with an unhandled report is reported');
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff00a', true);
  PERFORM pg_temp.rejected(format('SELECT public.factcheck_report_dismiss(%L)', c_chain), '42501', 'a signed-in non-admin cannot dismiss reports');
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000ff009', true);
  r := public.factcheck_report_dismiss(c_chain);
  PERFORM pg_temp.assert_true(public.factcheck_report_dismiss(gen_random_uuid()) = '{"ok": false, "reason": "not_found"}'::jsonb, 'an unknown claim is not_found');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert_true(r = '{"ok": true}'::jsonb AND pg_temp.reported(a, c_chain) = 'false'
    AND NOT EXISTS (SELECT FROM public.factcheck_reports WHERE claim_id = c_chain AND handled_at IS NULL)
    AND (SELECT hidden_at IS NULL FROM public.factcheck_claims WHERE id = c_chain), 'an admin dismisses the reports: no longer reported, the claim stays visible');
  PERFORM public.factcheck_report(a, c_chain, 'again');
  PERFORM pg_temp.assert_true(pg_temp.reported(c3, c_chain) = 'true', 'a new report from someone else makes it reported again');
END;
$$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000ff009';
CREATE TEMP TABLE removed (n integer, again integer);
GRANT ALL ON removed TO authenticated;
INSERT INTO removed SELECT (public.factcheck_video_remove('VV') ->> 'pieces_deleted')::int, 0;
UPDATE removed SET again = (public.factcheck_video_remove('VV') ->> 'pieces_deleted')::int;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT n = 14 AND again = 0 FROM removed), 'an admin removes a video: its 14 stored pieces go (3 + 9 + 2), and a second call finds none');
DO $$
DECLARE v jsonb; s1 uuid := (SELECT id FROM ids WHERE k = 's1');
BEGIN
  v := public.factcheck_video_view(pg_temp.u(3), 'VV', true);
  PERFORM pg_temp.assert_true(jsonb_array_length(v -> 'stretches') = 0 AND NOT EXISTS (SELECT FROM public.factcheck_sessions WHERE video_id = 'VV' AND shareable)
    AND NOT EXISTS (SELECT FROM private.factcheck_pieces WHERE video_id = 'VV'), 'after a removal the video lists nothing and no session of it is shareable');
  PERFORM pg_temp.assert_true(public.factcheck_unlock(pg_temp.u(3), s1, true, 100) ->> 'reason' = 'not_found' AND public.factcheck_unlock(pg_temp.u(12), s1, true, 100) ->> 'reason' = 'not_found',
    'and a removed stretch cannot be unlocked');
  PERFORM pg_temp.assert_true(EXISTS (SELECT FROM public.factcheck_sessions WHERE video_id = 'VV'), 'the sessions themselves are kept');
END;
$$;

-- 10. Row-level security, cascade ----------------------------------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000ff003';
SELECT pg_temp.assert_true((SELECT count(*) FROM public.factcheck_unlocks) >= 1 AND NOT EXISTS (SELECT FROM public.factcheck_unlocks WHERE user_id <> auth.uid())
  AND NOT EXISTS (SELECT FROM public.factcheck_reports WHERE user_id <> auth.uid()), 'a user reads only their own unlocks and reports');
SELECT pg_temp.rejected($q$INSERT INTO public.factcheck_unlocks (user_id, session_id, video_id, credits_charged) SELECT auth.uid(), id, 'v', 1 FROM public.factcheck_sessions LIMIT 1$q$, '42501', 'a user cannot insert an unlock (a free one)');
SELECT pg_temp.rejected($q$UPDATE public.factcheck_unlocks SET credits_charged = 1$q$, '42501', 'nor change one');
SELECT pg_temp.rejected($q$DELETE FROM public.factcheck_reports$q$, '42501', 'nor delete a report');
SELECT pg_temp.rejected($q$SELECT * FROM private.factcheck_pieces$q$, '42501', 'nor read the stored pieces');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.rejected($q$INSERT INTO public.factcheck_unlocks (user_id, session_id, video_id, credits_charged) SELECT user_id, id, 'v', 1 FROM public.factcheck_sessions LIMIT 1$q$, '42501', 'service_role cannot write an unlock directly');
SELECT pg_temp.rejected($q$SELECT * FROM private.factcheck_pieces$q$, '42501', 'nor read the stored pieces');
RESET ROLE;
SELECT pg_temp.mkuser(11, 500);
DO $$
DECLARE u uuid := pg_temp.u(11); sid uuid := pg_temp.run(pg_temp.u(11), 'VD', 2); other uuid; c uuid;
BEGIN
  other := pg_temp.run(pg_temp.u(2), 'VD', 2);
  PERFORM public.factcheck_unlock(u, other, true, 100);
  c := pg_temp.cl(other, pg_temp.u(2), 'checked', true, 'del');
  PERFORM public.factcheck_report(u, c, 'x');
  PERFORM pg_temp.assert_true(EXISTS (SELECT FROM public.factcheck_unlocks WHERE user_id = u) AND EXISTS (SELECT FROM public.factcheck_reports WHERE user_id = u)
    AND EXISTS (SELECT FROM private.factcheck_pieces WHERE session_id = sid), 'the user has a stretch, an unlock and a report');
  DELETE FROM auth.users WHERE id = u;
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_unlocks WHERE user_id = u) AND NOT EXISTS (SELECT FROM public.factcheck_reports WHERE user_id = u)
    AND NOT EXISTS (SELECT FROM private.factcheck_pieces WHERE session_id = sid) AND NOT EXISTS (SELECT FROM private.factcheck_unlock_keys k WHERE NOT EXISTS (SELECT FROM public.factcheck_unlocks x WHERE x.id = k.unlock_id)),
    'deleting the account removes its unlocks, reports, pieces and private keys');
  DELETE FROM public.factcheck_sessions WHERE id = other;
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM private.factcheck_pieces WHERE session_id = other), 'deleting a session removes its pieces');
END;
$$;

-- When the runner's account (or just the session) disappears, the payer's unlock goes with it: a deliberate choice, documented in the
-- migration header. The pieces and the private key go too; the payer's charge stays in their ledger and their balance is not refunded.
SELECT pg_temp.mkuser(16, 100);
SELECT pg_temp.mkuser(17, 500);
DO $$
DECLARE runner uuid := pg_temp.u(16); payer uuid := pg_temp.u(17); s uuid; s2 uuid; c uuid; bal numeric; led bigint;
BEGIN
  s := pg_temp.run(runner, 'VGONE', 2);
  s2 := pg_temp.run(runner, 'VGONE2', 2);
  c := pg_temp.cl(s, runner, 'checked', true, 'gone');
  PERFORM pg_temp.assert_true(public.factcheck_unlock(payer, s, true, 100) ->> 'ok' = 'true' AND public.factcheck_unlock(payer, s2, true, 100) ->> 'ok' = 'true'
    AND public.factcheck_report(payer, c, 'x') ->> 'ok' = 'true', 'the payer unlocked two stretches of the runner and reported a claim');
  bal := pg_temp.bal(payer);
  -- the session alone
  DELETE FROM public.factcheck_sessions WHERE id = s2;
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_unlocks WHERE session_id = s2) AND NOT EXISTS (SELECT FROM private.factcheck_pieces WHERE session_id = s2)
    AND NOT EXISTS (SELECT FROM private.factcheck_unlock_keys k WHERE NOT EXISTS (SELECT FROM public.factcheck_unlocks x WHERE x.id = k.unlock_id)),
    'a deleted session takes its pieces and the payers'' unlocks with it');
  -- the runner's account
  SELECT count(*) INTO led FROM public.credit_ledger WHERE user_id = payer AND turn_key LIKE 'fcu:%';
  DELETE FROM auth.users WHERE id = runner;
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_sessions WHERE user_id = runner) AND NOT EXISTS (SELECT FROM private.factcheck_pieces WHERE session_id = s)
    AND NOT EXISTS (SELECT FROM public.factcheck_unlocks WHERE user_id = payer) AND NOT EXISTS (SELECT FROM public.factcheck_reports WHERE user_id = payer)
    AND NOT EXISTS (SELECT FROM private.factcheck_unlock_keys k WHERE NOT EXISTS (SELECT FROM public.factcheck_unlocks x WHERE x.id = k.unlock_id)),
    'deleting the runner''s account removes their sessions, pieces and the payers'' unlocks and reports on them; no unlock is left pointing at nothing');
  PERFORM pg_temp.assert_true(pg_temp.bal(payer) = bal AND (SELECT count(*) FROM public.credit_ledger WHERE user_id = payer AND turn_key LIKE 'fcu:%') = led AND led = 2,
    'the payer''s charges stay in their ledger and nothing is refunded');
  PERFORM pg_temp.invariants('after the runner is deleted');
END;
$$;

SELECT pg_temp.invariants('at the end');
ROLLBACK;
