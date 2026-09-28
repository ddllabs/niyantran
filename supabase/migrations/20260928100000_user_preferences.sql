-- T1 (S1): durable per-user preferences, replacing the SQLite user_prefs table
-- that lived under /tmp on Vercel. /api/user-prefs reaches this table only
-- through a client bound to the caller's own bearer, so RLS is the second,
-- independent owner check. Clients may read, create and change only their own
-- row; nobody deletes through the API (the auth.users cascade removes it).
-- Size bounds are per field on the stored jsonb text: watchlist and tours
-- 64 KiB, ai_chats 2 MiB (the route caps the whole request at 2.5 MiB).
-- Depends only on the least-privilege chain; no service or anon access.
BEGIN;

CREATE TABLE public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  watchlist jsonb,
  ai_chats jsonb,
  tours jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_preferences_watchlist_size CHECK (octet_length(watchlist::text) <= 65536),
  CONSTRAINT user_preferences_ai_chats_size CHECK (octet_length(ai_chats::text) <= 2097152),
  CONSTRAINT user_preferences_tours_size CHECK (octet_length(tours::text) <= 65536)
);

-- The server clock, not the writer, dates every change.
CREATE FUNCTION public.touch_user_preferences() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_user_preferences() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER user_preferences_touch BEFORE INSERT OR UPDATE ON public.user_preferences
FOR EACH ROW EXECUTE FUNCTION public.touch_user_preferences();

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_preferences_select ON public.user_preferences FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));
CREATE POLICY user_preferences_insert ON public.user_preferences FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY user_preferences_update ON public.user_preferences FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));
-- No DELETE policy.

-- Supabase default privileges grant ALL on new tables to anon, authenticated
-- and service_role. Reset them, then grant only the verbs the policies cover.
REVOKE ALL ON TABLE public.user_preferences FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_preferences TO authenticated;

COMMIT;
