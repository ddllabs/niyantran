# File-manager grants narrowed to the roles that use them (F412)

> **Status: Living (2026-11-27).** Merged in PR #243 (`1682de1c`) and applied to NTER on 2026-11-27 with the
> developer's go-ahead; the record is F412 in `docs/plans/open-work-done.md`.

## Current state (read on NTER, 2026-11-26, read-only)

- `20261126150000_file_manager_schema` (F411) adopted NTER's file-manager schema as it ran, grants included.
- anon holds every table privilege on `user_folders`, `user_files`, `user_file_chunks` and `user_file_jobs`
  (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, and MAINTAIN on PostgreSQL 17), and USAGE, SELECT
  and UPDATE on `user_file_jobs_id_seq`.
- Seven SECURITY INVOKER functions are executable by PUBLIC and anon: `match_user_files`, `user_file_complete_upload`,
  `user_file_prepare_upload`, `user_file_restore`, `user_file_verify_index_validity`, `user_files_empty_trash` and
  `user_folder_soft_delete`. F411's spec and F412's tracker entry said eight; the catalog has seven.
- No policy admits anon, so anon reads and writes no rows today. The eight other file-manager functions (the worker's,
  the credit functions and F410's two) already exclude anon and PUBLIC.

## Problem

Row-level security is the only thing keeping signed-out requests out of private files. A policy mistake later (a
policy written `to public`, or row-level security switched off on one table) would expose private files to anyone with
the public key at once. TRUNCATE is not subject to row-level security at all. anon needs none of these privileges.

## Who calls these objects

Read on the `file-manager` branch, where the code that uses them lives (none of it is on `main`):

- the file manager (`src/fileManager/`), the source reader's private citations (`src/ai/SourceReader.jsx`) and the
  mobile app (`nter-mobile/src/services/live.js`) use the signed-in user's session;
- private-file retrieval (`supabase/functions/_shared/retrieval.ts`) calls `match_user_files` only when the request
  carries private file ids, which only a signed-in user has;
- the worker (`supabase/functions/ingest-worker/`) and `document-file` use the service role.

## Outcome

- `supabase/migrations/20261126180000_file_manager_grants.sql`:
  - revokes every privilege anon holds on the four tables and the sequence;
  - revokes execute on the seven functions from PUBLIC and anon, and grants it to authenticated and service_role
    (which already hold it).
- Nothing else changes: no row, policy, function body or other role's grant.
- A self-check at the end refuses (and undoes everything) if anon keeps any privilege on these objects, if PUBLIC can
  execute any file-manager function, or if authenticated or service_role lost one they need.
- A signed-out request now gets "permission denied" (42501) instead of no rows. In the code read above, the one
  visible difference is in the source reader: a private citation opened while signed out shows "no longer available"
  instead of "gone".

## Acceptance evidence

- `supabase/tests/file_manager_grants.sql`, run through `run.sh` on its own chain (file_manager_schema's chain, then
  the migration), checks two things:
  - **Grants:** the grants on the four tables, the sequence and all fifteen file-manager functions equal 25 expected
    lines, which are F411's capture of NTER minus anon, and minus PUBLIC and anon on the seven functions. Any missing
    or extra line is printed. anon also holds no privilege of any kind, MAINTAIN included.
  - **Behaviour:** anon is refused `user_files`, `user_file_jobs`, the job sequence and `match_user_files` with 42501.
    A signed-in user still reads and writes its own rows and runs `user_files_empty_trash` and `match_user_files`. The
    service role keeps the worker's access.
- Vacuity: without the migration, the comparison fails on exactly the 12 lines F412 changes, and the behaviour checks
  alone fail too (anon reads `user_files`).
- Mutations:
  - With the self-check removed, leaving out the sequence revoke fails the comparison on that line.
  - With the self-check removed, leaving one function out of the revoke fails the comparison on that function's line.
  - With the self-check in place, it refuses both of those, and a version that also revokes from authenticated.
- Applied twice, the fixture still passes.

## Scope

The migration, the fixture, one chain entry in `supabase/tests/run.sh`, this spec, F412 in `docs/plans/open-work.md`,
and the count of SECURITY INVOKER functions in F411's spec, from eight to seven.

## Exclusions and follow-ups

- **authenticated's table privileges** (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) are as wide as anon's were. The
  authenticated role is reached only through the Data API, which cannot issue them, so they are left as they are here.
  Narrowing them is a separate change, if wanted.
- **Default privileges:** Supabase's defaults still grant anon on new tables in `public`; this change covers these
  objects only.
- **F413**, the credit functions, is unchanged.
- **Applying:** on NTER by psql as postgres, with the history row under `20261126180000` inserted by hand, with the
  developer's yes. Before: a read-only check that the grants still match F411's capture. After: the two checks in the
  migration's header.
