-- Operator review aliases and owned, read-only stale-plan preflight.
-- Vacuity: omit 20261019191550_billing_checkout_preflight.sql.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
CREATE FUNCTION pg_temp.assert(ok boolean,why text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',why; END IF; END $$;
INSERT INTO auth.users(id,email) VALUES('e0000000-0000-4000-8000-000000000001','preflight@fixture.test'),('e0000000-0000-4000-8000-000000000002','foreign@fixture.test');
UPDATE public.user_profiles SET status='active' WHERE user_id::text LIKE 'e0000000%';
DO $$ DECLARE o jsonb; p jsonb; r jsonb; payment_id uuid; version bigint; before_orders bigint; before_ledger bigint;
BEGIN
 o:=public.billing_order('claim','{"userId":"e0000000-0000-4000-8000-000000000001","requestId":"e0000000-0000-4000-8000-000000000003","requestHash":"plan-pro","account":"acc_preflight","mode":"test","snapshot":{"kind":"plan","productId":"plan-pro","planId":"pro","credits":65000,"amountPaise":99900,"currency":"INR","creditUnit":"credit-paise-v2","buyerEmail":"preflight@fixture.test"}}');
 p:=jsonb_build_object('purchaseId',o->>'id','userId','e0000000-0000-4000-8000-000000000001','account','acc_preflight','mode','test');
 INSERT INTO private.billing_payments(order_id,account,mode,provider_payment_id,amount_paise,currency,status)
 VALUES((o->>'id')::uuid,'acc_preflight','test','pay_preflight',99900,'INR','authorized') RETURNING id INTO payment_id;
 INSERT INTO private.billing_adjustments(payment_id,provider_adjustment_id,kind,amount_paise,provider_status)
 VALUES(payment_id,'refund_preflight','refund',99900,'pending');
 -- This executes the original failure before any missing-function/vacuity guard.
 r:=public.billing_event('reviews','{"account":"acc_preflight","mode":"test"}');
 PERFORM pg_temp.assert(jsonb_array_length(r)=1 AND r->0->>'provider_adjustment_id'='refund_preflight','nonempty operator review list');
 PERFORM pg_temp.assert(public.billing_event('reviews','{"account":"acc_other","mode":"test"}')='[]','operator account isolation');
 PERFORM pg_temp.assert(public.billing_event('reviews','{"account":"acc_preflight","mode":"live"}')='[]','operator mode isolation');
 r:=public.billing_checkout_preflight(p);
 PERFORM pg_temp.assert(r->>'stale'='false' AND r->>'observedPayment'='true','fresh plan with observed payment');
 INSERT INTO public.plan_grants(user_id,plan,status,period_end,source)
 VALUES('e0000000-0000-4000-8000-000000000001','plus','active',now()+interval '1 month','manual') RETURNING id INTO version;
 SELECT count(*) INTO before_orders FROM private.billing_orders;
 SELECT count(*) INTO before_ledger FROM public.credit_ledger;
 r:=public.billing_checkout_preflight(p);
 PERFORM pg_temp.assert(r->>'stale'='true' AND r->>'version'=version::text,'old grant snapshot is stale');
 PERFORM pg_temp.assert((SELECT count(*)=before_orders FROM private.billing_orders) AND (SELECT count(*)=before_ledger FROM public.credit_ledger),'preflight has no financial writes');
 BEGIN PERFORM public.billing_checkout_preflight(p||'{"userId":"e0000000-0000-4000-8000-000000000002"}'); RAISE EXCEPTION 'FAIL: foreign buyer'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.billing_checkout_preflight(p||'{"mode":"live"}'); RAISE EXCEPTION 'FAIL: wrong mode'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.billing_checkout_preflight(p||'{"account":"acc_other"}'); RAISE EXCEPTION 'FAIL: wrong account'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.user_profiles SET status='inactive' WHERE user_id='e0000000-0000-4000-8000-000000000001';
 BEGIN PERFORM public.billing_checkout_preflight(p); RAISE EXCEPTION 'FAIL: inactive buyer'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.assert(NOT has_function_privilege('anon','public.billing_checkout_preflight(jsonb)','EXECUTE'),'anon preflight denied');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','public.billing_checkout_preflight(jsonb)','EXECUTE'),'customer preflight denied');
SELECT pg_temp.assert(has_function_privilege('service_role','public.billing_checkout_preflight(jsonb)','EXECUTE'),'service preflight enabled');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','public.billing_event(text,jsonb)','EXECUTE'),'customer operator RPC denied');
ROLLBACK;
