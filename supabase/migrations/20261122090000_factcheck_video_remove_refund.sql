-- Live TV fact-check: removing a video's shared results refunds the unlocks (open-work F364; owner decision 2026-11-18).
--
-- Before: public.factcheck_video_remove(p_video_id) (20261117090000_factcheck_sharing.sql) deleted the stored transcript pieces of
--   the video and stopped sharing every session of it. A user who had paid credits to unlock a stretch of the video lost access
--   and kept the charge: nothing was refunded.
-- After:  the same function, same signature, SECURITY DEFINER, search_path '', TimeZone UTC and grants (authenticated, checked
--   inside: platform administrators only, 42501 otherwise), also refunds, in the same transaction as the removal, every unlock
--   of that video that has not been refunded yet, in full, to the user who paid it, exactly once.
--
--   * New column public.factcheck_unlocks.refunded_at timestamptz (nullable, no default). It is the durable marker: set in the
--     same transaction as the refund, never cleared. Existing rows get NULL (not refunded). Added with IF NOT EXISTS.
--   * Which unlocks: every row of public.factcheck_unlocks with video_id = p_video_id and refunded_at IS NULL, whether or not the
--     session is still shareable. So a second call refunds nothing, and a call made later sweeps up an unlock that landed after
--     an earlier removal (see "Race" below). The rows are read with FOR UPDATE, in user order: a second removal at the same time
--     waits for the first, then sees refunded_at set and skips the row (read committed re-evaluates the row it waited for).
--   * How much: what was actually charged, read from the credit ledger, not from the unlock row. The unlock's private key
--     (private.factcheck_unlock_keys.turn_key) finds the ledger charge (kind 'charge', turn_key 'fcu:...', note
--     'live tv fact-check'); the refund is that charge's credits in the current unit (private.credit_current_amount of the
--     charge's own credits and frozen rate, exactly as the credit reports read it). It is never taken from credits_charged,
--     never more than the one charge, and the price now is irrelevant. An unlock with no ledger charge (none can exist: the
--     charge and the row are written together, and the ledger rows of an account go with the account and its unlocks) or with
--     a charge that is not above zero is skipped: nothing is refunded, refunded_at stays NULL, the removal still happens.
--     Unlocks cost more than 0 (CHECK credits_charged > 0), and the runner's own read of its own stretch is never an unlock
--     (factcheck_unlock answers 'own' and writes nothing), so neither a free unlock nor an owner's row exists to be refunded.
--   * How it is written, through the existing credit mechanism (the same one an administrator's positive adjustment uses,
--     public.admin_adjust_credits_v2, and the billing restore): the wallet is locked and brought up to date
--     (private.credit_refresh, which also honours a credit-write pause: while credits are paused the removal raises 55000 and
--     changes nothing), then private.credit_mint creates a lot of kind 'adjustment' (starts now, expires in 12 months, as an
--     administrator's adjustment does) with source key 'fcu-refund:<unlock id>' and one ledger entry of kind 'adjustment'
--     (credits positive, request_id = the unlock id, created_by = the administrator, note 'live tv fact-check unlock refund'),
--     and private.credit_repay applies the new credits to any debt first, as for every other grant. The wallet balance rises by
--     exactly the refund. The source key and the unique request_id make a second refund of one unlock impossible even if the
--     marker were lost: the lot is not minted again and the unlock is only marked.
--   * What the user's data looks like afterwards: the factcheck_unlocks row is KEPT with refunded_at set (the user can still
--     read their own row, now showing the refund time); the ledger keeps the original charge and gains one positive
--     'adjustment' entry; my_credits.lots lists the refund as a lot of kind 'adjustment'. The unlock no longer grants access:
--     the removal deletes the video's stored pieces and sets shareable = false on every session of it, and factcheck_video_view,
--     factcheck_report and factcheck_unlock all read only shareable sessions (the first and last also need stored pieces), so
--     the stretch is not listed, cannot be read, cannot be reported on and cannot be unlocked again. (An unlocked session is a
--     settled one, and a settled session cannot be shared again: factcheck_mark_shareable takes only an active session.)
--   * Usage reports (my_credits, my_usage_summary, my_usage_activity) are unchanged and read only ledger entries of kind
--     'charge', so the refund is not counted as usage and nothing is double counted. How it appears to the user: the original
--     fact-check charge stays in their usage totals and activity list (it was spent and is a true record of it); the balance
--     is higher by the refund; my_credits.lots shows a lot of kind 'adjustment' holding it; there is no separate "refund" line
--     in the usage history, and used_this_cycle still includes the refunded unlock. Making the reports net of refunds would
--     change those functions and is a separate decision (see the report that came with this change).
--   * Returns {ok, pieces_deleted, sessions} as before, plus unlocks_refunded (integer) and credits_refunded (number, in the
--     current unit; 0 when nothing was refunded).
--   * Lock order: (1) the one row of private.credit_epoch, FOR NO KEY UPDATE; (2) the video's unlock rows; (3) each user's wallet,
--     in user id order; (4) the pieces and sessions. Every credit writer takes the epoch row FOR SHARE first (credit_write_gate,
--     called by credit_config and credit_wallet) and the wallet after it, so nobody holds a wallet or an unlock row while
--     waiting for the epoch row, and no cycle is possible. The currency cutover also takes that row, so it excludes a removal.
--   * Race closed: an unlock open when the removal starts holds the epoch row FOR SHARE until it commits, so the removal waits
--     for it, then its snapshot sees the unlock and refunds it. An unlock that starts while the removal is open waits at the
--     gate, then (after the removal commits) finds the session no longer shareable and answers not_found, charging nothing.
--     Cost: while a removal runs, credit writes for ALL users (answers, top-ups, unlocks, adjustments) wait for it. A removal
--     is a few indexed statements plus one mint per refunded unlock, so it holds the row for milliseconds to some seconds
--     (about 0.1 s in the test with three unlocks); the row is released at commit.
--   * Bounded wait: the function carries SET lock_timeout = '10s' (a function-level SET, restored when the function returns;
--     a SET LOCAL inside the body would outlive it for the rest of the transaction). A removal that cannot get a lock in
--     10 s (the epoch row, an unlock row or a wallet) raises 55P03 and changes nothing, and can be retried. Writers waiting on
--     the removal are not given this limit by it.
--   * Credit writes paused (private.credit_epoch.paused): the removal still takes the epoch row, then the first wallet refresh
--     raises 55000 'Credit writes are paused' and nothing changes. A video with no unlock to refund is removed as before.
--   * Nothing else changes: no price, no other function, no policy or grant.
--
-- The migration refuses (55000) to run over a public.factcheck_video_remove whose source is neither the one in
-- 20261117090000_factcheck_sharing.sql (md5 e8d6c7f9e013be8bea16724d1f0932dc) nor this migration's own, so a hot fix is never
-- overwritten. Applying it twice is a no-op (the column exists, the function is replaced by the same text).
--
-- Down note: the rollback below restores the old function, which takes no epoch lock and has no lock_timeout of its own (the
-- SET clauses of CREATE OR REPLACE replace the function's settings).
--
-- RELEASE ORDER: apply this migration, then deploy the browser that says users are refunded. (The new browser works against
-- the old function too, but its confirmation would then promise a refund the database does not make; the old browser against
-- the new function states the opposite and is merely out of date.) No Edge function is involved. Not applied to the live
-- database by this change.
--
-- Down (rollback), as the migrating role: the browser first, then
--   (a) The function. Run CREATE OR REPLACE FUNCTION public.factcheck_video_remove with the exact text from
--       20261117090000_factcheck_sharing.sql (source md5 e8d6c7f9e013be8bea16724d1f0932dc, which this migration's guard accepts).
--       Grants and owner stay. Refunds already made stay: the ledger is append-only, and the lots are the users' credits.
--   (b) The column is harmless to leave. To drop it, only when nothing reads it:
--       alter table public.factcheck_unlocks drop column refunded_at;   (this loses which unlocks were refunded)

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.factcheck_video_remove(text)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('e8d6c7f9e013be8bea16724d1f0932dc', 'c0c4b68359304c0fee94dac89047da6d') THEN
    RAISE EXCEPTION 'factcheck_video_remove_refund: public.factcheck_video_remove differs from the version this migration was written against (source md5 %); review it before applying',
      coalesce(v_md5, 'missing') USING ERRCODE = '55000';
  END IF;
END
$guard$;

ALTER TABLE public.factcheck_unlocks ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

CREATE OR REPLACE FUNCTION public.factcheck_video_remove(p_video_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' SET lock_timeout = '10s' AS $$
DECLARE
  v_pieces integer;
  v_sessions integer;
  v_admin uuid := auth.uid();
  v_refunded integer := 0;
  v_credits numeric := 0;
  v_prev uuid;
  v_amount numeric;
  v_lot uuid;
  u record;
  c record;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrators only' USING ERRCODE = '42501';
  END IF;
  -- The credit epoch row, before anything else: every credit writer (factcheck_unlock included) takes it FOR SHARE first, through
  -- private.credit_write_gate, and holds it to commit. This waits for the unlocks open now, and an unlock that starts later
  -- waits for this removal: so every unlock is either seen by the loop below or finds the stretch gone and charges nothing.
  PERFORM 1 FROM private.credit_epoch WHERE id FOR NO KEY UPDATE;
  -- Refunds first: the unlock rows are locked (so a second removal waits and then skips what this one marked), and each
  -- user's wallet is locked in user order. A charge of the unlock, in the ledger, decides the amount.
  FOR u IN
    SELECT x.id, x.user_id, k.turn_key
    FROM public.factcheck_unlocks x
    LEFT JOIN private.factcheck_unlock_keys k ON k.unlock_id = x.id
    WHERE x.video_id = p_video_id AND x.refunded_at IS NULL
    ORDER BY x.user_id, x.created_at, x.id
    FOR UPDATE OF x
  LOOP
    IF u.user_id IS DISTINCT FROM v_prev THEN
      PERFORM private.credit_refresh(u.user_id, now());
      v_prev := u.user_id;
    END IF;
    SELECT e.credits, e.inr_per_credit INTO c FROM public.credit_ledger e
    WHERE e.user_id = u.user_id AND e.kind = 'charge' AND e.turn_key = u.turn_key AND e.credits < 0;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    v_amount := private.credit_current_amount(-c.credits, c.inr_per_credit);
    IF v_amount IS NULL OR v_amount <= 0 THEN
      CONTINUE;
    END IF;
    v_lot := private.credit_mint(u.user_id, 'adjustment', v_amount, now(), now() + interval '12 months',
                                 'fcu-refund:' || u.id, NULL, 'adjustment', u.id, v_admin, 'live tv fact-check unlock refund');
    IF v_lot IS NOT NULL THEN
      PERFORM private.credit_repay(u.user_id, now());
      v_refunded := v_refunded + 1;
      v_credits := v_credits + v_amount;
    END IF;
    UPDATE public.factcheck_unlocks SET refunded_at = now() WHERE id = u.id;
  END LOOP;

  DELETE FROM private.factcheck_pieces WHERE video_id = p_video_id;
  GET DIAGNOSTICS v_pieces = ROW_COUNT;
  UPDATE public.factcheck_sessions SET shareable = false WHERE video_id = p_video_id AND shareable;
  GET DIAGNOSTICS v_sessions = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'pieces_deleted', v_pieces, 'sessions', v_sessions,
                            'unlocks_refunded', v_refunded, 'credits_refunded', v_credits);
END;
$$;

COMMIT;
