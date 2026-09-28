-- The persona picked at signup reaches the profile.
--
-- SignupPage sends the pick as raw_user_meta_data.personaId (a frontend id:
-- policy, journalist, student, analyst, lawyer, academic), but
-- handle_new_user() never read it, so user_profiles.persona stayed null and
-- research-chat answered every new account with the analyst.md fallback.
-- On 2026-09-28, 7 of 8 accounts had a null persona.
--
-- This is the live function with one column added. The mapping is the
-- frontend -> app_persona half of src/lib/personaMap.js and
-- supabase/functions/_shared/personaMap.ts; keep the three identical. An
-- unknown or missing id leaves the persona null, exactly as before. Role,
-- plan and status are still fixed here, whatever the metadata says.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (
    user_id,
    email,
    first_name,
    last_name,
    role,
    plan,
    status,
    organisation_id,
    language,
    onboarding_complete,
    persona
  )
  values (
    new.id,
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    -- every normal signup starts as user
    'user',
    -- every normal signup starts as explorer
    'explorer',
    'active',
    -- normal users have no organisation
    null,
    coalesce(new.raw_user_meta_data ->> 'language', 'en'),
    false,
    (case new.raw_user_meta_data ->> 'personaId'
       when 'policy' then 'policy_analyst'
       when 'journalist' then 'journalist'
       when 'student' then 'upsc_aspirant'
       when 'analyst' then 'corporate_affairs'
       when 'lawyer' then 'legal_researcher'
       when 'academic' then 'academic'
     end)::public.app_persona
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
