-- Service-only billing, atomic benefits/invoices, retry and period correctness.
-- Vacuity: fails without the billing migration. Disposable local DB only.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
CREATE FUNCTION pg_temp.assert(ok boolean,why text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',why; END IF; END $$;
INSERT INTO auth.users(id,email) VALUES('b0000000-0000-4000-8000-000000000001','buyer@billing.test'),('b0000000-0000-4000-8000-000000000002','admin@billing.test');
UPDATE public.user_profiles SET status='active' WHERE user_id::text LIKE 'b0000000%';
UPDATE public.user_profiles SET role='admin' WHERE user_id='b0000000-0000-4000-8000-000000000002';
CREATE TEMP TABLE purchase_state(k text PRIMARY KEY,v jsonb);
INSERT INTO purchase_state VALUES('claim',public.billing_order('claim',jsonb_build_object('userId','b0000000-0000-4000-8000-000000000001','requestId','a0000000-0000-4000-8000-000000000001','requestHash','topup-20000','account','acc_fixture','mode','test','snapshot',jsonb_build_object('kind','topup','productId','topup-20000','credits',20000,'amountPaise',49900,'currency','INR','creditUnit','credit-paise-v2','buyerEmail','buyer@billing.test','seller',jsonb_build_object('legalName','Fixture seller')))));
SELECT pg_temp.assert((SELECT v->>'fresh'='true' FROM purchase_state WHERE k='claim'),'new request must be fresh');
DO $$ DECLARE o jsonb; p jsonb; before_balance numeric; res jsonb;
BEGIN
 SELECT v INTO o FROM purchase_state WHERE k='claim';
 p:=jsonb_build_object('id','order_fixture1','receipt',o->>'id','amount',49900,'currency','INR');
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',p));
 p:=jsonb_build_object('id','pay_fixture1','order_id','order_fixture1','amount',49900,'currency','INR','status','authorized');
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',p));
 res:=public.billing_capture((o->>'id')::uuid,p);
 PERFORM pg_temp.assert(res->>'pending'='true','authorized cannot fulfil');
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM public.invoices WHERE billing_order_id=(o->>'id')::uuid),'no invoice on authorization');
 p:=p||'{"status":"captured"}';
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',p));
 PERFORM private.credit_refresh('b0000000-0000-4000-8000-000000000001',now());
 SELECT balance INTO before_balance FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000001';
 INSERT INTO purchase_state VALUES('before',to_jsonb(before_balance)),('payment',p);
END $$;
-- Fail at invoice insert AFTER credit work; PostgreSQL subtransaction must undo all effects.
CREATE FUNCTION pg_temp.reject_invoice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected invoice failure'; END $$;
CREATE TRIGGER billing_fixture_fail BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_invoice();
DO $$ DECLARE oid uuid; p jsonb;
BEGIN
 SELECT (v->>'id')::uuid INTO oid FROM purchase_state WHERE k='claim'; SELECT v INTO p FROM purchase_state WHERE k='payment';
 BEGIN PERFORM public.billing_capture(oid,p); RAISE EXCEPTION 'FAIL: injected error not reached';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected invoice failure' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM public.credit_lots WHERE billing_order_id=oid),'failed invoice must roll back topup lot');
 PERFORM pg_temp.assert((SELECT balance=(SELECT v::text::numeric FROM purchase_state WHERE k='before') FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000001'),'failed invoice wallet rollback');
 PERFORM pg_temp.assert(EXISTS(SELECT FROM private.billing_payments WHERE order_id=oid AND status='captured'),'capture facts survive grant rollback');
END $$;
DROP TRIGGER billing_fixture_fail ON public.invoices;
DO $$ DECLARE o jsonb; p jsonb; r jsonb; iid text;
BEGIN
 SELECT v INTO o FROM purchase_state WHERE k='claim'; SELECT v INTO p FROM purchase_state WHERE k='payment';
 r:=public.billing_capture((o->>'id')::uuid,p); iid:=r->'invoice'->>'id';
 PERFORM pg_temp.assert(r->>'ok'='true','captured fulfilment');
 PERFORM pg_temp.assert((SELECT balance=(SELECT v::text::numeric+20000 FROM purchase_state WHERE k='before') FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000001'),'exact topup balance increment');
 PERFORM pg_temp.assert((SELECT plan='free' FROM public.user_profiles WHERE user_id='b0000000-0000-4000-8000-000000000001'),'topup does not elevate plan');
 PERFORM pg_temp.assert((SELECT count(*)=1 FROM public.credit_lots WHERE billing_order_id=(o->>'id')::uuid AND kind='topup' AND expires_at=starts_at+interval '12 months'),'one topup with correct expiry');
 PERFORM pg_temp.assert(public.billing_capture((o->>'id')::uuid,p)->'invoice'->>'id'=iid,'retry returns same invoice');
 PERFORM pg_temp.assert((SELECT count(*)=1 FROM public.invoices WHERE billing_order_id=(o->>'id')::uuid),'one invoice');
 PERFORM pg_temp.assert((SELECT payload->'seller'->>'legalName'='Fixture seller' FROM public.invoices WHERE id=iid),'seller snapshot persisted');
 -- Wrong amount cannot sneak through same-order status call.
 BEGIN PERFORM public.billing_capture((o->>'id')::uuid,p||'{"amount":1}'); RAISE EXCEPTION 'FAIL: wrong amount accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
-- An ordinary role cannot invoke the financial core or access private records.
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','public.billing_capture(uuid,jsonb)','EXECUTE'),'customer fulfil RPC denied');
SELECT pg_temp.assert(NOT has_function_privilege('anon','public.billing_order(text,jsonb)','EXECUTE'),'anonymous orders denied');
SELECT pg_temp.assert(NOT has_table_privilege('service_role','private.billing_orders','INSERT'),'service direct order mutation denied');
-- Event idempotency and conflicting body detection.
DO $$ DECLARE e jsonb; p jsonb;
BEGIN
 p:='{"account":"acc_fixture","mode":"test","eventId":"event1","type":"payment.captured","hash":"one","payload":{}}';
 e:=public.billing_event('receive',p);
 PERFORM pg_temp.assert(public.billing_event('receive',p)->>'id'=e->>'id','event replay');
 BEGIN PERFORM public.billing_event('receive',p||'{"hash":"different"}'); RAISE EXCEPTION 'FAIL: event conflict accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='FAIL: event conflict accepted' THEN RAISE; END IF; END;
 UPDATE private.billing_events SET lease_until=now()-interval '1 second' WHERE id=(e->>'id')::uuid;
 PERFORM pg_temp.assert(jsonb_array_length(public.billing_event('pending','{"account":"acc_fixture","mode":"test"}'))=1,'claim event');
 PERFORM pg_temp.assert(jsonb_array_length(public.billing_event('pending','{"account":"acc_fixture","mode":"test"}'))=0,'leased event not returned twice');
END $$;
-- Reviewed reversal has exactly one audited ledger entry; does not rewrite sale.
DO $$ DECLARE a jsonb; r jsonb; args jsonb;
BEGIN
 a:=public.billing_event('adjustment','{"account":"acc_fixture","mode":"test","paymentId":"pay_fixture1","adjustmentId":"rfnd_1","kind":"refund","amountPaise":49900,"status":"processed"}');
 args:=jsonb_build_object('actorId','b0000000-0000-4000-8000-000000000002','adjustmentId',a->>'id','requestId','a0000000-0000-4000-8000-000000000003','decision',jsonb_build_object('creditsToRemove',1000,'reason','Reviewed fixture refund','document',jsonb_build_object('reference','credit-note-fixture')));
 r:=public.billing_review_adjustment(args);
 PERFORM pg_temp.assert(r->>'reviewed_at' IS NOT NULL,'review recorded');
 PERFORM public.billing_review_adjustment(args);
 PERFORM pg_temp.assert((SELECT count(*)=1 FROM public.credit_ledger WHERE billing_adjustment_id=(a->>'id')::uuid),'review replay does not reverse twice');
 BEGIN PERFORM public.billing_review_adjustment(args||jsonb_build_object('decision',jsonb_build_object('creditsToRemove',2000,'reason','Changed payload'))); RAISE EXCEPTION 'FAIL: review conflict accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='FAIL: review conflict accepted' THEN RAISE; END IF; END;
END $$;
-- A later dispute outcome can restore only previously reviewed reversals.
DO $$ DECLARE a jsonb; args jsonb; previous numeric; BEGIN
 a:=public.billing_event('adjustment','{"account":"acc_fixture","mode":"test","paymentId":"pay_fixture1","adjustmentId":"disp_fixture","kind":"dispute","amountPaise":49900,"status":"won"}');
 SELECT balance INTO previous FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000001';
 args:=jsonb_build_object('actorId','b0000000-0000-4000-8000-000000000002','adjustmentId',a->>'id','requestId','a0000000-0000-4000-8000-000000000004','decision',jsonb_build_object('creditsToRestore',500,'reason','Reviewed won dispute restoration'));
 PERFORM public.billing_review_adjustment(args); PERFORM public.billing_review_adjustment(args);
 PERFORM pg_temp.assert((SELECT balance=previous+500 FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000001'),'reviewed restoration exactly once');
 PERFORM pg_temp.assert((SELECT sum(credits)=500 FROM public.credit_ledger WHERE billing_adjustment_id=(a->>'id')::uuid),'restoration ledger trace');
END $$;
SELECT pg_temp.assert(private.billing_month_end('2028-01-31 10:00+05:30','2028-02-29 10:00+05:30')='2028-03-31 10:00+05:30'::timestamptz,'month end preserves Jan31 anchor after leap February');
-- New paid period grants one allowance; renewals and downgrades stay future.
DO $$ DECLARE o jsonb; p jsonb; start_balance numeric; period_id uuid;
BEGIN
 o:=public.billing_order('claim','{"userId":"b0000000-0000-4000-8000-000000000001","requestId":"a0000000-0000-4000-8000-000000000011","requestHash":"pro","account":"acc_fixture","mode":"test","snapshot":{"kind":"plan","productId":"plan-pro","planId":"pro","credits":65000,"amountPaise":99900,"currency":"INR","creditUnit":"credit-paise-v2","buyerEmail":"buyer@billing.test"}}');
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_pro1','amount',99900,'currency','INR','receipt',o->>'id')));
 p:='{"id":"pay_pro1","order_id":"order_pro1","amount":99900,"currency":"INR","status":"captured"}';
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',p));
 PERFORM public.billing_capture((o->>'id')::uuid,p);
 SELECT id INTO period_id FROM private.billing_plan_periods WHERE order_id=(o->>'id')::uuid;
 PERFORM pg_temp.assert((SELECT count(*)=1 FROM public.credit_lots WHERE billing_plan_period_id=period_id AND granted=65000),'one period allowance with provenance');
 PERFORM pg_temp.assert(public.billing_effective_profile('b0000000-0000-4000-8000-000000000001')->>'plan'='pro','canonical chat profile uses paid plan');
 SELECT balance INTO start_balance FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000001';
 o:=public.billing_order('claim','{"userId":"b0000000-0000-4000-8000-000000000001","requestId":"a0000000-0000-4000-8000-000000000012","requestHash":"plus","account":"acc_fixture","mode":"test","snapshot":{"kind":"plan","productId":"plan-plus","planId":"plus","credits":20000,"amountPaise":39900,"currency":"INR","creditUnit":"credit-paise-v2","buyerEmail":"buyer@billing.test"}}');
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_plus1','amount',39900,'currency','INR','receipt',o->>'id')));
 p:='{"id":"pay_plus1","order_id":"order_plus1","amount":39900,"currency":"INR","status":"captured"}';
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',p));
 PERFORM public.billing_capture((o->>'id')::uuid,p);
 PERFORM pg_temp.assert((SELECT balance=start_balance FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000001'),'future downgrade cannot mint early');
 PERFORM pg_temp.assert((SELECT state='scheduled' AND starts_at>now() FROM private.billing_plan_periods WHERE order_id=(o->>'id')::uuid),'downgrade is scheduled');
 PERFORM pg_temp.assert(public.billing_effective_profile('b0000000-0000-4000-8000-000000000001')->>'plan'='pro','queued lower plan does not elevate or cut active plan');
END $$;

-- Scheduled allowance is linked when minted later, rather than only at capture.
DO $$ DECLARE per private.billing_plan_periods; BEGIN
 SELECT * INTO per FROM private.billing_plan_periods WHERE user_id='b0000000-0000-4000-8000-000000000001' AND state='scheduled';
 PERFORM private.credit_refresh(per.user_id,per.starts_at+interval '1 second');
 PERFORM pg_temp.assert((SELECT count(*)=1 FROM public.credit_lots WHERE billing_plan_period_id=per.id AND kind='monthly' AND granted=20000),'future monthly provenance');
 PERFORM pg_temp.assert(EXISTS(SELECT FROM public.credit_ledger l JOIN public.credit_lots c ON c.id=l.lot_id WHERE c.billing_plan_period_id=per.id AND l.billing_order_id=per.order_id),'future ledger provenance');
END $$;
-- Activation updates the profile projection without minting another allowance.
DO $$ DECLARE per private.billing_plan_periods; before_lots bigint; BEGIN
 SELECT * INTO per FROM private.billing_plan_periods WHERE user_id='b0000000-0000-4000-8000-000000000001' AND state='scheduled';
 SELECT count(*) INTO before_lots FROM public.credit_lots WHERE user_id=per.user_id;
 UPDATE private.billing_plan_periods SET state='superseded' WHERE user_id=per.user_id AND state='active';
 UPDATE private.billing_plan_periods SET starts_at=now()-interval '1 minute',ends_at=now()+interval '30 days' WHERE id=per.id;
 PERFORM pg_temp.assert(public.billing_effective_profile(per.user_id)->>'plan'='plus','due queued plan becomes canonical');
 PERFORM pg_temp.assert((SELECT active_billing_plan_period_id=per.id AND plan='plus' FROM public.user_profiles WHERE user_id=per.user_id),'due period updates account projection');
 PERFORM pg_temp.assert((SELECT count(*)=before_lots FROM public.credit_lots WHERE user_id=per.user_id),'projection activation does not mint credits');
END $$;
-- Original manual stream must never resume after a superseding paid period ends.
INSERT INTO auth.users(id,email) VALUES('b0000000-0000-4000-8000-000000000004','manual@billing.test');
DO $$ DECLARE old_grant bigint; oid uuid; pid uuid; BEGIN
 PERFORM public.grant_manual_plan('b0000000-0000-4000-8000-000000000004','plus',now()+interval '90 days','b0000000-0000-4000-8000-000000000002');
 SELECT max(id) INTO old_grant FROM public.plan_grants WHERE user_id='b0000000-0000-4000-8000-000000000004';
 UPDATE public.plan_grants SET created_at=now()-interval '90 days' WHERE id=old_grant;
 INSERT INTO private.billing_orders(user_id,customer_id,request_id,request_hash,account,mode,snapshot,amount_paise,currency,created_at)
 VALUES('b0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000004',gen_random_uuid(),'synthetic-history','acc_fixture','test','{}',99900,'INR',now()-interval '65 days') RETURNING id INTO oid;
 INSERT INTO private.billing_plan_periods(order_id,user_id,plan,starts_at,ends_at,anchor_at,credits,state,created_at)
 VALUES(oid,'b0000000-0000-4000-8000-000000000004','pro',now()-interval '60 days',now()-interval '30 days',now()-interval '60 days',65000,'active',now()-interval '65 days') RETURNING id INTO pid;
 INSERT INTO public.plan_grants(user_id,plan,status,period_end,source,payment_id,billing_plan_period_id,created_at)
 VALUES('b0000000-0000-4000-8000-000000000004','pro','active',now()-interval '30 days','payment','pay_past_fixture',pid,now()-interval '65 days');
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM private.credit_due_cycles('b0000000-0000-4000-8000-000000000004',now())),'superseded old manual stream cannot resurrect');
 PERFORM public.grant_manual_plan('b0000000-0000-4000-8000-000000000004','plus',now()+interval '30 days','b0000000-0000-4000-8000-000000000002');
 PERFORM pg_temp.assert(EXISTS(SELECT FROM private.credit_due_cycles('b0000000-0000-4000-8000-000000000004',now()) WHERE plan='plus'),'genuinely newer manual grant retains allowance');
END $$;

-- One buyer/request pair is durable: replay returns the original snapshot, while
-- changing the product behind that request ID cannot create a second purchase.
INSERT INTO auth.users(id,email) VALUES('b0000000-0000-4000-8000-000000000005','replay@billing.test');
UPDATE public.user_profiles SET status='active' WHERE user_id='b0000000-0000-4000-8000-000000000005';
DO $$ DECLARE args jsonb; first_order jsonb; replay jsonb; BEGIN
 args:=jsonb_build_object('userId','b0000000-0000-4000-8000-000000000005','requestId','a0000000-0000-4000-8000-000000000021',
  'requestHash','topup-20000','account','acc_fixture','mode','test','snapshot',
  jsonb_build_object('kind','topup','productId','topup-20000','credits',20000,'amountPaise',49900,'currency','INR','creditUnit','credit-paise-v2'));
 first_order:=public.billing_order('claim',args);
 replay:=public.billing_order('claim',args);
 PERFORM pg_temp.assert(first_order->>'fresh'='true' AND replay->>'fresh'='false' AND replay->>'id'=first_order->>'id',
  'same request replay returns the original purchase');
 PERFORM pg_temp.assert(public.billing_order('get',jsonb_build_object('purchaseId',first_order->>'id','account','acc_fixture','mode','test','userId','b0000000-0000-4000-8000-000000000005'))->>'id'=first_order->>'id'
  AND public.billing_order('get',jsonb_build_object('purchaseId',first_order->>'id','account','acc_other','mode','test','userId','b0000000-0000-4000-8000-000000000005')) IS NULL
  AND public.billing_order('get',jsonb_build_object('purchaseId',first_order->>'id','account','acc_fixture','mode','live','userId','b0000000-0000-4000-8000-000000000005')) IS NULL,
  'purchase lookup is bound to merchant account and mode');
 BEGIN
  PERFORM public.billing_order('claim',args||jsonb_build_object('requestHash','topup-50000','snapshot',
   jsonb_build_object('kind','topup','productId','topup-50000','credits',50000,'amountPaise',119900,'currency','INR','creditUnit','credit-paise-v2')));
  RAISE EXCEPTION 'FAIL: conflicting product hash accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 PERFORM pg_temp.assert((SELECT count(*)=1 FROM private.billing_orders WHERE customer_id='b0000000-0000-4000-8000-000000000005')
  AND (SELECT snapshot->>'productId'='topup-20000' FROM private.billing_orders WHERE id=(first_order->>'id')::uuid),
  'conflicting request leaves exactly the original snapshot');
END $$;

-- A failed attempt cannot fulfil; another captured payment on the same order
-- can fulfil once. A later second capture becomes an overpayment for review.
INSERT INTO auth.users(id,email) VALUES('b0000000-0000-4000-8000-000000000006','retry@billing.test');
UPDATE public.user_profiles SET status='active' WHERE user_id='b0000000-0000-4000-8000-000000000006';
DO $$ DECLARE o jsonb; failed jsonb; captured jsonb; second jsonb; r jsonb; balance_before numeric; balance_after numeric; BEGIN
 o:=public.billing_order('claim','{"userId":"b0000000-0000-4000-8000-000000000006","requestId":"a0000000-0000-4000-8000-000000000022","requestHash":"retry-topup","account":"acc_fixture","mode":"test","snapshot":{"kind":"topup","productId":"topup-20000","credits":20000,"amountPaise":49900,"currency":"INR","creditUnit":"credit-paise-v2","buyerEmail":"retry@billing.test"}}');
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_retry','receipt',o->>'id','amount',49900,'currency','INR')));
 PERFORM private.credit_refresh('b0000000-0000-4000-8000-000000000006',now());
 SELECT balance INTO balance_before FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000006';
 failed:='{"id":"pay_retryfailed","order_id":"order_retry","amount":49900,"currency":"INR","status":"failed"}';
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',failed));
 r:=public.billing_capture((o->>'id')::uuid,failed);
 PERFORM pg_temp.assert(r->>'pending'='true' AND NOT EXISTS(SELECT FROM public.invoices WHERE billing_order_id=(o->>'id')::uuid)
  AND NOT EXISTS(SELECT FROM public.credit_lots WHERE billing_order_id=(o->>'id')::uuid),
  'failed payment leaves benefits and invoice absent');
 captured:='{"id":"pay_retrycaptured","order_id":"order_retry","amount":49900,"currency":"INR","status":"captured"}';
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',captured));
 r:=public.billing_capture((o->>'id')::uuid,captured);
 SELECT balance INTO balance_after FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000006';
 PERFORM pg_temp.assert(r->>'ok'='true' AND balance_after=balance_before+20000
  AND (SELECT count(*)=1 FROM public.credit_lots WHERE billing_order_id=(o->>'id')::uuid)
  AND (SELECT count(*)=1 FROM public.invoices WHERE billing_order_id=(o->>'id')::uuid),
  'captured retry grants one top-up and invoice');
 second:='{"id":"pay_retrysecond","order_id":"order_retry","amount":49900,"currency":"INR","status":"captured"}';
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',second));
 r:=public.billing_capture((o->>'id')::uuid,second);
 PERFORM pg_temp.assert(r->>'status'='review' AND (SELECT balance=balance_after FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000006')
  AND (SELECT count(*)=1 FROM public.credit_lots WHERE billing_order_id=(o->>'id')::uuid)
  AND (SELECT count(*)=1 FROM public.invoices WHERE billing_order_id=(o->>'id')::uuid)
  AND (SELECT count(*)=1 FROM private.billing_adjustments WHERE kind='overpayment' AND payment_id=(SELECT id FROM private.billing_payments WHERE provider_payment_id='pay_retrysecond')),
  'second captured payment is reviewable overpayment without another benefit');
END $$;

-- Refund observation wins over a late capture, even after a reviewer closes
-- the fully refunded purchase. The old capture cannot reopen it.
INSERT INTO auth.users(id,email) VALUES('b0000000-0000-4000-8000-000000000007','refunded@billing.test');
UPDATE public.user_profiles SET status='active' WHERE user_id='b0000000-0000-4000-8000-000000000007';
DO $$ DECLARE o jsonb; refunded jsonb; late jsonb; r jsonb; adjustment_id uuid; BEGIN
 o:=public.billing_order('claim','{"userId":"b0000000-0000-4000-8000-000000000007","requestId":"a0000000-0000-4000-8000-000000000023","requestHash":"refunded-topup","account":"acc_fixture","mode":"test","snapshot":{"kind":"topup","productId":"topup-20000","credits":20000,"amountPaise":49900,"currency":"INR","creditUnit":"credit-paise-v2"}}');
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_refunded','receipt',o->>'id','amount',49900,'currency','INR')));
 refunded:='{"id":"pay_refunded","order_id":"order_refunded","amount":49900,"currency":"INR","status":"refunded","amount_refunded":49900}';
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',refunded));
 late:=refunded||'{"status":"captured","amount_refunded":0}';
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',late));
 r:=public.billing_capture((o->>'id')::uuid,late);
 PERFORM pg_temp.assert(r->>'pending'='true' AND (SELECT state='review' FROM private.billing_orders WHERE id=(o->>'id')::uuid)
  AND NOT EXISTS(SELECT FROM public.credit_lots WHERE billing_order_id=(o->>'id')::uuid)
  AND NOT EXISTS(SELECT FROM public.invoices WHERE billing_order_id=(o->>'id')::uuid),
  'refund before late capture holds purchase without benefits');
 SELECT a.id INTO adjustment_id FROM private.billing_adjustments a JOIN private.billing_payments p ON p.id=a.payment_id
  WHERE p.provider_payment_id='pay_refunded' AND a.kind='purchase_review';
 PERFORM public.billing_review_adjustment(jsonb_build_object('actorId','b0000000-0000-4000-8000-000000000002',
  'adjustmentId',adjustment_id,'requestId','a0000000-0000-4000-8000-000000000024',
  'decision',jsonb_build_object('resolution','refund_recorded','reason','Full provider refund confirmed')));
 r:=public.billing_capture((o->>'id')::uuid,late);
 PERFORM pg_temp.assert(r->>'status'='refunded' AND (SELECT state='refunded' FROM private.billing_orders WHERE id=(o->>'id')::uuid)
  AND NOT EXISTS(SELECT FROM public.credit_lots WHERE billing_order_id=(o->>'id')::uuid)
  AND NOT EXISTS(SELECT FROM public.invoices WHERE billing_order_id=(o->>'id')::uuid),
  'late capture after reviewed refund cannot mint benefits');
END $$;

-- A top-up repays existing credit debt from its minted lot while preserving
-- the ledger/wallet total; buying it does not change an active paid plan.
INSERT INTO auth.users(id,email) VALUES('b0000000-0000-4000-8000-000000000008','debt@billing.test');
UPDATE public.user_profiles SET status='active' WHERE user_id='b0000000-0000-4000-8000-000000000008';
DO $$ DECLARE o jsonb; p jsonb; entry_id uuid; initial_balance numeric; before_balance numeric; before_debt numeric; purchased_lot_id uuid; BEGIN
 PERFORM private.credit_refresh('b0000000-0000-4000-8000-000000000008',now());
 SELECT balance INTO initial_balance FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000008';
 entry_id:=private.credit_entry('b0000000-0000-4000-8000-000000000008','adjustment',-(initial_balance+3000),NULL,NULL,
  'a0000000-0000-4000-8000-000000000025',NULL,NULL,'b0000000-0000-4000-8000-000000000002','Synthetic prior credit use');
 PERFORM private.credit_draw('b0000000-0000-4000-8000-000000000008',initial_balance+3000,entry_id,'removal',now());
 SELECT balance,debt INTO before_balance,before_debt FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000008';
 PERFORM pg_temp.assert(before_balance=-3000 AND before_debt=3000,'synthetic buyer begins with real lot exhaustion and debt');
 o:=public.billing_order('claim','{"userId":"b0000000-0000-4000-8000-000000000008","requestId":"a0000000-0000-4000-8000-000000000026","requestHash":"debt-topup","account":"acc_fixture","mode":"test","snapshot":{"kind":"topup","productId":"topup-20000","credits":20000,"amountPaise":49900,"currency":"INR","creditUnit":"credit-paise-v2","buyerEmail":"debt@billing.test"}}');
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_debt','receipt',o->>'id','amount',49900,'currency','INR')));
 p:='{"id":"pay_debt","order_id":"order_debt","amount":49900,"currency":"INR","status":"captured"}';
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',p));
 PERFORM public.billing_capture((o->>'id')::uuid,p);
 SELECT id INTO purchased_lot_id FROM public.credit_lots WHERE billing_order_id=(o->>'id')::uuid;
 PERFORM pg_temp.assert((SELECT balance=before_balance+20000 AND debt=0 FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000008')
  AND (SELECT granted=20000 AND remaining=17000 FROM public.credit_lots WHERE id=purchased_lot_id)
  AND (SELECT coalesce(sum(credits),0)=3000 FROM public.credit_lot_draws WHERE lot_id=purchased_lot_id AND reason='repayment')
  AND (SELECT plan='free' FROM public.user_profiles WHERE user_id='b0000000-0000-4000-8000-000000000008'),
  'top-up repays 3000 debt and leaves 17000 usable credits without changing free plan');
END $$;

INSERT INTO auth.users(id,email) VALUES('b0000000-0000-4000-8000-000000000009','paid-topup@billing.test');
UPDATE public.user_profiles SET status='active' WHERE user_id='b0000000-0000-4000-8000-000000000009';
DO $$ DECLARE o jsonb; p jsonb; paid_period uuid; period_end timestamptz; before_balance numeric; BEGIN
 o:=public.billing_order('claim','{"userId":"b0000000-0000-4000-8000-000000000009","requestId":"a0000000-0000-4000-8000-000000000027","requestHash":"paid-pro","account":"acc_fixture","mode":"test","snapshot":{"kind":"plan","productId":"plan-pro","planId":"pro","credits":65000,"amountPaise":99900,"currency":"INR","creditUnit":"credit-paise-v2","buyerEmail":"paid-topup@billing.test"}}');
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_paidpro','receipt',o->>'id','amount',99900,'currency','INR')));
 p:='{"id":"pay_paidpro","order_id":"order_paidpro","amount":99900,"currency":"INR","status":"captured"}';
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',p));
 PERFORM public.billing_capture((o->>'id')::uuid,p);
 SELECT active_billing_plan_period_id,plan_period_end INTO paid_period,period_end FROM public.user_profiles WHERE user_id='b0000000-0000-4000-8000-000000000009';
 SELECT balance INTO before_balance FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000009';
 PERFORM pg_temp.assert(paid_period IS NOT NULL AND public.billing_effective_profile('b0000000-0000-4000-8000-000000000009')->>'plan'='pro',
  'paid buyer has active pro entitlement before top-up');
 o:=public.billing_order('claim','{"userId":"b0000000-0000-4000-8000-000000000009","requestId":"a0000000-0000-4000-8000-000000000028","requestHash":"paid-topup","account":"acc_fixture","mode":"test","snapshot":{"kind":"topup","productId":"topup-20000","credits":20000,"amountPaise":49900,"currency":"INR","creditUnit":"credit-paise-v2","buyerEmail":"paid-topup@billing.test"}}');
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_paidtopup','receipt',o->>'id','amount',49900,'currency','INR')));
 p:='{"id":"pay_paidtopup","order_id":"order_paidtopup","amount":49900,"currency":"INR","status":"captured"}';
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',p));
 PERFORM public.billing_capture((o->>'id')::uuid,p);
 PERFORM pg_temp.assert((SELECT balance=before_balance+20000 FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000009')
  AND (SELECT plan='pro' AND active_billing_plan_period_id=paid_period AND plan_period_end=period_end FROM public.user_profiles WHERE user_id='b0000000-0000-4000-8000-000000000009')
  AND public.billing_effective_profile('b0000000-0000-4000-8000-000000000009')->>'plan'='pro'
  AND (SELECT count(*)=1 FROM private.billing_plan_periods WHERE user_id='b0000000-0000-4000-8000-000000000009'),
  'paid top-up adds credits while preserving pro period and entitlement');
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.billing_capture('a0000000-0000-4000-8000-000000000001','{}');
  RAISE EXCEPTION 'FAIL: customer could execute fulfilment';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Account deletion preserves sale facts and invoice; customer credit data may cascade.
DELETE FROM auth.users WHERE id='b0000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert(EXISTS(SELECT FROM private.billing_orders WHERE customer_id='b0000000-0000-4000-8000-000000000001' AND user_id IS NULL),'purchase survives account deletion');
SELECT pg_temp.assert(EXISTS(SELECT FROM public.invoices WHERE user_email='buyer@billing.test' AND user_id IS NULL),'invoice survives account deletion');
ROLLBACK;
