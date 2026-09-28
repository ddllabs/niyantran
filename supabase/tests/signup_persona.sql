-- Disposable PG assertions for the signup persona: handle_new_user() copies
-- the persona picked at signup (raw_user_meta_data->>'personaId', a frontend
-- id) into user_profiles.persona. Run on the least-privilege fixture plus
-- research-turn persistence and 20260928120000_signup_persona.sql; never
-- against a hosted project.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END; $$;

-- One signup per frontend id, as SignupPage sends it, plus the cases that
-- must not set a persona: no pick, an unknown id, and a database enum value
-- (the client never sends those, so accepting them would be a second vocabulary).
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-000000000101', 'policy@example.test',     '{"personaId":"policy","first_name":"P"}'),
  ('00000000-0000-4000-8000-000000000102', 'journalist@example.test', '{"personaId":"journalist"}'),
  ('00000000-0000-4000-8000-000000000103', 'student@example.test',    '{"personaId":"student"}'),
  ('00000000-0000-4000-8000-000000000104', 'analyst@example.test',    '{"personaId":"analyst"}'),
  ('00000000-0000-4000-8000-000000000105', 'lawyer@example.test',     '{"personaId":"lawyer"}'),
  ('00000000-0000-4000-8000-000000000106', 'academic@example.test',   '{"personaId":"academic"}'),
  ('00000000-0000-4000-8000-000000000107', 'none@example.test',       '{}'),
  ('00000000-0000-4000-8000-000000000108', 'unknown@example.test',    '{"personaId":"hacker"}'),
  ('00000000-0000-4000-8000-000000000109', 'enum@example.test',       '{"personaId":"upsc_aspirant"}');

CREATE TEMP TABLE got AS
  SELECT email, persona::text AS persona, role::text AS role, plan::text AS plan, status::text AS status, first_name
  FROM public.user_profiles WHERE email LIKE '%@example.test';

SELECT pg_temp.assert_true((SELECT count(*) FROM got) = 9, 'every signup created a profile');
SELECT pg_temp.assert_true((SELECT persona FROM got WHERE email = 'policy@example.test') = 'policy_analyst', 'policy maps to policy_analyst');
SELECT pg_temp.assert_true((SELECT persona FROM got WHERE email = 'journalist@example.test') = 'journalist', 'journalist maps to journalist');
SELECT pg_temp.assert_true((SELECT persona FROM got WHERE email = 'student@example.test') = 'upsc_aspirant', 'student maps to upsc_aspirant');
SELECT pg_temp.assert_true((SELECT persona FROM got WHERE email = 'analyst@example.test') = 'corporate_affairs', 'analyst maps to corporate_affairs');
SELECT pg_temp.assert_true((SELECT persona FROM got WHERE email = 'lawyer@example.test') = 'legal_researcher', 'lawyer maps to legal_researcher');
SELECT pg_temp.assert_true((SELECT persona FROM got WHERE email = 'academic@example.test') = 'academic', 'academic maps to academic');
SELECT pg_temp.assert_true((SELECT persona FROM got WHERE email = 'none@example.test') IS NULL, 'no pick leaves persona null');
SELECT pg_temp.assert_true((SELECT persona FROM got WHERE email = 'unknown@example.test') IS NULL, 'an unknown id leaves persona null');
SELECT pg_temp.assert_true((SELECT persona FROM got WHERE email = 'enum@example.test') IS NULL, 'an enum value is not a frontend id');

-- The authority fields stay what every normal signup gets, whatever the
-- metadata says.
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM got WHERE role <> 'user' OR plan <> 'explorer' OR status <> 'active'), 'signup still starts as user / explorer / active');
SELECT pg_temp.assert_true((SELECT first_name FROM got WHERE email = 'policy@example.test') = 'P', 'first name is still copied');

-- The function stays callable only by its trusted owner.
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE'), 'anon cannot call handle_new_user');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE'), 'authenticated cannot call handle_new_user');
ROLLBACK;
