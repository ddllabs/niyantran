-- B1 integration assertions. Run with psql -v ON_ERROR_STOP=1 on a disposable
-- database after auth_schema.sql, the 0001 email SQL, and migration 0012.
-- Plain SQL assertions deliberately require no pgTAP installation.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', label;
  END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;

CREATE FUNCTION pg_temp.denied(statement text, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % (statement was accepted)', label;
END;
$$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-000000000001', 'person.one@example.invalid',
   '{"first_name":"One","role":"admin","plan":"enterprise","status":"active","phone_verified":true}'),
  ('00000000-0000-4000-8000-000000000002', 'person.two@example.invalid', '{}'),
  ('00000000-0000-4000-8000-000000000003', 'admin@example.invalid', '{}'),
  ('00000000-0000-4000-8000-000000000004', 'suspended@example.invalid', '{}'),
  ('00000000-0000-4000-8000-000000000005', 'missing.profile@example.invalid', '{}');

INSERT INTO public.organisations (id, name)
VALUES ('10000000-0000-4000-8000-000000000001', 'Preserved organisation');

SET LOCAL ROLE service_role;
UPDATE public.user_profiles SET role = 'admin'
WHERE user_id = '00000000-0000-4000-8000-000000000003';
UPDATE public.user_profiles SET status = 'suspended'
WHERE user_id = '00000000-0000-4000-8000-000000000004';
UPDATE public.user_profiles SET phone_e164 = '+12025550101',
  phone_verified = true, phone_verified_at = '2026-09-01T00:00:00Z'
WHERE user_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM public.user_profiles
WHERE user_id = '00000000-0000-4000-8000-000000000005';
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role = 'authenticated';

SELECT pg_temp.assert_true((SELECT role = 'user' AND plan = 'explorer'
  AND status = 'active' AND organisation_id IS NULL FROM public.get_my_profile()),
  'signup ignores untrusted entitlement metadata');

-- This first security assertion must fail against the original schema.
SELECT pg_temp.denied($q$UPDATE public.user_profiles SET role = 'admin'
  WHERE user_id = auth.uid()$q$, 'ordinary user cannot self-promote');

SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.user_profiles', 'role', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.user_profiles', 'plan', 'UPDATE')
  AND NOT has_column_privilege('anon', 'public.user_profiles', 'role', 'INSERT'),
  'broad table and inherited column grants removed');

DO $$
DECLARE assignment text;
BEGIN
  FOREACH assignment IN ARRAY ARRAY[
    'plan = ''enterprise''', 'status = ''inactive''',
    'organisation_id = ''10000000-0000-4000-8000-000000000001''',
    'id = ''20000000-0000-4000-8000-000000000001''',
    'user_id = ''00000000-0000-4000-8000-000000000005''',
    'email = ''forged@example.invalid''', 'email_normalised = ''forged@example.invalid''',
    'phone_verified = false', 'phone_verified_at = now()', 'created_at = now()'
  ] LOOP
    PERFORM pg_temp.denied('UPDATE public.user_profiles SET ' || assignment ||
      ' WHERE user_id = auth.uid()', 'protected column: ' || split_part(assignment, ' ', 1));
  END LOOP;
END;
$$;

SELECT pg_temp.denied($q$UPDATE public.user_profiles SET persona = 'journalist', role = 'admin'
  WHERE user_id = auth.uid()$q$, 'mixed personal and protected update rejected atomically');
SELECT pg_temp.assert_true((SELECT persona IS NULL FROM public.get_my_profile()),
  'mixed rejected update leaves personal fields unchanged');

SELECT pg_temp.denied($q$INSERT INTO public.user_profiles (user_id, email, role)
  VALUES (auth.uid(), 'person.one@example.invalid', 'admin')
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role$q$, 'conflicting upsert cannot promote');
SELECT pg_temp.denied($q$DELETE FROM public.user_profiles WHERE user_id = auth.uid()$q$,
  'client cannot delete profile to recreate it');

UPDATE public.user_profiles SET first_name = 'Updated', last_name = 'Person',
  department = 'Research', job_title = 'Analyst', persona = 'academic',
  practice_area = 'policy', jurisdiction = 'India', language = 'hi',
  onboarding_complete = true, updated_at = '2000-01-01T00:00:00Z'
WHERE user_id = auth.uid();
SELECT pg_temp.assert_true((SELECT first_name = 'Updated' AND persona = 'academic'
  AND language = 'hi' AND onboarding_complete AND updated_at = now()
  AND phone_verified FROM public.get_my_profile()), 'personal fields work; timestamp maintained; verification retained');

UPDATE public.user_profiles SET phone_e164 = '+12025550102' WHERE user_id = auth.uid();
SELECT pg_temp.assert_true((SELECT phone_e164 = '+12025550102'
  AND NOT phone_verified AND phone_verified_at IS NULL FROM public.get_my_profile()),
  'changing phone clears prior verification');

DO $$ BEGIN
  PERFORM public.update_my_onboarding_profile('journalist', 'law', 'Delhi', 'en', true);
END $$;
SELECT pg_temp.assert_true((SELECT persona = 'journalist' AND role = 'user'
  AND plan = 'explorer' FROM public.get_my_profile()), 'onboarding changes preferences only');
SELECT pg_temp.assert_true(NOT public.is_platform_admin(), 'persona does not confer admin authority');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.user_profiles), 'other ordinary profiles hidden');
UPDATE public.user_profiles SET first_name = 'Cross-user write'
WHERE user_id = '00000000-0000-4000-8000-000000000002';

SELECT pg_temp.denied($q$SELECT public.create_organisation('Forbidden')$q$, 'public organisation RPC disabled');
SELECT pg_temp.denied($q$INSERT INTO public.organisations (name) VALUES ('Forbidden fallback')$q$,
  'direct organisation fallback disabled');

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000005';
SELECT pg_temp.denied($q$INSERT INTO public.user_profiles (user_id, email, role, plan)
  VALUES (auth.uid(), 'missing.profile@example.invalid', 'admin', 'enterprise')$q$,
  'direct insert cannot recreate a missing profile');
SELECT pg_temp.denied($q$INSERT INTO public.user_profiles (user_id, email, role)
  VALUES (auth.uid(), 'missing.profile@example.invalid', 'admin')
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role$q$,
  'nonconflicting upsert cannot create privileged profile');

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
SELECT pg_temp.denied($q$UPDATE public.user_profiles SET status = 'active'
  WHERE user_id = auth.uid()$q$, 'suspended user cannot reactivate');

SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_true(public.is_platform_admin(), 'trusted internal admin is recognized');
SELECT pg_temp.denied($q$UPDATE public.user_profiles SET plan = 'enterprise'
  WHERE user_id = auth.uid()$q$, 'admin browser also cannot assign entitlements directly');
SELECT pg_temp.denied($q$SELECT public.create_organisation('Admin fallback')$q$,
  'admin browser cannot enable deferred organisation provisioning');
RESET ROLE;

SELECT pg_temp.assert_true((SELECT first_name IS NULL FROM public.user_profiles
  WHERE user_id = '00000000-0000-4000-8000-000000000002'), 'cross-user personal update changed no rows');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.organisations), 'organisation data preserved');

-- Prove the invoker trigger is a separate boundary even if a later grant
-- accidentally restores broad table privileges. Claims alone cannot bypass it.
GRANT INSERT, UPDATE ON public.user_profiles TO authenticated;
CREATE POLICY profile_test_insert ON public.user_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
ALTER TABLE public.user_profiles ADD COLUMN test_future_authority text;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role = 'service_role';
SELECT pg_temp.denied($q$UPDATE public.user_profiles SET role = 'admin'
  WHERE user_id = auth.uid()$q$, 'invoker guard rejects forged service role claim');
SELECT pg_temp.denied($q$UPDATE public.user_profiles SET phone_verified = true
  WHERE user_id = auth.uid()$q$, 'invoker guard rejects verification forgery');
SELECT pg_temp.denied($q$UPDATE public.user_profiles SET test_future_authority = 'privileged'
  WHERE user_id = auth.uid()$q$, 'invoker guard protects future non-personal columns');
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000005';
SELECT pg_temp.denied($q$INSERT INTO public.user_profiles (user_id, email)
  VALUES (auth.uid(), 'missing.profile@example.invalid')$q$, 'invoker guard rejects direct profile creation');
RESET ROLE;

SET LOCAL ROLE service_role;
INSERT INTO public.user_profiles (user_id, email, role, plan)
VALUES ('00000000-0000-4000-8000-000000000005', 'missing.profile@example.invalid', 'user', 'explorer');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.user_profiles
  WHERE user_id = '00000000-0000-4000-8000-000000000005'), 'trusted server can create a missing profile');
UPDATE public.user_profiles SET role = 'admin', plan = 'professional', status = 'active',
  organisation_id = '10000000-0000-4000-8000-000000000001'
WHERE user_id = '00000000-0000-4000-8000-000000000004';
SELECT pg_temp.assert_true((SELECT role = 'admin' AND plan = 'professional' AND status = 'active'
  FROM public.user_profiles WHERE user_id = '00000000-0000-4000-8000-000000000004'),
  'trusted server provisioning remains available');
UPDATE public.user_profiles SET status = 'suspended'
WHERE user_id = '00000000-0000-4000-8000-000000000003';
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_true(NOT public.is_platform_admin(), 'suspended internal admin rejected');
RESET ROLE;

SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.sub = '';
SELECT pg_temp.denied($q$SELECT public.get_my_profile()$q$, 'anonymous profile RPC denied');
SELECT pg_temp.denied($q$SELECT public.update_my_onboarding_profile()$q$, 'anonymous onboarding RPC denied');
SELECT pg_temp.denied($q$SELECT public.create_organisation('Anonymous')$q$, 'anonymous organisation RPC denied');
SELECT pg_temp.denied($q$SELECT public.is_platform_admin()$q$, 'anonymous authority helper denied');
RESET ROLE;

ROLLBACK;
