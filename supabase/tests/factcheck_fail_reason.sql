-- Why a fact-check ended in error (migration 20261118090000; open-work F349, task T1; docs/plans/2026-11-17-f349-fact-check-fixes.md).
-- PostgreSQL assertions, no pgTAP. Run only in a disposable database, through run.sh, which applies the migration as a
-- non-superuser (nter_migrator). Bootstrap: the factcheck_sharing chain, then 20261118090000_factcheck_fail_reason.sql.
-- The vacuity check drops the last: the first assertion fails.
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
-- A settled shareable recorded session of the user with three 10 s pieces (one started minute).
CREATE FUNCTION pg_temp.run(p_user uuid, p_video text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r jsonb := public.factcheck_start(p_user, p_video, 'chan', 'recorded', 0, 5, true); sid uuid; i integer;
BEGIN
  IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: start refused: %', r; END IF;
  sid := (r ->> 'session_id')::uuid;
  r := public.factcheck_mark_shareable(p_user, sid);
  IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: mark refused: %', r; END IF;
  FOR i IN 0..2 LOOP
    r := public.factcheck_piece_store(p_user, sid, i + 1, i * 10, (i + 1) * 10, 'Line ' || p_video || ' ' || i);
    IF r ->> 'ok' <> 'true' THEN RAISE EXCEPTION 'FAIL: piece % refused: %', i, r; END IF;
  END LOOP;
  PERFORM public.factcheck_settle(p_user, sid);
  UPDATE public.factcheck_sessions SET ended_at = now() - interval '10 minutes' WHERE id = sid;
  RETURN sid;
END;
$$;
CREATE FUNCTION pg_temp.cl(p_session uuid, p_status text, p_text text, p_reason text DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.factcheck_claims (session_id, user_id, video_id, video_kind, position_s, spoken_at, quote, claim_en, kind, status,
    verdict, reason, sources, checked_at, shared, fail_reason)
  SELECT p_session, s.user_id, s.video_id, s.video_kind, 12.5, now() - interval '5 minutes', 'Quote ' || p_text, 'Claim ' || p_text, 'claim',
    p_status, CASE WHEN p_status = 'checked' THEN 'supported' END, CASE WHEN p_status = 'checked' THEN 'Because ' || p_text END,
    CASE WHEN p_status = 'checked' THEN '[{"url":"https://example.invalid/a","title":"A"}]'::jsonb ELSE '[]'::jsonb END,
    CASE WHEN p_status IN ('checked', 'error') THEN now() - interval '4 minutes' END, true, p_reason
  FROM public.factcheck_sessions s WHERE s.id = p_session
  RETURNING id;
$$;

-- 1. The column and its constraints -------------------------------------------------------------------------------------------
SELECT pg_temp.assert_true((SELECT data_type = 'text' AND is_nullable = 'YES' AND column_default IS NULL FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'factcheck_claims' AND column_name = 'fail_reason'), 'fail_reason exists: text, nullable, no default');

SELECT pg_temp.mkuser(1, 1000), pg_temp.mkuser(2, 500);
DELETE FROM public.app_flags WHERE key = 'livetv_factcheck';
INSERT INTO public.app_flags (key, value) VALUES ('livetv_factcheck',
  '{"enabled":true,"audience":"all","credits_per_minute":2,"recheck_credits":100,"share_recorded":true,"unlock_credits_per_minute":100}');
CREATE TEMP TABLE ids (k text PRIMARY KEY, id uuid NOT NULL);

DO $$
DECLARE a uuid := pg_temp.u(1); sid uuid := pg_temp.run(pg_temp.u(1), 'VF'); code text; cid uuid;
BEGIN
  INSERT INTO ids VALUES ('s', sid);
  FOREACH code IN ARRAY ARRAY['no_label', 'bad_label', 'label_conflict', 'no_sources'] LOOP
    cid := pg_temp.cl(sid, 'error', 'e ' || code, code);
    INSERT INTO ids VALUES ('e_' || code, cid);
    PERFORM pg_temp.assert_true((SELECT fail_reason = code AND status = 'error' FROM public.factcheck_claims WHERE id = cid), 'an error row accepts ' || code);
  END LOOP;
  INSERT INTO ids VALUES ('e_none', pg_temp.cl(sid, 'error', 'e none'));
  INSERT INTO ids VALUES ('ok', pg_temp.cl(sid, 'checked', 'ok'));
  PERFORM pg_temp.assert_true((SELECT fail_reason IS NULL FROM public.factcheck_claims WHERE id = (SELECT id FROM ids WHERE k = 'e_none')),
    'an error row with no reason is still allowed (rows from before this migration, and a provider-side abandoned re-check)');
  PERFORM pg_temp.rejected(format($q$SELECT pg_temp.cl(%L, 'error', 'bad', 'timeout')$q$, sid), '23514', 'an unknown code is rejected');
  PERFORM pg_temp.rejected(format($q$SELECT pg_temp.cl(%L, 'error', 'bad', '')$q$, sid), '23514', 'an empty code is rejected');
  PERFORM pg_temp.rejected(format($q$SELECT pg_temp.cl(%L, 'checked', 'bad', 'no_sources')$q$, sid), '23514', 'a code on a checked row is rejected');
  PERFORM pg_temp.rejected(format($q$SELECT pg_temp.cl(%L, 'pending', 'bad', 'no_label')$q$, sid), '23514', 'a code on a pending row is rejected');
  PERFORM pg_temp.rejected(format($q$SELECT pg_temp.cl(%L, 'needs_context', 'bad', 'no_label')$q$, sid), '23514', 'a code on a needs_context row is rejected');
  -- the Edge function's finish: a pending row saved as error with its code, in one update
  cid := pg_temp.cl(sid, 'pending', 'pend');
  UPDATE public.factcheck_claims SET status = 'error', verdict = NULL, reason = NULL, sources = '[]', checked_at = now(), fail_reason = 'no_label' WHERE id = cid;
  PERFORM pg_temp.assert_true((SELECT status = 'error' AND fail_reason = 'no_label' FROM public.factcheck_claims WHERE id = cid), 'a pending row is saved as error with its code in one update');
  PERFORM pg_temp.rejected(format($q$UPDATE public.factcheck_claims SET fail_reason = 'no_label' WHERE id = %L$q$, (SELECT id FROM ids WHERE k = 'ok')), '23514',
    'a checked row cannot be given a code later');
  PERFORM pg_temp.rejected(format($q$UPDATE public.factcheck_claims SET status = 'checked' WHERE id = %L$q$, (SELECT id FROM ids WHERE k = 'e_no_sources')), '23514',
    'an error row with a code cannot become checked without clearing it');
END;
$$;

-- 2. factcheck_video_view carries the field --------------------------------------------------------------------------------------
DO $$
DECLARE a uuid := pg_temp.u(1); b uuid := pg_temp.u(2); s uuid := (SELECT id FROM ids WHERE k = 's'); v jsonb; st jsonb; claims jsonb;
BEGIN
  v := public.factcheck_video_view(a, 'VF', true);
  st := (SELECT e FROM jsonb_array_elements(v -> 'stretches') e WHERE e ->> 'stretch_id' = s::text);
  PERFORM pg_temp.assert_true(st ->> 'access' = 'own', 'the runner reads their own stretch');
  claims := st -> 'claims';
  PERFORM pg_temp.assert_true((SELECT e ->> 'fail_reason' FROM jsonb_array_elements(claims) e WHERE e ->> 'id' = (SELECT id::text FROM ids WHERE k = 'e_no_sources')) = 'no_sources',
    'an own error claim returns its fail_reason');
  PERFORM pg_temp.assert_true((SELECT e ->> 'fail_reason' FROM jsonb_array_elements(claims) e WHERE e ->> 'id' = (SELECT id::text FROM ids WHERE k = 'e_bad_label')) = 'bad_label',
    'another code comes back as written');
  PERFORM pg_temp.assert_true((SELECT e ? 'fail_reason' AND jsonb_typeof(e -> 'fail_reason') = 'null' FROM jsonb_array_elements(claims) e WHERE e ->> 'id' = (SELECT id::text FROM ids WHERE k = 'ok')),
    'a checked claim carries fail_reason as JSON null');
  PERFORM pg_temp.assert_true((SELECT e ? 'fail_reason' AND jsonb_typeof(e -> 'fail_reason') = 'null' FROM jsonb_array_elements(claims) e WHERE e ->> 'id' = (SELECT id::text FROM ids WHERE k = 'e_none')),
    'an error claim with no reason carries fail_reason as JSON null');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM jsonb_array_elements(claims) e WHERE NOT e ? 'fail_reason') = 0, 'every claim object has the key');
  -- a payer who unlocked reads the same field
  PERFORM pg_temp.assert_true(public.factcheck_unlock(b, s, true, 100) ->> 'ok' = 'true', 'the payer unlocks the stretch');
  v := public.factcheck_video_view(b, 'VF', true);
  st := (SELECT e FROM jsonb_array_elements(v -> 'stretches') e WHERE e ->> 'stretch_id' = s::text);
  PERFORM pg_temp.assert_true(st ->> 'access' = 'unlocked' AND (SELECT e ->> 'fail_reason' FROM jsonb_array_elements(st -> 'claims') e
    WHERE e ->> 'id' = (SELECT id::text FROM ids WHERE k = 'e_label_conflict')) = 'label_conflict', 'an unlocked stretch returns fail_reason too');
  PERFORM pg_temp.assert_true(NOT (v::text LIKE '%' || a::text || '%'), 'and still no user id');
END;
$$;

-- 3. Functions left alone still work ---------------------------------------------------------------------------------------------
DO $$
DECLARE a uuid := pg_temp.u(1); ok_id uuid := (SELECT id FROM ids WHERE k = 'ok'); r jsonb;
BEGIN
  r := public.factcheck_recheck_begin(a, ok_id, true, 100);
  PERFORM pg_temp.assert_true(r ->> 'ok' = 'true', 'a re-check begins: ' || r::text);
  PERFORM pg_temp.assert_true((SELECT status = 'pending' AND fail_reason IS NULL FROM public.factcheck_claims WHERE id = (r ->> 'claim_id')::uuid),
    'the new re-check row is pending with no fail_reason');
  PERFORM pg_temp.assert_true((SELECT (private.factcheck_newest_result(ok_id)).fail_reason IS NULL), 'factcheck_newest_result carries the column through its row type');
END;
$$;
ROLLBACK;
