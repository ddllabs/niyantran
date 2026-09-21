-- public.update_updated_at_column() is the last function in the schema with a
-- mutable search_path, and the last of that class of Supabase security advisor
-- finding. Its whole body is `new.updated_at = now(); return new;`, so an empty
-- search_path changes nothing it can reach: now() is pg_catalog, which is always
-- resolvable regardless of the setting.
--
-- It is a trigger function attached to several tables and is defined in
-- migrations 0002/0003, which never set proconfig. ALTER rather than CREATE OR
-- REPLACE so the body stays exactly as reviewed and only the setting changes;
-- the triggers that reference it are untouched.
--
-- Down (manual):
--   alter function public.update_updated_at_column() reset search_path;

alter function public.update_updated_at_column() set search_path = '';
