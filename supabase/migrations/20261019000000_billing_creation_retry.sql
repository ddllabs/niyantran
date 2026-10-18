-- Explicitly rejected creation may retry the same intent; unknown outcomes may not.
BEGIN;
ALTER TABLE private.billing_orders
 ADD COLUMN creation_retryable boolean NOT NULL DEFAULT false,
 ADD COLUMN creation_failures jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(creation_failures)='array');

CREATE FUNCTION public.billing_creation_retry(p_action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE o private.billing_orders; actor uuid; entry jsonb;
BEGIN
 IF p_action='list' THEN
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
   SELECT id,provider_order_id,state,snapshot,created_at,(creation_retryable AND provider_order_id IS NULL) AS creation_retryable
   FROM private.billing_orders WHERE user_id=(p->>'userId')::uuid
    AND account=p->>'account' AND mode=p->>'mode' ORDER BY created_at DESC LIMIT 30
  ) t),'[]');
 END IF;
 IF p_action NOT IN ('claim','reject','review_rejection') THEN RAISE EXCEPTION 'Unknown retry operation'; END IF;
 -- Match immutable scope and buyer before locking or making any change.
 SELECT * INTO o FROM private.billing_orders WHERE id=(p->>'purchaseId')::uuid
  AND user_id=(p->>'userId')::uuid AND account=p->>'account' AND mode=p->>'mode' FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Purchase not found' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM public.user_profiles WHERE user_id=o.user_id AND status='active') THEN
  RAISE EXCEPTION 'Active buyer required' USING ERRCODE='42501'; END IF;
 IF o.provider_order_id IS NOT NULL OR o.state NOT IN ('creating','reconciling')
  OR EXISTS(SELECT FROM private.billing_payments WHERE order_id=o.id)
  OR EXISTS(SELECT FROM public.invoices WHERE billing_order_id=o.id) THEN
  RETURN CASE WHEN p_action='claim' THEN jsonb_build_object('canCreate',false,'order',to_jsonb(o)) ELSE to_jsonb(o) END;
 END IF;
 IF p_action='claim' THEN
  IF NOT o.creation_retryable OR coalesce(o.lease_until,'-infinity')>now()
   OR jsonb_array_length(o.creation_failures)>=10 THEN
   RETURN jsonb_build_object('canCreate',false,'order',to_jsonb(o)); END IF;
  -- Match capture lock order: purchase row, then profile.
  PERFORM 1 FROM public.user_profiles WHERE user_id=o.user_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active buyer required' USING ERRCODE='42501'; END IF;
  IF o.snapshot->>'kind'='plan' AND (o.snapshot->>'grantVersion')::bigint IS DISTINCT FROM
    coalesce((SELECT max(id) FROM public.plan_grants WHERE user_id=o.user_id),0) THEN
   RETURN jsonb_build_object('canCreate',false,'order',to_jsonb(o)); END IF;
  UPDATE private.billing_orders SET creation_retryable=false,state='creating',
   lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
   WHERE id=o.id RETURNING * INTO o;
  RETURN jsonb_build_object('canCreate',true,'order',to_jsonb(o));
 END IF;
 IF p_action='reject' THEN
  IF coalesce((p->>'providerStatus')::int,0) NOT IN (401,403) THEN
   RAISE EXCEPTION 'Only explicit authentication rejection is retryable'; END IF;
  IF o.lease_token IS DISTINCT FROM nullif(p->>'leaseToken','')::uuid THEN
   RAISE EXCEPTION 'Retry lease mismatch' USING ERRCODE='40001'; END IF;
  -- Re-delivery cannot append another rejection or release another worker's lease.
  IF o.creation_retryable THEN RETURN to_jsonb(o); END IF;
  entry:=jsonb_build_object('source','provider','httpStatus',(p->>'providerStatus')::int,'at',now());
 ELSE
  -- Legacy unclassified attempts need a human's reviewed evidence, never an
  -- automatic inference from an empty provider lookup. This operation is Test-only.
  actor:=(p->>'actorId')::uuid;
  IF o.mode<>'test' OR NOT EXISTS(SELECT FROM public.user_profiles WHERE user_id=actor AND role='admin' AND status='active')
   OR p->>'providerAbsenceConfirmed' IS DISTINCT FROM 'true'
   OR length(btrim(coalesce(p->>'reason','')))<20 OR length(p->>'reason')>500
   OR o.created_at>now()-interval '5 minutes' OR coalesce(o.lease_until,'-infinity')>now() THEN
   RAISE EXCEPTION 'Reviewed Test rejection evidence required' USING ERRCODE='42501'; END IF;
  IF o.creation_retryable THEN RETURN to_jsonb(o); END IF;
  entry:=jsonb_build_object('source','operator','actorId',actor,'reason',p->>'reason','at',now());
 END IF;
 IF jsonb_array_length(o.creation_failures)>=10 THEN RAISE EXCEPTION 'Retry review limit reached'; END IF;
 UPDATE private.billing_orders SET creation_retryable=true,state='reconciling',
  creation_failures=creation_failures||jsonb_build_array(entry),
  attempts=attempts+1,lease_token=NULL,lease_until=NULL,next_attempt_at=now()+interval '5 minutes'
  WHERE id=o.id RETURNING * INTO o;
 RETURN to_jsonb(o);
END $$;
ALTER FUNCTION public.billing_creation_retry(text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.billing_creation_retry(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_creation_retry(text,jsonb) TO service_role;
COMMIT;
