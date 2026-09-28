-- Disposable PG assertions for S2 analytics events (migration
-- 20260928100100_analytics_events.sql), on the least-privilege chain plus the
-- research-turn migration. Test databases have no pg_cron, so the nightly
-- schedule is skipped; the purge it runs is exercised directly below.
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

SELECT pg_temp.assert_true(to_regclass('public.analytics_events') IS NOT NULL, 'analytics_events exists');
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.analytics_events'::regclass), 'RLS is enabled');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_events'), 'no client policies');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'analytics_events'
     AND indexdef LIKE ANY (ARRAY['%(created_at)', '%(name, created_at)'])),
  'created_at and (name, created_at) indexes exist');

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-4000-8000-0000000000e1', 'events.a@example.invalid');

-- Privilege matrix: clients hold nothing; the service holds exactly S/I/D.
DO $$
DECLARE actor text; privilege text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, 'public.analytics_events', privilege), actor || ' cannot ' || privilege || ' events');
    END LOOP;
    PERFORM pg_temp.assert_true(NOT has_sequence_privilege(actor, 'public.analytics_events_id_seq', 'USAGE'), actor || ' cannot use the id sequence');
    PERFORM pg_temp.assert_true(NOT has_function_privilege(actor, 'public.analytics_event_summary(integer)', 'EXECUTE'), actor || ' cannot read the summary');
    PERFORM pg_temp.assert_true(NOT has_function_privilege(actor, 'public.purge_analytics_events()', 'EXECUTE'), actor || ' cannot purge');
  END LOOP;
  FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','DELETE'] LOOP
    PERFORM pg_temp.assert_true(has_table_privilege('service_role', 'public.analytics_events', privilege), 'service can ' || privilege || ' events');
  END LOOP;
  FOREACH privilege IN ARRAY ARRAY['UPDATE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
    PERFORM pg_temp.assert_true(NOT has_table_privilege('service_role', 'public.analytics_events', privilege), 'service cannot ' || privilege || ' events');
  END LOOP;
END; $$;

-- Real statements as each client role are refused.
SET LOCAL ROLE anon;
SELECT pg_temp.rejected($q$SELECT * FROM public.analytics_events$q$, '42501', 'anon cannot select');
SELECT pg_temp.rejected($q$INSERT INTO public.analytics_events(name) VALUES ('home_open')$q$, '42501', 'anon cannot insert');
SELECT pg_temp.rejected($q$UPDATE public.analytics_events SET name = 'x'$q$, '42501', 'anon cannot update');
SELECT pg_temp.rejected($q$DELETE FROM public.analytics_events$q$, '42501', 'anon cannot delete');
SELECT pg_temp.rejected($q$SELECT public.analytics_event_summary()$q$, '42501', 'anon cannot call the summary');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000e1';
SELECT pg_temp.rejected($q$SELECT * FROM public.analytics_events$q$, '42501', 'authenticated cannot select');
SELECT pg_temp.rejected($q$INSERT INTO public.analytics_events(name, user_id) VALUES ('home_open', auth.uid())$q$, '42501', 'authenticated cannot insert');
SELECT pg_temp.rejected($q$UPDATE public.analytics_events SET name = 'x'$q$, '42501', 'authenticated cannot update');
SELECT pg_temp.rejected($q$DELETE FROM public.analytics_events$q$, '42501', 'authenticated cannot delete');
SELECT pg_temp.rejected($q$SELECT public.purge_analytics_events()$q$, '42501', 'authenticated cannot purge');
RESET ROLE;

-- The service inserts (anonymous and attributed) and reads back.
SET LOCAL ROLE service_role;
INSERT INTO public.analytics_events(name, props, session_id) VALUES ('home_open', '{"deskId":"home"}', 's-abc-123');
INSERT INTO public.analytics_events(name, user_id) VALUES ('home_open', '00000000-0000-4000-8000-0000000000e1');
INSERT INTO public.analytics_events(name) VALUES ('tour_done');
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM public.analytics_events), 'service can insert and select');
SELECT pg_temp.assert_true((SELECT props = '{}'::jsonb AND session_id IS NULL AND user_id IS NULL AND created_at IS NOT NULL
  FROM public.analytics_events WHERE name = 'tour_done'), 'defaults fill props and created_at');
SELECT pg_temp.assert_true(public.analytics_event_summary() = '{"total":3,"byName":[{"name":"home_open","n":2},{"name":"tour_done","n":1}]}'::jsonb,
  'summary counts by name');
SELECT pg_temp.assert_true(public.analytics_event_summary(1) -> 'byName' = '[{"name":"home_open","n":2}]'::jsonb
  AND (public.analytics_event_summary(1) ->> 'total')::bigint = 3, 'summary limit trims names, not the total');
SELECT pg_temp.rejected($q$UPDATE public.analytics_events SET name = 'x'$q$, '42501', 'service cannot rewrite events');

-- Every CHECK bound rejects an oversize or invalid value.
SELECT pg_temp.rejected($q$INSERT INTO public.analytics_events(name) VALUES (repeat('a', 65))$q$, '23514', 'name over 64 characters');
SELECT pg_temp.rejected($q$INSERT INTO public.analytics_events(name) VALUES ('')$q$, '23514', 'empty name');
SELECT pg_temp.rejected($q$INSERT INTO public.analytics_events(name) VALUES ('Home_Open')$q$, '23514', 'uppercase name');
SELECT pg_temp.rejected($q$INSERT INTO public.analytics_events(name) VALUES ('home open')$q$, '23514', 'name with a space');
SELECT pg_temp.rejected($q$INSERT INTO public.analytics_events(name) VALUES ('_home')$q$, '23514', 'name starting with punctuation');
SELECT pg_temp.rejected($q$INSERT INTO public.analytics_events(name) VALUES ('<script>')$q$, '23514', 'name with markup');
SELECT pg_temp.rejected($q$INSERT INTO public.analytics_events(name) VALUES (NULL)$q$, '23502', 'null name');
SELECT pg_temp.rejected($q$INSERT INTO public.analytics_events(name, props) VALUES ('home_open', jsonb_build_object('blob', repeat('x', 4096)))$q$, '23514', 'props over 4096 bytes');
SELECT pg_temp.rejected($q$INSERT INTO public.analytics_events(name, props) VALUES ('home_open', '["x"]')$q$, '23514', 'array props');
SELECT pg_temp.rejected($q$INSERT INTO public.analytics_events(name, props) VALUES ('home_open', NULL)$q$, '23502', 'null props');
SELECT pg_temp.rejected($q$INSERT INTO public.analytics_events(name, session_id) VALUES ('home_open', repeat('s', 65))$q$, '23514', 'session id over 64 characters');
SELECT pg_temp.rejected($q$INSERT INTO public.analytics_events(name, user_id) VALUES ('home_open', '00000000-0000-4000-8000-0000000000ff')$q$, '23503', 'unknown user');
SELECT pg_temp.rejected($q$INSERT INTO public.analytics_events(id, name) VALUES (1, 'home_open')$q$, '428C9', 'id is always generated');
-- The largest accepted values still fit.
INSERT INTO public.analytics_events(name, props, session_id)
  VALUES (repeat('a', 64), jsonb_build_object('b', repeat('x', 4096 - octet_length('{"b": ""}'))), repeat('s', 64));
SELECT pg_temp.assert_true((SELECT octet_length(props::text) = 4096 FROM public.analytics_events WHERE name = repeat('a', 64)), 'props of exactly 4096 bytes accepted');
SELECT pg_temp.assert_true(
  (SELECT bool_and(name ~ '^[a-z0-9][a-z0-9_.:-]*$') FROM unnest(ARRAY['home_open','persona_persisted','persona_selected','tour_done','plan_selected','plan_upgraded','ai_export']) AS name),
  'every event name the client sends fits the pattern');
RESET ROLE;

-- Deleting the user keeps the event and forgets who sent it.
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-0000000000e1';
SELECT pg_temp.assert_true((SELECT count(*) = 2 AND bool_and(user_id IS NULL) FROM public.analytics_events WHERE name = 'home_open'),
  'user deletion sets user_id null');

-- D3 retention: rows older than 180 days go; newer rows stay.
INSERT INTO public.analytics_events(name, created_at) VALUES
  ('old_event', now() - interval '181 days'),
  ('edge_event', now() - interval '179 days');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.purge_analytics_events() = 1, 'purge removes one expired row');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.analytics_events WHERE name = 'old_event'), 'expired row is gone');
SELECT pg_temp.assert_true(EXISTS (SELECT FROM public.analytics_events WHERE name = 'edge_event'), 'row inside 180 days is kept');
SELECT pg_temp.assert_true(public.purge_analytics_events() = 0, 'purge is idempotent');
RESET ROLE;
ROLLBACK;
