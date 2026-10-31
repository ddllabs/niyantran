-- Full current billing chain; 20261031130000_retire_grant_paid_plan.sql is required last (F276).
-- The legacy grant is gone; checkout purchases, manual grants and existing legacy grants still work.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert(ok boolean,why text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',why; END IF; END $$;
SELECT pg_temp.assert(to_regprocedure('public.grant_paid_plan(uuid,text,text,text)') IS NULL,'grant_paid_plan is retired');
SELECT pg_temp.assert(to_regprocedure('public.billing_capture(uuid,jsonb)') IS NOT NULL
  AND to_regprocedure('public.grant_manual_plan(uuid,text,timestamptz,uuid)') IS NOT NULL
  AND to_regprocedure('private.credit_due_cycles_legacy(uuid,timestamptz)') IS NOT NULL,'checkout, manual grants and legacy cycles remain');
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
CREATE FUNCTION pg_temp.buyer() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE uid uuid:=gen_random_uuid(); BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(uid,uid||'@retired.fixture.test',now());
 UPDATE public.user_profiles SET status='active' WHERE user_id=uid;
 RETURN uid;
END $$;

-- A checkout purchase still grants the plan, ending on the anchor-day month end.
DO $$
DECLARE uid uuid:=pg_temp.buyer(); o jsonb; pay jsonb; ref text:=replace(gen_random_uuid()::text,'-',''); snap jsonb;
BEGIN
 snap:=jsonb_build_object('kind','plan','productId','plan-plus','planId','plus','credits',20000,'amountPaise',39900,
  'currency','INR','creditUnit','credit-paise-v2','buyerEmail','retired@fixture.test');
 o:=public.billing_order('claim',jsonb_build_object('userId',uid,'requestId',gen_random_uuid(),'requestHash',ref,'account','acc_retired','mode','test','snapshot',snap));
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_'||ref,'receipt',o->>'id','amount',o->>'amount_paise','currency','INR')));
 pay:=jsonb_build_object('id','pay_'||ref,'order_id','order_'||ref,'amount',o->>'amount_paise','currency','INR','status','captured');
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',pay));
 PERFORM pg_temp.assert(public.billing_capture((o->>'id')::uuid,pay)->>'ok'='true','a checkout capture succeeds');
 PERFORM pg_temp.assert((SELECT plan='plus' AND plan_status='active' AND plan_period_end=private.billing_month_end(now(),now())
   FROM public.user_profiles WHERE user_id=uid),'the purchase grants Plus to the anchor-day month end');
END $$;

-- A payment grant made by the retired function still yields its credit cycle.
DO $$
DECLARE uid uuid:=pg_temp.buyer();
BEGIN
 INSERT INTO public.plan_grants(user_id,plan,status,period_end,source,payment_id,created_at)
   VALUES(uid,'plus','active',now()+interval '20 days','payment','legacy_1',now()-interval '10 days');
 PERFORM pg_temp.assert(EXISTS(SELECT FROM private.credit_due_cycles(uid,now()) WHERE source_key LIKE 'grant:%'),
   'an existing legacy payment grant is still served');
END $$;
ROLLBACK;
