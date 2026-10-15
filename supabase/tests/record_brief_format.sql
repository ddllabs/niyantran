-- The record brief's analysis-box format (migration 20261015240000; open-work F123, owner decision
-- 2026-10-15). PostgreSQL assertions, no pgTAP. Run only in a disposable database, through run.sh.
-- Bootstrap: record_briefs' chain (the ai_credits chain, the Storage stub, app_flags, then
-- 20261015220000_record_briefs.sql), then 20261015240000_record_brief_format.sql, both applied as a
-- non-superuser (nter_migrator). The vacuity check drops the last: brief_format is then missing, so
-- the first assertion fails. run.sh also executes the migration's Down block over a format-2 brief.
--
-- One transaction, so now() is fixed; times are moved by hand (as the superuser). Claims and
-- finishes run as service_role, as desk-brief runs them. A format-1 brief (headline and three
-- points) is inserted directly, as 20261015220000 left them on NTER.
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

CREATE TEMP TABLE res (k text PRIMARY KEY, v jsonb);
GRANT ALL ON res TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.r(p_key text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM res WHERE k = p_key $$;

-- A claim from the new desk-brief (format 2), and one from the desk-brief deployed before (9 arguments).
CREATE FUNCTION pg_temp.claim(p_row text, p_hash text, u uuid DEFAULT '00000000-0000-4000-8000-0000000000c1')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.record_brief_claim('global', 'Open Fronts', p_row, p_hash, 'desk_rows', u, 100, 1000, 10000, 2) $$;
CREATE FUNCTION pg_temp.claim_old(p_row text, p_hash text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.record_brief_claim('global', 'Open Fronts', p_row, p_hash, 'desk_rows', '00000000-0000-4000-8000-0000000000c1', 100, 1000, 10000) $$;
-- The format-2 brief desk-brief finishes with: the lead brief in headline, the rest in points.
CREATE FUNCTION pg_temp.brief2(p_lead text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('format', 2, 'headline', p_lead,
    'points', jsonb_build_object('why', 'It is rated critical.', 'watch', 'The record names no next step.',
                                 'tags', jsonb_build_array('Eastern Europe', 'Critical')),
    'model', 'anthropic/claude-haiku-5.5', 'prompt_tokens', 400, 'completion_tokens', 160, 'reasoning_tokens', 0,
    'cost_usd', 0.0003, 'model_call_log_id', gen_random_uuid()) $$;
CREATE FUNCTION pg_temp.row_of(p_row text) RETURNS public.record_briefs LANGUAGE sql AS $$
  SELECT * FROM public.record_briefs WHERE tier = 'global' AND feature = 'Open Fronts' AND row_key = p_row $$;
-- A ready format-1 brief, written p_age ago, as 20261015220000 stored them.
CREATE FUNCTION pg_temp.old_brief(p_row text, p_hash text, p_age interval) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.record_briefs (tier, feature, row_key, hash_key, source, content_hash, status, headline, points, model, written_at)
  VALUES ('global', 'Open Fronts', p_row, '', 'desk_rows', p_hash, 'ready', 'Old headline',
          '["Old one.", "Old two.", "Old three."]', 'anthropic/claude-haiku-5.5', now() - p_age) $$;

\set h1 '''aaaaaaaaaaaaaaaaaaaaaaaa'''
\set h2 '''bbbbbbbbbbbbbbbbbbbbbbbb'''

-- 1. Objects, signatures and privileges ---------------------------------------------------------
SELECT pg_temp.assert_true((SELECT attnotnull AND format_type(atttypid, atttypmod) = 'smallint' AND pg_get_expr(d.adbin, d.adrelid) = '1'
    FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.record_briefs'::regclass AND a.attname = 'brief_format'),
  'record_briefs.brief_format is smallint not null default 1');
SELECT pg_temp.assert_true(to_regprocedure('public.record_brief_claim(text, text, text, text, text, uuid, integer, integer, integer)') IS NULL,
  'the 9-argument claim is gone (no ambiguity with the defaulted p_format)');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM pg_proc p
    WHERE p.oid IN ('public.record_brief_claim(text, text, text, text, text, uuid, integer, integer, integer, integer)'::regprocedure,
                    'public.record_brief_finish(text, text, text, uuid, jsonb)'::regprocedure)
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""', 'TimeZone=UTC'] AND cardinality(p.proconfig) = 2),
  'both functions are SECURITY DEFINER with search_path '''' and TimeZone UTC');

DO $$
DECLARE actor text; fn text; col text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.record_brief_claim(text, text, text, text, text, uuid, integer, integer, integer, integer)',
                            'public.record_brief_finish(text, text, text, uuid, jsonb)'] LOOP
    FOREACH actor IN ARRAY ARRAY['anon', 'authenticated', 'public'] LOOP
      PERFORM pg_temp.assert_true(NOT has_function_privilege(actor, fn, 'EXECUTE'), actor || ' cannot execute ' || fn);
    END LOOP;
    PERFORM pg_temp.assert_true(has_function_privilege('service_role', fn, 'EXECUTE'), 'service_role can execute ' || fn);
  END LOOP;
  FOREACH col IN ARRAY ARRAY['tier', 'feature', 'row_key', 'status', 'headline', 'points', 'model', 'written_at', 'brief_format'] LOOP
    PERFORM pg_temp.assert_true(has_column_privilege('authenticated', 'public.record_briefs', col, 'SELECT'), 'authenticated may read ' || col);
    PERFORM pg_temp.assert_true(NOT has_column_privilege('anon', 'public.record_briefs', col, 'SELECT'), 'anon may not read ' || col);
  END LOOP;
  FOREACH col IN ARRAY ARRAY['hash_key', 'source', 'content_hash', 'prompt_tokens', 'completion_tokens', 'reasoning_tokens', 'cost_usd',
                             'model_call_log_id', 'claim_token', 'claimed_at', 'attempts', 'retry_after'] LOOP
    PERFORM pg_temp.assert_true(NOT has_column_privilege('authenticated', 'public.record_briefs', col, 'SELECT'), 'authenticated may not read ' || col);
  END LOOP;
  FOREACH actor IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, 'public.record_briefs', 'UPDATE')
      AND NOT has_table_privilege(actor, 'public.record_briefs', 'INSERT'), actor || ' still cannot write record_briefs');
  END LOOP;
END;
$$;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-0000000000c1', 'format.one@example.invalid'),
  ('00000000-0000-4000-8000-0000000000c2', 'format.two@example.invalid');
UPDATE public.app_flags SET value = 'true'::jsonb WHERE key = 'record_briefs';

-- 2. A format-1 brief written an hour ago is regenerated once on its next open -----------------
SELECT pg_temp.old_brief('r-old', :h1, interval '1 hour');
SELECT pg_temp.assert_true((SELECT brief_format = 1 FROM pg_temp.row_of('r-old')), 'a brief stored before the migration is format 1');
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('o1', pg_temp.claim('r-old', :h1));
INSERT INTO res VALUES ('o2', pg_temp.claim('r-old', :h1, '00000000-0000-4000-8000-0000000000c2'));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('o1') ->> 'state' = 'claimed'
    AND pg_temp.r('o1') -> 'previous' ->> 'headline' = 'Old headline' AND pg_temp.r('o1') -> 'previous' ->> 'format' = '1'
    AND pg_temp.r('o1') -> 'previous' -> 'points' = '["Old one.", "Old two.", "Old three."]'::jsonb,
  'the same hash, within 24 hours, is claimed for an old-format brief; previous carries it, labelled format 1');
SELECT pg_temp.assert_true(pg_temp.r('o2') ->> 'state' = 'ready' AND pg_temp.r('o2') ->> 'headline' = 'Old headline'
    AND pg_temp.r('o2') ->> 'format' = '1', 'while it regenerates, others read the old brief, labelled format 1');
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempts = 1 AND brief_format = 1 AND headline = 'Old headline'
    FROM pg_temp.row_of('r-old')), 'the pending regeneration keeps the old brief on the row');

SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('o.fin', to_jsonb(public.record_brief_finish('global', 'Open Fronts', 'r-old',
  (pg_temp.r('o1') ->> 'token')::uuid, pg_temp.brief2('The war is tracked as a critical front.'))));
INSERT INTO res VALUES ('o3', pg_temp.claim('r-old', :h1));
INSERT INTO res VALUES ('o4', pg_temp.claim('r-old', :h1, '00000000-0000-4000-8000-0000000000c2'));
INSERT INTO res VALUES ('o5', pg_temp.claim('r-old', :h2));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('o.fin') = 'true'::jsonb AND (SELECT status = 'ready' AND brief_format = 2
    AND headline = 'The war is tracked as a critical front.' AND jsonb_typeof(points) = 'object'
    AND points ->> 'why' = 'It is rated critical.' AND points -> 'tags' = '["Eastern Europe", "Critical"]'::jsonb
    AND attempts = 0 AND cost_usd = 0.0003 FROM pg_temp.row_of('r-old')), 'the finish stores the format-2 brief');
SELECT pg_temp.assert_true(pg_temp.r('o3') ->> 'state' = 'ready' AND pg_temp.r('o3') ->> 'format' = '2'
    AND pg_temp.r('o3') ->> 'headline' = 'The war is tracked as a critical front.'
    AND pg_temp.r('o3') -> 'points' ->> 'watch' = 'The record names no next step.' AND NOT pg_temp.r('o3') ? 'cost_usd',
  'the regenerated brief is served, labelled format 2, without its cost');
SELECT pg_temp.assert_true(pg_temp.r('o4') ->> 'state' = 'ready' AND pg_temp.r('o5') ->> 'state' = 'ready'
    AND pg_temp.r('o5') ->> 'format' = '2' AND (SELECT content_hash = :h1 AND status = 'ready' FROM pg_temp.row_of('r-old')),
  'once regenerated it is not claimed again: not for the same hash, nor for a changed one within 24 hours');

-- 3. The desk-brief deployed before (9 arguments, format 1) regenerates nothing ----------------
SELECT pg_temp.old_brief('r-window', :h1, interval '1 hour');
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('w1', pg_temp.claim_old('r-window', :h1));
INSERT INTO res VALUES ('w2', pg_temp.claim_old('r-old', :h1));
INSERT INTO res VALUES ('w3', pg_temp.claim_old('r-new-old', :h1));
INSERT INTO res VALUES ('w.fin', to_jsonb(public.record_brief_finish('global', 'Open Fronts', 'r-new-old', (pg_temp.r('w3') ->> 'token')::uuid,
  '{"headline": "Old-shape headline", "points": ["One.", "Two.", "Three."], "model": "m", "prompt_tokens": 1}'::jsonb)));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('w1') ->> 'state' = 'ready' AND pg_temp.r('w1') ->> 'format' = '1',
  'a 9-argument claim (p_format 1) serves a format-1 brief and does not regenerate it');
SELECT pg_temp.assert_true(pg_temp.r('w2') ->> 'state' = 'ready' AND pg_temp.r('w2') ->> 'format' = '2',
  'a 9-argument claim never downgrades a format-2 brief');
SELECT pg_temp.assert_true(pg_temp.r('w3') ->> 'state' = 'claimed' AND pg_temp.r('w.fin') = 'true'::jsonb
    AND (SELECT brief_format = 1 AND jsonb_typeof(points) = 'array' FROM pg_temp.row_of('r-new-old')),
  'the old desk-brief still claims and finishes a new record in the old shape (format absent is 1)');

-- 4. A failed regeneration serves the old brief, backs off, and stops after five ----------------
SELECT pg_temp.old_brief('r-fail', :h1, interval '1 hour');
CREATE TEMP TABLE rounds (attempt integer, served text);
GRANT ALL ON rounds TO service_role;
DO $$
DECLARE c jsonb;
BEGIN
  FOR i IN 1..5 LOOP
    SET LOCAL ROLE service_role;
    c := pg_temp.claim('r-fail', 'aaaaaaaaaaaaaaaaaaaaaaaa');
    PERFORM public.record_brief_finish('global', 'Open Fronts', 'r-fail', (c ->> 'token')::uuid, NULL);
    INSERT INTO rounds SELECT (SELECT attempts FROM pg_temp.row_of('r-fail')),
                              pg_temp.claim('r-fail', 'aaaaaaaaaaaaaaaaaaaaaaaa') ->> 'headline';
    RESET ROLE;
    UPDATE public.record_briefs SET retry_after = now() - interval '1 second' WHERE row_key = 'r-fail';
  END LOOP;
END;
$$;
SELECT pg_temp.assert_true((SELECT array_agg(attempt ORDER BY attempt) FROM rounds) = ARRAY[1, 2, 3, 4, 5]
    AND (SELECT bool_and(served = 'Old headline') FROM rounds),
  'each failed regeneration counts an attempt and the old brief is served before the retry is due');
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('f.capped', pg_temp.claim('r-fail', :h1));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('f.capped') ->> 'state' = 'ready' AND pg_temp.r('f.capped') ->> 'format' = '1'
    AND (SELECT status = 'failed' AND attempts = 5 AND brief_format = 1 FROM pg_temp.row_of('r-fail')),
  'after five failures for one hash the old brief stays, served, and is not claimed again');

-- 5. Off or over a limit: the old brief is served, nothing is claimed ---------------------------
SELECT pg_temp.old_brief('r-off', :h1, interval '1 hour');
UPDATE public.app_flags SET value = 'false'::jsonb WHERE key = 'record_briefs';
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('off', pg_temp.claim('r-off', :h1));
RESET ROLE;
UPDATE public.app_flags SET value = 'true'::jsonb WHERE key = 'record_briefs';
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('lim', public.record_brief_claim('global', 'Open Fronts', 'r-off', :h1, 'desk_rows',
  '00000000-0000-4000-8000-0000000000c2', 100, 1000, (SELECT hits FROM public.record_brief_quota WHERE bucket = 'g'), 2));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('off') ->> 'headline' = 'Old headline' AND pg_temp.r('lim') ->> 'headline' = 'Old headline'
    AND pg_temp.r('lim') ->> 'format' = '1' AND (SELECT status = 'ready' AND brief_format = 1 FROM pg_temp.row_of('r-off')),
  'with the switch off, or over the global limit, the old brief is served and the row is untouched');

-- 6. The finish checks the new shape -----------------------------------------------------------
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('v1', pg_temp.claim('r-v', :h1));
RESET ROLE;
CREATE TEMP TABLE bad (label text, brief jsonb);
INSERT INTO bad VALUES
  ('a lead brief over 600 characters', pg_temp.brief2(repeat('x', 601))),
  ('an empty lead brief', pg_temp.brief2('')),
  ('an empty why', jsonb_set(pg_temp.brief2('B'), '{points,why}', '""')),
  ('a why over 600 characters', jsonb_set(pg_temp.brief2('B'), '{points,why}', to_jsonb(repeat('y', 601)))),
  ('a watch that is not a string', jsonb_set(pg_temp.brief2('B'), '{points,watch}', '3')),
  ('a watch over 600 characters', jsonb_set(pg_temp.brief2('B'), '{points,watch}', to_jsonb(repeat('z', 601)))),
  ('five tags', jsonb_set(pg_temp.brief2('B'), '{points,tags}', '["a", "b", "c", "d", "e"]')),
  ('a tag over 40 characters', jsonb_set(pg_temp.brief2('B'), '{points,tags}', to_jsonb(ARRAY[repeat('t', 41)]))),
  ('an empty tag', jsonb_set(pg_temp.brief2('B'), '{points,tags}', '[""]')),
  ('a tag that is not a string', jsonb_set(pg_temp.brief2('B'), '{points,tags}', '[1]')),
  ('tags that are not a list', jsonb_set(pg_temp.brief2('B'), '{points,tags}', '"a"')),
  ('a missing watch', pg_temp.brief2('B') #- '{points,watch}'),
  ('an extra key in points', jsonb_set(pg_temp.brief2('B'), '{points,extra}', '"x"')),
  ('format 2 with a list of points', jsonb_set(pg_temp.brief2('B'), '{points}', '["a"]')),
  ('format 1 with an object of points', jsonb_set(pg_temp.brief2('B'), '{format}', '1')),
  ('format 1 with a headline over 300 characters', jsonb_build_object('format', 1, 'headline', repeat('h', 301), 'points', '["a"]'::jsonb)),
  ('format 0', jsonb_set(pg_temp.brief2('B'), '{format}', '0')),
  ('a fractional format', jsonb_set(pg_temp.brief2('B'), '{format}', '2.5')),
  ('a format that is not a number', jsonb_set(pg_temp.brief2('B'), '{format}', '"2"'));
DO $$
DECLARE b record; tok uuid := (SELECT (v ->> 'token')::uuid FROM res WHERE k = 'v1');
BEGIN
  FOR b IN SELECT * FROM bad LOOP
    PERFORM pg_temp.rejected(format('SELECT public.record_brief_finish(%L, %L, %L, %L::uuid, %L::jsonb)',
      'global', 'Open Fronts', 'r-v', tok, b.brief), '22023', 'the finish refuses ' || b.label);
  END LOOP;
END;
$$;
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('v.ok', to_jsonb(public.record_brief_finish('global', 'Open Fronts', 'r-v', (pg_temp.r('v1') ->> 'token')::uuid,
  jsonb_set(jsonb_set(pg_temp.brief2(repeat('b', 600)), '{points,watch}', '""'), '{points,tags}', '[]'))));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('v.ok') = 'true'::jsonb
    AND (SELECT length(headline) = 600 AND points ->> 'watch' = '' AND points -> 'tags' = '[]'::jsonb AND brief_format = 2
         FROM pg_temp.row_of('r-v')), 'a 600-character lead brief, an empty watch and no tags are accepted');
SET LOCAL ROLE service_role;
SELECT pg_temp.rejected($q$SELECT public.record_brief_claim('global', 'Open Fronts', 'x', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'desk_rows', '00000000-0000-4000-8000-0000000000c1', 10, 200, 5000, 0)$q$,
  '22023', 'a format below 1 is refused');
SELECT pg_temp.rejected($q$SELECT public.record_brief_claim('global', 'Open Fronts', 'x', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'desk_rows', '00000000-0000-4000-8000-0000000000c1', 10, 200, 5000, NULL)$q$,
  '22023', 'a null format is refused');
RESET ROLE;

-- 7. The table refuses a brief whose shape does not match its format -----------------------------
SELECT pg_temp.rejected($q$INSERT INTO public.record_briefs (tier, feature, row_key, hash_key, source, content_hash, status, headline, points, written_at, brief_format)
  VALUES ('global', 'Open Fronts', 'r-x1', '', 'desk_rows', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'ready', 'H', '["a"]', now(), 2)$q$,
  '23514', 'a format-2 row cannot hold a list of points');
SELECT pg_temp.rejected($q$INSERT INTO public.record_briefs (tier, feature, row_key, hash_key, source, content_hash, status, headline, points, written_at)
  VALUES ('global', 'Open Fronts', 'r-x2', '', 'desk_rows', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'ready', 'H', '{"why": "w"}', now())$q$,
  '23514', 'a format-1 row cannot hold an object of points');
SELECT pg_temp.rejected($q$INSERT INTO public.record_briefs (tier, feature, row_key, hash_key, source, content_hash, status, headline, points, written_at)
  VALUES ('global', 'Open Fronts', 'r-x3', '', 'desk_rows', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'ready', repeat('h', 301), '["a"]', now())$q$,
  '23514', 'a format-1 headline is still at most 300 characters');
SELECT pg_temp.rejected($q$INSERT INTO public.record_briefs (tier, feature, row_key, hash_key, source, content_hash, status, headline, points, written_at, brief_format)
  VALUES ('global', 'Open Fronts', 'r-x4', '', 'desk_rows', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'ready', repeat('h', 601), '{}', now(), 2)$q$,
  '23514', 'a format-2 lead brief is at most 600 characters');

-- 8. What signed-in readers can see ------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT brief_format = 2 AND points ->> 'why' = 'It is rated critical.'
    FROM public.record_briefs WHERE tier = 'global' AND feature = 'Open Fronts' AND row_key = 'r-old'),
  'authenticated reads the format and the new parts of a desk_rows brief');
SELECT pg_temp.rejected($q$SELECT cost_usd FROM public.record_briefs$q$, '42501', 'authenticated still cannot read cost_usd');
SELECT pg_temp.rejected($q$SELECT public.record_brief_claim('global', 'Open Fronts', 'z', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'desk_rows', '00000000-0000-4000-8000-0000000000c1', 10, 200, 5000, 2)$q$,
  '42501', 'authenticated cannot claim');
RESET ROLE;

ROLLBACK;
