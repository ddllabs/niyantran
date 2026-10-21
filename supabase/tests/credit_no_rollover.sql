-- Latest billing chain; omission must reproduce unwanted rollover creation.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
CREATE FUNCTION pg_temp.assert(ok boolean,why text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',why; END IF; END $$;
-- Deliberately test behavior before checking configuration: omission fails on a
-- real grant, rather than just on a missing marker or a changed setting.
DO $$ DECLARE uid uuid:=gen_random_uuid(); l uuid; topup uuid; entry uuid; bal numeric; n int; expiry timestamptz:=now()-interval '1 second'; BEGIN
 INSERT INTO auth.users(id,email) VALUES(uid,'no-rollover@fixture.test');
 PERFORM private.credit_wallet(uid);
 l:=private.credit_mint(uid,'monthly',12345.6789,now()-interval '1 month',expiry,'expired-month','pro','grant',NULL,NULL,NULL);
 topup:=private.credit_mint(uid,'topup',20000,now(),now()+interval '12 months','topup','pro','grant',NULL,NULL,NULL);
 PERFORM private.credit_expire(uid,now());
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM public.credit_lots WHERE user_id=uid AND kind='rollover'),'natural expiry must not mint rollover');
 PERFORM pg_temp.assert((SELECT remaining=0 AND closed_at IS NOT NULL FROM public.credit_lots WHERE id=l),'monthly closed');
 PERFORM pg_temp.assert((SELECT sum(credits)=-12345.6789 FROM public.credit_ledger WHERE lot_id=l AND kind='expiry'),'exact expiry ledger');
 SELECT count(*) INTO n FROM public.credit_ledger WHERE user_id=uid;
 PERFORM private.credit_expire(uid,now()+interval '1 second');
 PERFORM private.credit_close_lot(l,now(),true);
 PERFORM pg_temp.assert((SELECT count(*)=n FROM public.credit_ledger WHERE user_id=uid),'duplicate expiry idempotent');
 PERFORM pg_temp.assert((SELECT remaining=20000 AND closed_at IS NULL FROM public.credit_lots WHERE id=topup),'topup preserved');
 -- Cutover applies to old monthly lots that were never lazily processed.
 PERFORM private.credit_mint(uid,'monthly',100,now()-interval '3 months',now()-interval '2 months','delayed','plus','grant',NULL,NULL,NULL);
 PERFORM private.credit_refresh(uid,now());
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM public.credit_lots WHERE user_id=uid AND kind='rollover'),'delayed refresh no rollover');
 -- Historical lots remain usable; their expiry cannot create another grant.
 l:=private.credit_mint(uid,'rollover',50,now(),now()+interval '2 days','historical-rollover','plus','grant',NULL,NULL,NULL);
 SELECT balance INTO bal FROM public.credit_wallets WHERE user_id=uid;
 entry:=private.credit_entry(uid,'adjustment',-20,NULL,NULL,gen_random_uuid(),NULL,NULL,uid,'fixture');
 PERFORM private.credit_draw(uid,20,entry,'removal',now());
 PERFORM pg_temp.assert((SELECT remaining=30 FROM public.credit_lots WHERE id=l),'historical lot spend works');
 PERFORM private.credit_expire(uid,now()+interval '3 days');
 PERFORM pg_temp.assert((SELECT closed_at IS NOT NULL FROM public.credit_lots WHERE id=l),'historical lot expires');
 PERFORM pg_temp.assert((SELECT balance=bal-50 AND debt=0 FROM public.credit_wallets WHERE user_id=uid),'historical wallet reconciles');
 PERFORM pg_temp.assert((SELECT sum(credits)=(SELECT balance FROM public.credit_wallets WHERE user_id=uid) FROM public.credit_ledger WHERE user_id=uid),'ledger equals wallet');
END $$;
SELECT pg_temp.assert((private.credit_config()).rollover_pct=0,'policy zero');
DO $$ BEGIN
 BEGIN UPDATE public.credit_settings SET rollover_pct=10; RAISE EXCEPTION 'FAIL: rollover policy re-enabled'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','private.credit_close_lot(uuid,timestamptz,boolean)','execute') AND NOT has_function_privilege('anon','private.credit_close_lot(uuid,timestamptz,boolean)','execute'),'expiry remains private');
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

-- Real capture/upgrade/schedule/renew paths retain their financial contracts.
DO $$ DECLARE uid uuid:=gen_random_uuid(); oid uuid; next_cycle uuid; args jsonb; old_end timestamptz; n int; bal numeric;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(uid,'no-rollover-cycle@fixture.test'); UPDATE public.user_profiles SET status='active' WHERE user_id=uid;
 args:=jsonb_build_object('userId',uid,'account','acc_cycle','mode','test');
 oid:=pg_temp.buy_v2(uid,'plus');
 oid:=pg_temp.buy_v2(uid,'pro');
 PERFORM pg_temp.assert((SELECT sum(granted)=65000 FROM public.credit_lots WHERE user_id=uid AND kind='monthly'),'upgrade allowance retained');
 SELECT balance INTO bal FROM public.credit_wallets WHERE user_id=uid;
 PERFORM public.billing_cycle('schedule',args||'{"planId":"plus"}');
 PERFORM pg_temp.assert((SELECT balance=bal FROM public.credit_wallets WHERE user_id=uid),'downgrade scheduling free');
 -- Move this synthetic cycle into its renewal window, preserving original lots.
 UPDATE private.billing_plan_periods SET starts_at=now()-interval '25 days',ends_at=now()+interval '5 days',anchor_at=now()-interval '25 days' WHERE user_id=uid;
 UPDATE public.user_profiles SET plan_period_end=now()+interval '5 days' WHERE user_id=uid;
 UPDATE public.credit_lots SET starts_at=now()-interval '25 days',expires_at=now()+interval '5 days' WHERE user_id=uid AND kind='monthly';
 old_end:=now()+interval '5 days';
 oid:=pg_temp.buy_v2(uid,'plus');
 SELECT id INTO next_cycle FROM private.billing_plan_periods WHERE order_id=oid;
 PERFORM pg_temp.assert((SELECT state='scheduled' AND starts_at=old_end FROM private.billing_plan_periods WHERE id=next_cycle),'manual renewal future period');
 PERFORM private.credit_refresh(uid,old_end+interval '1 second');
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM public.credit_lots WHERE user_id=uid AND kind='rollover'),'renewal no carry-forward');
 PERFORM pg_temp.assert((SELECT remaining=20000 FROM public.credit_lots WHERE billing_plan_period_id=next_cycle),'renewal grants exactly new allowance');
 SELECT count(*) INTO n FROM public.credit_lots WHERE user_id=uid;
 PERFORM private.credit_refresh(uid,old_end+interval '2 seconds');
 PERFORM pg_temp.assert((SELECT count(*)=n FROM public.credit_lots WHERE user_id=uid),'renewal refresh cannot duplicate grant');
 PERFORM private.credit_refresh(uid,old_end+interval '2 months');
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM public.credit_lots WHERE user_id=uid AND kind='rollover'),'lapse no carry-forward');
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM public.credit_lots WHERE user_id=uid AND kind='monthly' AND closed_at IS NULL),'lapse expires monthly balance');
END $$;

-- Historical descendants retain purchase provenance and refund review support.
DO $$ DECLARE uid uuid:=gen_random_uuid(); oid uuid; parent uuid; historical uuid; pay text; a jsonb; req jsonb; l record;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(uid,'historical-refund@fixture.test'); UPDATE public.user_profiles SET status='active',role='admin' WHERE user_id=uid;
 oid:=pg_temp.buy_v2(uid,'plus');
 SELECT id INTO parent FROM public.credit_lots WHERE billing_order_id=oid;
 FOR l IN SELECT id FROM public.credit_lots WHERE user_id=uid LOOP PERFORM private.credit_close_lot(l.id,now(),false); END LOOP;
 historical:=private.credit_mint(uid,'rollover',50,now(),now()+interval '2 days','rollover:'||parent,'plus','grant',NULL,NULL,NULL);
 PERFORM pg_temp.assert((SELECT billing_order_id=oid FROM public.credit_lots WHERE id=historical),'historical purchase provenance retained');
 SELECT provider_payment_id INTO pay FROM private.billing_payments WHERE order_id=oid;
 a:=public.billing_event('adjustment',jsonb_build_object('account','acc_cycle','mode','test','paymentId',pay,'adjustmentId','rfnd_historical','kind','refund','amountPaise',39900,'status','processed'));
 req:=jsonb_build_object('actorId',uid,'adjustmentId',a->>'id','requestId',gen_random_uuid(),'decision',jsonb_build_object('creditsToRemove',50,'reason','Reviewed historical refund'));
 PERFORM public.billing_review_adjustment(req); PERFORM public.billing_review_adjustment(req);
 PERFORM pg_temp.assert((SELECT remaining=0 FROM public.credit_lots WHERE id=historical),'review can remove historical rollover');
 PERFORM pg_temp.assert((SELECT count(*)=1 FROM public.credit_ledger WHERE billing_adjustment_id=(a->>'id')::uuid),'historical refund idempotent');
END $$;

-- Rehearse exactly the operator reset implementation, with no hosted fixtures.
\i backend/sql/operations/reset_test_billing.sql
CREATE TEMP TABLE reset_fixture(uid uuid,oid uuid,pay jsonb,bystander uuid,balance numeric);
DO $$ DECLARE uid uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); oid uuid; other_order uuid; contract jsonb; BEGIN
 INSERT INTO auth.users(id,email) VALUES(uid,'reset-target@fixture.test'),(other,'reset-bystander@fixture.test'); UPDATE public.user_profiles SET status='active' WHERE user_id IN(uid,other);
 oid:=pg_temp.buy_v2(uid,'plus'); other_order:=pg_temp.buy_v2(other,'pro');
 PERFORM private.credit_mint(uid,'signup',100,now(),now()+interval '30 days','signup',NULL,'grant',NULL,NULL,NULL);
 INSERT INTO reset_fixture SELECT uid,oid,jsonb_build_object('id',provider_payment_id,'order_id',provider_order_id,'amount',39900,'currency','INR','status','captured'),other,(SELECT balance FROM public.credit_wallets WHERE user_id=other)
 FROM private.billing_payments p JOIN private.billing_orders o ON o.id=p.order_id WHERE o.id=oid;
 contract:=jsonb_build_object('payments',1,'invoices',1,'periods',1,'lots',1,'ledger',1,'balance',(SELECT balance FROM public.credit_wallets WHERE user_id=uid));
 PERFORM set_config('billing.reset_user',uid::text,true); PERFORM set_config('billing.reset_orders',jsonb_build_array(oid)::text,true); PERFORM set_config('billing.reset_contract',contract::text,true);
 -- Wrong frozen counts must fail before deleting anything.
 PERFORM set_config('billing.reset_contract',(contract||'{"payments":2}')::text,true);
 BEGIN PERFORM pg_temp.reset_test_billing(); RAISE EXCEPTION 'FAIL: stale contract accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Reset contract changed; stop' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert(EXISTS(SELECT FROM private.billing_orders WHERE id=oid),'failed reset atomic');
 PERFORM set_config('billing.reset_contract',contract::text,true);
 BEGIN
  INSERT INTO public.credit_lot_draws(lot_id,ledger_id,reason,credits) SELECT l.id,e.id,'removal',1 FROM public.credit_lots l JOIN public.credit_ledger e ON e.lot_id=l.id WHERE l.billing_order_id=oid;
  PERFORM pg_temp.reset_test_billing(); RAISE EXCEPTION 'FAIL: drawn purchase accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Purchase credits have been drawn; review before reset' THEN RAISE; END IF; END;
 PERFORM pg_temp.reset_test_billing();
 PERFORM private.credit_refresh(uid,now());
 PERFORM pg_temp.assert((SELECT plan='free' FROM public.user_profiles WHERE user_id=uid),'reset stays Free after refresh');
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM public.invoices WHERE user_id=uid),'target invoices removed');
 PERFORM pg_temp.assert((SELECT balance=(SELECT sum(remaining) FROM public.credit_lots WHERE user_id=uid AND closed_at IS NULL) FROM public.credit_wallets WHERE user_id=uid),'signup retained and reconciled');
 PERFORM pg_temp.assert(EXISTS(SELECT FROM private.billing_orders WHERE id=other_order) AND (SELECT balance=(SELECT balance FROM reset_fixture) FROM public.credit_wallets WHERE user_id=other),'bystander untouched');
END $$;
-- A delayed verified capture for a deleted Test order cannot re-create benefits.
DO $$ DECLARE f reset_fixture; BEGIN
 SELECT * INTO f FROM reset_fixture;
 BEGIN PERFORM public.billing_cycle_capture(f.oid,f.pay); RAISE EXCEPTION 'FAIL: deleted capture accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Unknown purchase' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM public.credit_lots WHERE billing_order_id=f.oid),'old capture cannot restore grants');
END $$;
ROLLBACK;
