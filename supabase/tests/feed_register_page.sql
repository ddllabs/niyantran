-- A register module's first page across its variants in one read, and a register never stale
-- (migration 20261015170000; open-work F169 phase 4, owner decision C6 option 1). PostgreSQL
-- assertions, no pgTAP. Run only in a disposable database, through run.sh.
-- Bootstrap: the feed_admin chain (feed_records' chain, then 20261015150000_feed_records.sql and
-- 20261015160000_feed_admin.sql), then 20261015170000_feed_register_page.sql, all applied as a
-- non-superuser (nter_migrator, whose default privileges grant everything to anon and authenticated,
-- so a missing revoke shows). The vacuity check drops the last: feed_page_across() is then missing,
-- so the first assertion fails. run.sh also executes the migration's Down block and compares the
-- schema with the chain without the migration.
--
-- One transaction, so now() is fixed and times are set as offsets from it.
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
    WHERE p.oid = 'public.feed_page_across(text, text, integer)'::regprocedure
      AND p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']),
  'feed_page_across exists, SECURITY DEFINER, STABLE, with search_path ''''');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.feed_page_across(text, text, integer)', 'EXECUTE'), 'service_role may call it');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.feed_page_across(text, text, integer)', 'EXECUTE'), 'anon cannot execute it');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.feed_page_across(text, text, integer)', 'EXECUTE'), 'authenticated cannot execute it');
SELECT pg_temp.assert_true(NOT has_function_privilege('public', 'public.feed_page_across(text, text, integer)', 'EXECUTE'), 'public cannot execute it');
-- feed_admin_status keeps its grants after create or replace.
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM pg_proc p
    WHERE p.oid = 'public.feed_admin_status()'::regprocedure
      AND p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']),
  'feed_admin_status is still SECURITY DEFINER, STABLE, with search_path ''''');
SELECT pg_temp.assert_true(has_function_privilege('authenticated', 'public.feed_admin_status()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.feed_admin_status()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.feed_admin_status()', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.feed_admin_status()', 'EXECUTE'),
  'feed_admin_status keeps its grants: authenticated only');

-- 2. Seed ---------------------------------------------------------------------------------------
-- A register module with three variants, of a kept kind (official) as the loader stores it, and a
-- second module whose rows must not leak in. Alpha holds 120 items for the clamp; Beta's items
-- test the kept-kind order; Gamma is a replacing kind (reference), ordered by position alone.
INSERT INTO public.feed_state (tier, feature, variant, class, kind, interval_minutes, serve, fetched_at, item_count, meta, created_at) VALUES
  ('state', 'Reg', 'Alpha', 'register', 'official', 43200, true, now() - interval '200 days', 120, '{"note": "alpha"}', now() - interval '300 days'),
  ('state', 'Reg', 'Beta', 'register', 'official', 43200, true, now() - interval '3 days', 4, '{"note": "beta"}', now() - interval '300 days'),
  ('state', 'Reg', 'Gamma', 'reference', 'reference', 1440, false, now() - interval '1 day', 3, '{}', now() - interval '300 days'),
  ('state', 'Other', 'Alpha', 'register', 'official', 43200, true, now(), 1, '{}', now());

INSERT INTO public.feed_items (tier, feature, variant, item_key, row, published_at, first_seen, kind, content_hash, position)
SELECT 'state', 'Reg', 'Alpha', format('a%s', lpad(g::text, 3, '0')), jsonb_build_object('title', format('Alpha %s', g)),
       NULL, now() - interval '200 days', 'official', 'h', g - 1
  FROM generate_series(1, 120) AS g;
-- Beta: published dates decide first; two items share a published time, so position decides; one has none (first_seen).
INSERT INTO public.feed_items (tier, feature, variant, item_key, row, published_at, first_seen, kind, content_hash, position) VALUES
  ('state', 'Reg', 'Beta', 'b-old', '{"title": "old"}', now() - interval '10 days', now() - interval '3 days', 'official', 'h', 0),
  ('state', 'Reg', 'Beta', 'b-new-2', '{"title": "new pos 2"}', now() - interval '1 day', now() - interval '3 days', 'official', 'h', 2),
  ('state', 'Reg', 'Beta', 'b-new-1', '{"title": "new pos 1"}', now() - interval '1 day', now() - interval '3 days', 'official', 'h', 1),
  ('state', 'Reg', 'Beta', 'b-undated', '{"title": "undated"}', NULL, now() - interval '5 days', 'official', 'h', 3),
-- Gamma: by position, whatever the dates.
  ('state', 'Reg', 'Gamma', 'g2', '{"title": "g second"}', now(), now(), 'reference', 'h', 1),
  ('state', 'Reg', 'Gamma', 'g1', '{"title": "g first"}', now() - interval '9 days', now(), 'reference', 'h', 0),
  ('state', 'Reg', 'Gamma', 'g3', '{"title": "g third"}', now() + interval '1 day', now(), 'reference', 'h', 2),
  ('state', 'Other', 'Alpha', 'leak', '{"title": "other module"}', now(), now(), 'official', 'h', 0);

-- 3. Access -----------------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT pg_temp.rejected($q$SELECT public.feed_page_across('state', 'Reg', 5)$q$, '42501', 'anon cannot call it');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.rejected($q$SELECT public.feed_page_across('state', 'Reg', 5)$q$, '42501', 'authenticated cannot call it');
RESET ROLE;

-- 4. Partly served: counts only, no pages ------------------------------------------------------
SET LOCAL ROLE service_role;
CREATE TEMP TABLE part AS SELECT public.feed_page_across('state', 'Reg', 5) AS j;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT (j ->> 'variants')::int = 3 AND (j ->> 'served')::int = 2 AND (j ->> 'all_served')::boolean = false FROM part),
  'partly served: three variants, two served, not all served');
SELECT pg_temp.assert_true((SELECT j -> 'pages' = '[]'::jsonb FROM part), 'partly served: no pages, so the caller goes live without reading items');
SELECT pg_temp.assert_true((SELECT (j ->> 'fetched_at')::timestamptz = now() - interval '1 day' AND (j ->> 'total')::int = 127 FROM part),
  'the newest fetched_at and the sum of the item counts');

-- 5. All served ---------------------------------------------------------------------------------
UPDATE public.feed_state SET serve = true WHERE tier = 'state' AND feature = 'Reg';
SET LOCAL ROLE service_role;
CREATE TEMP TABLE full_page AS SELECT public.feed_page_across('state', 'Reg', 2) AS j;
CREATE TEMP TABLE single AS
  SELECT v AS variant, public.feed_page('state', 'Reg', v, 2, 0) AS p FROM unnest(ARRAY['Alpha', 'Beta', 'Gamma']) AS v;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT (j ->> 'all_served')::boolean AND (j ->> 'served')::int = 3 AND (j ->> 'variants')::int = 3 FROM full_page),
  'all served');
SELECT pg_temp.assert_true((SELECT array_agg(e ->> 'variant' ORDER BY o) = ARRAY['Alpha', 'Beta', 'Gamma']
    FROM full_page, jsonb_array_elements(j -> 'pages') WITH ORDINALITY AS x(e, o)),
  'one page per variant of this module only, ordered by variant');
SELECT pg_temp.assert_true((SELECT array_agg(e ->> 'item_key' ORDER BY o) = ARRAY['b-new-1', 'b-new-2']
    FROM full_page, jsonb_array_elements(j -> 'pages') AS pg(p), jsonb_array_elements(p -> 'items') WITH ORDINALITY AS x(e, o)
   WHERE p ->> 'variant' = 'Beta'),
  'a kept kind: newest first, then position within one published time');
SELECT pg_temp.assert_true((SELECT array_agg(e ->> 'item_key' ORDER BY o) = ARRAY['g1', 'g2']
    FROM full_page, jsonb_array_elements(j -> 'pages') AS pg(p), jsonb_array_elements(p -> 'items') WITH ORDINALITY AS x(e, o)
   WHERE p ->> 'variant' = 'Gamma'),
  'a replacing kind: by position, whatever the dates');
SELECT pg_temp.assert_true((SELECT bool_and(pg.p -> 'items' = s.p -> 'items')
    FROM full_page, jsonb_array_elements(j -> 'pages') AS pg(p) JOIN single s ON s.variant = pg.p ->> 'variant'),
  'each variant''s items are exactly feed_page''s first page, fields and order');
SELECT pg_temp.assert_true((SELECT p ->> 'class' = 'register' AND p ->> 'kind' = 'official' AND (p ->> 'serve')::boolean
      AND (p ->> 'total')::int = 120 AND (p ->> 'interval_minutes')::int = 43200 AND p -> 'meta' = '{"note": "alpha"}'::jsonb
      AND (p ->> 'fetched_at')::timestamptz = now() - interval '200 days'
    FROM full_page, jsonb_array_elements(j -> 'pages') AS pg(p) WHERE p ->> 'variant' = 'Alpha'),
  'a page carries its variant''s state: class, kind, serve, total, interval, meta, fetched_at');
-- A fourth variant later added with serve off makes the module partly served again.
INSERT INTO public.feed_state (tier, feature, variant, class, kind, interval_minutes, serve) VALUES ('state', 'Reg', 'Delta', 'register', 'official', 43200, false);
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT (j ->> 'all_served')::boolean = false AND (j ->> 'variants')::int = 4 AND j -> 'pages' = '[]'::jsonb
    FROM (SELECT public.feed_page_across('state', 'Reg', 2) AS j) t),
  'a new variant with serve off: not all served');
RESET ROLE;
DELETE FROM public.feed_state WHERE variant = 'Delta';

-- 6. The per-variant clamp ----------------------------------------------------------------------
SET LOCAL ROLE service_role;
CREATE TEMP TABLE clamp AS
  SELECT n, (SELECT jsonb_array_length(p -> 'items') FROM jsonb_array_elements(public.feed_page_across('state', 'Reg', n) -> 'pages') AS pg(p)
              WHERE p ->> 'variant' = 'Alpha') AS got
    FROM unnest(ARRAY[NULL, -5, 0, 1, 16, 100, 101, 1000]::int[]) AS n;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT array_agg(coalesce(got, -1) ORDER BY coalesce(n, -999)) = ARRAY[1, 1, 1, 1, 16, 100, 100, 100] FROM clamp),
  'items per variant are clamped to 1..100 (null, negative and 0 give 1; over 100 gives 100)');

-- 7. Unknown module -----------------------------------------------------------------------------
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.feed_page_across('state', 'No Such', 5) IS NULL, 'a module with no variant: null');
RESET ROLE;

-- 8. feed_admin_status: a register is never stale ----------------------------------------------
INSERT INTO public.feed_state (tier, feature, variant, class, kind, interval_minutes, serve, fetched_at, created_at) VALUES
  -- An official module on a 30-day interval that is not a register, as old as Alpha: stale.
  ('state', 'Not a register', '', 'official', 'official', 43200, false, now() - interval '200 days', now() - interval '300 days'),
  -- A register variant never fetched, listed long ago: still not stale.
  ('state', 'Reg', 'Never', 'register', 'official', 43200, false, NULL, now() - interval '300 days'),
  -- An ordinary module one second past its limit: still stale.
  ('news', 'Wire Late', '', 'news', 'news', 30, true, now() - interval '120 minutes 1 second', now() - interval '9 days');
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-4000-8000-0000000fed02', 'admin@example.test');
UPDATE public.user_profiles SET role = 'admin' WHERE user_id = '00000000-0000-4000-8000-0000000fed02';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000fed02', true);
CREATE TEMP TABLE got AS SELECT * FROM public.feed_admin_status();
RESET ROLE;
SELECT pg_temp.assert_true((SELECT bool_and(NOT stale) AND count(*) = 4 FROM got WHERE class = 'register'),
  'no register row is stale: 200 days old, never fetched, or fresh');
SELECT pg_temp.assert_true((SELECT stale AND stale_after_minutes = 129600 FROM got WHERE feature = 'Not a register'),
  'an official module that is not a register, as old, is still stale');
SELECT pg_temp.assert_true((SELECT stale FROM got WHERE feature = 'Wire Late'), 'an ordinary module past its limit is still stale');
SELECT pg_temp.assert_true((SELECT stale_after_minutes = 129600 AND interval_minutes = 43200 AND item_count = 120
    FROM got WHERE feature = 'Reg' AND variant = 'Alpha'),
  'a register row keeps its other columns');
SELECT pg_temp.assert_true((SELECT count(*) = 7 FROM got), 'one row per module and variant, as before');

ROLLBACK;
