-- F160: empty checked sources are distinct from retained unchanged data.
-- Status: Normative. Local disposable fixture only.
-- Bootstrap: feed_nothing_new chain, then 20261017094845_feed_empty_outcome.sql.
-- run.sh proves this fails without that last migration and verifies its Down.
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


SELECT public.feed_claim_due(pg_temp.schedule(), 10, 90);
SELECT pg_temp.age('SDL');
SELECT pg_temp.assert_true((pg_temp.rec('state', 'SDL', 'ok', '[]', '{"nothing_new":true}') ->> 'status') = 'ok',
  'a verified empty initial source is a successful check, not retained unchanged content');
SELECT pg_temp.assert_true(item_count = 0 AND fetched_at = now() - interval '5 hours'
  AND checked_at = now() AND consecutive_failures = 0 AND meta ->> 'availability' = 'empty'
  AND lease_token IS NULL, 'empty availability is explicit, source healthy, content freshness unchanged')
FROM public.feed_state WHERE feature = 'SDL';
SELECT pg_temp.assert_true((SELECT status = 'ok' AND items = 0 AND error = 'the source was checked; no stored items exist'
 FROM public.feed_runs WHERE feature='SDL' ORDER BY id DESC LIMIT 1), 'empty check has a truthful run note');
SELECT pg_temp.assert_true((pg_temp.rec('state', 'SDL', 'failed', '[]', '{"nothing_new":true,"error":"unreadable"}') ->> 'status') = 'failed',
 'an unreadable source cannot turn itself into an empty success');
SELECT pg_temp.assert_true((SELECT consecutive_failures=1 FROM public.feed_state WHERE feature='SDL'), 'source refusal increments failure count');

SELECT pg_temp.rec('geo', 'Quakes', 'ok', jsonb_build_array(pg_temp.item('q')));
UPDATE public.feed_state SET fetched_at=now()-interval '5 hours', checked_at=now()-interval '5 hours' WHERE feature='Quakes';
UPDATE public.feed_items SET last_seen=now()-interval '5 hours' WHERE feature='Quakes';
SELECT pg_temp.assert_true((pg_temp.rec('geo', 'Quakes', 'ok', '[]', '{"nothing_new":true}') ->> 'status') = 'unchanged', 'retained events are unchanged');
SELECT pg_temp.assert_true((SELECT fetched_at=now()-interval '5 hours' AND checked_at=now() AND item_count=1 FROM public.feed_state WHERE feature='Quakes'),
 'events keep their content-run marker while their source-check time advances');
SELECT pg_temp.assert_true((SELECT i.last_seen = s.fetched_at FROM public.feed_items i JOIN public.feed_state s USING(tier,feature,variant) WHERE i.feature='Quakes'),
 'latest-run filtering still sees the retained event');
SELECT pg_temp.assert_true((pg_temp.rec('news', 'Wire', 'ok', jsonb_build_array(pg_temp.item('w'))) ->> 'status') = 'ok', 'ordinary records still work');
SELECT pg_temp.assert_true((pg_temp.rec('news', 'Wire', 'ok', '[]', '{"nothing_new":true}') ->> 'status') = 'unchanged', 'retained news still logs unchanged');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.feed_record(jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.feed_record(jsonb)','EXECUTE')
 AND has_function_privilege('service_role','public.feed_record(jsonb)','EXECUTE'), 'writer remains service-only');
ROLLBACK;
