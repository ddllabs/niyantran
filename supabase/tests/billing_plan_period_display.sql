-- Owned read-only periods plus all-plan/pack accounting matrix.
-- Vacuity: omit billing_plan_period_display migration.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
CREATE FUNCTION pg_temp.assert(ok boolean,why text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',why; END IF; END $$;
CREATE FUNCTION pg_temp.buy(buyer uuid,plan_id text,qty numeric,price bigint) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o jsonb; p jsonb; result jsonb; ref text:=replace(gen_random_uuid()::text,'-',''); BEGIN
 o:=public.billing_order('claim',jsonb_build_object('userId',buyer,'requestId',gen_random_uuid(),'requestHash',ref,'account','acc_periods','mode','test','snapshot',jsonb_build_object('kind',CASE WHEN plan_id IS NULL THEN 'topup' ELSE 'plan' END,'productId',coalesce('plan-'||plan_id,'topup-'||qty),'planId',plan_id,'credits',qty,'amountPaise',price,'currency','INR','creditUnit','credit-paise-v2','buyerEmail','synthetic@fixture.test')));
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_'||ref,'amount',price,'currency','INR','receipt',o->>'id')));
 p:=jsonb_build_object('id','pay_'||ref,'order_id','order_'||ref,'amount',price,'currency','INR','status','captured');
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',p));
 result:=public.billing_capture((o->>'id')::uuid,p);
 PERFORM pg_temp.assert(result->>'ok'='true','capture must fulfil');
 PERFORM pg_temp.assert(public.billing_capture((o->>'id')::uuid,p)->'invoice'->>'id'=result->'invoice'->>'id','capture replay same invoice');
 RETURN (o->>'id')::uuid;
END $$;
INSERT INTO auth.users(id,email) VALUES('f0000000-0000-4000-8000-000000000001','empty@fixture.test');
UPDATE public.user_profiles SET status='active' WHERE user_id='f0000000-0000-4000-8000-000000000001';
-- First executable guard fails if the new RPC is absent.
SELECT pg_temp.assert(public.billing_plan_periods('{"userId":"f0000000-0000-4000-8000-000000000001","account":"acc_periods","mode":"test"}')='[]','empty owned schedule');
-- Real fulfilment, every paid->paid transition (including renewal).
DO $$ DECLARE buyer uuid; first_order uuid; next_order uuid; top_order uuid; per private.billing_plan_periods;
 plans text[]:=ARRAY['plus','pro','max']; qty numeric[]:=ARRAY[20000,65000,750000]; price bigint[]:=ARRAY[39900,99900,999900];
 i int; j int; before_balance numeric; top_remaining numeric; schedule jsonb; before_hash text; after_hash text;
BEGIN
 FOR i IN 1..3 LOOP FOR j IN 1..3 LOOP
  buyer:=gen_random_uuid(); INSERT INTO auth.users(id,email) VALUES(buyer,buyer||'@fixture.test'); UPDATE public.user_profiles SET status='active' WHERE user_id=buyer;
  first_order:=pg_temp.buy(buyer,plans[i],qty[i],price[i]);
  top_order:=pg_temp.buy(buyer,NULL,20000,49900);
  SELECT remaining INTO top_remaining FROM public.credit_lots WHERE billing_order_id=top_order;
  SELECT balance INTO before_balance FROM public.credit_wallets WHERE user_id=buyer;
  -- One fixture transaction freezes now(); model the prior purchase as an earlier transaction.
  UPDATE private.billing_plan_periods SET starts_at=now()-interval '1 second' WHERE order_id=first_order;
  next_order:=pg_temp.buy(buyer,plans[j],qty[j],price[j]);
  SELECT * INTO per FROM private.billing_plan_periods WHERE order_id=next_order;
  PERFORM pg_temp.assert(per.credits=qty[j],'exact new plan allowance '||plans[i]||'->'||plans[j]);
  IF j>i THEN
   PERFORM pg_temp.assert(per.state='active' AND per.starts_at<=now(),'upgrade starts now');
   PERFORM pg_temp.assert(public.billing_effective_profile(buyer)->>'plan'=plans[j],'upgrade model entitlement changes now');
   PERFORM pg_temp.assert((SELECT sum(remaining)=qty[j] FROM public.credit_lots WHERE user_id=buyer AND kind='monthly'),'upgrade replaces monthly balance without price-ratio conversion');
   PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM public.credit_lots WHERE user_id=buyer AND kind='rollover'),'upgrade has no rollover');
  ELSE
   PERFORM pg_temp.assert(per.state='scheduled' AND per.starts_at>now(),'renew/lower plan scheduled');
   PERFORM pg_temp.assert(public.billing_effective_profile(buyer)->>'plan'=plans[i],'queued purchase preserves current model entitlement');
   PERFORM pg_temp.assert((SELECT balance=before_balance FROM public.credit_wallets WHERE user_id=buyer),'future allowance not minted early');
   PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM public.credit_lots WHERE billing_plan_period_id=per.id),'no future credit lot yet');
  END IF;
  PERFORM pg_temp.assert((SELECT remaining=top_remaining AND expires_at=starts_at+interval '12 months' FROM public.credit_lots WHERE billing_order_id=top_order),'topups untouched by transition');
  SELECT md5(coalesce(string_agg(to_jsonb(l)::text,',' ORDER BY l.id),'')) INTO before_hash FROM public.credit_ledger l WHERE user_id=buyer;
  schedule:=public.billing_plan_periods(jsonb_build_object('userId',buyer,'account','acc_periods','mode','test'));
  PERFORM pg_temp.assert(jsonb_array_length(schedule)=CASE WHEN j>i THEN 1 ELSE 2 END,'canonical active and future only '||plans[i]||'->'||plans[j]||' got '||schedule::text);
  PERFORM pg_temp.assert(schedule->(jsonb_array_length(schedule)-1)->>'plan'=plans[j],'ordered last purchased period');
  PERFORM pg_temp.assert((schedule->(jsonb_array_length(schedule)-1)->>'credits')::numeric=qty[j],'schedule allowance from stored period');
  PERFORM pg_temp.assert(schedule->0->>'invoiceId' IS NOT NULL,'confirmed invoice linkage');
  PERFORM pg_temp.assert(public.billing_plan_periods(jsonb_build_object('userId',buyer,'account','other','mode','test'))='[]','merchant isolation');
  PERFORM pg_temp.assert(public.billing_plan_periods(jsonb_build_object('userId',buyer,'account','acc_periods','mode','live'))='[]','mode isolation');
  SELECT md5(coalesce(string_agg(to_jsonb(l)::text,',' ORDER BY l.id),'')) INTO after_hash FROM public.credit_ledger l WHERE user_id=buyer;
  PERFORM pg_temp.assert(before_hash=after_hash,'schedule read does not mint/expire/charge');
  IF j<=i THEN
   PERFORM private.credit_refresh(buyer,per.starts_at+interval '1 second');
   PERFORM pg_temp.assert((SELECT count(*)=1 AND min(granted)=qty[j] FROM public.credit_lots WHERE billing_plan_period_id=per.id AND kind='monthly'),'future allowance granted exactly at start');
   PERFORM pg_temp.assert((SELECT sum(granted)=qty[i]*0.10 FROM public.credit_lots WHERE user_id=buyer AND kind='rollover'),'10 percent rollover in unchanged credit units');
  END IF;
 END LOOP; END LOOP;
END $$;
-- Every topup pack on Free and all three paid plans: price is not a conversion rate.
DO $$ DECLARE buyer uuid; oid uuid; plan_name text; n int; before_balance numeric;
 packs numeric[]:=ARRAY[20000,50000,100000,200000,500000]; prices bigint[]:=ARRAY[49900,119900,229900,439900,1049900];
BEGIN
 FOREACH plan_name IN ARRAY ARRAY['free','plus','pro','max'] LOOP
  buyer:=gen_random_uuid(); INSERT INTO auth.users(id,email) VALUES(buyer,buyer||'@fixture.test'); UPDATE public.user_profiles SET status='active' WHERE user_id=buyer;
  IF plan_name<>'free' THEN PERFORM pg_temp.buy(buyer,plan_name,CASE plan_name WHEN 'plus' THEN 20000 WHEN 'pro' THEN 65000 ELSE 750000 END,CASE plan_name WHEN 'plus' THEN 39900 WHEN 'pro' THEN 99900 ELSE 999900 END); END IF;
  FOR n IN 1..5 LOOP
   PERFORM private.credit_refresh(buyer,now()); SELECT balance INTO before_balance FROM public.credit_wallets WHERE user_id=buyer;
   oid:=pg_temp.buy(buyer,NULL,packs[n],prices[n]);
   PERFORM pg_temp.assert((SELECT balance=before_balance+packs[n] FROM public.credit_wallets WHERE user_id=buyer),'fixed pack quantity on '||plan_name);
   PERFORM pg_temp.assert((SELECT granted=packs[n] AND remaining=packs[n] AND expires_at=starts_at+interval '12 months' FROM public.credit_lots WHERE billing_order_id=oid),'pack quantity and expiry');
   PERFORM pg_temp.assert(public.billing_effective_profile(buyer)->>'plan'=plan_name,'pack preserves model entitlement');
  END LOOP;
 END LOOP;
 PERFORM pg_temp.assert((private.credit_config()).inr_per_credit=0.01,'one paisa denomination on every plan');
END $$;
-- Only canonical fulfilled unexpired periods are displayed; raw attempts are never a paid schedule.
DO $$ DECLARE buyer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); oid uuid; args jsonb; BEGIN
 INSERT INTO auth.users(id,email) VALUES(buyer,buyer||'@fixture.test'),(outsider,outsider||'@fixture.test');
 UPDATE public.user_profiles SET status='active' WHERE user_id IN(buyer,outsider);
 oid:=pg_temp.buy(buyer,'plus',20000,39900);
 args:=jsonb_build_object('userId',buyer,'account','acc_periods','mode','test');
 PERFORM pg_temp.assert(public.billing_plan_periods(args||jsonb_build_object('userId',outsider))='[]','different buyer cannot see periods');
 UPDATE private.billing_plan_periods SET state='cancelled' WHERE order_id=oid;
 PERFORM pg_temp.assert(public.billing_plan_periods(args)='[]','cancelled period hidden');
 UPDATE private.billing_plan_periods SET state='active',starts_at=now()-interval '2 months',ends_at=now()-interval '1 month' WHERE order_id=oid;
 PERFORM pg_temp.assert(public.billing_plan_periods(args)='[]','expired period hidden even before stored state refresh');
 UPDATE private.billing_plan_periods SET starts_at=now(),ends_at=now()+interval '1 month' WHERE order_id=oid;
 UPDATE private.billing_orders SET state='review' WHERE id=oid;
 PERFORM pg_temp.assert(public.billing_plan_periods(args)='[]','unfulfilled review is not a paid schedule');
 UPDATE public.user_profiles SET status='inactive' WHERE user_id=buyer;
 BEGIN PERFORM public.billing_plan_periods(args); RAISE EXCEPTION 'FAIL: inactive read accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.assert(NOT has_function_privilege('anon','public.billing_plan_periods(jsonb)','EXECUTE'),'anonymous read denied');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','public.billing_plan_periods(jsonb)','EXECUTE'),'customer cannot choose another buyer');
SELECT pg_temp.assert(has_function_privilege('service_role','public.billing_plan_periods(jsonb)','EXECUTE'),'service read permitted');
ROLLBACK;
