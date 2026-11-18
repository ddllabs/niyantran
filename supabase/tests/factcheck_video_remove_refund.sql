-- Removing a video's shared results refunds the unlocks (migration 20261122090000; open-work F364). PostgreSQL assertions, no pgTAP.
-- Run only in a disposable database, through run.sh, which applies the migration as a non-superuser (nter_migrator).
-- Bootstrap: the factcheck_reports_admin chain (everything through the reports-admin migration), then
-- 20261122090000_factcheck_video_remove_refund.sql as a non-superuser. The vacuity check drops the last: the column is missing
-- and the first assertion fails. Two removals racing, the second application of the migration and its drift guard cannot be
-- shown in one transaction: factcheck_video_remove_refund_concurrency.sh does those.
-- Time: now() is fixed for the whole transaction, so ages are moved by updating rows.
--
-- Users (00000000-0000-4000-8000-0000000ff0NN): 01 and 02 run stretches, 03 and 04 pay for stretches of video VX, 05 pays for a
-- stretch of video VY (the user the removal must leave alone), 06 pays and then falls into debt, 07 pays for a stretch added
-- after the removal, 08 has an unlock row without a charge, 09 administrator, 10 non-administrator.
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
  SELECT pg_temp.remove_as('authenticated', pg_temp.u(9), p_video);
$$;
-- What the user's own usage screens show (the summary's end is moved past the transaction's frozen now()).
CREATE FUNCTION pg_temp.usage_of(p_sub uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_sub::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v := jsonb_build_object('summary', public.my_usage_summary(NULL, now() + interval '1 hour'), 'activity', public.my_usage_activity(0, 100, false, NULL, 'all', 'all'),
                          'credits', public.my_credits());
  EXECUTE 'RESET ROLE';
  RETURN v;
END;
$$;
CREATE FUNCTION pg_temp.refund_rows(p_user uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.credit_ledger WHERE user_id = p_user AND kind = 'adjustment' AND note = 'live tv fact-check unlock refund';
$$;
CREATE FUNCTION pg_temp.ledger_rows(p_user uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.credit_ledger WHERE user_id = p_user;
$$;
CREATE TEMP TABLE ids (k text PRIMARY KEY, id uuid);
CREATE TEMP TABLE snap (k text PRIMARY KEY, n numeric, j jsonb);

-- 0. The change itself (the first assertion fails while the migration is missing) -------------------------------------------------
SELECT pg_temp.assert_true((SELECT data_type = 'timestamp with time zone' AND is_nullable = 'YES' AND column_default IS NULL
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'factcheck_unlocks' AND column_name = 'refunded_at'),
  'factcheck_unlocks.refunded_at exists: timestamptz, nullable, no default');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.factcheck_video_remove(text)') AND p.prosecdef AND p.prorettype = 'jsonb'::regtype
      AND p.proconfig @> ARRAY['search_path=""'] AND p.proconfig @> ARRAY['TimeZone=UTC']),
  'factcheck_video_remove keeps its signature, SECURITY DEFINER, search_path and TimeZone');
SELECT pg_temp.assert_true((SELECT p.proconfig @> ARRAY['lock_timeout=10s'] FROM pg_proc p WHERE p.oid = to_regprocedure('public.factcheck_video_remove(text)')),
  'the function bounds its own lock waits at 10 s');
SELECT pg_temp.assert_true(has_function_privilege('authenticated', 'public.factcheck_video_remove(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.factcheck_video_remove(text)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.factcheck_video_remove(text)', 'EXECUTE')
    AND NOT has_function_privilege('public', 'public.factcheck_video_remove(text)', 'EXECUTE'),
  'only authenticated may execute it (checked inside), as before');
SELECT pg_temp.assert_true((SELECT md5(prosrc) = 'c0c4b68359304c0fee94dac89047da6d' FROM pg_proc WHERE oid = to_regprocedure('public.factcheck_video_remove(text)')),
  'the function source is the one whose md5 the migration''s guard accepts');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_unlocks WHERE refunded_at IS NOT NULL), 'no unlock starts out refunded');

-- 1. Set-up: a video VX with two stretches (100 and 200 credits), a video VY with one (100) ----------------------------------
SELECT pg_temp.on();
SELECT pg_temp.mkuser(1, 500);
SELECT pg_temp.mkuser(2, 500);
SELECT pg_temp.mkuser(3, 1000);
SELECT pg_temp.mkuser(4, 500);
SELECT pg_temp.mkuser(5, 500);
SELECT pg_temp.mkuser(6, 200);
SELECT pg_temp.mkuser(7, 300);
SELECT pg_temp.mkuser(8, 300);
SELECT pg_temp.mkuser(9, 0);
SELECT pg_temp.mkuser(10, 0);
UPDATE public.user_profiles SET role = 'admin', status = 'active' WHERE user_id = pg_temp.u(9);
UPDATE public.user_profiles SET status = 'active' WHERE user_id = pg_temp.u(10);
DO $$
DECLARE sa uuid := pg_temp.run(pg_temp.u(1), 'VX', 3); sb uuid := pg_temp.run(pg_temp.u(2), 'VX', 9); sc uuid := pg_temp.run(pg_temp.u(1), 'VY', 3);
BEGIN
  INSERT INTO ids VALUES ('sa', sa), ('sb', sb), ('sc', sc);
  PERFORM pg_temp.assert_true(private.factcheck_stretch_minutes(sa) = 1 AND private.factcheck_stretch_minutes(sb) = 2 AND private.factcheck_stretch_minutes(sc) = 1,
    'the stretches are 1, 2 and 1 minutes (100, 200 and 100 credits at 100 a minute)');
END;
$$;
SELECT pg_temp.invariants('before any unlock');
DO $$
DECLARE sa uuid := (SELECT id FROM ids WHERE k = 'sa'); sb uuid := (SELECT id FROM ids WHERE k = 'sb'); sc uuid := (SELECT id FROM ids WHERE k = 'sc'); r jsonb;
BEGIN
  PERFORM pg_temp.assert_true(public.factcheck_unlock(pg_temp.u(3), sa, true, 100) ->> 'credits_charged' = '100.0000'
    AND public.factcheck_unlock(pg_temp.u(3), sb, true, 200) ->> 'credits_charged' = '200.0000', 'user 3 pays 100 and 200 for the two stretches of VX');
  PERFORM pg_temp.assert_true(public.factcheck_unlock(pg_temp.u(4), sb, true, 200) ->> 'credits_charged' = '200.0000', 'user 4 pays 200 for the second stretch');
  PERFORM pg_temp.assert_true(public.factcheck_unlock(pg_temp.u(5), sc, true, 100) ->> 'credits_charged' = '100.0000', 'user 5 pays 100 for the stretch of VY');
  PERFORM pg_temp.assert_true(public.factcheck_unlock(pg_temp.u(6), sb, true, 200) ->> 'credits_charged' = '200.0000' AND pg_temp.bal(pg_temp.u(6)) = 0, 'user 6 pays 200, all they had');
  -- The owner's own reading of their own stretch is not an unlock: nothing is charged or written.
  r := public.factcheck_unlock(pg_temp.u(1), sa, true, 100);
  PERFORM pg_temp.assert_true(r = '{"ok": false, "reason": "own"}'::jsonb AND NOT EXISTS (SELECT FROM public.factcheck_unlocks WHERE user_id = pg_temp.u(1)),
    'a runner unlocking their own stretch writes no unlock row (so there is nothing to refund)');
END;
$$;
-- A free unlock cannot exist either.
SELECT pg_temp.rejected($q$INSERT INTO public.factcheck_unlocks (user_id, session_id, video_id, credits_charged) SELECT pg_temp.u(7), id, 'VX', 0 FROM ids WHERE k = 'sa'$q$,
  '23514', 'an unlock that cost 0 cannot be stored (CHECK credits_charged > 0)');
-- User 6 spends what the refund will find missing: a charge of 50 with no credit left becomes debt.
DO $$
DECLARE u uuid := pg_temp.u(6); l uuid;
BEGIN
  l := private.credit_entry(u, 'charge', -50, NULL, 'fx:debt', NULL, 95, 0.10, NULL, 'live tv fact-check');
  PERFORM private.credit_draw(u, 50, l, 'charge', now());
  PERFORM pg_temp.assert_true((SELECT balance = -50 AND debt = 50 FROM public.credit_wallets WHERE user_id = u), 'user 6 is in debt: balance -50, debt 50');
END;
$$;
-- The refund is what was charged, not what the unlock row says: tamper with the row of user 4 (as the owner of the table).
UPDATE public.factcheck_unlocks SET credits_charged = 9999 WHERE user_id = pg_temp.u(4);
-- Rows that are not charges: a stored unlock of user 8 with no private key and no ledger entry, and one for the runner of the stretch.
INSERT INTO public.factcheck_unlocks (user_id, session_id, video_id, credits_charged)
SELECT pg_temp.u(8), id, 'VX', 50 FROM ids WHERE k = 'sa';
INSERT INTO public.factcheck_unlocks (user_id, session_id, video_id, credits_charged)
SELECT pg_temp.u(1), id, 'VX', 50 FROM ids WHERE k = 'sb';
SELECT pg_temp.invariants('after the unlocks');
INSERT INTO snap SELECT 'bal' || n, pg_temp.bal(pg_temp.u(n)), NULL FROM generate_series(1, 10) n;
INSERT INTO snap SELECT 'led' || n, pg_temp.ledger_rows(pg_temp.u(n)), NULL FROM generate_series(1, 10) n;
INSERT INTO snap VALUES ('pieces', (SELECT count(*) FROM private.factcheck_pieces WHERE video_id = 'VX'), NULL),
                        ('pieces_y', (SELECT count(*) FROM private.factcheck_pieces WHERE video_id = 'VY'), NULL);
INSERT INTO snap SELECT 'usage3', NULL, pg_temp.usage_of(pg_temp.u(3));
INSERT INTO snap SELECT 'usage5', NULL, pg_temp.usage_of(pg_temp.u(5));
SELECT pg_temp.assert_true((SELECT n = 12 FROM snap WHERE k = 'pieces'), 'VX has 12 stored pieces (3 + 9)');

-- 2. Someone who is not an administrator is refused, and nothing is refunded -------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.rejected($q$SELECT pg_temp.remove_as('authenticated', pg_temp.u(10), 'VX')$q$, '42501', 'a signed-in non-administrator cannot remove a video');
  PERFORM pg_temp.rejected($q$SELECT pg_temp.remove_as('authenticated', NULL, 'VX')$q$, '42501', 'a signed-in caller with no user cannot');
  PERFORM pg_temp.rejected($q$SELECT pg_temp.remove_as('anon', NULL, 'VX')$q$, '42501', 'anon cannot');
  PERFORM pg_temp.rejected($q$SELECT pg_temp.remove_as('service_role', pg_temp.u(9), 'VX')$q$, '42501', 'nor can service_role, even naming the administrator');
END;
$$;
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_unlocks WHERE refunded_at IS NOT NULL)
    AND NOT EXISTS (SELECT FROM public.credit_ledger WHERE note = 'live tv fact-check unlock refund')
    AND (SELECT count(*) = 10 AND bool_and(pg_temp.bal(pg_temp.u(substr(k, 4)::int)) = n) FROM snap WHERE k LIKE 'bal%')
    AND (SELECT count(*) FROM private.factcheck_pieces WHERE video_id = 'VX') = 12
    AND (SELECT count(*) FROM public.factcheck_sessions WHERE video_id = 'VX' AND shareable) = 2,
  'after the refusals nothing was refunded, no balance moved and nothing was removed');

-- 3. An administrator removes VX ---------------------------------------------------------------------------------------------------
CREATE TEMP TABLE res (j jsonb);
INSERT INTO res SELECT pg_temp.admin_remove('VX');
SELECT pg_temp.assert_true((SELECT j ->> 'ok' = 'true' AND (j ->> 'pieces_deleted')::int = 12 AND (j ->> 'sessions')::int = 2
      AND (j ->> 'unlocks_refunded')::int = 4 AND (j ->> 'credits_refunded')::numeric = 700
      AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(j) k) = ARRAY['credits_refunded', 'ok', 'pieces_deleted', 'sessions', 'unlocks_refunded']
    FROM res),
  'the result keeps ok, pieces_deleted and sessions and gains unlocks_refunded 4 and credits_refunded 700 (the two rows with no charge behind them are not counted)');
SELECT pg_temp.assert_true(jsonb_typeof((SELECT j -> 'unlocks_refunded' FROM res)) = 'number' AND jsonb_typeof((SELECT j -> 'credits_refunded' FROM res)) = 'number',
  'both counts are JSON numbers');
SELECT pg_temp.assert_true(pg_temp.bal(pg_temp.u(3)) = (SELECT n FROM snap WHERE k = 'bal3') + 300
    AND pg_temp.bal(pg_temp.u(4)) = (SELECT n FROM snap WHERE k = 'bal4') + 200
    AND pg_temp.bal(pg_temp.u(6)) = (SELECT n FROM snap WHERE k = 'bal6') + 200,
  'users 3, 4 and 6 are credited exactly what they paid (300, 200, 200), user 4 not the 9999 written on the row');
SELECT pg_temp.assert_true(pg_temp.bal(pg_temp.u(5)) = (SELECT n FROM snap WHERE k = 'bal5') AND pg_temp.ledger_rows(pg_temp.u(5)) = (SELECT n FROM snap WHERE k = 'led5')
    AND pg_temp.bal(pg_temp.u(1)) = (SELECT n FROM snap WHERE k = 'bal1') AND pg_temp.ledger_rows(pg_temp.u(1)) = (SELECT n FROM snap WHERE k = 'led1')
    AND pg_temp.bal(pg_temp.u(2)) = (SELECT n FROM snap WHERE k = 'bal2') AND pg_temp.ledger_rows(pg_temp.u(2)) = (SELECT n FROM snap WHERE k = 'led2')
    AND pg_temp.bal(pg_temp.u(7)) = (SELECT n FROM snap WHERE k = 'bal7') AND pg_temp.bal(pg_temp.u(8)) = (SELECT n FROM snap WHERE k = 'bal8')
    AND pg_temp.ledger_rows(pg_temp.u(8)) = (SELECT n FROM snap WHERE k = 'led8'),
  'the user who paid for VY (5), the runners (1, 2) and users with no charge for VX (7, 8) are untouched: balance and ledger');
SELECT pg_temp.assert_true((SELECT (j ->> 'credits_refunded')::numeric = (SELECT sum(credits) FROM public.credit_ledger WHERE note = 'live tv fact-check unlock refund') FROM res)
    AND pg_temp.refund_rows(pg_temp.u(3)) = 2 AND pg_temp.refund_rows(pg_temp.u(4)) = 1 AND pg_temp.refund_rows(pg_temp.u(6)) = 1
    AND (SELECT count(*) FROM public.credit_ledger WHERE note = 'live tv fact-check unlock refund') = 4,
  'one ledger entry per refunded unlock: two for user 3, one each for 4 and 6, summing to the result');
SELECT pg_temp.assert_true(NOT EXISTS (
      SELECT FROM public.factcheck_unlocks x JOIN private.factcheck_unlock_keys k ON k.unlock_id = x.id
      JOIN public.credit_ledger ch ON ch.user_id = x.user_id AND ch.kind = 'charge' AND ch.turn_key = k.turn_key
      WHERE x.video_id = 'VX' AND NOT EXISTS (SELECT FROM public.credit_ledger r WHERE r.request_id = x.id AND r.user_id = x.user_id AND r.kind = 'adjustment'
        AND r.credits = -ch.credits AND r.created_by = pg_temp.u(9) AND r.turn_key IS NULL AND r.lot_id IS NOT NULL))
    AND (SELECT count(*) = 4 FROM public.credit_lots WHERE kind = 'adjustment' AND source_key LIKE 'fcu-refund:%')
    AND (SELECT count(*) = 4 FROM public.credit_lots WHERE kind = 'adjustment' AND source_key LIKE 'fcu-refund:%' AND expires_at > now() + interval '11 months'),
  'each refund is a positive entry for the charge''s own credits, tied to its unlock (request id), made by the administrator, in a 12-month lot');
SELECT pg_temp.assert_true((SELECT count(*) = 4 FROM public.factcheck_unlocks WHERE video_id = 'VX' AND refunded_at IS NOT NULL)
    AND (SELECT count(*) = 2 FROM public.factcheck_unlocks WHERE video_id = 'VX' AND refunded_at IS NULL)
    AND (SELECT count(*) = 1 FROM public.factcheck_unlocks WHERE video_id = 'VY' AND refunded_at IS NULL)
    AND (SELECT count(*) FROM public.factcheck_unlocks WHERE video_id = 'VX') = 6,
  'the four paid unlocks of VX are marked refunded and kept; the two rows without a charge are not marked; VY''s is untouched');
SELECT pg_temp.assert_true((SELECT balance = 150 AND debt = 0 FROM public.credit_wallets WHERE user_id = pg_temp.u(6))
    AND (SELECT remaining = 150 FROM public.credit_lots WHERE user_id = pg_temp.u(6) AND kind = 'adjustment'),
  'user 6''s refund first paid their debt: balance -50 + 200 = 150, debt 0, the lot holds what is left (150)');
SELECT pg_temp.invariants('after the removal');
SELECT pg_temp.assert_true((SELECT count(*) FROM private.factcheck_pieces WHERE video_id = 'VX') = 0 AND NOT EXISTS (SELECT FROM public.factcheck_sessions WHERE video_id = 'VX' AND shareable)
    AND (SELECT count(*) FROM private.factcheck_pieces WHERE video_id = 'VY') = (SELECT n FROM snap WHERE k = 'pieces_y')
    AND (SELECT count(*) FROM public.factcheck_sessions WHERE video_id = 'VY' AND shareable) = 1,
  'the removal itself is as before: VX''s pieces are gone and its sessions are not shareable; VY is untouched');

-- 4. After the removal the unlocks grant nothing ----------------------------------------------------------------------------------
DO $$
DECLARE sa uuid := (SELECT id FROM ids WHERE k = 'sa'); sb uuid := (SELECT id FROM ids WHERE k = 'sb'); sc uuid := (SELECT id FROM ids WHERE k = 'sc'); v jsonb;
BEGIN
  PERFORM pg_temp.assert_true(jsonb_array_length(public.factcheck_video_view(pg_temp.u(3), 'VX', true) -> 'stretches') = 0
    AND jsonb_array_length(public.factcheck_video_view(pg_temp.u(4), 'VX', true) -> 'stretches') = 0, 'the payers of VX no longer see the video''s stretches');
  PERFORM pg_temp.assert_true(public.factcheck_unlock(pg_temp.u(3), sa, true, 100) ->> 'reason' = 'not_found' AND public.factcheck_unlock(pg_temp.u(4), sb, true, 200) ->> 'reason' = 'not_found',
    'and cannot unlock the removed stretches again (so no second charge for the same thing)');
  v := pg_temp.stretch(public.factcheck_video_view(pg_temp.u(5), 'VY', true), sc);
  PERFORM pg_temp.assert_true(v ->> 'access' = 'unlocked' AND jsonb_array_length(v -> 'lines') = 3, 'the payer of VY still has their unlocked stretch, with its lines');
END;
$$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000ff003';
SELECT pg_temp.assert_true((SELECT count(*) = 2 AND count(refunded_at) = 2 FROM public.factcheck_unlocks), 'user 3 reads their own two unlock rows, now showing when they were refunded');
RESET ROLE;

-- 5. Calling it again refunds nothing ----------------------------------------------------------------------------------------------------
DELETE FROM snap WHERE k LIKE 'after%';
INSERT INTO snap SELECT 'after_bal' || n, pg_temp.bal(pg_temp.u(n)), NULL FROM generate_series(1, 10) n;
INSERT INTO snap SELECT 'after_led' || n, pg_temp.ledger_rows(pg_temp.u(n)), NULL FROM generate_series(1, 10) n;
DELETE FROM res;
INSERT INTO res SELECT pg_temp.admin_remove('VX');
SELECT pg_temp.assert_true((SELECT j = '{"ok": true, "sessions": 0, "pieces_deleted": 0, "unlocks_refunded": 0, "credits_refunded": 0}'::jsonb FROM res), 'a second removal refunds nothing and deletes nothing');
SELECT pg_temp.assert_true((SELECT bool_and(pg_temp.bal(pg_temp.u(substr(k, 10)::int)) = n) FROM snap WHERE k LIKE 'after_bal%')
    AND (SELECT bool_and(pg_temp.ledger_rows(pg_temp.u(substr(k, 10)::int)) = n) FROM snap WHERE k LIKE 'after_led%')
    AND (SELECT count(*) FROM public.credit_ledger WHERE note = 'live tv fact-check unlock refund') = 4, 'no balance and no ledger changed');
-- Defence in depth: even if the marker were lost, the refund's source key and request id stop a second refund of the same unlock.
UPDATE public.factcheck_unlocks SET refunded_at = NULL WHERE user_id = pg_temp.u(3);
DELETE FROM res;
INSERT INTO res SELECT pg_temp.admin_remove('VX');
SELECT pg_temp.assert_true((SELECT (j ->> 'unlocks_refunded')::int = 0 AND (j ->> 'credits_refunded')::numeric = 0 FROM res)
    AND pg_temp.bal(pg_temp.u(3)) = (SELECT n FROM snap WHERE k = 'after_bal3') AND pg_temp.refund_rows(pg_temp.u(3)) = 2
    AND (SELECT count(refunded_at) = 2 FROM public.factcheck_unlocks WHERE user_id = pg_temp.u(3)),
  'with the marker wiped by hand, the second refund of the same unlocks is still refused by the lot''s source key: balance and ledger the same, marker restored');

-- 6. An unlock that arrives after a removal is refunded by the next one, and only that one ------------------------------------------
DO $$
DECLARE s uuid := pg_temp.run(pg_temp.u(2), 'VX', 3); r jsonb;
BEGIN
  INSERT INTO ids VALUES ('late', s);
  PERFORM pg_temp.assert_true(public.factcheck_unlock(pg_temp.u(7), s, true, 100) ->> 'credits_charged' = '100.0000' AND pg_temp.bal(pg_temp.u(7)) = 200,
    'user 7 pays 100 for a stretch of VX added after the removal');
  r := pg_temp.admin_remove('VX');
  PERFORM pg_temp.assert_true((r ->> 'unlocks_refunded')::int = 1 AND (r ->> 'credits_refunded')::numeric = 100 AND (r ->> 'pieces_deleted')::int = 3 AND (r ->> 'sessions')::int = 1
    AND pg_temp.bal(pg_temp.u(7)) = 300 AND pg_temp.refund_rows(pg_temp.u(7)) = 1
    AND pg_temp.bal(pg_temp.u(3)) = (SELECT n FROM snap WHERE k = 'after_bal3') AND pg_temp.bal(pg_temp.u(4)) = (SELECT n FROM snap WHERE k = 'after_bal4')
    AND pg_temp.bal(pg_temp.u(6)) = (SELECT n FROM snap WHERE k = 'after_bal6') AND pg_temp.bal(pg_temp.u(5)) = (SELECT n FROM snap WHERE k = 'bal5'),
    'the next removal refunds that one unlock only; everyone refunded earlier is left as they were');
END;
$$;
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.factcheck_unlocks WHERE user_id IN (pg_temp.u(8), pg_temp.u(1)) AND refunded_at IS NOT NULL)
    AND pg_temp.ledger_rows(pg_temp.u(8)) = (SELECT n FROM snap WHERE k = 'led8')
    AND (SELECT count(*) FROM public.credit_ledger WHERE note = 'live tv fact-check unlock refund') = 5,
  'rows with no charge behind them (user 8, and the runner) are never refunded, however often the video is removed');

-- 7. What the user''s usage screens show -----------------------------------------------------------------------------------------------
DO $$
DECLARE b jsonb := (SELECT j FROM snap WHERE k = 'usage3'); a jsonb := pg_temp.usage_of(pg_temp.u(3));
  bf jsonb; af jsonb;
BEGIN
  bf := (SELECT e FROM jsonb_array_elements(b -> 'summary' -> 'by_feature') e WHERE e ->> 'feature' = 'factcheck');
  af := (SELECT e FROM jsonb_array_elements(a -> 'summary' -> 'by_feature') e WHERE e ->> 'feature' = 'factcheck');
  PERFORM pg_temp.assert_true(bf IS NOT NULL AND (bf ->> 'credits')::numeric = 300 AND (bf ->> 'calls')::int = 2, 'before: user 3''s summary shows two fact-check charges, 300 credits');
  PERFORM pg_temp.assert_true(af = bf AND a -> 'summary' -> 'credits' = b -> 'summary' -> 'credits' AND a -> 'summary' -> 'lifetime_credits' = b -> 'summary' -> 'lifetime_credits'
    AND a -> 'credits' -> 'used_this_cycle' = b -> 'credits' -> 'used_this_cycle',
    'after the refund the summary and used_this_cycle are as before: the charges stay in the record of use and the refund is not counted in it');
  PERFORM pg_temp.assert_true(a -> 'activity' = b -> 'activity' AND jsonb_array_length(a -> 'activity' -> 'rows') = 2
    AND NOT EXISTS (SELECT FROM jsonb_array_elements(a -> 'activity' -> 'rows') e WHERE (e ->> 'credits')::numeric <= 0),
    'the activity list is the same two charges, with no refund row and no negative amount');
  PERFORM pg_temp.assert_true((a -> 'credits' ->> 'balance')::numeric = (b -> 'credits' ->> 'balance')::numeric + 300
    AND (SELECT sum((e ->> 'remaining')::numeric) FROM jsonb_array_elements(a -> 'credits' -> 'lots') e WHERE e ->> 'kind' = 'adjustment') = 300
    AND NOT EXISTS (SELECT FROM jsonb_array_elements(b -> 'credits' -> 'lots') e WHERE e ->> 'kind' = 'adjustment'),
    'the refund shows in the balance (+300) and as lots of kind adjustment holding 300; it was not there before');
  PERFORM pg_temp.assert_true(pg_temp.usage_of(pg_temp.u(5)) = (SELECT j FROM snap WHERE k = 'usage5'), 'the other video''s payer sees exactly what they saw before');
END;
$$;
-- 8. Who is refused, told apart; and a credit-write pause ---------------------------------------------------------------------------
-- The state and the message of what the call raises, 'accepted' when it raises nothing. The role set inside is undone by the failure.
CREATE FUNCTION pg_temp.remove_err(p_role text, p_sub uuid, p_video text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.remove_as(p_role, p_sub, p_video);
  RETURN 'accepted';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ': ' || SQLERRM;
END;
$$;
CREATE FUNCTION pg_temp.vp_state() RETURNS text LANGUAGE sql AS $$
  SELECT (SELECT count(*) FROM private.factcheck_pieces WHERE video_id = 'VP') || '/'
      || (SELECT count(*) FROM public.factcheck_sessions WHERE video_id = 'VP' AND shareable) || '/'
      || (SELECT count(*) FROM public.factcheck_unlocks WHERE video_id = 'VP' AND refunded_at IS NOT NULL) || '/'
      || pg_temp.bal(pg_temp.u(7)) || '/' || pg_temp.refund_rows(pg_temp.u(7)) || '/' || pg_temp.ledger_rows(pg_temp.u(7));
$$;
SELECT pg_temp.mkuser(11, 0);
UPDATE public.user_profiles SET role = 'admin', status = 'suspended' WHERE user_id = pg_temp.u(11);
DO $$
DECLARE s uuid := pg_temp.run(pg_temp.u(2), 'VP', 3); before text; r text;
BEGIN
  INSERT INTO ids VALUES ('sp', s);
  PERFORM pg_temp.assert_true(public.factcheck_unlock(pg_temp.u(7), s, true, 100) ->> 'ok' = 'true', 'user 7 pays 100 for a stretch of VP');
  before := pg_temp.vp_state();
  PERFORM pg_temp.assert_true(before = '3/1/0/200.0000/1/' || pg_temp.ledger_rows(pg_temp.u(7)), 'VP: 3 pieces, 1 shareable session, nothing refunded, user 7 at 200');
  -- Three different refusals, told apart by what the call says.
  r := pg_temp.remove_err('authenticated', pg_temp.u(10), 'VP');
  PERFORM pg_temp.assert_true(r = '42501: Platform administrators only', 'a signed-in non-administrator is refused by the function body (' || r || ')');
  r := pg_temp.remove_err('authenticated', pg_temp.u(11), 'VP');
  PERFORM pg_temp.assert_true(r = '42501: Platform administrators only', 'a suspended administrator is refused by the function body too (' || r || ')');
  r := pg_temp.remove_err('anon', NULL, 'VP');
  PERFORM pg_temp.assert_true(r LIKE '42501: permission denied for function factcheck_video_remove%', 'anon is refused by the missing EXECUTE grant, not the body (' || r || ')');
  PERFORM pg_temp.assert_true(pg_temp.vp_state() = before, 'after the three refusals nothing changed: pieces, shareable sessions, markers, balance, refund entries, ledger');
  -- Credit writes paused: the removal raises and changes nothing.
  UPDATE private.credit_epoch SET paused = true;
  r := pg_temp.remove_err('authenticated', pg_temp.u(9), 'VP');
  PERFORM pg_temp.assert_true(r = '55000: Credit writes are paused', 'with credit writes paused the removal raises 55000 (' || r || ')');
  PERFORM pg_temp.assert_true(pg_temp.vp_state() = before, 'and nothing changed: pieces, shareable sessions, markers, balance, refund entries, ledger');
  UPDATE private.credit_epoch SET paused = false;
  r := pg_temp.admin_remove('VP') ->> 'unlocks_refunded';
  PERFORM pg_temp.assert_true(r = '1' AND pg_temp.bal(pg_temp.u(7)) = 300 AND pg_temp.vp_state() LIKE '0/0/1/300.0000/2/%', 'once credit writes resume, the same removal refunds the unlock');
END;
$$;

SELECT pg_temp.invariants('at the end');
ROLLBACK;
