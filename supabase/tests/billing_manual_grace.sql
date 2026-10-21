-- Full live-cycle chain plus billing_manual_grace last; omission must fail.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert(ok boolean,why text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',why; END IF; END $$;
SELECT pg_temp.assert(to_regprocedure('public.my_entitlement_manual()') IS NOT NULL,'manual access grace boundary absent');
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
-- BEGIN HELPERS (also used by the disposable two-session fixture).
CREATE FUNCTION pg_temp.buyer() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE uid uuid:=gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(uid,uid||'@grace.fixture.test',now());
 UPDATE public.user_profiles SET status='active' WHERE user_id=uid; RETURN uid;
END $$;
CREATE FUNCTION pg_temp.prepare(buyer uuid,target text,mode_name text DEFAULT 'test',intent text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE args jsonb:=jsonb_build_object('userId',buyer,'account','acc_grace','mode',mode_name,'planId',target,'intent',intent);
 quote jsonb; o jsonb; ref text:=replace(gen_random_uuid()::text,'-','');
BEGIN
 quote:=public.billing_cycle_v3('quote',args);
 PERFORM pg_temp.assert(quote->>'contract'='cycle-v3','immutable v3 snapshot');
 o:=public.billing_cycle_v3('claim',args||jsonb_build_object('quoteId',quote->>'quoteId','requestId',gen_random_uuid(),'requestHash',ref,
  'snapshot',jsonb_build_object('buyerEmail','grace@fixture.test')));
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_'||ref,
  'amount',o->>'amount_paise','currency','INR','receipt',o->>'id')));
 RETURN (o->>'id')::uuid;
END $$;
CREATE FUNCTION pg_temp.settle(oid uuid,mode_name text DEFAULT 'test') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o private.billing_orders; pay jsonb;
BEGIN
 SELECT * INTO o FROM private.billing_orders WHERE id=oid;
 pay:=jsonb_build_object('id','pay_'||replace(oid::text,'-',''),'order_id',o.provider_order_id,'amount',o.amount_paise,'currency','INR','status','captured');
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',oid,'payment',pay));
 RETURN public.billing_cycle_capture_v3(oid,pay,jsonb_build_object('account','acc_grace','mode',mode_name));
END $$;
CREATE FUNCTION pg_temp.buy(buyer uuid,target text,mode_name text DEFAULT 'test',intent text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE oid uuid; result jsonb;
BEGIN
 oid:=pg_temp.prepare(buyer,target,mode_name,intent); result:=pg_temp.settle(oid,mode_name);
 PERFORM pg_temp.assert(result->>'ok'='true','purchase fulfilled: '||result::text); RETURN oid;
END $$;
CREATE FUNCTION pg_temp.expire(oid uuid,age interval DEFAULT interval '1 hour') RETURNS void LANGUAGE plpgsql AS $$
DECLARE uid uuid; ending timestamptz:=now()-age;
BEGIN
 UPDATE private.billing_plan_periods SET starts_at=ending-interval '1 month',ends_at=ending,anchor_at=ending-interval '1 month'
  WHERE order_id=oid RETURNING user_id INTO uid;
 UPDATE public.user_profiles SET plan_period_end=ending WHERE user_id=uid;
 UPDATE public.credit_lots SET starts_at=ending-interval '1 month',expires_at=ending WHERE billing_order_id=oid AND kind='monthly';
END $$;
-- END HELPERS

-- Current payment wins; access-only expiry is deterministic and independent of
-- profile activation, navigation, wallet refresh, or scheduler availability.
DO $$ DECLARE uid uuid:=pg_temp.buyer(); oid uuid; b private.billing_plan_periods; e jsonb; lot jsonb; n int; ending timestamptz;
BEGIN
 oid:=pg_temp.buy(uid,'plus');
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 e:=public.my_entitlement_manual();
 PERFORM pg_temp.assert(e->>'plan'='plus' AND e->>'in_grace'='false' AND e->'access_until'=e->'period_end','current paid period first');
 PERFORM pg_temp.expire(oid); SELECT * INTO b FROM private.billing_plan_periods WHERE order_id=oid;
 ending:=b.ends_at;
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM private.billing_manual_grace_period(uid,ending-interval '7 days')),'T-7 no grace');
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM private.billing_manual_grace_period(uid,ending-interval '2 days')),'T-2 no grace');
 PERFORM pg_temp.assert(EXISTS(SELECT FROM private.billing_manual_grace_period(uid,ending)),'exact T enters grace');
 PERFORM pg_temp.assert(EXISTS(SELECT FROM private.billing_manual_grace_period(uid,ending+interval '48 hours'-interval '1 microsecond')),'last instant remains eligible');
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM private.billing_manual_grace_period(uid,ending+interval '48 hours')),'exact deadline is Free');
 SELECT to_jsonb(l) INTO lot FROM public.credit_lots l WHERE billing_order_id=oid AND kind='monthly';
 SELECT count(*) INTO n FROM public.credit_ledger WHERE user_id=uid;
 e:=public.my_entitlement_manual();
 PERFORM pg_temp.assert(e->>'plan'='plus' AND e->>'status'='active' AND e->>'lapsed'='false' AND e->>'in_grace'='true','grace retains paid access');
 PERFORM pg_temp.assert((e->>'period_end')::timestamptz=ending AND (e->>'access_until')::timestamptz=ending+interval '48 hours'
  AND e->'access_until'=e->'grace_until' AND e->>'source_period_id'=b.id::text,'financial/access windows separated');
 PERFORM pg_temp.assert(public.my_entitlement_manual()=e,'repeated reads never extend grace');
 PERFORM pg_temp.assert((SELECT to_jsonb(l)=lot FROM public.credit_lots l WHERE billing_order_id=oid AND kind='monthly')
  AND (SELECT count(*)=n FROM public.credit_ledger WHERE user_id=uid),'access reads do not grant or extend lots');
 PERFORM pg_temp.assert(public.my_entitlement()->>'plan'='free','financial entitlement remains expired');
 e:=public.billing_effective_profile_manual(uid);
 PERFORM pg_temp.assert(e->>'plan'='plus' AND e->>'in_grace'='true' AND (e->>'plan_period_end')::timestamptz=ending,'trusted access projection keeps paid end');
 PERFORM private.credit_mint(uid,'topup',123,now()-interval '2 days',now()+interval '1 month','grace-topup',NULL,'grant',NULL,NULL,NULL);
 PERFORM private.credit_refresh(uid,now()); PERFORM private.credit_refresh(uid,now());
 PERFORM pg_temp.assert((SELECT remaining=0 AND expires_at=ending AND closed_at IS NOT NULL FROM public.credit_lots WHERE billing_order_id=oid AND kind='monthly'),'monthly lot expires normally');
 PERFORM pg_temp.assert((SELECT remaining=123 AND closed_at IS NULL FROM public.credit_lots WHERE user_id=uid AND source_key='grace-topup'),'topup remains spendable');
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM public.credit_lots WHERE user_id=uid AND kind='rollover'),'no rollover');
 PERFORM pg_temp.assert((SELECT count(*)=1 FROM public.credit_lots WHERE user_id=uid AND kind='monthly'),'no monthly grant from grace');
 PERFORM pg_temp.expire(oid,interval '48 hours');
 PERFORM pg_temp.assert(public.my_entitlement_manual()->>'plan'='free','wrapper expires without worker');
END $$;

-- Any paid target in grace is one full-price renewal, including higher/lower;
-- every mode preserves the original anchor/window and mints exactly once.
DO $$ DECLARE mode_name text; target text; uid uuid; oid uuid; renewal uuid; source private.billing_plan_periods; per private.billing_plan_periods; o private.billing_orders; result jsonb;
BEGIN
 FOREACH mode_name IN ARRAY ARRAY['test','live'] LOOP FOREACH target IN ARRAY ARRAY['plus','pro','max'] LOOP
  uid:=pg_temp.buyer(); oid:=pg_temp.buy(uid,'pro',mode_name); PERFORM pg_temp.expire(oid);
  SELECT * INTO source FROM private.billing_plan_periods WHERE order_id=oid;
  renewal:=pg_temp.prepare(uid,target,mode_name); SELECT * INTO o FROM private.billing_orders WHERE id=renewal;
  PERFORM pg_temp.assert(o.snapshot->>'action'='renew' AND o.snapshot->>'accessGrace'='true' AND o.snapshot->>'sourcePeriodId'=source.id::text
   AND o.amount_paise=private.billing_cycle_price(target) AND (o.snapshot->>'fraction')::numeric=1,'grace always full target renewal');
  PERFORM pg_temp.assert((o.snapshot->>'credits')::numeric=(SELECT monthly_credits FROM public.credit_plan_allowances WHERE plan::text=target),'normal full monthly allowance');
  result:=pg_temp.settle(renewal,mode_name); PERFORM pg_temp.assert(result->>'ok'='true','grace renewal capture');
  SELECT * INTO per FROM private.billing_plan_periods WHERE order_id=renewal;
  PERFORM pg_temp.assert(per.starts_at=source.ends_at AND per.anchor_at=source.anchor_at AND per.ends_at=private.billing_month_end(source.anchor_at,source.ends_at),'continuous original anchor retained');
  PERFORM pg_temp.assert((SELECT count(*)=1 AND sum(granted)=per.credits AND min(expires_at)=per.ends_at FROM public.credit_lots WHERE billing_order_id=renewal),'one correctly expiring allocation');
  result:=pg_temp.settle(renewal,mode_name);
  PERFORM pg_temp.assert(result->>'ok'='true' AND (SELECT count(*)=1 FROM public.invoices WHERE billing_order_id=renewal),'duplicate capture idempotent');
  PERFORM pg_temp.assert((SELECT count(*)=1 FROM public.credit_lots WHERE billing_order_id=renewal),'duplicate grants absent');
 END LOOP; END LOOP;
 PERFORM pg_temp.assert(private.billing_month_end('2024-01-31 10:00+05:30','2024-02-29 10:00+05:30')='2024-03-31 10:00+05:30'::timestamptz,'leap February retains day31');
 PERFORM pg_temp.assert(private.billing_month_end('2025-01-31 10:00+05:30','2025-02-28 10:00+05:30')='2025-03-31 10:00+05:30'::timestamptz,'ordinary February retains day31');
END $$;

-- Free intent is exact-cycle/environment scoped, reversible before expiry only.
DO $$ DECLARE uid uuid:=pg_temp.buyer(); oid uuid; args jsonb; b private.billing_plan_periods; cid uuid; result jsonb;
BEGIN
 oid:=pg_temp.buy(uid,'pro'); args:=jsonb_build_object('userId',uid,'account','acc_grace','mode','test');
 PERFORM public.billing_cycle_v3('schedule',args||'{"planId":"free"}');
 SELECT * INTO b FROM private.billing_plan_periods WHERE order_id=oid;
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM private.billing_manual_grace_period(uid,b.ends_at)),'pre-expiry Free is honored exactly at paid end');
 PERFORM public.billing_cycle_v2('cancel',args);
 PERFORM pg_temp.expire(oid);
 PERFORM pg_temp.assert(EXISTS(SELECT FROM private.billing_manual_grace_period(uid,now())),'pre-expiry cancelled Free does not suppress grace');
 SELECT * INTO b FROM private.billing_plan_periods WHERE order_id=oid;
 -- A different mode's pending Free must not alter this paid period.
 INSERT INTO private.billing_plan_changes(user_id,account,mode,plan,effective_at,cycle_id,state)
 VALUES(uid,'acc_grace','live','free',b.ends_at,b.id,'pending') RETURNING id INTO cid;
 PERFORM pg_temp.assert(EXISTS(SELECT FROM private.billing_manual_grace_period(uid,now())),'different-mode preference isolated');
 DELETE FROM private.billing_plan_changes WHERE id=cid; -- remove this synthetic foreign-mode fixture row
 PERFORM public.billing_cycle_v3('schedule',args||'{"planId":"free"}');
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM private.billing_manual_grace_period(uid,now())),'Free in grace takes effect now');
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 PERFORM pg_temp.assert(public.my_entitlement_manual()->>'plan'='free','intentional Free has no access grace');
 BEGIN PERFORM public.billing_cycle_v2('cancel',args); RAISE EXCEPTION 'FAIL: retained v2 cancellation revives effective Free grace'; EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM private.billing_manual_grace_period(uid,now())),'legacy v2 cannot erase effective Free evidence');
 BEGIN UPDATE private.billing_plan_changes SET state='replaced' WHERE user_id=uid AND state='pending' AND plan='free'; RAISE EXCEPTION 'FAIL: effective Free replaced'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM public.billing_cycle_v3('cancel',args); RAISE EXCEPTION 'FAIL: cancellation resurrects grace'; EXCEPTION WHEN check_violation THEN NULL; END;
 -- A subsequent paid choice starts a new financial window rather than reviving grace.
 oid:=pg_temp.buy(uid,'plus');
 PERFORM pg_temp.assert((SELECT starts_at=now() FROM private.billing_plan_periods WHERE order_id=oid),'paid restart after intentional Free uses new anchor');
END $$;

-- A paid next-plan preference can still be cancelled by retained writers after
-- expiry; it was never an intentional Free instruction.
DO $$ DECLARE uid uuid:=pg_temp.buyer(); oid uuid; args jsonb;
BEGIN
 oid:=pg_temp.buy(uid,'pro'); PERFORM pg_temp.expire(oid);
 args:=jsonb_build_object('userId',uid,'account','acc_grace','mode','test');
 PERFORM public.billing_cycle_v3('schedule',args||'{"planId":"plus"}');
 PERFORM public.billing_cycle_v2('cancel',args);
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM private.billing_plan_changes WHERE user_id=uid AND state='pending')
  AND EXISTS(SELECT FROM private.billing_manual_grace_period(uid,now())),'pending paid preference cancellation remains legal');
END $$;

-- No first-payment, manual/trial, revoked, refunded, or superseded resurrection.
DO $$ DECLARE uid uuid; oid uuid; b private.billing_plan_periods; foreign_b private.billing_plan_periods;
BEGIN
 uid:=pg_temp.buyer(); oid:=pg_temp.prepare(uid,'plus');
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM private.billing_manual_grace_period(uid,now())),'unpaid initial checkout has no grace');
 uid:=pg_temp.buyer(); UPDATE public.user_profiles SET plan='pro',plan_status='active',plan_source='manual',plan_period_end=now()-interval '1 hour' WHERE user_id=uid;
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM private.billing_manual_grace_period(uid,now())),'manual expiry has no grace');
 uid:=pg_temp.buyer(); oid:=pg_temp.buy(uid,'plus'); PERFORM pg_temp.expire(oid);
 UPDATE private.billing_plan_periods SET state='cancelled' WHERE order_id=oid;
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM private.billing_manual_grace_period(uid,now())),'revoked period has no grace');
 UPDATE private.billing_plan_periods SET state='active' WHERE order_id=oid;
 UPDATE private.billing_payments SET refunded_paise=amount_paise WHERE order_id=oid;
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM private.billing_manual_grace_period(uid,now())),'refunded period has no grace');
 uid:=pg_temp.buyer(); oid:=pg_temp.buy(uid,'plus'); PERFORM pg_temp.expire(oid);
 -- Synthetic later manual provenance: test resolver precedence independently of
 -- the legacy manual-grant trigger's non-superuser owner in this bootstrap.
 ALTER TABLE public.plan_grants DISABLE TRIGGER credits_on_plan_grant;
 INSERT INTO public.plan_grants(user_id,plan,status,period_end,source) VALUES(uid,'free','free',NULL,'manual');
 ALTER TABLE public.plan_grants ENABLE TRIGGER credits_on_plan_grant;
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM private.billing_manual_grace_period(uid,now())),'newer manual grant wins');
 uid:=pg_temp.buyer(); oid:=pg_temp.buy(uid,'plus');
 -- Capture a genuine higher revision; cancelling it cannot revive the older row.
 oid:=pg_temp.buy(uid,'pro'); PERFORM pg_temp.expire(oid);
 UPDATE private.billing_plan_periods SET state='cancelled' WHERE order_id=oid;
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM private.billing_manual_grace_period(uid,now())),'latest cancelled revision never revives old paid plan');
END $$;

-- Failed upgrade is not a new paid period and cannot restart the grace clock.
DO $$ DECLARE uid uuid:=pg_temp.buyer(); oid uuid; failed uuid; b private.billing_plan_periods; e jsonb;
BEGIN
 oid:=pg_temp.buy(uid,'plus'); failed:=pg_temp.prepare(uid,'pro');
 PERFORM pg_temp.assert((SELECT count(*)=1 FROM private.billing_plan_periods WHERE user_id=uid),'unpaid upgrade creates no period');
 PERFORM pg_temp.expire(oid); SELECT * INTO b FROM private.billing_plan_periods WHERE order_id=oid;
 PERFORM set_config('request.jwt.claim.sub',uid::text,true); e:=public.my_entitlement_manual();
 PERFORM pg_temp.assert(e->>'plan'='plus' AND e->>'source_period_id'=b.id::text AND (e->>'grace_until')::timestamptz=b.ends_at+interval '48 hours','failed upgrade retains only original paid access clock');
END $$;

-- Prepaid future coverage suppresses gap grace and activates at its true start.
DO $$ DECLARE uid uuid:=pg_temp.buyer(); oid uuid; future_oid uuid; args jsonb; e jsonb;
BEGIN
 oid:=pg_temp.buy(uid,'plus');
 UPDATE private.billing_plan_periods SET starts_at=now()-interval '25 days',ends_at=now()+interval '5 days',anchor_at=now()-interval '25 days' WHERE order_id=oid;
 UPDATE public.user_profiles SET plan_period_end=now()+interval '5 days' WHERE user_id=uid;
 future_oid:=pg_temp.buy(uid,'plus','test','renew');
 PERFORM pg_temp.expire(oid);
 PERFORM pg_temp.assert(NOT EXISTS(SELECT FROM private.billing_manual_grace_period(uid,now())),'confirmed future period blocks gap grace');
 UPDATE private.billing_plan_periods SET starts_at=now()-interval '1 second',ends_at=now()+interval '1 month' WHERE order_id=future_oid;
 PERFORM set_config('request.jwt.claim.sub',uid::text,true); e:=public.my_entitlement_manual();
 PERFORM pg_temp.assert(e->>'plan'='plus' AND e->>'in_grace'='false','paid future activation wins');
END $$;

-- Versioned credit projection includes actual v3 prorated allocations and v2 facts.
DO $$ DECLARE uid uuid:=pg_temp.buyer(); oid uuid; e jsonb; args jsonb; quote jsonb; o jsonb; pay jsonb; ref text:=replace(gen_random_uuid()::text,'-','');
BEGIN
 oid:=pg_temp.buy(uid,'plus');
 UPDATE private.billing_plan_periods SET starts_at=now()-interval '25 days',ends_at=now()+interval '5 days',anchor_at=now()-interval '25 days' WHERE order_id=oid;
 UPDATE public.user_profiles SET plan_period_end=now()+interval '5 days' WHERE user_id=uid;
 UPDATE public.credit_lots SET starts_at=now()-interval '25 days',expires_at=now()+interval '5 days' WHERE billing_order_id=oid AND kind='monthly';
 oid:=pg_temp.buy(uid,'pro'); PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 e:=public.my_credits_cycle_v3();
 PERFORM pg_temp.assert((e->'cycle'->>'allowance')::numeric=(SELECT credits FROM private.billing_plan_periods WHERE order_id=oid)
  AND (e->'cycle'->>'allowance')::numeric=27500,'v3 credit read shows actual prorated cycle allowance');
 uid:=pg_temp.buyer(); args:=jsonb_build_object('userId',uid,'account','acc_grace','mode','test','planId','plus');
 quote:=public.billing_cycle_v2('quote',args);
 o:=public.billing_cycle_v2('claim',args||jsonb_build_object('quoteId',quote->>'quoteId','requestId',gen_random_uuid(),'requestHash',ref,'snapshot',jsonb_build_object('buyerEmail','legacy@fixture.test')));
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_'||ref,'amount',o->>'amount_paise','currency','INR','receipt',o->>'id')));
 pay:=jsonb_build_object('id','pay_'||ref,'order_id','order_'||ref,'amount',o->>'amount_paise','currency','INR','status','captured');
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',pay));
 PERFORM pg_temp.assert(public.billing_cycle_capture_v2((o->>'id')::uuid,pay,'{"account":"acc_grace","mode":"test"}')->>'ok'='true','retained v2 recovery capture succeeds');
 PERFORM set_config('request.jwt.claim.sub',uid::text,true); e:=public.my_credits_cycle_v3();
 PERFORM pg_temp.assert((e->'cycle'->>'allowance')::numeric=20000,'new credit reader accepts v2 paid period');
END $$;

-- Stale captures enter review, and after grace a fresh purchase restarts its anchor.
DO $$ DECLARE uid uuid; oid uuid; renewal uuid; result jsonb; args jsonb; q jsonb; other uuid;
BEGIN
 uid:=pg_temp.buyer(); oid:=pg_temp.buy(uid,'plus'); PERFORM pg_temp.expire(oid); renewal:=pg_temp.prepare(uid,'max');
 -- A newly chosen Free preference changes access immediately without minting.
 args:=jsonb_build_object('userId',uid,'account','acc_grace','mode','test');
 PERFORM public.billing_cycle_v3('schedule',args||'{"planId":"free"}');
 result:=pg_temp.settle(renewal);
 PERFORM pg_temp.assert(result->>'status'='review' AND NOT EXISTS(SELECT FROM public.invoices WHERE billing_order_id=renewal),'Free selected after quote invalidates capture');
 uid:=pg_temp.buyer(); oid:=pg_temp.buy(uid,'plus'); PERFORM pg_temp.expire(oid); renewal:=pg_temp.prepare(uid,'pro');
 PERFORM pg_temp.expire(oid,interval '49 hours'); result:=pg_temp.settle(renewal);
 PERFORM pg_temp.assert(result->>'status'='review' AND NOT EXISTS(SELECT FROM public.credit_lots WHERE billing_order_id=renewal),'capture after grace grants nothing');
 oid:=pg_temp.buy(uid,'pro');
 PERFORM pg_temp.assert((SELECT starts_at=now() AND anchor_at=now() FROM private.billing_plan_periods WHERE order_id=oid),'after grace starts a fresh cycle');
 uid:=pg_temp.buyer(); oid:=pg_temp.buy(uid,'plus'); PERFORM pg_temp.expire(oid);
 BEGIN PERFORM public.billing_cycle_v3('quote',jsonb_build_object('userId',uid,'account','acc_grace','mode','live','planId','pro')); RAISE EXCEPTION 'FAIL: cross-mode source'; EXCEPTION WHEN check_violation THEN NULL; END;
 args:=jsonb_build_object('userId',uid,'account','acc_grace','mode','test','planId','pro'); q:=public.billing_cycle_v3('quote',args);
 other:=pg_temp.buyer();
 BEGIN PERFORM public.billing_cycle_v3('claim',args||jsonb_build_object('userId',other,'quoteId',q->>'quoteId','requestId',gen_random_uuid(),'requestHash','foreign')); RAISE EXCEPTION 'FAIL: foreign quote'; EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',other::text,true);
 PERFORM pg_temp.assert(public.my_entitlement_manual()->>'plan'='free','authenticated wrapper cannot see another buyer grace');
END $$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.assert(public.my_entitlement_manual()->>'plan'='free','actual authenticated own-read execution');
RESET ROLE;

SELECT pg_temp.assert(NOT has_function_privilege('authenticated','public.billing_cycle_v3(text,jsonb)','execute')
 AND NOT has_function_privilege('anon','public.my_entitlement_manual()','execute')
 AND NOT has_function_privilege('anon','public.my_credits_cycle_v3()','execute')
 AND NOT has_function_privilege('service_role','private.billing_preserve_effective_free()','execute')
 AND NOT has_function_privilege('authenticated','public.billing_effective_profile_manual(uuid)','execute')
 AND NOT has_function_privilege('service_role','private.billing_manual_grace_period(uuid,timestamptz)','execute'),'private/service boundaries');
SELECT pg_temp.assert(has_function_privilege('authenticated','public.my_entitlement_manual()','execute')
 AND has_function_privilege('authenticated','public.my_credits_cycle_v3()','execute')
 AND has_function_privilege('service_role','public.billing_cycle_capture_v3(uuid,jsonb,jsonb)','execute'),'intended access grants');
SELECT pg_temp.assert((private.credit_config()).rollover_pct=0,'no rollover setting change');
ROLLBACK;
