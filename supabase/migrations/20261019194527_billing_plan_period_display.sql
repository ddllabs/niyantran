-- Read-only projection. No entitlement refresh, credit minting or financial DML.
BEGIN;
CREATE FUNCTION public.billing_plan_periods(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM public.user_profiles WHERE user_id=(p->>'userId')::uuid AND status='active') THEN
  RAISE EXCEPTION 'Active buyer required' USING ERRCODE='42501';
 END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',b.id,'purchaseId',b.order_id,'plan',b.plan,'startsAt',b.starts_at,'endsAt',b.ends_at,
   'credits',b.credits,'status',CASE WHEN b.starts_at>now() THEN 'scheduled' ELSE 'active' END,
   'invoiceId',inv.id) ORDER BY b.starts_at,b.id)
  FROM private.billing_plan_periods b
  JOIN private.billing_orders o ON o.id=b.order_id AND o.user_id=b.user_id
  JOIN public.invoices inv ON inv.billing_order_id=o.id
  WHERE b.user_id=(p->>'userId')::uuid AND o.account=p->>'account' AND o.mode=p->>'mode'
    AND o.state='fulfilled' AND b.state IN ('active','scheduled') AND b.ends_at>now()),'[]'::jsonb);
END $$;
ALTER FUNCTION public.billing_plan_periods(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.billing_plan_periods(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_plan_periods(jsonb) TO service_role;
COMMIT;
