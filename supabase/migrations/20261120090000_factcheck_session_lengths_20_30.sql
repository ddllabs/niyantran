-- Live TV fact-check: sessions of 20 and 30 minutes (open-work F361; the owner asked for them on 2026-11-18).
-- Before: a session could be bought for 1, 2, 5, 10 or 15 minutes. After: for 1, 2, 5, 10, 15, 20 or 30. Nothing else changes:
-- the price per minute, the hold (minutes x credits per minute), the charge (whole started minutes, at least one, at most the
-- minutes bought), the per-user limits (transcribe 10, extract 6, check 20 a minute), the hold's expiry (the block's end plus 30
-- minutes), the settle sweep (a block's end plus a minute, or 3 minutes quiet) and the per-session budget (extract 3 x minutes + 2,
-- check 8 x minutes + 4) are the rules of 20261116090000_factcheck.sql, applied to the larger sizes. None of them assumes a
-- longest session, so a 30-minute session can never be charged more than 30 x credits_per_minute.
--
--   * public.factcheck_sessions.minutes_bought: the CHECK is replaced by one that also allows 20 and 30, under the explicit name
--     factcheck_sessions_minutes_bought_check. The old constraint is found by its definition, not by an assumed name: the one CHECK on
--     minutes_bought alone whose deparsed text is exactly the current list (1, 2, 5, 10, 15) or this migration's own
--     (1, 2, 5, 10, 15, 20, 30). Any other text (a hot-fixed list) or any other count stops the migration with 55000, naming what
--     it found. A second run finds its own list, drops it and adds it again: a no-op in effect.
--   * public.factcheck_start: replaced with the same signature, default, SECURITY DEFINER and settings. The only change is the
--     list in the length test, (1, 2, 5, 10, 15) to (1, 2, 5, 10, 15, 20, 30). Its grants survive the replace and are not repeated.
--
--   * public.factcheck_piece_store: replaced with the same signature, SECURITY DEFINER and settings. The only change is the cap on
--     the stored pieces of one session: refused ('bad_piece') when the count is already >= greatest(120, 10 x minutes_bought),
--     was >= 120. A piece carries about 9 s of new audio, so a recorded 20-minute session needs about 133 pieces and a 30-minute
--     one about 200; with the old cap, pieces were refused from about minute 18 and the shared stretch covered only part of the
--     paid time. Blocks up to 12 minutes keep 120; 10 a minute matches the transcribe limit. Grants survive the replace.
--
-- The drift guard refuses (55000) to run over a factcheck_start whose source is neither the one left by
-- 20261119090000_factcheck_session_lengths.sql (md5 99e26d189732eaa59fca231db435bbfa) nor this migration's own
-- (md5 3932b5a554b1da43590ecb3e712452e1), and over a factcheck_piece_store whose source is neither the one in
-- 20261117090000_factcheck_sharing.sql (md5 ba70c66fe24fc25e4a263b75d97b46ae) nor this migration's own (md5 6ce637e72e5ec62faa9d067204c9622a), so a hot fix is never overwritten. Applying it twice is a no-op.
--
-- RELEASE ORDER: apply this migration BEFORE deploying the factcheck Edge function that accepts 20 and 30 (that function would
-- otherwise pass them to a database that refuses them with bad_minutes), and before the browser that offers them. The old
-- function and the old browser keep working against the migrated database.
--
-- Down (rollback), as the migrating role, in this order: the browser, then the Edge function, then (a), (a2), then (b). The
-- steps are independent; none is wrapped around another.
--   (a) The function. Always executable: run CREATE OR REPLACE FUNCTION public.factcheck_start with this migration's exact text
--       and the list in the length test set back to (1, 2, 5, 10, 15). That restores the source whose md5 is
--       99e26d189732eaa59fca231db435bbfa, which this migration's own guard accepts.
--   (a2) factcheck_piece_store. Always executable: run CREATE OR REPLACE FUNCTION public.factcheck_piece_store with this migration's
--       exact text and ">= greatest(120, 10 * s.minutes_bought)" set back to ">= 120" (and the comment line above it to "at most 120
--       pieces."). That restores the source whose md5 is ba70c66fe24fc25e4a263b75d97b46ae, which this migration's own guard accepts. Pieces already
--       stored beyond 120 stay; they are read as before.
--   (b) The CHECK. Only while this returns no row: select 1 from public.factcheck_sessions where minutes_bought in (20, 30);
--       then: alter table public.factcheck_sessions drop constraint factcheck_sessions_minutes_bought_check,
--             add constraint factcheck_sessions_minutes_bought_check check (minutes_bought in (1, 2, 5, 10, 15));
--       Once such a row exists the wide CHECK stays (settled sessions are never deleted). That is harmless to code that offers
--       only 1 to 15 minutes.

BEGIN;
-- Fail fast instead of queueing behind a long transaction on these hot objects (the table and both functions).
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.factcheck_start(uuid,text,text,text,numeric,integer,boolean,numeric)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('99e26d189732eaa59fca231db435bbfa', '3932b5a554b1da43590ecb3e712452e1') THEN
    RAISE EXCEPTION 'factcheck_session_lengths_20_30: public.factcheck_start differs from the version this migration was written against (source md5 %); review it before applying',
      coalesce(v_md5, 'missing') USING ERRCODE = '55000';
  END IF;
END
$guard$;

DO $guard2$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.factcheck_piece_store(uuid,uuid,integer,numeric,numeric,text)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('ba70c66fe24fc25e4a263b75d97b46ae', '6ce637e72e5ec62faa9d067204c9622a') THEN
    RAISE EXCEPTION 'factcheck_session_lengths_20_30: public.factcheck_piece_store differs from the version this migration was written against (source md5 %); review it before applying',
      coalesce(v_md5, 'missing') USING ERRCODE = '55000';
  END IF;
END
$guard2$;

DO $swap$
DECLARE
  v_names text[];
  v_defs text[];
BEGIN
  SELECT array_agg(c.conname), array_agg(pg_get_constraintdef(c.oid)) INTO v_names, v_defs FROM pg_constraint c
  WHERE c.conrelid = 'public.factcheck_sessions'::regclass AND c.contype = 'c'
    AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attname = 'minutes_bought')];
  IF coalesce(cardinality(v_names), 0) <> 1
     OR v_defs[1] NOT IN ('CHECK ((minutes_bought = ANY (ARRAY[1, 2, 5, 10, 15])))',
                          'CHECK ((minutes_bought = ANY (ARRAY[1, 2, 5, 10, 15, 20, 30])))') THEN
    RAISE EXCEPTION 'factcheck_session_lengths_20_30: expected exactly one single-column CHECK on factcheck_sessions.minutes_bought with the list 1, 2, 5, 10, 15 (or 1, 2, 5, 10, 15, 20, 30); found %; review it before applying',
      coalesce(array_to_string(v_defs, ' | '), 'none') USING ERRCODE = '55000';
  END IF;
  EXECUTE format('ALTER TABLE public.factcheck_sessions DROP CONSTRAINT %I', v_names[1]);
END
$swap$;

ALTER TABLE public.factcheck_sessions
  ADD CONSTRAINT factcheck_sessions_minutes_bought_check CHECK (minutes_bought IN (1, 2, 5, 10, 15, 20, 30));

CREATE OR REPLACE FUNCTION public.factcheck_start(p_user uuid, p_video_id text, p_channel_id text, p_video_kind text,
  p_start_position_s numeric, p_minutes integer, p_is_admin boolean, p_expected_cpm numeric DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  s public.credit_settings;
  fl jsonb;
  w public.credit_wallets;
  r record;
  v_cpm numeric(14,4);
  v_needed numeric(14,4);
  v_held numeric;
  v_available numeric;
  v_id uuid := gen_random_uuid();
  v_key text := 'fc:' || gen_random_uuid();
  v_ends timestamptz;
  v_active uuid;
BEGIN
  IF p_user IS NULL OR p_video_id IS NULL OR char_length(p_video_id) NOT BETWEEN 1 AND 32
     OR p_channel_id IS NULL OR char_length(p_channel_id) NOT BETWEEN 1 AND 64
     OR p_video_kind IS NULL OR p_video_kind NOT IN ('live', 'recorded')
     OR (p_start_position_s IS NOT NULL AND NOT (p_start_position_s BETWEEN 0 AND 10000000))
     OR (p_expected_cpm IS NOT NULL AND NOT (p_expected_cpm BETWEEN 0 AND 5000)) THEN
    RAISE EXCEPTION 'A user, a video, a channel and a video kind are required' USING ERRCODE = '22023';
  END IF;

  fl := private.factcheck_flag();
  IF fl IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'off');
  END IF;
  IF fl ->> 'audience' = 'admin' AND NOT coalesce(p_is_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  IF p_minutes IS NULL OR p_minutes NOT IN (1, 2, 5, 10, 15, 20, 30) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_minutes');
  END IF;
  v_cpm := (fl ->> 'cpm')::numeric;
  IF p_expected_cpm IS NOT NULL AND round(p_expected_cpm, 4) <> v_cpm THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'price_changed', 'credits_per_minute', v_cpm);
  END IF;
  v_needed := round(p_minutes * v_cpm, 4);

  s := private.credit_config();
  PERFORM private.credit_refresh(p_user, now());

  -- Sessions of this user that have run out (the block and its grace are over, or the tab went quiet) are settled first.
  FOR r IN
    SELECT x.id FROM public.factcheck_sessions x
    WHERE x.user_id = p_user AND x.status = 'active'
      AND (now() > x.started_at + make_interval(mins => x.minutes_bought) + interval '15 seconds'
           OR x.last_activity_at < now() - interval '3 minutes')
    ORDER BY x.started_at, x.id
  LOOP
    PERFORM private.factcheck_settle_locked(p_user, r.id);
  END LOOP;

  SELECT x.id INTO v_active FROM public.factcheck_sessions x WHERE x.user_id = p_user AND x.status = 'active';
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_active', 'session_id', v_active);
  END IF;

  SELECT * INTO w FROM public.credit_wallets WHERE user_id = p_user;
  SELECT coalesce(sum(private.credit_current_amount(x.credits, x.inr_per_credit)), 0) INTO v_held
  FROM public.credit_holds x WHERE x.user_id = p_user AND x.settled_at IS NULL
    AND x.expires_at > now() AND NOT x.shadow_blocked;
  v_available := w.balance - v_held;
  IF v_available < v_needed THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient', 'needed', v_needed, 'available', v_available);
  END IF;

  v_ends := now() + make_interval(mins => p_minutes);
  BEGIN
    INSERT INTO public.factcheck_sessions (id, user_id, video_id, channel_id, video_kind, start_position_s,
      minutes_bought, credits_per_minute, credits_held, started_at, last_activity_at)
    VALUES (v_id, p_user, p_video_id, p_channel_id, p_video_kind, p_start_position_s,
      p_minutes, v_cpm, v_needed, now(), now());
  EXCEPTION WHEN unique_violation THEN
    SELECT x.id INTO v_active FROM public.factcheck_sessions x WHERE x.user_id = p_user AND x.status = 'active';
    RETURN jsonb_build_object('ok', false, 'reason', 'already_active', 'session_id', v_active);
  END;
  INSERT INTO private.factcheck_hold_keys (session_id, turn_key) VALUES (v_id, v_key);
  INSERT INTO public.credit_holds (user_id, turn_key, credits, inr_per_credit, expires_at, shadow_blocked)
  VALUES (p_user, v_key, v_needed, s.inr_per_credit, v_ends + interval '30 minutes', false);

  RETURN jsonb_build_object('ok', true, 'session_id', v_id, 'credits_per_minute', v_cpm,
                            'credits_held', v_needed, 'ends_at', v_ends);
END;
$$;


CREATE OR REPLACE FUNCTION public.factcheck_piece_store(p_user uuid, p_session uuid, p_piece_no integer, p_pos_start_s numeric,
  p_pos_end_s numeric, p_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  s public.factcheck_sessions;
  lo private.factcheck_pieces;
  hi private.factcheck_pieces;
BEGIN
  IF p_user IS NULL OR p_session IS NULL THEN
    RAISE EXCEPTION 'A user and a session are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.factcheck_sessions WHERE id = p_session AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT s.shareable THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_shareable');
  END IF;
  IF s.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'settled');
  END IF;
  -- Own sanity only: a number from 1 not yet stored, 0.5 to 15 s, a text of 1 to 2000 characters, positions 0 to 10,000,000, and
  -- at most greatest(120, 10 x minutes bought) pieces
  -- (a piece carries about 9 s of new audio, so a 30-minute block needs about 200). Out-of-order numbers are accepted; a forward jump is a gap (not billed).
  IF p_piece_no IS NULL OR p_piece_no < 1 OR p_pos_start_s IS NULL OR p_pos_end_s IS NULL
     OR NOT (p_pos_start_s BETWEEN 0 AND 10000000) OR NOT (p_pos_end_s BETWEEN 0 AND 10000000)
     OR p_text IS NULL OR char_length(btrim(p_text)) = 0 OR char_length(p_text) > 2000
     OR p_pos_end_s - p_pos_start_s < 0.5 OR p_pos_end_s - p_pos_start_s > 15
     OR EXISTS (SELECT FROM private.factcheck_pieces x WHERE x.session_id = s.id AND x.piece_no = p_piece_no)
     OR (SELECT count(*) FROM private.factcheck_pieces x WHERE x.session_id = s.id) >= greatest(120, 10 * s.minutes_bought) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_piece');
  END IF;
  -- Against the nearest stored neighbours by number: not more than 2 s before the lower one's end, never before the lower one's
  -- start (no stepping backwards to bill nothing), nor more than 2 s past the higher one's start.
  SELECT * INTO lo FROM private.factcheck_pieces WHERE session_id = s.id AND piece_no < p_piece_no ORDER BY piece_no DESC LIMIT 1;
  IF FOUND AND (p_pos_start_s < lo.pos_end_s - 2 OR p_pos_start_s < lo.pos_start_s) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_piece');
  END IF;
  SELECT * INTO hi FROM private.factcheck_pieces WHERE session_id = s.id AND piece_no > p_piece_no ORDER BY piece_no LIMIT 1;
  IF FOUND AND p_pos_end_s > hi.pos_start_s + 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_piece');
  END IF;
  INSERT INTO private.factcheck_pieces (session_id, user_id, video_id, piece_no, pos_start_s, pos_end_s, text)
  VALUES (s.id, s.user_id, s.video_id, p_piece_no, p_pos_start_s, p_pos_end_s, p_text);
  RETURN jsonb_build_object('ok', true, 'stored', true);
END;
$$;

COMMIT;
