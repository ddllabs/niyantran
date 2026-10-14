-- The admin screen's view of the scheduled feed store (migration 20261015160000;
-- open-work F169 phase 4, C5). PostgreSQL assertions, no pgTAP. Run only in a disposable database,
-- through run.sh.
-- Bootstrap: the feed_records chain (the least_privilege chain plus research_turn_persistence, then
-- 20261015150000_feed_records.sql), then 20261015160000_feed_admin.sql, both applied as a
-- non-superuser (nter_migrator, whose default privileges grant everything to anon and
-- authenticated, so a missing revoke shows). The vacuity check drops the last: feed_admin_status()
-- is then missing, so the first assertion fails. run.sh also executes the migration's Down block
-- and compares the schema with the chain without the migration.
--
-- One transaction, so now() is fixed: times are set by hand as offsets from it, which is what lets
-- the stale rule be tested exactly at its boundary (a module fetched exactly the limit ago is not
-- stale; one second more is).
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL TimeZone = 'UTC';

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
    RAISE NOTICE 'PASS: % (%)', label, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % (statement was accepted)', label;
END;
$$;

-- 1. The function and its privileges ----------------------------------------------------------
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM pg_proc p
    WHERE p.oid = 'public.feed_admin_status()'::regprocedure
      AND p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']),
  'feed_admin_status exists, SECURITY DEFINER, STABLE, with search_path ''''');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.feed_admin_status()', 'EXECUTE'), 'anon cannot execute it');
SELECT pg_temp.assert_true(NOT has_function_privilege('public', 'public.feed_admin_status()', 'EXECUTE'), 'public cannot execute it');
SELECT pg_temp.assert_true(NOT has_function_privilege('service_role', 'public.feed_admin_status()', 'EXECUTE'), 'service_role cannot execute it');
SELECT pg_temp.assert_true(has_function_privilege('authenticated', 'public.feed_admin_status()', 'EXECUTE'),
  'authenticated may call it (it checks admin)');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated', 'public.feed_state', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.feed_runs', 'SELECT'),
  'the tables stay closed to authenticated: this function is the only way in');

-- 2. Seed: modules with known ages and runs ----------------------------------------------------
-- threshold = greatest(120, 3 * interval) minutes
INSERT INTO public.feed_state (tier, feature, variant, class, kind, interval_minutes, serve, next_due_at, fetched_at, checked_at,
                               consecutive_failures, last_error, item_count, created_at) VALUES
  -- Wire: interval 30, limit 120 min, fetched exactly 120 min ago: the boundary, not stale
  ('news', 'Wire', '', 'news', 'news', 30, true, now() + interval '5 minutes', now() - interval '120 minutes', now() - interval '30 minutes', 0, NULL, 40, now() - interval '9 days'),
  -- Wire Late: the same, one second over: stale
  ('news', 'Wire Late', '', 'news', 'news', 30, true, now(), now() - interval '120 minutes 1 second', now() - interval '3 hours', 0, NULL, 12, now() - interval '9 days'),
  -- Tape: interval 15, limit 120 (the floor, not 45), 119 min ago: not stale
  ('markets', 'Tape', '', 'markets', 'measurement', 15, true, now(), now() - interval '119 minutes', now() - interval '119 minutes', 0, NULL, 5, now() - interval '9 days'),
  -- Tape Slow: interval 15, 121 min ago: stale (the floor applies, so 45 minutes is not the limit)
  ('markets', 'Tape Slow', '', 'markets', 'measurement', 15, false, now(), now() - interval '121 minutes', now() - interval '121 minutes', 0, NULL, 5, now() - interval '9 days'),
  -- Cabinet: interval 60, limit 180, exactly 180 min ago: not stale
  ('national', 'Cabinet', '', 'official', 'official', 60, true, now() + interval '1 hour', now() - interval '180 minutes', now() - interval '10 minutes', 0, NULL, 158, now() - interval '9 days'),
  -- Constitutions: interval 1440, limit 4320: two days old is not stale, though it is far past two hours
  ('global', 'Constitutions', '', 'reference', 'reference', 1440, true, now() + interval '1 day', now() - interval '2 days', now() - interval '2 days', 0, NULL, 195, now() - interval '9 days'),
  -- Failing: interval 30, fetched an hour ago, two failures since
  ('news', 'Failing', '', 'news', 'news', 30, true, now() + interval '4 minutes', now() - interval '1 hour', now() - interval '5 minutes', 2, 'HTTP 503 from the source', 17, now() - interval '9 days'),
  -- Never fetched, listed 3 hours ago, interval 30: stale from its created_at
  ('news', 'Never Old', '', 'news', 'news', 30, false, now(), NULL, NULL, 0, NULL, 0, now() - interval '3 hours'),
  -- Never fetched, just listed: not stale yet
  ('news', 'Never New', '', 'news', 'news', 30, false, now(), NULL, NULL, 0, NULL, 0, now()),
  -- A variant module
  ('news', 'Statements', 'Leader One', 'news', 'news', 30, true, now() + interval '3 minutes', now() - interval '10 minutes', now() - interval '10 minutes', 0, NULL, 8, now() - interval '9 days');

-- Wire's runs: the last is ok at -30 min; a lost-lease row at -1 min must not count as last
INSERT INTO public.feed_runs (tier, feature, variant, started_at, status, items, error) VALUES
  ('news', 'Wire', '', now() - interval '1 minute', 'stale', 0, NULL),
  ('news', 'Wire', '', now() - interval '30 minutes', 'ok', 40, NULL),
  ('news', 'Wire', '', now() - interval '1 hour', 'unchanged', 40, NULL),
  ('news', 'Wire', '', now() - interval '2 hours', 'failed', 0, 'boom'),
  ('news', 'Wire', '', now() - interval '3 hours', 'empty', 0, 'no items'),
  ('news', 'Wire', '', now() - interval '23 hours', 'timeout', 0, 'slow'),
  ('news', 'Wire', '', now() - interval '25 hours', 'ok', 40, NULL),
  ('news', 'Wire', '', now() - interval '26 hours', 'failed', 0, 'old'),
  -- another module's run must not leak into Wire's counts
  ('news', 'Failing', '', now() - interval '5 minutes', 'failed', 0, 'HTTP 503 from the source'),
  ('news', 'Failing', '', now() - interval '35 minutes', 'shrunk', 3, 'fewer items'),
  ('news', 'Failing', '', now() - interval '2 hours', 'ok', 17, NULL),
  ('news', 'Statements', 'Leader One', now() - interval '10 minutes', 'ok', 8, NULL),
  ('news', 'Statements', 'Leader Two', now() - interval '10 minutes', 'failed', 0, 'a variant that is not listed');
-- a lease held now on Cabinet, and one that has ended on Tape
UPDATE public.feed_state SET lease_token = '00000000-0000-4000-8000-0000000fee77', leased_at = now() - interval '5 seconds',
  lease_until = now() + interval '80 seconds' WHERE feature = 'Cabinet';
UPDATE public.feed_state SET lease_token = '00000000-0000-4000-8000-0000000fee78', leased_at = now() - interval '5 minutes',
  lease_until = now() - interval '1 second' WHERE feature = 'Tape';

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-0000000fed01', 'reader@example.test'),
  ('00000000-0000-4000-8000-0000000fed02', 'admin@example.test');
UPDATE public.user_profiles SET role = 'admin' WHERE user_id = '00000000-0000-4000-8000-0000000fed02';

-- 3. Access -----------------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT pg_temp.rejected($q$SELECT * FROM public.feed_admin_status()$q$, '42501', 'anon cannot call it');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.rejected($q$SELECT * FROM public.feed_admin_status()$q$, '42501', 'service_role cannot call it');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000fed01', true);
SELECT pg_temp.rejected($q$SELECT * FROM public.feed_admin_status()$q$, '42501', 'a signed-in non-admin is refused');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.rejected($q$SELECT * FROM public.feed_admin_status()$q$, '42501', 'a request with no user is refused');
SELECT pg_temp.rejected($q$SELECT count(*) FROM public.feed_state$q$, '42501', 'the admin still cannot select feed_state directly');
RESET ROLE;

-- 4. An admin reads the rows ------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000fed02', true);
-- WITH ORDINALITY records the order the function returned them in.
CREATE TEMP TABLE got AS SELECT * FROM public.feed_admin_status() WITH ORDINALITY AS s;
RESET ROLE;

SELECT pg_temp.assert_true((SELECT count(*) = 10 FROM got), 'an admin gets one row per module and variant');
SELECT pg_temp.assert_true((SELECT array_agg(tier || '/' || feature || '/' || variant ORDER BY ordinality) = ARRAY[
    'global/Constitutions/', 'markets/Tape/', 'markets/Tape Slow/', 'national/Cabinet/', 'news/Failing/',
    'news/Never New/', 'news/Never Old/', 'news/Statements/Leader One', 'news/Wire/', 'news/Wire Late/']
  FROM got),
  'the rows come ordered by tier, feature, variant');
SELECT pg_temp.assert_true((SELECT class = 'news' AND kind = 'news' AND interval_minutes = 30 AND serve
      AND item_count = 40 AND next_due_at = now() + interval '5 minutes' AND consecutive_failures = 0 AND last_error IS NULL
      AND fetched_at = now() - interval '120 minutes' AND checked_at = now() - interval '30 minutes'
    FROM got WHERE feature = 'Wire'),
  'a row carries the state: class, kind, interval, serve, items, due time, failures, fetched and checked times');
SELECT pg_temp.assert_true((SELECT NOT serve FROM got WHERE feature = 'Tape Slow'), 'serve off shows as off');
SELECT pg_temp.assert_true((SELECT consecutive_failures = 2 AND last_error = 'HTTP 503 from the source' FROM got WHERE feature = 'Failing'),
  'failures and the last error are shown');

-- 5. Stale, at the boundary -------------------------------------------------------------------
SELECT pg_temp.assert_true((SELECT stale_after_minutes = 120 FROM got WHERE feature = 'Wire'), 'a 30-minute module is fresh for two hours');
SELECT pg_temp.assert_true((SELECT stale_after_minutes = 180 FROM got WHERE feature = 'Cabinet'), 'an hourly module is fresh for three intervals');
SELECT pg_temp.assert_true((SELECT stale_after_minutes = 4320 FROM got WHERE feature = 'Constitutions'), 'a daily module is fresh for three days');
SELECT pg_temp.assert_true((SELECT stale_after_minutes = 120 FROM got WHERE feature = 'Tape'), 'a 15-minute module is fresh for the two-hour floor');
SELECT pg_temp.assert_true((SELECT NOT stale FROM got WHERE feature = 'Wire'), 'fetched exactly the limit ago is not stale');
SELECT pg_temp.assert_true((SELECT stale FROM got WHERE feature = 'Wire Late'), 'one second past the limit is stale');
SELECT pg_temp.assert_true((SELECT NOT stale FROM got WHERE feature = 'Tape'), '119 minutes on a 15-minute module is not stale');
SELECT pg_temp.assert_true((SELECT stale FROM got WHERE feature = 'Tape Slow'), '121 minutes on a 15-minute module is stale (the floor is 120, not 45)');
SELECT pg_temp.assert_true((SELECT NOT stale FROM got WHERE feature = 'Cabinet'), 'an hourly module at exactly 180 minutes is not stale');
SELECT pg_temp.assert_true((SELECT NOT stale FROM got WHERE feature = 'Constitutions'), 'a daily module two days old is not stale');
SELECT pg_temp.assert_true((SELECT stale FROM got WHERE feature = 'Never Old'), 'a module never fetched turns stale from when it was listed');
SELECT pg_temp.assert_true((SELECT NOT stale AND fetched_at IS NULL FROM got WHERE feature = 'Never New'), 'a module listed just now is not stale yet');
SELECT pg_temp.assert_true((SELECT NOT stale FROM got WHERE feature = 'Failing'), 'a failing module fetched an hour ago is not stale (failing is separate)');

-- 6. Runs -------------------------------------------------------------------------------------
SELECT pg_temp.assert_true((SELECT last_run_status = 'ok' AND last_run_at = now() - interval '30 minutes' FROM got WHERE feature = 'Wire'),
  'the last run skips a run that lost its lease');
SELECT pg_temp.assert_true((SELECT runs_ok_24h = 2 AND runs_failed_24h = 3 FROM got WHERE feature = 'Wire'),
  'the 24-hour counts: ok and unchanged on one side; failed, empty and timeout on the other; runs older than a day are left out');
SELECT pg_temp.assert_true((SELECT last_run_status = 'failed' AND runs_ok_24h = 1 AND runs_failed_24h = 2 FROM got WHERE feature = 'Failing'),
  'a failing module shows its failed last run and counts shrunk as a failure');
SELECT pg_temp.assert_true((SELECT last_run_status = 'ok' AND runs_ok_24h = 1 AND runs_failed_24h = 0 FROM got WHERE feature = 'Statements'),
  'a variant keeps its own runs');
SELECT pg_temp.assert_true((SELECT last_run_status IS NULL AND last_run_at IS NULL AND runs_ok_24h = 0 AND runs_failed_24h = 0 FROM got WHERE feature = 'Never Old'),
  'a module with no runs has no last run and zero counts');

-- 7. Lease ---------------------------------------------------------------------------------
SELECT pg_temp.assert_true((SELECT leased FROM got WHERE feature = 'Cabinet'), 'a lease that has not ended counts as held');
SELECT pg_temp.assert_true((SELECT NOT leased FROM got WHERE feature = 'Tape'), 'a lease that has ended is not held');
SELECT pg_temp.assert_true((SELECT NOT leased FROM got WHERE feature = 'Wire'), 'no lease is not held');

-- 8. A suspended admin is refused ---------------------------------------------------------
UPDATE public.user_profiles SET status = 'suspended' WHERE user_id = '00000000-0000-4000-8000-0000000fed02';
SET LOCAL ROLE authenticated;
SELECT pg_temp.rejected($q$SELECT * FROM public.feed_admin_status()$q$, '42501', 'a suspended admin is refused');
RESET ROLE;

ROLLBACK;
