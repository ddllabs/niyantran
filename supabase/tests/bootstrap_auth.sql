-- Disposable PostgreSQL-only platform stub. NEVER apply to a Supabase project.
-- Creates only the Auth interfaces used by profile_authority.sql. It does not
-- emulate GoTrue, PostgREST, JWT verification, or the Supabase extension set.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() NOT LIKE 'niyantran_%_test'
     OR to_regclass('auth.users') IS NOT NULL THEN
    RAISE EXCEPTION 'Bootstrap requires a fresh niyantran_*_test database';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'
);

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

CREATE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;

GRANT USAGE ON SCHEMA auth, public, extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

-- Reproduce broad Supabase-style exposure: restrictive fixture grants must
-- not accidentally fix the vulnerable baseline or hide missing revocations.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
