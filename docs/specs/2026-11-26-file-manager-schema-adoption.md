# The file-manager schema adopted into main (F411)

> **Status: Living (2026-11-26).** Built on `task/f411-file-manager-schema`. Nothing here is applied to NTER; the
> history row waits for the developer's named yes.

## Current state (read on NTER, 2026-11-26, read-only)

- NTER holds the private file-manager schema: tables `user_folders`, `user_files`, `user_file_chunks` and
  `user_file_jobs` (57 columns, 35 constraints, 17 indexes, row-level security enabled and forced), 12 table policies,
  the private `user-files` bucket with 4 storage policies, 15 functions, and three columns on `ingest_settings`
  (`corpus_max_running`, `user_file_max_running`, `max_running_per_user`). Live data: 3 files and 5 stored objects.
- None of it is in a migration on `main`, and it has no history row. It was applied from the `file-manager` branch's
  `supabase_dashboard_storage_setup.sql`, pasted into the dashboard, and changed there afterwards.
- No file on that branch reproduces NTER. Five functions (`user_file_claim`, `user_file_enqueue_indexing`,
  `user_file_job_cancel`, `user_file_job_retry`, `user_file_settle_credits`) exist only on NTER, with signatures
  that differ from the branch's; the grants differ too. Eight function bodies match the branch's files (commit
  `86713c80`) byte for byte; two (`user_storage_*`) are F410's.
- The branch's own tracker number for this work, F341, is already used on `main` for the citation reader's bar.

## Problem

`main` does not describe what production runs. A database built from `main` lacks the schema, a fixture cannot test
it, and the next dashboard change or branch merge can silently differ from NTER. The branch's migration files, if
merged, would redefine functions with older bodies (undoing F410) and recreate objects that differ from NTER's.

## Outcome

- `supabase/migrations/20261126150000_file_manager_schema.sql` reproduces NTER's file-manager catalog, as read on
  2026-11-26 after F410. It is not a redesign: names, constraints, indexes, policies, function definitions and grants
  are NTER's, including what the follow-ups below would change. Function bodies are NTER's text without its carriage
  returns.
- It runs after F410's migration (a no-op on a database without these functions) and is idempotent.
- On NTER nothing needs to run: after a read-only check that NTER still matches, the history row is inserted by hand.

## Acceptance evidence

- `supabase/tests/file_manager_schema.sql`, through `run.sh` on its own chain, builds the schema from scratch and
  compares a catalog fingerprint with the 178 lines read from NTER (columns, row-level security, constraints,
  indexes, policies, function definitions and execute grants, table and sequence grants, the bucket, the
  `ingest_settings` columns; owners left out). Every line must match, and any difference is printed.
- The fingerprint lines were copied from NTER and checked by md5 (`1bca21d8…`, 178 lines); each of the 13 function
  bodies not taken from F410 was checked against NTER's md5 before use.
- Behaviour: an owner sees and writes only their own rows; another user sees none of them; anon sees no rows and cannot
  write; the bucket admits an object only under its owner's folder; F410's refusal holds; the worker's functions are
  the service role's alone.
- Vacuity: without the migration, the comparison fails. Five mutations each fail it on the line they change (a function
  default, a function grant, forced row-level security, a check constraint, a storage policy). Applied twice, the
  fixture still passes.

## Scope

The migration, the fixture, `supabase/tests/bootstrap_file_manager_deps.sql` (stand-ins needed only to create the
schema: the vector extension, `storage.foldername`, `ingest_settings`, the credit tables' types), one chain entry in
`supabase/tests/run.sh`, this spec, and F411 to F413 in `docs/plans/open-work.md`.

## Exclusions and follow-ups

- **The contributor's code** (the file-manager UI, the worker step, the mobile app) stays on their branch. When that
  branch is brought up to date with `main`, its own migration files (`20261115000001_private_file_manager.sql`,
  `20261121000001_user_file_chunks_metadata.sql`, `supabase_dashboard_storage_setup.sql`) must be dropped in favour of
  this one, or they will undo F410 and re-create objects that differ from NTER. Telling the contributor is the
  developer's step.
- **F412, grants:** anon holds every table privilege on the four tables and the job sequence's privileges, and eight
  SECURITY INVOKER functions are executable by PUBLIC and anon. Row-level security keeps anon out today; tightening is a
  separate change with its own fixture.
- **F413, credit functions:** `user_file_enqueue_indexing`, `user_file_job_cancel`, `user_file_job_retry` and
  `user_file_settle_credits` hold or settle credits (billing scope). They are adopted as they run on NTER, gated by the
  `file_indexing_billing` flag, and not reviewed here.
- **Applying:** the history row on NTER under `20261126150000`, with the developer's yes, after the read-only check.
