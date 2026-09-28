-- Disposable PG assertions for S4/S5 (app flags and the marketing intro video).
-- Bootstrapped on the least-privilege chain plus bootstrap_storage.sql, then
-- 20260928100200_app_flags_and_marketing_media.sql. Never run against NTER.
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
CREATE FUNCTION pg_temp.affected(statement text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END; $$;

SELECT pg_temp.assert_true(to_regclass('public.app_flags') IS NOT NULL, 'app_flags exists');
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.app_flags'::regclass), 'app_flags has RLS enabled');

-- Privilege matrix. Supabase-style default privileges (bootstrap_auth.sql)
-- grant ALL on new tables, so every revocation below must be explicit.
DO $$
DECLARE actor text; privilege text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['anon','authenticated'] LOOP
    PERFORM pg_temp.assert_true(has_column_privilege(actor,'public.app_flags','key','SELECT')
      AND has_column_privilege(actor,'public.app_flags','value','SELECT')
      AND has_column_privilege(actor,'public.app_flags','updated_at','SELECT'), actor || ' may read key, value, updated_at');
    PERFORM pg_temp.assert_true(NOT has_column_privilege(actor,'public.app_flags','updated_by','SELECT'), actor || ' cannot read updated_by');
    FOREACH privilege IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      PERFORM pg_temp.assert_true(NOT has_table_privilege(actor,'public.app_flags',privilege), actor || ' cannot ' || privilege || ' app_flags');
    END LOOP;
    FOREACH privilege IN ARRAY ARRAY['INSERT','UPDATE','REFERENCES'] LOOP
      PERFORM pg_temp.assert_true(NOT has_any_column_privilege(actor,'public.app_flags',privilege), actor || ' holds no column ' || privilege);
    END LOOP;
  END LOOP;
  FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    PERFORM pg_temp.assert_true(has_table_privilege('service_role','public.app_flags',privilege), 'service_role may ' || privilege);
  END LOOP;
  FOREACH privilege IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
    PERFORM pg_temp.assert_true(NOT has_table_privilege('service_role','public.app_flags',privilege), 'service_role cannot ' || privilege);
  END LOOP;
  PERFORM pg_temp.assert_true(NOT EXISTS (
    SELECT FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid = 'public.app_flags'::regclass AND a.grantee = 0), 'PUBLIC holds nothing on app_flags');
  PERFORM pg_temp.assert_true(NOT EXISTS (
    SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_flags' AND cmd <> 'SELECT'), 'app_flags has no client write policy');
END; $$;

INSERT INTO auth.users(id,email) VALUES ('00000000-0000-4000-8000-000000000041','flags.admin@example.invalid');

-- The server writes with the secret key (service_role).
SET LOCAL ROLE service_role;
INSERT INTO public.app_flags(key, value, updated_by)
  VALUES ('testing_phase', 'true', '00000000-0000-4000-8000-000000000041');
INSERT INTO public.app_flags(key, value) VALUES ('marketing_intro_video', '{"title":"Intro","objectPath":"intro-video/intro-video.mp4"}');
INSERT INTO public.app_flags(key, value) VALUES ('scratch', '1');
SELECT pg_temp.assert_true(pg_temp.affected($q$INSERT INTO public.app_flags(key, value, updated_by)
  VALUES ('testing_phase', 'false', '00000000-0000-4000-8000-000000000041')
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = now()$q$) = 1, 'service_role upserts a flag');
SELECT pg_temp.assert_true(pg_temp.affected($q$DELETE FROM public.app_flags WHERE key = 'scratch'$q$) = 1, 'service_role deletes a flag');
SELECT pg_temp.assert_true((SELECT value = 'false'::jsonb AND updated_by IS NOT NULL FROM public.app_flags WHERE key = 'testing_phase'), 'service write records value and updated_by');

-- Bounds apply to every writer, including the server.
SELECT pg_temp.rejected($q$INSERT INTO public.app_flags(key, value) VALUES ('', '1')$q$, '23514', 'empty key rejected');
SELECT pg_temp.rejected($q$INSERT INTO public.app_flags(key, value) VALUES ('Testing-Phase', '1')$q$, '23514', 'uppercase and dash key rejected');
SELECT pg_temp.rejected($q$INSERT INTO public.app_flags(key, value) VALUES ('has space', '1')$q$, '23514', 'key with space rejected');
SELECT pg_temp.rejected($q$INSERT INTO public.app_flags(key, value) VALUES ('1flag', '1')$q$, '23514', 'key starting with a digit rejected');
SELECT pg_temp.rejected(format('INSERT INTO public.app_flags(key, value) VALUES (%L, ''1'')', repeat('k',65)), '23514', 'key over 64 characters rejected');
SELECT pg_temp.rejected(format('INSERT INTO public.app_flags(key, value) VALUES (''big'', to_jsonb(%L::text))', repeat('v',16400)), '23514', 'value over 16 KB rejected');
SELECT pg_temp.rejected($q$UPDATE public.app_flags SET value = to_jsonb(repeat('v',16400)) WHERE key = 'testing_phase'$q$, '23514', 'oversize update rejected');
SELECT pg_temp.rejected($q$INSERT INTO public.app_flags(key, value) VALUES ('nullish', NULL)$q$, '23502', 'null value rejected');
SELECT pg_temp.rejected($q$INSERT INTO public.app_flags(key, value, updated_by) VALUES ('orphan', '1', '00000000-0000-4000-8000-000000000099')$q$, '23503', 'updated_by must be a real user');
SELECT pg_temp.assert_true(pg_temp.affected(format('INSERT INTO public.app_flags(key, value) VALUES (%L, to_jsonb(%L::text))', repeat('k',64), repeat('v',16000))) = 1, 'a 64 character key and 16 000 byte value fit');
RESET ROLE;

-- Both public GET routes read through the server, but anon and authenticated
-- may read the public columns directly too; neither may write.
DO $$
DECLARE actor text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['anon','authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', actor);
    PERFORM set_config('request.jwt.claim.sub', CASE WHEN actor = 'authenticated' THEN '00000000-0000-4000-8000-000000000041' ELSE '' END, true);
    PERFORM pg_temp.assert_true((SELECT value = 'false'::jsonb FROM public.app_flags WHERE key = 'testing_phase'), actor || ' reads testing_phase');
    PERFORM pg_temp.assert_true((SELECT count(*) >= 2 FROM public.app_flags), actor || ' sees every flag row');
    PERFORM pg_temp.rejected('SELECT updated_by FROM public.app_flags', '42501', actor || ' cannot select updated_by');
    PERFORM pg_temp.rejected($q$INSERT INTO public.app_flags(key, value) VALUES ('forged', 'true')$q$, '42501', actor || ' cannot insert');
    PERFORM pg_temp.rejected($q$UPDATE public.app_flags SET value = 'true' WHERE key = 'testing_phase'$q$, '42501', actor || ' cannot update');
    PERFORM pg_temp.rejected($q$DELETE FROM public.app_flags WHERE key = 'testing_phase'$q$, '42501', actor || ' cannot delete');
    PERFORM pg_temp.rejected('TRUNCATE public.app_flags', '42501', actor || ' cannot truncate');
    RESET ROLE;
  END LOOP;
END; $$;
SELECT pg_temp.assert_true((SELECT value = 'false'::jsonb FROM public.app_flags WHERE key = 'testing_phase'), 'client attempts left the flag unchanged');

-- Deleting the admin keeps the flag and clears the attribution.
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000000041';
SELECT pg_temp.assert_true((SELECT updated_by IS NULL FROM public.app_flags WHERE key = 'testing_phase'), 'deleting the user sets updated_by null');

-- The marketing bucket: public read, video only, bounded size.
SELECT pg_temp.assert_true((SELECT public FROM storage.buckets WHERE id = 'marketing'), 'marketing bucket exists and is public');
SELECT pg_temp.assert_true((SELECT file_size_limit = 52428800 FROM storage.buckets WHERE id = 'marketing'), 'marketing bucket caps objects at 50 MB');
SELECT pg_temp.assert_true((SELECT ARRAY(SELECT unnest(allowed_mime_types) ORDER BY 1)
  = ARRAY['video/mp4','video/ogg','video/quicktime','video/webm'] FROM storage.buckets WHERE id = 'marketing'), 'marketing bucket allows only the four video types');
SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT FROM pg_policies WHERE schemaname = 'storage' AND tablename IN ('objects','buckets') AND cmd <> 'SELECT'), 'no client insert, update or delete policy on storage');
-- A public bucket serves its files by public URL without any policy, so a
-- client SELECT policy on storage.objects would only let anyone list it.
SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT'
    AND qual LIKE '%''marketing''%'), 'no client read policy lists the marketing bucket');

-- Objects arrive through signed upload URLs, which the Storage service writes
-- itself. Here the owner stands in for it.
INSERT INTO storage.buckets(id, name, public) VALUES ('private-probe', 'private-probe', false);
INSERT INTO storage.objects(bucket_id, name) VALUES
  ('marketing', 'intro-video/intro-video.mp4'),
  ('private-probe', 'secret.mp4');

DO $$
DECLARE actor text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['anon','authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', actor);
    PERFORM set_config('request.jwt.claim.sub', CASE WHEN actor = 'authenticated' THEN '00000000-0000-4000-8000-000000000042' ELSE '' END, true);
    PERFORM pg_temp.assert_true((SELECT count(*) = 0 FROM storage.objects WHERE bucket_id = 'marketing'), actor || ' cannot list marketing objects');
    PERFORM pg_temp.assert_true((SELECT count(*) = 0 FROM storage.objects WHERE bucket_id <> 'marketing'), actor || ' reads no other bucket');
    PERFORM pg_temp.rejected($q$INSERT INTO storage.objects(bucket_id, name) VALUES ('marketing', 'intro-video/intro-video.webm')$q$, '42501', actor || ' cannot insert into marketing');
    PERFORM pg_temp.rejected($q$INSERT INTO storage.objects(bucket_id, name) VALUES ('marketing', 'intro-video/intro-video.mp4') ON CONFLICT (bucket_id, name) DO UPDATE SET name = excluded.name$q$, '42501', actor || ' cannot upsert into marketing');
    PERFORM pg_temp.assert_true(pg_temp.affected($q$UPDATE storage.objects SET name = 'hijacked.mp4' WHERE bucket_id = 'marketing'$q$) = 0, actor || ' updates no marketing object');
    PERFORM pg_temp.assert_true(pg_temp.affected($q$DELETE FROM storage.objects WHERE bucket_id = 'marketing'$q$) = 0, actor || ' deletes no marketing object');
    PERFORM pg_temp.assert_true(pg_temp.affected($q$UPDATE storage.buckets SET public = false, file_size_limit = NULL WHERE id = 'marketing'$q$) = 0, actor || ' changes no bucket settings');
    RESET ROLE;
  END LOOP;
END; $$;
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM storage.objects WHERE bucket_id = 'marketing' AND name = 'intro-video/intro-video.mp4'), 'marketing object is unchanged after client attempts');
SELECT pg_temp.assert_true((SELECT public AND file_size_limit = 52428800 FROM storage.buckets WHERE id = 'marketing'), 'marketing bucket settings are unchanged after client attempts');
ROLLBACK;
