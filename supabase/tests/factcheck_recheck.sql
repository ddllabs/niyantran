-- Re-check one verdict (migration 20261116110000; open-work F344, slice 3, task R1;
-- docs/plans/2026-11-16-f344-recheck.md). PostgreSQL assertions, no pgTAP. Run only in a disposable database, through
-- run.sh, which applies the migration as a non-superuser (nter_migrator).
-- Bootstrap: the factcheck chain (the latest credit and billing chain, the Storage stub, app_flags, the fact-check
-- migration), then the F347 report migration, then 20261116110000_factcheck_recheck.sql as a non-superuser. The vacuity
-- check drops the last: the first assertion fails.
--
-- Time: now() is fixed for the whole transaction, so ages are moved into the past by updating rows.
-- Two requests racing cannot be shown inside one transaction. Begin and charge both take the user's wallet lock before the
-- claim row, which serialises them; that is the same pattern factcheck_concurrency.sh proves for settle.
--
-- Users (00000000-0000-4000-8000-0000000fe0NN): 01 main; 02 another user; 03 too poor; 04 debt; 05 rate limits;
-- 06 a non-admin audience; 07 account deletion.
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

CREATE FUNCTION pg_temp.u(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-0000000fe' || lpad(n::text, 3, '0'))::uuid;
$$;
CREATE FUNCTION pg_temp.mkuser(n integer, credits numeric) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := pg_temp.u(n);
BEGIN
  INSERT INTO auth.users (id, email, created_at) VALUES (v, v::text || '@example.invalid', now());
  PERFORM private.credit_wallet(v);
  PERFORM private.credit_mint(v, 'topup', credits, now() - interval '1 minute', now() + interval '12 months',
    'fx:' || v, NULL, 'grant', NULL, NULL, NULL);
  RETURN v;
END;
$$;
CREATE FUNCTION pg_temp.setflag(v jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.app_flags WHERE key = 'livetv_factcheck';
  IF v IS NOT NULL THEN
    INSERT INTO public.app_flags (key, value) VALUES ('livetv_factcheck', v);
  END IF;
END;
$$;
-- A settled session of the user (charged 1 minute at the flag's price), for claims to hang on.
CREATE FUNCTION pg_temp.session(p_user uuid, p_settle boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r jsonb := public.factcheck_start(p_user, 'vid1', 'chan1', 'live', NULL, 5, true); sid uuid;
BEGIN
  IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: start refused: %', r; END IF;
  sid := (r ->> 'session_id')::uuid;
  IF p_settle THEN PERFORM public.factcheck_settle(p_user, sid); END IF;
  RETURN sid;
END;
$$;
CREATE FUNCTION pg_temp.claim(p_session uuid, p_user uuid, p_status text, p_text text DEFAULT 'Claim text') RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.factcheck_claims (session_id, user_id, video_id, video_kind, position_s, spoken_at, quote, claim_en,
    claimant, reported_by, kind, status, verdict, reason, sources, checked_at)
  VALUES (p_session, p_user, 'vid1', 'live', 12.5, now() - interval '5 minutes', 'Quote ' || p_text, p_text,
    'The Speaker', 'The Channel', 'claim', p_status,
    CASE WHEN p_status = 'checked' THEN 'supported' END, CASE WHEN p_status IN ('checked', 'error') THEN 'Because.' END,
    CASE WHEN p_status = 'checked' THEN '[{"url":"https://example.invalid/a","title":"A"}]'::jsonb ELSE '[]'::jsonb END,
    CASE WHEN p_status = 'checked' THEN now() - interval '4 minutes' END)
  RETURNING id;
$$;
-- Ends a begun re-check row the way the Edge Function does: with a saved verdict (or an error).
CREATE FUNCTION pg_temp.finish(p_claim uuid, p_status text) RETURNS void LANGUAGE sql AS $$
  UPDATE public.factcheck_claims SET status = p_status,
    verdict = CASE WHEN p_status = 'checked' THEN 'partly_true' END, reason = 'New reason.',
    sources = CASE WHEN p_status = 'checked' THEN '[{"url":"https://example.invalid/b","title":"B"}]'::jsonb ELSE '[]'::jsonb END,
    checked_at = CASE WHEN p_status = 'checked' THEN now() END
  WHERE id = p_claim;
$$;
-- What a refused begin must leave alone: claims, state rows, ledger entries, the minute's count, the balance, the holds.
CREATE FUNCTION pg_temp.snap(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT (SELECT count(*) FROM public.factcheck_claims WHERE user_id = p_user) || '|'
      || (SELECT count(*) FROM private.factcheck_recheck_state s JOIN public.factcheck_claims c ON c.id = s.claim_id WHERE c.user_id = p_user) || '|'
      || (SELECT count(*) FROM public.credit_ledger WHERE user_id = p_user) || '|'
      || coalesce((SELECT sum(n) FROM private.factcheck_recheck_rate WHERE user_id = p_user), 0) || '|'
      || (SELECT balance FROM public.credit_wallets WHERE user_id = p_user) || '|'
      || (SELECT count(*) FROM public.credit_holds WHERE user_id = p_user);
$$;
CREATE FUNCTION pg_temp.refused(p_user uuid, p_claim uuid, p_admin boolean, p_expected numeric, p_reason text, p_label text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE snap_before text; r jsonb;
BEGIN
  -- Settle what is owed first (begin collects it before anything else), so that the refusal itself is what is compared.
  PERFORM public.factcheck_recheck_collect();
  snap_before := pg_temp.snap(p_user);
  r := public.factcheck_recheck_begin(p_user, p_claim, p_admin, p_expected);
  IF r ->> 'ok' <> 'false' OR r ->> 'reason' <> p_reason OR pg_temp.snap(p_user) <> snap_before THEN
    RAISE EXCEPTION 'FAIL: % (wanted %, got % ; state % -> %)', p_label, p_reason, r, snap_before, pg_temp.snap(p_user);
  END IF;
  RAISE NOTICE 'PASS: %', p_label;
  RETURN r;
END;
$$;

-- 0. The objects exist, and who may do what ---------------------------------------------------------------------------------
SELECT pg_temp.assert_true(to_regclass('private.factcheck_recheck_state') IS NOT NULL AND to_regclass('private.factcheck_recheck_rate') IS NOT NULL
  AND to_regprocedure('public.factcheck_recheck_begin(uuid,uuid,boolean,numeric)') IS NOT NULL
  AND to_regprocedure('public.factcheck_recheck_charge(uuid,uuid)') IS NOT NULL
  AND to_regprocedure('private.factcheck_recheck_flag()') IS NOT NULL, 'the objects exist');
DO $$
DECLARE actor text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['anon', 'authenticated', 'public'] LOOP
    PERFORM pg_temp.assert_true(NOT has_function_privilege(actor, 'public.factcheck_recheck_begin(uuid,uuid,boolean,numeric)', 'EXECUTE')
      AND NOT has_function_privilege(actor, 'public.factcheck_recheck_charge(uuid,uuid)', 'EXECUTE'), actor || ' cannot call begin or charge');
  END LOOP;
  PERFORM pg_temp.assert_true(has_function_privilege('service_role', 'public.factcheck_recheck_begin(uuid,uuid,boolean,numeric)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.factcheck_recheck_charge(uuid,uuid)', 'EXECUTE'), 'service_role can call begin and charge');
  FOREACH actor IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'public'] LOOP
    PERFORM pg_temp.assert_true(NOT has_function_privilege(actor, 'private.factcheck_recheck_flag()', 'EXECUTE')
      AND NOT has_table_privilege(actor, 'private.factcheck_recheck_state', 'SELECT')
      AND NOT has_table_privilege(actor, 'private.factcheck_recheck_rate', 'SELECT')
      AND NOT has_table_privilege(actor, 'private.factcheck_recheck_state', 'INSERT'), actor || ' reaches no private recheck object');
  END LOOP;
END;
$$;

-- The column: nullable, above 0 and at most 1000.
SELECT pg_temp.mkuser(1, 5000);
SELECT pg_temp.mkuser(2, 5000);
SELECT pg_temp.setflag('{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":100}');
SELECT pg_temp.session(pg_temp.u(1));
SELECT pg_temp.session(pg_temp.u(2));
DO $$
DECLARE u uuid := pg_temp.u(1); sid uuid := (SELECT id FROM public.factcheck_sessions WHERE user_id = pg_temp.u(1)); c uuid;
BEGIN
  c := pg_temp.claim(sid, u, 'checked');
  PERFORM pg_temp.assert_true((SELECT recheck_credits IS NULL FROM public.factcheck_claims WHERE id = c), 'an ordinary claim has no re-check price');
  PERFORM pg_temp.rejected(format('UPDATE public.factcheck_claims SET recheck_credits = 0 WHERE id = %L', c), '23514', 'a re-check price of 0 is refused by the table');
  PERFORM pg_temp.rejected(format('UPDATE public.factcheck_claims SET recheck_credits = 1000.0001 WHERE id = %L', c), '23514', 'a re-check price above 1000 is refused');
  PERFORM pg_temp.rejected(format('UPDATE public.factcheck_claims SET recheck_credits = -1 WHERE id = %L', c), '23514', 'a negative re-check price is refused');
END;
$$;

-- 1. The flag: re-check is on only with the flag on and a price in (0, 1000] ---------------------------------------------------
DO $$
DECLARE
  u uuid := pg_temp.u(1);
  sid uuid := (SELECT id FROM public.factcheck_sessions WHERE user_id = pg_temp.u(1));
  c uuid := pg_temp.claim((SELECT id FROM public.factcheck_sessions WHERE user_id = pg_temp.u(1)), pg_temp.u(1), 'checked', 'Flag claim');
  v_flag jsonb; v_case integer := 0; r jsonb;
  cases jsonb[] := (ARRAY[
    '{"enabled":true,"audience":"admin","credits_per_minute":2}',
    '{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":0}',
    '{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":-1}',
    '{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":1000.0001}',
    '{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":1001}',
    '{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":"100"}',
    '{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":null}',
    '{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":true}',
    '{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":[100]}',
    '{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":1e400}',
    '{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":0.00001}',
    '{"enabled":false,"audience":"admin","credits_per_minute":2,"recheck_credits":100}',
    '{"enabled":"true","audience":"admin","credits_per_minute":2,"recheck_credits":100}',
    '{"enabled":true,"credits_per_minute":2,"recheck_credits":100}',
    '{"enabled":true,"audience":"admin","recheck_credits":100}',
    '{"enabled":true,"audience":"admin","credits_per_minute":0,"recheck_credits":100}',
    '[100]', '"on"', 'null', '{}'
  ])::jsonb[];
BEGIN
  FOREACH v_flag IN ARRAY cases LOOP
    v_case := v_case + 1;
    PERFORM pg_temp.setflag(v_flag);
    r := pg_temp.refused(u, c, true, 100, 'off', 'flag case ' || v_case || ' (' || v_flag::text || ') is off');
  END LOOP;
  PERFORM pg_temp.setflag(NULL);
  r := pg_temp.refused(u, c, true, 100, 'off', 'no flag row is off');
  PERFORM pg_temp.setflag('{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":100}');
END;
$$;

-- 2. Every refusal leaves everything alone ---------------------------------------------------------------------------------------
SELECT pg_temp.mkuser(3, 50);
SELECT pg_temp.mkuser(6, 5000);
DO $$
DECLARE
  u uuid := pg_temp.u(1); o uuid := pg_temp.u(2); poor uuid := pg_temp.u(3);
  sid uuid := (SELECT id FROM public.factcheck_sessions WHERE user_id = pg_temp.u(1));
  osid uuid := (SELECT id FROM public.factcheck_sessions WHERE user_id = pg_temp.u(2));
  c uuid; r jsonb; child uuid; ps uuid; mine uuid;
BEGIN
  c := pg_temp.claim(sid, u, 'checked', 'Refusals');
  r := pg_temp.refused(u, c, false, 100, 'not_allowed', 'audience admin: a non-admin is refused');
  r := pg_temp.refused(u, c, NULL, 100, 'not_allowed', 'and an unknown admin flag counts as not admin');
  r := pg_temp.refused(u, gen_random_uuid(), true, 100, 'not_found', 'an unknown claim is not_found');
  r := pg_temp.refused(u, pg_temp.claim(osid, o, 'checked', 'Other'), true, 100, 'not_found', 'another user''s claim is not_found');
  r := pg_temp.refused(u, pg_temp.claim(sid, u, 'pending', 'P'), true, 100, 'not_recheckable', 'a pending claim is not_recheckable');
  r := pg_temp.refused(u, pg_temp.claim(sid, u, 'needs_context', 'N'), true, 100, 'not_recheckable', 'a needs_context claim is not_recheckable');
  r := pg_temp.refused(u, pg_temp.claim(sid, u, 'not_checkable', 'M'), true, 100, 'not_recheckable', 'a not_checkable claim is not_recheckable');
  r := pg_temp.refused(u, c, true, 99, 'price_changed', 'a different expected price is price_changed');
  PERFORM pg_temp.assert_true((r ->> 'recheck_credits')::numeric = 100, 'and names the current price: ' || r::text);
  r := pg_temp.refused(u, c, true, NULL, 'price_changed', 'no expected price is price_changed');
  r := pg_temp.refused(u, c, true, 'NaN', 'price_changed', 'a NaN expected price is price_changed');
  r := pg_temp.refused(u, c, true, 100.0001, 'price_changed', 'a slightly different expected price is price_changed');
  -- insufficient: 50 credits against 100
  r := pg_temp.refused(poor, pg_temp.claim(pg_temp.session(poor, false), poor, 'checked', 'Poor'), true, 100, 'insufficient', 'too few credits is insufficient');
  PERFORM pg_temp.assert_true((r ->> 'needed')::numeric = 100 AND (r ->> 'available')::numeric = 50 - 10, 'and names what is needed and what is available (the running session''s hold counts): ' || r::text);
  -- superseded: a newer row that has left pending
  child := (public.factcheck_recheck_begin(u, c, true, 100) ->> 'claim_id')::uuid;
  PERFORM pg_temp.assert_true(child IS NOT NULL, 'a re-check begins');
  r := pg_temp.refused(u, c, true, 100, 'in_progress', 'a second re-check while the first is pending is in_progress');
  PERFORM pg_temp.finish(child, 'checked');
  r := pg_temp.refused(u, c, true, 100, 'not_recheckable', 'once the newer row holds a verdict the older one is superseded');
  -- the null-argument raises
  PERFORM pg_temp.rejected($q$SELECT public.factcheck_recheck_begin(NULL, gen_random_uuid(), true, 100)$q$, '22023', 'a missing user raises');
  PERFORM pg_temp.rejected($q$SELECT public.factcheck_recheck_begin(pg_temp.u(1), NULL, true, 100)$q$, '22023', 'a missing claim raises');
END;
$$;

-- A non-admin audience: with the flag open to all, a non-admin may begin.
DO $$
DECLARE u uuid := pg_temp.u(6); c uuid; r jsonb;
BEGIN
  c := pg_temp.claim(pg_temp.session(u), u, 'checked', 'All');
  PERFORM pg_temp.setflag('{"enabled":true,"audience":"all","credits_per_minute":2,"recheck_credits":100}');
  r := public.factcheck_recheck_begin(u, c, false, 100);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true', 'audience all: a non-admin may begin a re-check');
  PERFORM pg_temp.setflag('{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":100}');
END;
$$;

-- 3. A begin: the new row, and no charge, no hold -------------------------------------------------------------------------------
SELECT pg_temp.mkuser(8, 5000);
DO $$
DECLARE
  u uuid := pg_temp.u(8); sid uuid := pg_temp.session(pg_temp.u(8)); c uuid; r jsonb; n record; p record;
  bal numeric; led bigint; holds bigint;
BEGIN
  c := pg_temp.claim(sid, u, 'checked', 'Copy me');
  SELECT balance INTO bal FROM public.credit_wallets WHERE user_id = u;
  SELECT count(*) INTO led FROM public.credit_ledger WHERE user_id = u;
  SELECT count(*) INTO holds FROM public.credit_holds WHERE user_id = u;
  r := public.factcheck_recheck_begin(u, c, true, 100);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND (r ->> 'recheck_credits')::numeric = 100 AND (r ->> 'claim_id') IS NOT NULL
    AND (SELECT count(*) FROM jsonb_object_keys(r)) = 3, 'begin returns exactly ok, claim_id and recheck_credits: ' || r::text);
  PERFORM pg_temp.assert_true(r::text NOT LIKE '%fcr:%', 'and no key');
  SELECT * INTO n FROM public.factcheck_claims WHERE id = (r ->> 'claim_id')::uuid;
  SELECT * INTO p FROM public.factcheck_claims WHERE id = c;
  PERFORM pg_temp.assert_true(n.session_id = p.session_id AND n.user_id = p.user_id AND n.video_id = p.video_id AND n.video_kind = p.video_kind
    AND n.position_s = p.position_s AND n.spoken_at = p.spoken_at AND n.quote = p.quote AND n.claim_en = p.claim_en
    AND n.claimant = p.claimant AND n.reported_by = p.reported_by AND n.kind = p.kind, 'the new row copies the session, video, position, time, quote, claim, claimant, reporter and kind');
  PERFORM pg_temp.assert_true(n.status = 'pending' AND n.supersedes = c AND n.verdict IS NULL AND n.reason IS NULL AND n.sources = '[]'::jsonb
    AND n.checked_at IS NULL AND n.recheck_credits = 100 AND n.id <> c, 'it is pending, names the old row, holds no verdict, and carries the price');
  PERFORM pg_temp.assert_true((SELECT balance FROM public.credit_wallets WHERE user_id = u) = bal
    AND (SELECT count(*) FROM public.credit_ledger WHERE user_id = u) = led
    AND (SELECT count(*) FROM public.credit_holds WHERE user_id = u) = holds, 'begin charges nothing and holds nothing');
  PERFORM pg_temp.assert_true((SELECT price = 100 AND turn_key IS NULL AND credits_charged IS NULL FROM private.factcheck_recheck_state WHERE claim_id = n.id), 'the private record holds the price and no charge');
  PERFORM pg_temp.assert_true((SELECT status = 'checked' AND verdict = 'supported' FROM public.factcheck_claims WHERE id = c), 'the old row is untouched');
END;
$$;

-- An error row can be re-checked too; the session may be running or ended.
DO $$
DECLARE u uuid := pg_temp.u(8); r jsonb; sid uuid; c uuid;
BEGIN
  c := pg_temp.claim((SELECT id FROM public.factcheck_sessions WHERE user_id = u LIMIT 1), u, 'error', 'Was an error');
  r := public.factcheck_recheck_begin(u, c, true, 100);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true', 'an error row can be re-checked');
  sid := pg_temp.session(u, false);
  c := pg_temp.claim(sid, u, 'checked', 'In a running session');
  r := public.factcheck_recheck_begin(u, c, true, 100);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true', 'a row of a running session can be re-checked');
  PERFORM public.factcheck_settle(u, sid);
END;
$$;

-- 4. The chain: newest first -------------------------------------------------------------------------------------------------------
SELECT pg_temp.mkuser(9, 5000);
DO $$
DECLARE u uuid := pg_temp.u(9); sid uuid := pg_temp.session(pg_temp.u(9)); a uuid; b uuid; c uuid; d uuid; r jsonb;
BEGIN
  a := pg_temp.claim(sid, u, 'checked', 'Chain');
  b := (public.factcheck_recheck_begin(u, a, true, 100) ->> 'claim_id')::uuid;
  PERFORM pg_temp.finish(b, 'checked');
  r := pg_temp.refused(u, a, true, 100, 'not_recheckable', 'the first row is superseded');
  c := (public.factcheck_recheck_begin(u, b, true, 100) ->> 'claim_id')::uuid;
  PERFORM pg_temp.assert_true(c IS NOT NULL AND (SELECT supersedes = b FROM public.factcheck_claims WHERE id = c), 'a re-check of a re-check is allowed and names the re-check');
  PERFORM pg_temp.finish(c, 'checked');
  r := pg_temp.refused(u, b, true, 100, 'not_recheckable', 'the middle row is superseded');
  r := pg_temp.refused(u, a, true, 100, 'not_recheckable', 'and so is the first');
  -- A re-check that ended in error supersedes its parent too; the error row itself can be tried again.
  d := (public.factcheck_recheck_begin(u, c, true, 100) ->> 'claim_id')::uuid;
  PERFORM pg_temp.finish(d, 'error');
  r := pg_temp.refused(u, d, true, 100, 'not_recheckable', 'a re-check row that ended in error cannot itself be re-checked');
  r := public.factcheck_recheck_begin(u, c, true, 100);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true', 'the row it superseded can be re-checked again: a failed attempt never blocks another');
  -- A pending row whose request died (older than 90 s) does not block the claim.
  a := pg_temp.claim(sid, u, 'checked', 'Stale');
  b := (public.factcheck_recheck_begin(u, a, true, 100) ->> 'claim_id')::uuid;
  r := pg_temp.refused(u, a, true, 100, 'in_progress', 'a pending re-check younger than 90 seconds blocks another');
  UPDATE private.factcheck_recheck_state SET begun_at = now() - interval '89 seconds' WHERE claim_id = b;
  r := pg_temp.refused(u, a, true, 100, 'in_progress', 'at 89 seconds it still blocks');
  UPDATE private.factcheck_recheck_state SET begun_at = now() - interval '91 seconds' WHERE claim_id = b;
  r := public.factcheck_recheck_begin(u, a, true, 100);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true', 'at 91 seconds the dead request no longer blocks the claim');
END;
$$;

-- 5. The per-minute limit ---------------------------------------------------------------------------------------------------------
SELECT pg_temp.mkuser(5, 50000);
DO $$
DECLARE u uuid := pg_temp.u(5); sid uuid := pg_temp.session(pg_temp.u(5)); i integer; c uuid; r jsonb; cl uuid[] := '{}';
BEGIN
  FOR i IN 1..8 LOOP cl := cl || pg_temp.claim(sid, u, 'checked', 'Rate ' || i); END LOOP;
  FOR i IN 1..6 LOOP
    r := public.factcheck_recheck_begin(u, cl[i], true, 100);
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: re-check % was refused: %', i, r; END IF;
  END LOOP;
  r := pg_temp.refused(u, cl[7], true, 100, 'rate_limited', 'the 7th re-check begun in a minute is rate_limited');
  PERFORM pg_temp.assert_true((SELECT n FROM private.factcheck_recheck_rate WHERE user_id = u) = 6, 'and a refused one is not counted');
  UPDATE private.factcheck_recheck_rate SET minute = minute - interval '1 minute' WHERE user_id = u;
  r := public.factcheck_recheck_begin(u, cl[7], true, 100);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND (SELECT n FROM private.factcheck_recheck_rate WHERE user_id = u AND minute = date_trunc('minute', now())) = 1,
    'the next calendar minute starts again');
  -- Another user is not limited by this one.
  PERFORM pg_temp.assert_true(public.factcheck_recheck_begin(pg_temp.u(1), pg_temp.claim((SELECT id FROM public.factcheck_sessions WHERE user_id = pg_temp.u(1) LIMIT 1), pg_temp.u(1), 'checked', 'Other user'), true, 100) ->> 'ok' = 'true',
    'another user is not limited');
  -- Old rate rows are pruned.
  INSERT INTO private.factcheck_recheck_rate (user_id, minute, n) VALUES (u, now() - interval '3 hours', 2);
  PERFORM public.factcheck_recheck_begin(u, cl[8], true, 100);
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM private.factcheck_recheck_rate WHERE user_id = u AND minute < now() - interval '1 hour'), 'rate rows over an hour old are deleted');
END;
$$;

-- 6. The charge ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.mkuser(10, 1000);
DO $$
DECLARE
  u uuid := pg_temp.u(10); o uuid := pg_temp.u(2); sid uuid := pg_temp.session(pg_temp.u(10)); a uuid; b uuid; r jsonb; r2 jsonb; e record;
  bal numeric; v_rate numeric; v_usd numeric; other_claim uuid;
BEGIN
  a := pg_temp.claim(sid, u, 'checked', 'Charge me');
  b := (public.factcheck_recheck_begin(u, a, true, 100) ->> 'claim_id')::uuid;
  -- refusals
  PERFORM pg_temp.assert_true(public.factcheck_recheck_charge(u, b) = '{"ok": false, "reason": "not_chargeable"}'::jsonb, 'a row still pending is not_chargeable');
  PERFORM pg_temp.assert_true(public.factcheck_recheck_charge(u, a) = '{"ok": false, "reason": "not_chargeable"}'::jsonb, 'an ordinary claim (no re-check) is not_chargeable');
  PERFORM pg_temp.assert_true(public.factcheck_recheck_charge(u, gen_random_uuid()) = '{"ok": false, "reason": "not_found"}'::jsonb, 'an unknown claim is not_found');
  other_claim := pg_temp.claim((SELECT id FROM public.factcheck_sessions WHERE user_id = o LIMIT 1), o, 'checked', 'Other');
  PERFORM pg_temp.assert_true(public.factcheck_recheck_charge(u, other_claim) ->> 'reason' = 'not_found', 'another user''s claim is not_found');
  PERFORM pg_temp.rejected($q$SELECT public.factcheck_recheck_charge(NULL, gen_random_uuid())$q$, '22023', 'a missing user raises');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM public.credit_ledger WHERE user_id = u AND kind = 'charge' AND note = 'live tv fact-check' AND turn_key LIKE 'fcr:%') = 0, 'nothing was charged so far');

  -- a leaked key cannot make a row chargeable or change the price
  PERFORM pg_temp.finish(b, 'checked');
  UPDATE public.factcheck_claims SET recheck_credits = 1 WHERE id = b;
  SELECT balance INTO bal FROM public.credit_wallets WHERE user_id = u;
  r := public.factcheck_recheck_charge(u, b);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND (r ->> 'credits_charged')::numeric = 100 AND (r ->> 'balance')::numeric = bal - 100
    AND r ->> 'repeated' = 'false' AND (SELECT count(*) FROM jsonb_object_keys(r)) = 4,
    'the charge is the price stored at begin (100), not the claim column rewritten to 1, and returns exactly ok, credits_charged, balance, repeated: ' || r::text);
  PERFORM pg_temp.assert_true(r::text NOT LIKE '%fcr:%', 'it returns no key');
  SELECT * INTO e FROM public.credit_ledger WHERE user_id = u AND kind = 'charge' AND turn_key LIKE 'fcr:%';
  SELECT inr_per_credit, usd_to_inr INTO v_rate, v_usd FROM public.credit_settings WHERE id;
  PERFORM pg_temp.assert_true(e.credits = -100 AND e.note = 'live tv fact-check' AND e.turn_key ~ '^fcr:[0-9a-f-]{36}$' AND e.lot_id IS NULL AND e.request_id IS NULL
    AND e.inr_per_credit = v_rate AND e.usd_to_inr = v_usd, 'one charge entry: kind charge, note exactly live tv fact-check, a private fcr: key, current rates');
  PERFORM pg_temp.assert_true((SELECT sum(credits) FROM public.credit_lot_draws WHERE ledger_id = e.id AND reason = 'charge') = 100, 'the lots paid it');
  PERFORM pg_temp.assert_true((SELECT turn_key = e.turn_key AND credits_charged = 100 AND charged_at = now() FROM private.factcheck_recheck_state WHERE claim_id = b), 'the private record keeps the key and the amount');
  PERFORM pg_temp.invariants('after a re-check charge');

  -- idempotent
  r2 := public.factcheck_recheck_charge(u, b);
  PERFORM pg_temp.assert_true(r2 ->> 'ok' = 'true' AND r2 ->> 'repeated' = 'true' AND (r2 ->> 'credits_charged')::numeric = 100 AND (r2 ->> 'balance')::numeric = bal - 100
    AND (SELECT count(*) FROM public.credit_ledger WHERE user_id = u AND turn_key LIKE 'fcr:%') = 1, 'charging again charges nothing more and says repeated');
  -- the price at begin, even if the flag changes or goes off
  a := pg_temp.claim(sid, u, 'checked', 'Price at begin');
  b := (public.factcheck_recheck_begin(u, a, true, 100) ->> 'claim_id')::uuid;
  PERFORM pg_temp.finish(b, 'checked');
  PERFORM pg_temp.setflag('{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":500}');
  r := public.factcheck_recheck_charge(u, b);
  PERFORM pg_temp.assert_true((r ->> 'credits_charged')::numeric = 100, 'a price raised after begin does not change the charge: ' || r::text);
  a := pg_temp.claim(sid, u, 'checked', 'Flag off after begin');
  PERFORM pg_temp.setflag('{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":500}');
  b := (public.factcheck_recheck_begin(u, a, true, 500) ->> 'claim_id')::uuid;
  PERFORM pg_temp.finish(b, 'checked');
  PERFORM pg_temp.setflag(NULL);
  r := public.factcheck_recheck_charge(u, b);
  PERFORM pg_temp.assert_true((r ->> 'credits_charged')::numeric = 500, 'with the flag off a re-check that was begun is still charged: ' || r::text);
  PERFORM pg_temp.setflag('{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":100}');
  -- never charged for error
  a := pg_temp.claim(sid, u, 'checked', 'Will error');
  b := (public.factcheck_recheck_begin(u, a, true, 100) ->> 'claim_id')::uuid;
  PERFORM pg_temp.finish(b, 'error');
  bal := (SELECT balance FROM public.credit_wallets WHERE user_id = u);
  PERFORM pg_temp.assert_true(public.factcheck_recheck_charge(u, b) ->> 'reason' = 'not_chargeable' AND (SELECT balance FROM public.credit_wallets WHERE user_id = u) = bal,
    'a re-check that ended in error is never charged');
  -- a row made by hand, never begun: not chargeable whatever it says
  PERFORM pg_temp.setflag('{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":100}');
  b := pg_temp.claim(sid, u, 'checked', 'Forged');
  UPDATE public.factcheck_claims SET supersedes = a, recheck_credits = 1000 WHERE id = b;
  bal := (SELECT balance FROM public.credit_wallets WHERE user_id = u);
  PERFORM pg_temp.assert_true(public.factcheck_recheck_charge(u, b) ->> 'reason' = 'not_chargeable' AND (SELECT balance FROM public.credit_wallets WHERE user_id = u) = bal,
    'a forged row (supersedes and a price set by hand, never begun) cannot be charged');
END;
$$;

-- Debt: the balance fell below the price after the begin.
SELECT pg_temp.mkuser(4, 150);
DO $$
DECLARE u uuid := pg_temp.u(4); a uuid; b uuid; r jsonb; ent uuid;
BEGIN
  a := pg_temp.claim(pg_temp.session(u), u, 'checked', 'Debt');
  b := (public.factcheck_recheck_begin(u, a, true, 100) ->> 'claim_id')::uuid;
  PERFORM pg_temp.finish(b, 'checked');
  ent := private.credit_entry(u, 'adjustment', -100, NULL, NULL, gen_random_uuid(), NULL, NULL, u, 'fixture');
  PERFORM private.credit_draw(u, 100, ent, 'removal', now());
  r := public.factcheck_recheck_charge(u, b);
  PERFORM pg_temp.assert_true((r ->> 'credits_charged')::numeric = 100 AND (r ->> 'balance')::numeric = (SELECT balance FROM public.credit_wallets WHERE user_id = u)
    AND (SELECT debt > 0 AND balance < 0 FROM public.credit_wallets WHERE user_id = u), 'a charge above the balance leaves debt: ' || r::text);
  PERFORM pg_temp.invariants('after a re-check charge into debt');
END;
$$;

-- Available counts live holds: a running session's block takes credits from a re-check, as from the chat.
-- Available counts live holds, as the research chat and factcheck_start count them.
SELECT pg_temp.mkuser(12, 120);
DO $$
DECLARE u uuid := pg_temp.u(12); sid uuid; a uuid; r jsonb;
BEGIN
  sid := pg_temp.session(u, false);                                  -- a running 5-minute block holds 10
  a := pg_temp.claim(sid, u, 'checked', 'Held');
  PERFORM pg_temp.assert_true(public.factcheck_recheck_begin(u, a, true, 100) ->> 'ok' = 'true', '120 credits, 10 held: 110 available, 100 needed');
  UPDATE public.credit_holds SET credits = 25 WHERE user_id = u AND turn_key LIKE 'fc:%';
  a := pg_temp.claim(sid, u, 'checked', 'Held 2');
  r := pg_temp.refused(u, a, true, 100, 'insufficient', 'with 25 held only 95 are available: insufficient');
  PERFORM pg_temp.assert_true((r ->> 'available')::numeric = 95 AND (r ->> 'needed')::numeric = 100, 'and says so: ' || r::text);
  PERFORM public.factcheck_settle(u, sid);
END;
$$;

-- 6b. Re-checks left uncharged are charged by the next begin and by the collector, once, and an error never ----------------------------
-- Drain what earlier sections left owing, so the counts below are exact.
SELECT public.factcheck_recheck_collect();
SELECT public.factcheck_recheck_collect();
SELECT pg_temp.mkuser(13, 2000);
SELECT pg_temp.mkuser(14, 2000);
SELECT pg_temp.mkuser(15, 2000);
-- A checked re-check row that the Edge Function never got to charge.
CREATE FUNCTION pg_temp.owed(p_user uuid, p_session uuid, p_text text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE a uuid := pg_temp.claim(p_session, p_user, 'checked', p_text); b uuid;
BEGIN
  b := (public.factcheck_recheck_begin(p_user, a, true, 100) ->> 'claim_id')::uuid;
  PERFORM pg_temp.finish(b, 'checked');
  RETURN b;
END;
$$;
CREATE FUNCTION pg_temp.fcr(p_user uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.credit_ledger WHERE user_id = p_user AND turn_key LIKE 'fcr:%';
$$;
DO $$
DECLARE u uuid := pg_temp.u(13); sid uuid := pg_temp.session(pg_temp.u(13)); owed uuid; fresh uuid; err uuid; forged uuid; r jsonb; bal numeric;
BEGIN
  err := (public.factcheck_recheck_begin(u, pg_temp.claim(sid, u, 'checked', 'Err'), true, 100) ->> 'claim_id')::uuid;
  PERFORM pg_temp.finish(err, 'error');
  owed := pg_temp.owed(u, sid, 'Owed 1');
  PERFORM pg_temp.assert_true(pg_temp.fcr(u) = 0, 'a checked re-check row nobody charged is owing');
  forged := pg_temp.claim(sid, u, 'checked', 'Forged');
  UPDATE public.factcheck_claims SET supersedes = owed, recheck_credits = 1000 WHERE id = forged;
  bal := (SELECT balance FROM public.credit_wallets WHERE user_id = u);
  fresh := pg_temp.claim(sid, u, 'checked', 'Next');
  r := public.factcheck_recheck_begin(u, fresh, true, 100);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true' AND pg_temp.fcr(u) = 1
    AND (SELECT credits_charged = 100 FROM private.factcheck_recheck_state WHERE claim_id = owed)
    AND (SELECT balance FROM public.credit_wallets WHERE user_id = u) = bal - 100,
    'the next begin charges the owed re-check first, once: ' || r::text);
  PERFORM pg_temp.assert_true((SELECT credits_charged IS NULL FROM private.factcheck_recheck_state WHERE claim_id = err)
    AND NOT EXISTS (SELECT FROM private.factcheck_recheck_state WHERE claim_id = forged), 'an error row and a forged row are not charged');
  r := public.factcheck_recheck_charge(u, owed);
  PERFORM pg_temp.assert_true(r ->> 'repeated' = 'true' AND pg_temp.fcr(u) = 1, 'the public charge afterwards finds it already charged');
  r := public.factcheck_recheck_begin(u, gen_random_uuid(), true, 100);
  PERFORM pg_temp.assert_true(r ->> 'reason' = 'not_found' AND pg_temp.fcr(u) = 1, 'a later begin charges nothing more');
END;
$$;
-- Whatever the begin then answers, it collects first.
DO $$
DECLARE u uuid := pg_temp.u(14); sid uuid := pg_temp.session(pg_temp.u(14)); r jsonb; reason text;
BEGIN
  FOREACH reason IN ARRAY ARRAY['off', 'not_allowed', 'not_found'] LOOP
    PERFORM pg_temp.owed(u, sid, 'Owed ' || reason);
    IF reason = 'off' THEN PERFORM pg_temp.setflag(NULL); END IF;
    r := public.factcheck_recheck_begin(u, CASE reason WHEN 'not_found' THEN gen_random_uuid() ELSE pg_temp.claim(sid, u, 'checked', 'X ' || reason) END,
                                       reason <> 'not_allowed', 100);
    PERFORM pg_temp.setflag('{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":100}');
    PERFORM pg_temp.assert_true(r ->> 'reason' = reason AND pg_temp.fcr(u) = array_position(ARRAY['off', 'not_allowed', 'not_found'], reason),
      'a begin that answers ' || reason || ' has collected the owed re-check first');
  END LOOP;
END;
$$;
-- The collector: every user, once, never an error or a forged row.
DO $$
DECLARE a uuid := pg_temp.u(14); b uuid := pg_temp.u(15); sa uuid := (SELECT id FROM public.factcheck_sessions WHERE user_id = pg_temp.u(14) LIMIT 1);
  sb uuid := pg_temp.session(pg_temp.u(15)); n integer; err uuid; forged uuid; ba numeric;
BEGIN
  err := (public.factcheck_recheck_begin(b, pg_temp.claim(sb, b, 'checked', 'Err B'), true, 100) ->> 'claim_id')::uuid;
  PERFORM pg_temp.finish(err, 'error');
  PERFORM pg_temp.owed(a, sa, 'Collect A');
  PERFORM pg_temp.owed(b, sb, 'Collect B');
  forged := pg_temp.claim(sb, b, 'checked', 'Forged B');
  UPDATE public.factcheck_claims SET supersedes = err, recheck_credits = 1000 WHERE id = forged;
  ba := (SELECT balance FROM public.credit_wallets WHERE user_id = b);
  n := public.factcheck_recheck_collect();
  PERFORM pg_temp.assert_true(n = 2 AND pg_temp.fcr(a) = 4 AND pg_temp.fcr(b) = 1, 'the collector charges the owed re-checks of every user, once each: ' || n);
  PERFORM pg_temp.assert_true((SELECT balance FROM public.credit_wallets WHERE user_id = b) = ba - 100
    AND (SELECT credits_charged IS NULL FROM private.factcheck_recheck_state WHERE claim_id = err), 'and not the error row');
  PERFORM pg_temp.assert_true(public.factcheck_recheck_collect() = 0 AND pg_temp.fcr(a) = 4 AND pg_temp.fcr(b) = 1, 'a second run charges nothing');
  PERFORM pg_temp.invariants('after the collector');
END;
$$;
-- One failure does not stop the rest (a fixture-only trigger refuses the first row's charge).
SELECT pg_temp.mkuser(16, 2000);
CREATE FUNCTION public.fx_refuse_one() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.claim_id::text = current_setting('fx.bad_claim', true) AND NEW.credits_charged IS NOT NULL THEN
    RAISE EXCEPTION 'fixture failure' USING ERRCODE = 'XX001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fx_refuse_one BEFORE UPDATE ON private.factcheck_recheck_state FOR EACH ROW EXECUTE FUNCTION public.fx_refuse_one();
DO $$
DECLARE u uuid := pg_temp.u(16); sid uuid := pg_temp.session(pg_temp.u(16)); bad uuid; g1 uuid; g2 uuid; n integer;
BEGIN
  -- All three begun first and finished after, so that no begin collects the others early.
  bad := (public.factcheck_recheck_begin(u, pg_temp.claim(sid, u, 'checked', 'Bad'), true, 100) ->> 'claim_id')::uuid;
  g1 := (public.factcheck_recheck_begin(u, pg_temp.claim(sid, u, 'checked', 'Good 1'), true, 100) ->> 'claim_id')::uuid;
  g2 := (public.factcheck_recheck_begin(u, pg_temp.claim(sid, u, 'checked', 'Good 2'), true, 100) ->> 'claim_id')::uuid;
  PERFORM pg_temp.finish(bad, 'checked'); PERFORM pg_temp.finish(g1, 'checked'); PERFORM pg_temp.finish(g2, 'checked');
  UPDATE private.factcheck_recheck_state SET begun_at = now() - interval '1 hour' WHERE claim_id = bad;   -- tried first
  PERFORM set_config('fx.bad_claim', bad::text, true);
  n := public.factcheck_recheck_collect();
  PERFORM pg_temp.assert_true(n = 2 AND (SELECT credits_charged IS NULL FROM private.factcheck_recheck_state WHERE claim_id = bad)
    AND (SELECT count(*) FROM private.factcheck_recheck_state WHERE claim_id IN (g1, g2) AND credits_charged = 100) = 2 AND pg_temp.fcr(u) = 2,
    'a row that fails does not stop the others, and is left uncharged for the next run: ' || n);
END;
$$;
DROP TRIGGER fx_refuse_one ON private.factcheck_recheck_state;
DROP FUNCTION public.fx_refuse_one();
DO $$
DECLARE n integer;
BEGIN
  n := public.factcheck_recheck_collect();
  PERFORM pg_temp.assert_true(n = 1, 'and the next run charges it: ' || n);
  PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.factcheck_recheck_collect()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.factcheck_recheck_collect()', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.factcheck_recheck_collect()', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'private.factcheck_recheck_charge_locked(uuid,uuid)', 'EXECUTE'), 'the collector is service_role only, the internal routine private');
END;
$$;

-- 7. The usage reports list the charge as a fact-check row with no session detail ---------------------------------------------------
DO $$
DECLARE u uuid := pg_temp.u(10); g jsonb; u2 jsonb; row16 jsonb; s jsonb; rec jsonb; f jsonb; outtxt text; n integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', u::text, true);
  g := public.my_usage_activity(0, 100, true, NULL, 'all', 'factcheck');
  u2 := public.my_usage_activity(0, 100, false, NULL, 'all', 'factcheck');
  SELECT count(*) INTO n FROM jsonb_array_elements(g -> 'rows') e WHERE (e ->> 'credits')::numeric IN (100, 500);
  PERFORM pg_temp.assert_true(n = 3, 'the activity list shows the three re-check charges (100, 100, 500): ' || n);
  SELECT e INTO row16 FROM jsonb_array_elements(g -> 'rows') e WHERE (e ->> 'credits')::numeric = 500;
  PERFORM pg_temp.assert_true(row16 ->> 'feature' = 'factcheck' AND jsonb_typeof(row16 -> 'channel') = 'null' AND jsonb_typeof(row16 -> 'minutes_used') = 'null'
    AND jsonb_typeof(row16 -> 'video_kind') = 'null' AND jsonb_typeof(row16 -> 'turn_key') = 'null' AND jsonb_typeof(row16 -> 'conversation_id') = 'null'
    AND row16 ->> 'status' = 'succeeded' AND (row16 ->> 'calls')::int = 0, 'it is a fact-check row with no channel, minutes or kind, no turn key, no conversation: ' || row16::text);
  PERFORM pg_temp.assert_true((SELECT count(*) FROM jsonb_array_elements(u2 -> 'rows') e WHERE (e ->> 'credits')::numeric IN (100, 500) AND e ->> 'feature' = 'factcheck') = 3,
    'and in the per-call list');
  s := public.my_usage_summary(NULL, now() + interval '1 hour');   -- this transaction's charges are stamped now()
  SELECT e INTO f FROM jsonb_array_elements(s -> 'by_feature') e WHERE e ->> 'feature' = 'factcheck';
  PERFORM pg_temp.assert_true(f IS NOT NULL AND (f ->> 'credits')::numeric >= 700, 'the summary counts them under fact-check: ' || coalesce(f::text, 'missing'));
  rec := public.my_credits();
  PERFORM pg_temp.assert_true(EXISTS (SELECT FROM jsonb_array_elements(rec -> 'recent') e WHERE e ->> 'feature' = 'factcheck' AND (e ->> 'credits')::numeric = 500 AND e ->> 'title' = 'Live TV fact-check'),
    'my_credits.recent lists one');
  outtxt := g::text || u2::text || s::text || rec::text || public.my_usage_timeseries(now() - interval '1 day', now() + interval '1 hour', 'day')::text;
  PERFORM pg_temp.assert_true(outtxt NOT LIKE '%fcr:%' AND outtxt NOT LIKE '%fc:%', 'no report contains a ledger key');
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(2)::text, true);
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM jsonb_array_elements(public.my_usage_activity(0, 100, true, NULL, 'all', 'factcheck') -> 'rows') e WHERE (e ->> 'credits')::numeric IN (100, 500)),
    'another user''s reports do not show them');
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

-- 8. Row-level security and cascade -------------------------------------------------------------------------------------------------------
DO $$
DECLARE u uuid := pg_temp.u(10); a uuid; b uuid; sid uuid;
BEGIN
  sid := (SELECT id FROM public.factcheck_sessions WHERE user_id = u LIMIT 1);
  a := pg_temp.claim(sid, u, 'checked', 'Visible');
  b := (public.factcheck_recheck_begin(u, a, true, 100) ->> 'claim_id')::uuid;
  CREATE TEMP TABLE rls_ids (k text PRIMARY KEY, id uuid);
  GRANT ALL ON rls_ids TO anon, authenticated, service_role;
  INSERT INTO rls_ids VALUES ('b', b), ('sid', sid);
END;
$$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000fe010';
SELECT pg_temp.assert_true((SELECT recheck_credits = 100 AND supersedes IS NOT NULL AND status = 'pending' FROM public.factcheck_claims WHERE id = (SELECT id FROM rls_ids WHERE k = 'b')),
  'the owner reads the new row, with its price');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000fe002';
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_claims WHERE id = (SELECT id FROM rls_ids WHERE k = 'b')) AND (SELECT count(*) FROM public.factcheck_claims WHERE recheck_credits IS NOT NULL) = 0,
  'another user reads none of the re-check rows');
SELECT pg_temp.rejected($q$SELECT * FROM private.factcheck_recheck_state$q$, '42501', 'authenticated cannot read the private record');
SELECT pg_temp.rejected($q$SELECT public.factcheck_recheck_begin(auth.uid(), gen_random_uuid(), true, 100)$q$, '42501', 'authenticated cannot call begin');
SELECT pg_temp.rejected($q$SELECT public.factcheck_recheck_charge(auth.uid(), gen_random_uuid())$q$, '42501', 'authenticated cannot call charge');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.rejected($q$SELECT * FROM private.factcheck_recheck_state$q$, '42501', 'service_role cannot read the private record');
RESET ROLE;
DO $$
DECLARE u uuid := pg_temp.u(10); sid uuid := (SELECT id FROM rls_ids WHERE k = 'sid'); n integer;
BEGIN
  SELECT count(*) INTO n FROM public.credit_ledger WHERE user_id = u AND turn_key LIKE 'fcr:%';
  DELETE FROM public.factcheck_sessions WHERE id = sid;
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM public.factcheck_claims WHERE session_id = sid)
    AND NOT EXISTS (SELECT FROM private.factcheck_recheck_state s WHERE NOT EXISTS (SELECT FROM public.factcheck_claims c WHERE c.id = s.claim_id)),
    'deleting the session removes its re-check rows and their private records');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM public.credit_ledger WHERE user_id = u AND turn_key LIKE 'fcr:%') = n AND n = 3, 'and the ledger keeps the charges');
END;
$$;
-- Account deletion removes the private rows of the user.
SELECT pg_temp.mkuser(7, 1000);
DO $$
DECLARE u uuid := pg_temp.u(7); a uuid;
BEGIN
  a := pg_temp.claim(pg_temp.session(u), u, 'checked', 'Gone');
  PERFORM public.factcheck_recheck_begin(u, a, true, 100);
  PERFORM pg_temp.assert_true(EXISTS (SELECT FROM private.factcheck_recheck_rate WHERE user_id = u), 'a begin leaves a rate row');
  DELETE FROM auth.users WHERE id = u;
  PERFORM pg_temp.assert_true(NOT EXISTS (SELECT FROM private.factcheck_recheck_rate WHERE user_id = u)
    AND NOT EXISTS (SELECT FROM private.factcheck_recheck_state s WHERE NOT EXISTS (SELECT FROM public.factcheck_claims c WHERE c.id = s.claim_id)),
    'deleting the account removes the rate rows and the private records');
END;
$$;

SELECT pg_temp.invariants('at the end');
ROLLBACK;
