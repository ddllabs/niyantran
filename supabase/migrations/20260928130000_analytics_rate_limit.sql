-- Rate limit for anonymous analytics events (wave-1 follow-up 6; owner
-- decision 2026-09-28: hashed IP, 60 events a minute).
--
-- The limit has to hold across Vercel instances, so the counter lives here.
-- POST /api/analytics/event calls analytics_rate_hit() once per event, with
-- a bucket that is an HMAC of the client IP keyed by a server secret. No raw
-- IP reaches the database. Windows older than an hour are purged every 15
-- minutes by pg_cron when the extension is present. Test databases have no
-- pg_cron, so the schedule is skipped there. To undo:
--   select cron.unschedule('analytics-rate-windows-purge');
--   drop function public.analytics_rate_hit(text, integer, integer);
--   drop function public.purge_analytics_rate_windows();
--   drop table public.analytics_rate_windows;

BEGIN;

CREATE TABLE public.analytics_rate_windows (
  bucket       text        NOT NULL CHECK (length(bucket) BETWEEN 1 AND 128),
  window_start timestamptz NOT NULL,
  hits         integer     NOT NULL DEFAULT 1 CHECK (hits > 0),
  PRIMARY KEY (bucket, window_start)
);

ALTER TABLE public.analytics_rate_windows ENABLE ROW LEVEL SECURITY;

-- Only the server route (service_role) touches the counter.
REVOKE ALL ON TABLE public.analytics_rate_windows FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analytics_rate_windows TO service_role;

-- Counts one hit in the caller's current fixed window and says whether the
-- bucket is still within p_limit. clock_timestamp(), not now(): the window is
-- the wall-clock time of this call, not of an enclosing transaction.
CREATE FUNCTION public.analytics_rate_hit(p_bucket text, p_limit integer, p_window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_window timestamptz;
  v_hits   integer;
BEGIN
  IF p_bucket IS NULL OR length(p_bucket) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'invalid bucket' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid limit' USING ERRCODE = '22023';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'invalid window' USING ERRCODE = '22023';
  END IF;

  v_window := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / p_window_seconds) * p_window_seconds);

  INSERT INTO public.analytics_rate_windows AS w (bucket, window_start, hits)
  VALUES (p_bucket, v_window, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET hits = w.hits + 1
  RETURNING w.hits INTO v_hits;

  RETURN v_hits <= p_limit;
END;
$$;

-- Returns the number of windows removed.
CREATE FUNCTION public.purge_analytics_rate_windows()
RETURNS bigint
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH gone AS (
    DELETE FROM public.analytics_rate_windows
     WHERE window_start < clock_timestamp() - interval '1 hour'
    RETURNING 1
  )
  SELECT count(*) FROM gone;
$$;

REVOKE ALL ON FUNCTION public.analytics_rate_hit(text, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_analytics_rate_windows() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.analytics_rate_hit(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_analytics_rate_windows() TO service_role;

-- Every 15 minutes. Idempotent: an existing job of this name is replaced.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'analytics-rate-windows-purge';
    PERFORM cron.schedule(
      'analytics-rate-windows-purge',
      '*/15 * * * *',
      'select public.purge_analytics_rate_windows()'
    );
  END IF;
END;
$$;

COMMIT;
