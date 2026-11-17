-- Live TV fact-check: shared results and paid unlock on recorded videos (open-work F344, slice 2, task S1;
-- docs/plans/2026-11-16-f344-sharing.md "Fixed interfaces > SQL"). Nothing existing is replaced: this migration adds columns,
-- tables, a trigger and functions. Sharing stays OFF until the flag row carries share_recorded = true and a price.
--
--   * factcheck_sessions.shareable (default false): the session's run may be shared once settled. Set only by
--     factcheck_mark_shareable, on an active recorded session, while sharing is on.
--   * factcheck_claims.shared (default false), hidden_at: a claim is returned to other users only when shared and not hidden.
--     A trigger forces shared to false unless the claim's session is a shareable recorded one, so a claim of a private session
--     can never be shared by any insert or update, whoever makes it. (Forced to false, not refused: a claim is still saved.)
--   * private.factcheck_pieces: the stored transcript pieces of a shareable session, with the video positions they cover. No API
--     role reads it; factcheck_video_view and factcheck_turn_pieces are the only readers.
--   * public.factcheck_unlocks (own rows readable), public.factcheck_reports (own rows readable): written only by the functions.
--     The private ledger key of an unlock is kept in private.factcheck_unlock_keys and never returned.
--   * private.factcheck_unlock_rate: unlocks per user per calendar minute (limit 6), pruned inside factcheck_unlock.
--   * private.factcheck_share_flag(): {audience, unlock_cpm}, or NULL when sharing is off for any reason: the base flag
--     (private.factcheck_flag) is off, share_recorded is not exactly true, or unlock_credits_per_minute is not a number above 0
--     and at most 1000 (rounded to 4 places). Never raises.
--   * A stretch is listed to others, and can be unlocked, only 2 minutes after its session settled (extract and check can still add
--     to it until then); the runner's own stretch is listed to them at once.
--   * private.factcheck_view_rate: listings per user per calendar minute (limit 30), pruned inside factcheck_video_view.
--   * Functions (service_role only, SECURITY DEFINER, search_path ''): factcheck_share_on, factcheck_mark_shareable,
--     factcheck_piece_store, factcheck_turn_pieces, factcheck_video_view, factcheck_unlock, factcheck_report. factcheck_claim_hide,
--     factcheck_report_dismiss and factcheck_video_remove are executable by authenticated and refuse (42501) unless
--     public.is_platform_admin().
--
-- When a runner's account or session is deleted (the cascade): the session's claims, its stored pieces and every payer's unlock
-- row of it (and the private ledger key of that unlock) are deleted with it, as are reports on its claims. This is deliberate:
-- there is nothing left to read, so no unlock is left pointing at nothing. The payer's charge stays in their credit ledger and is
-- not refunded. A payer's own account deletion removes their unlocks, reports and keys; the runner's stretch is unaffected.
--
-- Returns (all jsonb). Refusals are {ok:false, reason}; extras in brackets.
--   share_on: boolean (true only when sharing is on and the audience admits the caller).
--   mark_shareable: ok:true | off, not_found, not_recorded.
--   piece_store: ok:true,stored:true | not_found, not_shareable, settled, bad_piece (rules at the function).
--   turn_pieces: ok:true,pieces:[{piece_no,pos_start_s,pos_end_s,text}] | not_found, bad_range.
--   video_view: ok:true,unlock_credits_per_minute,stretches:[...] | off, not_allowed, rate_limited.
--   unlock: ok:true,repeated:false,credits_charged,balance | ok:true,repeated:true | off, not_allowed, not_found, own,
--     price_changed [price], insufficient [needed, available], rate_limited.
--   report: ok:true | off, not_found, already, rate_limited.
--   claim_hide, report_dismiss: ok:true | not_found.  video_remove: ok:true,pieces_deleted,sessions.
--
-- Stretches. One stretch is one settled shareable recorded session that has at least one stored piece; its id (stretch_id) is
-- the session id (never a user id). minutes = whole started minutes of NON-OVERLAPPING stored speech (over the pieces in
-- piece_no order, the sum of pos_end_s - greatest(pos_start_s, previous pos_end_s), never negative per piece, rounded up, at
-- least 1; a gap between pieces is not billed); price = minutes x unlock_credits_per_minute. A stretch is unlocked as a whole; its owner reads it
-- free ('own'). A claim is returned only when shared, not hidden, an original (not a re-check row) and not pending; for a
-- re-checked claim the runner (access 'own') sees the newest checked result of its chain under the original's id; anyone who
-- unlocked the stretch ('unlocked') sees the ORIGINAL checked result, so a re-check cannot replace what was paid for. A listing
-- shows at most the 3 newest stretches of any one runner of a video (and all the viewer's own, and any the viewer unlocked), at
-- most 50, newest first; checked_on is a UTC date.
--
-- Lock order of an unlock: the wallet (private.credit_refresh), then the rate row; one transaction, so two parallel calls of
-- one user serialise on the wallet lock and the second answers repeated (a unique (user_id, session_id) backs it).
--
-- Down (manual; the ledger entries already made stay):
--   begin; drop trigger factcheck_claims_share_guard on public.factcheck_claims;
--   drop function public.factcheck_mark_shareable(uuid, uuid), public.factcheck_piece_store(uuid, uuid, integer, numeric, numeric, text),
--     public.factcheck_turn_pieces(uuid, uuid, integer, integer), public.factcheck_video_view(uuid, text, boolean),
--     public.factcheck_unlock(uuid, uuid, boolean, numeric), public.factcheck_report(uuid, uuid, text),
--     public.factcheck_claim_hide(uuid), public.factcheck_video_remove(text), public.factcheck_share_on(boolean),
--     public.factcheck_report_dismiss(uuid), private.factcheck_share_guard(),
--     private.factcheck_share_flag(), private.factcheck_newest_result(uuid), private.factcheck_stretch_minutes(uuid);
--   drop table private.factcheck_view_rate, private.factcheck_unlock_rate, private.factcheck_unlock_keys, public.factcheck_reports, public.factcheck_unlocks,
--     private.factcheck_pieces;
--   alter table public.factcheck_claims drop column shared, drop column hidden_at;
--   alter table public.factcheck_sessions drop column shareable; commit;

BEGIN;

ALTER TABLE public.factcheck_sessions ADD COLUMN shareable boolean NOT NULL DEFAULT false;
ALTER TABLE public.factcheck_claims ADD COLUMN shared boolean NOT NULL DEFAULT false;
ALTER TABLE public.factcheck_claims ADD COLUMN hidden_at timestamptz;
CREATE INDEX factcheck_sessions_video_shared ON public.factcheck_sessions (video_id) WHERE shareable;

CREATE TABLE private.factcheck_pieces (
  session_id  uuid        NOT NULL REFERENCES public.factcheck_sessions(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL,
  video_id    text        NOT NULL,
  piece_no    integer     NOT NULL CHECK (piece_no >= 1),
  pos_start_s numeric     NOT NULL CHECK (pos_start_s BETWEEN 0 AND 10000000),
  pos_end_s   numeric     NOT NULL CHECK (pos_end_s BETWEEN 0 AND 10000000),
  text        text        NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, piece_no),
  CONSTRAINT factcheck_pieces_user_session FOREIGN KEY (session_id, user_id)
    REFERENCES public.factcheck_sessions (id, user_id) ON DELETE CASCADE
);
CREATE INDEX factcheck_pieces_video ON private.factcheck_pieces (video_id);

CREATE TABLE public.factcheck_unlocks (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id      uuid          NOT NULL REFERENCES public.factcheck_sessions(id) ON DELETE CASCADE,
  video_id        text          NOT NULL,
  credits_charged numeric(14,4) NOT NULL CHECK (credits_charged > 0),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT factcheck_unlocks_once UNIQUE (user_id, session_id)
);
CREATE INDEX factcheck_unlocks_session ON public.factcheck_unlocks (session_id);

CREATE TABLE public.factcheck_reports (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id   uuid        NOT NULL REFERENCES public.factcheck_claims(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason     text        NOT NULL DEFAULT '' CHECK (char_length(reason) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz,
  CONSTRAINT factcheck_reports_once UNIQUE (claim_id, user_id)
);
CREATE INDEX factcheck_reports_user_time ON public.factcheck_reports (user_id, created_at DESC);

CREATE TABLE private.factcheck_unlock_keys (
  unlock_id uuid PRIMARY KEY REFERENCES public.factcheck_unlocks(id) ON DELETE CASCADE,
  turn_key  text NOT NULL UNIQUE
);
CREATE TABLE private.factcheck_unlock_rate (
  user_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  minute  timestamptz NOT NULL,
  n       integer     NOT NULL CHECK (n > 0),
  PRIMARY KEY (user_id, minute)
);

CREATE TABLE private.factcheck_view_rate (
  user_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  minute  timestamptz NOT NULL,
  n       integer     NOT NULL CHECK (n > 0),
  PRIMARY KEY (user_id, minute)
);

ALTER TABLE public.factcheck_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factcheck_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY factcheck_unlocks_select ON public.factcheck_unlocks FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY factcheck_reports_select ON public.factcheck_reports FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.factcheck_unlocks, public.factcheck_reports FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.factcheck_unlocks, public.factcheck_reports TO authenticated;
GRANT SELECT ON public.factcheck_unlocks, public.factcheck_reports TO service_role;
REVOKE ALL ON private.factcheck_pieces, private.factcheck_unlock_keys, private.factcheck_unlock_rate, private.factcheck_view_rate
  FROM PUBLIC, anon, authenticated, service_role;

-- A claim can be shared only when its session is a shareable recorded one.
CREATE FUNCTION private.factcheck_share_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
BEGIN
  IF NEW.shared AND NOT EXISTS (SELECT FROM public.factcheck_sessions s
                                WHERE s.id = NEW.session_id AND s.user_id = NEW.user_id AND s.shareable AND s.video_kind = 'recorded') THEN
    NEW.shared := false;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER factcheck_claims_share_guard BEFORE INSERT OR UPDATE OF shared, session_id ON public.factcheck_claims
FOR EACH ROW EXECUTE FUNCTION private.factcheck_share_guard();

-- {audience, unlock_cpm}, or NULL when sharing is off. Never raises.
CREATE FUNCTION private.factcheck_share_flag() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  fl jsonb;
  v jsonb;
  c numeric;
BEGIN
  fl := private.factcheck_flag();
  IF fl IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT f.value INTO v FROM public.app_flags f WHERE f.key = 'livetv_factcheck';
  IF (v -> 'share_recorded') IS DISTINCT FROM 'true'::jsonb THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(v -> 'unlock_credits_per_minute') IS DISTINCT FROM 'number' THEN
    RETURN NULL;
  END IF;
  c := (v ->> 'unlock_credits_per_minute')::numeric;
  IF c <= 0 OR c > 1000 THEN
    RETURN NULL;
  END IF;
  c := round(c, 4);
  IF c <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('audience', fl ->> 'audience', 'unlock_cpm', c);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Whole started minutes of NON-OVERLAPPING stored speech of a session, at least 1; NULL when it has no pieces. Over the pieces in
-- piece_no order each counts pos_end_s - greatest(pos_start_s, the previous piece's pos_end_s), never below 0.
CREATE FUNCTION private.factcheck_stretch_minutes(p_session uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT greatest(1, ceil(sum(greatest(0, q.pos_end_s - greatest(q.pos_start_s, coalesce(q.prev_end, q.pos_start_s)))) / 60))::integer
  FROM (SELECT p.pos_start_s, p.pos_end_s, lag(p.pos_end_s) OVER (ORDER BY p.piece_no) AS prev_end
        FROM private.factcheck_pieces p WHERE p.session_id = p_session) q
  HAVING count(*) > 0;
$$;

-- The newest checked result of a claim's chain (following supersedes), or the claim itself when it has none.
CREATE FUNCTION private.factcheck_newest_result(p_claim uuid) RETURNS public.factcheck_claims
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  WITH RECURSIVE chain(id, depth) AS (
    SELECT p_claim, 0
    UNION ALL
    SELECT y.id, ch.depth + 1 FROM chain ch JOIN public.factcheck_claims y ON y.supersedes = ch.id AND y.status = 'checked'
    WHERE ch.depth < 100
  )
  SELECT c.* FROM chain ch JOIN public.factcheck_claims c ON c.id = ch.id
  ORDER BY ch.depth DESC, c.checked_at DESC NULLS LAST, c.id LIMIT 1;
$$;

-- True only when sharing is on and the audience admits the caller (the Edge Function asks before it confirms a video).
CREATE FUNCTION public.factcheck_share_on(p_is_admin boolean) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE sf jsonb := private.factcheck_share_flag();
BEGIN
  RETURN sf IS NOT NULL AND (sf ->> 'audience' IS DISTINCT FROM 'admin' OR coalesce(p_is_admin, false));
END;
$$;

CREATE FUNCTION public.factcheck_mark_shareable(p_user uuid, p_session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE s public.factcheck_sessions;
BEGIN
  IF p_user IS NULL OR p_session IS NULL THEN
    RAISE EXCEPTION 'A user and a session are required' USING ERRCODE = '22023';
  END IF;
  IF private.factcheck_share_flag() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'off');
  END IF;
  SELECT * INTO s FROM public.factcheck_sessions WHERE id = p_session AND user_id = p_user AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF s.video_kind <> 'recorded' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_recorded');
  END IF;
  UPDATE public.factcheck_sessions SET shareable = true WHERE id = s.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE FUNCTION public.factcheck_piece_store(p_user uuid, p_session uuid, p_piece_no integer, p_pos_start_s numeric,
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
  -- at most 120 pieces. Out-of-order numbers are accepted; a forward jump is a gap (not billed).
  IF p_piece_no IS NULL OR p_piece_no < 1 OR p_pos_start_s IS NULL OR p_pos_end_s IS NULL
     OR NOT (p_pos_start_s BETWEEN 0 AND 10000000) OR NOT (p_pos_end_s BETWEEN 0 AND 10000000)
     OR p_text IS NULL OR char_length(btrim(p_text)) = 0 OR char_length(p_text) > 2000
     OR p_pos_end_s - p_pos_start_s < 0.5 OR p_pos_end_s - p_pos_start_s > 15
     OR EXISTS (SELECT FROM private.factcheck_pieces x WHERE x.session_id = s.id AND x.piece_no = p_piece_no)
     OR (SELECT count(*) FROM private.factcheck_pieces x WHERE x.session_id = s.id) >= 120 THEN
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

CREATE FUNCTION public.factcheck_turn_pieces(p_user uuid, p_session uuid, p_from integer, p_to integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
BEGIN
  IF p_user IS NULL OR p_session IS NULL THEN
    RAISE EXCEPTION 'A user and a session are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT FROM public.factcheck_sessions WHERE id = p_session AND user_id = p_user) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from < 0 OR p_to < p_from OR p_to - p_from + 1 > 12 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_range');
  END IF;
  RETURN jsonb_build_object('ok', true, 'pieces', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('piece_no', p.piece_no, 'pos_start_s', p.pos_start_s, 'pos_end_s', p.pos_end_s,
                                                 'text', p.text) ORDER BY p.piece_no), '[]'::jsonb)
    FROM private.factcheck_pieces p WHERE p.session_id = p_session AND p.piece_no BETWEEN p_from AND p_to));
END;
$$;

CREATE FUNCTION public.factcheck_video_view(p_user uuid, p_video_id text, p_is_admin boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  sf jsonb;
  cpm numeric;
  r record;
  v_access text;
  v_minutes integer;
  v_one jsonb;
  v_out jsonb := '[]'::jsonb;
  v_n integer;
BEGIN
  IF p_user IS NULL OR p_video_id IS NULL THEN
    RAISE EXCEPTION 'A user and a video are required' USING ERRCODE = '22023';
  END IF;
  sf := private.factcheck_share_flag();
  IF sf IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'off');
  END IF;
  IF sf ->> 'audience' = 'admin' AND NOT coalesce(p_is_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  cpm := (sf ->> 'unlock_cpm')::numeric;
  -- 30 listings a minute per user.
  SELECT x.n INTO v_n FROM private.factcheck_view_rate x WHERE x.user_id = p_user AND x.minute = date_trunc('minute', now());
  IF coalesce(v_n, 0) >= 30 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  INSERT INTO private.factcheck_view_rate (user_id, minute, n) VALUES (p_user, date_trunc('minute', now()), 1)
  ON CONFLICT (user_id, minute) DO UPDATE SET n = private.factcheck_view_rate.n + 1;
  DELETE FROM private.factcheck_view_rate x WHERE x.user_id = p_user AND x.minute < now() - interval '1 hour';
  FOR r IN
    SELECT q.id, q.user_id, q.ended_at,
           (SELECT min(p.pos_start_s) FROM private.factcheck_pieces p WHERE p.session_id = q.id) AS from_s,
           (SELECT max(p.pos_end_s) FROM private.factcheck_pieces p WHERE p.session_id = q.id) AS to_s
    FROM (SELECT s.id, s.user_id, s.ended_at,
                 row_number() OVER (PARTITION BY s.user_id ORDER BY s.ended_at DESC, s.id) AS rn
          FROM public.factcheck_sessions s
          WHERE s.video_id = p_video_id AND s.video_kind = 'recorded' AND s.shareable AND s.status = 'settled'
            AND (s.ended_at <= now() - interval '2 minutes' OR s.user_id = p_user)   -- extract/check may still run for 2 minutes
            AND EXISTS (SELECT FROM private.factcheck_pieces p WHERE p.session_id = s.id)) q
    WHERE q.rn <= 3 OR q.user_id = p_user
       OR EXISTS (SELECT FROM public.factcheck_unlocks u WHERE u.user_id = p_user AND u.session_id = q.id)
    ORDER BY q.ended_at DESC, q.id
    LIMIT 50
  LOOP
    v_minutes := private.factcheck_stretch_minutes(r.id);
    v_access := CASE WHEN r.user_id = p_user THEN 'own'
                     WHEN EXISTS (SELECT FROM public.factcheck_unlocks u WHERE u.user_id = p_user AND u.session_id = r.id) THEN 'unlocked'
                     ELSE 'locked' END;
    v_one := jsonb_build_object('stretch_id', r.id, 'from_s', r.from_s, 'to_s', r.to_s, 'minutes', v_minutes,
      'checked_on', (r.ended_at AT TIME ZONE 'UTC')::date,
      'claims_count', (SELECT count(*) FROM public.factcheck_claims c WHERE c.session_id = r.id AND c.shared AND c.hidden_at IS NULL
                         AND c.supersedes IS NULL AND c.status <> 'pending'),
      'access', v_access, 'price', round(v_minutes * cpm, 4));
    IF v_access <> 'locked' THEN
      v_one := v_one || jsonb_build_object(
        'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('pos_start_s', p.pos_start_s, 'text', p.text) ORDER BY p.piece_no), '[]'::jsonb)
                  FROM private.factcheck_pieces p WHERE p.session_id = r.id),
        'claims', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'position_s', c.position_s, 'quote', c.quote,
                       'claim_en', c.claim_en, 'claimant', c.claimant, 'reported_by', c.reported_by, 'kind', c.kind,
                       'status', n.status, 'verdict', n.verdict, 'reason', n.reason, 'sources', n.sources,
                       'checked_at', n.checked_at,
                       'reported', EXISTS (SELECT FROM public.factcheck_reports fr WHERE fr.claim_id = c.id AND fr.handled_at IS NULL))
                     ORDER BY c.position_s NULLS LAST, c.spoken_at, c.id), '[]'::jsonb)
                   FROM public.factcheck_claims c
                   CROSS JOIN LATERAL (SELECT y.* FROM public.factcheck_claims y
                                       WHERE y.id = CASE WHEN v_access = 'own' THEN (private.factcheck_newest_result(c.id)).id ELSE c.id END) n
                   WHERE c.session_id = r.id AND c.shared AND c.hidden_at IS NULL AND c.supersedes IS NULL AND c.status <> 'pending'));
    END IF;
    v_out := v_out || jsonb_build_array(v_one);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'unlock_credits_per_minute', cpm, 'stretches', v_out);
END;
$$;

CREATE FUNCTION public.factcheck_unlock(p_user uuid, p_stretch uuid, p_is_admin boolean, p_expected_credits numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  s public.credit_settings;
  sf jsonb;
  ses public.factcheck_sessions;
  w public.credit_wallets;
  v_minutes integer;
  v_price numeric(14,4);
  v_held numeric;
  v_inflight numeric;
  v_available numeric;
  v_n integer;
  v_unlock uuid := gen_random_uuid();
  v_key text := 'fcu:' || gen_random_uuid();
  v_ledger uuid;
  v_balance numeric;
  uc record;
BEGIN
  IF p_user IS NULL OR p_stretch IS NULL THEN
    RAISE EXCEPTION 'A user and a stretch are required' USING ERRCODE = '22023';
  END IF;
  -- The wallet first (a credit-write pause raises here), as every credit writer does; re-checks that hold a verdict and were
  -- never charged are collected so that they are not owed twice.
  s := private.credit_config();
  PERFORM private.credit_refresh(p_user, now());
  FOR uc IN
    SELECT x.id FROM public.factcheck_claims x JOIN private.factcheck_recheck_state st ON st.claim_id = x.id
    WHERE x.user_id = p_user AND x.status = 'checked' AND x.supersedes IS NOT NULL AND st.credits_charged IS NULL ORDER BY x.id
  LOOP
    PERFORM private.factcheck_recheck_charge_locked(p_user, uc.id);
  END LOOP;

  sf := private.factcheck_share_flag();
  IF sf IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'off');
  END IF;
  IF sf ->> 'audience' = 'admin' AND NOT coalesce(p_is_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  SELECT * INTO ses FROM public.factcheck_sessions x
  WHERE x.id = p_stretch AND x.video_kind = 'recorded' AND x.shareable AND x.status = 'settled' AND x.ended_at <= now() - interval '2 minutes'
    AND EXISTS (SELECT FROM private.factcheck_pieces p WHERE p.session_id = x.id);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF ses.user_id = p_user THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'own');
  END IF;
  IF EXISTS (SELECT FROM public.factcheck_unlocks u WHERE u.user_id = p_user AND u.session_id = ses.id) THEN
    RETURN jsonb_build_object('ok', true, 'repeated', true);
  END IF;

  v_minutes := private.factcheck_stretch_minutes(ses.id);
  v_price := round(v_minutes * (sf ->> 'unlock_cpm')::numeric, 4);
  IF p_expected_credits IS DISTINCT FROM v_price THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'price_changed', 'price', v_price);
  END IF;

  -- Available as the research chat counts it, less the re-checks begun and not yet settled (as factcheck_recheck_begin counts).
  SELECT * INTO w FROM public.credit_wallets WHERE user_id = p_user;
  SELECT coalesce(sum(private.credit_current_amount(x.credits, x.inr_per_credit)), 0) INTO v_held
  FROM public.credit_holds x WHERE x.user_id = p_user AND x.settled_at IS NULL AND x.expires_at > now() AND NOT x.shadow_blocked;
  SELECT coalesce(sum(private.credit_current_amount(st.price, st.inr_per_credit)), 0) INTO v_inflight
  FROM private.factcheck_recheck_state st JOIN public.factcheck_claims x ON x.id = st.claim_id
  WHERE x.user_id = p_user AND x.status = 'pending' AND st.credits_charged IS NULL AND st.begun_at > now() - interval '90 seconds';
  v_available := w.balance - v_held - v_inflight;
  IF v_available < v_price THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient', 'needed', v_price, 'available', v_available);
  END IF;

  SELECT r.n INTO v_n FROM private.factcheck_unlock_rate r WHERE r.user_id = p_user AND r.minute = date_trunc('minute', now());
  IF coalesce(v_n, 0) >= 6 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  v_ledger := private.credit_entry(p_user, 'charge', -v_price, NULL, v_key, NULL, s.usd_to_inr, s.inr_per_credit, NULL, 'live tv fact-check');
  PERFORM private.credit_draw(p_user, v_price, v_ledger, 'charge', now());
  INSERT INTO public.factcheck_unlocks (id, user_id, session_id, video_id, credits_charged)
  VALUES (v_unlock, p_user, ses.id, ses.video_id, v_price);
  INSERT INTO private.factcheck_unlock_keys (unlock_id, turn_key) VALUES (v_unlock, v_key);
  INSERT INTO private.factcheck_unlock_rate (user_id, minute, n) VALUES (p_user, date_trunc('minute', now()), 1)
  ON CONFLICT (user_id, minute) DO UPDATE SET n = private.factcheck_unlock_rate.n + 1;
  DELETE FROM private.factcheck_unlock_rate WHERE user_id = p_user AND minute < now() - interval '1 hour';
  SELECT wb.balance INTO v_balance FROM public.credit_wallets wb WHERE wb.user_id = p_user;
  RETURN jsonb_build_object('ok', true, 'repeated', false, 'credits_charged', v_price, 'balance', v_balance);
END;
$$;

CREATE FUNCTION public.factcheck_report(p_user uuid, p_claim uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE c public.factcheck_claims;
BEGIN
  IF p_user IS NULL OR p_claim IS NULL OR char_length(coalesce(p_reason, '')) > 300 THEN
    RAISE EXCEPTION 'A user, a claim and a reason of at most 300 characters are required' USING ERRCODE = '22023';
  END IF;
  IF private.factcheck_share_flag() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'off');
  END IF;
  -- Lock the user's reports so that the daily count and the insert are one decision.
  PERFORM pg_advisory_xact_lock(hashtextextended('factcheck_report:' || p_user, 0));
  SELECT * INTO c FROM public.factcheck_claims x
  WHERE x.id = p_claim AND (
        x.user_id = p_user
        OR (x.shared AND x.hidden_at IS NULL AND x.supersedes IS NULL AND x.status <> 'pending'
            AND EXISTS (SELECT FROM public.factcheck_sessions s WHERE s.id = x.session_id AND s.shareable AND s.status = 'settled'
                          AND s.video_kind = 'recorded')
            AND EXISTS (SELECT FROM public.factcheck_unlocks u WHERE u.user_id = p_user AND u.session_id = x.session_id)));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF EXISTS (SELECT FROM public.factcheck_reports r WHERE r.claim_id = c.id AND r.user_id = p_user) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already');
  END IF;
  IF (SELECT count(*) FROM public.factcheck_reports r WHERE r.user_id = p_user AND r.created_at > now() - interval '24 hours') >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  INSERT INTO public.factcheck_reports (claim_id, user_id, reason) VALUES (c.id, p_user, coalesce(p_reason, ''));
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE FUNCTION public.factcheck_claim_hide(p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrators only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.factcheck_claims SET hidden_at = coalesce(hidden_at, now()) WHERE id = p_claim;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  UPDATE public.factcheck_reports SET handled_at = now() WHERE claim_id = p_claim AND handled_at IS NULL;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE FUNCTION public.factcheck_report_dismiss(p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrators only' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT FROM public.factcheck_claims WHERE id = p_claim) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  UPDATE public.factcheck_reports SET handled_at = now() WHERE claim_id = p_claim AND handled_at IS NULL;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE FUNCTION public.factcheck_video_remove(p_video_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE v_pieces integer; v_sessions integer;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrators only' USING ERRCODE = '42501';
  END IF;
  DELETE FROM private.factcheck_pieces WHERE video_id = p_video_id;
  GET DIAGNOSTICS v_pieces = ROW_COUNT;
  UPDATE public.factcheck_sessions SET shareable = false WHERE video_id = p_video_id AND shareable;
  GET DIAGNOSTICS v_sessions = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'pieces_deleted', v_pieces, 'sessions', v_sessions);
END;
$$;

REVOKE ALL ON FUNCTION
  private.factcheck_share_guard(), private.factcheck_share_flag(), private.factcheck_stretch_minutes(uuid),
  private.factcheck_newest_result(uuid),
  public.factcheck_share_on(boolean),
  public.factcheck_report_dismiss(uuid),
  public.factcheck_mark_shareable(uuid, uuid),
  public.factcheck_piece_store(uuid, uuid, integer, numeric, numeric, text),
  public.factcheck_turn_pieces(uuid, uuid, integer, integer),
  public.factcheck_video_view(uuid, text, boolean),
  public.factcheck_unlock(uuid, uuid, boolean, numeric),
  public.factcheck_report(uuid, uuid, text),
  public.factcheck_claim_hide(uuid),
  public.factcheck_video_remove(text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.factcheck_share_on(boolean),
  public.factcheck_mark_shareable(uuid, uuid),
  public.factcheck_piece_store(uuid, uuid, integer, numeric, numeric, text),
  public.factcheck_turn_pieces(uuid, uuid, integer, integer),
  public.factcheck_video_view(uuid, text, boolean),
  public.factcheck_unlock(uuid, uuid, boolean, numeric),
  public.factcheck_report(uuid, uuid, text)
TO service_role;
GRANT EXECUTE ON FUNCTION public.factcheck_claim_hide(uuid), public.factcheck_report_dismiss(uuid), public.factcheck_video_remove(text) TO authenticated;

COMMIT;
