-- Disposable PG assertions for T1 (S1) user preferences. Run on the isolated
-- least-privilege fixture plus research-turn persistence and
-- 20260928100000_user_preferences.sql; never against a hosted project.
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

SELECT pg_temp.assert_true(to_regclass('public.user_preferences') IS NOT NULL, 'preference table exists');
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_preferences'::regclass), 'RLS is enabled');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_preferences' AND cmd IN ('DELETE', 'ALL')), 'no delete policy exists');

-- Privilege matrix: anon and service_role hold nothing; authenticated holds
-- exactly SELECT, INSERT and UPDATE.
DO $$
DECLARE actor text; privilege text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['anon','service_role','public'] LOOP
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      PERFORM pg_temp.assert_true(NOT has_table_privilege(actor,'public.user_preferences',privilege), actor || ' cannot ' || privilege || ' preferences');
    END LOOP;
  END LOOP;
  FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
    PERFORM pg_temp.assert_true(has_table_privilege('authenticated','public.user_preferences',privilege), 'authenticated can ' || privilege || ' preferences');
  END LOOP;
  FOREACH privilege IN ARRAY ARRAY['DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
    PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated','public.user_preferences',privilege), 'authenticated cannot ' || privilege || ' preferences');
  END LOOP;
  FOREACH actor IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    PERFORM pg_temp.assert_true(NOT has_function_privilege(actor,'public.touch_user_preferences()','EXECUTE'), actor || ' cannot call the timestamp trigger');
  END LOOP;
END; $$;

INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-8000-000000000041','prefs.a@example.invalid'),
 ('00000000-0000-4000-8000-000000000042','prefs.b@example.invalid');

-- Owner B's row, written as B.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000042';
INSERT INTO public.user_preferences(user_id, watchlist, ai_chats, tours)
VALUES ('00000000-0000-4000-8000-000000000042', '["b-secret"]', '{"chats":[{"id":"b-private"}]}', '{"home":true}');
RESET ROLE;

-- Owner A: insert, read, update and upsert their own row.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000041';
INSERT INTO public.user_preferences(user_id, watchlist, updated_at)
VALUES ('00000000-0000-4000-8000-000000000041', '["a-1"]', '2000-01-01T00:00:00Z');
SELECT pg_temp.assert_true((SELECT watchlist = '["a-1"]'::jsonb AND ai_chats IS NULL AND tours IS NULL
  FROM public.user_preferences WHERE user_id = auth.uid()), 'owner reads own inserted row');
SELECT pg_temp.assert_true((SELECT updated_at = now() FROM public.user_preferences WHERE user_id = auth.uid()),
  'server clock overrides a writer-supplied timestamp');
DO $$
DECLARE touched bigint;
BEGIN
  UPDATE public.user_preferences SET tours = '{"home":false}' WHERE user_id = auth.uid();
  GET DIAGNOSTICS touched = ROW_COUNT;
  PERFORM pg_temp.assert_true(touched = 1, 'owner updates own row');
END; $$;
-- The statement shape PostgREST issues for a partial upsert (merge-duplicates):
-- only supplied columns change, the rest are preserved.
INSERT INTO public.user_preferences(user_id, ai_chats)
VALUES ('00000000-0000-4000-8000-000000000041', '{"chats":[],"activeId":""}')
ON CONFLICT (user_id) DO UPDATE SET ai_chats = EXCLUDED.ai_chats
RETURNING updated_at;
SELECT pg_temp.assert_true((SELECT watchlist = '["a-1"]'::jsonb AND tours = '{"home":false}'::jsonb
  AND ai_chats = '{"chats":[],"activeId":""}'::jsonb FROM public.user_preferences WHERE user_id = auth.uid()),
  'partial upsert merges without erasing omitted fields');

-- A cannot see, change, create or take over B's row.
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.user_preferences), 'owner sees exactly one row');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.user_preferences
  WHERE user_id = '00000000-0000-4000-8000-000000000042'), 'owner cannot read another user row');
DO $$
DECLARE touched bigint;
BEGIN
  UPDATE public.user_preferences SET watchlist = '["hijacked"]' WHERE user_id = '00000000-0000-4000-8000-000000000042';
  GET DIAGNOSTICS touched = ROW_COUNT;
  PERFORM pg_temp.assert_true(touched = 0, 'owner cannot update another user row');
  -- Without a WHERE on table columns only the UPDATE policy filters rows.
  UPDATE public.user_preferences SET tours = '{"home":false}';
  GET DIAGNOSTICS touched = ROW_COUNT;
  PERFORM pg_temp.assert_true(touched = 1, 'an unqualified update reaches only the owner row');
END; $$;
SELECT pg_temp.rejected($q$INSERT INTO public.user_preferences(user_id, watchlist) VALUES ('00000000-0000-4000-8000-000000000042','["forged"]')$q$,
  '42501', 'owner cannot insert a row for another user');
SELECT pg_temp.rejected($q$INSERT INTO public.user_preferences(user_id, watchlist) VALUES ('00000000-0000-4000-8000-000000000042','["forged"]') ON CONFLICT (user_id) DO UPDATE SET watchlist = EXCLUDED.watchlist$q$,
  '42501', 'owner cannot upsert over another user row');
SELECT pg_temp.rejected($q$UPDATE public.user_preferences SET user_id = '00000000-0000-4000-8000-000000000042' WHERE user_id = auth.uid()$q$,
  '42501', 'owner cannot hand their row to another user');

-- Nobody deletes through the API.
SELECT pg_temp.rejected($q$DELETE FROM public.user_preferences WHERE user_id = auth.uid()$q$, '42501', 'owner cannot delete own row');
SELECT pg_temp.rejected($q$TRUNCATE public.user_preferences$q$, '42501', 'owner cannot truncate');

-- Per-field size bounds (jsonb text of repeat('x', n) is n + 2 bytes).
SELECT pg_temp.rejected($q$UPDATE public.user_preferences SET watchlist = to_jsonb(repeat('x', 65535)) WHERE user_id = auth.uid()$q$,
  '23514', 'oversized watchlist rejected');
SELECT pg_temp.rejected($q$UPDATE public.user_preferences SET tours = to_jsonb(repeat('x', 65535)) WHERE user_id = auth.uid()$q$,
  '23514', 'oversized tours rejected');
SELECT pg_temp.rejected($q$UPDATE public.user_preferences SET ai_chats = to_jsonb(repeat('x', 2097151)) WHERE user_id = auth.uid()$q$,
  '23514', 'oversized ai_chats rejected');
SELECT pg_temp.rejected($q$INSERT INTO public.user_preferences(user_id, ai_chats) VALUES (auth.uid(), to_jsonb(repeat('x', 2097151))) ON CONFLICT (user_id) DO UPDATE SET ai_chats = EXCLUDED.ai_chats$q$,
  '23514', 'oversized ai_chats rejected through upsert');
DO $$
DECLARE touched bigint;
BEGIN
  UPDATE public.user_preferences SET watchlist = to_jsonb(repeat('x', 65534)), tours = to_jsonb(repeat('x', 65534)),
    ai_chats = to_jsonb(repeat('x', 2097150)) WHERE user_id = auth.uid();
  GET DIAGNOSTICS touched = ROW_COUNT;
  PERFORM pg_temp.assert_true(touched = 1, 'fields exactly at their limits are accepted');
END; $$;
RESET ROLE;

-- anon is denied every verb.
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.sub = '';
SELECT pg_temp.rejected($q$SELECT * FROM public.user_preferences$q$, '42501', 'anon cannot read');
SELECT pg_temp.rejected($q$INSERT INTO public.user_preferences(user_id) VALUES ('00000000-0000-4000-8000-000000000041')$q$, '42501', 'anon cannot insert');
SELECT pg_temp.rejected($q$UPDATE public.user_preferences SET watchlist = '[]'$q$, '42501', 'anon cannot update');
SELECT pg_temp.rejected($q$DELETE FROM public.user_preferences$q$, '42501', 'anon cannot delete');
RESET ROLE;

-- B's row is untouched by everything A and anon attempted.
SELECT pg_temp.assert_true((SELECT watchlist = '["b-secret"]'::jsonb AND ai_chats = '{"chats":[{"id":"b-private"}]}'::jsonb
  AND tours = '{"home":true}'::jsonb FROM public.user_preferences WHERE user_id = '00000000-0000-4000-8000-000000000042'),
  'another user row is unchanged');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.user_preferences), 'both rows survive');

-- Account deletion removes the row through the auth.users cascade.
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000000042';
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.user_preferences WHERE user_id = '00000000-0000-4000-8000-000000000042'),
  'deleting the account cascades to its preferences');
ROLLBACK;
