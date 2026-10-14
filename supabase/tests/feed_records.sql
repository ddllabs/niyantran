-- Scheduled module records (migration 20261015120000; open-work F169 phase 4;
-- docs/decisions/0012-scheduled-feeds-records-first.md). PostgreSQL assertions, no pgTAP.
-- Run only in a disposable database, through run.sh.
-- Bootstrap: the least_privilege chain plus research_turn_persistence, then
-- 20261015120000_feed_records.sql applied as a non-superuser (nter_migrator, whose default
-- privileges grant everything to anon and authenticated, so a missing revoke shows). The
-- vacuity check drops the last: feed_items is then missing, so the first assertion fails.
--
-- One transaction, so now() is fixed: due times, leases and timestamps are moved by hand
-- (as the superuser) where a test needs time to have passed.
-- Modules: W news (interval 30, later 45), C official, H charts (latest), R reference,
-- M markets (measurement, 15), S leaders with variant 'Leader One'.
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

-- 1. Objects, settings and privileges ----------------------------------------------------------
SELECT pg_temp.assert_true(to_regclass('public.feed_items') IS NOT NULL AND to_regclass('public.feed_state') IS NOT NULL
    AND to_regclass('public.feed_runs') IS NOT NULL AND to_regclass('public.feed_daily') IS NOT NULL,
  'the four feed tables exist');
SELECT pg_temp.assert_true((SELECT bool_and(relrowsecurity) FROM pg_class
    WHERE oid IN ('public.feed_items'::regclass, 'public.feed_state'::regclass, 'public.feed_runs'::regclass,
                  'public.feed_daily'::regclass)), 'RLS is enabled on all four');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public'
    AND tablename IN ('feed_items', 'feed_state', 'feed_runs', 'feed_daily')), 'no policy opens any of them');
SELECT pg_temp.assert_true((SELECT count(*) = 5 FROM pg_proc p
    WHERE p.oid IN ('public.feed_claim_due(jsonb, integer, integer)'::regprocedure, 'public.feed_record(jsonb)'::regprocedure,
                    'public.feed_page(text, text, text, integer, integer)'::regprocedure, 'public.feed_purge()'::regprocedure,
                    'public.db_size()'::regprocedure)
      AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']),
  'the five functions exist, SECURITY DEFINER with search_path ''''');
SELECT pg_temp.assert_true(EXISTS (SELECT FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'feed_items'
    AND indexdef LIKE '%(tier, feature, variant, sort_at DESC, item_key)%'), 'feed_items has the serving index');

DO $$
DECLARE actor text; priv text; tbl text; fn text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['anon', 'authenticated', 'public'] LOOP
    FOREACH tbl IN ARRAY ARRAY['public.feed_items', 'public.feed_state', 'public.feed_runs', 'public.feed_daily'] LOOP
      FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, tbl, priv), actor || ' has no ' || priv || ' on ' || tbl);
      END LOOP;
    END LOOP;
    PERFORM pg_temp.assert_true(NOT has_sequence_privilege(actor, 'public.feed_runs_id_seq', 'USAGE'), actor || ' cannot use the runs sequence');
    FOREACH fn IN ARRAY ARRAY['public.feed_claim_due(jsonb, integer, integer)', 'public.feed_record(jsonb)',
                              'public.feed_page(text, text, text, integer, integer)', 'public.feed_purge()'] LOOP
      PERFORM pg_temp.assert_true(NOT has_function_privilege(actor, fn, 'EXECUTE'), actor || ' cannot execute ' || fn);
      PERFORM pg_temp.assert_true(has_function_privilege('service_role', fn, 'EXECUTE'), 'service_role can execute ' || fn);
    END LOOP;
  END LOOP;
  PERFORM pg_temp.assert_true(NOT has_function_privilege('anon', 'public.db_size()', 'EXECUTE'), 'anon cannot execute db_size');
  PERFORM pg_temp.assert_true(NOT has_function_privilege('service_role', 'public.db_size()', 'EXECUTE'), 'service_role cannot execute db_size');
  PERFORM pg_temp.assert_true(has_function_privilege('authenticated', 'public.db_size()', 'EXECUTE'), 'authenticated may call db_size (it checks admin)');
  FOREACH tbl IN ARRAY ARRAY['public.feed_items', 'public.feed_state', 'public.feed_runs', 'public.feed_daily'] LOOP
    PERFORM pg_temp.assert_true(has_table_privilege('service_role', tbl, 'SELECT'), 'service_role can read ' || tbl);
    FOREACH priv IN ARRAY ARRAY['INSERT', 'DELETE', 'TRUNCATE'] LOOP
      PERFORM pg_temp.assert_true(NOT has_table_privilege('service_role', tbl, priv), 'service_role has no ' || priv || ' on ' || tbl);
    END LOOP;
  END LOOP;
  PERFORM pg_temp.assert_true(has_column_privilege('service_role', 'public.feed_state', 'serve', 'UPDATE')
    AND NOT has_column_privilege('service_role', 'public.feed_state', 'next_due_at', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.feed_items', 'UPDATE'),
    'service_role may update only feed_state.serve');
END $$;

SET LOCAL ROLE anon;
SELECT pg_temp.rejected($q$SELECT count(*) FROM public.feed_items$q$, '42501', 'anon cannot select feed_items');
SELECT pg_temp.rejected($q$SELECT count(*) FROM public.feed_state$q$, '42501', 'anon cannot select feed_state');
SELECT pg_temp.rejected($q$SELECT public.feed_claim_due('[]', 1, 90)$q$, '42501', 'anon cannot claim');
SELECT pg_temp.rejected($q$SELECT public.feed_page('news', 'Wire', '', 10, 0)$q$, '42501', 'anon cannot read a page');
SELECT pg_temp.rejected($q$SELECT public.db_size()$q$, '42501', 'anon cannot call db_size');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.rejected($q$SELECT count(*) FROM public.feed_items$q$, '42501', 'authenticated cannot select feed_items');
SELECT pg_temp.rejected($q$SELECT count(*) FROM public.feed_runs$q$, '42501', 'authenticated cannot select feed_runs');
SELECT pg_temp.rejected($q$SELECT count(*) FROM public.feed_daily$q$, '42501', 'authenticated cannot select feed_daily');
SELECT pg_temp.rejected($q$SELECT public.feed_record('{}')$q$, '42501', 'authenticated cannot record');
SELECT pg_temp.rejected($q$SELECT public.feed_claim_due('[]', 1, 90)$q$, '42501', 'authenticated cannot claim');
SELECT pg_temp.rejected($q$SELECT public.feed_page('news', 'Wire', '', 10, 0)$q$, '42501', 'authenticated cannot read a page');
SELECT pg_temp.rejected($q$SELECT public.feed_purge()$q$, '42501', 'authenticated cannot purge');
RESET ROLE;

-- 2. Claims ------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.run(t text, f text, v text, c text, mins integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('tier', t, 'feature', f, 'variant', v, 'class', c, 'interval_minutes', mins);
$$;
CREATE FUNCTION pg_temp.schedule(w_mins integer DEFAULT 30) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(
    pg_temp.run('news', 'Wire', '', 'news', w_mins),
    pg_temp.run('national', 'Cabinet', '', 'official', 60),
    pg_temp.run('ent', 'Charts', '', 'charts', 60),
    pg_temp.run('geo', 'Constitutions', '', 'reference', 1440),
    pg_temp.run('finance', 'NSE', '', 'markets', 15),
    pg_temp.run('national', 'Statements', 'Leader One', 'leaders', 360));
$$;
-- Claimed modules as 'tier/feature/variant' strings, in returned order.
CREATE FUNCTION pg_temp.claim(runs jsonb, lim integer) RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(c.tier || '/' || c.feature || '/' || c.variant ORDER BY ord), '{}')
    FROM public.feed_claim_due(runs, lim, 90) WITH ORDINALITY AS c(tier, feature, variant, class, interval_minutes,
                                                                   next_due_at, consecutive_failures, lease_until, ord);
$$;

SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(cardinality(pg_temp.claim(pg_temp.schedule(), 3)) = 3, 'a first claim returns up to the limit');
SELECT pg_temp.assert_true((SELECT count(*) = 6 AND bool_and(NOT serve) AND bool_and(next_due_at = now())
    AND count(*) FILTER (WHERE lease_until = now() + interval '90 seconds') = 3 FROM public.feed_state),
  'every scheduled module gets a state row, due now, not served; three are leased for 90 s');
SELECT pg_temp.assert_true(cardinality(pg_temp.claim(pg_temp.schedule(), 10)) = 3, 'a second claim skips the three with a live lease');
SELECT pg_temp.assert_true(cardinality(pg_temp.claim(pg_temp.schedule(), 10)) = 0, 'with every lease live, nothing is claimed');
RESET ROLE;
UPDATE public.feed_state SET lease_until = now() - interval '1 second' WHERE feature IN ('Wire', 'Charts');
UPDATE public.feed_state SET lease_until = NULL, next_due_at = now() + interval '1 minute' WHERE feature = 'Cabinet';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.claim(pg_temp.schedule() - 2, 10) = ARRAY['news/Wire/'],
  'an expired lease is claimable again; a module not yet due is not; a module left out of the schedule is not claimed');
RESET ROLE;
UPDATE public.feed_state SET lease_until = NULL, next_due_at = now() - interval '5 minutes' WHERE feature = 'Charts';
UPDATE public.feed_state SET lease_until = NULL, next_due_at = now() - interval '9 minutes' WHERE feature = 'Constitutions';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.claim(pg_temp.schedule(), 10) = ARRAY['geo/Constitutions/', 'ent/Charts/'],
  'due modules are returned oldest due first');
RESET ROLE;
UPDATE public.feed_state SET next_due_at = now() + interval '1 hour' WHERE feature = 'Wire';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(cardinality(pg_temp.claim(pg_temp.schedule(45), 10)) = 0, 'a changed interval claims nothing extra');
SELECT pg_temp.assert_true((SELECT interval_minutes = 45 AND next_due_at = now() + interval '45 minutes'
    FROM public.feed_state WHERE feature = 'Wire'),
  'the class and interval are copied from code, and a shorter interval pulls next_due_at in');

-- 3. Recording outcomes ------------------------------------------------------------------------
CREATE FUNCTION pg_temp.item(k text, hash text, extra jsonb DEFAULT '{}', pub text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object('item_key', k, 'row', jsonb_build_object('title', 'Title ' || k, 'link', 'https://example.test/' || k) || extra,
                            'title', 'Title ' || k, 'url', 'https://example.test/' || k, 'published_at', pub, 'content_hash', hash);
$$;
CREATE FUNCTION pg_temp.rec(t text, f text, v text, kind text, status text, items jsonb,
                            meta jsonb DEFAULT NULL, err text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.feed_record(jsonb_build_object('tier', t, 'feature', f, 'variant', v, 'kind', kind, 'status', status,
                                               'ms', 1234, 'items', items, 'meta', meta, 'error', err));
$$;
CREATE FUNCTION pg_temp.keys(t text, f text, v text DEFAULT '') RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(item_key ORDER BY item_key), '{}') FROM public.feed_items WHERE tier = t AND feature = f AND variant = v;
$$;

-- News (W): insert, an unchanged hash, a changed hash, a missing item.
SELECT pg_temp.assert_true((r ->> 'status') = 'ok' AND (r ->> 'new_items')::int = 2 AND (r ->> 'item_count')::int = 2,
  'a first ok record inserts its items: status ok, 2 new')
  FROM pg_temp.rec('news', 'Wire', '', 'news', 'ok',
                   jsonb_build_array(pg_temp.item('a', 'h1', '{}', '2000-01-10T08:00:00Z'), pg_temp.item('b', 'h1')),
                   '{"source": "Wire note", "coverage": "national"}') AS r;
SELECT pg_temp.assert_true(fetched_at = now() AND checked_at = now() AND changed_at = now() AND item_count = 2
    AND consecutive_failures = 0 AND lease_until IS NULL AND last_error IS NULL
    AND next_due_at = now() + interval '45 minutes' AND meta ->> 'source' = 'Wire note',
  'the state is healthy, unleased, due after the interval, with the answer''s meta')
  FROM public.feed_state WHERE feature = 'Wire';
RESET ROLE;
UPDATE public.feed_state SET changed_at = now() - interval '1 day' WHERE feature = 'Wire';
UPDATE public.feed_items SET last_seen = now() - interval '1 day' WHERE feature = 'Wire';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((r ->> 'status') = 'unchanged' AND (r ->> 'new_items')::int = 0 AND (r ->> 'changed_items')::int = 0,
  'the same hashes again: status unchanged')
  FROM pg_temp.rec('news', 'Wire', '', 'news', 'ok',
                   jsonb_build_array(pg_temp.item('a', 'h1', '{"marker": "second"}', '2000-01-10T08:00:00Z'),
                                     pg_temp.item('b', 'h1', '{"marker": "second"}'))) AS r;
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.feed_items WHERE feature = 'Wire' AND row ? 'marker'),
  'a second record with the same hash does not rewrite row');
SELECT pg_temp.assert_true((SELECT bool_and(last_seen = now()) FROM public.feed_items WHERE feature = 'Wire'),
  'an unchanged item has last_seen touched');
SELECT pg_temp.assert_true((SELECT changed_at = now() - interval '1 day' AND fetched_at = now() AND meta ->> 'source' = 'Wire note'
    FROM public.feed_state WHERE feature = 'Wire'),
  'an unchanged run keeps changed_at, sets fetched_at, keeps meta when none is sent');
SELECT pg_temp.assert_true((r ->> 'status') = 'ok' AND (r ->> 'new_items')::int = 1 AND (r ->> 'changed_items')::int = 1
    AND (r ->> 'removed_items')::int = 0 AND (r ->> 'item_count')::int = 3,
  'a changed hash and a new item: status ok, 1 new, 1 changed')
  FROM pg_temp.rec('news', 'Wire', '', 'news', 'ok',
                   jsonb_build_array(pg_temp.item('a', 'h2', '{"marker": "third"}', '2000-01-11T08:00:00Z'),
                                     pg_temp.item('c', 'h1', '{}', '2000-01-12T08:00:00Z'))) AS r;
SELECT pg_temp.assert_true((SELECT row ->> 'marker' = 'third' AND content_hash = 'h2' AND published_at = '2000-01-11T08:00:00Z'
    FROM public.feed_items WHERE feature = 'Wire' AND item_key = 'a'),
  'a changed hash rewrites row, hash and published_at');
SELECT pg_temp.assert_true(pg_temp.keys('news', 'Wire') = ARRAY['a', 'b', 'c'], 'news keeps an item missing from the batch');
SELECT pg_temp.assert_true((SELECT changed_at = now() FROM public.feed_state WHERE feature = 'Wire'), 'a changed run sets changed_at');
SELECT pg_temp.assert_true((SELECT array_agg(status ORDER BY id) = ARRAY['ok', 'unchanged', 'ok']
      AND array_agg(items ORDER BY id) = ARRAY[2, 2, 2] AND array_agg(new_items ORDER BY id) = ARRAY[2, 0, 1]
      AND bool_and(ms = 1234 AND error IS NULL AND started_at = now() - interval '1.234 seconds')
    FROM public.feed_runs WHERE feature = 'Wire'),
  'each run is logged with its status, items, new items and timing');

-- Official (C): missing items kept; a key twice in one batch keeps the first.
SELECT pg_temp.rec('national', 'Cabinet', '', 'official', 'ok', jsonb_build_array(pg_temp.item('a', 'h1'), pg_temp.item('b', 'h1')));
SELECT pg_temp.assert_true((r ->> 'items')::int = 2 AND (r ->> 'new_items')::int = 2,
  'a key listed twice in one batch is stored once')
  FROM pg_temp.rec('national', 'Cabinet', '', 'official', 'ok',
                   jsonb_build_array(pg_temp.item('c', 'h1', '{"copy": 1}'), pg_temp.item('c', 'h1', '{"copy": 2}'),
                                     pg_temp.item('d', 'h1'))) AS r;
SELECT pg_temp.assert_true((SELECT row ->> 'copy' = '1' FROM public.feed_items WHERE feature = 'Cabinet' AND item_key = 'c'),
  'the first copy of a duplicated key is kept');
SELECT pg_temp.assert_true(pg_temp.keys('national', 'Cabinet') = ARRAY['a', 'b', 'c', 'd'], 'official keeps items missing from the batch');

-- Charts (H, latest) and reference (R): missing items are dropped.
SELECT pg_temp.rec('ent', 'Charts', '', 'latest', 'ok', jsonb_build_array(pg_temp.item('a', 'h1'), pg_temp.item('b', 'h1')));
SELECT pg_temp.assert_true((r ->> 'status') = 'ok' AND (r ->> 'removed_items')::int = 1,
  'a latest list that drops an item is a change')
  FROM pg_temp.rec('ent', 'Charts', '', 'latest', 'ok', jsonb_build_array(pg_temp.item('a', 'h1'), pg_temp.item('c', 'h1'))) AS r;
SELECT pg_temp.assert_true(pg_temp.keys('ent', 'Charts') = ARRAY['a', 'c'], 'latest drops items missing from the batch');
SELECT pg_temp.rec('geo', 'Constitutions', '', 'reference', 'ok', jsonb_build_array(pg_temp.item('a', 'h1'), pg_temp.item('b', 'h1')));
SELECT pg_temp.rec('geo', 'Constitutions', '', 'reference', 'ok', jsonb_build_array(pg_temp.item('b', 'h1'), pg_temp.item('c', 'h1')));
SELECT pg_temp.assert_true(pg_temp.keys('geo', 'Constitutions') = ARRAY['b', 'c'], 'reference replaces its set');
SELECT pg_temp.assert_true((SELECT item_count = 2 FROM public.feed_state WHERE feature = 'Constitutions'), 'item_count follows the pruned set');

-- Markets (M, measurement): one daily row per item per India day, the day's last value.
SELECT pg_temp.rec('finance', 'NSE', '', 'measurement', 'ok', jsonb_build_array(pg_temp.item('nifty', 'h1', '{"value": 1}')));
SELECT pg_temp.rec('finance', 'NSE', '', 'measurement', 'ok', jsonb_build_array(pg_temp.item('nifty', 'h2', '{"value": 2}')));
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND bool_and(day = (now() AT TIME ZONE 'Asia/Kolkata')::date AND row ->> 'value' = '2')
    FROM public.feed_daily WHERE feature = 'NSE' AND item_key = 'nifty'),
  'a measurement writes one daily row per item, holding the day''s last value');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.feed_daily WHERE feature <> 'NSE'), 'other kinds write no daily rows');

-- Statement Tracker leader (S): items live under their variant.
SELECT pg_temp.rec('national', 'Statements', 'Leader One', 'news', 'ok', jsonb_build_array(pg_temp.item('q1', 'h1')));
SELECT pg_temp.assert_true(pg_temp.keys('national', 'Statements', 'Leader One') = ARRAY['q1']
    AND pg_temp.keys('national', 'Statements', '') = '{}', 'variant items are kept under their variant');

-- 4. Failures back off and keep items ----------------------------------------------------------
RESET ROLE;
UPDATE public.feed_state SET fetched_at = now() - interval '1 hour', lease_until = now() + interval '1 minute' WHERE feature = 'Wire';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((r ->> 'status') = 'failed' AND (r ->> 'consecutive_failures')::int = 1 AND (r ->> 'item_count')::int = 3,
  'a failure is logged and reports the kept items')
  FROM pg_temp.rec('news', 'Wire', '', 'news', 'failed', NULL, NULL, repeat('x', 400)) AS r;
SELECT pg_temp.assert_true(consecutive_failures = 1 AND next_due_at = now() + interval '2 minutes' AND lease_until IS NULL
    AND length(last_error) = 300 AND fetched_at = now() - interval '1 hour' AND checked_at = now() AND item_count = 3,
  'one failure: retry after 2 min, lease cleared, error cut to 300, fetched_at kept')
  FROM public.feed_state WHERE feature = 'Wire';
SELECT pg_temp.assert_true(pg_temp.keys('news', 'Wire') = ARRAY['a', 'b', 'c'], 'a failure keeps the items');
SELECT pg_temp.rec('news', 'Wire', '', 'news', 'timeout', NULL, NULL, 'source timed out');
SELECT pg_temp.assert_true((SELECT consecutive_failures = 2 AND next_due_at = now() + interval '4 minutes' AND last_error = 'source timed out'
    FROM public.feed_state WHERE feature = 'Wire'), 'two failures: retry after 4 min');
SELECT pg_temp.assert_true((SELECT status = 'timeout' AND error = 'source timed out' AND items = 0
    FROM public.feed_runs WHERE feature = 'Wire' ORDER BY id DESC LIMIT 1), 'the timeout run is logged with its error');
SELECT pg_temp.rec('finance', 'NSE', '', 'measurement', 'failed', NULL) FROM generate_series(1, 4);
SELECT pg_temp.assert_true((SELECT consecutive_failures = 4 AND next_due_at = now() + interval '15 minutes' AND last_error = 'failed'
    FROM public.feed_state WHERE feature = 'NSE'), 'four failures on a 15-minute module: 16 min is capped at the interval');
SELECT pg_temp.assert_true((r ->> 'status') = 'empty' AND (r ->> 'removed_items')::int = 0,
  'ok with no items is recorded as empty')
  FROM pg_temp.rec('ent', 'Charts', '', 'latest', 'ok', '[]') AS r;
SELECT pg_temp.assert_true(pg_temp.keys('ent', 'Charts') = ARRAY['a', 'c'], 'an empty answer never prunes a latest list');
SELECT pg_temp.assert_true((SELECT consecutive_failures = 1 AND last_error = 'the source answered with no items'
    FROM public.feed_state WHERE feature = 'Charts'), 'an empty answer counts as a failure');
SELECT pg_temp.rec('news', 'Wire', '', 'news', 'ok', jsonb_build_array(pg_temp.item('b', 'h1')));
SELECT pg_temp.assert_true((SELECT consecutive_failures = 0 AND last_error IS NULL AND next_due_at = now() + interval '45 minutes'
    FROM public.feed_state WHERE feature = 'Wire'), 'an ok run resets the failures');

-- 5. Bad input is rejected and changes nothing -------------------------------------------------
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'blog', 'ok', '[]')$q$, '22023', 'an unknown kind is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'news', 'partial', '[]')$q$, '22023', 'an unknown status is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_record('{"feature": "Wire", "kind": "news", "status": "ok"}')$q$, '22023', 'a missing tier is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_record('[]')$q$, '22023', 'a non-object outcome is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Nowhere', '', 'news', 'ok', '[]')$q$, '22023', 'a module that was never claimed is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'news', 'ok', jsonb_build_array(pg_temp.item('z', 'h1'), pg_temp.item('y', 'h1') - 'item_key'))$q$,
  '22023', 'an item without item_key is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'news', 'ok', jsonb_build_array(jsonb_set(pg_temp.item('z', 'h1'), '{row}', '"text"')))$q$,
  '22023', 'an item whose row is not an object is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'news', 'ok', jsonb_build_array(pg_temp.item('z', 'h1') - 'content_hash'))$q$,
  '22023', 'an item without content_hash is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'news', 'ok', jsonb_build_array(pg_temp.item('z', 'h1', '{}', 'last Tuesday')))$q$,
  '22023', 'an item with an unreadable published_at is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'news', 'ok', '{"a": 1}')$q$, '22023', 'items that are not an array are refused');
SELECT pg_temp.rejected($q$SELECT public.feed_record('{"tier": "news", "feature": "Wire", "kind": "news", "status": "failed", "ms": -5}')$q$,
  '22023', 'a negative ms is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_record('{"tier": "news", "feature": "Wire", "kind": "news", "status": "failed", "meta": [1]}')$q$,
  '22023', 'meta that is not an object is refused');
SELECT pg_temp.assert_true(pg_temp.keys('news', 'Wire') = ARRAY['a', 'b', 'c']
    AND (SELECT consecutive_failures = 0 FROM public.feed_state WHERE feature = 'Wire')
    AND (SELECT count(*) = 6 FROM public.feed_runs WHERE feature = 'Wire'),
  'refused records changed no item, state or run');
SELECT pg_temp.rejected($q$SELECT public.feed_claim_due('{"tier": "news"}', 5, 90)$q$, '22023', 'a schedule that is not an array is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_claim_due(jsonb_build_array(pg_temp.run('news', 'Fast', '', 'news', 5)), 5, 90)$q$,
  '22023', 'an interval under 15 minutes is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_claim_due(jsonb_build_array(pg_temp.run('news', 'Odd', '', 'news', 30) - 'class'), 5, 90)$q$,
  '22023', 'a run without a class is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_claim_due(jsonb_build_array(pg_temp.run('news', 'Twice', '', 'news', 30), pg_temp.run('news', 'Twice', '', 'news', 60)), 5, 90)$q$,
  '22023', 'a run listed twice is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_claim_due(pg_temp.schedule(), 0, 90)$q$, '22023', 'a zero limit is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_claim_due(pg_temp.schedule(), 5, 1)$q$, '22023', 'a 1-second lease is refused');
SELECT pg_temp.assert_true((SELECT count(*) = 6 FROM public.feed_state), 'refused claims added no module');

-- Direct writes are refused even to the service role; only the serve switch is open.
SELECT pg_temp.rejected($q$INSERT INTO public.feed_items (tier, feature, item_key, row, kind, content_hash) VALUES ('news', 'Wire', 'x', '{}', 'news', 'h')$q$,
  '42501', 'service_role cannot insert items directly');
SELECT pg_temp.rejected($q$UPDATE public.feed_state SET next_due_at = now() WHERE feature = 'Wire'$q$, '42501', 'service_role cannot edit the schedule directly');
SELECT pg_temp.rejected($q$DELETE FROM public.feed_runs$q$, '42501', 'service_role cannot delete runs directly');
UPDATE public.feed_state SET serve = true WHERE feature = 'Wire';
SELECT pg_temp.assert_true((SELECT serve FROM public.feed_state WHERE feature = 'Wire'), 'service_role can switch serving on');

-- 6. Serving ----------------------------------------------------------------------------------
-- Wire: b has no published_at, so it sorts by first_seen (now), then c (12 Jan 2000), then a (11 Jan 2000).
SELECT pg_temp.assert_true((SELECT array_agg(i ->> 'item_key' ORDER BY o) FROM jsonb_array_elements(pg -> 'items') WITH ORDINALITY AS x(i, o))
      = ARRAY['b', 'c'] AND (pg ->> 'total')::int = 3 AND (pg ->> 'serve')::boolean AND pg -> 'meta' ->> 'source' = 'Wire note'
      AND (pg ->> 'fetched_at')::timestamptz = now() AND pg -> 'items' -> 0 -> 'row' ->> 'title' = 'Title b',
  'a page is newest first, with the total, the serve switch, meta and fetched_at')
  FROM public.feed_page('news', 'Wire', '', 2, 0) AS pg;
SELECT pg_temp.assert_true(jsonb_path_query_array(public.feed_page('news', 'Wire', '', 2, 2), '$.items[*].item_key') = '["a"]',
  'the offset pages on');
SELECT pg_temp.assert_true(jsonb_array_length(public.feed_page('news', 'Wire', '', 0, -3) -> 'items') = 1
    AND jsonb_array_length(public.feed_page('news', 'Wire', NULL, 100000, 0) -> 'items') = 3,
  'limit and offset are clamped; a null variant means none');
SELECT pg_temp.assert_true(public.feed_page('news', 'Nowhere', '', 10, 0) IS NULL, 'an unknown module gives null');
SELECT pg_temp.assert_true(jsonb_path_query_array(public.feed_page('national', 'Statements', 'Leader One', 10, 0), '$.items[*].item_key') = '["q1"]',
  'a variant page reads its own items');

-- 7. Purge ------------------------------------------------------------------------------------
RESET ROLE;
INSERT INTO public.feed_runs (tier, feature, variant, started_at, status) VALUES
  ('news', 'Wire', '', now() - interval '31 days', 'ok'),
  ('news', 'Wire', '', now() - interval '29 days', 'ok');
INSERT INTO public.feed_daily (tier, feature, variant, item_key, day, row) VALUES ('finance', 'NSE', '', 'nifty', DATE '2025-01-01', '{"value": 0}');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.feed_purge() = '{"feed_runs": 1}', 'the purge deletes runs older than 30 days');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.feed_runs WHERE started_at < now() - interval '28 days'),
  'a run 29 days old is kept');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.feed_daily) AND pg_temp.keys('news', 'Wire') = ARRAY['a', 'b', 'c'],
  'the purge keeps daily summaries and items');
RESET ROLE;

-- 8. db_size: platform admins only ------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-0000000fee01', 'reader@example.test'),
  ('00000000-0000-4000-8000-0000000fee02', 'admin@example.test');
UPDATE public.user_profiles SET role = 'admin' WHERE user_id = '00000000-0000-4000-8000-0000000fee02';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000fee01', true);
SELECT pg_temp.rejected($q$SELECT * FROM public.db_size()$q$, '42501', 'db_size refuses a signed-in non-admin');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.rejected($q$SELECT * FROM public.db_size()$q$, '42501', 'db_size refuses a request with no user');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000fee02', true);
SELECT pg_temp.assert_true((SELECT array_agg(name ORDER BY name) = ARRAY['database', 'feed_daily', 'feed_items', 'feed_runs', 'feed_state']
      AND bool_and(bytes > 0) FROM public.db_size()),
  'db_size gives an admin the database and the four feed tables, in bytes');
RESET ROLE;
UPDATE public.user_profiles SET status = 'suspended' WHERE user_id = '00000000-0000-4000-8000-0000000fee02';
SET LOCAL ROLE authenticated;
SELECT pg_temp.rejected($q$SELECT * FROM public.db_size()$q$, '42501', 'db_size refuses a suspended admin');
RESET ROLE;

ROLLBACK;
