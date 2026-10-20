-- Additive mode-aware cycle-v2. Existing financial RPCs and stored facts remain.
-- Activation does not configure credentials or open Production checkout.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE private.billing_plan_quotes DROP CONSTRAINT billing_plan_quotes_mode_check;
ALTER TABLE private.billing_plan_quotes ADD CONSTRAINT billing_plan_quotes_mode_check CHECK(mode IN('test','live'));
ALTER TABLE private.billing_plan_changes DROP CONSTRAINT billing_plan_changes_mode_check;
ALTER TABLE private.billing_plan_changes ADD CONSTRAINT billing_plan_changes_mode_check CHECK(mode IN('test','live'));

DO $migration$
DECLARE f text; original text; replacement text;
BEGIN
 SELECT pg_get_functiondef('public.billing_cycle_daily(text,jsonb)'::regprocedure) INTO f;
 original:='FUNCTION public.billing_cycle_daily('; replacement:='FUNCTION public.billing_cycle_v2(';
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Daily cycle signature changed; review v2'; END IF;
 f:=replace(f,original,replacement);
 original:=$old$IF p->>'mode' IS DISTINCT FROM 'test' OR nullif(p->>'account','') IS NULL THEN RAISE EXCEPTION 'Test cycle contract only'$old$;
 replacement:=$new$IF coalesce(p->>'mode','') NOT IN('test','live') OR nullif(p->>'account','') IS NULL THEN RAISE EXCEPTION 'Valid billing environment required'$new$;
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Daily mode guard changed; review v2'; END IF;
 f:=replace(f,original,replacement);
 original:=$old$current_plan<>'free' AND (b.id IS NULL OR NOT EXISTS(SELECT FROM private.billing_orders x WHERE x.id=b.order_id AND x.account=p->>'account' AND x.mode=p->>'mode'))$old$;
 replacement:=$new$(current_plan<>'free' AND b.id IS NULL) OR (b.id IS NOT NULL AND NOT EXISTS(SELECT FROM private.billing_orders x WHERE x.id=b.order_id AND x.user_id=uid AND x.account=p->>'account' AND x.mode=p->>'mode'))$new$;
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Daily ownership guard changed; review v2'; END IF;
 f:=replace(f,original,replacement);
 -- The financial contract is the same; its new version identifies mode-aware
 -- capture. Immutable v1 purchases retain the original capture implementation.
 IF position('cycle-v1' in f)=0 THEN RAISE EXCEPTION 'Daily snapshot version changed; review v2'; END IF;
 f:=replace(f,'cycle-v1','cycle-v2');
 EXECUTE f;
END $migration$;

DO $migration$
DECLARE f text; original text; replacement text;
BEGIN
 SELECT pg_get_functiondef('public.billing_cycle_capture(uuid,jsonb)'::regprocedure) INTO f;
 original:='FUNCTION public.billing_cycle_capture(p_order_id uuid, p_payment jsonb)';
 replacement:='FUNCTION public.billing_cycle_capture_v2(p_order_id uuid, p_payment jsonb, p_context jsonb)';
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Cycle capture signature changed; review v2'; END IF;
 f:=replace(f,original,replacement);
 original:=$old$IF o.id IS NULL THEN RAISE EXCEPTION 'Unknown purchase'; END IF;$old$;
 replacement:=$new$IF o.id IS NULL THEN RAISE EXCEPTION 'Unknown purchase'; END IF;
 IF coalesce(p_context->>'mode','') NOT IN('test','live')
   OR o.mode IS DISTINCT FROM p_context->>'mode' OR o.account IS DISTINCT FROM p_context->>'account'
   OR o.snapshot->>'contract' IS DISTINCT FROM 'cycle-v2'
   OR NOT EXISTS(SELECT FROM private.billing_plan_quotes q WHERE q.id=(o.snapshot->>'quoteId')::uuid
     AND q.order_id=o.id AND q.user_id=o.user_id AND q.account=o.account AND q.mode=o.mode) THEN
  RAISE EXCEPTION 'Cycle capture environment mismatch' USING ERRCODE='42501';
 END IF;$new$;
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Cycle capture binding changed; review v2'; END IF;
 f:=replace(f,original,replacement);
 original:=$old$o.mode<>'test'$old$;
 IF position(original in f)=0 THEN RAISE EXCEPTION 'Cycle capture mode changed; review v2'; END IF;
 f:=replace(f,original,$new$o.mode NOT IN('test','live')$new$);
 IF position('cycle-v1' in f)=0 THEN RAISE EXCEPTION 'Cycle capture version changed; review v2'; END IF;
 f:=replace(f,'cycle-v1','cycle-v2');
 EXECUTE f;
END $migration$;

CREATE FUNCTION public.my_credits_cycle_v2() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; b private.billing_plan_periods;
BEGIN
 result:=public.my_credits();
 SELECT x.* INTO b FROM private.billing_plan_periods x JOIN private.billing_orders o ON o.id=x.order_id
  WHERE x.user_id=auth.uid() AND x.state='active' AND x.starts_at<=now() AND x.ends_at>now()
    AND o.snapshot->>'contract' IN('cycle-v1','cycle-v2');
 IF FOUND THEN result:=jsonb_set(result,'{cycle,allowance}',to_jsonb(b.credits)); END IF;
 RETURN result;
END $$;
ALTER FUNCTION public.billing_cycle_v2(text,jsonb) OWNER TO postgres;
ALTER FUNCTION public.billing_cycle_capture_v2(uuid,jsonb,jsonb) OWNER TO postgres;
ALTER FUNCTION public.my_credits_cycle_v2() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.billing_cycle_v2(text,jsonb),public.billing_cycle_capture_v2(uuid,jsonb,jsonb),public.my_credits_cycle_v2() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_cycle_v2(text,jsonb),public.billing_cycle_capture_v2(uuid,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.my_credits_cycle_v2() TO authenticated;
COMMIT;
