-- Disposable PG assertions for the analytics rate limit. Run on the isolated
-- least-privilege fixture plus research-turn persistence and
-- 20260928130000_analytics_rate_limit.sql; never against a hosted project.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END; $$;
CREATE FUNCTION pg_temp.rejected(statement text, expected_state text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN RAISE EXCEPTION 'FAIL: % expected % got %: %', label, expected_state, SQLSTATE, SQLERRM; END IF;
    RAISE NOTICE 'PASS: %', label; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % accepted', label;
END; $$;

SELECT pg_temp.assert_true(to_regclass('public.analytics_rate_windows') IS NOT NULL, 'counter table exists');
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.analytics_rate_windows'::regclass), 'RLS is enabled');

-- Nobody but service_role can touch the counter or call the functions.
DO $$
DECLARE actor text; privilege text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['anon','authenticated','public'] LOOP
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, 'public.analytics_rate_windows', privilege), actor || ' cannot ' || privilege || ' the counter');
    END LOOP;
    PERFORM pg_temp.assert_true(NOT has_function_privilege(actor, 'public.analytics_rate_hit(text, integer, integer)', 'EXECUTE'), actor || ' cannot count hits');
    PERFORM pg_temp.assert_true(NOT has_function_privilege(actor, 'public.purge_analytics_rate_windows()', 'EXECUTE'), actor || ' cannot purge');
  END LOOP;
  PERFORM pg_temp.assert_true(has_function_privilege('service_role', 'public.analytics_rate_hit(text, integer, integer)', 'EXECUTE'), 'service_role can count hits');
  PERFORM pg_temp.assert_true(has_function_privilege('service_role', 'public.purge_analytics_rate_windows()', 'EXECUTE'), 'service_role can purge');
END $$;

SET LOCAL ROLE service_role;

-- 60 a minute: the 60th hit is allowed, the 61st is not, and another bucket
-- is counted separately. A one-hour window keeps the test clear of a boundary.
DO $$
DECLARE i integer; ok boolean;
BEGIN
  FOR i IN 1..60 LOOP
    ok := public.analytics_rate_hit('ip:aaaa', 60, 3600);
    IF NOT ok THEN RAISE EXCEPTION 'FAIL: hit % refused', i; END IF;
  END LOOP;
  RAISE NOTICE 'PASS: 60 hits allowed';
  PERFORM pg_temp.assert_true(public.analytics_rate_hit('ip:aaaa', 60, 3600) = false, 'the 61st hit is refused');
  PERFORM pg_temp.assert_true(public.analytics_rate_hit('ip:bbbb', 60, 3600), 'another bucket is separate');
  PERFORM pg_temp.assert_true((SELECT hits FROM public.analytics_rate_windows WHERE bucket = 'ip:aaaa') = 61, 'refused hits are still counted');
END $$;

-- A new window starts a new count. Start at the top of a second so both
-- first hits land in the same one-second window.
DO $$
BEGIN
  PERFORM pg_sleep(1 - (extract(epoch FROM clock_timestamp()) % 1) + 0.01);
  PERFORM pg_temp.assert_true(public.analytics_rate_hit('ip:cccc', 1, 1), 'first hit in a window is allowed');
  PERFORM pg_temp.assert_true(public.analytics_rate_hit('ip:cccc', 1, 1) = false, 'second hit in the same window is refused');
  PERFORM pg_sleep(1.05);
  PERFORM pg_temp.assert_true(public.analytics_rate_hit('ip:cccc', 1, 1), 'the next window counts afresh');
END $$;

-- Bad inputs are refused as data errors, not stored.
SELECT pg_temp.rejected($$SELECT public.analytics_rate_hit('', 60, 60)$$, '22023', 'empty bucket');
SELECT pg_temp.rejected($$SELECT public.analytics_rate_hit(repeat('x', 129), 60, 60)$$, '22023', 'bucket over 128 characters');
SELECT pg_temp.rejected($$SELECT public.analytics_rate_hit('ip:dddd', 0, 60)$$, '22023', 'zero limit');
SELECT pg_temp.rejected($$SELECT public.analytics_rate_hit('ip:dddd', 60, 0)$$, '22023', 'zero window');
SELECT pg_temp.rejected($$SELECT public.analytics_rate_hit('ip:dddd', 60, 3601)$$, '22023', 'window over an hour');

-- The purge removes windows older than an hour and keeps current ones.
INSERT INTO public.analytics_rate_windows (bucket, window_start, hits) VALUES ('ip:old', clock_timestamp() - interval '2 hours', 5);
SELECT pg_temp.assert_true(public.purge_analytics_rate_windows() = 1, 'purge removes one stale window');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.analytics_rate_windows WHERE bucket = 'ip:old'), 'the stale window is gone');
SELECT pg_temp.assert_true(EXISTS (SELECT FROM public.analytics_rate_windows WHERE bucket = 'ip:aaaa'), 'current windows are kept');
RESET ROLE;
ROLLBACK;
