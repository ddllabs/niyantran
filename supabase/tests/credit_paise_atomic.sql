-- Extra autocommit stage for credit_paise_contract. run.sh substitutes each
-- marker with the actual cutover migration text. There is no outer BEGIN:
-- splitting pause and conversion into separate statements must fail here.
\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;
INSERT INTO public.credit_holds (user_id,turn_key,credits,expires_at)
VALUES ('00000000-0000-4000-8000-00000000c0a1','atomic-cutover-hold',3,now()+interval '5 minutes');

-- Failure from an initially unpaused epoch must leave it unpaused.
\set ON_ERROR_STOP off
-- @cutover-migration
\set first_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(:'first_state'='55000'
  AND (SELECT unit_version='credit-ten-paise-v1' AND NOT paused FROM private.credit_epoch WHERE id)
  AND (SELECT inr_per_credit=0.10 FROM public.credit_settings WHERE id)
  AND NOT EXISTS (SELECT FROM private.credit_legacy_entries)
  AND NOT EXISTS (SELECT FROM private.credit_lot_conversions),
  'unpaused whole-cutover failure leaves no partial state');

-- Failure after the release operator has already paused writes preserves it.
UPDATE private.credit_epoch SET paused=true WHERE id;
\set ON_ERROR_STOP off
-- @cutover-migration
\set second_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(:'second_state'='55000'
  AND (SELECT unit_version='credit-ten-paise-v1' AND paused FROM private.credit_epoch WHERE id)
  AND (SELECT inr_per_credit=0.10 FROM public.credit_settings WHERE id)
  AND NOT EXISTS (SELECT FROM private.credit_legacy_entries)
  AND NOT EXISTS (SELECT FROM private.credit_lot_conversions),
  'prepaused whole-cutover failure preserves pause with no partial state');
