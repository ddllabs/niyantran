-- Monthly credits expire without carry-forward. Historical rollover lots and
-- purchase provenance remain readable/spendable/refundable until their expiry.
-- Applies to lazy expiry of pre-cutover monthly lots as well as new cycles.
BEGIN;
UPDATE public.credit_settings SET rollover_pct = 0 WHERE id = true;
ALTER TABLE public.credit_settings ADD CONSTRAINT credit_rollover_retired CHECK (rollover_pct = 0);

CREATE OR REPLACE FUNCTION private.credit_close_lot(p_lot uuid, p_now timestamptz, p_natural boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE o public.credit_lots;
BEGIN
  SELECT * INTO o FROM public.credit_lots WHERE id = p_lot FOR UPDATE;
  IF NOT FOUND OR o.closed_at IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE public.credit_lots SET remaining = 0, closed_at = p_now WHERE id = o.id;
  IF o.remaining > 0 THEN
    PERFORM private.credit_entry(o.user_id, 'expiry', -o.remaining, o.id, NULL, NULL, NULL, NULL, NULL,
      CASE WHEN p_natural THEN 'expired' ELSE 'plan changed' END);
  END IF;
END;
$$;
-- CREATE OR REPLACE preserves the original ACL; explicitly keep it internal.
REVOKE ALL ON FUNCTION private.credit_close_lot(uuid,timestamptz,boolean) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
