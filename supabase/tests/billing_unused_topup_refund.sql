-- Full current billing chain; unused top-up refund migration is required last.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert(ok boolean,why text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',why; END IF; END $$;
SELECT pg_temp.assert(to_regprocedure('public.billing_review_adjustment_v2(jsonb)') IS NOT NULL,'purchase-linked refund review boundary absent');
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
CREATE FUNCTION pg_temp.buyer(admin_actor boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE uid uuid:=gen_random_uuid(); BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(uid,uid||'@refund.fixture.test',now());
 UPDATE public.user_profiles SET status='active',role=CASE WHEN admin_actor THEN 'admin'::public.app_role ELSE role END WHERE user_id=uid;
 RETURN uid;
END $$;
CREATE FUNCTION pg_temp.buy(uid uuid,plan_name text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o jsonb; pay jsonb; ref text:=replace(gen_random_uuid()::text,'-',''); snap jsonb;
BEGIN
 snap:=jsonb_build_object('kind',CASE WHEN plan_name IS NULL THEN 'topup' ELSE 'plan' END,'productId',CASE WHEN plan_name IS NULL THEN 'topup-20000' ELSE 'plan-'||plan_name END,
  'credits',CASE WHEN plan_name IS NULL THEN 20000 ELSE 750000 END,'amountPaise',CASE WHEN plan_name IS NULL THEN 49900 ELSE 999900 END,
  'currency','INR','creditUnit','credit-paise-v2','buyerEmail','refund@fixture.test');
 IF plan_name IS NOT NULL THEN snap:=snap||jsonb_build_object('planId',plan_name); END IF;
 o:=public.billing_order('claim',jsonb_build_object('userId',uid,'requestId',gen_random_uuid(),'requestHash',ref,'account','acc_refund','mode','test','snapshot',snap));
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_'||ref,'receipt',o->>'id','amount',o->>'amount_paise','currency','INR')));
 pay:=jsonb_build_object('id','pay_'||ref,'order_id','order_'||ref,'amount',o->>'amount_paise','currency','INR','status','captured');
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',pay));
 PERFORM pg_temp.assert(public.billing_capture((o->>'id')::uuid,pay)->>'ok'='true','real fixture capture');
 RETURN (o->>'id')::uuid;
END $$;
CREATE FUNCTION pg_temp.refund(oid uuid,refunded bigint DEFAULT 49900) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o private.billing_orders; pay private.billing_payments; a jsonb;
BEGIN
 SELECT * INTO o FROM private.billing_orders WHERE id=oid;
 SELECT * INTO pay FROM private.billing_payments WHERE id=o.fulfilled_payment_id;
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',oid,'payment',jsonb_build_object('id',pay.provider_payment_id,'order_id',o.provider_order_id,
  'amount',o.amount_paise,'currency','INR','status','captured','amount_refunded',refunded)));
 a:=public.billing_event('adjustment',jsonb_build_object('account','acc_refund','mode','test','paymentId',pay.provider_payment_id,
  'adjustmentId','refund_'||oid,'kind','refund','amountPaise',refunded,'status','processed'));
 RETURN (a->>'id')::uuid;
END $$;
CREATE FUNCTION pg_temp.args(actor uuid,aid uuid,qty numeric DEFAULT 20000) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('actorId',actor,'adjustmentId',aid,'requestId',gen_random_uuid(),'account','acc_refund','mode','test',
  'decision',jsonb_build_object('creditsToRemove',qty,'reason','Reviewed fully unused top-up refund','resolution','refund_recorded'));
$$;
CREATE FUNCTION pg_temp.reject_review(p jsonb,expected text DEFAULT '23514') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN PERFORM public.billing_review_adjustment_v2(p);
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>expected THEN RAISE; END IF;
  IF expected='23514' THEN PERFORM pg_temp.assert(SQLERRM='Unused top-up review requires support: purchase is not fully refunded and unused','safe unsupported-case error'); END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'FAIL: unsupported review accepted';
END $$;

-- The earlier monthly/signup/other top-up lots must remain byte-for-byte intact.
DO $$ DECLARE uid uuid:=pg_temp.buyer(); actor uuid:=pg_temp.buyer(true); oid uuid; aid uuid; args jsonb; result jsonb;
 before_lots jsonb; after_lots jsonb; before_profile jsonb; invoice jsonb; wallet public.credit_wallets; lot uuid; eid uuid; companion uuid; purchases jsonb;
BEGIN
 PERFORM pg_temp.buy(uid,'max');
 PERFORM private.credit_mint(uid,'topup',321,now()-interval '1 day',now()+interval '20 days','unrelated-earlier',NULL,'grant',NULL,NULL,NULL);
 oid:=pg_temp.buy(uid); aid:=pg_temp.refund(oid); args:=pg_temp.args(actor,aid);
 SELECT id INTO lot FROM public.credit_lots WHERE billing_order_id=oid;
 SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) INTO before_lots FROM public.credit_lots l WHERE user_id=uid AND id<>lot;
 SELECT to_jsonb(p) INTO before_profile FROM public.user_profiles p WHERE user_id=uid;
 SELECT to_jsonb(i) INTO invoice FROM public.invoices i WHERE billing_order_id=oid;
 SELECT * INTO wallet FROM public.credit_wallets WHERE user_id=uid;
 purchases:=public.billing_purchases_v2(jsonb_build_object('userId',uid,'account','acc_refund','mode','test'));
 PERFORM pg_temp.assert(EXISTS(SELECT FROM jsonb_array_elements(purchases) row WHERE row->>'id'=oid::text AND (row->>'refunded_paise')::bigint=49900 AND row->>'refund_review_pending'='true'),'history reflects full refund independently of fulfilment');
 result:=public.billing_review_adjustment_v2(args);
 SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) INTO after_lots FROM public.credit_lots l WHERE user_id=uid AND id<>lot;
 PERFORM pg_temp.assert(before_lots=after_lots,'refund must preserve every unrelated earlier lot');
 PERFORM pg_temp.assert((SELECT remaining=0 AND closed_at IS NOT NULL AND granted=20000 FROM public.credit_lots WHERE id=lot),'only original purchase lot removed');
 PERFORM pg_temp.assert((SELECT balance=wallet.balance-20000 AND debt=wallet.debt FROM public.credit_wallets WHERE user_id=uid),'exact wallet debit without debt');
 PERFORM pg_temp.assert((SELECT to_jsonb(p)=before_profile AND plan='max' FROM public.user_profiles p WHERE user_id=uid),'Max and period unchanged');
 PERFORM pg_temp.assert((SELECT to_jsonb(i)=invoice FROM public.invoices i WHERE billing_order_id=oid),'original sale invoice untouched');
 SELECT id INTO eid FROM public.credit_ledger WHERE billing_adjustment_id=aid;
 PERFORM pg_temp.assert((SELECT count(*)=1 AND sum(credits)=-20000 FROM public.credit_ledger WHERE billing_adjustment_id=aid AND billing_order_id=oid AND created_by=actor),'one audited adjustment debit');
 PERFORM pg_temp.assert((SELECT count(*)=1 AND sum(credits)=20000 AND min(lot_id::text)=lot::text FROM public.credit_lot_draws WHERE ledger_id=eid AND reason='removal'),'debit matches exact purchase draw');
 PERFORM pg_temp.assert((SELECT balance=(SELECT sum(credits) FROM public.credit_ledger WHERE user_id=uid) FROM public.credit_wallets WHERE user_id=uid),'wallet/ledger conserve');
 PERFORM pg_temp.assert(public.billing_review_adjustment_v2(args)=result,'same-decision retry idempotent');
 PERFORM pg_temp.reject_review(args||jsonb_build_object('requestId',gen_random_uuid()),'23505');
 PERFORM pg_temp.reject_review(args||jsonb_build_object('decision',jsonb_build_object('creditsToRemove',1,'reason','conflicting payload')),'23505');
 SELECT id INTO companion FROM private.billing_adjustments WHERE payment_id=(SELECT fulfilled_payment_id FROM private.billing_orders WHERE id=oid) AND kind='purchase_review';
 PERFORM pg_temp.reject_review(pg_temp.args(actor,companion));
 PERFORM public.billing_review_adjustment_v2(pg_temp.args(actor,companion,0));
 PERFORM pg_temp.assert((SELECT count(*)=1 FROM public.credit_ledger WHERE billing_order_id=oid AND kind='adjustment'),'paired review records cannot double-debit');
 purchases:=public.billing_purchases_v2(jsonb_build_object('userId',uid,'account','acc_refund','mode','test'));
 PERFORM pg_temp.assert(EXISTS(SELECT FROM jsonb_array_elements(purchases) row WHERE row->>'id'=oid::text AND row->>'refund_review_pending'='false' AND row->>'state'='fulfilled'),'zero acknowledgement clears companion pending without rewriting sale');
END $$;

-- All unsupported top-up shapes reject atomically rather than falling to FIFO.
DO $$ DECLARE actor uuid:=pg_temp.buyer(true); uid uuid; oid uuid; aid uuid; args jsonb; item int; lot public.credit_lots; before_lot jsonb; w jsonb; eid uuid; pay private.billing_payments; alt jsonb;
BEGIN
 FOR item IN 1..15 LOOP
  uid:=pg_temp.buyer(); oid:=pg_temp.buy(uid); aid:=pg_temp.refund(oid); args:=pg_temp.args(actor,aid);
  SELECT * INTO lot FROM public.credit_lots WHERE billing_order_id=oid;
  IF item=1 THEN UPDATE private.billing_payments SET refunded_paise=100 WHERE order_id=oid;
  ELSIF item=2 THEN args:=jsonb_set(args,'{decision,creditsToRemove}','100');
  ELSIF item=3 THEN
   eid:=private.credit_entry(uid,'adjustment',-1,NULL,NULL,gen_random_uuid(),NULL,NULL,actor,'prior consumed unit');
   UPDATE public.credit_lots SET remaining=remaining-1 WHERE id=lot.id;
   INSERT INTO public.credit_lot_draws(lot_id,ledger_id,reason,credits) VALUES(lot.id,eid,'removal',1);
  ELSIF item=4 THEN UPDATE public.credit_lots SET starts_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=lot.id;
  ELSIF item=5 THEN UPDATE public.credit_lots SET source_key='forged-source' WHERE id=lot.id;
  ELSIF item=6 THEN UPDATE public.credit_ledger SET billing_order_id=NULL WHERE lot_id=lot.id;
  ELSIF item IN(7,8,9) THEN
   INSERT INTO public.credit_holds(user_id,turn_key,credits,expires_at,settled_at) VALUES(uid,'refund-hold',10,
    CASE WHEN item=8 THEN now()-interval '1 minute' ELSE now()+interval '5 minutes' END,CASE WHEN item=9 THEN now() END);
  ELSIF item=10 THEN args:=jsonb_set(args,'{decision,creditsToRestore}','1');
  ELSIF item=11 THEN args:=jsonb_set(args,'{decision,cancelPeriod}','true');
  ELSIF item=12 THEN args:=jsonb_set(args,'{decision,restorePeriod}','true');
  ELSIF item=13 THEN UPDATE public.credit_lots SET granted=15000,remaining=15000 WHERE id=lot.id;
  ELSIF item=14 THEN UPDATE private.billing_orders SET snapshot=jsonb_set(snapshot,'{creditUnit}','"old-unit"') WHERE id=oid;
  ELSIF item=15 THEN
   -- Refilled remaining cannot erase draw history.
   eid:=private.credit_entry(uid,'adjustment',1,NULL,NULL,gen_random_uuid(),NULL,NULL,actor,'synthetic prior restoration');
   INSERT INTO public.credit_lot_draws(lot_id,ledger_id,reason,credits) VALUES(lot.id,eid,'removal',1);
  END IF;
  SELECT to_jsonb(l) INTO before_lot FROM public.credit_lots l WHERE id=lot.id;
  SELECT to_jsonb(x) INTO w FROM public.credit_wallets x WHERE user_id=uid;
  PERFORM pg_temp.reject_review(args);
  PERFORM pg_temp.assert((SELECT to_jsonb(l)=before_lot FROM public.credit_lots l WHERE id=lot.id)
   AND (SELECT to_jsonb(x)=w FROM public.credit_wallets x WHERE user_id=uid),'rejected shape leaves wallet/lot unchanged: '||item);
 END LOOP;
END $$;

-- A refunded overpayment cannot remove the fulfilled payment's allocation or
-- misleadingly mark that fulfilled purchase refunded.
DO $$ DECLARE uid uuid:=pg_temp.buyer(); actor uuid:=pg_temp.buyer(true); oid uuid:=pg_temp.buy(uid); o private.billing_orders; aid uuid; a jsonb; rows jsonb;
BEGIN
 SELECT * INTO o FROM private.billing_orders WHERE id=oid;
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',oid,'payment',jsonb_build_object('id','pay_overpayment','order_id',o.provider_order_id,
  'amount',49900,'currency','INR','status','refunded','amount_refunded',49900)));
 a:=public.billing_event('adjustment',jsonb_build_object('account','acc_refund','mode','test','paymentId','pay_overpayment','adjustmentId','refund_overpayment','kind','refund','amountPaise',49900,'status','processed'));
 PERFORM pg_temp.reject_review(pg_temp.args(actor,(a->>'id')::uuid));
 rows:=public.billing_purchases_v2(jsonb_build_object('userId',uid,'account','acc_refund','mode','test'));
 PERFORM pg_temp.assert(rows->0->>'refunded_paise'='0' AND rows->0->>'refund_review_pending'='false','refunded overpayment does not alter purchase projection');
END $$;

-- Actor/environment scoping, partial-refund display, retry-field compatibility,
-- and unrelated zero-credit dispute review remain correct.
DO $$ DECLARE uid uuid:=pg_temp.buyer(); actor uuid:=pg_temp.buyer(true); oid uuid:=pg_temp.buy(uid); aid uuid:=pg_temp.refund(oid,123); args jsonb:=pg_temp.args(actor,aid); rows jsonb; raw jsonb; a jsonb; pay private.billing_payments;
BEGIN
 PERFORM pg_temp.reject_review(args||jsonb_build_object('actorId',uid),'42501');
 PERFORM pg_temp.reject_review(args||'{"mode":"live"}','42501');
 PERFORM pg_temp.reject_review(args||'{"account":"other"}','42501');
 UPDATE public.user_profiles SET status='suspended' WHERE user_id=actor;
 PERFORM pg_temp.reject_review(args,'42501'); UPDATE public.user_profiles SET status='active' WHERE user_id=actor;
 rows:=public.billing_purchases_v2(jsonb_build_object('userId',uid,'account','acc_refund','mode','test'));
 raw:=public.billing_creation_retry('list',jsonb_build_object('userId',uid,'account','acc_refund','mode','test'));
 PERFORM pg_temp.assert(rows->0->>'refunded_paise'='123' AND rows->0->>'refund_review_pending'='true','partial refund shown truthfully');
 PERFORM pg_temp.assert(((rows->0)-'refunded_paise'-'refund_review_pending')=raw->0,'legacy own list fields preserved');
 PERFORM pg_temp.assert(public.billing_purchases_v2(jsonb_build_object('userId',uid,'account','acc_refund','mode','live'))='[]'::jsonb,'history mode isolation');
 PERFORM pg_temp.assert(public.billing_purchases_v2(jsonb_build_object('userId',actor,'account','acc_refund','mode','test'))='[]'::jsonb,'history buyer isolation');
 SELECT * INTO pay FROM private.billing_payments WHERE order_id=oid;
 a:=public.billing_event('adjustment',jsonb_build_object('account','acc_refund','mode','test','paymentId',pay.provider_payment_id,'adjustmentId','dispute_unrelated','kind','dispute','amountPaise',123,'status','won'));
 PERFORM public.billing_review_adjustment_v2(pg_temp.args(actor,aid,0));
 PERFORM pg_temp.assert((SELECT reviewed_at IS NULL FROM private.billing_adjustments WHERE id=(a->>'id')::uuid),'refund acknowledgement never closes unrelated dispute');
 PERFORM pg_temp.assert(public.billing_review_adjustment_v2(pg_temp.args(actor,(a->>'id')::uuid,0))->>'reviewed_at' IS NOT NULL,'explicit unrelated zero-credit dispute review delegates');
END $$;
SELECT pg_temp.assert(has_function_privilege('service_role','public.billing_review_adjustment_v2(jsonb)','execute')
 AND has_function_privilege('service_role','public.billing_purchases_v2(jsonb)','execute')
 AND NOT has_function_privilege('authenticated','public.billing_review_adjustment_v2(jsonb)','execute')
 AND NOT has_function_privilege('anon','public.billing_purchases_v2(jsonb)','execute'),'service-only refund boundaries');
ROLLBACK;
