# backend/sql

Only the SQL bootstrap remains here. The old backend module (services, routes
and three invite Edge Functions extracted from `tenderbase-onboard`) was never
deployed and was removed on 2026-09-29; it is in git history before that date.

- `sql/auth_schema.sql` bootstraps the profile, organisation and role tables
  that `supabase/migrations/` assume already exist. `supabase/tests/run.sh`
  loads it before the migrations for every SQL fixture. It is not the source
  of truth for the live database (see the warning at the top of the file).
- `sql/SUPABASE_SETUP.md` is the original setup note for that schema.
