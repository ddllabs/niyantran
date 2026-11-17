-- Live TV fact-check: why a check ended in error (open-work F349, task T1; docs/plans/2026-11-17-f349-fact-check-fixes.md).
-- Additive only: one nullable column with two CHECKs, and one function replaced. Existing rows are unchanged (NULL).
--
--   * public.factcheck_claims.fail_reason (new, nullable): one of 'no_label', 'bad_label', 'label_conflict', 'no_sources'. It is
--     set only by the Edge function, in the same update that saves status = 'error', and only when the model's reply was the
--     cause (the provider call itself failing leaves the claim pending, as before). A CHECK keeps it NULL unless status = 'error'.
--     The reply text is never stored.
--   * public.factcheck_video_view: replaced (same signature, same grants) so a claim object in an open stretch carries
--     'fail_reason'. The body is the one in 20261117090000_factcheck_sharing.sql with that one key added.
--
-- Checked and left unchanged: factcheck_recheck_begin (inserts the pending re-check row: fail_reason stays NULL, which is right),
-- the abandoned re-check sweep in factcheck_recheck_collect (sets status = 'error' with no reason: NULL is allowed),
-- private.factcheck_newest_result (returns the table's row type, so it carries the column with no change), and the Edge
-- function's own inserts of extracted claims (they are pending or held, never errors).
--
-- RELEASE ORDER: apply this migration BEFORE deploying the factcheck Edge function that writes and reads fail_reason. The new
-- function names the column in its select list and its update; deployed first, every claim read would fail. The old function
-- keeps working against the migrated database (it never names the column).
--
-- Down (rollback), as the migrating role, only after the Edge function has been rolled back:
--   begin;
--   alter table public.factcheck_claims drop constraint factcheck_claims_fail_reason_only_on_error,
--                                       drop constraint factcheck_claims_fail_reason_code;
--   alter table public.factcheck_claims drop column fail_reason;
--   (then run the factcheck_video_view definition from 20261117090000_factcheck_sharing.sql again); commit;

BEGIN;

ALTER TABLE public.factcheck_claims ADD COLUMN fail_reason text;
ALTER TABLE public.factcheck_claims
  ADD CONSTRAINT factcheck_claims_fail_reason_code
    CHECK (fail_reason IN ('no_label', 'bad_label', 'label_conflict', 'no_sources')),
  ADD CONSTRAINT factcheck_claims_fail_reason_only_on_error
    CHECK (fail_reason IS NULL OR status = 'error');

CREATE OR REPLACE FUNCTION public.factcheck_video_view(p_user uuid, p_video_id text, p_is_admin boolean) RETURNS jsonb
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
                       'status', n.status, 'fail_reason', n.fail_reason, 'verdict', n.verdict, 'reason', n.reason, 'sources', n.sources,
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

COMMIT;
