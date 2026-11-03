-- Harness only. 20261102130000_batch_registration creates the corpus_ingest role when it is
-- missing and sets its limits (ALTER ROLE ... SET, CONNECTION LIMIT). On NTER the migration runs as
-- postgres, which has CREATEROLE and, having created the role, ADMIN OPTION on it. run.sh applies
-- migrations as nter_migrator, which has neither; this gives it both, as the container's superuser,
-- before the migration runs. Roles are cluster-wide, so in the test container the role (and this
-- grant) outlive any one fixture database: when the role already exists, nter_migrator is granted
-- ADMIN on it as if it had created it; when it does not, the migration creates it, and creating it
-- grants nter_migrator ADMIN itself. Nothing else applied as nter_migrator creates or alters roles.
ALTER ROLE nter_migrator CREATEROLE;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'corpus_ingest') THEN
    GRANT corpus_ingest TO nter_migrator WITH ADMIN OPTION;
  END IF;
END $$;
