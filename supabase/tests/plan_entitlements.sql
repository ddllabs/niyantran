-- Disposable PG assertions for F2 phase 1, server-owned plan entitlements.
-- Run on the least-privilege fixture plus research-turn persistence,
-- 20260928120000_signup_persona.sql and 20260929100000_plan_entitlements.sql;
-- never against a hosted project. now() is fixed for the whole transaction,
-- so period arithmetic below is exact.
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

-- Privileges: users read the plan and may start a trial; only the server grants.
DO $$
DECLARE actor text; col text;
BEGIN
  FOREACH col IN ARRAY ARRAY['plan','plan_status','plan_period_end','plan_source','trial_started_at'] LOOP
    PERFORM pg_temp.assert_true(NOT has_column_privilege('authenticated', 'public.user_profiles', col, 'UPDATE'), 'authenticated cannot UPDATE ' || col);
    PERFORM pg_temp.assert_true(has_column_privilege('authenticated', 'public.user_profiles', col, 'SELECT'), 'authenticated can read ' || col);
  END LOOP;
  FOREACH actor IN ARRAY ARRAY['anon','authenticated'] LOOP
    PERFORM pg_temp.assert_true(NOT has_function_privilege(actor, 'public.grant_paid_plan(uuid,text,text,text)', 'EXECUTE'), actor || ' cannot grant a paid plan');
    PERFORM pg_temp.assert_true(NOT has_function_privilege(actor, 'public.grant_manual_plan(uuid,text,timestamptz,uuid)', 'EXECUTE'), actor || ' cannot grant a manual plan');
    PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, 'public.plan_grants', 'SELECT'), actor || ' cannot read plan_grants');
    PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, 'public.plan_grants', 'INSERT'), actor || ' cannot write plan_grants');
  END LOOP;
  PERFORM pg_temp.assert_true(NOT has_function_privilege('anon', 'public.my_entitlement()', 'EXECUTE'), 'anon cannot read an entitlement');
  PERFORM pg_temp.assert_true(NOT has_function_privilege('anon', 'public.start_trial(text)', 'EXECUTE'), 'anon cannot start a trial');
  PERFORM pg_temp.assert_true(has_function_privilege('authenticated', 'public.my_entitlement()', 'EXECUTE'), 'authenticated reads its entitlement');
  PERFORM pg_temp.assert_true(has_function_privilege('authenticated', 'public.start_trial(text)', 'EXECUTE'), 'authenticated may start a trial');
  PERFORM pg_temp.assert_true(has_function_privilege('service_role', 'public.grant_paid_plan(uuid,text,text,text)', 'EXECUTE'), 'service_role grants paid plans');
  PERFORM pg_temp.assert_true(has_function_privilege('service_role', 'public.grant_manual_plan(uuid,text,timestamptz,uuid)', 'EXECUTE'), 'service_role grants manual plans');
  PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE'), 'authenticated cannot call handle_new_user');
END $$;

-- Signup: the picked plan starts its trial; anything else starts free.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'a@example.test', '{"personaId":"policy"}'),
  ('00000000-0000-4000-8000-0000000000b2', 'b@example.test', '{"plan":"explorer"}'),
  ('00000000-0000-4000-8000-0000000000c3', 'c@example.test', '{"plan":"gov"}'),
  ('00000000-0000-4000-8000-0000000000d4', 'd@example.test', '{"plan":"pro","personaId":"lawyer"}'),
  ('00000000-0000-4000-8000-0000000000e5', 'e@example.test', '{"plan":"enterprise","role":"admin","status":"active"}'),
  ('00000000-0000-4000-8000-0000000000f6', 'admin@example.test', '{}');
UPDATE public.user_profiles SET role = 'admin' WHERE user_id = '00000000-0000-4000-8000-0000000000f6';

SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT FROM public.user_profiles WHERE email IN ('a@example.test','b@example.test','c@example.test')
    AND (plan <> 'explorer' OR plan_status <> 'free' OR trial_started_at IS NOT NULL OR plan_period_end IS NOT NULL)),
  'no pick, explorer and gov start free with no trial used');
SELECT pg_temp.assert_true((SELECT plan::text = 'professional' AND plan_status = 'trial' AND plan_source = 'trial'
    AND plan_period_end = now() + interval '14 days' AND trial_started_at = now() AND persona::text = 'legal_researcher'
  FROM public.user_profiles WHERE email = 'd@example.test'), 'signup pro starts a 14-day Professional trial, persona still saved');
SELECT pg_temp.assert_true((SELECT plan::text = 'enterprise' AND plan_status = 'trial' AND role::text = 'user'
  FROM public.user_profiles WHERE email = 'e@example.test'), 'signup enterprise starts an Enterprise trial; role stays user');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.plan_grants WHERE source = 'trial') = 2, 'both signup trials are logged');

-- A user cannot set their own plan fields, directly or through the table.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
SELECT pg_temp.rejected($$UPDATE public.user_profiles SET plan = 'enterprise', plan_status = 'active' WHERE user_id = auth.uid()$$, 'a user cannot give themselves a plan');
SELECT pg_temp.rejected($$UPDATE public.user_profiles SET plan_period_end = now() + interval '10 years' WHERE user_id = auth.uid()$$, 'a user cannot extend their period');
SELECT pg_temp.rejected($$UPDATE public.user_profiles SET trial_started_at = NULL WHERE user_id = auth.uid()$$, 'a user cannot reset their trial');
SELECT pg_temp.rejected($$SELECT public.grant_paid_plan(auth.uid(), 'pro', 'year', 'pay_forged')$$, 'a user cannot call grant_paid_plan');
SELECT pg_temp.rejected($$SELECT public.grant_manual_plan(auth.uid(), 'enterprise', NULL, auth.uid())$$, 'a user cannot call grant_manual_plan');
UPDATE public.user_profiles SET first_name = 'Still editable' WHERE user_id = auth.uid();
SELECT pg_temp.assert_true((SELECT first_name FROM public.user_profiles WHERE user_id = auth.uid()) = 'Still editable', 'personal columns stay editable');

-- Trial: once, and only for Pro or Enterprise.
SELECT pg_temp.assert_true(public.my_entitlement() @> '{"plan":"explorer","status":"free","trial_used":false,"lapsed":false}', 'a new free account reads explorer, trial unused');
SELECT pg_temp.rejected($$SELECT public.start_trial('explorer')$$, 'no trial of explorer');
SELECT pg_temp.rejected($$SELECT public.start_trial('gov')$$, 'no trial of gov');
SELECT pg_temp.assert_true(public.start_trial('pro') @> '{"plan":"professional","status":"trial","source":"trial","trial_used":true}', 'start_trial(pro) grants a Professional trial');
SELECT pg_temp.assert_true((SELECT plan_period_end = now() + interval '14 days' FROM public.user_profiles WHERE user_id = auth.uid()), 'the trial lasts 14 days');
SELECT pg_temp.rejected($$SELECT public.start_trial('enterprise')$$, 'a second trial is refused');
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000d4';
SELECT pg_temp.rejected($$SELECT public.start_trial('enterprise')$$, 'an account with a signup trial cannot start another');
RESET ROLE;

-- Lapse: a trial past its end reads as free, and still counts as used.
UPDATE public.user_profiles SET plan_period_end = now() - interval '1 second' WHERE user_id = '00000000-0000-4000-8000-0000000000a1';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
SELECT pg_temp.assert_true(public.my_entitlement() @> '{"plan":"explorer","status":"free","lapsed":true,"granted_plan":"professional","trial_used":true}', 'a lapsed trial reads as free');
SELECT pg_temp.rejected($$SELECT public.start_trial('pro')$$, 'a lapsed trial cannot be restarted');
RESET ROLE;

-- Payments: service role only, a fixed period, idempotent per payment id,
-- and a renewal of the same plan extends from the current end.
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.grant_paid_plan('00000000-0000-4000-8000-0000000000b2', 'pro', 'month', 'pay_1') @> '{"plan":"professional","status":"active","source":"payment"}', 'a verified payment grants Professional');
SELECT pg_temp.assert_true((SELECT plan_period_end = now() + interval '1 month' FROM public.user_profiles WHERE email = 'b@example.test'), 'a monthly payment grants one month');
SELECT public.grant_paid_plan('00000000-0000-4000-8000-0000000000b2', 'pro', 'month', 'pay_1');
SELECT pg_temp.assert_true((SELECT plan_period_end = now() + interval '1 month' FROM public.user_profiles WHERE email = 'b@example.test'), 'the same payment id does not extend twice');
SELECT public.grant_paid_plan('00000000-0000-4000-8000-0000000000b2', 'pro', 'year', 'pay_2');
SELECT pg_temp.assert_true((SELECT plan_period_end = now() + interval '1 month' + interval '1 year' FROM public.user_profiles WHERE email = 'b@example.test'), 'a renewal extends from the current end');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.plan_grants WHERE user_id = '00000000-0000-4000-8000-0000000000b2') = 2, 'two payments, two grant rows');
SELECT pg_temp.rejected($$SELECT public.grant_paid_plan('00000000-0000-4000-8000-0000000000c3', 'pro', 'week', 'pay_3')$$, 'the period is month or year');
SELECT pg_temp.rejected($$SELECT public.grant_paid_plan('00000000-0000-4000-8000-0000000000c3', 'explorer', 'month', 'pay_3')$$, 'explorer is not a paid plan');
SELECT pg_temp.rejected($$SELECT public.grant_paid_plan('00000000-0000-4000-8000-0000000000c3', 'pro', 'month', '')$$, 'a payment id is required');
SELECT pg_temp.rejected($$SELECT public.grant_paid_plan('00000000-0000-4000-8000-000000000999', 'pro', 'month', 'pay_4')$$, 'an unknown user is refused');
RESET ROLE;

-- A paid account cannot start a trial on top.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b2';
SELECT pg_temp.rejected($$SELECT public.start_trial('enterprise')$$, 'a paid account cannot start a trial');
SELECT pg_temp.assert_true(public.my_entitlement() @> '{"plan":"professional","status":"active","trial_used":false}', 'the paid account reads Professional');
RESET ROLE;

-- Manual grants: open-ended or dated, and explorer revokes.
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(public.grant_manual_plan('00000000-0000-4000-8000-0000000000c3', 'enterprise', NULL, '00000000-0000-4000-8000-0000000000f6') @> '{"plan":"enterprise","status":"active","source":"manual","period_end":null}', 'a manual open-ended Enterprise grant');
SELECT pg_temp.assert_true((SELECT granted_by = '00000000-0000-4000-8000-0000000000f6' FROM public.plan_grants WHERE user_id = '00000000-0000-4000-8000-0000000000c3'), 'the granting admin is logged');
SELECT pg_temp.rejected($$SELECT public.grant_manual_plan('00000000-0000-4000-8000-0000000000c3', 'pro', now() - interval '1 day', NULL)$$, 'a manual end date in the past is refused');
SELECT pg_temp.rejected($$SELECT public.grant_manual_plan('00000000-0000-4000-8000-0000000000c3', 'gov', NULL, NULL)$$, 'an unknown plan is refused');
SELECT pg_temp.assert_true(public.grant_manual_plan('00000000-0000-4000-8000-0000000000c3', 'explorer', now() + interval '1 day', NULL) @> '{"plan":"explorer","status":"free","period_end":null}', 'explorer revokes');
SELECT pg_temp.assert_true(public.grant_manual_plan('00000000-0000-4000-8000-0000000000e5', 'pro', now() + interval '30 days', NULL) @> '{"plan":"professional","status":"active"}', 'a manual grant replaces a trial');
RESET ROLE;

-- The table itself refuses inconsistent rows, even from the server.
SELECT pg_temp.rejected($$UPDATE public.user_profiles SET plan_status = 'trial', plan_period_end = NULL WHERE email = 'e@example.test'$$, 'a trial without an end is refused');
SELECT pg_temp.rejected($$UPDATE public.user_profiles SET plan_status = 'active' WHERE email = 'c@example.test'$$, 'explorer cannot be active');
SELECT pg_temp.rejected($$UPDATE public.user_profiles SET plan_status = 'gold' WHERE email = 'b@example.test'$$, 'an unknown status is refused');

-- anon reads nothing.
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.sub = '';
SELECT pg_temp.rejected($$SELECT public.my_entitlement()$$, 'anon cannot call my_entitlement');
RESET ROLE;
ROLLBACK;
