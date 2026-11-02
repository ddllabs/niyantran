-- Harness only. 20261102130000_batch_registration creates the corpus_ingest role when it is
-- missing. NTER applies migrations as postgres, which has CREATEROLE; run.sh applies them as
-- nter_migrator, which does not. Roles are cluster-wide, so in the test container the role
-- outlives any one fixture database anyway. This creates it the way the migration does (no login,
-- no password, no attribute), as the container's superuser, before the migration runs; the
-- migration then checks its attributes and membership as it would on NTER.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'corpus_ingest') THEN
    CREATE ROLE corpus_ingest NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END $$;
