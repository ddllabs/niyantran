-- Additive read preflight and unambiguous operator-list aliases. No financial backfill.
BEGIN;
CREATE OR REPLACE FUNCTION public.billing_event(p_action text,p jsonb) RETURNS jsonb
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
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM(SELECT adj.* FROM private.billing_adjustments adj JOIN private.billing_payments payment_row ON payment_row.id=adj.payment_id
   WHERE payment_row.account=p->>'account' AND payment_row.mode=p->>'mode' AND adj.reviewed_at IS NULL ORDER BY adj.created_at,adj.id LIMIT 50)t),'[]');
 END IF;
 RAISE EXCEPTION 'Unknown event operation';
END $$;
ALTER FUNCTION public.billing_event(text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.billing_event(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_event(text,jsonb) TO service_role;

CREATE FUNCTION public.billing_checkout_preflight(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE purchase private.billing_orders; version bigint;
BEGIN
 SELECT * INTO purchase FROM private.billing_orders
  WHERE id=(p->>'purchaseId')::uuid AND user_id=(p->>'userId')::uuid
   AND account=p->>'account' AND mode=p->>'mode';
 IF purchase.id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles WHERE user_id=purchase.user_id AND status='active') THEN
  RAISE EXCEPTION 'Purchase not found' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(max(id),0) INTO version FROM public.plan_grants WHERE user_id=purchase.user_id;
 RETURN jsonb_build_object('stale',purchase.snapshot->>'kind'='plan' AND
   (purchase.snapshot->>'grantVersion')::bigint IS DISTINCT FROM version,
   'version',version::text,
   'observedPayment',EXISTS(SELECT FROM private.billing_payments WHERE order_id=purchase.id)
     OR EXISTS(SELECT FROM public.invoices WHERE billing_order_id=purchase.id));
END $$;
ALTER FUNCTION public.billing_checkout_preflight(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.billing_checkout_preflight(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_checkout_preflight(jsonb) TO service_role;
COMMIT;
