-- F238: additive, service-only unused top-up review and refund projection.
-- No provider calls, financial backfill, invoice rewrite, or old RPC replacement.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.billing_review_adjustment_v2(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE o private.billing_orders; pay private.billing_payments; a private.billing_adjustments;
 actor uuid:=(p->>'actorId')::uuid; d jsonb:=p->'decision'; n numeric; restored numeric;
 l public.credit_lots; w public.credit_wallets; s public.credit_settings; eid uuid; qty numeric;
BEGIN
 IF coalesce(p->>'mode','') NOT IN('test','live') OR nullif(p->>'account','') IS NULL
  OR NOT EXISTS(SELECT FROM public.user_profiles WHERE user_id=actor AND role='admin' AND status='active') THEN
  RAISE EXCEPTION 'Administrator and billing environment required' USING ERRCODE='42501'; END IF;
 SELECT bo.* INTO o FROM private.billing_orders bo JOIN private.billing_payments bp ON bp.order_id=bo.id
  JOIN private.billing_adjustments ba ON ba.payment_id=bp.id WHERE ba.id=(p->>'adjustmentId')::uuid
  AND bo.account=p->>'account' AND bo.mode=p->>'mode' AND bp.account=bo.account AND bp.mode=bo.mode;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Adjustment not found in billing environment' USING ERRCODE='42501'; END IF;
 -- Same lock order as capture/legacy review; no generic lot draw or refresh.
 PERFORM 1 FROM private.billing_orders WHERE id=o.id FOR UPDATE;
 SELECT * INTO pay FROM private.billing_payments WHERE order_id=o.id
  AND id=(SELECT payment_id FROM private.billing_adjustments WHERE id=(p->>'adjustmentId')::uuid) FOR UPDATE;
 SELECT * INTO a FROM private.billing_adjustments WHERE id=(p->>'adjustmentId')::uuid FOR UPDATE;
 IF a.reviewed_at IS NOT NULL THEN
  IF a.request_id IS DISTINCT FROM (p->>'requestId')::uuid OR a.decision IS DISTINCT FROM d THEN
   RAISE EXCEPTION 'Review retry conflict' USING ERRCODE='23505'; END IF;
  RETURN to_jsonb(a);
 END IF;
 n:=coalesce((d->>'creditsToRemove')::numeric,0); restored:=coalesce((d->>'creditsToRestore')::numeric,0);
 IF o.snapshot->>'kind' IS DISTINCT FROM 'topup' OR n=0 THEN
  RETURN public.billing_review_adjustment(p);
 END IF;
 qty:=(o.snapshot->>'credits')::numeric;
 IF n<=0 OR n IS DISTINCT FROM qty OR n<>round(n,4) OR restored<>0
  OR coalesce((d->>'cancelPeriod')::boolean,false) OR coalesce((d->>'restorePeriod')::boolean,false)
  OR a.kind NOT IN('refund','purchase_review') OR (a.kind='purchase_review' AND d->>'resolution' IS DISTINCT FROM 'refund_recorded')
  OR length(btrim(coalesce(d->>'reason','')))<5 OR nullif(p->>'requestId','') IS NULL THEN
  RAISE EXCEPTION 'Unused top-up review requires support: purchase is not fully refunded and unused' USING ERRCODE='23514'; END IF;
 IF o.state<>'fulfilled' OR o.fulfilled_payment_id IS DISTINCT FROM pay.id OR pay.refunded_paise<>pay.amount_paise
  OR pay.amount_paise<>o.amount_paise OR pay.currency<>o.currency OR pay.status NOT IN('captured','refunded') THEN
  RAISE EXCEPTION 'Unused top-up review requires support: purchase is not fully refunded and unused' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT FROM private.billing_adjustments x JOIN private.billing_payments y ON y.id=x.payment_id
   WHERE y.order_id=o.id AND x.reviewed_at IS NOT NULL
   AND (coalesce((x.decision->>'creditsToRemove')::numeric,0)<>0 OR coalesce((x.decision->>'creditsToRestore')::numeric,0)<>0))
  OR EXISTS(SELECT FROM public.credit_ledger WHERE billing_order_id=o.id AND kind='adjustment') THEN
  RAISE EXCEPTION 'Unused top-up review requires support: purchase is not fully refunded and unused' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM public.user_profiles WHERE user_id=o.user_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active buyer required for benefit adjustment' USING ERRCODE='42501'; END IF;
 s:=private.credit_config(); w:=private.credit_wallet(o.user_id);
 IF o.snapshot->>'creditUnit' IS DISTINCT FROM 'credit-paise-v2' OR s.inr_per_credit<>0.01 THEN
  RAISE EXCEPTION 'Unused top-up review requires support: purchase is not fully refunded and unused' USING ERRCODE='23514'; END IF;
 -- Even expired holds may receive late charge rows until swept. Never sweep in
 -- this operator operation: it must not mutate unrelated lots or create debt.
 IF EXISTS(SELECT FROM public.credit_holds WHERE user_id=o.user_id AND swept_at IS NULL) THEN
  RAISE EXCEPTION 'Unused top-up review requires support: purchase is not fully refunded and unused' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM public.credit_lots WHERE billing_order_id=o.id ORDER BY id FOR UPDATE;
 SELECT * INTO l FROM public.credit_lots WHERE billing_order_id=o.id AND source_key='purchase:'||o.id;
 IF l.id IS NULL OR (SELECT count(*) FROM public.credit_lots WHERE billing_order_id=o.id)<>1
  OR l.user_id IS DISTINCT FROM o.user_id OR l.kind<>'topup' OR l.billing_plan_period_id IS NOT NULL
  OR l.granted IS DISTINCT FROM qty OR l.remaining IS DISTINCT FROM qty
  OR l.closed_at IS NOT NULL OR l.starts_at>now() OR l.expires_at<=now()
  OR EXISTS(SELECT FROM public.credit_lot_draws WHERE lot_id=l.id)
  OR (SELECT count(*) FROM public.credit_ledger WHERE lot_id=l.id)<>1
  OR NOT EXISTS(SELECT FROM public.credit_ledger g WHERE g.lot_id=l.id AND g.user_id=o.user_id AND g.kind='grant'
   AND g.credits=qty AND g.billing_order_id=o.id AND g.billing_adjustment_id IS NULL)
  OR w.balance<n THEN
  RAISE EXCEPTION 'Unused top-up review requires support: purchase is not fully refunded and unused' USING ERRCODE='23514'; END IF;
 eid:=private.credit_entry(o.user_id,'adjustment',-n,NULL,NULL,(p->>'requestId')::uuid,NULL,NULL,actor,d->>'reason');
 UPDATE public.credit_ledger SET billing_order_id=o.id,billing_adjustment_id=a.id WHERE id=eid;
 UPDATE public.credit_lots SET remaining=0,closed_at=now() WHERE id=l.id;
 INSERT INTO public.credit_lot_draws(lot_id,ledger_id,reason,credits) VALUES(l.id,eid,'removal',n);
 UPDATE private.billing_adjustments SET decision=d,request_id=(p->>'requestId')::uuid,reviewed_by=actor,reviewed_at=now()
  WHERE id=a.id RETURNING * INTO a;
 RETURN to_jsonb(a);
END $$;

CREATE FUNCTION public.billing_purchases_v2(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE purchases jsonb; result jsonb;
BEGIN
 IF coalesce(p->>'mode','') NOT IN('test','live') OR nullif(p->>'account','') IS NULL OR nullif(p->>'userId','') IS NULL THEN
  RAISE EXCEPTION 'Buyer and billing environment required' USING ERRCODE='42501'; END IF;
 purchases:=public.billing_creation_retry('list',p);
 SELECT coalesce(jsonb_agg(item.value||jsonb_build_object(
  'refunded_paise',CASE WHEN o.fulfilled_payment_id IS NOT NULL THEN coalesce((SELECT bp.refunded_paise FROM private.billing_payments bp
    WHERE bp.id=o.fulfilled_payment_id AND bp.order_id=o.id AND bp.account=o.account AND bp.mode=o.mode),0)
   ELSE least(o.amount_paise,coalesce((SELECT sum(bp.refunded_paise) FROM private.billing_payments bp
    WHERE bp.order_id=o.id AND bp.account=o.account AND bp.mode=o.mode),0)) END,
  'refund_review_pending',EXISTS(SELECT FROM private.billing_adjustments a JOIN private.billing_payments bp ON bp.id=a.payment_id
   WHERE bp.order_id=o.id AND bp.account=o.account AND bp.mode=o.mode AND a.reviewed_at IS NULL
   AND a.kind IN('refund','purchase_review') AND (o.fulfilled_payment_id IS NULL OR bp.id=o.fulfilled_payment_id))) ORDER BY item.ordinality),'[]') INTO result
 FROM jsonb_array_elements(purchases) WITH ORDINALITY item(value,ordinality)
 JOIN private.billing_orders o ON o.id=(item.value->>'id')::uuid
  AND o.user_id=(p->>'userId')::uuid AND o.account=p->>'account' AND o.mode=p->>'mode';
 RETURN result;
END $$;
ALTER FUNCTION public.billing_review_adjustment_v2(jsonb) OWNER TO postgres;
ALTER FUNCTION public.billing_purchases_v2(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.billing_review_adjustment_v2(jsonb),public.billing_purchases_v2(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_review_adjustment_v2(jsonb),public.billing_purchases_v2(jsonb) TO service_role;
COMMIT;
