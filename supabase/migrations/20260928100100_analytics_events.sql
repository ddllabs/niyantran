-- S2: durable product analytics events (docs/specs/2026-09-28-serverless-state-to-supabase.md).
-- Replaces the SQLite table that lived under /tmp on the serverless host.
--
-- Writes and reads go only through server/analyticsApi.mjs with the secret
-- key, after its own checks: anonymous visitors may add an event, and only an
-- internal admin may read. So there are no client policies and no client
-- grants. No email is stored; user_id is set only from a verified bearer.
--
-- Retention (owner decision D3): 180 days, purged nightly by pg_cron when the
-- extension is present. Test databases have no pg_cron, so the schedule is
-- guarded and the purge itself is a function the fixture can call.
--
-- Down (manual):
--   select cron.unschedule('analytics-events-retention');
--   drop function if exists public.purge_analytics_events();
--   drop function if exists public.analytics_event_summary(integer);
--   drop table if exists public.analytics_events;
BEGIN;

CREATE TABLE public.analytics_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL
    CONSTRAINT analytics_events_name_check
    CHECK (char_length(name) <= 64 AND name ~ '^[a-z0-9][a-z0-9_.:-]*$'),
  props jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT analytics_events_props_check
    CHECK (jsonb_typeof(props) = 'object' AND octet_length(props::text) <= 4096),
  session_id text
    CONSTRAINT analytics_events_session_id_check
    CHECK (char_length(session_id) <= 64),
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analytics_events_created_at ON public.analytics_events (created_at);
CREATE INDEX analytics_events_name_created_at ON public.analytics_events (name, created_at);
-- Lets ON DELETE SET NULL find a deleted user's rows without a table scan.
CREATE INDEX analytics_events_user_id ON public.analytics_events (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Supabase's default privileges grant new tables and sequences to anon,
-- authenticated and service_role. Remove all of it, then grant back only the
-- verbs the server route and the retention purge need.
REVOKE ALL ON TABLE public.analytics_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.analytics_events_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.analytics_events TO service_role;

-- The admin summary route. PostgREST has no GROUP BY, and counting rows in
-- the route would read every event in the retention window.
CREATE FUNCTION public.analytics_event_summary(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH counts AS (
    SELECT e.name, count(*) AS n FROM public.analytics_events e GROUP BY e.name
  ), top AS (
    SELECT c.name, c.n FROM counts c
    ORDER BY c.n DESC, c.name
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 500)
  )
  SELECT jsonb_build_object(
    'total', coalesce((SELECT sum(c.n) FROM counts c), 0)::bigint,
    'byName', coalesce(
      (SELECT jsonb_agg(jsonb_build_object('name', t.name, 'n', t.n) ORDER BY t.n DESC, t.name) FROM top t),
      '[]'::jsonb)
  );
$$;

-- D3 retention. Returns the number of rows removed.
CREATE FUNCTION public.purge_analytics_events()
RETURNS bigint
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH gone AS (
    DELETE FROM public.analytics_events WHERE created_at < now() - interval '180 days' RETURNING 1
  )
  SELECT count(*) FROM gone;
$$;

REVOKE ALL ON FUNCTION public.analytics_event_summary(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_analytics_events() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.analytics_event_summary(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_analytics_events() TO service_role;

-- Nightly at 03:17 UTC. Idempotent: an existing job of this name is replaced.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'analytics-events-retention';
    PERFORM cron.schedule(
      'analytics-events-retention',
      '17 3 * * *',
      'select public.purge_analytics_events()'
    );
  END IF;
END;
$$;

COMMIT;
