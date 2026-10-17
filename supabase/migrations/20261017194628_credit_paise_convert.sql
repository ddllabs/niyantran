-- F225 controlled one-paisa cutover. Apply only after the compatible credit
-- contract and readers are installed, answer starts/admin grants are paused,
-- and all in-flight turns and five-minute sweeps have drained. This file is
-- intentionally separate: installing the contract never changes balances.
-- One statement is atomic even when a migration runner autocommits each SQL
-- statement; it also remains atomic when the runner wraps the whole file.
-- Any failure rolls back the pause, ledger entries, lots, and settings.
DO $$
DECLARE v_was_paused boolean;
BEGIN
  PERFORM set_config('lock_timeout', '10s', true);
  SELECT paused INTO v_was_paused FROM private.credit_epoch
  WHERE id AND unit_version = 'credit-ten-paise-v1' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit cutover requires the ten-paise epoch' USING ERRCODE = '55000';
  END IF;
  UPDATE private.credit_epoch SET paused = true
  WHERE id AND unit_version = 'credit-ten-paise-v1';
  PERFORM private.credit_convert_to_paise();
  UPDATE private.credit_epoch SET paused = v_was_paused WHERE id;
END;
$$;
