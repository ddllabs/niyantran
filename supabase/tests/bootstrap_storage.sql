-- Disposable PostgreSQL-only stub. NEVER apply to a Supabase project.
-- Creates only the Storage tables and columns that
-- 20260928100200_app_flags_and_marketing_media.sql and its fixture reference.
-- It does not emulate the Storage API, signed URLs, public-bucket serving,
-- size or MIME enforcement, or Supabase's storage triggers and functions.
-- Loaded after bootstrap_auth.sql, which creates the roles used below.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() NOT LIKE 'niyantran_%_test'
     OR to_regclass('storage.buckets') IS NOT NULL
     OR to_regclass('storage.objects') IS NOT NULL THEN
    RAISE EXCEPTION 'Storage bootstrap requires a fresh niyantran_*_test database';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'Storage bootstrap requires bootstrap_auth.sql first';
  END IF;
END;
$$;

CREATE SCHEMA storage;

CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  owner uuid,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (bucket_id, name)
);

-- Supabase ships both tables with RLS on and broad table grants to the API
-- roles, so policies alone decide client access. Reproduce that exposure so a
-- missing or over-broad policy is not hidden by a missing grant.
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON TABLE storage.buckets, storage.objects TO anon, authenticated, service_role;
