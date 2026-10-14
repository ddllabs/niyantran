-- Scheduled module records (migration 20261015120000; open-work F169 phase 4;
-- docs/decisions/0012-scheduled-feeds-records-first.md). PostgreSQL assertions, no pgTAP.
-- Run only in a disposable database, through run.sh.
-- Bootstrap: the least_privilege chain plus research_turn_persistence, then
-- 20261015120000_feed_records.sql applied as a non-superuser (nter_migrator, whose default
-- privileges grant everything to anon and authenticated, so a missing revoke shows). The
-- vacuity check drops the last: feed_items is then missing, so the first assertion fails.
-- run.sh also executes the migration's Down block, compares the schema with the chain
-- without the migration, re-applies the migration and runs this fixture again.
--
-- One transaction, so now() is fixed: due times, leases and timestamps are moved by hand
-- (as the superuser) where a test needs time to have passed. Claims and the first record run
-- as service_role; the rest run as the superuser through pg_temp.rec, which claims the module
-- (a real lease token from feed_claim_due) and records with that token.
-- Modules: Wire news (interval 30, later 45), Cabinet official, Charts latest, Constitutions
-- reference, NSE measurement (15), Statements news with variant 'Leader One'.
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
    AND NOT has_column_privilege('service_role', 'public.feed_state', 'lease_token', 'UPDATE')
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
CREATE FUNCTION pg_temp.run(t text, f text, v text, c text, k text, mins integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('tier', t, 'feature', f, 'variant', v, 'class', c, 'kind', k, 'interval_minutes', mins,
                            'params', '{}'::jsonb);
$$;
CREATE FUNCTION pg_temp.schedule(w_mins integer DEFAULT 30) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(
    pg_temp.run('news', 'Wire', '', 'news', 'news', w_mins),
    pg_temp.run('national', 'Cabinet', '', 'official', 'official', 60),
    pg_temp.run('ent', 'Charts', '', 'charts', 'latest', 60),
    pg_temp.run('geo', 'Constitutions', '', 'reference', 'reference', 1440),
    pg_temp.run('finance', 'NSE', '', 'markets', 'measurement', 15),
    pg_temp.run('national', 'Statements', 'Leader One', 'leaders', 'news', 360));
$$;
-- Claimed modules as 'tier/feature/variant' strings, in returned order.
CREATE FUNCTION pg_temp.claim(runs jsonb, lim integer) RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(c.tier || '/' || c.feature || '/' || c.variant ORDER BY ord), '{}')
    FROM public.feed_claim_due(runs, lim, 90) WITH ORDINALITY
      AS c(tier, feature, variant, class, kind, interval_minutes, next_due_at, consecutive_failures, lease_until, lease_token, ord);
$$;

SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT count(*) = 3 AND count(DISTINCT c.lease_token) = 3 AND bool_and(c.lease_until = now() + interval '90 seconds')
    FROM public.feed_claim_due(pg_temp.schedule(), 3, 90) c), 'a first claim returns up to the limit, each with its own lease token');
SELECT pg_temp.assert_true((SELECT count(*) = 6 AND bool_and(NOT serve) AND bool_and(next_due_at = now())
    AND count(*) FILTER (WHERE lease_token IS NOT NULL AND leased_at = now()) = 3 FROM public.feed_state),
  'every scheduled module gets a state row, due now, not served; three are leased');
SELECT pg_temp.assert_true((SELECT array_agg(kind ORDER BY tier, feature) FROM public.feed_state)
    = ARRAY['latest', 'measurement', 'reference', 'official', 'news', 'news'], 'the kind is stored from the schedule');
SELECT pg_temp.assert_true(cardinality(pg_temp.claim(pg_temp.schedule(), 10)) = 3, 'a second claim skips the three with a live lease');
SELECT pg_temp.assert_true(cardinality(pg_temp.claim(pg_temp.schedule(), 10)) = 0, 'with every lease live, nothing is claimed');
SELECT pg_temp.assert_true((SELECT count(DISTINCT lease_token) = 6 FROM public.feed_state), 'every lease token is distinct');
RESET ROLE;
-- Wire's and Charts' runs died: their leases ended 1 s ago, 91 s after they were taken.
UPDATE public.feed_state SET leased_at = now() - interval '91 seconds', lease_until = now() - interval '1 second'
 WHERE feature IN ('Wire', 'Charts');
UPDATE public.feed_state SET leased_at = NULL, lease_until = NULL, lease_token = NULL, next_due_at = now() + interval '1 minute'
 WHERE feature = 'Cabinet';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.claim(pg_temp.schedule() - 2, 10) = '{}',
  'a lease that ended with no record is not re-claimed in the same call; a module not yet due is not; an unlisted one is not');
SELECT pg_temp.assert_true(consecutive_failures = 1 AND last_error = 'no result before the lease ended'
    AND next_due_at = now() + interval '2 minutes' AND lease_token IS NULL AND lease_until IS NULL AND leased_at IS NULL
    AND checked_at = now(),
  'an ended lease counts as a failed run: one failure, retry after 2 min, lease released')
  FROM public.feed_state WHERE feature = 'Wire';
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND bool_and(status = 'timeout' AND error = 'no result before the lease ended'
      AND started_at = now() - interval '91 seconds' AND ms = 91000) FROM public.feed_runs WHERE feature = 'Wire'),
  'and is logged as a timeout run from the lease''s start');
SELECT pg_temp.assert_true((SELECT consecutive_failures = 0 AND lease_until = now() - interval '1 second' FROM public.feed_state WHERE feature = 'Charts'),
  'a module left out of the schedule is not touched');
RESET ROLE;
UPDATE public.feed_state SET leased_at = NULL, lease_until = NULL, lease_token = NULL, next_due_at = now() WHERE feature = 'Statements';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.claim(pg_temp.schedule() - 5 - 2, 10) = '{}', 'a due, unleased module left out of the schedule is not claimed');
RESET ROLE;
UPDATE public.feed_state SET next_due_at = now() + interval '1 hour' WHERE feature = 'Statements';
UPDATE public.feed_state SET next_due_at = now() - interval '1 second' WHERE feature = 'Wire';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.claim(pg_temp.schedule(), 10) = ARRAY['news/Wire/'],
  'after its backoff the module is claimed again; Charts, now listed, has its ended lease counted instead');
SELECT pg_temp.assert_true((SELECT consecutive_failures = 1 AND lease_token IS NULL FROM public.feed_state WHERE feature = 'Charts'),
  'Charts'' ended lease is counted as a failure');
RESET ROLE;
UPDATE public.feed_state SET next_due_at = now() - interval '5 minutes' WHERE feature = 'Charts';
UPDATE public.feed_state SET leased_at = NULL, lease_until = NULL, lease_token = NULL, next_due_at = now() - interval '9 minutes'
 WHERE feature = 'Constitutions';
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
SELECT pg_temp.claim(jsonb_set(pg_temp.schedule(45), '{2,kind}', '"news"'), 10);
SELECT pg_temp.assert_true((SELECT kind = 'news' FROM public.feed_state WHERE feature = 'Charts'), 'a changed kind in the schedule is copied');
SELECT pg_temp.claim(pg_temp.schedule(45), 10);
SELECT pg_temp.assert_true((SELECT kind = 'latest' FROM public.feed_state WHERE feature = 'Charts'), 'and copied back');

-- A lease taken 30 days ago: its duration does not fit an integer of milliseconds.
RESET ROLE;
UPDATE public.feed_state SET leased_at = now() - interval '30 days', lease_until = now() - interval '30 days' + interval '90 seconds',
       lease_token = gen_random_uuid() WHERE feature = 'Cabinet';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(cardinality(pg_temp.claim(pg_temp.schedule(45), 10)) = 0, 'a claim over a 30-day-old lease does not overflow');
SELECT pg_temp.assert_true((SELECT consecutive_failures = 1 AND lease_token IS NULL FROM public.feed_state WHERE feature = 'Cabinet')
    AND (SELECT ms IS NULL AND started_at = now() - interval '30 days' AND status = 'timeout'
           FROM public.feed_runs WHERE feature = 'Cabinet' ORDER BY id DESC LIMIT 1),
  'the 30-day-old lease is counted as a failure; its run is logged with ms null');
RESET ROLE;

-- 3. Recording outcomes ------------------------------------------------------------------------
CREATE FUNCTION pg_temp.item(k text, hash text, extra jsonb DEFAULT '{}', pub text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object('item_key', k, 'row', jsonb_build_object('title', 'Title ' || k, 'link', 'https://example.test/' || k) || extra,
                            'title', 'Title ' || k, 'url', 'https://example.test/' || k, 'published_at', pub, 'content_hash', hash);
$$;
CREATE FUNCTION pg_temp.items(n integer, hash text DEFAULT 'h1') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(pg_temp.item('k' || lpad(i::text, 4, '0'), hash) ORDER BY i) FROM generate_series(1, n) AS i;
$$;
CREATE FUNCTION pg_temp.keys(t text, f text, v text DEFAULT '') RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(item_key ORDER BY item_key), '{}') FROM public.feed_items WHERE tier = t AND feature = f AND variant = v;
$$;
-- Takes the module's lease as a run would: due now, claimed alone, the token feed_claim_due returns.
CREATE FUNCTION pg_temp.lease(t text, f text, v text DEFAULT '') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE tok uuid;
BEGIN
  UPDATE public.feed_state SET next_due_at = now(), leased_at = NULL, lease_until = NULL, lease_token = NULL
   WHERE tier = t AND feature = f AND variant = v;
  SELECT c.lease_token INTO tok
    FROM public.feed_claim_due((SELECT jsonb_agg(e) FROM jsonb_array_elements(pg_temp.schedule(45)) AS x(e)
                                 WHERE e ->> 'tier' = t AND e ->> 'feature' = f AND e ->> 'variant' = v), 1, 90) AS c;
  IF tok IS NULL THEN
    RAISE EXCEPTION 'FAIL: could not lease %/%/%', t, f, v;
  END IF;
  RETURN tok;
END;
$$;
-- Claims the module, then records the outcome with that lease token.
CREATE FUNCTION pg_temp.rec(t text, f text, v text, status text, items jsonb,
                            meta jsonb DEFAULT NULL, err text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.feed_record(jsonb_build_object('tier', t, 'feature', f, 'variant', v, 'lease_token', pg_temp.lease(t, f, v),
                                               'status', status, 'ms', 1234, 'items', items, 'meta', meta, 'error', err));
$$;

-- News (Wire): the first record goes through service_role with the token its claim returned.
-- (Wire still holds the lease from section 2; that run is taken to have finished unrecorded.)
RESET ROLE;
UPDATE public.feed_state SET next_due_at = now(), leased_at = NULL, lease_until = NULL, lease_token = NULL WHERE feature = 'Wire';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.claim(pg_temp.schedule(45), 10) = ARRAY['news/Wire/'], 'Wire is claimed for its first record');
SELECT pg_temp.assert_true((r ->> 'status') = 'ok' AND (r ->> 'new_items')::int = 2 AND (r ->> 'item_count')::int = 2,
  'a first ok record with the lease token inserts its items: status ok, 2 new')
  FROM public.feed_record(jsonb_build_object('tier', 'news', 'feature', 'Wire', 'variant', '', 'status', 'ok', 'ms', 1234,
         'lease_token', (SELECT lease_token FROM public.feed_state WHERE feature = 'Wire'),
         'items', jsonb_build_array(pg_temp.item('a', 'h1', '{}', '2000-01-10T08:00:00Z'), pg_temp.item('b', 'h1')),
         'meta', '{"source": "Wire note", "coverage": "national"}'::jsonb)) AS r;
SELECT pg_temp.assert_true(fetched_at = now() AND checked_at = now() AND changed_at = now() AND item_count = 2
    AND consecutive_failures = 0 AND lease_token IS NULL AND lease_until IS NULL AND last_error IS NULL
    AND next_due_at = now() + interval '45 minutes' AND meta ->> 'source' = 'Wire note',
  'the state is healthy, unleased, due after the interval, with the answer''s meta')
  FROM public.feed_state WHERE feature = 'Wire';
RESET ROLE;
UPDATE public.feed_state SET changed_at = now() - interval '1 day' WHERE feature = 'Wire';
UPDATE public.feed_items SET last_seen = now() - interval '1 day' WHERE feature = 'Wire';
SELECT pg_temp.assert_true((r ->> 'status') = 'unchanged' AND (r ->> 'new_items')::int = 0 AND (r ->> 'changed_items')::int = 0,
  'the same hashes again: status unchanged')
  FROM pg_temp.rec('news', 'Wire', '', 'ok',
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
  FROM pg_temp.rec('news', 'Wire', '', 'ok',
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
    FROM public.feed_runs WHERE feature = 'Wire' AND status <> 'timeout'),
  'each run is logged with its status, items, new items and timing');
SELECT public.feed_record(jsonb_build_object('tier', 'news', 'feature', 'Wire', 'lease_token', pg_temp.lease('news', 'Wire'),
  'status', 'ok', 'started_at', '2999-01-01T00:00:00Z', 'items', jsonb_build_array(pg_temp.item('a', 'h2'))));
SELECT pg_temp.assert_true((SELECT started_at = now() FROM public.feed_runs WHERE feature = 'Wire' ORDER BY id DESC LIMIT 1),
  'a started_at in the future is recorded as now');

-- Official (Cabinet): missing items kept; a key twice in one batch keeps the first.
SELECT pg_temp.rec('national', 'Cabinet', '', 'ok', jsonb_build_array(pg_temp.item('a', 'h1'), pg_temp.item('b', 'h1')));
SELECT pg_temp.assert_true((r ->> 'items')::int = 2 AND (r ->> 'new_items')::int = 2,
  'a key listed twice in one batch is stored once')
  FROM pg_temp.rec('national', 'Cabinet', '', 'ok',
                   jsonb_build_array(pg_temp.item('c', 'h1', '{"copy": 1}'), pg_temp.item('c', 'h1', '{"copy": 2}'),
                                     pg_temp.item('d', 'h1'))) AS r;
SELECT pg_temp.assert_true((SELECT row ->> 'copy' = '1' FROM public.feed_items WHERE feature = 'Cabinet' AND item_key = 'c'),
  'the first copy of a duplicated key is kept');
SELECT pg_temp.assert_true(pg_temp.keys('national', 'Cabinet') = ARRAY['a', 'b', 'c', 'd'], 'official keeps items missing from the batch');

-- Charts (latest) and Constitutions (reference): missing items are dropped. The kind a route
-- sends is ignored: Charts sends 'news' and still prunes as latest.
SELECT pg_temp.rec('ent', 'Charts', '', 'ok', jsonb_build_array(pg_temp.item('a', 'h1'), pg_temp.item('b', 'h1')));
SELECT pg_temp.assert_true((r ->> 'status') = 'ok' AND (r ->> 'removed_items')::int = 1,
  'a latest list that drops an item is a change, whatever kind the route sends')
  FROM public.feed_record(jsonb_build_object('tier', 'ent', 'feature', 'Charts', 'variant', '', 'kind', 'news',
         'lease_token', pg_temp.lease('ent', 'Charts'), 'status', 'ok',
         'items', jsonb_build_array(pg_temp.item('a', 'h1'), pg_temp.item('c', 'h1')))) AS r;
SELECT pg_temp.assert_true(pg_temp.keys('ent', 'Charts') = ARRAY['a', 'c'], 'latest drops items missing from the batch');
SELECT pg_temp.assert_true((SELECT bool_and(kind = 'latest') FROM public.feed_items WHERE feature = 'Charts'),
  'items carry the stored kind, not the one sent');
SELECT pg_temp.rec('geo', 'Constitutions', '', 'ok', jsonb_build_array(pg_temp.item('a', 'h1'), pg_temp.item('b', 'h1')));
SELECT pg_temp.rec('geo', 'Constitutions', '', 'ok', jsonb_build_array(pg_temp.item('b', 'h1'), pg_temp.item('c', 'h1')));
SELECT pg_temp.assert_true(pg_temp.keys('geo', 'Constitutions') = ARRAY['b', 'c'], 'reference replaces its set');
SELECT pg_temp.assert_true((SELECT item_count = 2 FROM public.feed_state WHERE feature = 'Constitutions'), 'item_count follows the pruned set');

-- Markets (NSE, measurement): one daily row per item per India day, the day's last value.
SELECT pg_temp.rec('finance', 'NSE', '', 'ok', jsonb_build_array(pg_temp.item('nifty', 'h1', '{"value": 1}')));
SELECT pg_temp.rec('finance', 'NSE', '', 'ok', jsonb_build_array(pg_temp.item('nifty', 'h2', '{"value": 2}')));
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND bool_and(day = (now() AT TIME ZONE 'Asia/Kolkata')::date AND row ->> 'value' = '2')
    FROM public.feed_daily WHERE feature = 'NSE' AND item_key = 'nifty'),
  'a measurement writes one daily row per item, holding the day''s last value');
UPDATE public.feed_daily SET recorded_at = now() - interval '1 hour' WHERE feature = 'NSE';
SELECT pg_temp.rec('finance', 'NSE', '', 'ok', jsonb_build_array(pg_temp.item('nifty', 'h2', '{"value": 2}')));
SELECT pg_temp.assert_true((SELECT recorded_at = now() - interval '1 hour' FROM public.feed_daily WHERE feature = 'NSE'),
  'the same value again does not rewrite the daily row');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.feed_daily WHERE feature <> 'NSE'), 'other kinds write no daily rows');

-- Statement Tracker leader: items live under their variant.
SELECT pg_temp.rec('national', 'Statements', 'Leader One', 'ok', jsonb_build_array(pg_temp.item('q1', 'h1')));
SELECT pg_temp.assert_true(pg_temp.keys('national', 'Statements', 'Leader One') = ARRAY['q1']
    AND pg_temp.keys('national', 'Statements', '') = '{}', 'variant items are kept under their variant');

-- 4. A late run whose lease was taken over (the reviewer's case) ------------------------------
-- Charts holds a and c. Run A claims; its lease ends; the ended lease is counted; after the
-- backoff run B claims, then records three items; A then records one item, late, twice.
CREATE TEMP TABLE tokens (run text PRIMARY KEY, token uuid);
UPDATE public.feed_state SET next_due_at = now() WHERE feature = 'Charts';
INSERT INTO tokens SELECT 'A', c.lease_token FROM public.feed_claim_due(pg_temp.schedule(45), 10, 90) AS c WHERE c.feature = 'Charts';
UPDATE public.feed_state SET lease_until = now() - interval '1 second' WHERE feature = 'Charts';
SELECT pg_temp.assert_true(pg_temp.claim(pg_temp.schedule(45), 10) = '{}', 'A''s ended lease is counted, not re-claimed at once');
UPDATE public.feed_state SET next_due_at = now() WHERE feature = 'Charts';
INSERT INTO tokens SELECT 'B', c.lease_token FROM public.feed_claim_due(pg_temp.schedule(45), 10, 90) AS c WHERE c.feature = 'Charts';
SELECT pg_temp.assert_true((SELECT count(*) = 2 AND count(DISTINCT token) = 2 FROM tokens), 'A and B hold different tokens');
CREATE TEMP TABLE before_b AS SELECT to_jsonb(s) AS state FROM public.feed_state s WHERE feature = 'Charts';
SELECT pg_temp.assert_true(public.feed_record(jsonb_build_object('tier', 'ent', 'feature', 'Charts', 'status', 'ok',
    'lease_token', (SELECT token FROM tokens WHERE run = 'A'), 'items', jsonb_build_array(pg_temp.item('z', 'h1'))))
  = '{"status": "stale"}', 'A recording while B holds the lease is stale');
SELECT pg_temp.assert_true((SELECT to_jsonb(s) FROM public.feed_state s WHERE feature = 'Charts') = (SELECT state FROM before_b)
    AND pg_temp.keys('ent', 'Charts') = ARRAY['a', 'c'], 'B''s lease, token and the items are unchanged');
SELECT pg_temp.assert_true((public.feed_record(jsonb_build_object('tier', 'ent', 'feature', 'Charts', 'status', 'ok',
    'lease_token', (SELECT token FROM tokens WHERE run = 'B'),
    'items', jsonb_build_array(pg_temp.item('a', 'h1'), pg_temp.item('c', 'h1'), pg_temp.item('d', 'h1')))) ->> 'status') = 'ok',
  'B records three items');
CREATE TEMP TABLE after_b AS
  SELECT (SELECT to_jsonb(s) FROM public.feed_state s WHERE feature = 'Charts') AS state,
         (SELECT jsonb_agg(to_jsonb(i) ORDER BY item_key) FROM public.feed_items i WHERE feature = 'Charts') AS items;
SELECT pg_temp.assert_true(public.feed_record(jsonb_build_object('tier', 'ent', 'feature', 'Charts', 'status', 'ok',
    'lease_token', (SELECT token FROM tokens WHERE run = 'A'), 'items', jsonb_build_array(pg_temp.item('z', 'h1'))))
  = '{"status": "stale"}', 'A recording one item late, after B, is stale');
SELECT pg_temp.assert_true((SELECT to_jsonb(s) FROM public.feed_state s WHERE feature = 'Charts') = (SELECT state FROM after_b)
    AND (SELECT jsonb_agg(to_jsonb(i) ORDER BY item_key) FROM public.feed_items i WHERE feature = 'Charts') = (SELECT items FROM after_b)
    AND pg_temp.keys('ent', 'Charts') = ARRAY['a', 'c', 'd'],
  'B''s three items and the state are unchanged: nothing pruned or replaced');
SELECT pg_temp.assert_true((SELECT count(*) = 2 AND bool_and(items = 1 AND error = 'the lease was no longer held; nothing was recorded')
    FROM public.feed_runs WHERE feature = 'Charts' AND status = 'stale'), 'each stale record is logged as a stale run');
SELECT pg_temp.assert_true(public.feed_record(jsonb_build_object('tier', 'ent', 'feature', 'Charts', 'status', 'failed',
    'lease_token', gen_random_uuid())) = '{"status": "stale"}', 'a failure with a stale token is stale');
SELECT pg_temp.assert_true((SELECT consecutive_failures = 0 AND last_error IS NULL FROM public.feed_state WHERE feature = 'Charts'),
  'a stale failure does not count against the module either');

-- 5. Failures back off and keep items ----------------------------------------------------------
UPDATE public.feed_state SET fetched_at = now() - interval '1 hour' WHERE feature = 'Wire';
SELECT pg_temp.assert_true((r ->> 'status') = 'failed' AND (r ->> 'consecutive_failures')::int = 1 AND (r ->> 'item_count')::int = 3,
  'a failure is logged and reports the kept items')
  FROM pg_temp.rec('news', 'Wire', '', 'failed', NULL, NULL, repeat('x', 400)) AS r;
SELECT pg_temp.assert_true(consecutive_failures = 1 AND next_due_at = now() + interval '2 minutes' AND lease_token IS NULL
    AND length(last_error) = 300 AND fetched_at = now() - interval '1 hour' AND checked_at = now() AND item_count = 3,
  'one failure: retry after 2 min, lease released, error cut to 300, fetched_at kept')
  FROM public.feed_state WHERE feature = 'Wire';
SELECT pg_temp.assert_true(pg_temp.keys('news', 'Wire') = ARRAY['a', 'b', 'c'], 'a failure keeps the items');
SELECT pg_temp.rec('news', 'Wire', '', 'timeout', NULL, NULL, 'source timed out');
SELECT pg_temp.assert_true((SELECT consecutive_failures = 2 AND next_due_at = now() + interval '4 minutes' AND last_error = 'source timed out'
    FROM public.feed_state WHERE feature = 'Wire'), 'two failures: retry after 4 min');
SELECT pg_temp.assert_true((SELECT status = 'timeout' AND error = 'source timed out' AND items = 0
    FROM public.feed_runs WHERE feature = 'Wire' ORDER BY id DESC LIMIT 1), 'the timeout run is logged with its error');
SELECT pg_temp.rec('finance', 'NSE', '', 'failed', NULL) FROM generate_series(1, 4);
SELECT pg_temp.assert_true((SELECT consecutive_failures = 4 AND next_due_at = now() + interval '15 minutes' AND last_error = 'failed'
    FROM public.feed_state WHERE feature = 'NSE'), 'four failures on a 15-minute module: 16 min is capped at the interval');
SELECT pg_temp.assert_true((r ->> 'status') = 'empty' AND (r ->> 'removed_items')::int = 0,
  'ok with no items is recorded as empty')
  FROM pg_temp.rec('ent', 'Charts', '', 'ok', '[]') AS r;
SELECT pg_temp.assert_true(pg_temp.keys('ent', 'Charts') = ARRAY['a', 'c', 'd'], 'an empty answer never prunes a latest list');
SELECT pg_temp.assert_true((SELECT consecutive_failures = 1 AND last_error = 'the source answered with no items'
    FROM public.feed_state WHERE feature = 'Charts'), 'an empty answer counts as a failure');
SELECT pg_temp.rec('news', 'Wire', '', 'ok', jsonb_build_array(pg_temp.item('b', 'h1')));
SELECT pg_temp.assert_true((SELECT consecutive_failures = 0 AND last_error IS NULL AND next_due_at = now() + interval '45 minutes'
    FROM public.feed_state WHERE feature = 'Wire'), 'an ok run resets the failures');

-- 6. A near-empty answer for a latest or reference list ----------------------------------------
SELECT pg_temp.rec('geo', 'Constitutions', '', 'ok', pg_temp.items(12));
SELECT pg_temp.assert_true(cardinality(pg_temp.keys('geo', 'Constitutions')) = 12, 'the reference set holds 12');
SELECT pg_temp.assert_true((r ->> 'status') = 'shrunk' AND (r ->> 'consecutive_failures')::int = 1,
  'a batch of 5 against 12 held is recorded as shrunk')
  FROM pg_temp.rec('geo', 'Constitutions', '', 'ok', pg_temp.items(5, 'h9')) AS r;
SELECT pg_temp.assert_true(cardinality(pg_temp.keys('geo', 'Constitutions')) = 12
    AND NOT EXISTS (SELECT FROM public.feed_items WHERE feature = 'Constitutions' AND content_hash = 'h9'),
  'shrunk: nothing pruned and nothing replaced');
SELECT pg_temp.assert_true(consecutive_failures = 1 AND next_due_at = now() + interval '2 minutes'
    AND last_error = '5 items arrived and 12 are held; kept the held list' AND item_count = 12,
  'shrunk is a failure with backoff, and says how many arrived against how many are held')
  FROM public.feed_state WHERE feature = 'Constitutions';
SELECT pg_temp.assert_true((SELECT status = 'shrunk' AND items = 5 AND error LIKE '5 items arrived%'
    FROM public.feed_runs WHERE feature = 'Constitutions' ORDER BY id DESC LIMIT 1), 'the shrunk run is logged');
SELECT pg_temp.assert_true((pg_temp.rec('geo', 'Constitutions', '', 'ok', pg_temp.items(6)) ->> 'status') = 'ok'
    AND cardinality(pg_temp.keys('geo', 'Constitutions')) = 6, 'exactly half is accepted and replaces the set');
SELECT pg_temp.rec('ent', 'Charts', '', 'ok', pg_temp.items(9));
SELECT pg_temp.assert_true((pg_temp.rec('ent', 'Charts', '', 'ok', pg_temp.items(1)) ->> 'status') = 'ok'
    AND cardinality(pg_temp.keys('ent', 'Charts')) = 1, 'a list holding fewer than 10 is replaced as sent');
SELECT pg_temp.rec('national', 'Cabinet', '', 'ok', pg_temp.items(12));
SELECT pg_temp.assert_true((pg_temp.rec('national', 'Cabinet', '', 'ok', pg_temp.items(1)) ->> 'status') = 'unchanged',
  'the shrink rule applies only to latest and reference');

-- A list that really shrinks: the third shrunk answer in a row is accepted.
-- Records the same answer n times, one run after another; returns each run's status.
CREATE FUNCTION pg_temp.rec_times(n integer, t text, f text, items jsonb) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE out text[] := '{}';
BEGIN
  FOR i IN 1..n LOOP
    out := out || (pg_temp.rec(t, f, '', 'ok', items) ->> 'status');
  END LOOP;
  RETURN out;
END;
$$;
SELECT pg_temp.rec('geo', 'Constitutions', '', 'ok', pg_temp.items(20));
SELECT pg_temp.assert_true(cardinality(pg_temp.keys('geo', 'Constitutions')) = 20, 'the reference set holds 20');
SELECT pg_temp.assert_true(pg_temp.rec_times(2, 'geo', 'Constitutions', pg_temp.items(8, 'h8')) = ARRAY['shrunk', 'shrunk'],
  'two answers of 8 against 20 are shrunk');
SELECT pg_temp.assert_true((SELECT shrunk_runs = 2 AND consecutive_failures = 2 FROM public.feed_state WHERE feature = 'Constitutions'),
  'the shrunk streak is 2');
SELECT pg_temp.assert_true((pg_temp.rec('geo', 'Constitutions', '', 'ok', pg_temp.items(20)) ->> 'status') = 'unchanged',
  'a full-sized answer after two shrunk ones is accepted');
SELECT pg_temp.assert_true((SELECT shrunk_runs = 0 AND consecutive_failures = 0 FROM public.feed_state WHERE feature = 'Constitutions'),
  'and resets the streak');
SELECT pg_temp.assert_true(pg_temp.rec_times(2, 'geo', 'Constitutions', pg_temp.items(8, 'h8')) = ARRAY['shrunk', 'shrunk'],
  'after the reset, two more shrunk answers are refused again');
SELECT pg_temp.assert_true(cardinality(pg_temp.keys('geo', 'Constitutions')) = 20, 'and the 20 are still held');
SELECT pg_temp.assert_true((r ->> 'status') = 'ok' AND (r ->> 'removed_items')::int = 12 AND (r ->> 'changed_items')::int = 8
    AND (r ->> 'item_count')::int = 8 AND (r ->> 'consecutive_failures')::int = 0,
  'the third shrunk answer in a row is accepted: pruned and replaced as an ok run')
  FROM pg_temp.rec('geo', 'Constitutions', '', 'ok', pg_temp.items(8, 'h8')) AS r;
SELECT pg_temp.assert_true(pg_temp.keys('geo', 'Constitutions') = (SELECT array_agg('k' || lpad(i::text, 4, '0') ORDER BY i) FROM generate_series(1, 8) AS i)
    AND NOT EXISTS (SELECT FROM public.feed_items WHERE feature = 'Constitutions' AND content_hash <> 'h8'),
  'the set is the 8 sent, with their new content');
SELECT pg_temp.assert_true(shrunk_runs = 0 AND consecutive_failures = 0 AND item_count = 8
    AND last_error = 'the list shrank from 20 to 8 items; accepted after 3 answers in a row',
  'the streak and failures reset, and last_error notes the shrink')
  FROM public.feed_state WHERE feature = 'Constitutions';
SELECT pg_temp.assert_true((SELECT status = 'ok' AND error = 'the list shrank from 20 to 8 items; accepted after 3 answers in a row'
    FROM public.feed_runs WHERE feature = 'Constitutions' ORDER BY id DESC LIMIT 1), 'the accepted run is logged ok with the note');
SELECT pg_temp.rec('geo', 'Constitutions', '', 'ok', pg_temp.items(8, 'h8'));
SELECT pg_temp.assert_true((SELECT last_error IS NULL FROM public.feed_state WHERE feature = 'Constitutions'),
  'the next ok run clears the note');

-- 7. Bad input and caps are refused and change nothing -----------------------------------------
SELECT count(*) AS runs_before FROM public.feed_runs \gset
SELECT md5(string_agg(to_jsonb(s)::text, ',' ORDER BY tier, feature, variant)) AS state_before FROM public.feed_state s \gset
SELECT md5(string_agg(to_jsonb(i)::text, ',' ORDER BY tier, feature, variant, item_key)) AS items_before FROM public.feed_items i \gset
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'partial', '[]')$q$, '22023', 'an unknown status is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_record('{"feature": "Wire", "status": "ok", "lease_token": "00000000-0000-4000-8000-000000000000"}')$q$, '22023', 'a missing tier is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_record('{"tier": "news", "feature": "Wire", "status": "ok"}')$q$, '22023', 'a record without a lease token is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_record('{"tier": "news", "feature": "Wire", "status": "ok", "lease_token": "not-a-uuid"}')$q$, '22023', 'a malformed lease token is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_record('[]')$q$, '22023', 'a non-object outcome is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_record(jsonb_build_object('tier', 'news', 'feature', 'Nowhere', 'status', 'ok', 'lease_token', gen_random_uuid()))$q$, '22023', 'a module that was never claimed is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'ok', jsonb_build_array(pg_temp.item('z', 'h1'), pg_temp.item('y', 'h1') - 'item_key'))$q$,
  '22023', 'an item without item_key is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'ok', jsonb_build_array(jsonb_set(pg_temp.item('z', 'h1'), '{row}', '"text"')))$q$,
  '22023', 'an item whose row is not an object is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'ok', jsonb_build_array(pg_temp.item('z', 'h1') - 'content_hash'))$q$,
  '22023', 'an item without content_hash is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'ok', jsonb_build_array(pg_temp.item('z', 'h1', '{}', 'last Tuesday')))$q$,
  '22023', 'an item with an unreadable published_at is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'ok', '{"a": 1}')$q$, '22023', 'items that are not an array are refused');
SELECT pg_temp.rejected($q$SELECT public.feed_record(jsonb_build_object('tier', 'news', 'feature', 'Wire', 'status', 'failed', 'ms', -5, 'lease_token', pg_temp.lease('news', 'Wire')))$q$,
  '22023', 'a negative ms is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'failed', NULL, '[1]')$q$, '22023', 'meta that is not an object is refused');
-- Caps.
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'ok', pg_temp.items(2001))$q$, '22023', 'more than 2,000 items is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'ok', jsonb_build_array(pg_temp.item('a', 'h1'), pg_temp.item('big', 'h1', jsonb_build_object('body', repeat('x', 70000)))))$q$,
  '22023', 'an item row over 64 KB is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'ok', jsonb_build_array(jsonb_set(pg_temp.item('t', 'h1'), '{title}', to_jsonb(repeat('t', 1001)))))$q$,
  '22023', 'a title over 1,000 characters is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'ok', jsonb_build_array(jsonb_set(pg_temp.item('u', 'h1'), '{url}', to_jsonb('https://example.test/' || repeat('u', 2030)))))$q$,
  '22023', 'a url over 2,048 characters is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'ok', pg_temp.items(1), jsonb_build_object('note', repeat('m', 17000)))$q$,
  '22023', 'meta over 16 KB is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('news', 'Wire', '', 'failed', NULL, jsonb_build_object('note', repeat('m', 17000)))$q$,
  '22023', 'meta over 16 KB is refused on a failure too');
SELECT pg_temp.assert_true((SELECT count(*) = :runs_before FROM public.feed_runs)
    AND (SELECT md5(string_agg(to_jsonb(s)::text, ',' ORDER BY tier, feature, variant)) FROM public.feed_state s) = :'state_before'
    AND (SELECT md5(string_agg(to_jsonb(i)::text, ',' ORDER BY tier, feature, variant, item_key)) FROM public.feed_items i) = :'items_before',
  'refused records changed no item, state or run');
-- Just inside the caps is accepted.
SELECT pg_temp.assert_true((pg_temp.rec('news', 'Wire', '', 'ok',
    jsonb_build_array(jsonb_set(jsonb_set(pg_temp.item('edge', 'h1'), '{title}', to_jsonb(repeat('t', 1000))),
                                '{url}', to_jsonb('https://example.test/' || repeat('u', 2048 - 21)))),
    jsonb_build_object('note', repeat('m', 15000))) ->> 'status') = 'ok', 'a title of 1,000, a url of 2,048 and meta under 16 KB are accepted');
SELECT pg_temp.assert_true((pg_temp.rec('ent', 'Charts', '', 'ok', pg_temp.items(2000)) ->> 'items')::int = 2000, '2,000 items are accepted');

SELECT pg_temp.rejected($q$SELECT public.feed_claim_due('{"tier": "news"}', 5, 90)$q$, '22023', 'a schedule that is not an array is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_claim_due(jsonb_build_array(pg_temp.run('news', 'Fast', '', 'news', 'news', 5)), 5, 90)$q$,
  '22023', 'an interval under 15 minutes is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_claim_due(jsonb_build_array(pg_temp.run('news', 'Odd', '', 'news', 'news', 30) - 'class'), 5, 90)$q$,
  '22023', 'a run without a class is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_claim_due(jsonb_build_array(pg_temp.run('news', 'Odd', '', 'news', 'news', 30) - 'kind'), 5, 90)$q$,
  '22023', 'a run without a kind is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_claim_due(jsonb_build_array(pg_temp.run('news', 'Odd', '', 'news', 'blog', 30)), 5, 90)$q$,
  '22023', 'a run with an unknown kind is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_claim_due(jsonb_build_array(pg_temp.run('news', 'Twice', '', 'news', 'news', 30), pg_temp.run('news', 'Twice', '', 'news', 'news', 60)), 5, 90)$q$,
  '22023', 'a run listed twice is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_claim_due(pg_temp.schedule(), 0, 90)$q$, '22023', 'a zero limit is refused');
SELECT pg_temp.rejected($q$SELECT public.feed_claim_due(pg_temp.schedule(), 5, 1)$q$, '22023', 'a 1-second lease is refused');
SELECT pg_temp.assert_true((SELECT count(*) = 6 FROM public.feed_state), 'refused claims added no module');

-- Direct writes are refused even to the service role; only the serve switch is open.
SET LOCAL ROLE service_role;
SELECT pg_temp.rejected($q$INSERT INTO public.feed_items (tier, feature, item_key, row, kind, content_hash) VALUES ('news', 'Wire', 'x', '{}', 'news', 'h')$q$,
  '42501', 'service_role cannot insert items directly');
SELECT pg_temp.rejected($q$UPDATE public.feed_state SET next_due_at = now() WHERE feature = 'Wire'$q$, '42501', 'service_role cannot edit the schedule directly');
SELECT pg_temp.rejected($q$UPDATE public.feed_state SET lease_token = NULL WHERE feature = 'Wire'$q$, '42501', 'service_role cannot clear a lease directly');
SELECT pg_temp.rejected($q$DELETE FROM public.feed_runs$q$, '42501', 'service_role cannot delete runs directly');
UPDATE public.feed_state SET serve = true WHERE feature = 'Wire';
SELECT pg_temp.assert_true((SELECT serve FROM public.feed_state WHERE feature = 'Wire'), 'service_role can switch serving on');

-- 8. Serving ----------------------------------------------------------------------------------
-- Wire holds a (11 Jan 2000), b and edge (no published_at: first_seen, now) and c (12 Jan 2000).
SELECT pg_temp.assert_true((SELECT array_agg(i ->> 'item_key' ORDER BY o) FROM jsonb_array_elements(pg -> 'items') WITH ORDINALITY AS x(i, o))
      = ARRAY['b', 'edge'] AND (pg ->> 'total')::int = 4 AND (pg ->> 'serve')::boolean AND pg ->> 'kind' = 'news'
      AND (pg ->> 'fetched_at')::timestamptz = now() AND pg -> 'items' -> 0 -> 'row' ->> 'title' = 'Title b',
  'a page is newest first, with the total, the kind, the serve switch and fetched_at')
  FROM public.feed_page('news', 'Wire', '', 2, 0) AS pg;
SELECT pg_temp.assert_true(jsonb_path_query_array(public.feed_page('news', 'Wire', '', 2, 2), '$.items[*].item_key') = '["c", "a"]',
  'the offset pages on');
SELECT pg_temp.assert_true(jsonb_array_length(public.feed_page('news', 'Wire', '', 0, -3) -> 'items') = 1
    AND jsonb_array_length(public.feed_page('news', 'Wire', NULL, 100000, 0) -> 'items') = 4,
  'limit and offset are clamped; a null variant means none');
SELECT pg_temp.assert_true(public.feed_page('news', 'Nowhere', '', 10, 0) IS NULL, 'an unknown module gives null');
SELECT pg_temp.assert_true(jsonb_path_query_array(public.feed_page('national', 'Statements', 'Leader One', 10, 0), '$.items[*].item_key') = '["q1"]',
  'a variant page reads its own items');
RESET ROLE;

-- 9. Purge ------------------------------------------------------------------------------------
INSERT INTO public.feed_runs (tier, feature, variant, started_at, status) VALUES
  ('news', 'Wire', '', now() - interval '31 days', 'ok'),
  ('news', 'Wire', '', now() - interval '29 days', 'ok');
INSERT INTO public.feed_daily (tier, feature, variant, item_key, day, row) VALUES ('finance', 'NSE', '', 'gone', DATE '2025-01-01', '{"value": 0}');
SELECT pg_temp.rec('finance', 'NSE', '', 'ok', jsonb_build_array(pg_temp.item('nifty', 'h2', '{"value": 2}'), pg_temp.item('gone', 'h1'),
                                                                  pg_temp.item('recent', 'h1')));
UPDATE public.feed_items SET last_seen = now() - interval '31 days' WHERE feature = 'NSE' AND item_key = 'gone';
UPDATE public.feed_items SET last_seen = now() - interval '29 days' WHERE feature = 'NSE' AND item_key = 'recent';
UPDATE public.feed_items SET last_seen = now() - interval '40 days' WHERE feature = 'Wire' AND item_key = 'a';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.feed_purge() = '{"feed_runs": 1, "feed_items": 1}',
  'the purge deletes runs older than 30 days and measurement items not seen for 30 days');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.feed_runs WHERE started_at < now() - interval '28 days' AND status = 'ok'),
  'a run 29 days old is kept');
SELECT pg_temp.assert_true(pg_temp.keys('finance', 'NSE') = ARRAY['nifty', 'recent']
    AND (SELECT item_count = 2 FROM public.feed_state WHERE feature = 'NSE'),
  'the measurement item not seen for 31 days is gone, one seen 29 days ago stays, and item_count follows');
SELECT pg_temp.assert_true(pg_temp.keys('news', 'Wire') = ARRAY['a', 'b', 'c', 'edge'], 'other kinds are kept however old');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.feed_daily WHERE item_key = 'gone'), 'the purged item''s daily summaries stay');
RESET ROLE;

-- 10. db_size: platform admins only -----------------------------------------------------------
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
