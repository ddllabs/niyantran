-- Live site figures (migration 20261014120000; docs/specs/2026-10-14-live-site-figures.md, F142).
-- PostgreSQL assertions, no pgTAP. Run only in a disposable database, through run.sh, which applies
-- the migration as a non-superuser (nter_migrator).
-- Bootstrap: the least_privilege chain, research_turn_persistence, then
-- 20261014120000_site_figures.sql. The vacuity check drops the last: the function is then missing,
-- so every assertion about it fails.
-- Proves: public.site_figures() counts the bill desk only (not the graph desk or another tier),
-- only indexed documents, and distinct ministries and fronts after the homeApi.mjs normalisation
-- (case, runs of ASCII and Unicode spaces, ends trimmed; null, missing and empty values ignored);
-- returns exactly five keys; follows new rows; is SECURITY DEFINER, STABLE, with an empty
-- search_path; and may be executed by service_role only (anon, authenticated and PUBLIC get 42501).
\set ON_ERROR_STOP on
BEGIN;

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

-- The function as the service role calls it.
CREATE FUNCTION pg_temp.figures() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN SET LOCAL ROLE service_role; r := public.site_figures(); RESET ROLE; RETURN r; END; $$;

-- ===== 1. Shape and privileges =====
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_proc WHERE proname = 'site_figures' AND pronamespace = 'public'::regnamespace) = 1,
  'one overload of site_figures');
SELECT pg_temp.assert_true((SELECT prosecdef AND provolatile = 's' AND prorettype = 'jsonb'::regtype
    FROM pg_proc WHERE oid = 'public.site_figures()'::regprocedure),
  'SECURITY DEFINER, STABLE, returns jsonb');
SELECT pg_temp.assert_true((SELECT proconfig = array['search_path=""'] FROM pg_proc WHERE oid = 'public.site_figures()'::regprocedure),
  'an empty search_path is pinned');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.site_figures()', 'EXECUTE'),
  'service_role may execute');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.site_figures()', 'EXECUTE'),
  'anon may not execute');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.site_figures()', 'EXECUTE'),
  'authenticated may not execute');
SELECT pg_temp.assert_true(NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = 'public.site_figures()'::regprocedure AND a.grantee = 0),
  'PUBLIC has no execute');
SELECT pg_temp.assert_true((SELECT array_agg(grantee::regrole::text ORDER BY grantee::regrole::text)
      FILTER (WHERE grantee <> p.proowner) = array['service_role']
    FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'public.site_figures()'::regprocedure),
  'service_role is the only grantee besides the owner');

SET LOCAL ROLE anon;
SELECT pg_temp.rejected('SELECT public.site_figures()', '42501', 'anon calling site_figures is refused (42501)');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.rejected('SELECT public.site_figures()', '42501', 'authenticated calling site_figures is refused (42501)');
RESET ROLE;

-- ===== 2. Empty tables: zeros, never null =====
SELECT pg_temp.assert_true(pg_temp.figures() - 'as_of' = '{"bills":0,"documents":0,"ministries":0,"fronts":0}'::jsonb,
  'empty tables give four zeros');

-- ===== 3. Seed =====
-- Bill desk: three bills. The graph desk holds the same three (must not count twice); a global-tier
-- row carrying the bill feature's name and a different national feature must not count either.
INSERT INTO public.desk_rows (tier, feature, row_key, row, record_text, snapshot_at)
SELECT 'national', f, 'bill-' || i, jsonb_build_object('id', 'bill-' || i), 'bill ' || i, now()
  FROM generate_series(1, 3) i, unnest(array['Bill Passage Probability Index', 'Policy Intelligence Graph']) f;
INSERT INTO public.desk_rows (tier, feature, row_key, row, record_text, snapshot_at) VALUES
  ('global',   'Bill Passage Probability Index', 'bill-9', '{"id":"bill-9"}', 'wrong tier', now()),
  ('national', 'Cabinet Decisions',              'cab-1',  '{"id":"cab-1"}',  'other desk',  now());

-- Questions: one ministry in five spellings (case, runs of spaces, tab, no-break space, em space,
-- ends), a second ministry, and values that must be ignored.
INSERT INTO public.desk_rows (tier, feature, row_key, row, record_text, snapshot_at)
SELECT 'national', 'Parliamentary Question Database', 'q-' || n, jsonb_build_object('ministry', m), 'q ' || n, now()
  FROM (VALUES
    (1, 'Ministry of Finance'),
    (2, 'ministry of finance'),
    (3, '  MINISTRY   OF   FINANCE  '),
    (4, E'Ministry\tof\nFinance'),
    (5, E'Ministry of Finance　'),
    (6, 'Ministry of Law and Justice'),
    (7, ''),
    (8, '   '),
    (9, E' \t')
  ) v(n, m);
INSERT INTO public.desk_rows (tier, feature, row_key, row, record_text, snapshot_at) VALUES
  ('national', 'Parliamentary Question Database', 'q-10', '{"ministry":null}',  'json null', now()),
  ('national', 'Parliamentary Question Database', 'q-11', '{"member":"x"}',     'no key',    now()),
  -- Another desk's ministry, another tier's question desk: neither counts.
  ('national', 'Policy Intelligence Graph',       'q-12', '{"ministry":"Ministry of Health"}', 'wrong desk', now()),
  ('global',   'Parliamentary Question Database', 'q-13', '{"ministry":"Ministry of Mines"}',  'wrong tier', now());

-- Open Fronts: Ukraine twice (case and trailing space), Gaza, Red Sea spelled with a tab and with
-- a plain space, an empty name, and a national-tier row of the same feature name (not counted).
INSERT INTO public.desk_rows (tier, feature, row_key, row, record_text, snapshot_at) VALUES
  ('global',   'Open Fronts', 'f-1', '{"conflict_name":"Ukraine"}',          'f', now()),
  ('global',   'Open Fronts', 'f-2', '{"conflict_name":"ukraine "}',         'f', now()),
  ('global',   'Open Fronts', 'f-3', '{"conflict_name":"Gaza"}',             'f', now()),
  ('global',   'Open Fronts', 'f-4', E'{"conflict_name":"Red\\tSea"}',       'f', now()),
  ('global',   'Open Fronts', 'f-5', '{"conflict_name":"red sea"}',          'f', now()),
  ('global',   'Open Fronts', 'f-6', '{"conflict_name":""}',                 'f', now()),
  ('global',   'Open Fronts', 'f-7', '{"conflict_name":null}',               'f', now()),
  ('national', 'Open Fronts', 'f-8', '{"conflict_name":"Sudan"}',            'f', now());

-- Documents: two indexed, two not (indexed_at is set last, after the chunks commit).
INSERT INTO public.documents (source_key, title, content_sha256, ocr_text, indexed_at) VALUES
  ('sf:1', 'Indexed one', 'a', 'x', now()),
  ('sf:2', 'Indexed two', 'b', 'x', now() - interval '1 day'),
  ('sf:3', 'Not yet indexed', 'c', 'x', NULL),
  ('sf:4', 'Also not indexed', 'd', 'x', NULL);

-- ===== 4. Counts =====
SELECT pg_temp.assert_true((pg_temp.figures() ->> 'bills')::int = 3,
  'bills counts the bill desk only: 3, not the graph desk, another tier or another desk');
SELECT pg_temp.assert_true((pg_temp.figures() ->> 'documents')::int = 2,
  'documents counts indexed documents only: 2 of 4');
SELECT pg_temp.assert_true((pg_temp.figures() ->> 'ministries')::int = 2,
  'ministries collapses case, space runs, tabs, newlines and Unicode spaces: 2 distinct; empty, blank, null and missing ignored; other desk and tier ignored');
SELECT pg_temp.assert_true((pg_temp.figures() ->> 'fronts')::int = 3,
  'fronts: Ukraine, Gaza and Red Sea are 3 distinct; empty and null ignored; the national-tier row ignored');

-- ===== 5. Shape of the answer =====
SELECT pg_temp.assert_true((SELECT array_agg(k ORDER BY k) = array['as_of', 'bills', 'documents', 'fronts', 'ministries']
    FROM jsonb_object_keys(pg_temp.figures()) k),
  'exactly five keys: as_of, bills, documents, fronts, ministries');
SELECT pg_temp.assert_true((SELECT jsonb_typeof(pg_temp.figures() -> 'bills') = 'number'
    AND jsonb_typeof(pg_temp.figures() -> 'documents') = 'number'
    AND jsonb_typeof(pg_temp.figures() -> 'ministries') = 'number'
    AND jsonb_typeof(pg_temp.figures() -> 'fronts') = 'number'
    AND jsonb_typeof(pg_temp.figures() -> 'as_of') = 'string'),
  'the counts are JSON numbers and as_of is a string');
SELECT pg_temp.assert_true(((pg_temp.figures() ->> 'as_of')::timestamptz) = now(),
  'as_of is the time the counts were taken (now())');

-- ===== 6. New records show =====
INSERT INTO public.desk_rows (tier, feature, row_key, row, record_text, snapshot_at) VALUES
  ('national', 'Bill Passage Probability Index', 'bill-4', '{"id":"bill-4"}', 'new bill', now()),
  ('national', 'Parliamentary Question Database', 'q-14', '{"ministry":"Ministry of Railways"}', 'new', now()),
  ('global',   'Open Fronts', 'f-9', '{"conflict_name":"Sahel"}', 'new', now());
UPDATE public.documents SET indexed_at = now() WHERE source_key = 'sf:3';
SELECT pg_temp.assert_true(pg_temp.figures() - 'as_of' = '{"bills":4,"documents":3,"ministries":3,"fronts":4}'::jsonb,
  'a new bill, ministry, front and indexed document each raise their count by one');
UPDATE public.desk_rows SET row = '{"ministry":"MINISTRY OF RAILWAYS"}'
 WHERE tier = 'national' AND feature = 'Parliamentary Question Database' AND row_key = 'q-6';
SELECT pg_temp.assert_true((pg_temp.figures() ->> 'ministries')::int = 2,
  'the last spelling of Law and Justice re-spelled as Railways by case alone: 2 distinct remain');

ROLLBACK;
