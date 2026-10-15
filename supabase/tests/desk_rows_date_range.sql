-- Desk-row date ranges, case-tolerant filters and the fields a module has (migration
-- 20261015210000; open-work F197, the D3 live round of 2026-10-15).
-- PostgreSQL assertions, no pgTAP. Run only in a disposable database, through run.sh, which applies
-- the migration as a non-superuser (nter_migrator).
-- Bootstrap: the least_privilege chain, research_turn_persistence, the search function as
-- 20260922082308 left it, then 20261015210000_desk_rows_date_range.sql. The vacuity check drops the
-- last: search_desk_rows then has no p_date_from and desk_row_fields does not exist, so the first
-- assertion fails.
-- Proves, as role authenticated over a register shaped like D3's (23 Lok Sabha bills introduced in
-- 2026, 11 assented; Lok Sabha bills of 2025 and Rajya Sabha bills of 2026 beside them):
--   1. One search_desk_rows, with p_date_from and p_date_to; it and desk_row_fields are SECURITY
--      INVOKER and STABLE, executable by authenticated and service_role and not by anon or PUBLIC;
--      the old five-argument named call still resolves.
--   2. The D3 question as a date range answers 23 and 11; "assented" and " lok sabha " match without
--      case; an exact match still decides alone when it finds rows; the total ignores the limit.
--   3. The D3 call itself ({"year":"2026",...}) still returns no row, and desk_row_fields lists the
--      fields the rows carry - no "year" - with the scope's row and dated counts.
--   4. desk_row_date reads ISO dates and timestamps, a month, a bare year and "12-Jan-2026"; anything
--      else is undated. A year-only row is in a range that overlaps its year. A malformed bound is
--      refused (22007). A filter value is bound, never parsed.
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

-- The bill desk's TOTAL for filters and a date range, as a signed-in reader gets it.
CREATE FUNCTION pg_temp.total(f jsonb, d_from text DEFAULT NULL, d_to text DEFAULT NULL, lim int DEFAULT 50)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  SET LOCAL ROLE authenticated;
  SELECT coalesce(max(s.total), 0) INTO n
    FROM public.search_desk_rows('national', 'Bill Passage Probability Index', NULL, f, lim, d_from, d_to) s;
  RESET ROLE;
  RETURN n;
END $$;

CREATE FUNCTION pg_temp.fields(t text, f text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN SET LOCAL ROLE authenticated; r := public.desk_row_fields(t, f); RESET ROLE; RETURN r; END $$;

-- ===== 1. Shape and privileges =====
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM pg_proc WHERE proname = 'search_desk_rows' AND pronamespace = 'public'::regnamespace) = 1
  AND to_regprocedure('public.search_desk_rows(text, text, text, jsonb, int, text, text)') IS NOT NULL,
  'one search_desk_rows, taking p_date_from and p_date_to');
SELECT pg_temp.assert_true(to_regprocedure('public.desk_row_fields(text, text)') IS NOT NULL, 'desk_row_fields exists');
SELECT pg_temp.assert_true((SELECT bool_and(NOT prosecdef AND provolatile = 's') FROM pg_proc
    WHERE oid IN ('public.search_desk_rows(text, text, text, jsonb, int, text, text)'::regprocedure,
                  'public.desk_row_fields(text, text)'::regprocedure)),
  'both are SECURITY INVOKER and STABLE');
SELECT pg_temp.assert_true((SELECT bool_and(has_function_privilege('authenticated', p, 'EXECUTE')
                                         AND has_function_privilege('service_role', p, 'EXECUTE')
                                         AND NOT has_function_privilege('anon', p, 'EXECUTE'))
    FROM unnest(array['public.search_desk_rows(text, text, text, jsonb, int, text, text)',
                      'public.desk_row_fields(text, text)', 'public.desk_row_date(text)',
                      'public.desk_row_date_in(text, text, text)']) p),
  'authenticated and service_role may execute all four; anon may not');
SELECT pg_temp.assert_true(NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.proname IN ('search_desk_rows', 'desk_row_fields', 'desk_row_date', 'desk_row_date_in')
       AND p.pronamespace = 'public'::regnamespace AND a.grantee = 0),
  'PUBLIC has no execute on any of them');
SET LOCAL ROLE anon;
SELECT pg_temp.rejected($$SELECT * FROM public.search_desk_rows('national')$$, '42501', 'anon calling search_desk_rows is refused (42501)');
SELECT pg_temp.rejected($$SELECT public.desk_row_fields('national')$$, '42501', 'anon calling desk_row_fields is refused (42501)');
RESET ROLE;

-- ===== 2. Seed: a register shaped like D3's =====
INSERT INTO public.desk_rows (tier, feature, row_key, row, record_text, snapshot_at)
SELECT 'national', 'Bill Passage Probability Index', 'ls-26-' || i,
       jsonb_build_object('bill_name', 'BILL ' || i, 'house', 'Lok Sabha',
                          'current_stage', CASE WHEN i <= 11 THEN 'Assented' ELSE 'Pending' END,
                          'date_introduced', d, 'date', d),
       'Record: BILL ' || i, now()
  FROM generate_series(1, 23) i,
       LATERAL (SELECT to_char(date '2026-01-05' + (i * 11), 'YYYY-MM-DD') || ' 19:00:00' AS d) x;
INSERT INTO public.desk_rows (tier, feature, row_key, row, record_text, snapshot_at)
SELECT 'national', 'Bill Passage Probability Index', 'ls-25-' || i,
       jsonb_build_object('bill_name', 'OLD BILL ' || i, 'house', 'Lok Sabha', 'current_stage', 'Assented',
                          'date_introduced', '2025-12-0' || i || ' 19:00:00', 'date', '2025-12-0' || i || ' 19:00:00'),
       'Record: OLD BILL ' || i, now()
  FROM generate_series(1, 7) i;
INSERT INTO public.desk_rows (tier, feature, row_key, row, record_text, snapshot_at)
SELECT 'national', 'Bill Passage Probability Index', 'rs-26-' || i,
       jsonb_build_object('bill_name', 'RS BILL ' || i, 'house', 'Rajya Sabha', 'current_stage', 'Assented',
                          'date_introduced', '2026-03-0' || i || ' 19:00:00', 'date', '2026-03-0' || i || ' 19:00:00'),
       'Record: RS BILL ' || i, now()
  FROM generate_series(1, 5) i;
-- Other desks: a court feed dated "12-Jan-2026", a year-only board, and an undated module.
INSERT INTO public.desk_rows (tier, feature, row_key, row, record_text, snapshot_at) VALUES
  ('law', 'Supreme Court Order & Judgment Feed', 'sc-1', '{"title":"A v B","date":"12-Jan-2026"}', 'A v B', now()),
  ('law', 'Supreme Court Order & Judgment Feed', 'sc-2', '{"title":"C v D","date":"03-Nov-2025"}', 'C v D', now()),
  ('carbon', 'Global Carbon Pricing Tracker', 'cp-1', '{"name":"EU ETS","date":"2026"}', 'EU ETS', now()),
  ('carbon', 'Global Carbon Pricing Tracker', 'cp-2', '{"name":"UK ETS","date":"2022 (Feb 2022)"}', 'UK ETS', now()),
  ('state', 'Constituency Register', 'cr-1', '{"name":"Varanasi","state":"UP"}', 'Varanasi', now());

-- ===== 3. The D3 question, answered =====
SELECT pg_temp.assert_true(pg_temp.total('{"house":"Lok Sabha"}', '2026-01-01', '2026-12-31') = 23,
  'Lok Sabha bills introduced in 2026: 23 (not the 2025 ones, not the Rajya Sabha ones)');
SELECT pg_temp.assert_true(pg_temp.total('{"house":"Lok Sabha","current_stage":"Assented"}', '2026-01-01', '2026-12-31') = 11,
  'of them assented: 11');
SELECT pg_temp.assert_true(pg_temp.total('{"house":"Lok Sabha","current_stage":"assented"}', '2026-01-01', '2026-12-31') = 11,
  '"assented" as typed finds "Assented"');
SELECT pg_temp.assert_true(pg_temp.total('{"house":" lok SABHA "}') = 30,
  'case and outer spaces are ignored when nothing matches exactly: 23 + 7 Lok Sabha bills');
SELECT pg_temp.assert_true(pg_temp.total('{"house":"Lok Sabha"}') = 30, 'exact containment is unchanged without dates: 30');
SELECT pg_temp.assert_true(pg_temp.total('{}') = 35, 'no filters, no dates: every bill row, 35');
SELECT pg_temp.assert_true(pg_temp.total('{"house":"Lok Sabha"}', '2026-01-01', '2026-12-31', 5) = 23,
  'TOTAL counts every match, not the page of five');
SELECT pg_temp.assert_true(pg_temp.total('{}', '2026-03-01', '2026-03-31') =
    (SELECT count(*) FROM public.desk_rows WHERE feature = 'Bill Passage Probability Index' AND row ->> 'date' LIKE '2026-03-%'),
  'a month range counts exactly the rows dated in that month');
SELECT pg_temp.assert_true(pg_temp.total('{}', NULL, '2025-12-31') = 7, 'an open lower bound: everything up to 2025, 7');
-- Exact first: a mixed-case value matching exactly decides alone.
INSERT INTO public.desk_rows (tier, feature, row_key, row, record_text, snapshot_at) VALUES
  ('national', 'Bill Passage Probability Index', 'odd-1',
   '{"bill_name":"ODD","house":"Lok Sabha","current_stage":"ASSENTED","date":"2026-06-01 10:00:00"}', 'ODD', now());
SELECT pg_temp.assert_true(pg_temp.total('{"current_stage":"ASSENTED"}') = 1,
  'an exact match that finds rows is the answer: the case-free pass does not run');
SELECT pg_temp.assert_true(pg_temp.total('{"current_stage":"assented"}') = 24,
  'the case-free pass runs only when nothing matched exactly: 11 + 7 + 5 + 1');
DELETE FROM public.desk_rows WHERE row_key = 'odd-1';

-- ===== 4. The D3 call itself, and what the edge function asks next =====
SELECT pg_temp.assert_true(pg_temp.total('{"year":"2026","house":"Lok Sabha"}') = 0,
  'a field no row has still matches nothing (the edge function turns this into an error)');
SELECT pg_temp.assert_true(
  (pg_temp.fields('national', 'Bill Passage Probability Index') -> 'fields')
    = '["bill_name","current_stage","date","date_introduced","house"]'::jsonb,
  'desk_row_fields lists the fields the module''s rows carry, sorted, and no "year"');
SELECT pg_temp.assert_true(pg_temp.fields('national', 'Bill Passage Probability Index') - 'fields' = '{"rows":35,"dated":35}'::jsonb,
  'with the module''s row count and dated row count');
SELECT pg_temp.assert_true(pg_temp.fields('state', 'Constituency Register') = '{"rows":1,"dated":0,"fields":["name","state"]}'::jsonb,
  'an undated module says so');
SELECT pg_temp.assert_true(pg_temp.fields('law', NULL) -> 'fields' = '["date","title"]'::jsonb
    AND (pg_temp.fields('law', NULL) ->> 'rows')::int = 2,
  'without a module, the desk''s fields');
SELECT pg_temp.assert_true(pg_temp.fields('national', 'No Such Module') = '{"rows":0,"dated":0,"fields":[]}'::jsonb,
  'an empty scope has no fields');

-- ===== 5. Dates as the modules write them =====
SELECT pg_temp.assert_true(public.desk_row_date('2026-08-09 19:00:00') = '2026-08-09', 'an ISO timestamp');
SELECT pg_temp.assert_true(public.desk_row_date('2026-08-09') = '2026-08-09', 'an ISO date');
SELECT pg_temp.assert_true(public.desk_row_date('2026-08') = '2026-08', 'a month');
SELECT pg_temp.assert_true(public.desk_row_date('2026') = '2026', 'a bare year');
SELECT pg_temp.assert_true(public.desk_row_date('2022 (Feb 2022)') = '2022', 'a year with a note');
SELECT pg_temp.assert_true(public.desk_row_date('12-Jan-2026') = '2026-01-12', 'a court date, 12-Jan-2026');
SELECT pg_temp.assert_true(public.desk_row_date('3-sep-2025') = '2025-09-03', 'one-digit day, lower-case month');
SELECT pg_temp.assert_true(public.desk_row_date('Since 2014') IS NULL AND public.desk_row_date('') IS NULL
    AND public.desk_row_date(NULL) IS NULL AND public.desk_row_date('12-Foo-2026') IS NULL,
  'anything else is undated');
SELECT pg_temp.assert_true(public.desk_row_date_in('2026', '2026-03-01', '2026-04-30'), 'a year-only row is in a range inside its year');
SELECT pg_temp.assert_true(NOT public.desk_row_date_in('2025-12-31', '2026-01-01', NULL), 'a day before the range is out');
SELECT pg_temp.assert_true(NOT public.desk_row_date_in('Since 2014', NULL, '2030-01-01'), 'an undated row is outside every range');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) FROM public.search_desk_rows('law', 'Supreme Court Order & Judgment Feed', NULL, '{}', 20, '2026-01-01', '2026-12-31')) = 1,
  'the court feed''s 2026 order, by its "12-Jan-2026" date');
SELECT pg_temp.assert_true((SELECT max(total) FROM public.search_desk_rows('carbon', NULL, NULL, '{}', 20, '2026-02-01', '2026-02-28')) = 1,
  'a desk-wide range: the year-only 2026 row overlaps February 2026; 2022 does not');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.search_desk_rows(p_tier => 'national', p_feature => 'Bill Passage Probability Index',
    p_query => NULL, p_filters => '{}'::jsonb, p_limit => 20)) = 20,
  'the five named arguments the old callers send still resolve');
SELECT pg_temp.rejected($$SELECT * FROM public.search_desk_rows('national', NULL, NULL, '{}', 20, '2026', NULL)$$, '22007',
  'a bound that is not YYYY-MM-DD is refused (22007)');
SELECT pg_temp.rejected($$SELECT * FROM public.search_desk_rows('national', NULL, NULL, '{}', 20, NULL, '2026-1-1')$$, '22007',
  'so is a malformed upper bound');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.search_desk_rows('national', NULL, NULL,
    '{"house":"x''); drop table public.desk_rows; --"}', 20)) = 0
  AND to_regclass('public.desk_rows') IS NOT NULL,
  'a filter value is bound, never parsed: an injection payload matches nothing and drops nothing');
RESET ROLE;

ROLLBACK;
