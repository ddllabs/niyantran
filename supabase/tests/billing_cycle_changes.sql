-- Versioned cycle contract; omit billing_cycle_changes migration for vacuity.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
CREATE FUNCTION pg_temp.assert(ok boolean,why text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',why; END IF; END $$;
SELECT pg_temp.assert(to_regprocedure('public.billing_cycle(text,jsonb)') IS NOT NULL,'cycle contract absent');
CREATE FUNCTION pg_temp.buy_v2(buyer uuid,target text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE q jsonb; o jsonb; pay jsonb; result jsonb; ref text:=replace(gen_random_uuid()::text,'-',''); args jsonb;
BEGIN
 args:=jsonb_build_object('userId',buyer,'account','acc_cycle','mode','test','planId',target);
 q:=public.billing_cycle('quote',args);
 o:=public.billing_cycle('claim',args||jsonb_build_object('quoteId',q->>'quoteId','requestId',gen_random_uuid(),'requestHash',ref,'snapshot',jsonb_build_object('buyerEmail','fixture@example.test')));
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_'||ref,'amount',o->>'amount_paise','currency','INR','receipt',o->>'id')));
 pay:=jsonb_build_object('id','pay_'||ref,'order_id','order_'||ref,'amount',o->>'amount_paise','currency','INR','status','captured');
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',pay));
 result:=public.billing_cycle_capture((o->>'id')::uuid,pay);
 PERFORM pg_temp.assert(result->>'ok'='true','cycle purchase fulfilment: '||result::text);
 PERFORM pg_temp.assert((SELECT ends_at=(q->>'cycleEndsAt')::timestamptz FROM private.billing_plan_periods WHERE order_id=(o->>'id')::uuid),'reviewed cycle date survives capture');
 PERFORM pg_temp.assert(public.billing_cycle_capture((o->>'id')::uuid,pay)->'invoice'->>'id'=result->'invoice'->>'id','capture idempotent');
 RETURN (o->>'id')::uuid;
END $$;
DO $$ DECLARE buyer uuid:=gen_random_uuid(); oid uuid; q jsonb; b private.billing_plan_periods; args jsonb; bal numeric; first_lot uuid;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(buyer,'cycle@fixture.test'); UPDATE public.user_profiles SET status='active' WHERE user_id=buyer;
 args:=jsonb_build_object('userId',buyer,'account','acc_cycle','mode','test');
 oid:=pg_temp.buy_v2(buyer,'plus'); SELECT * INTO b FROM private.billing_plan_periods WHERE order_id=oid;
 UPDATE private.billing_plan_periods SET starts_at=now()-interval '15 days',ends_at=now()+interval '15 days',anchor_at=now()-interval '15 days' WHERE id=b.id;
 UPDATE public.user_profiles SET plan_period_end=now()+interval '15 days' WHERE user_id=buyer;
 UPDATE public.credit_lots SET starts_at=now()-interval '15 days',expires_at=now()+interval '15 days' WHERE billing_plan_period_id=b.id;
 SELECT id INTO first_lot FROM public.credit_lots WHERE billing_plan_period_id=b.id;
 SELECT balance INTO bal FROM public.credit_wallets WHERE user_id=buyer;
 q:=public.billing_cycle('quote',args||'{"planId":"pro"}');
 PERFORM pg_temp.assert((q->>'amountPaise')::bigint=30000 AND (q->>'credits')::numeric=22500,'halfway price and allowance difference');
 oid:=pg_temp.buy_v2(buyer,'pro');
 PERFORM pg_temp.assert((SELECT balance=bal+22500 FROM public.credit_wallets WHERE user_id=buyer),'only incremental credits');
 PERFORM pg_temp.assert((SELECT remaining=20000 AND closed_at IS NULL FROM public.credit_lots WHERE id=first_lot),'old credits retained');
 PERFORM pg_temp.assert((SELECT ends_at=now()+interval '15 days' AND credits=42500 AND plan='pro' FROM private.billing_plan_periods WHERE order_id=oid),'cycle preserved cumulative allowance');
 PERFORM pg_temp.assert(public.entitlement_from((SELECT p FROM public.user_profiles p WHERE user_id=buyer))->>'plan'='pro','immediate access');
 SELECT balance INTO bal FROM public.credit_wallets WHERE user_id=buyer;
 PERFORM public.billing_cycle('schedule',args||'{"planId":"plus"}');
 PERFORM public.billing_cycle('schedule',args||'{"planId":"free"}');
 PERFORM pg_temp.assert((SELECT count(*)=1 FROM private.billing_plan_changes WHERE user_id=buyer AND state='pending'),'only one next instruction');
 PERFORM pg_temp.assert((SELECT balance=bal FROM public.credit_wallets WHERE user_id=buyer),'schedule no wallet change');
 PERFORM pg_temp.assert((SELECT count(*)=2 FROM private.billing_orders WHERE user_id=buyer),'schedule no order');
 PERFORM pg_temp.assert((SELECT count(*)=2 FROM public.invoices WHERE user_id=buyer),'schedule no invoice');
 PERFORM public.billing_cycle('cancel',args);
 PERFORM pg_temp.assert(public.billing_cycle('state',args)->'scheduled'='null','cancel schedule');
 BEGIN PERFORM public.billing_cycle('quote',args||'{"planId":"pro"}'); RAISE EXCEPTION 'FAIL: early renewal accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- Every upgrade pair and three date positions, with existing usage/topups.
DO $$ DECLARE buyer uuid; oid uuid; args jsonb; q jsonb; before_balance numeric; cycle uuid; entry uuid; l uuid; r numeric;
 plans text[]:=ARRAY['plus','pro','max']; prices bigint[]:=ARRAY[39900,99900,999900]; amounts numeric[]:=ARRAY[20000,65000,750000];
 i int; j int; elapsed int; expected numeric; counts int;
BEGIN
 FOR i IN 1..2 LOOP FOR j IN i+1..3 LOOP FOREACH elapsed IN ARRAY ARRAY[0,4,24] LOOP
  buyer:=gen_random_uuid(); INSERT INTO auth.users(id,email) VALUES(buyer,buyer||'@fixture.test'); UPDATE public.user_profiles SET status='active' WHERE user_id=buyer;
  args:=jsonb_build_object('userId',buyer,'account','acc_cycle','mode','test'); oid:=pg_temp.buy_v2(buyer,plans[i]);
  SELECT id INTO cycle FROM private.billing_plan_periods WHERE order_id=oid;
  UPDATE private.billing_plan_periods SET starts_at=now()-make_interval(days=>elapsed),ends_at=now()+make_interval(days=>30-elapsed),anchor_at=now()-make_interval(days=>elapsed) WHERE id=cycle;
  UPDATE public.user_profiles SET plan_period_end=now()+make_interval(days=>30-elapsed) WHERE user_id=buyer;
  UPDATE public.credit_lots SET starts_at=now()-make_interval(days=>elapsed),expires_at=now()+make_interval(days=>30-elapsed) WHERE billing_plan_period_id=cycle;
  -- Charge a real lot, preserving consumption across upgrades.
  entry:=private.credit_entry(buyer,'charge',-5000,NULL,'fixture-turn',NULL,95,0.01,NULL,NULL);
  PERFORM private.credit_draw(buyer,5000,entry,'charge',now());
  l:=private.credit_mint(buyer,'topup',20000,now(),now()+interval '12 months','fixture-topup',NULL,'grant',NULL,NULL,NULL);
  SELECT balance INTO before_balance FROM public.credit_wallets WHERE user_id=buyer;
  q:=public.billing_cycle('quote',args||jsonb_build_object('planId',plans[j])); r:=(30-elapsed)::numeric/30;
  PERFORM pg_temp.assert((q->>'amountPaise')::bigint=round((prices[j]-prices[i])*r),'price pair/date');
  expected:=round((amounts[j]-amounts[i])*r,4);
  PERFORM pg_temp.assert((q->>'credits')::numeric=expected,'credit pair/date');
  oid:=pg_temp.buy_v2(buyer,plans[j]);
  PERFORM pg_temp.assert((SELECT balance=before_balance+expected FROM public.credit_wallets WHERE user_id=buyer),'usage retained incremental grant');
  PERFORM pg_temp.assert((SELECT remaining=20000 AND expires_at=now()+interval '12 months' FROM public.credit_lots WHERE id=l),'topup untouched');
  PERFORM pg_temp.assert((SELECT count(*)=1 FROM private.billing_plan_periods WHERE user_id=buyer AND state='active'),'one active revision');
  PERFORM set_config('request.jwt.claim.sub',buyer::text,true);
  PERFORM pg_temp.assert((public.my_credits_cycle()->'cycle'->>'allowance')::numeric=amounts[i]+expected,'cycle display cumulative allowance');
  SELECT sum(round(remaining*0.1,4)) INTO expected FROM public.credit_lots WHERE user_id=buyer AND kind='monthly' AND closed_at IS NULL;
  PERFORM private.credit_refresh(buyer,now()+make_interval(days=>30-elapsed)+interval '1 second');
  PERFORM pg_temp.assert((SELECT sum(granted)=expected FROM public.credit_lots WHERE user_id=buyer AND kind='rollover'),'natural 10 percent across revisions');
 END LOOP; END LOOP; END LOOP;
END $$;
-- Manual lower-plan renewal only when due; one future purchase; no free activation.
DO $$ DECLARE buyer uuid:=gen_random_uuid(); oid uuid; args jsonb; q jsonb; cycle uuid; balance_before numeric;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(buyer,'renew@fixture.test'); UPDATE public.user_profiles SET status='active' WHERE user_id=buyer;
 args:=jsonb_build_object('userId',buyer,'account','acc_cycle','mode','test'); oid:=pg_temp.buy_v2(buyer,'max');
 SELECT id INTO cycle FROM private.billing_plan_periods WHERE order_id=oid;
 UPDATE private.billing_plan_periods SET starts_at=now()-interval '25 days',ends_at=now()+interval '5 days',anchor_at=now()-interval '25 days' WHERE id=cycle;
 UPDATE public.credit_lots SET starts_at=now()-interval '25 days',expires_at=now()+interval '5 days' WHERE billing_plan_period_id=cycle;
 UPDATE public.user_profiles SET plan_period_end=now()+interval '5 days' WHERE user_id=buyer;
 PERFORM public.billing_cycle('schedule',args||'{"planId":"plus"}');
 SELECT balance INTO balance_before FROM public.credit_wallets WHERE user_id=buyer;
 q:=public.billing_cycle('quote',args||'{"planId":"plus","intent":"renew"}');
 PERFORM pg_temp.assert((q->>'amountPaise')::bigint=39900 AND q->>'action'='renew','lower next month full fee only on manual purchase');
 oid:=pg_temp.buy_v2(buyer,'plus');
 PERFORM pg_temp.assert((SELECT state='scheduled' AND starts_at=now()+interval '5 days' FROM private.billing_plan_periods WHERE order_id=oid),'paid next month scheduled once');
 PERFORM pg_temp.assert((SELECT balance=balance_before FROM public.credit_wallets WHERE user_id=buyer),'no future credits early');
 BEGIN PERFORM public.billing_cycle('quote',args||'{"planId":"plus"}'); RAISE EXCEPTION 'FAIL: stacked future purchase'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM public.billing_cycle('schedule',args||'{"planId":"free"}'); RAISE EXCEPTION 'FAIL: silently replace paid future period'; EXCEPTION WHEN check_violation THEN NULL; END;
 -- Separate unpaid selection cannot change effective plan at expiry.
 UPDATE private.billing_plan_periods SET state='cancelled' WHERE order_id=oid;
 UPDATE private.billing_plan_periods SET starts_at=now()-interval '31 days',ends_at=now()-interval '1 day' WHERE id=cycle;
 UPDATE public.user_profiles SET plan_period_end=now()-interval '1 day' WHERE user_id=buyer;
 PERFORM pg_temp.assert(public.entitlement_from((SELECT p FROM public.user_profiles p WHERE user_id=buyer))->>'plan'='free','no unpaid activation');
END $$;
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','public.billing_cycle(text,jsonb)','execute'),'no client arbitrary buyer access');
SELECT pg_temp.assert(NOT has_function_privilege('anon','public.billing_cycle_capture(uuid,jsonb)','execute'),'no anon capture');
SELECT pg_temp.assert((private.credit_config()).rollover_pct=10,'rollover unchanged');
-- Quote ownership, expiry, captured stale quotes and repeated upgrades.
DO $$ DECLARE buyer uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); args jsonb; q jsonb; o jsonb; pay jsonb; oid uuid; b uuid; result jsonb; before_balance numeric;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(buyer,'stale@fixture.test'),(other,'other@fixture.test'); UPDATE public.user_profiles SET status='active' WHERE user_id IN(buyer,other);
 args:=jsonb_build_object('userId',buyer,'account','acc_cycle','mode','test');
 oid:=pg_temp.buy_v2(buyer,'plus'); SELECT id INTO b FROM private.billing_plan_periods WHERE order_id=oid;
 UPDATE private.billing_plan_periods SET starts_at=now()-interval '15 days',ends_at=now()+interval '15 days',anchor_at=now()-interval '15 days' WHERE id=b;
 UPDATE public.user_profiles SET plan_period_end=now()+interval '15 days' WHERE user_id=buyer;
 UPDATE public.credit_lots SET starts_at=now()-interval '15 days',expires_at=now()+interval '15 days' WHERE billing_plan_period_id=b;
 q:=public.billing_cycle('quote',args||'{"planId":"pro"}');
 BEGIN PERFORM public.billing_cycle('claim',args||jsonb_build_object('userId',other,'planId','pro','quoteId',q->>'quoteId','requestId',gen_random_uuid(),'requestHash','foreign')); RAISE EXCEPTION 'FAIL: foreign quote'; EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE private.billing_plan_quotes SET expires_at=now()-interval '1 second' WHERE id=(q->>'quoteId')::uuid;
 BEGIN PERFORM public.billing_cycle('claim',args||jsonb_build_object('planId','pro','quoteId',q->>'quoteId','requestId',gen_random_uuid(),'requestHash','expired')); RAISE EXCEPTION 'FAIL: expired quote'; EXCEPTION WHEN check_violation THEN NULL; END;
 q:=public.billing_cycle('quote',args||'{"planId":"pro"}');
 o:=public.billing_cycle('claim',args||jsonb_build_object('planId','pro','quoteId',q->>'quoteId','requestId',gen_random_uuid(),'requestHash','late-capture'));
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_late','amount',o->>'amount_paise','currency','INR','receipt',o->>'id')));
 pay:=jsonb_build_object('id','pay_late','order_id','order_late','amount',o->>'amount_paise','currency','INR','status','captured');
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',pay));
 UPDATE private.billing_orders SET snapshot=jsonb_set(snapshot,'{expiresAt}',to_jsonb(now()-interval '1 second')) WHERE id=(o->>'id')::uuid;
 SELECT balance INTO before_balance FROM public.credit_wallets WHERE user_id=buyer;
 result:=public.billing_cycle_capture((o->>'id')::uuid,pay);
 PERFORM pg_temp.assert(result->>'status'='review','late capture reviewed not granted');
 PERFORM pg_temp.assert((SELECT balance=before_balance FROM public.credit_wallets WHERE user_id=buyer),'late capture no grant');
 oid:=pg_temp.buy_v2(buyer,'pro'); oid:=pg_temp.buy_v2(buyer,'max');
 PERFORM pg_temp.assert((SELECT amount_paise=450000 FROM private.billing_orders WHERE id=oid),'second upgrade prices only Pro to Max remaining half');
 PERFORM pg_temp.assert((SELECT balance=before_balance+22500+342500 FROM public.credit_wallets WHERE user_id=buyer),'repeated upgrade increments only');
 BEGIN PERFORM public.billing_cycle('quote',args||'{"planId":"plus","mode":"live"}'); RAISE EXCEPTION 'FAIL: Live cycle contract'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- Named-account reset logic rehearsed with synthetic financial records only.
DO $$ DECLARE uid uuid:='f0000000-0000-4000-8000-000000000099'; BEGIN
 INSERT INTO auth.users(id,email) VALUES(uid,'cleanup@fixture.test'); UPDATE public.user_profiles SET status='active' WHERE user_id=uid;
 PERFORM pg_temp.buy_v2(uid,'plus');
 PERFORM set_config('billing.cleanup_user',uid::text,true);
 PERFORM set_config('billing.cleanup_orders','1',true);
END $$;

DO $cleanup$
DECLARE uid uuid:=current_setting('billing.cleanup_user')::uuid; expected_orders int:=current_setting('billing.cleanup_orders')::int;
 before_balance numeric; removed numeric; kept numeric; n int;
BEGIN
 PERFORM 1 FROM public.user_profiles WHERE user_id=uid FOR UPDATE;
 PERFORM 1 FROM public.credit_wallets WHERE user_id=uid FOR UPDATE;
 IF EXISTS(SELECT FROM private.billing_orders WHERE user_id=uid AND mode<>'test') THEN RAISE EXCEPTION 'Live purchase present; stop'; END IF;
 IF EXISTS(SELECT FROM public.credit_holds WHERE user_id=uid AND settled_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'Answer still running; stop'; END IF;
 CREATE TEMP TABLE cleanup_orders ON COMMIT DROP AS SELECT id,provider_order_id FROM private.billing_orders WHERE user_id=uid AND mode='test';
 IF (SELECT count(*) FROM cleanup_orders)<>expected_orders THEN RAISE EXCEPTION 'Order inventory changed; stop'; END IF;
 CREATE TEMP TABLE cleanup_lots ON COMMIT DROP AS SELECT id FROM public.credit_lots WHERE user_id=uid AND billing_order_id IN(SELECT id FROM cleanup_orders);
 IF EXISTS(SELECT FROM public.credit_lot_draws WHERE lot_id IN(SELECT id FROM cleanup_lots)) THEN RAISE EXCEPTION 'Purchase credits have been drawn; review before reset'; END IF;
 SELECT balance INTO before_balance FROM public.credit_wallets WHERE user_id=uid;
 SELECT coalesce(sum(credits),0) INTO removed FROM public.credit_ledger WHERE user_id=uid AND (billing_order_id IN(SELECT id FROM cleanup_orders) OR lot_id IN(SELECT id FROM cleanup_lots));
 SELECT coalesce(sum(remaining),0) INTO kept FROM public.credit_lots WHERE user_id=uid AND closed_at IS NULL AND id NOT IN(SELECT id FROM cleanup_lots);
 IF before_balance-removed<>kept THEN RAISE EXCEPTION 'Wallet removal does not reconcile'; END IF;
 DELETE FROM private.billing_plan_quotes WHERE user_id=uid AND mode='test';
 DELETE FROM private.billing_plan_changes WHERE user_id=uid AND mode='test';
 DELETE FROM private.billing_events WHERE mode='test' AND (payload->'payment'->'entity'->>'order_id' IN(SELECT provider_order_id FROM cleanup_orders) OR payload->'order'->'entity'->>'id' IN(SELECT provider_order_id FROM cleanup_orders));
 DELETE FROM private.billing_adjustments WHERE payment_id IN(SELECT id FROM private.billing_payments WHERE order_id IN(SELECT id FROM cleanup_orders));
 DELETE FROM public.credit_ledger WHERE user_id=uid AND (billing_order_id IN(SELECT id FROM cleanup_orders) OR lot_id IN(SELECT id FROM cleanup_lots));
 DELETE FROM public.credit_lots WHERE id IN(SELECT id FROM cleanup_lots);
 DELETE FROM public.plan_grants WHERE user_id=uid AND (billing_plan_period_id IN(SELECT id FROM private.billing_plan_periods WHERE order_id IN(SELECT id FROM cleanup_orders)) OR payment_id IN(SELECT provider_payment_id FROM private.billing_payments WHERE order_id IN(SELECT id FROM cleanup_orders)));
 UPDATE public.user_profiles SET active_billing_plan_period_id=NULL,plan='free',plan_status='free',plan_source='manual',plan_period_end=NULL WHERE user_id=uid;
 DELETE FROM private.billing_plan_periods WHERE user_id=uid AND order_id IN(SELECT id FROM cleanup_orders);
 DELETE FROM public.invoices WHERE user_id=uid AND billing_order_id IN(SELECT id FROM cleanup_orders);
 UPDATE private.billing_orders SET fulfilled_payment_id=NULL WHERE id IN(SELECT id FROM cleanup_orders);
 DELETE FROM private.billing_payments WHERE order_id IN(SELECT id FROM cleanup_orders);
 DELETE FROM private.billing_orders WHERE user_id=uid AND id IN(SELECT id FROM cleanup_orders);
 UPDATE public.credit_wallets SET balance=before_balance-removed,updated_at=now() WHERE user_id=uid;
 -- A free manual grant prevents legacy paid grants from ever reactivating.
 INSERT INTO public.plan_grants(user_id,plan,status,source) VALUES(uid,'free','free','manual');
 IF EXISTS(SELECT FROM private.billing_orders WHERE user_id=uid) THEN RAISE EXCEPTION 'Orders remain'; END IF;
 IF (SELECT balance FROM public.credit_wallets WHERE user_id=uid)<>kept THEN RAISE EXCEPTION 'Unexpected wallet change'; END IF;
 IF (SELECT coalesce(sum(credits),0) FROM public.credit_ledger WHERE user_id=uid)<>kept THEN RAISE EXCEPTION 'Ledger does not reconcile'; END IF;
 IF (SELECT count(*) FROM public.invoices WHERE user_id=uid AND billing_order_id IN(SELECT id FROM cleanup_orders))<>0 THEN RAISE EXCEPTION 'Invoices remain'; END IF;
END $cleanup$;

SELECT pg_temp.assert((SELECT plan='free' FROM public.user_profiles WHERE user_id='f0000000-0000-4000-8000-000000000099'),'cleanup leaves Free');
ROLLBACK;
