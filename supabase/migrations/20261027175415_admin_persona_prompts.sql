-- Additive, disabled by default. Rollback: set persona_pilot_settings.enabled=false;
-- retain revisions/history. No corpus, user roles or customer prompt changes.
create table public.persona_pilot_settings (
  singleton boolean primary key default true check (singleton),
  owner_id uuid references auth.users(id),
  enabled boolean not null default false
);
insert into public.persona_pilot_settings(singleton) values(true);
create table public.persona_prompt_revisions (
  id uuid primary key default gen_random_uuid(),
  persona text not null check (persona in ('policy_analyst','journalist','upsc_aspirant','corporate_affairs','legal_researcher','academic')),
  prompt text not null check (length(btrim(prompt, E' \n\r\t')) > 0 and octet_length(prompt) <= 100000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(persona,id)
);
create table public.persona_prompt_states (
  persona text primary key,
  draft_id uuid not null,
  active_id uuid not null,
  generation integer not null default 1,
  foreign key(persona,draft_id) references public.persona_prompt_revisions(persona,id),
  foreign key(persona,active_id) references public.persona_prompt_revisions(persona,id)
);
create table public.persona_prompt_events (
  id uuid primary key default gen_random_uuid(),
  persona text not null,
  revision_id uuid not null,
  action text not null check(action in ('initialize','save','publish','rollback')),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key(persona,revision_id) references public.persona_prompt_revisions(persona,id)
);
alter table public.persona_pilot_settings enable row level security;
alter table public.persona_prompt_revisions enable row level security;
alter table public.persona_prompt_states enable row level security;
alter table public.persona_prompt_events enable row level security;
revoke all on public.persona_pilot_settings, public.persona_prompt_revisions, public.persona_prompt_states, public.persona_prompt_events from public, anon, authenticated, service_role;
grant select on public.persona_pilot_settings to service_role;
grant select, insert on public.persona_prompt_revisions, public.persona_prompt_events to service_role;
grant select, insert, update on public.persona_prompt_states to service_role;

create function public.persona_pilot_access(p_actor uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.persona_pilot_settings s
    join public.user_profiles u on u.user_id=s.owner_id
    where s.singleton and s.enabled and s.owner_id=p_actor and u.role='admin' and u.status='active');
$$;
revoke all on function public.persona_pilot_access(uuid) from public, anon, authenticated;
grant execute on function public.persona_pilot_access(uuid) to service_role;

create function public.persona_admin(p_actor uuid, p_action text, p_persona text default null,
  p_text text default null, p_expected integer default null, p_revision uuid default null,
  p_baselines jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare state_row public.persona_prompt_states; revision_row public.persona_prompt_revisions; item record; rev uuid; result jsonb;
begin
  if not public.persona_pilot_access(p_actor) then raise exception 'pilot account required' using errcode='42501'; end if;
  if p_action='initialize' then
    if exists(select 1 from public.persona_prompt_states) then raise exception 'already initialized' using errcode='40001'; end if;
    if jsonb_typeof(p_baselines) is distinct from 'object' or
      (select count(*) from jsonb_object_keys(p_baselines)) <> 6 then raise exception 'six baselines required'; end if;
    perform pg_advisory_xact_lock(27175415);
    if exists(select 1 from public.persona_prompt_states) then raise exception 'already initialized' using errcode='40001'; end if;
    for item in select key, value from jsonb_each_text(p_baselines) loop
      insert into public.persona_prompt_revisions(persona,prompt,created_by) values(item.key,item.value,p_actor) returning id into rev;
      insert into public.persona_prompt_states(persona,draft_id,active_id) values(item.key,rev,rev);
      insert into public.persona_prompt_events(persona,revision_id,action,actor_id) values(item.key,rev,'initialize',p_actor);
    end loop;
  elsif p_action in ('save','publish','rollback') then
    select * into state_row from public.persona_prompt_states where persona=p_persona for update;
    if not found then raise exception 'persona not initialized' using errcode='P0002'; end if;
    if p_expected is distinct from state_row.generation then raise exception 'revision conflict: reload before saving' using errcode='40001'; end if;
    if p_action='save' then
      insert into public.persona_prompt_revisions(persona,prompt,created_by) values(p_persona,p_text,p_actor) returning id into rev;
      update public.persona_prompt_states set draft_id=rev,generation=generation+1 where persona=p_persona;
    else
      rev := case when p_action='publish' then state_row.draft_id else p_revision end;
      select * into revision_row from public.persona_prompt_revisions where id=rev and persona=p_persona;
      if not found then raise exception 'unknown revision' using errcode='P0002'; end if;
      update public.persona_prompt_states set active_id=rev,generation=generation+1 where persona=p_persona;
    end if;
    insert into public.persona_prompt_events(persona,revision_id,action,actor_id) values(p_persona,rev,p_action,p_actor);
  elsif p_action='active' then
    select jsonb_build_object('id',r.id,'text',r.prompt) into result
      from public.persona_prompt_states s join public.persona_prompt_revisions r on r.id=s.active_id where s.persona=p_persona;
    return result;
  elsif p_action <> 'read' then
    raise exception 'unknown action';
  end if;
  select jsonb_build_object('states',coalesce((select jsonb_agg(jsonb_build_object(
    'persona',s.persona,'generation',s.generation,'draft_id',s.draft_id,'active_id',s.active_id,
    'draft_text',d.prompt,'active_text',a.prompt)) from public.persona_prompt_states s
    join public.persona_prompt_revisions d on d.id=s.draft_id
    join public.persona_prompt_revisions a on a.id=s.active_id),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(e)) from (select * from public.persona_prompt_events order by created_at desc,id desc limit 120) e),'[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function public.persona_admin(uuid,text,text,text,integer,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.persona_admin(uuid,text,text,text,integer,uuid,jsonb) to service_role;
