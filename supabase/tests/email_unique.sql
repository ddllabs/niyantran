-- Disposable PG assertions for F10: one account per normalised email.
-- Run on the least-privilege fixture plus research-turn persistence,
-- signup_persona, plan_entitlements and 20260929110000_email_unique.sql;
-- never against a hosted project.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END; $$;
CREATE FUNCTION pg_temp.rejected(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS: % (%)', label, SQLSTATE; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % accepted', label;
END; $$;

SELECT pg_temp.assert_true(EXISTS (
  SELECT FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'user_profiles'
    AND indexdef ILIKE 'CREATE UNIQUE INDEX%(email_normalised)%'), 'email_normalised has a unique index');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'Jane.Doe@gmail.com', '{}'),
  ('00000000-0000-4000-8000-0000000000b2', 'jane.doe@example.org', '{}');
SELECT pg_temp.assert_true((SELECT email_normalised FROM public.user_profiles WHERE user_id = '00000000-0000-4000-8000-0000000000a1') = 'janedoe@gmail.com', 'gmail dots are folded');

-- A signup whose address folds to an existing one fails as a whole: the
-- profile insert runs inside the auth.users insert.
SELECT pg_temp.rejected($$INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('00000000-0000-4000-8000-0000000000c3', 'janedoe+trial@googlemail.com', '{}')$$, 'a gmail alias of an existing account is refused');
SELECT pg_temp.rejected($$INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('00000000-0000-4000-8000-0000000000d4', ' JANE.DOE@EXAMPLE.ORG ', '{}')$$, 'case and spaces do not make a second account');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM auth.users WHERE id IN ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000d4')), 'no auth user is left behind by a refused signup');

-- Dots stay significant outside gmail, so these are different accounts.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('00000000-0000-4000-8000-0000000000e5', 'janedoe@example.org', '{}');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.user_profiles WHERE email_normalised LIKE '%@example.org') = 2, 'dots are significant outside gmail');

-- An email change onto another account's address is refused too.
SELECT pg_temp.rejected($$UPDATE public.user_profiles SET email = 'jane.doe+x@gmail.com' WHERE user_id = '00000000-0000-4000-8000-0000000000b2'$$, 'an email change onto an existing address is refused');
ROLLBACK;
