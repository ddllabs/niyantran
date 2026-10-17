-- F225 additive contract: red without 20261017194626_credit_paise_contract.sql.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
  RAISE NOTICE 'PASS: %',label;
END;
$$;
CREATE FUNCTION pg_temp.rejected(statement text, state text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> state THEN RAISE EXCEPTION 'FAIL: % expected %, got %',label,state,SQLSTATE; END IF;
    RAISE NOTICE 'PASS: %',label; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % was accepted',label;
END;
$$;
SELECT pg_temp.assert_true(public.credit_unit() @> '{"unit_version":"credit-ten-paise-v1","inr_per_credit":0.1000}',
  'compatible contract retains old unit before explicit conversion');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.credit_epoch), 'one epoch row');
SELECT pg_temp.assert_true(has_function_privilege('authenticated','public.credit_unit()','EXECUTE')
  AND has_function_privilege('service_role','public.credit_unit()','EXECUTE')
  AND NOT has_function_privilege('anon','public.credit_unit()','EXECUTE'), 'credit_unit permissions');
SELECT pg_temp.assert_true(has_function_privilege('service_role',
  'public.admin_adjust_credits_v2(uuid,numeric,text,text,uuid,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated',
  'public.admin_adjust_credits_v2(uuid,numeric,text,text,uuid,uuid,text)','EXECUTE'), 'v2 adjustment is service only');
SELECT pg_temp.rejected($q$SELECT public.admin_adjust_credits_v2('00000000-0000-4000-8000-00000000c0a1',5,
  'topup','Fixture','00000000-0000-4000-8000-00000000c0ff','a0000000-0000-4000-8000-00000000f001',
  'credit-paise-v2')$q$,'22023','new-unit adjustment rejected before cutover');
UPDATE private.credit_epoch SET paused=true WHERE id;
INSERT INTO public.credit_holds (user_id,turn_key,credits,expires_at)
VALUES ('00000000-0000-4000-8000-00000000c0a1','active-cutover-hold',3,now()+interval '5 minutes');
SELECT pg_temp.rejected($q$SELECT private.credit_convert_to_paise()$q$,'55000',
  'active hold aborts conversion atomically');
SELECT pg_temp.assert_true((SELECT unit_version='credit-ten-paise-v1' AND paused FROM private.credit_epoch WHERE id)
  AND (SELECT inr_per_credit=0.10 FROM public.credit_settings WHERE id)
  AND NOT EXISTS (SELECT FROM private.credit_legacy_entries)
  AND NOT EXISTS (SELECT FROM private.credit_lot_conversions),
  'aborted conversion leaves old epoch and no partial mapping');
SELECT pg_temp.rejected($q$SELECT public.reserve_turn_credits('00000000-0000-4000-8000-00000000c0a1',
  'paused-test',true)$q$,'55000','writer gate blocks reserve before settings');
SELECT pg_temp.rejected($q$SELECT public.admin_adjust_credits_v2('00000000-0000-4000-8000-00000000c0a1',5,
  'topup','Fixture','00000000-0000-4000-8000-00000000c0ff','a0000000-0000-4000-8000-00000000f001',
  'credit-ten-paise-v1')$q$,'55000','writer gate blocks admin before settings');
ROLLBACK;
