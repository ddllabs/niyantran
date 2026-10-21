-- Local-only Razorpay purchase contract. Additive: no historic credit backfill.
-- Rollback: close new checkout; preserve paid facts and recovery. Disposable tests
-- may drop these objects/rebuild. Never drop financial records in production.
BEGIN;
CREATE TABLE private.billing_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 customer_id uuid NOT NULL, request_id uuid NOT NULL, request_hash text NOT NULL,
 account text NOT NULL, mode text NOT NULL CHECK(mode IN ('test','live')),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 amount_paise bigint NOT NULL CHECK(amount_paise>0), currency text NOT NULL CHECK(currency='INR'),
 provider_order_id text, state text NOT NULL DEFAULT 'creating' CHECK(state IN ('creating','ready','reconciling','fulfilled','review','refunded')),
 fulfilled_payment_id uuid, created_at timestamptz NOT NULL DEFAULT now(), fulfilled_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_token uuid, attempts integer NOT NULL DEFAULT 0,
 UNIQUE(customer_id,request_id), UNIQUE(account,mode,provider_order_id)
);
CREATE INDEX billing_orders_user ON private.billing_orders(user_id,created_at DESC);
CREATE INDEX billing_orders_recovery ON private.billing_orders(next_attempt_at) WHERE state<>'fulfilled';
CREATE TABLE private.billing_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES private.billing_orders(id),
 account text NOT NULL, mode text NOT NULL CHECK(mode IN ('test','live')), provider_payment_id text NOT NULL,
 amount_paise bigint NOT NULL CHECK(amount_paise>0), currency text NOT NULL CHECK(currency='INR'),
 status text NOT NULL, refunded_paise bigint NOT NULL DEFAULT 0 CHECK(refunded_paise>=0 AND refunded_paise<=amount_paise),
 captured_at timestamptz, observed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account,mode,provider_payment_id), UNIQUE(order_id,id)
);
ALTER TABLE private.billing_orders ADD CONSTRAINT billing_selected_payment FOREIGN KEY(id,fulfilled_payment_id)
 REFERENCES private.billing_payments(order_id,id);
CREATE INDEX billing_payments_order ON private.billing_payments(order_id);
CREATE TABLE private.billing_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account text NOT NULL, mode text NOT NULL CHECK(mode IN ('test','live')),
 provider_event_id text NOT NULL, event_type text NOT NULL, body_hash text NOT NULL,
 payload jsonb NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done','error')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_token uuid,
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(account,mode,provider_event_id)
);
CREATE INDEX billing_events_pending ON private.billing_events(next_attempt_at) WHERE state<>'done';
CREATE TABLE private.billing_adjustments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL REFERENCES private.billing_payments(id),
 provider_adjustment_id text NOT NULL, revision text NOT NULL DEFAULT '', kind text NOT NULL CHECK(kind IN ('refund','dispute','overpayment','purchase_review')),
 amount_paise bigint NOT NULL CHECK(amount_paise>=0), provider_status text NOT NULL,
 decision jsonb, request_id uuid UNIQUE, reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(payment_id,kind,provider_adjustment_id,revision)
);
CREATE INDEX billing_adjustments_payment ON private.billing_adjustments(payment_id);
CREATE TABLE private.billing_plan_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE REFERENCES private.billing_orders(id),
 user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, plan public.app_plan NOT NULL CHECK(plan<>'free'),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, anchor_at timestamptz NOT NULL,
 credits numeric(14,4) NOT NULL CHECK(credits>0), state text NOT NULL CHECK(state IN ('scheduled','active','superseded','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_at>starts_at)
);
CREATE INDEX billing_periods_user ON private.billing_plan_periods(user_id,starts_at,ends_at);
ALTER TABLE public.invoices ADD COLUMN billing_order_id uuid UNIQUE REFERENCES private.billing_orders(id);
ALTER TABLE public.plan_grants ADD COLUMN billing_plan_period_id uuid UNIQUE REFERENCES private.billing_plan_periods(id);
ALTER TABLE public.user_profiles ADD COLUMN active_billing_plan_period_id uuid REFERENCES private.billing_plan_periods(id);
ALTER TABLE public.credit_lots ADD COLUMN billing_order_id uuid REFERENCES private.billing_orders(id),
 ADD COLUMN billing_plan_period_id uuid REFERENCES private.billing_plan_periods(id);
ALTER TABLE public.credit_ledger ADD COLUMN billing_order_id uuid REFERENCES private.billing_orders(id),
 ADD COLUMN billing_adjustment_id uuid REFERENCES private.billing_adjustments(id);
CREATE INDEX plan_grants_billing_period ON public.plan_grants(billing_plan_period_id) WHERE billing_plan_period_id IS NOT NULL;
CREATE INDEX profiles_billing_period ON public.user_profiles(active_billing_plan_period_id) WHERE active_billing_plan_period_id IS NOT NULL;
CREATE INDEX credit_lots_billing_order ON public.credit_lots(billing_order_id) WHERE billing_order_id IS NOT NULL;
CREATE INDEX credit_lots_billing_period ON public.credit_lots(billing_plan_period_id) WHERE billing_plan_period_id IS NOT NULL;
CREATE INDEX credit_ledger_billing_order ON public.credit_ledger(billing_order_id) WHERE billing_order_id IS NOT NULL;
CREATE INDEX credit_ledger_billing_adjustment ON public.credit_ledger(billing_adjustment_id) WHERE billing_adjustment_id IS NOT NULL;

-- Only service RPCs below can access raw financial facts. No direct DML grants.
ALTER TABLE private.billing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.billing_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.billing_plan_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.billing_orders,private.billing_payments,private.billing_events,
 private.billing_adjustments,private.billing_plan_periods FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the proven legacy inference, but remove linked purchases BEFORE lag
-- and next-cycle calculations, not merely from its final output.
DO $$ DECLARE f text;
BEGIN
 SELECT pg_get_functiondef('private.credit_due_cycles(uuid,timestamptz)'::regprocedure) INTO f;
 IF position('FROM public.plan_grants pg WHERE pg.user_id = p_user' in f)=0 THEN
   RAISE EXCEPTION 'Unexpected credit_due_cycles definition; review migration';
 END IF;
 f:=replace(f,'FUNCTION private.credit_due_cycles(', 'FUNCTION private.credit_due_cycles_legacy(');
 f:=replace(f,'FROM public.plan_grants pg WHERE pg.user_id = p_user',
   'FROM public.plan_grants pg WHERE pg.user_id = p_user AND pg.billing_plan_period_id IS NULL');
 EXECUTE f;
END $$;
CREATE OR REPLACE FUNCTION private.credit_due_cycles(p_user uuid,p_now timestamptz)
RETURNS TABLE(source_key text,plan public.app_plan,credits numeric,starts_at timestamptz,expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT c.source_key,c.plan,c.credits,c.starts_at,
   least(c.expires_at,coalesce((SELECT min(b.starts_at) FROM private.billing_plan_periods b
    WHERE b.user_id=p_user AND b.state IN ('scheduled','active') AND b.starts_at>c.starts_at),'infinity'))
 FROM private.credit_due_cycles_legacy(p_user,p_now) c
 WHERE NOT EXISTS(SELECT FROM private.billing_plan_periods b WHERE b.user_id=p_user
   AND b.state IN ('scheduled','active') AND b.starts_at<=p_now AND b.ends_at>p_now
   AND NOT EXISTS(SELECT FROM public.plan_grants g WHERE g.user_id=p_user AND g.source='manual' AND g.id>coalesce((SELECT max(linked.id) FROM public.plan_grants linked WHERE linked.billing_plan_period_id=b.id),9223372036854775807)))
 AND NOT EXISTS(SELECT FROM private.billing_plan_periods b JOIN public.plan_grants linked ON linked.billing_plan_period_id=b.id
   WHERE b.user_id=p_user AND b.starts_at<=p_now AND linked.id>
   CASE WHEN c.source_key LIKE 'grant:%' THEN split_part(c.source_key,':',2)::bigint ELSE 0 END)

 UNION ALL
 SELECT 'period:'||b.id,b.plan,b.credits,b.starts_at,b.ends_at
 FROM private.billing_plan_periods b WHERE b.user_id=p_user AND b.state IN ('scheduled','active')
 AND b.starts_at<=p_now AND b.ends_at>p_now
 AND NOT EXISTS(SELECT FROM public.plan_grants g WHERE g.user_id=p_user AND g.source='manual' AND g.id>coalesce((SELECT max(linked.id) FROM public.plan_grants linked WHERE linked.billing_plan_period_id=b.id),9223372036854775807));
$$;

-- Read-only resolver works even on wallet-first paths: never locks the profile.
CREATE OR REPLACE FUNCTION public.entitlement_from(p public.user_profiles) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE b private.billing_plan_periods; newer_manual boolean;
BEGIN
 SELECT * INTO b FROM private.billing_plan_periods x WHERE x.user_id=p.user_id
 AND x.state IN ('scheduled','active') AND x.starts_at<=now() AND x.ends_at>now()
 ORDER BY x.starts_at DESC LIMIT 1;
 IF FOUND THEN
  SELECT EXISTS(SELECT FROM public.plan_grants g WHERE g.user_id=p.user_id AND g.source='manual' AND g.id>coalesce((SELECT max(linked.id) FROM public.plan_grants linked WHERE linked.billing_plan_period_id=b.id),9223372036854775807)) INTO newer_manual;
  IF NOT newer_manual THEN
   RETURN jsonb_build_object('plan',b.plan,'status','active','period_end',b.ends_at,'lapsed',false,
    'granted_plan',b.plan,'source','payment','trial_used',p.trial_started_at IS NOT NULL);
  END IF;
 END IF;
 RETURN (CASE WHEN p.plan_status<>'free' AND p.plan_period_end IS NOT NULL AND p.plan_period_end<=now()
 THEN jsonb_build_object('plan','free','status','free','period_end',p.plan_period_end,'lapsed',true)
 ELSE jsonb_build_object('plan',p.plan,'status',p.plan_status,'period_end',p.plan_period_end,'lapsed',false) END)
 ||jsonb_build_object('granted_plan',p.plan,'source',p.plan_source,'trial_used',p.trial_started_at IS NOT NULL);
END $$;
-- A private lookup is required for direct entitlement_from calls too.
ALTER FUNCTION public.entitlement_from(public.user_profiles) SECURITY DEFINER;

-- Existing trusted manual grants supersede queued purchases and projections.
CREATE OR REPLACE FUNCTION public.credits_on_plan_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
BEGIN
 IF NEW.source='manual' THEN
  UPDATE private.billing_plan_periods SET state='cancelled' WHERE user_id=NEW.user_id AND state IN ('active','scheduled');
  UPDATE public.user_profiles SET active_billing_plan_period_id=NULL WHERE user_id=NEW.user_id;
 END IF;
 PERFORM private.credit_refresh(NEW.user_id,now(),NEW.source='manual');
 RETURN NULL;
END $$;

CREATE FUNCTION private.billing_month_end(p_anchor timestamptz,p_start timestamptz) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE a timestamp:=p_anchor AT TIME ZONE 'Asia/Kolkata'; s timestamp:=p_start AT TIME ZONE 'Asia/Kolkata'; n int; e timestamp;
BEGIN
 n:=greatest(0,(extract(year FROM age(s,a))*12+extract(month FROM age(s,a)))::int);
 e:=a+make_interval(months=>n+1);
 WHILE e<=s LOOP n:=n+1; e:=a+make_interval(months=>n+1); END LOOP;
 RETURN e AT TIME ZONE 'Asia/Kolkata';
END $$;

CREATE FUNCTION private.billing_lot_provenance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b private.billing_plan_periods; parent public.credit_lots;
BEGIN
 IF NEW.source_key LIKE 'period:%' THEN
  SELECT * INTO b FROM private.billing_plan_periods WHERE id=substring(NEW.source_key FROM 8)::uuid;
  NEW.billing_order_id:=b.order_id; NEW.billing_plan_period_id:=b.id;
 ELSIF NEW.source_key LIKE 'rollover:%' THEN
  SELECT * INTO parent FROM public.credit_lots WHERE id=substring(NEW.source_key FROM 10)::uuid;
  NEW.billing_order_id:=parent.billing_order_id; NEW.billing_plan_period_id:=parent.billing_plan_period_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_lot_provenance BEFORE INSERT ON public.credit_lots FOR EACH ROW EXECUTE FUNCTION private.billing_lot_provenance();
CREATE FUNCTION private.billing_entry_provenance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.lot_id IS NOT NULL THEN
  SELECT l.billing_order_id INTO NEW.billing_order_id FROM public.credit_lots l WHERE l.id=NEW.lot_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_entry_provenance BEFORE INSERT ON public.credit_ledger FOR EACH ROW EXECUTE FUNCTION private.billing_entry_provenance();

-- Projection activation is an entrypoint operation, always profile-first.
-- Never call this from credit_refresh, which can already hold a wallet lock.
CREATE FUNCTION private.billing_activate_period(p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE prof public.user_profiles; b private.billing_plan_periods;
BEGIN
 SELECT * INTO prof FROM public.user_profiles WHERE user_id=p_user AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO b FROM private.billing_plan_periods x WHERE x.user_id=p_user AND x.state IN ('active','scheduled')
  AND x.starts_at<=now() AND x.ends_at>now() ORDER BY x.starts_at DESC LIMIT 1;
 IF NOT FOUND OR EXISTS(SELECT FROM public.plan_grants g WHERE g.user_id=p_user AND g.source='manual'
  AND g.id>coalesce((SELECT max(id) FROM public.plan_grants WHERE billing_plan_period_id=b.id),9223372036854775807)) THEN RETURN; END IF;
 UPDATE public.user_profiles SET plan=b.plan,plan_status='active',plan_source='payment',plan_period_end=b.ends_at,active_billing_plan_period_id=b.id
  WHERE user_id=p_user AND (active_billing_plan_period_id IS DISTINCT FROM b.id OR plan_period_end IS DISTINCT FROM b.ends_at);
 UPDATE private.billing_plan_periods SET state='active' WHERE id=b.id AND state='scheduled';
END $$;
ALTER FUNCTION private.billing_activate_period(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.billing_activate_period(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.my_entitlement() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE prof public.user_profiles;
BEGIN
 PERFORM private.billing_activate_period(auth.uid());
 SELECT * INTO prof FROM public.user_profiles WHERE user_id=auth.uid() AND status='active';
 RETURN CASE WHEN FOUND THEN public.entitlement_from(prof) ELSE NULL END;
END $$;
-- Trusted chat consumers also activate the projection before reserving credits.
CREATE FUNCTION public.billing_effective_profile(p_user uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE prof public.user_profiles; e jsonb;
BEGIN
 PERFORM private.billing_activate_period(p_user);
 SELECT * INTO prof FROM public.user_profiles WHERE user_id=p_user;
 IF NOT FOUND THEN RETURN NULL; END IF;
 e:=public.entitlement_from(prof);
 RETURN jsonb_build_object('status',prof.status,'plan',e->>'plan','plan_status',e->>'status','plan_period_end',e->>'period_end');
END $$;

CREATE FUNCTION public.billing_order(p_action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE o private.billing_orders; snap jsonb; fresh boolean:=false; v jsonb;
BEGIN
 IF p_action='claim' THEN
  IF NOT EXISTS(SELECT FROM public.user_profiles WHERE user_id=(p->>'userId')::uuid AND status='active') THEN
   RAISE EXCEPTION 'Active buyer required' USING ERRCODE='42501'; END IF;
  snap:=p->'snapshot';
  IF snap->>'creditUnit' IS DISTINCT FROM 'credit-paise-v2' OR snap->>'currency' IS DISTINCT FROM 'INR'
   OR coalesce(snap->>'kind','') NOT IN ('plan','topup') OR coalesce((snap->>'credits')::numeric,0)<=0
   OR nullif(p->>'account','') IS NULL THEN RAISE EXCEPTION 'Invalid purchase snapshot' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT FROM private.billing_orders WHERE customer_id=(p->>'userId')::uuid AND request_id=(p->>'requestId')::uuid) THEN
   -- Per-buyer serialisation makes the durable creation limit race-safe.
   PERFORM 1 FROM public.user_profiles WHERE user_id=(p->>'userId')::uuid FOR UPDATE;
   IF (SELECT count(*) FROM private.billing_orders WHERE user_id=(p->>'userId')::uuid AND created_at>now()-interval '15 minutes')>=10 THEN
    RAISE EXCEPTION 'Too many purchase attempts' USING ERRCODE='54000'; END IF;
   IF snap->>'kind'='plan' AND EXISTS(SELECT FROM public.user_profiles WHERE user_id=(p->>'userId')::uuid AND plan_status='active' AND plan_period_end IS NULL) THEN
    RAISE EXCEPTION 'Contact support to change an open-ended manual plan' USING ERRCODE='22023'; END IF;
  END IF;
  IF snap->>'kind'='plan' AND (snap->>'credits')::numeric IS DISTINCT FROM
    (SELECT monthly_credits FROM public.credit_plan_allowances WHERE plan::text=snap->>'planId') THEN
   RAISE EXCEPTION 'Plan catalogue and allowance configuration disagree' USING ERRCODE='22023'; END IF;
  snap:=snap||jsonb_build_object('grantVersion',coalesce((SELECT max(id) FROM public.plan_grants WHERE user_id=(p->>'userId')::uuid),0));
  INSERT INTO private.billing_orders(user_id,customer_id,request_id,request_hash,account,mode,snapshot,amount_paise,currency)
   VALUES((p->>'userId')::uuid,(p->>'userId')::uuid,(p->>'requestId')::uuid,p->>'requestHash',p->>'account',p->>'mode',snap,(snap->>'amountPaise')::bigint,'INR')
   ON CONFLICT(customer_id,request_id) DO NOTHING RETURNING * INTO o;
  fresh:=FOUND;
  IF NOT fresh THEN
   SELECT * INTO o FROM private.billing_orders WHERE customer_id=(p->>'userId')::uuid AND request_id=(p->>'requestId')::uuid;
   IF o.request_hash IS DISTINCT FROM p->>'requestHash' OR o.account IS DISTINCT FROM p->>'account' OR o.mode IS DISTINCT FROM p->>'mode' THEN
    RAISE EXCEPTION 'Request ID payload conflict' USING ERRCODE='23505'; END IF;
  END IF;
  RETURN to_jsonb(o)||jsonb_build_object('fresh',fresh);
 ELSIF p_action='list' THEN
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT id,provider_order_id,state,snapshot,created_at FROM private.billing_orders
   WHERE user_id=(p->>'userId')::uuid AND account=p->>'account' AND mode=p->>'mode' ORDER BY created_at DESC LIMIT 30) t),'[]');
 ELSIF p_action='get' THEN
  SELECT * INTO o FROM private.billing_orders WHERE (id=nullif(p->>'purchaseId','')::uuid OR provider_order_id=p->>'orderId')
  AND account=p->>'account' AND mode=p->>'mode' AND (p->>'userId' IS NULL OR user_id=(p->>'userId')::uuid);
  RETURN CASE WHEN FOUND THEN to_jsonb(o) ELSE NULL END;
 ELSIF p_action='bind' THEN
  SELECT * INTO o FROM private.billing_orders WHERE id=(p->>'purchaseId')::uuid FOR UPDATE;
  v:=p->'order';
  IF o.id IS NULL OR v->>'id' !~ '^order_[A-Za-z0-9]+$' OR v->>'currency' IS DISTINCT FROM o.currency
  OR (v->>'amount')::bigint IS DISTINCT FROM o.amount_paise OR v->>'receipt' IS DISTINCT FROM o.id::text
  OR (o.provider_order_id IS NOT NULL AND o.provider_order_id<>v->>'id') THEN RAISE EXCEPTION 'Provider order mismatch' USING ERRCODE='22023'; END IF;
  UPDATE private.billing_orders SET provider_order_id=v->>'id',state=CASE WHEN state='fulfilled' THEN state ELSE 'ready' END WHERE id=o.id RETURNING * INTO o;
  RETURN to_jsonb(o);
 ELSIF p_action='payment' THEN
  SELECT * INTO o FROM private.billing_orders WHERE id=(p->>'purchaseId')::uuid FOR UPDATE;
  v:=p->'payment';
  IF o.id IS NULL OR v->>'id' !~ '^pay_[A-Za-z0-9]+$' OR v->>'order_id' IS DISTINCT FROM o.provider_order_id
  OR v->>'currency' IS DISTINCT FROM o.currency OR (v->>'amount')::bigint IS DISTINCT FROM o.amount_paise
  OR v->>'status' IS NULL THEN RAISE EXCEPTION 'Provider payment mismatch' USING ERRCODE='22023'; END IF;
  INSERT INTO private.billing_payments(order_id,account,mode,provider_payment_id,amount_paise,currency,status,refunded_paise,captured_at)
   VALUES(o.id,o.account,o.mode,v->>'id',o.amount_paise,o.currency,v->>'status',coalesce((v->>'amount_refunded')::bigint,0),
   CASE WHEN v->>'status'='captured' THEN now() END)
   ON CONFLICT(account,mode,provider_payment_id) DO UPDATE SET
    status=CASE WHEN private.billing_payments.refunded_paise>0 OR private.billing_payments.status='captured' THEN private.billing_payments.status ELSE excluded.status END,
    refunded_paise=greatest(private.billing_payments.refunded_paise,excluded.refunded_paise),observed_at=now()
   WHERE private.billing_payments.order_id=excluded.order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment already bound elsewhere'; END IF;
  IF v->>'status'='refunded' OR coalesce((v->>'amount_refunded')::bigint,0)>0 THEN
   UPDATE private.billing_orders SET state='review' WHERE id=o.id AND state NOT IN ('fulfilled','refunded');
   INSERT INTO private.billing_adjustments(payment_id,provider_adjustment_id,kind,amount_paise,provider_status)
    SELECT id,'observed:'||provider_payment_id,'purchase_review',refunded_paise,'Refund observed; review benefits'
    FROM private.billing_payments WHERE order_id=o.id AND provider_payment_id=v->>'id'
    ON CONFLICT(payment_id,kind,provider_adjustment_id,revision) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='recovery' THEN
  WITH selected AS (SELECT id FROM private.billing_orders WHERE account=p->>'account' AND mode=p->>'mode'
   AND state NOT IN ('fulfilled','review','refunded') AND created_at<now()-interval '2 minutes'
   AND next_attempt_at<=now() AND coalesce(lease_until,'-infinity')<now()
   ORDER BY created_at LIMIT least(greatest(coalesce((p->>'limit')::int,10),1),25) FOR UPDATE SKIP LOCKED),
  claimed AS (UPDATE private.billing_orders o1 SET lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid()
   FROM selected x WHERE o1.id=x.id RETURNING o1.*)
  SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') INTO v FROM claimed t;
  RETURN v;
 ELSIF p_action='defer' THEN
  UPDATE private.billing_orders SET attempts=attempts+1,next_attempt_at=now()+interval '5 minutes',lease_until=NULL,lease_token=NULL,
   state=CASE WHEN state='creating' THEN 'reconciling' ELSE state END
  WHERE id=(p->>'purchaseId')::uuid AND state<>'fulfilled'
   AND (lease_token IS NULL OR lease_token=nullif(p->>'leaseToken','')::uuid);
  RETURN jsonb_build_object('ok',true);
 END IF;
 RAISE EXCEPTION 'Unknown billing order operation' USING ERRCODE='22023';
END $$;

CREATE FUNCTION private.billing_hold_order(p_order uuid,p_payment uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE private.billing_orders SET state='review' WHERE id=p_order AND state NOT IN ('fulfilled','refunded');
 INSERT INTO private.billing_adjustments(payment_id,provider_adjustment_id,kind,amount_paise,provider_status)
 SELECT id,'purchase:'||p_order,'purchase_review',amount_paise,p_reason FROM private.billing_payments WHERE id=p_payment
 ON CONFLICT(payment_id,kind,provider_adjustment_id,revision) DO NOTHING;
END $$;

CREATE FUNCTION public.billing_capture(p_order_id uuid,p_payment jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE o private.billing_orders; pay private.billing_payments; prof public.user_profiles; s public.credit_settings;
 inv public.invoices; lot uuid; per private.billing_plan_periods; start_at timestamptz; anchor timestamptz;
 current_plan text; cur jsonb; snap jsonb;
BEGIN
 SELECT * INTO o FROM private.billing_orders WHERE id=p_order_id FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Unknown purchase'; END IF;
 SELECT * INTO pay FROM private.billing_payments WHERE order_id=o.id AND provider_payment_id=p_payment->>'id' FOR UPDATE;
 IF pay.id IS NULL OR p_payment->>'order_id' IS DISTINCT FROM o.provider_order_id OR p_payment->>'currency' IS DISTINCT FROM 'INR'
 OR (p_payment->>'amount')::bigint IS DISTINCT FROM o.amount_paise OR pay.amount_paise<>o.amount_paise THEN
  RAISE EXCEPTION 'Capture binding mismatch' USING ERRCODE='22023'; END IF;
 IF o.state='refunded' THEN RETURN jsonb_build_object('ok',false,'pending',false,'status','refunded'); END IF;
 IF o.state='fulfilled' THEN
  IF o.fulfilled_payment_id<>pay.id AND p_payment->>'status'='captured' AND pay.status='captured' THEN
   INSERT INTO private.billing_adjustments(payment_id,provider_adjustment_id,kind,amount_paise,provider_status)
    VALUES(pay.id,pay.provider_payment_id,'overpayment',pay.amount_paise,'review') ON CONFLICT DO NOTHING;
   RETURN jsonb_build_object('ok',false,'pending',true,'status','review');
  END IF;
  IF o.fulfilled_payment_id<>pay.id THEN RETURN jsonb_build_object('ok',false,'status','pending','pending',true); END IF;
  SELECT * INTO inv FROM public.invoices WHERE billing_order_id=o.id;
  RETURN jsonb_build_object('ok',true,'status','fulfilled','invoice',to_jsonb(inv));
 END IF;
 IF p_payment->>'status' IS DISTINCT FROM 'captured' OR pay.status<>'captured' THEN
  RETURN jsonb_build_object('ok',false,'pending',true,'status','pending'); END IF;
 IF pay.refunded_paise>0 OR EXISTS(SELECT FROM private.billing_adjustments WHERE payment_id=pay.id AND kind IN ('refund','dispute')) THEN
  PERFORM private.billing_hold_order(o.id,pay.id,'Captured purchase requires reviewed resolution');
  RETURN jsonb_build_object('ok',false,'pending',true,'status','review'); END IF;
 SELECT * INTO prof FROM public.user_profiles WHERE user_id=o.user_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN PERFORM private.billing_hold_order(o.id,pay.id,'Captured purchase requires reviewed resolution');
  RETURN jsonb_build_object('ok',false,'pending',true,'status','review'); END IF;
 s:=private.credit_config(); -- profile -> denomination barrier -> wallet -> invoice counter
 IF s.inr_per_credit<>0.01 THEN RAISE EXCEPTION 'Purchase credit unit mismatch'; END IF;
 PERFORM private.credit_refresh(o.user_id,now());
 snap:=o.snapshot;
 IF snap->>'kind'='plan' AND (snap->>'grantVersion')::bigint IS DISTINCT FROM coalesce((SELECT max(id) FROM public.plan_grants WHERE user_id=o.user_id),0) THEN
  PERFORM private.billing_hold_order(o.id,pay.id,'Plan changed after checkout; confirm refund');
  RETURN jsonb_build_object('ok',false,'pending',true,'status','review');
 END IF;
 IF snap->>'kind'='topup' THEN
  lot:=private.credit_mint(o.user_id,'topup',(snap->>'credits')::numeric,now(),now()+interval '12 months','purchase:'||o.id,NULL,'grant',NULL,NULL,'Paid top-up');
  UPDATE public.credit_lots SET billing_order_id=o.id WHERE id=lot;
  UPDATE public.credit_ledger SET billing_order_id=o.id WHERE lot_id=lot;
  PERFORM private.credit_repay(o.user_id,now());
 ELSE
  cur:=public.entitlement_from(prof); current_plan:=cur->>'plan';
  start_at:=now(); anchor:=now();
  IF cur->>'status'='active' AND cur->>'period_end' IS NULL THEN
   PERFORM private.billing_hold_order(o.id,pay.id,'Captured purchase requires reviewed resolution');
   RETURN jsonb_build_object('ok',false,'pending',true,'status','review');
  END IF;
  IF cur->>'status'='active' THEN
   SELECT b.anchor_at INTO anchor FROM private.billing_plan_periods b WHERE b.user_id=o.user_id
    AND b.state IN ('active','scheduled') AND b.starts_at<=now() AND b.ends_at>now() ORDER BY b.starts_at DESC LIMIT 1;
   anchor:=coalesce(anchor,(cur->>'period_end')::timestamptz-interval '1 month');
   IF array_position(ARRAY['free','plus','pro','max'],snap->>'planId')<=array_position(ARRAY['free','plus','pro','max'],current_plan) THEN
    SELECT greatest((cur->>'period_end')::timestamptz,coalesce(max(ends_at),(cur->>'period_end')::timestamptz)) INTO start_at
     FROM private.billing_plan_periods WHERE user_id=o.user_id AND state IN ('active','scheduled');
   ELSE
    IF EXISTS(SELECT FROM private.billing_plan_periods WHERE user_id=o.user_id AND state='scheduled' AND starts_at>now()) THEN
     PERFORM private.billing_hold_order(o.id,pay.id,'Captured purchase requires reviewed resolution');
     RETURN jsonb_build_object('ok',false,'pending',true,'status','review');
    END IF;
    UPDATE private.billing_plan_periods SET ends_at=now(),state='superseded' WHERE user_id=o.user_id AND starts_at<now() AND ends_at>now();
    PERFORM private.credit_end_monthly(o.user_id,now()); anchor:=now();
   END IF;
  END IF;
  INSERT INTO private.billing_plan_periods(order_id,user_id,plan,starts_at,ends_at,anchor_at,credits,state)
   VALUES(o.id,o.user_id,(snap->>'planId')::public.app_plan,start_at,private.billing_month_end(anchor,start_at),anchor,
    (snap->>'credits')::numeric,CASE WHEN start_at<=now() THEN 'active' ELSE 'scheduled' END) RETURNING * INTO per;
  IF start_at<=now() THEN
   UPDATE public.user_profiles SET plan=per.plan,plan_status='active',plan_source='payment',plan_period_end=per.ends_at,active_billing_plan_period_id=per.id WHERE user_id=o.user_id;
  END IF;
  INSERT INTO public.plan_grants(user_id,plan,status,period_end,source,payment_id,billing_plan_period_id)
   VALUES(o.user_id,per.plan,'active',per.ends_at,'payment',pay.provider_payment_id,per.id);
  UPDATE public.credit_lots SET billing_order_id=o.id,billing_plan_period_id=per.id WHERE user_id=o.user_id AND source_key='period:'||per.id;
  UPDATE public.credit_ledger SET billing_order_id=o.id WHERE lot_id IN(SELECT id FROM public.credit_lots WHERE billing_plan_period_id=per.id);
 END IF;
 inv:=public.issue_invoice(jsonb_build_object('id','inv_'||replace(o.id::text,'-',''),'user_id',o.user_id,'user_email',snap->>'buyerEmail',
  'plan_id',coalesce(snap->>'planId',snap->>'productId'),'total',o.amount_paise/100.0,'taxable',o.amount_paise/100.0,
  'buyer_name',snap->>'buyerName','payment_id',pay.provider_payment_id,'order_id',o.provider_order_id,'provider','razorpay',
  'payload',snap||jsonb_build_object('description',snap->>'label','buyerEmail',snap->>'buyerEmail')));
 UPDATE public.invoices SET billing_order_id=o.id WHERE id=inv.id RETURNING * INTO inv;
 UPDATE private.billing_orders SET state='fulfilled',fulfilled_payment_id=pay.id,fulfilled_at=now() WHERE id=o.id;
 RETURN jsonb_build_object('ok',true,'status','fulfilled','invoice',to_jsonb(inv),'entitlement',public.entitlement_from((SELECT p FROM public.user_profiles p WHERE user_id=o.user_id)));
END $$;

CREATE FUNCTION public.billing_event(p_action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE e private.billing_events; o private.billing_orders; pay private.billing_payments; a private.billing_adjustments;
BEGIN
 IF p_action='receive' THEN
  INSERT INTO private.billing_events(account,mode,provider_event_id,event_type,body_hash,payload)
  VALUES(p->>'account',p->>'mode',p->>'eventId',p->>'type',p->>'hash',p->'payload')
  ON CONFLICT(account,mode,provider_event_id) DO NOTHING RETURNING * INTO e;
  IF NOT FOUND THEN
   SELECT * INTO e FROM private.billing_events WHERE account=p->>'account' AND mode=p->>'mode' AND provider_event_id=p->>'eventId';
   IF e.body_hash IS DISTINCT FROM p->>'hash' THEN RAISE EXCEPTION 'Webhook identity body conflict'; END IF;
  END IF;
  UPDATE private.billing_events SET lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
   WHERE id=e.id AND state<>'done' AND coalesce(lease_until,'-infinity')<now() RETURNING * INTO e;
  IF FOUND THEN RETURN to_jsonb(e)||'{"claimed":true}'; END IF;
  RETURN (SELECT to_jsonb(x)||'{"claimed":false}' FROM private.billing_events x WHERE x.account=p->>'account' AND x.mode=p->>'mode' AND x.provider_event_id=p->>'eventId');
 ELSIF p_action='pending' THEN
  WITH selected AS (SELECT id FROM private.billing_events WHERE account=p->>'account' AND mode=p->>'mode'
   AND state<>'done' AND next_attempt_at<=now() AND coalesce(lease_until,'-infinity')<now()
   ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED),
  claimed AS (UPDATE private.billing_events ev SET lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid()
   FROM selected x WHERE ev.id=x.id RETURNING ev.*)
  SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') INTO p FROM claimed t;
  RETURN p;
 ELSIF p_action='done' OR p_action='error' THEN
  UPDATE private.billing_events SET state=CASE WHEN p_action='done' THEN 'done' ELSE 'error' END,attempts=attempts+1,
   next_attempt_at=now()+interval '5 minutes',lease_until=NULL,lease_token=NULL,
   last_error=CASE WHEN p_action='error' THEN left(p->>'error',200) END WHERE id=(p->>'id')::uuid
   AND state<>'done' AND lease_token=nullif(p->>'leaseToken','')::uuid;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='adjustment' THEN
  SELECT * INTO pay FROM private.billing_payments WHERE provider_payment_id=p->>'paymentId' AND account=p->>'account' AND mode=p->>'mode' FOR UPDATE;
  IF pay.id IS NULL THEN RAISE EXCEPTION 'Adjustment payment not yet reconciled'; END IF;
  IF (p->>'amountPaise')::bigint>pay.amount_paise THEN RAISE EXCEPTION 'Adjustment exceeds payment'; END IF;
  INSERT INTO private.billing_adjustments(payment_id,provider_adjustment_id,revision,kind,amount_paise,provider_status)
   VALUES(pay.id,p->>'adjustmentId',CASE WHEN p->>'kind'='dispute' THEN p->>'status' ELSE '' END,p->>'kind',(p->>'amountPaise')::bigint,p->>'status')
  ON CONFLICT(payment_id,kind,provider_adjustment_id,revision) DO UPDATE SET provider_status=excluded.provider_status RETURNING * INTO a;
  RETURN to_jsonb(a);
 ELSIF p_action='reviews' THEN
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM(SELECT a.* FROM private.billing_adjustments a JOIN private.billing_payments pay ON pay.id=a.payment_id
   WHERE pay.account=p->>'account' AND pay.mode=p->>'mode' AND a.reviewed_at IS NULL ORDER BY a.created_at LIMIT 50)t),'[]');
 END IF;
 RAISE EXCEPTION 'Unknown event operation';
END $$;

CREATE FUNCTION public.billing_review_adjustment(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE a private.billing_adjustments; pay private.billing_payments; o private.billing_orders; n numeric; restored numeric; reversal_pool numeric; expiry timestamptz; per private.billing_plan_periods; eid uuid; d jsonb:=p->'decision'; actor uuid:=(p->>'actorId')::uuid;
BEGIN
 IF NOT EXISTS(SELECT FROM public.user_profiles WHERE user_id=actor AND role='admin' AND status='active') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF length(trim(coalesce(d->>'reason','')))<5 OR nullif(p->>'requestId','') IS NULL THEN RAISE EXCEPTION 'Review reason and request ID required'; END IF;
 -- Same financial lock order as capture; resolve identities before locking.
 SELECT o1.* INTO o FROM private.billing_orders o1 JOIN private.billing_payments p1 ON p1.order_id=o1.id
 JOIN private.billing_adjustments a1 ON a1.payment_id=p1.id WHERE a1.id=(p->>'adjustmentId')::uuid;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
 PERFORM 1 FROM private.billing_orders WHERE id=o.id FOR UPDATE;
 SELECT * INTO pay FROM private.billing_payments WHERE order_id=o.id AND id=(SELECT payment_id FROM private.billing_adjustments WHERE id=(p->>'adjustmentId')::uuid) FOR UPDATE;
 SELECT * INTO a FROM private.billing_adjustments WHERE id=(p->>'adjustmentId')::uuid FOR UPDATE;
 IF a.reviewed_at IS NOT NULL THEN
  IF a.request_id IS DISTINCT FROM (p->>'requestId')::uuid OR a.decision IS DISTINCT FROM d THEN RAISE EXCEPTION 'Review retry conflict'; END IF;
  RETURN to_jsonb(a);
 END IF;
 IF a.kind='purchase_review' THEN
  IF d->>'resolution' IS DISTINCT FROM 'refund_recorded' OR pay.refunded_paise<pay.amount_paise THEN
   RAISE EXCEPTION 'Confirm full provider refund before closing this purchase exception'; END IF;
  UPDATE private.billing_orders SET state='refunded' WHERE id=o.id AND state<>'fulfilled';
 END IF;
 n:=coalesce((d->>'creditsToRemove')::numeric,0);
 restored:=coalesce((d->>'creditsToRestore')::numeric,0);
 IF n<0 OR n<>round(n,4) OR restored<0 OR restored<>round(restored,4) OR (n>0 AND restored>0)
  OR (coalesce((d->>'cancelPeriod')::boolean,false) AND coalesce((d->>'restorePeriod')::boolean,false)) THEN RAISE EXCEPTION 'Unsupported review amount'; END IF;
 SELECT coalesce(sum(coalesce((x.decision->>'creditsToRemove')::numeric,0)-coalesce((x.decision->>'creditsToRestore')::numeric,0)),0) INTO reversal_pool
 FROM private.billing_adjustments x JOIN private.billing_payments y ON y.id=x.payment_id WHERE y.order_id=o.id AND x.reviewed_at IS NOT NULL;
 IF restored>reversal_pool THEN RAISE EXCEPTION 'Restoration exceeds prior reviewed reversals'; END IF;

 IF n+reversal_pool>(o.snapshot->>'credits')::numeric THEN RAISE EXCEPTION 'Cumulative reversal exceeds purchased credits'; END IF;
 IF n>0 OR restored>0 OR coalesce((d->>'cancelPeriod')::boolean,false) OR coalesce((d->>'restorePeriod')::boolean,false) THEN
  PERFORM 1 FROM public.user_profiles WHERE user_id=o.user_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active buyer required for benefit adjustment'; END IF;
  PERFORM private.credit_refresh(o.user_id,now());
  IF n>0 THEN
   eid:=private.credit_entry(o.user_id,'adjustment',-n,NULL,NULL,(p->>'requestId')::uuid,NULL,NULL,actor,d->>'reason');
   PERFORM private.credit_draw(o.user_id,n,eid,'removal',now());
   UPDATE public.credit_ledger SET billing_order_id=o.id,billing_adjustment_id=a.id WHERE id=eid;
  END IF;
  IF restored>0 THEN
   SELECT max(expires_at) INTO expiry FROM public.credit_lots WHERE billing_order_id=o.id AND kind='topup';
   IF expiry IS NULL THEN SELECT max(ends_at) INTO expiry FROM private.billing_plan_periods WHERE order_id=o.id; END IF;
   IF expiry IS NULL OR expiry<=now() THEN RAISE EXCEPTION 'Original benefit has expired; do not extend it through restoration'; END IF;
   eid:=private.credit_mint(o.user_id,'adjustment',restored,now(),expiry,'billing-restore:'||(p->>'requestId'),NULL,'adjustment',(p->>'requestId')::uuid,actor,d->>'reason');
   UPDATE public.credit_lots SET billing_order_id=o.id WHERE id=eid;
   UPDATE public.credit_ledger SET billing_order_id=o.id,billing_adjustment_id=a.id WHERE lot_id=eid;
   PERFORM private.credit_repay(o.user_id,now());
  END IF;
  IF coalesce((d->>'restorePeriod')::boolean,false) THEN
   SELECT * INTO per FROM private.billing_plan_periods WHERE order_id=o.id FOR UPDATE;
   IF per.id IS NULL OR per.ends_at<=now() OR EXISTS(SELECT FROM private.billing_plan_periods b WHERE b.user_id=o.user_id AND b.id<>per.id
     AND b.state IN ('active','scheduled') AND b.starts_at<per.ends_at AND b.ends_at>greatest(per.starts_at,now())) THEN RAISE EXCEPTION 'Paid period cannot be restored over another purchase or beyond expiry'; END IF;
   IF EXISTS(SELECT FROM public.plan_grants g WHERE g.user_id=o.user_id AND g.source='manual' AND g.id>(SELECT max(id) FROM public.plan_grants WHERE billing_plan_period_id=per.id)) THEN RAISE EXCEPTION 'A later manual grant supersedes this period'; END IF;
   UPDATE private.billing_plan_periods SET state=CASE WHEN starts_at<=now() THEN 'active' ELSE 'scheduled' END WHERE id=per.id;
   IF per.starts_at<=now() THEN UPDATE public.user_profiles SET plan=per.plan,plan_status='active',plan_source='payment',plan_period_end=per.ends_at,active_billing_plan_period_id=per.id WHERE user_id=o.user_id; END IF;
  END IF;
  IF coalesce((d->>'cancelPeriod')::boolean,false) THEN
   UPDATE private.billing_plan_periods SET state='cancelled' WHERE order_id=o.id;
   UPDATE public.user_profiles SET plan='free',plan_status='free',plan_source='manual',plan_period_end=NULL,active_billing_plan_period_id=NULL
    WHERE user_id=o.user_id AND active_billing_plan_period_id IN(SELECT id FROM private.billing_plan_periods WHERE order_id=o.id);
  END IF;
 END IF;
 UPDATE private.billing_adjustments SET decision=d,request_id=(p->>'requestId')::uuid,reviewed_by=actor,reviewed_at=now() WHERE id=a.id RETURNING * INTO a;
 RETURN to_jsonb(a);
END $$;

ALTER FUNCTION public.billing_capture(uuid,jsonb) OWNER TO postgres;
ALTER FUNCTION public.billing_review_adjustment(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.billing_effective_profile(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_effective_profile(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.billing_order(text,jsonb),public.billing_capture(uuid,jsonb),public.billing_event(text,jsonb),public.billing_review_adjustment(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_order(text,jsonb),public.billing_capture(uuid,jsonb),public.billing_event(text,jsonb),public.billing_review_adjustment(jsonb) TO service_role;
REVOKE ALL ON FUNCTION private.billing_hold_order(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.billing_lot_provenance(),private.billing_entry_provenance() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.credit_due_cycles_legacy(uuid,timestamptz),private.billing_month_end(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.entitlement_from(public.user_profiles) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.entitlement_from(public.user_profiles) TO service_role;
COMMIT;
