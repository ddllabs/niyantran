-- Persona audit actors are historical UUIDs, not account-lifecycle dependencies.
-- Identity is verified before the service-only RPC writes them. Retain that
-- identity if Auth later deletes the account; never cascade-delete its history.
alter table public.persona_prompt_revisions drop constraint persona_prompt_revisions_created_by_fkey;
alter table public.persona_prompt_events drop constraint persona_prompt_events_actor_id_fkey;
alter table public.persona_pilot_settings drop constraint persona_pilot_settings_owner_id_fkey;
alter table public.persona_pilot_settings add constraint persona_pilot_settings_owner_id_fkey
  foreign key(owner_id) references auth.users(id) on delete set null;

-- Down is deliberately manual: disable the pilot first. Re-adding actor foreign
-- keys would reject retained historical UUIDs after an account has been deleted.
