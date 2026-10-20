-- Latest no-rollover chain; omission must fail without billing_live_cycle.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert(ok boolean,why text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',why; END IF; END $$;
SELECT pg_temp.assert(to_regprocedure('public.billing_cycle_v2(text,jsonb)') IS NOT NULL,'mode-aware cycle contract absent');
SELECT pg_temp.assert(to_regprocedure('public.billing_cycle_capture_v2(uuid,jsonb,jsonb)') IS NOT NULL,'mode-aware capture absent');
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
CREATE FUNCTION pg_temp.buy(buyer uuid,target text,mode_name text,intent text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE args jsonb:=jsonb_build_object('userId',buyer,'account','acc_modes','mode',mode_name,'planId',target,'intent',intent);
 q jsonb; o jsonb; pay jsonb; result jsonb; ref text:=replace(gen_random_uuid()::text,'-','');
BEGIN
 q:=public.billing_cycle_v2('quote',args);
 PERFORM pg_temp.assert(q->>'contract'='cycle-v2','new immutable version');
 o:=public.billing_cycle_v2('claim',args||jsonb_build_object('quoteId',q->>'quoteId','requestId',gen_random_uuid(),'requestHash',ref,'snapshot',jsonb_build_object('buyerEmail','modes@fixture.test')));
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_'||ref,'amount',o->>'amount_paise','currency','INR','receipt',o->>'id')));
 pay:=jsonb_build_object('id','pay_'||ref,'order_id','order_'||ref,'amount',o->>'amount_paise','currency','INR','status','captured');
 -- An authorization is recorded but cannot mint credits or invoice.
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',pay||'{"status":"authorized"}'));
 result:=public.billing_cycle_capture_v2((o->>'id')::uuid,pay||'{"status":"authorized"}',jsonb_build_object('account','acc_modes','mode',mode_name));
 PERFORM pg_temp.assert(result->>'pending'='true' AND NOT EXISTS(SELECT FROM public.invoices WHERE billing_order_id=(o->>'id')::uuid),'authorization remains unfulfilled');
 BEGIN
  PERFORM public.billing_cycle_capture_v2((o->>'id')::uuid,pay||jsonb_build_object('amount',(pay->>'amount')::bigint+1),jsonb_build_object('account','acc_modes','mode',mode_name));
  RAISE EXCEPTION 'FAIL: capture amount mismatch';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',pay));
 result:=public.billing_cycle_capture_v2((o->>'id')::uuid,pay,jsonb_build_object('account','acc_modes','mode',mode_name));
 PERFORM pg_temp.assert(result->>'ok'='true','captured v2 purchase: '||result::text);
 PERFORM pg_temp.assert(public.billing_cycle_capture_v2((o->>'id')::uuid,pay,jsonb_build_object('account','acc_modes','mode',mode_name))->'invoice'->>'id'=result->'invoice'->>'id','duplicate capture keeps invoice');
 RETURN (o->>'id')::uuid;
END $$;
-- Identical Test/Live monetary behavior through the real quote/claim/capture engine.
DO $$ DECLARE mode_name text; uid uuid; oid uuid; args jsonb; q jsonb; bal numeric; old_end timestamptz; next_period uuid; n int;
BEGIN
 FOREACH mode_name IN ARRAY ARRAY['test','live'] LOOP
  uid:=gen_random_uuid(); INSERT INTO auth.users(id,email) VALUES(uid,mode_name||'@fixture.test'); UPDATE public.user_profiles SET status='active' WHERE user_id=uid;
  args:=jsonb_build_object('userId',uid,'account','acc_modes','mode',mode_name);
  oid:=pg_temp.buy(uid,'plus',mode_name);
  PERFORM pg_temp.assert((SELECT amount_paise=39900 AND mode=mode_name FROM private.billing_orders WHERE id=oid),'Plus initial price and mode');
  SELECT ends_at INTO old_end FROM private.billing_plan_periods WHERE order_id=oid;
  q:=public.billing_cycle_v2('quote',args||'{"planId":"pro"}');
  PERFORM pg_temp.assert((q->>'amountPaise')::bigint=60000 AND (q->>'credits')::numeric=45000 AND q->>'prorationBasis'='ist-calendar-day-v1','same-day price and credit delta');
  oid:=pg_temp.buy(uid,'pro',mode_name);
  PERFORM pg_temp.assert((SELECT ends_at=old_end AND credits=65000 FROM private.billing_plan_periods WHERE order_id=oid),'upgrade keeps original cycle');
  PERFORM pg_temp.assert((SELECT sum(granted)=65000 FROM public.credit_lots WHERE user_id=uid AND kind='monthly'),'no duplicate full allowance');
  -- Top-ups remain untouched by plan preferences and monthly expiry.
  PERFORM private.credit_mint(uid,'topup',20000,now(),now()+interval '12 months','fixture-topup-'||uid,NULL,'grant',NULL,NULL,NULL);
  SELECT balance INTO bal FROM public.credit_wallets WHERE user_id=uid;
  SELECT count(*) INTO n FROM private.billing_orders WHERE user_id=uid;
  PERFORM public.billing_cycle_v2('schedule',args||'{"planId":"plus"}');
  PERFORM public.billing_cycle_v2('schedule',args||'{"planId":"free"}');
  PERFORM pg_temp.assert((SELECT count(*)=1 FROM private.billing_plan_changes WHERE user_id=uid AND state='pending' AND plan='free'),'one replaceable unpaid preference');
  PERFORM pg_temp.assert((SELECT balance=bal FROM public.credit_wallets WHERE user_id=uid) AND (SELECT count(*)=n FROM private.billing_orders WHERE user_id=uid),'schedule has no charge or credit mutation');
  PERFORM public.billing_cycle_v2('cancel',args);
  PERFORM pg_temp.assert(public.billing_cycle_v2('state',args)->'scheduled'='null','schedule cancellation');
  BEGIN PERFORM public.billing_cycle_v2('quote',args||'{"planId":"pro","intent":"renew"}'); RAISE EXCEPTION 'FAIL: early renewal'; EXCEPTION WHEN check_violation THEN NULL; END;
  -- Synthetic dates only: bring the real purchased period into renewal window.
  UPDATE private.billing_plan_periods SET starts_at=now()-interval '25 days',ends_at=now()+interval '5 days',anchor_at=now()-interval '25 days' WHERE order_id=oid;
  UPDATE public.user_profiles SET plan_period_end=now()+interval '5 days' WHERE user_id=uid;
  PERFORM public.billing_cycle_v2('schedule',args||'{"planId":"plus"}');
  oid:=pg_temp.buy(uid,'plus',mode_name,'renew');
  SELECT id INTO next_period FROM private.billing_plan_periods WHERE order_id=oid;
  PERFORM pg_temp.assert((SELECT state='scheduled' AND starts_at>now() FROM private.billing_plan_periods WHERE id=next_period),'manual lower renewal is future coverage');
  PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM public.credit_lots WHERE billing_order_id=oid),'future renewal grants no early credits');
  PERFORM pg_temp.assert((SELECT balance=bal FROM public.credit_wallets WHERE user_id=uid),'future renewal leaves wallet unchanged');
  -- Move the original natural expiry into the past, keep paid future coverage future.
  UPDATE private.billing_plan_periods SET starts_at=now()-interval '1 month',ends_at=now()-interval '1 second' WHERE user_id=uid AND state='active';
  UPDATE public.credit_lots SET starts_at=now()-interval '1 month',expires_at=now()-interval '1 second' WHERE user_id=uid AND kind='monthly';
  PERFORM private.credit_refresh(uid,now());
  PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM public.credit_lots WHERE user_id=uid AND kind='rollover'),'natural expiry creates no rollover');
  PERFORM pg_temp.assert((SELECT remaining=20000 AND closed_at IS NULL FROM public.credit_lots WHERE user_id=uid AND kind='topup'),'topup survives expiry');
  PERFORM pg_temp.assert((SELECT balance=20000 AND debt=0 FROM public.credit_wallets WHERE user_id=uid),'expired monthly wallet reconciles');
  UPDATE public.user_profiles SET plan_period_end=now()-interval '1 second' WHERE user_id=uid;
  PERFORM pg_temp.assert((SELECT public.entitlement_from(p)->>'plan'='free' FROM public.user_profiles p WHERE user_id=uid),'unpaid gap returns to Free');
  -- The already paid renewal becomes eligible exactly at its own start.
  UPDATE private.billing_plan_periods SET starts_at=now()-interval '1 second',ends_at=now()+interval '1 month' WHERE id=next_period;
  PERFORM private.credit_refresh(uid,now());
  PERFORM private.credit_refresh(uid,now());
  PERFORM pg_temp.assert((SELECT public.entitlement_from(p)->>'plan'='plus' FROM public.user_profiles p WHERE user_id=uid),'paid lower renewal activates when eligible');
  PERFORM pg_temp.assert((SELECT count(*)=1 AND sum(granted)=20000 FROM public.credit_lots WHERE billing_order_id=oid),'renewal allowance minted once');
  PERFORM pg_temp.assert((SELECT balance=40000 AND debt=0 FROM public.credit_wallets WHERE user_id=uid),'renewal and topup balance conserve');
 END LOOP;
END $$;
-- All paid upgrade pairs retain exact day-based price/credit deltas in both modes.
DO $$ DECLARE mode_name text; uid uuid; plans text[]:=ARRAY['plus','pro','max']; i int; j int; elapsed int;
 oid uuid; q jsonb; args jsonb; fraction numeric; base_qty numeric; delta numeric; expected_price bigint;
BEGIN
 FOREACH mode_name IN ARRAY ARRAY['test','live'] LOOP
  FOR i IN 1..2 LOOP FOR j IN i+1..3 LOOP FOREACH elapsed IN ARRAY ARRAY[5,25] LOOP
   uid:=gen_random_uuid(); INSERT INTO auth.users(id,email) VALUES(uid,'matrix-'||uid||'@fixture.test'); UPDATE public.user_profiles SET status='active' WHERE user_id=uid;
   oid:=pg_temp.buy(uid,plans[i],mode_name);
   UPDATE private.billing_plan_periods SET starts_at=now()-make_interval(days=>elapsed),ends_at=now()+make_interval(days=>30-elapsed),anchor_at=now()-make_interval(days=>elapsed) WHERE order_id=oid;
   UPDATE public.user_profiles SET plan_period_end=now()+make_interval(days=>30-elapsed) WHERE user_id=uid;
   UPDATE public.credit_lots SET starts_at=now()-make_interval(days=>elapsed),expires_at=now()+make_interval(days=>30-elapsed) WHERE billing_order_id=oid;
   args:=jsonb_build_object('userId',uid,'account','acc_modes','mode',mode_name,'planId',plans[j]);
   q:=public.billing_cycle_v2('quote',args); fraction:=(30-elapsed)::numeric/30;
   SELECT monthly_credits INTO base_qty FROM public.credit_plan_allowances WHERE plan::text=plans[i];
   SELECT round((monthly_credits-base_qty)*fraction,4) INTO delta FROM public.credit_plan_allowances WHERE plan::text=plans[j];
   expected_price:=round((private.billing_cycle_price(plans[j])-private.billing_cycle_price(plans[i]))*fraction);
   PERFORM pg_temp.assert((q->>'amountPaise')::bigint=expected_price AND (q->>'credits')::numeric=delta,'every plan pair uses matching daily price/credit fraction');
   oid:=pg_temp.buy(uid,plans[j],mode_name);
   PERFORM pg_temp.assert((SELECT credits=base_qty+delta FROM private.billing_plan_periods WHERE order_id=oid),'only incremental monthly credits granted');
   PERFORM pg_temp.assert((SELECT sum(granted)=base_qty+delta FROM public.credit_lots WHERE user_id=uid AND kind='monthly'),'monthly lot conservation after upgrade');
   PERFORM pg_temp.assert((SELECT count(*)=2 FROM public.invoices WHERE user_id=uid),'one invoice per captured purchase');
  END LOOP; END LOOP; END LOOP;
 END LOOP;
END $$;
-- No quote or preference can cross buyer, merchant or mode boundaries.
DO $$ DECLARE uid uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); args jsonb; q jsonb; oid uuid; o private.billing_orders; pay jsonb; result jsonb;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(uid,'binding@fixture.test'),(other,'foreign@fixture.test'); UPDATE public.user_profiles SET status='active' WHERE user_id IN(uid,other);
 args:=jsonb_build_object('userId',uid,'account','acc_modes','mode','live','planId','plus');
 q:=public.billing_cycle_v2('quote',args);
 BEGIN PERFORM public.billing_cycle_v2('claim',args||jsonb_build_object('quoteId',q->>'quoteId','requestId',gen_random_uuid(),'requestHash','wrong-mode','mode','test')); RAISE EXCEPTION 'FAIL: cross-mode quote claim'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM public.billing_cycle_v2('claim',args||jsonb_build_object('quoteId',q->>'quoteId','requestId',gen_random_uuid(),'requestHash','wrong-owner','userId',other)); RAISE EXCEPTION 'FAIL: cross-owner quote claim'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM public.billing_cycle_v2('claim',args||jsonb_build_object('quoteId',q->>'quoteId','requestId',gen_random_uuid(),'requestHash','wrong-account','account','foreign')); RAISE EXCEPTION 'FAIL: cross-merchant quote claim'; EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE private.billing_plan_quotes SET expires_at=now()-interval '1 second' WHERE id=(q->>'quoteId')::uuid;
 BEGIN PERFORM public.billing_cycle_v2('claim',args||jsonb_build_object('quoteId',q->>'quoteId','requestId',gen_random_uuid(),'requestHash','expired')); RAISE EXCEPTION 'FAIL: expired claim'; EXCEPTION WHEN check_violation THEN NULL; END;
 oid:=pg_temp.buy(uid,'plus','live');
 BEGIN PERFORM public.billing_cycle_v2('schedule',args||'{"planId":"free","mode":"test"}'); RAISE EXCEPTION 'FAIL: foreign active cycle'; EXCEPTION WHEN check_violation THEN NULL; END;
 SELECT * INTO o FROM private.billing_orders WHERE id=oid;
 SELECT jsonb_build_object('id',provider_payment_id,'order_id',o.provider_order_id,'amount',o.amount_paise,'currency','INR','status','captured') INTO pay FROM private.billing_payments WHERE order_id=oid;
 BEGIN PERFORM public.billing_cycle_capture_v2(oid,pay,'{"account":"acc_modes","mode":"test"}'); RAISE EXCEPTION 'FAIL: cross-mode capture replay'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.billing_cycle_capture_v2(oid,pay,'{"account":"foreign","mode":"live"}'); RAISE EXCEPTION 'FAIL: cross-merchant capture replay'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.billing_cycle_v2('quote',args||'{"mode":"invalid"}'); RAISE EXCEPTION 'FAIL: invalid mode'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 result:=public.my_credits_cycle_v2();
 PERFORM pg_temp.assert((result->'cycle'->>'allowance')::numeric=20000,'v2 own allowance display');
 PERFORM set_config('request.jwt.claim.sub',other::text,true);
 result:=public.my_credits_cycle_v2();
 PERFORM pg_temp.assert((result->'cycle'->>'allowance')::numeric IS DISTINCT FROM 20000,'cannot read foreign allowance');
END $$;
-- Captured funds after an expired quote stay in reviewed resolution, never a new grant.
DO $$ DECLARE uid uuid:=gen_random_uuid(); args jsonb; q jsonb; o jsonb; pay jsonb; result jsonb;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(uid,'late-live@fixture.test'); UPDATE public.user_profiles SET status='active' WHERE user_id=uid;
 args:=jsonb_build_object('userId',uid,'account','acc_modes','mode','live','planId','plus');
 q:=public.billing_cycle_v2('quote',args);
 o:=public.billing_cycle_v2('claim',args||jsonb_build_object('quoteId',q->>'quoteId','requestId',gen_random_uuid(),'requestHash','late-live','snapshot',jsonb_build_object('buyerEmail','late-live@fixture.test')));
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_lateLive','amount',o->>'amount_paise','currency','INR','receipt',o->>'id')));
 pay:=jsonb_build_object('id','pay_lateLive','order_id','order_lateLive','amount',o->>'amount_paise','currency','INR','status','captured');
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',pay));
 UPDATE private.billing_orders SET snapshot=jsonb_set(snapshot,'{expiresAt}',to_jsonb(now()-interval '1 second')) WHERE id=(o->>'id')::uuid;
 result:=public.billing_cycle_capture_v2((o->>'id')::uuid,pay,'{"account":"acc_modes","mode":"live"}');
 PERFORM pg_temp.assert(result->>'status'='review','expired capture requires review');
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM public.invoices WHERE billing_order_id=(o->>'id')::uuid) AND NOT EXISTS(SELECT FROM public.credit_lots WHERE billing_order_id=(o->>'id')::uuid),'late capture has no financial benefit');
 BEGIN PERFORM public.billing_cycle_daily('quote',args); RAISE EXCEPTION 'FAIL: legacy Test guard removed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.assert((private.credit_config()).rollover_pct=0,'rollover stays zero');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','public.billing_cycle_v2(text,jsonb)','execute') AND NOT has_function_privilege('anon','public.billing_cycle_capture_v2(uuid,jsonb,jsonb)','execute'),'financial RPCs not public');
SELECT pg_temp.assert(has_function_privilege('service_role','public.billing_cycle_v2(text,jsonb)','execute') AND has_function_privilege('service_role','public.billing_cycle_capture_v2(uuid,jsonb,jsonb)','execute'),'service-only writers');
SELECT pg_temp.assert(has_function_privilege('authenticated','public.my_credits_cycle_v2()','execute') AND NOT has_function_privilege('anon','public.my_credits_cycle_v2()','execute'),'authenticated own-credit read');
SELECT pg_temp.assert(NOT has_table_privilege('authenticated','private.billing_plan_quotes','select') AND NOT has_table_privilege('service_role','private.billing_plan_changes','insert'),'private storage remains inaccessible');
ROLLBACK;
