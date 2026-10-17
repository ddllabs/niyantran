-- A fresh credit installation converts defaults without fabricating accounts.
-- Vacuity: red without 20261017194628_credit_paise_convert.sql.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF (SELECT unit_version <> 'credit-paise-v2' OR paused FROM private.credit_epoch WHERE id)
    OR (SELECT inr_per_credit <> 0.01 OR signup_credits <> 10000 OR hold_credits <> 3000
        FROM public.credit_settings WHERE id)
    OR EXISTS (SELECT FROM public.credit_wallets)
    OR EXISTS (SELECT FROM private.credit_wallet_conversions)
    OR EXISTS (SELECT FROM private.credit_lot_conversions) THEN
    RAISE EXCEPTION 'Fresh credit conversion changed the wrong state';
  END IF;
END;
$$;
ROLLBACK;
