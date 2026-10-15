-- Stored AI record briefs (migration 20261015220000; open-work F123). PostgreSQL assertions,
-- no pgTAP. Run only in a disposable database, through run.sh.
-- Bootstrap: the ai_credits chain (model_call_logs, the credits charging functions), the Storage
-- stub and app_flags, then 20261015220000_record_briefs.sql applied as a non-superuser
-- (nter_migrator, whose default privileges grant everything to anon and authenticated, so a
-- missing revoke shows). The vacuity check drops the last: record_briefs is then missing, so
-- the first assertion fails. run.sh also executes the migration's Down block.
--
-- One transaction, so now() is fixed: written_at, claimed_at and retry_after are moved by hand
-- (as the superuser) where a test needs time to have passed. Claims and finishes run as
-- service_role, as desk-brief runs them. Two claims in one session are sequential, so the race
-- is proven by its rule (the second claim sees the first claim's row and loses); the
-- concurrent case rests on INSERT ... ON CONFLICT DO UPDATE re-checking its WHERE against the
-- row the first transaction committed. Sections 6b-6d (F123 review, 2026-10-15) prove the
-- failure backoff and five-failure cap, that a client-sourced brief is served only to its own
-- content hash and never in place of a desk_rows brief, and that token counts are rounded.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL TimeZone = 'UTC';
-- The bootstrap's auth.users stub lacks created_at and email_confirmed_at, which the credits
-- functions read (Supabase's table has both); added inside this transaction, as ai_credits.sql does.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

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

-- Claims with roomy limits; u is one of the two users below.
CREATE FUNCTION pg_temp.claim(p_row text, p_hash text, u uuid DEFAULT '00000000-0000-4000-8000-0000000000b1',
                              p_source text DEFAULT 'desk_rows')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.record_brief_claim('global', 'Open Fronts', p_row, p_hash, p_source, u, 100, 1000, 10000) $$;
CREATE FUNCTION pg_temp.brief(p_headline text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('headline', p_headline, 'points', jsonb_build_array('One.', 'Two.', 'Three.'),
    'model', 'google/gemini-2.5-flash-lite', 'prompt_tokens', 400, 'completion_tokens', 90, 'reasoning_tokens', 0,
    'cost_usd', 0.000076, 'model_call_log_id', gen_random_uuid()) $$;
CREATE FUNCTION pg_temp.row_of(p_row text) RETURNS public.record_briefs LANGUAGE sql AS $$
  SELECT * FROM public.record_briefs WHERE tier = 'global' AND feature = 'Open Fronts' AND row_key = p_row $$;

-- Hashes are 24 hex characters, like the v7 entry fingerprint.
\set h1 '''aaaaaaaaaaaaaaaaaaaaaaaa'''
\set h2 '''bbbbbbbbbbbbbbbbbbbbbbbb'''
\set h3 '''cccccccccccccccccccccccc'''

-- 1. Objects, privileges and the kill switch ---------------------------------------------------
SELECT pg_temp.assert_true(to_regclass('public.record_briefs') IS NOT NULL
    AND to_regclass('public.record_brief_quota') IS NOT NULL, 'record_briefs and record_brief_quota exist');
SELECT pg_temp.assert_true((SELECT bool_and(relrowsecurity) FROM pg_class
    WHERE oid IN ('public.record_briefs'::regclass, 'public.record_brief_quota'::regclass)), 'RLS is enabled on both');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM pg_proc p
    WHERE p.oid IN ('public.record_brief_claim(text, text, text, text, text, uuid, integer, integer, integer)'::regprocedure,
                    'public.record_brief_finish(text, text, text, uuid, jsonb)'::regprocedure)
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""', 'TimeZone=UTC'] AND cardinality(p.proconfig) = 2),
  'both functions are SECURITY DEFINER with search_path '''' and TimeZone UTC');
SELECT pg_temp.assert_true((SELECT value = 'false'::jsonb FROM public.app_flags WHERE key = 'record_briefs'),
  'the kill switch app_flags.record_briefs is seeded off');

DO $$
DECLARE actor text; priv text; fn text; col text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['anon', 'authenticated', 'public'] LOOP
    FOREACH priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, 'public.record_briefs', priv), actor || ' has no ' || priv || ' on record_briefs');
    END LOOP;
    FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, 'public.record_brief_quota', priv), actor || ' has no ' || priv || ' on record_brief_quota');
    END LOOP;
    PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, 'public.record_briefs', 'SELECT'), actor || ' has no table-wide SELECT on record_briefs');
    FOREACH fn IN ARRAY ARRAY['public.record_brief_claim(text, text, text, text, text, uuid, integer, integer, integer)',
                              'public.record_brief_finish(text, text, text, uuid, jsonb)'] LOOP
      PERFORM pg_temp.assert_true(NOT has_function_privilege(actor, fn, 'EXECUTE'), actor || ' cannot execute ' || fn);
    END LOOP;
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['public.record_brief_claim(text, text, text, text, text, uuid, integer, integer, integer)',
                            'public.record_brief_finish(text, text, text, uuid, jsonb)'] LOOP
    PERFORM pg_temp.assert_true(has_function_privilege('service_role', fn, 'EXECUTE'), 'service_role can execute ' || fn);
  END LOOP;
  FOREACH col IN ARRAY ARRAY['tier', 'feature', 'row_key', 'status', 'headline', 'points', 'model', 'written_at'] LOOP
    PERFORM pg_temp.assert_true(has_column_privilege('authenticated', 'public.record_briefs', col, 'SELECT'), 'authenticated may read ' || col);
    PERFORM pg_temp.assert_true(NOT has_column_privilege('anon', 'public.record_briefs', col, 'SELECT'), 'anon may not read ' || col);
  END LOOP;
  FOREACH col IN ARRAY ARRAY['hash_key', 'source', 'content_hash', 'prompt_tokens', 'completion_tokens', 'reasoning_tokens', 'cost_usd',
                             'model_call_log_id', 'claim_token', 'claimed_at', 'attempts', 'retry_after'] LOOP
    PERFORM pg_temp.assert_true(NOT has_column_privilege('authenticated', 'public.record_briefs', col, 'SELECT'), 'authenticated may not read ' || col);
  END LOOP;
END;
$$;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-0000000000b1', 'brief.one@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b2', 'brief.two@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b3', 'brief.three@example.invalid');

-- 2. Off: nothing is claimed ------------------------------------------------------------------
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('off', pg_temp.claim('r-off', :h1));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('off') = '{"state": "unavailable", "reason": "off"}'::jsonb
    AND NOT EXISTS (SELECT FROM public.record_briefs), 'with the switch off a claim answers unavailable/off and writes nothing');
UPDATE public.app_flags SET value = 'true'::jsonb WHERE key = 'record_briefs';

-- 3. The claim race, finishing, and the same hash ------------------------------------------------
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('a1', pg_temp.claim('r-a', :h1));
INSERT INTO res VALUES ('a2', pg_temp.claim('r-a', :h1, '00000000-0000-4000-8000-0000000000b2'));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('a1') ->> 'state' = 'claimed' AND pg_temp.r('a1') ->> 'token' IS NOT NULL
    AND pg_temp.r('a1') -> 'previous' = 'null'::jsonb, 'the first claim wins with a token and no previous brief');
SELECT pg_temp.assert_true(pg_temp.r('a2') = '{"state": "pending"}'::jsonb, 'the second claim loses: pending, no token');
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempts = 1 AND claim_token = (pg_temp.r('a1') ->> 'token')::uuid
    AND content_hash = :h1 FROM pg_temp.row_of('r-a')), 'the row is pending under the winner''s token');

SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('a.wrong', to_jsonb(public.record_brief_finish('global', 'Open Fronts', 'r-a', gen_random_uuid(), pg_temp.brief('Forged'))));
INSERT INTO res VALUES ('a.fin', to_jsonb(public.record_brief_finish('global', 'Open Fronts', 'r-a',
  (pg_temp.r('a1') ->> 'token')::uuid, pg_temp.brief('Front A holds'))));
INSERT INTO res VALUES ('a.again', to_jsonb(public.record_brief_finish('global', 'Open Fronts', 'r-a',
  (pg_temp.r('a1') ->> 'token')::uuid, pg_temp.brief('Twice'))));
INSERT INTO res VALUES ('a3', pg_temp.claim('r-a', :h1));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('a.wrong') = 'false'::jsonb, 'a finish with another token changes nothing');
SELECT pg_temp.assert_true(pg_temp.r('a.fin') = 'true'::jsonb AND pg_temp.r('a.again') = 'false'::jsonb,
  'the winner finishes once; a second finish with the spent token is refused');
SELECT pg_temp.assert_true((SELECT status = 'ready' AND headline = 'Front A holds' AND jsonb_array_length(points) = 3
    AND written_at = now() AND attempts = 0 AND claim_token IS NULL AND cost_usd = 0.000076 AND prompt_tokens = 400
    FROM pg_temp.row_of('r-a')), 'the row is ready with the brief, its cost and tokens');
SELECT pg_temp.assert_true(pg_temp.r('a3') ->> 'state' = 'ready' AND pg_temp.r('a3') ->> 'headline' = 'Front A holds'
    AND pg_temp.r('a3') -> 'points' = '["One.", "Two.", "Three."]'::jsonb AND pg_temp.r('a3') ? 'written_at'
    AND NOT pg_temp.r('a3') ? 'cost_usd', 'the same hash reads the stored brief, without its cost, and claims nothing');

-- 4. A changed hash: not within 24 hours, then once after --------------------------------------
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('b1', pg_temp.claim('r-a', :h2));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('b1') ->> 'state' = 'ready' AND pg_temp.r('b1') ->> 'headline' = 'Front A holds'
    AND (SELECT status = 'ready' AND content_hash = :h1 FROM pg_temp.row_of('r-a')),
  'a changed hash within 24 hours of writing serves the stored brief and does not reclaim');
UPDATE public.record_briefs SET written_at = now() - interval '24 hours' WHERE row_key = 'r-a';
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('b.edge', pg_temp.claim('r-a', :h2));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('b.edge') ->> 'state' = 'ready', 'exactly 24 hours after writing is still within the window');
UPDATE public.record_briefs SET written_at = now() - interval '24 hours 1 second' WHERE row_key = 'r-a';
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('b2', pg_temp.claim('r-a', :h2));
INSERT INTO res VALUES ('b3', pg_temp.claim('r-a', :h3, '00000000-0000-4000-8000-0000000000b2'));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('b2') ->> 'state' = 'claimed' AND pg_temp.r('b2') -> 'previous' ->> 'headline' = 'Front A holds',
  'after 24 hours a changed hash claims, and the claim carries the previous brief');
SELECT pg_temp.assert_true(pg_temp.r('b3') ->> 'state' = 'ready' AND pg_temp.r('b3') ->> 'headline' = 'Front A holds',
  'while it regenerates, others read the previous brief');
SELECT pg_temp.assert_true((SELECT status = 'pending' AND content_hash = :h2 AND attempts = 1 AND headline = 'Front A holds'
    FROM pg_temp.row_of('r-a')), 'the pending regeneration keeps the previous brief on the row');

-- 5. A stale pending claim is taken over; the old token can no longer finish --------------------
UPDATE public.record_briefs SET claimed_at = now() - interval '90 seconds' WHERE row_key = 'r-a';
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('c.fresh', pg_temp.claim('r-a', :h2));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('c.fresh') ->> 'state' = 'ready', 'a pending claim 90 seconds old is not yet stale');
UPDATE public.record_briefs SET claimed_at = now() - interval '91 seconds' WHERE row_key = 'r-a';
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('c1', pg_temp.claim('r-a', :h2, '00000000-0000-4000-8000-0000000000b2'));
INSERT INTO res VALUES ('c.old', to_jsonb(public.record_brief_finish('global', 'Open Fronts', 'r-a',
  (pg_temp.r('b2') ->> 'token')::uuid, pg_temp.brief('Late'))));
INSERT INTO res VALUES ('c.new', to_jsonb(public.record_brief_finish('global', 'Open Fronts', 'r-a',
  (pg_temp.r('c1') ->> 'token')::uuid, pg_temp.brief('Front A shifts'))));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('c1') ->> 'state' = 'claimed' AND pg_temp.r('c1') ->> 'token' <> pg_temp.r('b2') ->> 'token',
  'a pending claim older than 90 seconds is reclaimed with a new token');
SELECT pg_temp.assert_true(pg_temp.r('c.old') = 'false'::jsonb AND pg_temp.r('c.new') = 'true'::jsonb
    AND (SELECT headline = 'Front A shifts' AND attempts = 0 FROM pg_temp.row_of('r-a')),
  'the overtaken claim cannot finish; the new one does');

-- 6. Failure: retry after 10 minutes, keeping the previous brief --------------------------------
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('d1', pg_temp.claim('r-d', :h1));
INSERT INTO res VALUES ('d.fail', to_jsonb(public.record_brief_finish('global', 'Open Fronts', 'r-d', (pg_temp.r('d1') ->> 'token')::uuid, NULL)));
INSERT INTO res VALUES ('d2', pg_temp.claim('r-d', :h1));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('d.fail') = 'true'::jsonb AND (SELECT status = 'failed' AND retry_after = now() + interval '10 minutes'
    AND claim_token IS NULL AND headline IS NULL FROM pg_temp.row_of('r-d')), 'a failed attempt is failed, retry in 10 minutes');
SELECT pg_temp.assert_true(pg_temp.r('d2') = '{"state": "failed"}'::jsonb, 'before retry_after a failed row without a brief answers failed');
UPDATE public.record_briefs SET retry_after = now() - interval '1 second' WHERE row_key = 'r-d';
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('d3', pg_temp.claim('r-d', :h1));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('d3') ->> 'state' = 'claimed' AND (SELECT attempts = 2 FROM pg_temp.row_of('r-d')),
  'after retry_after the row is claimed again, attempts 2');
-- A failed regeneration keeps the brief it was replacing, and serves it.
UPDATE public.record_briefs SET written_at = now() - interval '2 days' WHERE row_key = 'r-a';
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('e1', pg_temp.claim('r-a', :h3));
INSERT INTO res VALUES ('e.fail', to_jsonb(public.record_brief_finish('global', 'Open Fronts', 'r-a', (pg_temp.r('e1') ->> 'token')::uuid, NULL)));
INSERT INTO res VALUES ('e2', pg_temp.claim('r-a', :h3));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('e1') ->> 'state' = 'claimed' AND pg_temp.r('e2') ->> 'state' = 'ready'
    AND pg_temp.r('e2') ->> 'headline' = 'Front A shifts', 'a failed regeneration still serves the previous brief');

-- 6b. Repeated failure backs off, and stops after five failures for one hash ------------------
-- Each round claims as service_role, fails, records the wait, then (as the superuser) moves
-- retry_after into the past so the next claim is due.
CREATE TEMP TABLE backoff (attempt integer, wait interval);
DO $$
DECLARE c jsonb;
BEGIN
  FOR i IN 1..5 LOOP
    SET LOCAL ROLE service_role;
    c := pg_temp.claim('r-f', 'aaaaaaaaaaaaaaaaaaaaaaaa');
    PERFORM public.record_brief_finish('global', 'Open Fronts', 'r-f', (c ->> 'token')::uuid, NULL);
    RESET ROLE;
    INSERT INTO backoff SELECT attempts, retry_after - now() FROM pg_temp.row_of('r-f');
    UPDATE public.record_briefs SET retry_after = now() - interval '1 second' WHERE row_key = 'r-f';
  END LOOP;
END;
$$;
SELECT pg_temp.assert_true((SELECT array_agg(attempt ORDER BY attempt) FROM backoff) = ARRAY[1, 2, 3, 4, 5]
    AND (SELECT array_agg(wait ORDER BY attempt) FROM backoff)
      = ARRAY[interval '10 minutes', interval '20 minutes', interval '40 minutes', interval '80 minutes', interval '160 minutes'],
  'each failure for one hash doubles the wait: 10, 20, 40, 80, 160 minutes');
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('f.capped', pg_temp.claim('r-f', :h1));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('f.capped') = '{"state": "failed"}'::jsonb
    AND (SELECT status = 'failed' AND attempts = 5 AND content_hash = :h1 FROM pg_temp.row_of('r-f')),
  'after five failures for one hash the row is not claimed for it again, though retry_after has passed');
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('f.new', pg_temp.claim('r-f', :h2));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('f.new') ->> 'state' = 'claimed'
    AND (SELECT status = 'pending' AND attempts = 1 AND content_hash = :h2 FROM pg_temp.row_of('r-f')),
  'changed content is claimed again, its attempts starting at 1');
-- A generation that vanished (no finish) at the cap is not taken over for that hash either.
UPDATE public.record_briefs SET attempts = 5, claimed_at = now() - interval '91 seconds' WHERE row_key = 'r-f';
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('f.vanished', pg_temp.claim('r-f', :h2));
INSERT INTO res VALUES ('f.vanished.new', pg_temp.claim('r-f', :h3));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('f.vanished') = '{"state": "failed"}'::jsonb,
  'a stale pending claim at the cap answers failed and is not reclaimed for the same hash');
SELECT pg_temp.assert_true(pg_temp.r('f.vanished.new') ->> 'state' = 'claimed'
    AND (SELECT attempts = 1 AND content_hash = :h3 FROM pg_temp.row_of('r-f')),
  'a stale pending claim at the cap is reclaimed for changed content');
-- The wait never exceeds 24 hours (10 minutes x 2^9 would be 85 hours).
UPDATE public.record_briefs SET attempts = 10 WHERE row_key = 'r-f';
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('f.cap24', to_jsonb(public.record_brief_finish('global', 'Open Fronts', 'r-f',
  (pg_temp.r('f.vanished.new') ->> 'token')::uuid, NULL)));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('f.cap24') = 'true'::jsonb
    AND (SELECT retry_after = now() + interval '24 hours' FROM pg_temp.row_of('r-f')), 'the wait is capped at 24 hours');

-- 6c. A client brief is addressed by its content -------------------------------------------------
-- desk-brief sends source 'client' when desk_rows does not hold the record, so the row it briefs
-- came from the browser. A forged row must never be served to a caller whose row hashes
-- differently, nor in place of the key's desk_rows brief.
CREATE FUNCTION pg_temp.row_at(p_row text, p_hash_key text) RETURNS public.record_briefs LANGUAGE sql AS $$
  SELECT * FROM public.record_briefs WHERE tier = 'global' AND feature = 'Open Fronts' AND row_key = p_row AND hash_key = p_hash_key $$;
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('k.forge', pg_temp.claim('r-c', :h1, '00000000-0000-4000-8000-0000000000b2', 'client'));
INSERT INTO res VALUES ('k.forge.fin', to_jsonb(public.record_brief_finish('global', 'Open Fronts', 'r-c',
  (pg_temp.r('k.forge') ->> 'token')::uuid, pg_temp.brief('Forged'))));
INSERT INTO res VALUES ('k.honest', pg_temp.claim('r-c', :h2, '00000000-0000-4000-8000-0000000000b1', 'client'));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('k.forge') ->> 'state' = 'claimed' AND pg_temp.r('k.forge.fin') = 'true'::jsonb,
  'a client row is briefed and stored');
SELECT pg_temp.assert_true(pg_temp.r('k.honest') ->> 'state' = 'claimed' AND pg_temp.r('k.honest') -> 'previous' = 'null'::jsonb,
  'another hash for the same key, minutes later, is not served the stored client brief: it gets its own claim, with no previous brief');
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('k.honest.fin', to_jsonb(public.record_brief_finish('global', 'Open Fronts', 'r-c',
  (pg_temp.r('k.honest') ->> 'token')::uuid, pg_temp.brief('Honest'))));
INSERT INTO res VALUES ('k.honest.read', pg_temp.claim('r-c', :h2, '00000000-0000-4000-8000-0000000000b3', 'client'));
INSERT INTO res VALUES ('k.forge.read', pg_temp.claim('r-c', :h1, '00000000-0000-4000-8000-0000000000b2', 'client'));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('k.honest.read') ->> 'headline' = 'Honest' AND pg_temp.r('k.forge.read') ->> 'headline' = 'Forged',
  'each client brief is read by its own hash only');
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('k.desk', pg_temp.claim('r-c', :h2));
INSERT INTO res VALUES ('k.desk.fin', to_jsonb(public.record_brief_finish('global', 'Open Fronts', 'r-c',
  (pg_temp.r('k.desk') ->> 'token')::uuid, pg_temp.brief('From the register'))));
INSERT INTO res VALUES ('k.desk.other', pg_temp.claim('r-c', :h1));
INSERT INTO res VALUES ('k.forge.again', pg_temp.claim('r-c', :h1, '00000000-0000-4000-8000-0000000000b2', 'client'));
INSERT INTO res VALUES ('k.new', pg_temp.claim('r-c', :h3, '00000000-0000-4000-8000-0000000000b2', 'client'));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('k.desk') ->> 'state' = 'claimed' AND pg_temp.r('k.desk') -> 'previous' = 'null'::jsonb,
  'once desk_rows holds the record, its brief is claimed afresh: no client brief is its previous one');
SELECT pg_temp.assert_true(pg_temp.r('k.desk.other') ->> 'headline' = 'From the register',
  'a desk_rows request with the forged hash reads the desk_rows brief (24-hour rule), never the forged one');
SELECT pg_temp.assert_true(pg_temp.r('k.forge.again') ->> 'headline' = 'Forged' AND pg_temp.r('k.new') ->> 'state' = 'claimed'
    AND (SELECT headline = 'From the register' AND source = 'desk_rows' FROM pg_temp.row_at('r-c', ''))
    AND (SELECT headline = 'Forged' AND source = 'client' FROM pg_temp.row_at('r-c', :h1))
    AND (SELECT headline = 'Honest' AND source = 'client' FROM pg_temp.row_at('r-c', :h2)),
  'the desk_rows brief and each client brief live in their own rows; finishing one changes no other');
SELECT pg_temp.rejected($q$INSERT INTO public.record_briefs (tier, feature, row_key, hash_key, source, content_hash, status)
  VALUES ('global', 'Open Fronts', 'r-x', '', 'client', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'failed')$q$,
  '23514', 'a client brief cannot take the shared desk_rows slot');
SELECT pg_temp.rejected($q$INSERT INTO public.record_briefs (tier, feature, row_key, hash_key, source, content_hash, status)
  VALUES ('global', 'Open Fronts', 'r-x', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'desk_rows', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'failed')$q$,
  '23514', 'a desk_rows brief cannot be filed under a hash');

-- 6d. Token counts are stored as integers ------------------------------------------------------
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('t1', pg_temp.claim('r-t', :h1));
INSERT INTO res VALUES ('t.fin', to_jsonb(public.record_brief_finish('global', 'Open Fronts', 'r-t', (pg_temp.r('t1') ->> 'token')::uuid,
  pg_temp.brief('Tokens') || '{"prompt_tokens": 400.6, "completion_tokens": 89.4}'::jsonb)));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('t.fin') = 'true'::jsonb
    AND (SELECT prompt_tokens = 401 AND completion_tokens = 89 FROM pg_temp.row_of('r-t')),
  'fractional token counts are rounded, not refused');

-- 7. Bad input --------------------------------------------------------------------------------
SET LOCAL ROLE service_role;
SELECT pg_temp.rejected($q$SELECT public.record_brief_claim('judiciary', 'Open Fronts', 'x', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'desk_rows', '00000000-0000-4000-8000-0000000000b1', 10, 200, 5000)$q$,
  '22023', 'a tier that is not a desk tab id is refused');
SELECT pg_temp.rejected($q$SELECT public.record_brief_claim('global', 'Open Fronts', 'x', 'not-a-hash', 'desk_rows', '00000000-0000-4000-8000-0000000000b1', 10, 200, 5000)$q$,
  '22023', 'a hash that is not 24 hex characters is refused');
SELECT pg_temp.rejected($q$SELECT public.record_brief_claim('global', 'Open Fronts', 'x', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'desk_rows', NULL, 10, 200, 5000)$q$,
  '22023', 'a claim without a user is refused');
SELECT pg_temp.rejected($q$SELECT public.record_brief_claim('global', 'Open Fronts', 'x', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'browser', '00000000-0000-4000-8000-0000000000b1', 10, 200, 5000)$q$,
  '22023', 'a source other than desk_rows or client is refused');
SELECT pg_temp.rejected($q$SELECT public.record_brief_finish('global', 'Open Fronts', 'r-d', gen_random_uuid(), '{"headline": "x", "points": [1]}')$q$,
  '22023', 'points that are not strings are refused');
SELECT pg_temp.rejected($q$SELECT public.record_brief_finish('global', 'Open Fronts', 'r-d', gen_random_uuid(), '{"headline": "", "points": ["a"]}')$q$,
  '22023', 'an empty headline is refused');
RESET ROLE;

-- 8. Limits count generations only, and roll back the claim -----------------------------------
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('m1', public.record_brief_claim('national', 'Bills', 'm-1', :h1, 'desk_rows', '00000000-0000-4000-8000-0000000000b3', 2, 1000, 10000));
INSERT INTO res VALUES ('m1.read', public.record_brief_claim('national', 'Bills', 'm-1', :h1, 'desk_rows', '00000000-0000-4000-8000-0000000000b3', 2, 1000, 10000));
INSERT INTO res VALUES ('m2', public.record_brief_claim('national', 'Bills', 'm-2', :h1, 'desk_rows', '00000000-0000-4000-8000-0000000000b3', 2, 1000, 10000));
INSERT INTO res VALUES ('m3', public.record_brief_claim('national', 'Bills', 'm-3', :h1, 'desk_rows', '00000000-0000-4000-8000-0000000000b3', 2, 1000, 10000));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('m1') ->> 'state' = 'claimed' AND pg_temp.r('m1.read') = '{"state": "pending"}'::jsonb
    AND pg_temp.r('m2') ->> 'state' = 'claimed', 'two generations fit a limit of two a minute; a read in between does not count');
SELECT pg_temp.assert_true(pg_temp.r('m3') = '{"state": "unavailable", "reason": "limited"}'::jsonb
    AND NOT EXISTS (SELECT FROM public.record_briefs WHERE row_key = 'm-3'),
  'the third is limited and its claim is rolled back');
SELECT pg_temp.assert_true((SELECT hits = 2 FROM public.record_brief_quota WHERE bucket = 'm:00000000-0000-4000-8000-0000000000b3'),
  'the refused claim is not counted');
SELECT pg_temp.assert_true((SELECT hits FROM public.record_brief_quota WHERE bucket = 'd:00000000-0000-4000-8000-0000000000b3'
    AND window_start = date_trunc('day', now())) = 2, 'the user''s day counter is kept per UTC day');
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('day', public.record_brief_claim('national', 'Bills', 'm-4', :h1, 'desk_rows', '00000000-0000-4000-8000-0000000000b3', 100, 2, 10000));
INSERT INTO res VALUES ('glob', public.record_brief_claim('national', 'Bills', 'm-5', :h1, 'desk_rows', '00000000-0000-4000-8000-0000000000b1',
  100, 1000, (SELECT hits FROM public.record_brief_quota WHERE bucket = 'g')));
INSERT INTO res VALUES ('glob.ok', public.record_brief_claim('national', 'Bills', 'm-5', :h1, 'desk_rows', '00000000-0000-4000-8000-0000000000b1',
  100, 1000, (SELECT hits + 1 FROM public.record_brief_quota WHERE bucket = 'g')));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('day') ->> 'reason' = 'limited', 'the per-user daily limit refuses');
SELECT pg_temp.assert_true(pg_temp.r('glob') ->> 'reason' = 'limited' AND pg_temp.r('glob.ok') ->> 'state' = 'claimed',
  'the global daily limit refuses another user, and admits one more when raised');
-- A limited regeneration still serves the previous brief.
UPDATE public.record_briefs SET status = 'ready', written_at = now() - interval '2 days', retry_after = NULL WHERE row_key = 'r-a';
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('lim.prev', public.record_brief_claim('global', 'Open Fronts', 'r-a', :h1, 'desk_rows', '00000000-0000-4000-8000-0000000000b3', 2, 1000, 10000));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('lim.prev') ->> 'state' = 'ready' AND pg_temp.r('lim.prev') ->> 'headline' = 'Front A shifts',
  'over a limit, a row with a brief serves it');
-- Old windows go with the first claim of a day.
INSERT INTO public.record_brief_quota VALUES ('g', date_trunc('day', now()) - interval '3 days', 7);
DELETE FROM public.record_brief_quota WHERE bucket = 'g' AND window_start = date_trunc('day', now());
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('purge', public.record_brief_claim('national', 'Bills', 'm-6', :h1, 'desk_rows', '00000000-0000-4000-8000-0000000000b1', 100, 1000, 10000));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('purge') ->> 'state' = 'claimed'
    AND NOT EXISTS (SELECT FROM public.record_brief_quota WHERE window_start < now() - interval '2 days'),
  'the first claim of a day deletes windows older than two days');

-- 9. What signed-in readers and anonymous callers can see ---------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT headline = 'Front A shifts' AND model = 'google/gemini-2.5-flash-lite' AND written_at IS NOT NULL
    FROM public.record_briefs WHERE tier = 'global' AND feature = 'Open Fronts' AND row_key = 'r-a'),
  'authenticated reads the headline, model and written date');
SELECT pg_temp.assert_true((SELECT array_agg(headline) FROM public.record_briefs WHERE row_key = 'r-c') = ARRAY['From the register'],
  'authenticated reads the desk_rows brief of a key, never a client brief');
SELECT pg_temp.rejected($q$SELECT cost_usd FROM public.record_briefs$q$, '42501', 'authenticated cannot read cost_usd');
SELECT pg_temp.rejected($q$SELECT prompt_tokens, completion_tokens FROM public.record_briefs$q$, '42501', 'authenticated cannot read tokens');
SELECT pg_temp.rejected($q$SELECT * FROM public.record_briefs$q$, '42501', 'authenticated cannot select every column');
SELECT pg_temp.rejected($q$UPDATE public.record_briefs SET headline = 'x'$q$, '42501', 'authenticated cannot write a brief');
SELECT pg_temp.rejected($q$SELECT public.record_brief_claim('global', 'Open Fronts', 'z', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'desk_rows', '00000000-0000-4000-8000-0000000000b1', 10, 200, 5000)$q$,
  '42501', 'authenticated cannot claim');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.rejected($q$SELECT headline FROM public.record_briefs$q$, '42501', 'anon reads nothing');
SELECT pg_temp.rejected($q$SELECT hits FROM public.record_brief_quota$q$, '42501', 'anon cannot read the counters');
RESET ROLE;

-- 10. A record brief is never charged to the user --------------------------------------------
-- The worst case: a record_brief log row attached to a charged answer's message. Only the
-- chat_answer row is charged.
CREATE FUNCTION pg_temp.turn(p_user uuid, p_key text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE conv uuid := gen_random_uuid(); um uuid; am uuid;
BEGIN
  INSERT INTO public.conversations (id, user_id, title) VALUES (conv, p_user, 'Conversation ' || p_key);
  INSERT INTO public.chat_messages (conversation_id, user_id, role, content, turn_key, created_at)
    VALUES (conv, p_user, 'user', 'A question.', p_key, clock_timestamp()) RETURNING id INTO um;
  INSERT INTO public.chat_messages (conversation_id, user_id, role, content, status, created_at)
    VALUES (conv, p_user, 'assistant', 'An answer.', 'complete', clock_timestamp()) RETURNING id INTO am;
  INSERT INTO public.research_turns (user_id, turn_key, request_hash, conversation_id, user_message_id, assistant_message_id, execution_token)
    VALUES (p_user, p_key, encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), conv, um, am, gen_random_uuid());
  RETURN am;
END;
$$;
CREATE TEMP TABLE turnmsg AS SELECT pg_temp.turn('00000000-0000-4000-8000-0000000000b1', 'rb-turn') AS msg;
INSERT INTO public.model_call_logs (user_id, message_id, caller, purpose, status, cost_usd) VALUES
  ('00000000-0000-4000-8000-0000000000b1', (SELECT msg FROM turnmsg), 'research-chat', 'chat_answer', 'success', 0.01),
  ('00000000-0000-4000-8000-0000000000b1', (SELECT msg FROM turnmsg), 'desk-brief', 'record_brief', 'success', 0.5),
  ('00000000-0000-4000-8000-0000000000b1', NULL, 'desk-brief', 'record_brief', 'success', 0.5);
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('settle', public.settle_turn_credits('00000000-0000-4000-8000-0000000000b1', 'rb-turn'));
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.r('settle') ->> 'state' = 'charged'
    AND (pg_temp.r('settle') ->> 'credits')::numeric = round(0.01 * s.usd_to_inr / s.inr_per_credit, 4),
  'the turn is charged for its chat_answer row only')
FROM public.credit_settings s;
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.credit_charge_rows c JOIN public.model_call_logs l ON l.id = c.model_call_log_id
    WHERE l.purpose = 'record_brief'), 'no record_brief log row is ever a charged row');

ROLLBACK;
