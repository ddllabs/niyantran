-- 0001: vector extension and capture-only email folding.
-- Spec: docs/specs/2026-09-20-ai-backend-foundation-design.md §A, §B (Decision 12).
-- Plan: docs/plans/2026-09-21-ai-backend-foundation.md Task 1.
--
-- Down (manual):
--   drop trigger if exists user_profiles_email_normalised on public.user_profiles;
--   drop function if exists public.set_email_normalised();
--   drop index if exists public.user_profiles_email_normalised_idx;
--   alter table public.user_profiles drop column if exists email_normalised;
--   drop function if exists public.normalise_email(text);
--   -- the vector extension is left installed; dropping it is a separate decision.

create extension if not exists vector with schema extensions;

-- Folding rule (capture only; no uniqueness is enforced in this cut):
--   * whole address lower-cased and trimmed;
--   * gmail.com / googlemail.com: dots removed from the local part and any
--     "+suffix" dropped, because Gmail delivers all of those to one inbox;
--   * every other domain: only lower-cased — dots are significant there.
create or replace function public.normalise_email(p_email text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_email  text := lower(trim(p_email));
  v_at     int  := position('@' in v_email);
  v_local  text;
  v_domain text;
begin
  if v_at = 0 then
    return v_email;
  end if;
  v_local  := substr(v_email, 1, v_at - 1);
  v_domain := substr(v_email, v_at + 1);
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := split_part(v_local, '+', 1);
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  return v_local || '@' || v_domain;
end;
$$;

alter table public.user_profiles
  add column if not exists email_normalised text;

comment on column public.user_profiles.email_normalised is
  'public.normalise_email(email). Captured for a later uniqueness rule; not enforced yet.';

-- Non-unique on purpose (Decision 12). The unique index is a later, owner-approved task.
create index if not exists user_profiles_email_normalised_idx
  on public.user_profiles (email_normalised);

-- Fill the column on every insert and on every email change, whoever writes
-- the row. This leaves the production handle_new_user() definer function
-- untouched.
create or replace function public.set_email_normalised()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email_normalised := public.normalise_email(coalesce(new.email, ''));
  return new;
end;
$$;

drop trigger if exists user_profiles_email_normalised on public.user_profiles;
create trigger user_profiles_email_normalised
  before insert or update of email on public.user_profiles
  for each row execute function public.set_email_normalised();

-- Backfill the existing rows.
update public.user_profiles
   set email_normalised = public.normalise_email(coalesce(email, ''))
 where email_normalised is null;
