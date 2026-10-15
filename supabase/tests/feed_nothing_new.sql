-- A kept module whose source listed nothing new is a success (migration 20261015230000; open-work F196,
-- review R2; docs/decisions/0012-scheduled-feeds-records-first.md). PostgreSQL assertions, no pgTAP.
-- Run only in a disposable database, through run.sh.
-- Bootstrap: the feed_register_page chain (the least_privilege chain plus research_turn_persistence,
-- then 20261015150000_feed_records.sql, 20261015160000_feed_admin.sql and
-- 20261015170000_feed_register_page.sql), then 20261015230000_feed_nothing_new.sql, all applied as a
-- non-superuser (nter_migrator, whose default privileges grant everything to anon and authenticated,
-- so a missing revoke shows). The vacuity check drops the last: feed_record then logs the flagged
-- answer 'empty', a failure, so the first outcome assertion fails. run.sh also executes the
-- migration's Down block, compares the schema with the chain without the migration, re-applies the
-- migration and runs this fixture again.
--
-- One transaction, so now() is fixed: times are moved by hand (as the superuser) where a test needs
-- a module to have been fetched earlier. Records run through pg_temp.rec, which claims the module (a
-- real lease token from feed_claim_due) and records with that token.
-- Modules: SDL official (60), Wire news (30), Quakes events (60), Charts latest (60), Tape
-- measurement (15), Constitutions reference (1440).
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

CREATE FUNCTION pg_temp.run(t text, f text, c text, k text, mins integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('tier', t, 'feature', f, 'variant', '', 'class', c, 'kind', k, 'interval_minutes', mins);
$$;
CREATE FUNCTION pg_temp.schedule() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(
    pg_temp.run('state', 'SDL', 'official', 'official', 60),
    pg_temp.run('news', 'Wire', 'news', 'news', 30),
    pg_temp.run('geo', 'Quakes', 'events', 'events', 60),
    pg_temp.run('ent', 'Charts', 'charts', 'latest', 60),
    pg_temp.run('finance', 'Tape', 'markets', 'measurement', 15),
    pg_temp.run('global', 'Constitutions', 'reference', 'reference', 1440));
$$;
-- Takes the module's lease as a run would: due now, claimed alone, the token feed_claim_due returns.
CREATE FUNCTION pg_temp.lease(t text, f text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE tok uuid;
BEGIN
  UPDATE public.feed_state SET next_due_at = now(), leased_at = NULL, lease_until = NULL, lease_token = NULL
   WHERE tier = t AND feature = f AND variant = '';
  SELECT c.lease_token INTO tok
    FROM public.feed_claim_due((SELECT jsonb_agg(e) FROM jsonb_array_elements(pg_temp.schedule()) AS x(e)
                                 WHERE e ->> 'tier' = t AND e ->> 'feature' = f), 1, 90) AS c;
  IF tok IS NULL THEN
    RAISE EXCEPTION 'FAIL: could not lease %/%', t, f;
  END IF;
  RETURN tok;
END;
$$;
CREATE FUNCTION pg_temp.item(k text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('item_key', k, 'row', jsonb_build_object('title', 'Title ' || k), 'title', 'Title ' || k,
                            'url', 'https://example.test/' || k, 'published_at', '2026-10-01T00:00:00Z', 'content_hash', 'h-' || k);
$$;
-- Claims the module, then records the outcome (with `extra` merged in) with that lease token.
CREATE FUNCTION pg_temp.rec(t text, f text, status text, items jsonb, extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.feed_record(jsonb_build_object('tier', t, 'feature', f, 'variant', '', 'lease_token', pg_temp.lease(t, f),
                                               'status', status, 'ms', 321, 'items', items) || extra);
$$;
-- A module last fetched hours ago and failing, as an hour with no new release left it before the fix.
CREATE FUNCTION pg_temp.age(f text) RETURNS void LANGUAGE sql AS $$
  UPDATE public.feed_state SET fetched_at = now() - interval '5 hours', checked_at = now() - interval '5 hours',
         changed_at = now() - interval '5 hours', consecutive_failures = 2, last_error = 'the source answered with no items',
         next_due_at = now(), leased_at = NULL, lease_until = NULL, lease_token = NULL
   WHERE feature = f;
$$;

-- 1. Every module has items to keep --------------------------------------------------------------
SELECT pg_temp.assert_true((SELECT count(*) = 6 FROM public.feed_claim_due(pg_temp.schedule(), 10, 90)), 'six modules are scheduled');
SELECT pg_temp.assert_true((pg_temp.rec('state', 'SDL', 'ok', jsonb_build_array(pg_temp.item('a'), pg_temp.item('b')),
                                        '{"meta": {"note": "SDL note"}}') ->> 'status') = 'ok', 'SDL keeps two auction lines');
SELECT pg_temp.assert_true((pg_temp.rec('news', 'Wire', 'ok', jsonb_build_array(pg_temp.item('w'))) ->> 'status') = 'ok', 'Wire keeps one item');
SELECT pg_temp.assert_true((pg_temp.rec('geo', 'Quakes', 'ok', jsonb_build_array(pg_temp.item('q'))) ->> 'status') = 'ok', 'Quakes keeps one item');
SELECT pg_temp.assert_true((pg_temp.rec('ent', 'Charts', 'ok', jsonb_build_array(pg_temp.item('c'))) ->> 'status') = 'ok', 'Charts holds one item');
SELECT pg_temp.assert_true((pg_temp.rec('finance', 'Tape', 'ok', jsonb_build_array(pg_temp.item('t'))) ->> 'status') = 'ok', 'Tape holds one item');
SELECT pg_temp.assert_true((pg_temp.rec('global', 'Constitutions', 'ok', jsonb_build_array(pg_temp.item('k'))) ->> 'status') = 'ok', 'Constitutions holds one item');

-- 2. Nothing new from a kept module: a success that keeps the history -------------------------------
SELECT pg_temp.age('SDL');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((r ->> 'status') = 'unchanged' AND (r ->> 'items')::int = 0 AND (r ->> 'new_items')::int = 0
    AND (r ->> 'item_count')::int = 2 AND (r ->> 'consecutive_failures')::int = 0
    AND (r ->> 'next_due_at')::timestamptz = now() + interval '60 minutes',
  'an official module''s ok answer with no items and nothing_new is logged unchanged, as service_role')
  FROM public.feed_record(jsonb_build_object('tier', 'state', 'feature', 'SDL', 'variant', '', 'status', 'ok', 'ms', 321,
         'lease_token', (SELECT c.lease_token FROM public.feed_claim_due(
                           (SELECT jsonb_agg(e) FROM jsonb_array_elements(pg_temp.schedule()) AS x(e) WHERE e ->> 'feature' = 'SDL'), 1, 90) AS c),
         'items', '[]'::jsonb, 'nothing_new', true)) AS r;
RESET ROLE;
SELECT pg_temp.assert_true(fetched_at = now() AND checked_at = now() AND changed_at = now() - interval '5 hours'
    AND consecutive_failures = 0 AND shrunk_runs = 0 AND last_error IS NULL AND item_count = 2
    AND next_due_at = now() + interval '60 minutes' AND lease_token IS NULL AND lease_until IS NULL AND leased_at IS NULL
    AND meta ->> 'note' = 'SDL note',
  'the module is fresh and healthy again, due after its interval, unleased; changed_at, item_count and meta stand')
  FROM public.feed_state WHERE feature = 'SDL';
SELECT pg_temp.assert_true((SELECT array_agg(item_key ORDER BY item_key) = ARRAY['a', 'b'] FROM public.feed_items WHERE feature = 'SDL'),
  'the kept items are untouched');
SELECT pg_temp.assert_true((SELECT status = 'unchanged' AND items = 0 AND new_items = 0 AND ms = 321
      AND error = 'the source listed nothing new; the kept items stand'
    FROM public.feed_runs WHERE feature = 'SDL' ORDER BY id DESC LIMIT 1),
  'the run is logged unchanged, with its note');

SELECT pg_temp.age('Wire');
-- (A statement's subqueries read the snapshot it started with, so a record and the check of its
-- effects are separate statements.)
SELECT pg_temp.assert_true((pg_temp.rec('news', 'Wire', 'ok', '[]', '{"nothing_new": true, "meta": {"note": "Wire, nothing new"}}') ->> 'status') = 'unchanged',
  'a news module''s answer with the flag is unchanged');
SELECT pg_temp.assert_true((SELECT fetched_at = now() AND consecutive_failures = 0 AND item_count = 1 AND meta ->> 'note' = 'Wire, nothing new'
           AND next_due_at = now() + interval '30 minutes' FROM public.feed_state WHERE feature = 'Wire'),
  'a news module likewise; a meta sent with the answer replaces the stored one');
SELECT pg_temp.age('Quakes');
SELECT pg_temp.assert_true((pg_temp.rec('geo', 'Quakes', 'ok', '[]', '{"nothing_new": true}') ->> 'status') = 'unchanged',
  'an events module''s answer with the flag is unchanged');
SELECT pg_temp.assert_true((SELECT fetched_at = now() AND consecutive_failures = 0 FROM public.feed_state WHERE feature = 'Quakes'),
  'an events module likewise');

-- 3. The admin screen counts it as an ok run and the module as fresh ---------------------------------
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-4000-8000-0000000fab02', 'admin@example.test');
UPDATE public.user_profiles SET role = 'admin' WHERE user_id = '00000000-0000-4000-8000-0000000fab02';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000fab02', true);
CREATE TEMP TABLE got AS SELECT * FROM public.feed_admin_status();
RESET ROLE;
SELECT pg_temp.assert_true((SELECT last_run_status = 'unchanged' AND runs_failed_24h = 0 AND runs_ok_24h = 2 AND NOT stale
      AND consecutive_failures = 0 AND last_error IS NULL FROM got WHERE feature = 'SDL'),
  'feed_admin_status: SDL''s last run is unchanged, no failed run, not stale');

-- 4. Everything else is as before -------------------------------------------------------------------
SELECT pg_temp.age('SDL');
SELECT pg_temp.assert_true((pg_temp.rec('state', 'SDL', 'ok', '[]') ->> 'status') = 'empty', 'no flag: empty');
SELECT pg_temp.assert_true((SELECT fetched_at = now() - interval '5 hours' AND consecutive_failures = 3 AND last_error = 'the source answered with no items'
           AND item_count = 2 FROM public.feed_state WHERE feature = 'SDL'),
  'an ok answer with no items and no flag is still empty: a failure, fetched_at not advanced');
SELECT pg_temp.assert_true((pg_temp.rec('state', 'SDL', 'ok', '[]', '{"nothing_new": false}') ->> 'status') = 'empty',
  'nothing_new false is no flag');
SELECT pg_temp.assert_true((pg_temp.rec('state', 'SDL', 'failed', '[]', '{"nothing_new": true, "error": "RSS unreachable"}') ->> 'status') = 'failed',
  'a failed answer with the flag: failed');
SELECT pg_temp.assert_true((SELECT consecutive_failures = 5 AND last_error = 'RSS unreachable' FROM public.feed_state WHERE feature = 'SDL'),
  'the flag on a failed answer changes nothing: still a failure');
SELECT pg_temp.assert_true((pg_temp.rec('state', 'SDL', 'ok', jsonb_build_array(pg_temp.item('c')), '{"nothing_new": true}') ->> 'status') = 'ok',
  'the flag with items: ok');
SELECT pg_temp.assert_true((SELECT item_count = 3 AND consecutive_failures = 0 FROM public.feed_state WHERE feature = 'SDL'),
  'the flag with items is an ordinary ok: the new item is kept');
SELECT pg_temp.assert_true((pg_temp.rec('ent', 'Charts', 'ok', '[]', '{"nothing_new": true}') ->> 'status') = 'empty'
    AND (pg_temp.rec('finance', 'Tape', 'ok', '[]', '{"nothing_new": true}') ->> 'status') = 'empty'
    AND (pg_temp.rec('global', 'Constitutions', 'ok', '[]', '{"nothing_new": true}') ->> 'status') = 'empty',
  'latest, measurement and reference answers with the flag: empty');
SELECT pg_temp.assert_true((SELECT bool_and(item_count = 1 AND consecutive_failures = 1) FROM public.feed_state WHERE feature IN ('Charts', 'Tape', 'Constitutions')),
  'kinds that replace their items (latest, measurement, reference) ignore the flag: still empty, a failure');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('state', 'SDL', 'ok', '[]', '{"nothing_new": "yes"}')$q$, '22023',
  'a nothing_new that is not true or false is refused');
SELECT pg_temp.rejected($q$SELECT pg_temp.rec('state', 'SDL', 'ok', '[]', '{"nothing_new": 1}')$q$, '22023',
  'a numeric nothing_new is refused');

-- A run that no longer holds the lease is stale, flag or not.
SELECT pg_temp.assert_true((public.feed_record(jsonb_build_object('tier', 'state', 'feature', 'SDL', 'variant', '', 'status', 'ok',
      'lease_token', '00000000-0000-4000-8000-00000000dead', 'items', '[]'::jsonb, 'nothing_new', true)) ->> 'status') = 'stale',
  'a stale run with the flag is only logged stale');

-- 5. Privileges are unchanged ------------------------------------------------------------------------
SELECT pg_temp.assert_true(p.prosecdef AND p.proconfig = ARRAY['search_path=""'], 'feed_record is SECURITY DEFINER with search_path ''''')
  FROM pg_proc p WHERE p.oid = 'public.feed_record(jsonb)'::regprocedure;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.feed_record(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.feed_record(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('public', 'public.feed_record(jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.feed_record(jsonb)', 'EXECUTE'),
  'only service_role may execute feed_record');

ROLLBACK;
