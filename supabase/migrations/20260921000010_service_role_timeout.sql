-- 0010: statement timeout for service-role requests.
-- Plan: docs/plans/2026-09-21-corpus-ingest-first-pass.md (Task 3, observed 2026-09-21).
--
-- PostgREST applies a role's settings on impersonation; `service_role` had
-- none, so it inherited the login role's 8 s. With eight ingest processes
-- inserting into the HNSW index at once, one chunk_commit of ~45 rows was
-- cancelled at 8 s. The service role is server-only (never a browser), so a
-- longer bound is safe. anon (3 s) and authenticated (8 s) are unchanged.
--
-- Down (manual):
--   alter role service_role reset statement_timeout;

alter role service_role set statement_timeout = '300s';
