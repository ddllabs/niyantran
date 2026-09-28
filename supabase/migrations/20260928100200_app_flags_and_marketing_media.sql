-- S4/S5: global app flags and the marketing intro video leave /tmp.
-- Spec: docs/specs/2026-09-28-serverless-state-to-supabase.md (decision D2
-- keeps the testing-phase flag). Plan task T4.
--
-- public.app_flags holds small global settings, one row per key. Both GET
-- routes that read it are public by design, so anon and authenticated may
-- read the key, value and timestamp. Nobody but the server writes: the route
-- checks for an internal admin, then writes with the secret key. updated_by
-- stays server-only so admin user ids are not published.
--
-- The intro video lives in the public-read Storage bucket `marketing`.
-- Uploads use server-issued signed upload URLs only, so there is no client
-- policy of any kind on storage.objects.
--
-- Bucket size limit: 50 MB. The previous local route accepted 120 MB, but a
-- Supabase project also enforces a global upload limit (the owner must confirm
-- this project's value in Storage settings). A bucket limit above the global
-- one gives no extra headroom, and 50 MB fits a short, web-encoded intro
-- video. Raise it deliberately, with the global limit, if needed.
BEGIN;

CREATE TABLE public.app_flags (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  value jsonb NOT NULL CHECK (octet_length(value::text) <= 16384),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX app_flags_updated_by ON public.app_flags(updated_by) WHERE updated_by IS NOT NULL;

ALTER TABLE public.app_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_flags_public_read ON public.app_flags
  FOR SELECT TO anon, authenticated USING (true);

-- Supabase default privileges grant ALL on new public tables to the API
-- roles; reset them, then grant only what the policy matrix needs.
REVOKE ALL ON TABLE public.app_flags FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (key, value, updated_at) ON TABLE public.app_flags TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_flags TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'marketing', 'marketing', true, 52428800,
  ARRAY['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']
)
ON CONFLICT (id) DO NOTHING;

-- No storage.objects policy at all: a public bucket serves its files by
-- public URL without one, uploads use server-issued signed URLs, and a client
-- SELECT policy would only let anyone list the bucket.

COMMIT;
