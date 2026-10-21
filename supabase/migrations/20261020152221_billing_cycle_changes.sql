-- Test-only cycle contract. Additive: existing RPCs and triggers stay unchanged.
-- Rollback: revert Preview callers; retain paid facts. No automatic destructive Down.
BEGIN;
CREATE TABLE private.billing_plan_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
 account text NOT NULL, mode text NOT NULL CHECK(mode='test'), snapshot jsonb NOT NULL,
 expires_at timestamptz NOT NULL, order_id uuid UNIQUE REFERENCES private.billing_orders(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_quotes_buyer ON private.billing_plan_quotes(user_id,created_at);
CREATE TABLE private.billing_plan_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),account text NOT NULL,mode text NOT NULL CHECK(mode='test'),
 plan public.app_plan NOT NULL, effective_at timestamptz NOT NULL, cycle_id uuid NOT NULL REFERENCES private.billing_plan_periods(id),
 state text NOT NULL CHECK(state IN('pending','replaced','cancelled','purchased')),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX billing_one_next_plan ON private.billing_plan_changes(user_id,account,mode) WHERE state='pending';
ALTER TABLE private.billing_plan_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.billing_plan_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.billing_plan_quotes,private.billing_plan_changes FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.billing_cycle_price(plan_name text) RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE plan_name WHEN 'plus' THEN 39900 WHEN 'pro' THEN 99900 WHEN 'max' THEN 999900 ELSE 0 END::bigint;
$$;
CREATE FUNCTION public.billing_cycle(p_action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE uid uuid:=(p->>'userId')::uuid; prof public.user_profiles; b private.billing_plan_periods; q private.billing_plan_quotes;
 o private.billing_orders; target text:=p->>'planId'; current_plan text; kind text; snap jsonb; v jsonb; fresh boolean;
 fraction numeric:=1; qty numeric; amount bigint; expires timestamptz; starts timestamptz; ends timestamptz; version bigint;
BEGIN
 IF p->>'mode' IS DISTINCT FROM 'test' OR nullif(p->>'account','') IS NULL THEN RAISE EXCEPTION 'Test cycle contract only' USING ERRCODE='42501'; END IF;
 SELECT * INTO prof FROM public.user_profiles WHERE user_id=uid AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active buyer required' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM private.billing_plan_periods x WHERE x.user_id=uid AND x.state='active' AND x.starts_at<=now() AND x.ends_at>now() ORDER BY starts_at DESC LIMIT 1;
 -- Never infer a paid cycle from a manual/trial plan or another merchant/mode.
 current_plan:=public.entitlement_from(prof)->>'plan';
 IF current_plan<>'free' AND (b.id IS NULL OR NOT EXISTS(SELECT FROM private.billing_orders x WHERE x.id=b.order_id AND x.account=p->>'account' AND x.mode=p->>'mode')) THEN
  RAISE EXCEPTION 'Contact support to change this plan' USING ERRCODE='23514'; END IF;
 IF p_action='state' THEN
  SELECT to_jsonb(c)||jsonb_build_object('planId',c.plan,'effectiveAt',c.effective_at) INTO v FROM private.billing_plan_changes c
   WHERE c.user_id=uid AND c.account=p->>'account' AND c.mode=p->>'mode' AND c.state='pending';
  RETURN jsonb_build_object('scheduled',v,'cycle',CASE WHEN b.id IS NULL THEN NULL ELSE jsonb_build_object('id',b.id,'plan',b.plan,'startsAt',b.starts_at,'endsAt',b.ends_at,'credits',b.credits) END);
 ELSIF p_action='cancel' THEN
  UPDATE private.billing_plan_changes SET state='cancelled' WHERE user_id=uid AND account=p->>'account' AND mode=p->>'mode' AND state='pending';
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='schedule' THEN
  IF b.id IS NULL OR target NOT IN('free','plus','pro') OR private.billing_cycle_price(target)>=private.billing_cycle_price(current_plan) THEN
   RAISE EXCEPTION 'Choose a lower next plan' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT FROM private.billing_plan_periods WHERE user_id=uid AND state='scheduled' AND ends_at>now()) THEN
   RAISE EXCEPTION 'Next period is already paid; contact support' USING ERRCODE='23514'; END IF;
  UPDATE private.billing_plan_changes SET state='replaced' WHERE user_id=uid AND account=p->>'account' AND mode=p->>'mode' AND state='pending';
  INSERT INTO private.billing_plan_changes(user_id,account,mode,plan,effective_at,cycle_id,state) VALUES(uid,p->>'account',p->>'mode',target::public.app_plan,b.ends_at,b.id,'pending');
  RETURN jsonb_build_object('ok',true,'effectiveAt',b.ends_at,'planId',target);
 ELSIF p_action='claim' THEN
  SELECT * INTO o FROM private.billing_orders WHERE customer_id=uid AND request_id=(p->>'requestId')::uuid;
  IF FOUND THEN
   IF o.request_hash IS DISTINCT FROM p->>'requestHash' OR o.account IS DISTINCT FROM p->>'account' OR o.mode IS DISTINCT FROM p->>'mode' THEN RAISE EXCEPTION 'Intent conflict' USING ERRCODE='23505'; END IF;
   RETURN to_jsonb(o)||'{"fresh":false}';
  END IF;
  SELECT * INTO q FROM private.billing_plan_quotes WHERE id=(p->>'quoteId')::uuid AND user_id=uid AND account=p->>'account' AND mode=p->>'mode' FOR UPDATE;
  SELECT coalesce(max(id),0) INTO version FROM public.plan_grants WHERE user_id=uid;
  IF q.id IS NULL OR q.expires_at<=now() OR q.snapshot->>'planId' IS DISTINCT FROM target OR (q.snapshot->>'grantVersion')::bigint IS DISTINCT FROM version THEN
   RAISE EXCEPTION 'Quote expired or plan changed; review again' USING ERRCODE='23514'; END IF;
  IF q.order_id IS NOT NULL THEN
   SELECT * INTO o FROM private.billing_orders WHERE id=q.order_id;
   IF o.request_hash IS DISTINCT FROM p->>'requestHash' THEN RAISE EXCEPTION 'Quote already used' USING ERRCODE='23505'; END IF;
   RETURN to_jsonb(o)||'{"fresh":false}';
  END IF;
  IF (SELECT count(*) FROM private.billing_orders WHERE user_id=uid AND created_at>now()-interval '15 minutes')>=10 THEN RAISE EXCEPTION 'Too many purchase attempts' USING ERRCODE='54000'; END IF;
  snap:=coalesce(p->'snapshot','{}')||q.snapshot;
  INSERT INTO private.billing_orders(user_id,customer_id,request_id,request_hash,account,mode,snapshot,amount_paise,currency)
   VALUES(uid,uid,(p->>'requestId')::uuid,p->>'requestHash',p->>'account',p->>'mode',snap,(snap->>'amountPaise')::bigint,'INR') RETURNING * INTO o;
  UPDATE private.billing_plan_quotes SET order_id=o.id WHERE id=q.id;
  RETURN to_jsonb(o)||'{"fresh":true}';
 ELSIF p_action<>'quote' THEN RAISE EXCEPTION 'Unknown cycle action' USING ERRCODE='22023'; END IF;
 IF target NOT IN('plus','pro','max') OR target IS NULL THEN RAISE EXCEPTION 'Unknown plan' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT FROM private.billing_plan_periods WHERE user_id=uid AND state='scheduled' AND ends_at>now()) THEN RAISE EXCEPTION 'Next period is already paid; contact support' USING ERRCODE='23514'; END IF;
 SELECT monthly_credits INTO qty FROM public.credit_plan_allowances WHERE plan::text=target;
 amount:=private.billing_cycle_price(target); starts:=now(); ends:=private.billing_month_end(starts,starts); expires:=now()+interval '10 minutes'; kind:='start';
 IF b.id IS NOT NULL THEN
  IF private.billing_cycle_price(target)>private.billing_cycle_price(current_plan) AND coalesce(p->>'intent','')<>'renew' THEN
   kind:='upgrade';
   fraction:=extract(epoch FROM b.ends_at-now())/extract(epoch FROM b.ends_at-b.starts_at);
   amount:=round((amount-private.billing_cycle_price(current_plan))*fraction);
   qty:=round((qty-(SELECT monthly_credits FROM public.credit_plan_allowances WHERE plan::text=current_plan))*fraction,4);
   starts:=b.starts_at; ends:=b.ends_at; expires:=least(expires,b.ends_at);
   IF amount<100 OR qty<=0 THEN RAISE EXCEPTION 'Too close to cycle end to upgrade; choose a plan after expiry' USING ERRCODE='23514'; END IF;
  ELSE
   kind:='renew';
   IF b.ends_at>now()+interval '7 days' OR private.billing_cycle_price(target)>private.billing_cycle_price(current_plan) THEN
    RAISE EXCEPTION 'Manual renewal opens in the last seven days; upgrades apply now' USING ERRCODE='23514'; END IF;
   starts:=b.ends_at; ends:=private.billing_month_end(b.anchor_at,starts); expires:=least(expires,b.ends_at);
   IF target<>current_plan AND NOT EXISTS(SELECT FROM private.billing_plan_changes c WHERE c.user_id=uid AND c.account=p->>'account' AND c.mode=p->>'mode' AND c.state='pending' AND c.plan::text=target) THEN
    RAISE EXCEPTION 'Schedule the lower next plan before renewal' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 SELECT coalesce(max(id),0) INTO version FROM public.plan_grants WHERE user_id=uid;
 snap:=jsonb_build_object('contract','cycle-v1','kind','plan','productId','plan-'||target,'planId',target,'action',kind,
  'credits',qty,'amountPaise',amount,'currency','INR','creditUnit','credit-paise-v2','grantVersion',version,
  'cycleId',b.id,'cycleStartsAt',starts,'cycleEndsAt',ends,'currentPlan',current_plan,'fraction',fraction,
  'label',initcap(target)||CASE WHEN kind='upgrade' THEN ' upgrade — remaining cycle' ELSE ' plan — one month' END,'expiresAt',expires,
  'monthlyCredits',(SELECT monthly_credits FROM public.credit_plan_allowances WHERE plan::text=target),'monthlyAmountPaise',private.billing_cycle_price(target));
 INSERT INTO private.billing_plan_quotes(user_id,account,mode,snapshot,expires_at) VALUES(uid,p->>'account',p->>'mode',snap,expires) RETURNING * INTO q;
 UPDATE private.billing_plan_quotes SET snapshot=snapshot||jsonb_build_object('quoteId',q.id) WHERE id=q.id RETURNING * INTO q;
 RETURN q.snapshot;
END $$;

-- Clone the audited capture core. Only cycle-v1 plan handling differs; legacy
-- capture remains byte-for-byte unchanged and is the path for legacy orders.
DO $migration$
DECLARE f text; original text; replacement text;
BEGIN
 SELECT pg_get_functiondef('public.billing_capture(uuid,jsonb)'::regprocedure) INTO f;
 f:=replace(f,'FUNCTION public.billing_capture(', 'FUNCTION public.billing_cycle_capture(');
 original:=$old$ IF snap->>'kind'='topup' THEN$old$;
 replacement:=$new$ IF snap->>'contract'='cycle-v1' AND (
   o.mode<>'test' OR (snap->>'expiresAt')::timestamptz<=now()
   OR (snap->>'action' IN('upgrade','renew') AND NOT EXISTS(SELECT FROM private.billing_plan_periods b
      WHERE b.id=(snap->>'cycleId')::uuid AND b.state='active' AND b.ends_at>now()
      AND (snap->>'action'<>'upgrade' OR b.ends_at=(snap->>'cycleEndsAt')::timestamptz)))
   OR EXISTS(SELECT FROM private.billing_plan_periods b WHERE b.user_id=o.user_id AND b.state='scheduled' AND b.ends_at>now())) THEN
  PERFORM private.billing_hold_order(o.id,pay.id,'Cycle quote expired or changed; reviewed resolution required');
  RETURN jsonb_build_object('ok',false,'pending',true,'status','review');
 END IF;
 IF snap->>'contract'='cycle-v1' AND snap->>'action'='upgrade' THEN
  SELECT * INTO per FROM private.billing_plan_periods WHERE id=(snap->>'cycleId')::uuid FOR UPDATE;
  UPDATE private.billing_plan_periods SET state='superseded' WHERE id=per.id;
  INSERT INTO private.billing_plan_periods(order_id,user_id,plan,starts_at,ends_at,anchor_at,credits,state)
   VALUES(o.id,o.user_id,(snap->>'planId')::public.app_plan,per.starts_at,per.ends_at,per.anchor_at,per.credits+(snap->>'credits')::numeric,'active') RETURNING * INTO per;
  -- The revision retains the original billing window. Pre-mint only its paid
  -- increment under the canonical source key; credit_refresh cannot mint twice.
  lot:=private.credit_mint(o.user_id,'monthly',(snap->>'credits')::numeric,per.starts_at,per.ends_at,'period:'||per.id,per.plan,'grant',NULL,NULL,'Prorated upgrade');
  UPDATE public.user_profiles SET plan=per.plan,plan_status='active',plan_source='payment',plan_period_end=per.ends_at,active_billing_plan_period_id=per.id WHERE user_id=o.user_id;
  INSERT INTO public.plan_grants(user_id,plan,status,period_end,source,payment_id,billing_plan_period_id)
   VALUES(o.user_id,per.plan,'active',per.ends_at,'payment',pay.provider_payment_id,per.id);
  UPDATE private.billing_plan_changes SET state='cancelled' WHERE user_id=o.user_id AND account=o.account AND mode=o.mode AND state='pending';
  PERFORM private.credit_repay(o.user_id,now());
 ELSIF snap->>'kind'='topup' THEN$new$;
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Capture core changed; review clone'; END IF;
 f:=replace(f,original,replacement);
 -- The reviewed start date is part of the immutable quote, not a second
 -- server-clock calculation at capture. Legacy starts keep their old behavior.
 f:=replace(f,'start_at:=now(); anchor:=now();', $new$start_at:=CASE WHEN snap->>'contract'='cycle-v1' THEN (snap->>'cycleStartsAt')::timestamptz ELSE now() END; anchor:=start_at;$new$);
 -- Mark the selected unpaid instruction purchased only after successful fulfilment.
 f:=replace(f,' inv:=public.issue_invoice(', $new$ IF snap->>'contract'='cycle-v1' AND snap->>'action' IN('start','renew') THEN
  UPDATE private.billing_plan_changes SET state='purchased' WHERE user_id=o.user_id AND account=o.account AND mode=o.mode AND state='pending';
 END IF;
 inv:=public.issue_invoice($new$);
 EXECUTE f;
END $migration$;
ALTER FUNCTION public.billing_cycle(text,jsonb) OWNER TO postgres;
ALTER FUNCTION public.billing_cycle_capture(uuid,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.billing_cycle_price(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.billing_cycle(text,jsonb),public.billing_cycle_capture(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_cycle(text,jsonb),public.billing_cycle_capture(uuid,jsonb) TO service_role;
CREATE FUNCTION public.my_credits_cycle() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; b private.billing_plan_periods;
BEGIN
 result:=public.my_credits();
 SELECT x.* INTO b FROM private.billing_plan_periods x JOIN private.billing_orders o ON o.id=x.order_id
  WHERE x.user_id=auth.uid() AND x.state='active' AND x.starts_at<=now() AND x.ends_at>now() AND o.snapshot->>'contract'='cycle-v1';
 IF FOUND THEN result:=jsonb_set(result,'{cycle,allowance}',to_jsonb(b.credits)); END IF;
 RETURN result;
END $$;
ALTER FUNCTION public.my_credits_cycle() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.my_credits_cycle() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.my_credits_cycle() TO authenticated;
COMMIT;
