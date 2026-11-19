-- Live TV fact-check: the administrator's list of open reports (open-work F362; docs/specs/2026-11-18-live-tv-admin-reports.md).
-- Additive only: one new read function. No table, column, policy or existing function changes.
--
-- Before: users can report a shared claim (public.factcheck_report) and an administrator can act on the reports
--   (public.factcheck_claim_hide, factcheck_report_dismiss, factcheck_video_remove), but nothing lets an administrator SEE
--   which claims are reported: factcheck_reports is readable only by the reporter (row-level security).
-- After:  public.factcheck_reports_admin(p_offset integer, p_limit integer) returns jsonb
--   { "total": <number of claims with an open report>,
--     "rows": [ { claim_id, video_id, channel_id, video_kind, claim_en, status, verdict, verdict_reason, sources, shared,
--                 hidden_at, report_count, newest_report_at, report_reasons } ... ] }
--   * Open means handled_at IS NULL, and nothing else (spec D11): a report on a claim that is already hidden is listed, with
--     hidden_at set, so that it can still be dismissed.
--   * One row per claim, newest open report first (ties by claim id). report_count counts the open reports of the claim.
--     report_reasons holds the reporters' texts as stored, newest first, at most 10.
--   * channel_id comes from the claim's session (the claims table has no channel column).
--   * verdict_reason is the claim's own reason (model-written); report_reasons are the reporters' texts (user-written).
--   * No user id, e-mail or session id of any reporter or owner is returned.
--   * p_limit is clamped to 1..50 (null: 50); p_offset to 0 or more (null: 0).
--   * A caller who is not a platform administrator gets error 42501, as the hide, dismiss and remove functions do.
--   * Execute: authenticated only (checked inside). Revoked from public, anon and service_role.
--
-- RELEASE: apply on the live database only after the owner's named approval, by the team's migration method. The Admin
--   "Fact-check reports" page shows its error state until this is applied (the function does not exist).
-- Down (rollback), as the migrating role; nothing else depends on the function:
--   begin;
--   drop function public.factcheck_reports_admin(integer, integer);
--   commit;

BEGIN;

CREATE OR REPLACE FUNCTION public.factcheck_reports_admin(p_offset integer, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_total integer;
  v_rows jsonb;
BEGIN
  IF NOT coalesce(public.is_platform_admin(), false) THEN
    RAISE EXCEPTION 'Platform administrators only' USING ERRCODE = '42501';
  END IF;

  SELECT count(DISTINCT r.claim_id) INTO v_total FROM public.factcheck_reports r WHERE r.handled_at IS NULL;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'claim_id', g.claim_id,
      'video_id', c.video_id,
      'channel_id', s.channel_id,
      'video_kind', c.video_kind,
      'claim_en', c.claim_en,
      'status', c.status,
      'verdict', c.verdict,
      'verdict_reason', c.reason,
      'sources', c.sources,
      'shared', c.shared,
      'hidden_at', c.hidden_at,
      'report_count', g.report_count,
      'newest_report_at', g.newest_report_at,
      'report_reasons', (SELECT coalesce(jsonb_agg(t.reason ORDER BY t.created_at DESC, t.id), '[]'::jsonb)
                         FROM (SELECT x.reason, x.created_at, x.id FROM public.factcheck_reports x
                               WHERE x.claim_id = g.claim_id AND x.handled_at IS NULL
                               ORDER BY x.created_at DESC, x.id LIMIT 10) t)
    ) ORDER BY g.newest_report_at DESC, g.claim_id), '[]'::jsonb)
  INTO v_rows
  FROM (SELECT o.claim_id, count(*)::integer AS report_count, max(o.created_at) AS newest_report_at
        FROM public.factcheck_reports o WHERE o.handled_at IS NULL
        GROUP BY o.claim_id
        ORDER BY max(o.created_at) DESC, o.claim_id
        LIMIT v_limit OFFSET v_offset) g
  JOIN public.factcheck_claims c ON c.id = g.claim_id
  JOIN public.factcheck_sessions s ON s.id = c.session_id;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.factcheck_reports_admin(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.factcheck_reports_admin(integer, integer) TO authenticated;

COMMIT;
