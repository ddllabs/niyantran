-- Disposable PG assertions for F1: user_preferences.ai_chats is gone.
-- Run on the least-privilege fixture plus research-turn persistence,
-- 20260928100000_user_preferences.sql and 20260929130000_drop_ai_chats.sql;
-- never against a hosted project.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END; $$;

SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM pg_attribute WHERE attrelid = 'public.user_preferences'::regclass
  AND attname = 'ai_chats' AND NOT attisdropped), 'ai_chats column is dropped');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid = 'public.user_preferences'::regclass
  AND conname = 'user_preferences_ai_chats_size'), 'ai_chats size check is dropped');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM pg_constraint WHERE conrelid = 'public.user_preferences'::regclass
  AND conname IN ('user_preferences_watchlist_size', 'user_preferences_tours_size')), 'the other size checks remain');
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_preferences'::regclass), 'RLS is still enabled');

INSERT INTO auth.users(id,email) VALUES ('00000000-0000-4000-8000-000000000051','prefs.f1@example.invalid');

-- The upsert shape the preferences route issues still works for the owner.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000051';
INSERT INTO public.user_preferences(user_id, watchlist, tours)
VALUES ('00000000-0000-4000-8000-000000000051', '["f1"]', '{"home":true}')
ON CONFLICT (user_id) DO UPDATE SET watchlist = EXCLUDED.watchlist, tours = EXCLUDED.tours;
SELECT pg_temp.assert_true((SELECT watchlist = '["f1"]'::jsonb AND tours = '{"home":true}'::jsonb
  FROM public.user_preferences WHERE user_id = auth.uid()), 'owner upserts and reads watchlist and tours');
RESET ROLE;
ROLLBACK;
