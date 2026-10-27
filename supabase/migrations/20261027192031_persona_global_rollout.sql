-- Stage disabled; enable globally after runtime deployment. Rollback with
-- global_enabled=false (owner pilot), or enabled=false (bundled for everyone).
alter table public.persona_pilot_settings add column global_enabled boolean not null default false;

create function public.persona_admin_access(p_actor uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.user_profiles
    where user_id=p_actor and role='admin' and status='active');
$$;
create function public.persona_published_access(p_actor uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.persona_pilot_settings s
    join public.user_profiles u on u.user_id=p_actor
    where s.singleton and s.enabled and u.status='active'
      and (s.global_enabled or (s.owner_id=p_actor and u.role='admin')));
$$;
create function public.persona_active(p_actor uuid,p_persona text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if not public.persona_published_access(p_actor) then
    raise exception 'published persona access required' using errcode='42501';
  end if;
  if not public.persona_admin_access(p_actor) and not exists(
    select 1 from public.user_profiles where user_id=p_actor
      and coalesce(persona::text,'corporate_affairs')=p_persona
  ) then raise exception 'own persona required' using errcode='42501'; end if;
  select jsonb_build_object('id',r.id,'text',r.prompt) into result
    from public.persona_prompt_states s join public.persona_prompt_revisions r
      on r.id=s.active_id and r.persona=s.persona where s.persona=p_persona;
  return result;
end;
$$;
revoke all on function public.persona_admin_access(uuid), public.persona_published_access(uuid), public.persona_active(uuid,text) from public,anon,authenticated;
grant execute on function public.persona_admin_access(uuid), public.persona_published_access(uuid), public.persona_active(uuid,text) to service_role;

-- Keep the audited CAS implementation and signature. Fail on schema drift.
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.persona_admin(uuid,text,text,text,integer,uuid,jsonb)'::regprocedure);
  if position('if not public.persona_pilot_access(p_actor)' in definition)=0 then
    raise exception 'unexpected persona_admin authorization definition';
  end if;
  definition := replace(definition,'if not public.persona_pilot_access(p_actor)','if not public.persona_admin_access(p_actor)');
  definition := replace(definition,'pilot account required','active platform admin required');
  execute definition;
end;
$migration$;
