-- Operator-only script, not an RPC or migration. Caller MUST use BEGIN/COMMIT,
-- SET LOCAL lock_timeout='5s' and transaction-local billing.reset_* settings.
-- Load this definition, then SELECT pg_temp.reset_test_billing(); within that transaction.
-- Frozen user/order UUIDs plus row counts and wallet stop accidental widening.
CREATE OR REPLACE FUNCTION pg_temp.reset_test_billing() RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $reset$
DECLARE
 uid uuid:=current_setting('billing.reset_user')::uuid;
 expected uuid[]:=ARRAY(SELECT jsonb_array_elements_text(current_setting('billing.reset_orders')::jsonb)::uuid);
 contract jsonb:=current_setting('billing.reset_contract')::jsonb;
 actual uuid[]; before_balance numeric; removed numeric; kept numeric;
BEGIN
 IF cardinality(expected)=0 OR cardinality(expected)<>(SELECT count(DISTINCT x) FROM unnest(expected) x) THEN RAISE EXCEPTION 'Invalid frozen inventory'; END IF;
 PERFORM 1 FROM private.billing_orders WHERE user_id=uid ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.user_profiles WHERE user_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reset account absent'; END IF;
 PERFORM 1 FROM public.credit_wallets WHERE user_id=uid FOR UPDATE;
 IF EXISTS(SELECT FROM private.billing_orders WHERE (user_id=uid OR customer_id=uid) AND mode<>'test') THEN RAISE EXCEPTION 'Live purchase present; stop'; END IF;
 SELECT array_agg(id ORDER BY id) INTO actual FROM private.billing_orders WHERE user_id=uid AND customer_id=uid AND mode='test';
 IF actual IS DISTINCT FROM ARRAY(SELECT unnest(expected) ORDER BY 1) THEN RAISE EXCEPTION 'Order inventory changed; stop'; END IF;
 IF EXISTS(SELECT FROM public.credit_holds WHERE user_id=uid AND settled_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'Answer still running; stop'; END IF;
 IF (SELECT debt FROM public.credit_wallets WHERE user_id=uid) IS DISTINCT FROM 0::numeric THEN RAISE EXCEPTION 'Debt requires review'; END IF;
 CREATE TEMP TABLE reset_orders ON COMMIT DROP AS SELECT id,provider_order_id FROM private.billing_orders WHERE id=ANY(expected);
 CREATE TEMP TABLE reset_lots ON COMMIT DROP AS SELECT id FROM public.credit_lots WHERE user_id=uid AND billing_order_id=ANY(expected);
 IF EXISTS(SELECT FROM public.credit_lot_draws WHERE lot_id IN(SELECT id FROM reset_lots)) THEN RAISE EXCEPTION 'Purchase credits have been drawn; review before reset'; END IF;
 IF EXISTS(SELECT FROM public.credit_lots WHERE user_id=uid AND closed_at IS NULL AND kind<>'signup' AND id NOT IN(SELECT id FROM reset_lots)) THEN RAISE EXCEPTION 'Unlinked credits require review'; END IF;
 IF EXISTS(SELECT FROM public.plan_grants WHERE user_id=uid AND plan<>'free' AND billing_plan_period_id IS NULL) THEN RAISE EXCEPTION 'Unlinked paid grants require review'; END IF;
 IF jsonb_build_object(
  'payments',(SELECT count(*) FROM private.billing_payments WHERE order_id=ANY(expected)),
  'invoices',(SELECT count(*) FROM public.invoices WHERE user_id=uid AND billing_order_id=ANY(expected)),
  'periods',(SELECT count(*) FROM private.billing_plan_periods WHERE user_id=uid AND order_id=ANY(expected)),
  'lots',(SELECT count(*) FROM reset_lots),
  'ledger',(SELECT count(*) FROM public.credit_ledger WHERE user_id=uid AND (billing_order_id=ANY(expected) OR lot_id IN(SELECT id FROM reset_lots))),
  'balance',(SELECT balance FROM public.credit_wallets WHERE user_id=uid)) IS DISTINCT FROM contract THEN RAISE EXCEPTION 'Reset contract changed; stop'; END IF;
 SELECT balance INTO before_balance FROM public.credit_wallets WHERE user_id=uid;
 SELECT coalesce(sum(credits),0) INTO removed FROM public.credit_ledger WHERE user_id=uid AND (billing_order_id=ANY(expected) OR lot_id IN(SELECT id FROM reset_lots));
 SELECT coalesce(sum(remaining),0) INTO kept FROM public.credit_lots WHERE user_id=uid AND closed_at IS NULL AND id NOT IN(SELECT id FROM reset_lots);
 IF before_balance-removed<>kept THEN RAISE EXCEPTION 'Wallet removal does not reconcile'; END IF;
 DELETE FROM private.billing_plan_quotes WHERE user_id=uid AND mode='test';
 DELETE FROM private.billing_plan_changes WHERE user_id=uid AND mode='test';
 DELETE FROM private.billing_events e WHERE e.mode='test' AND EXISTS(SELECT FROM private.billing_orders o WHERE o.id=ANY(expected) AND o.account=e.account AND
   (e.payload->'payment'->'entity'->>'order_id'=o.provider_order_id OR e.payload->'order'->'entity'->>'id'=o.provider_order_id));
 DELETE FROM private.billing_adjustments WHERE payment_id IN(SELECT id FROM private.billing_payments WHERE order_id=ANY(expected));
 DELETE FROM public.credit_ledger WHERE user_id=uid AND (billing_order_id=ANY(expected) OR lot_id IN(SELECT id FROM reset_lots));
 DELETE FROM public.credit_lots WHERE id IN(SELECT id FROM reset_lots);
 DELETE FROM public.plan_grants WHERE user_id=uid AND (billing_plan_period_id IN(SELECT id FROM private.billing_plan_periods WHERE order_id=ANY(expected)) OR payment_id IN(SELECT provider_payment_id FROM private.billing_payments WHERE order_id=ANY(expected)));
 UPDATE public.user_profiles SET active_billing_plan_period_id=NULL,plan='free',plan_status='free',plan_source='manual',plan_period_end=NULL WHERE user_id=uid;
 DELETE FROM private.billing_plan_periods WHERE user_id=uid AND order_id=ANY(expected);
 DELETE FROM public.invoices WHERE user_id=uid AND billing_order_id=ANY(expected);
 UPDATE private.billing_orders SET fulfilled_payment_id=NULL WHERE id=ANY(expected);
 DELETE FROM private.billing_payments WHERE order_id=ANY(expected);
 DELETE FROM private.billing_orders WHERE user_id=uid AND id=ANY(expected);
 UPDATE public.credit_wallets SET balance=before_balance-removed,updated_at=now() WHERE user_id=uid;
 INSERT INTO public.plan_grants(user_id,plan,status,source) VALUES(uid,'free','free','manual');
 IF EXISTS(SELECT FROM private.billing_orders WHERE user_id=uid) OR
  (SELECT balance FROM public.credit_wallets WHERE user_id=uid)<>kept OR
  (SELECT coalesce(sum(credits),0) FROM public.credit_ledger WHERE user_id=uid)<>kept THEN RAISE EXCEPTION 'Reset postconditions failed'; END IF;
 RAISE NOTICE 'Test billing reset: user %, orders %, removed credits %, retained credits %',uid,cardinality(expected),removed,kept;
END $reset$;
