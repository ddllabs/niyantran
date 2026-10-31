-- Disposable PG assertions for the INR plan set (open-work F109).
-- Run on the plan_entitlements chain plus 20261012120000_inr_plans.sql
-- (applied as a non-superuser); never against a hosted project. now() is
-- fixed for the whole transaction, so period arithmetic below is exact.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END; $$;
CREATE FUNCTION pg_temp.rejected(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS: % (%: %)', label, SQLSTATE, SQLERRM; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % accepted', label;
END; $$;

-- The plan values are the product's.
SELECT pg_temp.assert_true((SELECT array_agg(enumlabel::text ORDER BY enumsortorder) FROM pg_enum
  WHERE enumtypid = 'public.app_plan'::regtype) = ARRAY['free','plus','pro','max'], 'app_plan is free, plus, pro, max');
SELECT pg_temp.assert_true((SELECT column_default LIKE '''free''%' FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'plan'), 'new profiles default to free');

-- Privileges: no trials for anyone; only the server grants.
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.start_trial(text)', 'EXECUTE'), 'authenticated can no longer start a trial');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.start_trial(text)', 'EXECUTE'), 'anon cannot start a trial');
SELECT pg_temp.assert_true(has_function_privilege('authenticated', 'public.my_entitlement()', 'EXECUTE'), 'authenticated reads its entitlement');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.grant_paid_plan(uuid,text,text,text)', 'EXECUTE'), 'authenticated cannot grant a paid plan');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.grant_paid_plan(uuid,text,text,text)', 'EXECUTE'), 'service_role grants paid plans');

-- Signup always starts free, whatever plan the metadata names.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000001a1', 'a@example.test', '{"personaId":"policy"}'),
  ('00000000-0000-4000-8000-0000000001b2', 'b@example.test', '{"plan":"pro"}'),
  ('00000000-0000-4000-8000-0000000001c3', 'c@example.test', '{"plan":"max","role":"admin"}'),
  ('00000000-0000-4000-8000-0000000001d4', 'd@example.test', '{"plan":"enterprise"}');
SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT FROM public.user_profiles WHERE email LIKE '%@example.test'
    AND (plan <> 'free' OR plan_status <> 'free' OR trial_started_at IS NOT NULL OR plan_period_end IS NOT NULL OR role::text <> 'user')),
  'every signup starts free with no trial, role user');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.plan_grants) = 0, 'signup logs no grant');
SELECT pg_temp.assert_true((SELECT persona::text FROM public.user_profiles WHERE email = 'a@example.test') = 'policy_analyst', 'the persona is still saved');

-- A signed-in user reads free and cannot start a trial even by name.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000001a1';
SELECT pg_temp.assert_true(public.my_entitlement() @> '{"plan":"free","status":"free","lapsed":false}', 'a new account reads free');
SELECT pg_temp.rejected($$SELECT public.start_trial('pro')$$, 'start_trial is refused');
SELECT pg_temp.rejected($$UPDATE public.user_profiles SET plan = 'max', plan_status = 'active' WHERE user_id = auth.uid()$$, 'a user cannot give themselves Max');
RESET ROLE;
SELECT pg_temp.rejected($$SELECT public.start_trial('pro')$$, 'start_trial refuses even its owner');

-- Payments: monthly only, the three paid plans, idempotent, renewals extend.
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.grant_paid_plan('00000000-0000-4000-8000-0000000001b2', 'plus', 'month', 'pay_1') @> '{"plan":"plus","status":"active","source":"payment"}', 'a verified payment grants Plus');
SELECT pg_temp.assert_true((SELECT plan_period_end = now() + interval '1 month' FROM public.user_profiles WHERE email = 'b@example.test'), 'one month per payment');
SELECT public.grant_paid_plan('00000000-0000-4000-8000-0000000001b2', 'plus', 'month', 'pay_1');
SELECT pg_temp.assert_true((SELECT plan_period_end = now() + interval '1 month' FROM public.user_profiles WHERE email = 'b@example.test'), 'the same payment id does not extend twice');
SELECT public.grant_paid_plan('00000000-0000-4000-8000-0000000001b2', 'plus', 'month', 'pay_2');
SELECT pg_temp.assert_true((SELECT plan_period_end = now() + interval '1 month' + interval '1 month' FROM public.user_profiles WHERE email = 'b@example.test'), 'a renewal extends from the current end');
SELECT pg_temp.assert_true(public.grant_paid_plan('00000000-0000-4000-8000-0000000001b2', 'max', 'month', 'pay_3') @> '{"plan":"max"}', 'a change of plan starts from now');
SELECT pg_temp.assert_true((SELECT plan_period_end = now() + interval '1 month' FROM public.user_profiles WHERE email = 'b@example.test'), 'a plan change grants one month from now');
SELECT pg_temp.assert_true(public.grant_paid_plan('00000000-0000-4000-8000-0000000001c3', 'pro', 'month', 'pay_4') @> '{"plan":"pro"}', 'a verified payment grants Pro');
SELECT pg_temp.rejected($$SELECT public.grant_paid_plan('00000000-0000-4000-8000-0000000001d4', 'pro', 'year', 'pay_5')$$, 'yearly periods are refused');
SELECT pg_temp.rejected($$SELECT public.grant_paid_plan('00000000-0000-4000-8000-0000000001d4', 'enterprise', 'month', 'pay_5')$$, 'enterprise is not a plan');
SELECT pg_temp.rejected($$SELECT public.grant_paid_plan('00000000-0000-4000-8000-0000000001d4', 'professional', 'month', 'pay_5')$$, 'professional is not a plan');
SELECT pg_temp.rejected($$SELECT public.grant_paid_plan('00000000-0000-4000-8000-0000000001d4', 'free', 'month', 'pay_5')$$, 'free is not a paid plan');
RESET ROLE;

-- Lapse reads as free.
UPDATE public.user_profiles SET plan_period_end = now() - interval '1 second' WHERE email = 'c@example.test';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000001c3';
SELECT pg_temp.assert_true(public.my_entitlement() @> '{"plan":"free","status":"free","lapsed":true,"granted_plan":"pro"}', 'a lapsed Pro month reads as free');
RESET ROLE;

-- Manual grants: free revokes.
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.grant_manual_plan('00000000-0000-4000-8000-0000000001d4', 'max', NULL, NULL) @> '{"plan":"max","status":"active","source":"manual","period_end":null}', 'a manual open-ended Max grant');
SELECT pg_temp.assert_true(public.grant_manual_plan('00000000-0000-4000-8000-0000000001d4', 'free', now() + interval '1 day', NULL) @> '{"plan":"free","status":"free","period_end":null}', 'free revokes');
SELECT pg_temp.rejected($$SELECT public.grant_manual_plan('00000000-0000-4000-8000-0000000001d4', 'explorer', NULL, NULL)$$, 'explorer is not a plan');
RESET ROLE;

-- The table keeps refusing inconsistent rows.
SELECT pg_temp.rejected($$UPDATE public.user_profiles SET plan_status = 'active' WHERE email = 'a@example.test'$$, 'free cannot be active');
SELECT pg_temp.rejected($$UPDATE public.user_profiles SET plan = 'plus' WHERE email = 'a@example.test'$$, 'a paid plan cannot have the free status');
ROLLBACK;
