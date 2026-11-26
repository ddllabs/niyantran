# Storage usage and quota readable only by their own user (F410)

> **Status: Living (2026-11-26).** Built on `task/f410-storage-fn-own-user`. The migration is not applied to NTER; applying
> it waits for the developer's named yes.

## Current state (read on NTER, 2026-11-25, read-only)

- `public.user_storage_used_bytes(uuid)` and `public.user_storage_quota_bytes(uuid)` are on NTER but in no migration on
  `main`. They came from the unmerged `file-manager` branch's `supabase_dashboard_storage_setup.sql`, which says it was
  pasted into the dashboard's SQL editor. Neither has a `supabase_migrations.schema_migrations` row.
- Both are `SECURITY DEFINER`, owned by `postgres`, with the ACL `{=X, postgres=X, anon=X, authenticated=X,
  service_role=X}`. Supabase's security advisor flags both (lint 0028, "Public Can Execute SECURITY DEFINER Function").
- `used_bytes` refuses another user's id only when `auth.uid()` is set, so a signed-out caller reads any user's usage by
  id. `quota_bytes` checks no owner at all: any caller, signed in or not, reads any user's quota and so their plan.
- Callers: the file manager's client (`src/fileManager/fileManagerService.js` on `file-manager`) passes `user.id`;
  `user_file_prepare_upload` (security invoker) passes `auth.uid()` to `quota_bytes`. No caller asks for another user.

## Problem

Anyone holding the public anon key can learn, for a known user id, how much that user stores and which plan they are on.
Signed-in users can learn any other user's plan.

## Outcome

- Neither function is executable by `anon` or `PUBLIC`; `authenticated` and `service_role` keep execute.
- Both bodies refuse (42501) when a request made for an end user (a token with a user id, or the `anon` or
  `authenticated` role) asks for another user's figures, whatever the grants. The service role and a direct database
  session (no token) may still read any user's figures.
- Everything else is unchanged: arguments and default, counting rules, plan-to-quota mapping, `STABLE SECURITY DEFINER`,
  `search_path public, pg_temp`.

## Acceptance evidence

- `supabase/tests/user_storage_own_user.sql` (16 assertions) passes through `run.sh` on the chain: `bootstrap_auth.sql`,
  `bootstrap_user_storage_live.sql` (NTER's bodies and ACL, verbatim), the migration as a non-superuser.
- Vacuity: without the migration the fixture fails at its first assertion (anon can execute). Mutations each fail it:
  revoke only (fails at "A read B's quota"), body fix only (fails at "anon cannot execute"), the old only-when-signed-in
  rule (fails at "a token without a user id read B's usage").
- The migration does nothing where the functions are absent (main's from-scratch build), refuses when only one exists,
  re-applies cleanly, and its self-check undoes the whole change if `anon` or `PUBLIC` can still execute.
- After the apply on NTER: the advisor no longer lists either function under lint 0028, and
  `has_function_privilege('anon', …, 'execute')` is false for both.

## Scope

`supabase/migrations/20261126090000_user_storage_own_user.sql`, `supabase/tests/user_storage_own_user.sql`,
`supabase/tests/bootstrap_user_storage_live.sql`, `supabase/tests/run.sh` (one chain entry), this spec and the F410 entry
in `docs/plans/open-work.md`.

## Exclusions

- The rest of the file-manager schema (tables, bucket, the other 13 functions) and the decision to adopt it into `main`
  or remove it from NTER. Whoever adopts it must carry these bodies and grants into its migration, which otherwise
  redefines both functions with the old bodies.
- Other file-manager functions executable by `anon` (security invoker, relying on row-level security), and the 32
  definer functions the advisor lists for `authenticated` (lint 0029).
- Applying the migration to NTER: a separate yes, by `psql` with the history row inserted by hand (F283).
