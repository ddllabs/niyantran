-- The administrator's list of open fact-check reports (migration 20261121090000; open-work F362;
-- docs/specs/2026-11-18-live-tv-admin-reports.md). PostgreSQL assertions, no pgTAP. Run only in a disposable database, through
-- run.sh, which applies the migration as a non-superuser (nter_migrator).
-- Bootstrap: the factcheck_lengths chain (everything through the session-lengths migration), then
-- 20261121090000_factcheck_reports_admin.sql as a non-superuser. The vacuity check drops the last: the function is missing and the
-- first assertion fails.
--
-- Users (00000000-0000-4000-8000-0000000ff0NN): 01 owner of every claim, 09 administrator, 10 non-administrator,
-- 21..32 reporters.
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
CREATE FUNCTION pg_temp.u(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-0000000ff' || lpad(n::text, 3, '0'))::uuid;
$$;
CREATE FUNCTION pg_temp.mkuser(n integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := pg_temp.u(n);
BEGIN
  INSERT INTO auth.users (id, email, created_at) VALUES (v, v::text || '@example.invalid', now());
  RETURN v;
END;
$$;
-- A settled session of the owner over a video and channel.
CREATE FUNCTION pg_temp.sess(p_user uuid, p_video text, p_channel text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.factcheck_sessions (id, user_id, video_id, channel_id, video_kind, minutes_bought, credits_per_minute, credits_held,
    started_at, last_activity_at, ended_at, status, minutes_used, credits_charged, shareable)
  VALUES (v, p_user, p_video, p_channel, 'recorded', 5, 1, 5, now() - interval '3 hours', now() - interval '3 hours',
    now() - interval '2 hours', 'settled', 1, 1, true);
  RETURN v;
END;
$$;
CREATE FUNCTION pg_temp.cl(p_session uuid, p_text text, p_shared boolean, p_hidden boolean DEFAULT false) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.factcheck_claims (session_id, user_id, video_id, video_kind, position_s, spoken_at, quote, claim_en, claimant, reported_by,
    kind, status, verdict, reason, sources, checked_at, shared, hidden_at)
  SELECT p_session, s.user_id, s.video_id, s.video_kind, 12.5, now() - interval '5 minutes', 'Quote ' || p_text, 'Claim ' || p_text, 'The Speaker',
    'The Channel', 'claim', 'checked', 'contradicted', 'Because ' || p_text,
    '[{"url":"https://example.invalid/a","title":"A"}]'::jsonb, now() - interval '4 minutes', p_shared, CASE WHEN p_hidden THEN now() END
  FROM public.factcheck_sessions s WHERE s.id = p_session
  RETURNING id;
$$;
-- A report by user n on a claim, made p_ago ago; handled when p_handled.
CREATE FUNCTION pg_temp.rep(p_claim uuid, n integer, p_text text, p_ago interval, p_handled boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.factcheck_reports (claim_id, user_id, reason, created_at, handled_at)
  VALUES (p_claim, pg_temp.u(n), p_text, now() - p_ago, CASE WHEN p_handled THEN now() END);
$$;
-- Calls the function as a signed-in user (or another role) and puts the role back. A raised error ends the helper where it
-- stands; the caller's savepoint (pg_temp.refused) undoes the role.
CREATE FUNCTION pg_temp.call_as(p_role text, p_sub uuid, p_off integer, p_lim integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  v := public.factcheck_reports_admin(p_off, p_lim);
  EXECUTE 'RESET ROLE';
  RETURN v;
END;
$$;
CREATE FUNCTION pg_temp.admin_call(p_off integer, p_lim integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.call_as('authenticated', pg_temp.u(9), p_off, p_lim);
$$;
-- The call must raise state p_state (and, when given, a message containing p_text); no data comes back.
CREATE FUNCTION pg_temp.refused(p_role text, p_sub uuid, p_state text, p_text text, p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  BEGIN
    v := pg_temp.call_as(p_role, p_sub, 0, 50);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_text IS NOT NULL AND position(p_text IN SQLERRM) = 0) THEN
      RAISE EXCEPTION 'FAIL: % (expected % %, got %: %)', p_label, p_state, p_text, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: % (%)', p_label, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % (the call was accepted and returned %)', p_label, left(v::text, 200);
END;
$$;
CREATE FUNCTION pg_temp.keys(j jsonb) RETURNS text[] LANGUAGE sql AS $$
  SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(j) k;
$$;

-- 0. The function and who may call it (the first assertion fails while the migration is missing) --------------------------------
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.factcheck_reports_admin(integer,integer)')
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND p.prorettype = 'jsonb'::regtype),
  'factcheck_reports_admin exists, SECURITY DEFINER, with search_path '''', returning jsonb');
SELECT pg_temp.assert_true(has_function_privilege('authenticated', 'public.factcheck_reports_admin(integer,integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.factcheck_reports_admin(integer,integer)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.factcheck_reports_admin(integer,integer)', 'EXECUTE')
    AND NOT has_function_privilege('public', 'public.factcheck_reports_admin(integer,integer)', 'EXECUTE'),
  'only authenticated may execute it (not anon, service_role or public)');
-- No table or policy is added or widened: the reports table keeps its one select policy, and nobody gains a write grant.
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'factcheck_reports')
    AND NOT has_table_privilege('authenticated', 'public.factcheck_reports', 'INSERT, UPDATE, DELETE')
    AND NOT has_table_privilege('anon', 'public.factcheck_reports', 'SELECT'),
  'factcheck_reports keeps its one policy and its grants');

-- 1. Fixture data ---------------------------------------------------------------------------------------------------------------
SELECT pg_temp.mkuser(1);
SELECT pg_temp.mkuser(9);
SELECT pg_temp.mkuser(10);
SELECT pg_temp.mkuser(n) FROM generate_series(21, 32) n;
UPDATE public.user_profiles SET role = 'admin', status = 'active' WHERE user_id = pg_temp.u(9);
UPDATE public.user_profiles SET status = 'active' WHERE user_id = pg_temp.u(10);
SELECT pg_temp.assert_true((SELECT role = 'admin' FROM public.user_profiles WHERE user_id = pg_temp.u(9))
    AND (SELECT role <> 'admin' FROM public.user_profiles WHERE user_id = pg_temp.u(10)), 'the fixture has one administrator and one ordinary user');

CREATE TEMP TABLE ids (k text PRIMARY KEY, id uuid);
GRANT SELECT ON ids TO PUBLIC;
DO $$
DECLARE s1 uuid := pg_temp.sess(pg_temp.u(1), 'VIDEO000001', 'chan-one'); s2 uuid := pg_temp.sess(pg_temp.u(1), 'VIDEO000002', 'chan-two');
  a uuid; b uuid; c uuid; d uuid; e uuid; f uuid; i integer;
BEGIN
  -- a: shared, three open reports, newest 1 hour ago
  a := pg_temp.cl(s1, 'a', true);
  PERFORM pg_temp.rep(a, 21, 'ra1', interval '3 hours'); PERFORM pg_temp.rep(a, 22, 'ra2', interval '2 hours'); PERFORM pg_temp.rep(a, 23, 'ra3', interval '1 hour');
  -- b: the owner's own claim, not shared (spec D10), one report with markup in it, 30 minutes ago
  b := pg_temp.cl(s2, 'b', false);
  PERFORM pg_temp.rep(b, 24, '<script>alert(1)</script> & "quoted"', interval '30 minutes');
  -- c: twelve open reports, the newest 5 minutes ago ('rc01'), the oldest 16 minutes ago ('rc12')
  c := pg_temp.cl(s1, 'c', true);
  FOR i IN 1..12 LOOP PERFORM pg_temp.rep(c, 20 + i, 'rc' || lpad(i::text, 2, '0'), (i + 4) * interval '1 minute'); END LOOP;
  -- d: hidden, one open report 20 minutes ago (spec D11: listed, with hidden_at set)
  d := pg_temp.cl(s2, 'd', true, true);
  PERFORM pg_temp.rep(d, 25, 'rd1', interval '20 minutes');
  -- e: every report dismissed: not listed
  e := pg_temp.cl(s1, 'e', true);
  PERFORM pg_temp.rep(e, 26, 're1', interval '10 minutes', true); PERFORM pg_temp.rep(e, 27, 're2', interval '9 minutes', true);
  -- f: one dismissed (the newest) and one open (older): counted and shown as one open report
  f := pg_temp.cl(s1, 'f', true);
  PERFORM pg_temp.rep(f, 28, 'rf-dismissed', interval '1 minute', true); PERFORM pg_temp.rep(f, 29, 'rf-open', interval '45 minutes');
  INSERT INTO ids VALUES ('s1', s1), ('s2', s2), ('a', a), ('b', b), ('c', c), ('d', d), ('e', e), ('f', f);
END;
$$;

-- 2. An administrator gets the rows ---------------------------------------------------------------------------------------------
CREATE TEMP TABLE got (j jsonb);
GRANT ALL ON got TO PUBLIC;
INSERT INTO got SELECT pg_temp.admin_call(0, 50);
SELECT pg_temp.assert_true((SELECT (j ->> 'total')::int = 5 AND jsonb_array_length(j -> 'rows') = 5 FROM got),
  'an administrator gets the five claims with an open report, and the total is five');
SELECT pg_temp.assert_true((SELECT array_agg(r ->> 'claim_id' ORDER BY o) = ARRAY[(SELECT id::text FROM ids WHERE k = 'c'), (SELECT id::text FROM ids WHERE k = 'd'),
      (SELECT id::text FROM ids WHERE k = 'b'), (SELECT id::text FROM ids WHERE k = 'f'), (SELECT id::text FROM ids WHERE k = 'a')]
    FROM got, jsonb_array_elements(j -> 'rows') WITH ORDINALITY AS t(r, o)),
  'the claims come newest report first (c, d, b, f, a)');
SELECT pg_temp.assert_true((SELECT NOT EXISTS (SELECT FROM jsonb_array_elements(j -> 'rows') r WHERE r ->> 'claim_id' = (SELECT id::text FROM ids WHERE k = 'e')) FROM got),
  'a claim whose reports are all dismissed is not listed');
SELECT pg_temp.assert_true((SELECT (r ->> 'report_count')::int = 1 AND r -> 'report_reasons' = '["rf-open"]'::jsonb
    FROM got, jsonb_array_elements(j -> 'rows') r WHERE r ->> 'claim_id' = (SELECT id::text FROM ids WHERE k = 'f')),
  'a dismissed report is neither counted nor shown beside an open one');
SELECT pg_temp.assert_true((SELECT (r ->> 'report_count')::int = 3 AND r -> 'report_reasons' = '["ra3","ra2","ra1"]'::jsonb
      AND (r ->> 'newest_report_at')::timestamptz = (SELECT max(created_at) FROM public.factcheck_reports WHERE claim_id = (SELECT id FROM ids WHERE k = 'a'))
    FROM got, jsonb_array_elements(j -> 'rows') r WHERE r ->> 'claim_id' = (SELECT id::text FROM ids WHERE k = 'a')),
  'reports group by claim: the count, the newest time, the reasons newest first');
SELECT pg_temp.assert_true((SELECT (r ->> 'report_count')::int = 12 AND jsonb_array_length(r -> 'report_reasons') = 10
      AND r -> 'report_reasons' = (SELECT jsonb_agg('rc' || lpad(i::text, 2, '0') ORDER BY i) FROM generate_series(1, 10) i)
    FROM got, jsonb_array_elements(j -> 'rows') r WHERE r ->> 'claim_id' = (SELECT id::text FROM ids WHERE k = 'c')),
  'twelve reports count as twelve, but only the ten newest reasons come back, newest first');
SELECT pg_temp.assert_true((SELECT r ->> 'hidden_at' IS NOT NULL AND r ->> 'report_count' = '1' AND r -> 'report_reasons' = '["rd1"]'::jsonb
    FROM got, jsonb_array_elements(j -> 'rows') r WHERE r ->> 'claim_id' = (SELECT id::text FROM ids WHERE k = 'd')),
  'an open report on a hidden claim is listed, with hidden_at set');
SELECT pg_temp.assert_true((SELECT r ->> 'hidden_at' IS NULL AND (r ->> 'shared')::boolean = false AND r ->> 'claim_en' = 'Claim b'
      AND r -> 'report_reasons' = to_jsonb(ARRAY['<script>alert(1)</script> & "quoted"'])
    FROM got, jsonb_array_elements(j -> 'rows') r WHERE r ->> 'claim_id' = (SELECT id::text FROM ids WHERE k = 'b')),
  'a report on an unshared claim is listed with its claim text, and the reason comes back exactly as stored');
SELECT pg_temp.assert_true((SELECT r ->> 'video_id' = 'VIDEO000001' AND r ->> 'channel_id' = 'chan-one' AND r ->> 'video_kind' = 'recorded'
      AND r ->> 'claim_en' = 'Claim a' AND r ->> 'status' = 'checked' AND r ->> 'verdict' = 'contradicted' AND r ->> 'verdict_reason' = 'Because a'
      AND r -> 'sources' = '[{"url":"https://example.invalid/a","title":"A"}]'::jsonb AND (r ->> 'shared')::boolean
    FROM got, jsonb_array_elements(j -> 'rows') r WHERE r ->> 'claim_id' = (SELECT id::text FROM ids WHERE k = 'a'))
  AND (SELECT r ->> 'channel_id' = 'chan-two' AND r ->> 'video_id' = 'VIDEO000002'
    FROM got, jsonb_array_elements(j -> 'rows') r WHERE r ->> 'claim_id' = (SELECT id::text FROM ids WHERE k = 'b')),
  'each row carries its claim fields, with the channel from the claim''s session');

-- 3. No identity ----------------------------------------------------------------------------------------------------------------
SELECT pg_temp.assert_true((SELECT bool_and(pg_temp.keys(r) = ARRAY['channel_id', 'claim_en', 'claim_id', 'hidden_at', 'newest_report_at', 'report_count',
      'report_reasons', 'shared', 'sources', 'status', 'verdict', 'verdict_reason', 'video_id', 'video_kind'])
    FROM got, jsonb_array_elements(j -> 'rows') r) AND (SELECT pg_temp.keys(j) = ARRAY['rows', 'total'] FROM got),
  'every row has exactly the agreed keys, and the result has only rows and total');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM got, (SELECT pg_temp.u(n)::text AS id FROM generate_series(1, 40) n) users
      WHERE position(users.id IN got.j::text) > 0),
  'the result contains no user id of any reporter, owner or administrator');
SELECT pg_temp.assert_true((SELECT position('@' IN j::text) = 0 AND (SELECT count(*) = 0 FROM auth.users u WHERE u.id::text LIKE '00000000-0000-4000-8000-0000000ff%' AND position(u.email IN j::text) > 0) FROM got),
  'the result contains no e-mail address');
SELECT pg_temp.assert_true((SELECT position('user_id' IN j::text) = 0 AND position('session' IN j::text) = 0 FROM got)
    AND (SELECT count(*) = 0 FROM got, ids WHERE ids.k IN ('s1', 's2') AND position(ids.id::text IN got.j::text) > 0),
  'the result contains no session id and no user or session key');

-- 4. Who is refused -------------------------------------------------------------------------------------------------------------
SELECT pg_temp.refused('authenticated', pg_temp.u(10), '42501', 'Platform administrators only', 'a signed-in non-administrator is refused with 42501 and no data');
SELECT pg_temp.refused('authenticated', gen_random_uuid(), '42501', 'Platform administrators only', 'a signed-in user with no profile is refused');
SELECT pg_temp.refused('authenticated', NULL, '42501', 'Platform administrators only', 'a signed-in role with no user id is refused');
SELECT pg_temp.refused('anon', NULL, '42501', NULL, 'anon cannot execute it');
SELECT pg_temp.refused('service_role', NULL, '42501', NULL, 'service_role cannot execute it');
SELECT pg_temp.refused('service_role', pg_temp.u(9), '42501', NULL, 'service_role cannot execute it even carrying the administrator''s id');
UPDATE public.user_profiles SET status = 'suspended' WHERE user_id = pg_temp.u(9);
SELECT pg_temp.refused('authenticated', pg_temp.u(9), '42501', 'Platform administrators only', 'a suspended administrator is refused');
UPDATE public.user_profiles SET status = 'active' WHERE user_id = pg_temp.u(9);

-- 5. Paging and clamps: 50 more claims with one older report each, so 55 in all -------------------------------------------------
DO $$
DECLARE s uuid := (SELECT id FROM ids WHERE k = 's1'); i integer; cid uuid;
BEGIN
  FOR i IN 1..50 LOOP
    cid := pg_temp.cl(s, 'fill' || lpad(i::text, 2, '0'), true);
    PERFORM pg_temp.rep(cid, 21, 'fill' || lpad(i::text, 2, '0'), interval '2 days' + i * interval '1 minute');
  END LOOP;
END;
$$;
SELECT pg_temp.assert_true((SELECT (j ->> 'total')::int = 55 AND jsonb_array_length(j -> 'rows') = 50 FROM (SELECT pg_temp.admin_call(0, 50) AS j) x),
  'with 55 reported claims: total 55, a page of 50');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(j -> 'rows') = 1 AND (j ->> 'total')::int = 55 FROM (SELECT pg_temp.admin_call(0, 0) AS j) x),
  'limit 0 is raised to 1');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(j -> 'rows') = 1 FROM (SELECT pg_temp.admin_call(0, -7) AS j) x), 'a negative limit is raised to 1');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(j -> 'rows') = 50 FROM (SELECT pg_temp.admin_call(0, 51) AS j) x), 'limit 51 is cut to 50');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(j -> 'rows') = 50 FROM (SELECT pg_temp.admin_call(0, 1000) AS j) x), 'limit 1000 is cut to 50');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(j -> 'rows') = 50 FROM (SELECT pg_temp.admin_call(0, NULL) AS j) x), 'a null limit means 50');
SELECT pg_temp.assert_true((SELECT (a.j -> 'rows') = (b.j -> 'rows') FROM (SELECT pg_temp.admin_call(-5, 50) AS j) a, (SELECT pg_temp.admin_call(0, 50) AS j) b)
    AND (SELECT (a.j -> 'rows') = (b.j -> 'rows') FROM (SELECT pg_temp.admin_call(NULL, 50) AS j) a, (SELECT pg_temp.admin_call(0, 50) AS j) b),
  'a negative or null offset is the same as 0');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(j -> 'rows') = 5 AND (j ->> 'total')::int = 55 FROM (SELECT pg_temp.admin_call(50, 50) AS j) x),
  'the second page holds the last five, and the total is unchanged');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(j -> 'rows') = 0 AND (j ->> 'total')::int = 55 FROM (SELECT pg_temp.admin_call(500, 50) AS j) x),
  'past the end: no rows, the total is still 55');
SELECT pg_temp.assert_true((SELECT (a.j -> 'rows' -> 0) = (b.j -> 'rows' -> 2) AND (a.j -> 'rows' -> 1) = (b.j -> 'rows' -> 3)
    FROM (SELECT pg_temp.admin_call(2, 2) AS j) a, (SELECT pg_temp.admin_call(0, 50) AS j) b),
  'an offset skips that many claims, in the same order');
SELECT pg_temp.assert_true((SELECT bool_and((r ->> 'newest_report_at')::timestamptz >= (nxt ->> 'newest_report_at')::timestamptz)
    FROM (SELECT r, lead(r) OVER (ORDER BY o) AS nxt FROM jsonb_array_elements(pg_temp.admin_call(0, 50) -> 'rows') WITH ORDINALITY t(r, o)) z WHERE nxt IS NOT NULL),
  'across the full page the order is newest report first');

-- 6. Reading changes nothing ------------------------------------------------------------------------------------------------------
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.factcheck_reports WHERE handled_at IS NOT NULL AND claim_id NOT IN (SELECT id FROM ids WHERE k IN ('e', 'f'))),
  'listing handled or changed nothing');

-- 7. Ties, and sources as the pipeline stores them ----------------------------------------------------------------------------------
-- Two claims whose newest open report is the very same instant come in claim id order. A third claim carries sources in the
-- shape check.ts parseSources writes: up to 8 {url, title} items, http(s), no fragment, the title the host name when the
-- provider gave none, query strings kept. They sit above everything else (reports 1 second old), so the first rows are theirs.
DO $$
DECLARE s uuid := (SELECT id FROM ids WHERE k = 's2'); t1 uuid; t2 uuid; h uuid; srcs jsonb;
BEGIN
  t1 := pg_temp.cl(s, 't1', true); t2 := pg_temp.cl(s, 't2', true);
  PERFORM pg_temp.rep(t1, 21, 'tie', interval '2 seconds'); PERFORM pg_temp.rep(t2, 22, 'tie', interval '2 seconds');
  SELECT jsonb_agg(jsonb_build_object('url', 'https://news' || i || '.example.invalid/story/' || i || '?utm_source=x&id=' || i * 7,
           'title', CASE WHEN i % 2 = 0 THEN 'news' || i || '.example.invalid' ELSE 'Headline ' || i END) ORDER BY i)
    INTO srcs FROM generate_series(1, 8) i;
  h := pg_temp.cl(s, 'h', true);
  UPDATE public.factcheck_claims SET sources = srcs WHERE id = h;
  PERFORM pg_temp.rep(h, 23, 'real sources', interval '1 second');
  INSERT INTO ids VALUES ('t1', t1), ('t2', t2), ('h', h);
END;
$$;
DELETE FROM got;
INSERT INTO got SELECT pg_temp.admin_call(0, 50);
SELECT pg_temp.assert_true((SELECT (j -> 'rows' -> 1 ->> 'claim_id') = (SELECT id::text FROM ids WHERE k = 't1' AND id < (SELECT id FROM ids WHERE k = 't2')
        UNION ALL SELECT id::text FROM ids WHERE k = 't2' AND id < (SELECT id FROM ids WHERE k = 't1') LIMIT 1)
      AND (j -> 'rows' -> 2 ->> 'claim_id') = (SELECT id::text FROM ids WHERE k = 't1' AND id > (SELECT id FROM ids WHERE k = 't2')
        UNION ALL SELECT id::text FROM ids WHERE k = 't2' AND id > (SELECT id FROM ids WHERE k = 't1') LIMIT 1)
      AND j -> 'rows' -> 1 ->> 'newest_report_at' = j -> 'rows' -> 2 ->> 'newest_report_at'
    FROM got),
  'two claims with the same newest report time come in claim id order');
SELECT pg_temp.assert_true((SELECT j -> 'rows' -> 0 ->> 'claim_id' = (SELECT id::text FROM ids WHERE k = 'h') FROM got),
  'the claim with the 1-second-old report comes first');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(r -> 'sources') = 8
      AND r -> 'sources' = (SELECT sources FROM public.factcheck_claims WHERE id = (SELECT id FROM ids WHERE k = 'h'))
      AND pg_temp.keys(r) = ARRAY['channel_id', 'claim_en', 'claim_id', 'hidden_at', 'newest_report_at', 'report_count',
        'report_reasons', 'shared', 'sources', 'status', 'verdict', 'verdict_reason', 'video_id', 'video_kind']
    FROM got, jsonb_array_elements(j -> 'rows') r WHERE r ->> 'claim_id' = (SELECT id::text FROM ids WHERE k = 'h')),
  'eight sources in the pipeline''s shape come back as stored, in a row with only the agreed keys');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM got, (SELECT pg_temp.u(n)::text AS id FROM generate_series(1, 40) n) users
      WHERE position(users.id IN got.j::text) > 0)
    AND (SELECT count(*) = 0 FROM got, ids WHERE ids.k IN ('s1', 's2') AND position(ids.id::text IN got.j::text) > 0)
    AND (SELECT position('@' IN j::text) = 0 AND position('user_id' IN j::text) = 0 FROM got),
  'with real-shaped sources and ties in the page, there is still no user id, e-mail or session id');

ROLLBACK;
