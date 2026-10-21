-- Additive daily quote contract; omit daily migration for non-vacuity.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert(ok boolean,why text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',why; END IF; END $$;
SELECT pg_temp.assert(to_regprocedure('private.billing_day_window(timestamptz,timestamptz,timestamptz)') IS NOT NULL,'daily contract absent');
DO $$ DECLARE a record; b record; c record; BEGIN
 SELECT * INTO a FROM private.billing_day_window('2026-10-20 16:13Z','2026-11-20 16:13Z','2026-10-20 16:14Z');
 SELECT * INTO b FROM private.billing_day_window('2026-10-20 16:13Z','2026-11-20 16:13Z','2026-10-20 18:29Z');
 PERFORM pg_temp.assert(a.fraction=1 AND b.fraction=a.fraction AND a.remaining_days=31,'same IST date full difference');
 SELECT * INTO c FROM private.billing_day_window('2026-10-20 16:13Z','2026-11-20 16:13Z','2026-10-20 18:30Z');
 PERFORM pg_temp.assert(c.remaining_days=30 AND c.cycle_days=31 AND c.fraction=30::numeric/31,'changes only at IST midnight');
 PERFORM pg_temp.assert(a.expires_at='2026-10-20 18:30Z','quote valid through IST day');
 SELECT * INTO b FROM private.billing_day_window('2026-10-01 00:00Z','2026-11-01 00:00Z','2026-10-05 00:00Z');
 SELECT * INTO c FROM private.billing_day_window('2026-10-01 00:00Z','2026-11-01 00:00Z','2026-10-25 00:00Z');
 PERFORM pg_temp.assert(round(60000*b.fraction)=52258 AND round(45000*b.fraction,4)=39193.5484,'5th: matching price and credit fraction');
 PERFORM pg_temp.assert(round(60000*c.fraction)=13548 AND round(45000*c.fraction,4)=10161.2903,'25th: fewer remaining days');
 PERFORM pg_temp.assert(round(900000*c.fraction)=203226 AND round(685000*c.fraction,4)=154677.4194,'Pro to Max uses same daily fraction');
 PERFORM pg_temp.assert(round(960000*c.fraction)=216774 AND round(730000*c.fraction,4)=164838.7097,'Plus to Max uses same daily fraction');
 SELECT * INTO c FROM private.billing_day_window('2026-10-20 16:13Z','2026-11-20 16:13Z','2026-11-20 15:00Z');
 PERFORM pg_temp.assert(c.remaining_days=1 AND c.expires_at='2026-11-20 16:13Z','last partial day exact expiry');
 SELECT * INTO c FROM private.billing_day_window('2028-02-01 00:00Z','2028-03-01 00:00Z','2028-02-05 01:00Z');
 PERFORM pg_temp.assert(c.cycle_days=29 AND c.remaining_days=25,'leap calendar days');
 SELECT * INTO c FROM private.billing_day_window('2026-10-20 16:13Z','2026-11-20 16:13Z','2026-11-20 16:13Z');
 PERFORM pg_temp.assert(c.fraction=0 AND c.remaining_days=0,'no upgrade after exact expiry');
END $$;
-- Real daily quote through the same buyer/merchant/plan checks.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $$ DECLARE uid uuid:=gen_random_uuid(); args jsonb; q jsonb; o jsonb; pay jsonb; result jsonb; period uuid; expected record;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(uid,'daily@fixture.test'); UPDATE public.user_profiles SET status='active' WHERE user_id=uid;
 args:=jsonb_build_object('userId',uid,'account','acc_daily','mode','test','planId','plus');
 q:=public.billing_cycle_daily('quote',args);
 o:=public.billing_cycle_daily('claim',args||jsonb_build_object('quoteId',q->>'quoteId','requestId',gen_random_uuid(),'requestHash','daily-start','snapshot',jsonb_build_object('buyerEmail','daily@fixture.test')));
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_daystart','amount',39900,'currency','INR','receipt',o->>'id')));
 pay:='{"id":"pay_daystart","order_id":"order_daystart","amount":39900,"currency":"INR","status":"captured"}';
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',pay));
 result:=public.billing_cycle_capture((o->>'id')::uuid,pay);
 PERFORM pg_temp.assert(result->>'ok'='true','daily contract uses captured-only engine');
 SELECT id INTO period FROM private.billing_plan_periods WHERE order_id=(o->>'id')::uuid;
 SELECT * INTO expected FROM private.billing_day_window(now(),(q->>'cycleEndsAt')::timestamptz,now());
 q:=public.billing_cycle_daily('quote',args||'{"planId":"pro"}');
 PERFORM pg_temp.assert((q->>'amountPaise')::bigint=60000 AND (q->>'credits')::numeric=45000,'same-day Plus to Pro full delta');
 PERFORM pg_temp.assert(q->>'prorationBasis'='ist-calendar-day-v1' AND (q->>'remainingDays')::int=expected.remaining_days,'immutable daily quote basis');
 PERFORM pg_temp.assert((q->>'expiresAt')::timestamptz=expected.expires_at,'daily quote expiry');
 o:=public.billing_cycle_daily('claim',args||jsonb_build_object('planId','pro','quoteId',q->>'quoteId','requestId',gen_random_uuid(),'requestHash','daily-upgrade','snapshot',jsonb_build_object('buyerEmail','daily@fixture.test')));
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_dayup','amount',60000,'currency','INR','receipt',o->>'id')));
 pay:='{"id":"pay_dayup","order_id":"order_dayup","amount":60000,"currency":"INR","status":"captured"}';
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',pay));
 result:=public.billing_cycle_capture((o->>'id')::uuid,pay);
 PERFORM pg_temp.assert(result->>'ok'='true','daily upgrade captured');
 PERFORM pg_temp.assert((SELECT sum(granted)=65000 FROM public.credit_lots WHERE user_id=uid AND kind='monthly'),'same-day cumulative allowance');
 PERFORM pg_temp.assert(public.billing_cycle_capture((o->>'id')::uuid,pay)->'invoice'->>'id'=result->'invoice'->>'id','daily replay preserves invoice');
END $$;
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','public.billing_cycle_daily(text,jsonb)','execute'),'daily quote server-only');
ROLLBACK;
