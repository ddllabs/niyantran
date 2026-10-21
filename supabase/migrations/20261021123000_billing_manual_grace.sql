-- Additive manual access grace. Financial entitlement/RPCs and paid facts remain
-- unchanged. Rollback callers to their prior RPCs; retain captured paid records.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Existing writers cannot erase intentional non-renewal after its deadline.
-- There is no cancellation timestamp in plan_changes; preserve the pending
-- Free fact instead. Paid fulfilment -> purchased remains explicitly allowed.
CREATE FUNCTION private.billing_preserve_effective_free() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF OLD.plan='free' AND OLD.state='pending' AND OLD.effective_at<=now()
  AND NEW.state IN('cancelled','replaced') THEN
  RAISE EXCEPTION 'Free selection already took effect; choose a paid plan to restart' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_preserve_effective_free BEFORE UPDATE OF state ON private.billing_plan_changes
 FOR EACH ROW EXECUTE FUNCTION private.billing_preserve_effective_free();

-- Choose the latest started period BEFORE testing eligibility: a cancelled or
-- superseded newest revision must never resurrect an older paid plan.
CREATE FUNCTION private.billing_manual_grace_period(p_user uuid,p_now timestamptz)
RETURNS SETOF private.billing_plan_periods
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH latest AS (
  SELECT b.* FROM private.billing_plan_periods b WHERE b.user_id=p_user AND b.starts_at<=p_now
  ORDER BY b.starts_at DESC,(SELECT max(g.id) FROM public.plan_grants g WHERE g.billing_plan_period_id=b.id) DESC NULLS LAST,b.created_at DESC,b.id DESC LIMIT 1
 )
 SELECT b.* FROM latest b JOIN private.billing_orders o ON o.id=b.order_id
 JOIN private.billing_payments pay ON pay.id=o.fulfilled_payment_id AND pay.order_id=o.id
 WHERE b.state IN('active','scheduled') AND b.ends_at<=p_now AND p_now<b.ends_at+interval '48 hours'
 AND o.user_id=p_user AND o.customer_id=p_user AND o.state='fulfilled'
 AND pay.account=o.account AND pay.mode=o.mode AND pay.status='captured' AND pay.refunded_paise=0
 AND EXISTS(SELECT FROM public.plan_grants g WHERE g.billing_plan_period_id=b.id AND g.user_id=p_user AND g.source='payment' AND g.payment_id=pay.provider_payment_id)
 AND NOT EXISTS(SELECT FROM public.plan_grants g WHERE g.user_id=p_user AND g.source='manual'
  AND g.id>(SELECT max(linked.id) FROM public.plan_grants linked WHERE linked.billing_plan_period_id=b.id))
 AND NOT EXISTS(SELECT FROM private.billing_plan_changes c WHERE c.user_id=p_user AND c.cycle_id=b.id
  AND c.account=o.account AND c.mode=o.mode AND c.state='pending' AND c.plan='free' AND c.effective_at=b.ends_at)
 -- Confirmed next coverage, including a future paid window, takes precedence.
 AND NOT EXISTS(SELECT FROM private.billing_plan_periods n JOIN private.billing_orders no1 ON no1.id=n.order_id
  JOIN private.billing_payments np ON np.id=no1.fulfilled_payment_id AND np.order_id=no1.id
  WHERE n.user_id=p_user AND n.id<>b.id AND n.state IN('active','scheduled') AND n.ends_at>p_now
  AND no1.user_id=p_user AND no1.state='fulfilled' AND np.account=no1.account AND np.mode=no1.mode
  AND np.status='captured' AND np.refunded_paise=0);
$$;

CREATE FUNCTION private.billing_manual_entitlement(p public.user_profiles) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e jsonb; b private.billing_plan_periods; source_id uuid;
BEGIN
 IF p.user_id IS NULL OR p.status<>'active' THEN RETURN NULL; END IF;
 e:=public.entitlement_from(p);
 IF e->>'plan'<>'free' AND e->>'status'='active' THEN
  SELECT x.id INTO source_id FROM private.billing_plan_periods x WHERE x.user_id=p.user_id
   AND x.state IN('active','scheduled') AND x.starts_at<=now() AND x.ends_at>now()
   AND e->>'source'='payment' ORDER BY x.starts_at DESC LIMIT 1;
  RETURN e||jsonb_build_object('access_until',e->'period_end','grace_until',NULL,'in_grace',false,'source_period_id',source_id);
 END IF;
 SELECT * INTO b FROM private.billing_manual_grace_period(p.user_id,now());
 IF FOUND THEN
  RETURN e||jsonb_build_object('plan',b.plan,'status','active','period_end',b.ends_at,'lapsed',false,
   'granted_plan',b.plan,'source','payment','access_until',b.ends_at+interval '48 hours',
   'grace_until',b.ends_at+interval '48 hours','in_grace',true,'source_period_id',b.id);
 END IF;
 RETURN e||jsonb_build_object('access_until',e->'period_end','grace_until',NULL,'in_grace',false,'source_period_id',NULL);
END $$;

CREATE FUNCTION public.my_entitlement_manual() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.user_profiles;
BEGIN
 PERFORM private.billing_activate_period(auth.uid());
 SELECT * INTO p FROM public.user_profiles WHERE user_id=auth.uid() AND status='active';
 RETURN CASE WHEN FOUND THEN private.billing_manual_entitlement(p) ELSE NULL END;
END $$;

CREATE FUNCTION public.billing_effective_profile_manual(p_user uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.user_profiles; e jsonb;
BEGIN
 PERFORM private.billing_activate_period(p_user);
 SELECT * INTO p FROM public.user_profiles WHERE user_id=p_user;
 IF NOT FOUND THEN RETURN NULL; END IF;
 e:=private.billing_manual_entitlement(p);
 RETURN jsonb_build_object('status',p.status,'plan',coalesce(e->>'plan','free'),
  'plan_status',coalesce(e->>'status','free'),'plan_period_end',e->'period_end',
  'access_until',e->'access_until','grace_until',e->'grace_until','in_grace',coalesce((e->>'in_grace')::boolean,false),
  'source_period_id',e->'source_period_id');
END $$;

-- Derive the unchanged financial paths from the reviewed mode-aware version.
-- Every splice is guarded, so changed upstream bodies fail migration safely.
DO $migration$
DECLARE f text; original text; replacement text;
BEGIN
 SELECT pg_get_functiondef('public.billing_cycle_v2(text,jsonb)'::regprocedure) INTO f;
 f:=replace(f,'FUNCTION public.billing_cycle_v2(','FUNCTION public.billing_cycle_v3(');
 original:='fraction numeric:=1;'; replacement:='grace boolean:=false; fraction numeric:=1;';
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Cycle declarations changed'; END IF; f:=replace(f,original,replacement);
 original:=$old$current_plan:=public.entitlement_from(prof)->>'plan';$old$;
 replacement:=$new$IF b.id IS NULL THEN
  SELECT * INTO b FROM private.billing_manual_grace_period(uid,now()); grace:=FOUND;
 END IF;
 current_plan:=CASE WHEN grace THEN b.plan::text ELSE public.entitlement_from(prof)->>'plan' END;$new$;
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Cycle entitlement boundary changed'; END IF; f:=replace(f,original,replacement);
 original:=$old$ELSIF p_action='cancel' THEN$old$;
 replacement:=$new$ELSIF p_action='cancel' THEN
  IF EXISTS(SELECT FROM private.billing_plan_changes c WHERE c.user_id=uid AND c.account=p->>'account'
   AND c.mode=p->>'mode' AND c.state='pending' AND c.plan='free' AND c.effective_at<=now()) THEN
   RAISE EXCEPTION 'Free selection already took effect; choose a paid plan to restart' USING ERRCODE='23514';
  END IF;$new$;
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Cycle cancel boundary changed'; END IF; f:=replace(f,original,replacement);
 original:=$old$'scheduled',v,'cycle',$old$;
 replacement:=$new$'inGrace',grace,'graceUntil',CASE WHEN grace THEN b.ends_at+interval '48 hours' END,
   'accessUntil',CASE WHEN grace THEN b.ends_at+interval '48 hours' ELSE b.ends_at END,'scheduled',v,'cycle',$new$;
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Cycle state boundary changed'; END IF; f:=replace(f,original,replacement);
 original:=$old$IF q.id IS NULL OR q.expires_at<=now()$old$;
 replacement:=$new$IF q.id IS NULL OR q.snapshot->>'contract' IS DISTINCT FROM 'cycle-v2' OR q.expires_at<=now()$new$;
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Cycle claim boundary changed'; END IF; f:=replace(f,original,replacement);
 original:=$old$ IF b.id IS NOT NULL THEN
  IF private.billing_cycle_price(target)>$old$;
 replacement:=$new$ IF grace THEN
  kind:='renew'; starts:=b.ends_at; ends:=private.billing_month_end(b.anchor_at,starts);
  expires:=least(expires,b.ends_at+interval '48 hours');
 ELSIF b.id IS NOT NULL THEN
  IF private.billing_cycle_price(target)>$new$;
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Cycle quote boundary changed'; END IF; f:=replace(f,original,replacement);
 original:=$old$'cycleId',b.id,'cycleStartsAt',starts,$old$;
 replacement:=$new$'accessGrace',grace,'cycleAnchorAt',b.anchor_at,'sourcePeriodId',b.id,'cycleId',b.id,'cycleStartsAt',starts,$new$;
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Cycle snapshot boundary changed'; END IF; f:=replace(f,original,replacement);
 f:=replace(f,'cycle-v2','cycle-v3');
 EXECUTE f;
END $migration$;

DO $migration$
DECLARE f text; original text; replacement text;
BEGIN
 SELECT pg_get_functiondef('public.billing_cycle_capture_v2(uuid,jsonb,jsonb)'::regprocedure) INTO f;
 f:=replace(f,'FUNCTION public.billing_cycle_capture_v2(','FUNCTION public.billing_cycle_capture_v3(');
 -- The existing guard is retained for all non-grace purchases. For grace, the
 -- source window and anchor must still match the immutable quote at settlement.
 original:=$old$OR (snap->>'action' IN('upgrade','renew') AND NOT EXISTS(SELECT FROM private.billing_plan_periods b
      WHERE b.id=(snap->>'cycleId')::uuid AND b.state='active' AND b.ends_at>now()
      AND (snap->>'action'<>'upgrade' OR b.ends_at=(snap->>'cycleEndsAt')::timestamptz)))$old$;
 replacement:=$new$OR (coalesce((snap->>'accessGrace')::boolean,false) AND (
     snap->>'action' IS DISTINCT FROM 'renew' OR snap->>'sourcePeriodId' IS DISTINCT FROM snap->>'cycleId'
     OR NOT EXISTS(SELECT FROM private.billing_manual_grace_period(o.user_id,now()) b
      JOIN private.billing_orders source_order ON source_order.id=b.order_id
      WHERE b.id=(snap->>'cycleId')::uuid AND source_order.account=o.account AND source_order.mode=o.mode
      AND b.user_id=o.user_id AND b.ends_at=(snap->>'cycleStartsAt')::timestamptz
      AND b.anchor_at=(snap->>'cycleAnchorAt')::timestamptz
      AND private.billing_month_end(b.anchor_at,b.ends_at)=(snap->>'cycleEndsAt')::timestamptz)))
   OR (NOT coalesce((snap->>'accessGrace')::boolean,false) AND snap->>'action' IN('upgrade','renew') AND NOT EXISTS(SELECT FROM private.billing_plan_periods b
      JOIN private.billing_orders source_order ON source_order.id=b.order_id
      WHERE b.id=(snap->>'cycleId')::uuid AND b.user_id=o.user_id AND source_order.account=o.account AND source_order.mode=o.mode
      AND b.state='active' AND b.ends_at>now()
      AND (snap->>'action'<>'upgrade' OR b.ends_at=(snap->>'cycleEndsAt')::timestamptz)))$new$;
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Cycle capture validation changed'; END IF; f:=replace(f,original,replacement);
 original:=$old$IF snap->>'contract'='cycle-v2' AND snap->>'action'='upgrade' THEN$old$;
 replacement:=$new$IF snap->>'contract'='cycle-v2' AND coalesce((snap->>'accessGrace')::boolean,false) THEN
  SELECT * INTO per FROM private.billing_plan_periods WHERE id=(snap->>'cycleId')::uuid FOR UPDATE;
  INSERT INTO private.billing_plan_periods(order_id,user_id,plan,starts_at,ends_at,anchor_at,credits,state)
   VALUES(o.id,o.user_id,(snap->>'planId')::public.app_plan,(snap->>'cycleStartsAt')::timestamptz,
    (snap->>'cycleEndsAt')::timestamptz,(snap->>'cycleAnchorAt')::timestamptz,(snap->>'credits')::numeric,'active') RETURNING * INTO per;
  UPDATE public.user_profiles SET plan=per.plan,plan_status='active',plan_source='payment',plan_period_end=per.ends_at,active_billing_plan_period_id=per.id WHERE user_id=o.user_id;
  INSERT INTO public.plan_grants(user_id,plan,status,period_end,source,payment_id,billing_plan_period_id)
   VALUES(o.user_id,per.plan,'active',per.ends_at,'payment',pay.provider_payment_id,per.id);
  UPDATE public.credit_lots SET billing_order_id=o.id,billing_plan_period_id=per.id WHERE user_id=o.user_id AND source_key='period:'||per.id;
  UPDATE public.credit_ledger SET billing_order_id=o.id WHERE lot_id IN(SELECT id FROM public.credit_lots WHERE billing_plan_period_id=per.id);
 ELSIF snap->>'contract'='cycle-v2' AND snap->>'action'='upgrade' THEN$new$;
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Cycle capture fulfilment changed'; END IF; f:=replace(f,original,replacement);
 f:=replace(f,'cycle-v2','cycle-v3');
 EXECUTE f;
END $migration$;

-- Keep actual (including prorated) allowances visible for every paid contract.
DO $migration$
DECLARE f text; original text:=$old$IN('cycle-v1','cycle-v2')$old$;
BEGIN
 SELECT pg_get_functiondef('public.my_credits_cycle_v2()'::regprocedure) INTO f;
 IF position('FUNCTION public.my_credits_cycle_v2(' in f)=0 OR position(original in f)=0 THEN
  RAISE EXCEPTION 'Credit cycle reader changed; review v3';
 END IF;
 f:=replace(f,'FUNCTION public.my_credits_cycle_v2(','FUNCTION public.my_credits_cycle_v3(');
 f:=replace(f,original,$new$IN('cycle-v1','cycle-v2','cycle-v3')$new$);
 EXECUTE f;
END $migration$;

ALTER FUNCTION private.billing_preserve_effective_free() OWNER TO postgres;
ALTER FUNCTION private.billing_manual_grace_period(uuid,timestamptz) OWNER TO postgres;
ALTER FUNCTION private.billing_manual_entitlement(public.user_profiles) OWNER TO postgres;
ALTER FUNCTION public.my_entitlement_manual() OWNER TO postgres;
ALTER FUNCTION public.my_credits_cycle_v3() OWNER TO postgres;
ALTER FUNCTION public.billing_effective_profile_manual(uuid) OWNER TO postgres;
ALTER FUNCTION public.billing_cycle_v3(text,jsonb) OWNER TO postgres;
ALTER FUNCTION public.billing_cycle_capture_v3(uuid,jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.billing_preserve_effective_free(),private.billing_manual_grace_period(uuid,timestamptz),private.billing_manual_entitlement(public.user_profiles),
 public.my_entitlement_manual(),public.my_credits_cycle_v3(),public.billing_effective_profile_manual(uuid),public.billing_cycle_v3(text,jsonb),public.billing_cycle_capture_v3(uuid,jsonb,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.my_entitlement_manual(),public.my_credits_cycle_v3() TO authenticated;
GRANT EXECUTE ON FUNCTION public.billing_effective_profile_manual(uuid),public.billing_cycle_v3(text,jsonb),public.billing_cycle_capture_v3(uuid,jsonb,jsonb) TO service_role;
COMMIT;
