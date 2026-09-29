-- F10: one account per normalised email (docs/plans/open-work.md).
--
-- 0001 captured user_profiles.email_normalised (lower-cased, trimmed; for
-- gmail.com and googlemail.com, dots and "+suffix" removed) with a
-- deliberately non-unique index, deferring uniqueness "until entitlements go
-- server-side". They did on 2026-09-29 (20260929100000_plan_entitlements):
-- each account gets one trial, so a Gmail alias would otherwise be a second
-- trial. NTER had no duplicate values when this was written (10 profiles).
--
-- handle_new_user() inserts the profile inside the auth.users insert, so a
-- signup whose address folds onto an existing account now fails as a whole.

drop index if exists public.user_profiles_email_normalised_idx;
create unique index if not exists user_profiles_email_normalised_key
  on public.user_profiles (email_normalised);

comment on column public.user_profiles.email_normalised is
  'public.normalise_email(email). Unique since 20260929110000_email_unique: one account per folded address.';
