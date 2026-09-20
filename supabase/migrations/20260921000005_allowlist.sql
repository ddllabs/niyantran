-- 0005: the model allowlist and Niyantran's role layer.
-- Spec: docs/specs/2026-09-20-ai-backend-foundation-design.md §B, §C (Decisions 8, 10, 11); ADR 0002 point 2 (amended).
-- Plan: docs/plans/2026-09-21-ai-backend-foundation.md Task 4.
--
-- Down (manual):
--   drop table if exists public.ai_roles, public.ai_models;
--   drop function if exists public.ai_models_guard(), public.ai_roles_guard();

create table public.ai_models (
  model_id     text primary key,              -- OpenRouter id, e.g. 'google/gemini-…'
  label        text not null,                 -- picker label
  vendor       text not null default '',      -- derived from the id prefix when blank
  tier         smallint not null default 2 check (tier between 1 and 3),   -- cost hint
  efforts      text[] not null default '{}',  -- reasoning values the model accepts
  params       jsonb not null default '{}',   -- per-model inference defaults (temperature, max_tokens…)
  enabled      boolean not null default false,
  is_default   boolean not null default false,
  sort_order   int not null default 100,
  updated_at   timestamptz not null default now()
);
create unique index ai_models_one_default on public.ai_models (is_default) where is_default;

-- The lock-out. A row may be enabled only if the refreshed OpenRouter catalogue
-- lists the id as available with tool calling. This is what keeps the
-- frontend's placeholder ids out of the allowlist.
create or replace function public.ai_models_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.vendor is null or new.vendor = '' then
    new.vendor := split_part(new.model_id, '/', 1);
  end if;
  new.updated_at := now();
  if new.is_default and not new.enabled then
    raise exception 'model % cannot be the default while disabled', new.model_id;
  end if;
  if new.enabled and not exists (
    select 1 from public.model_pricing p
     where p.model_id = new.model_id
       and p.is_available
       and 'tools' = any(p.supported_parameters)
  ) then
    raise exception 'model % is not in the OpenRouter catalogue with tool support', new.model_id;
  end if;
  return new;
end;
$$;

create trigger ai_models_guard
  before insert or update on public.ai_models
  for each row execute function public.ai_models_guard();

create table public.ai_roles (
  role_id     text primary key,               -- 'DEFAULT_ANALYST' | 'EXPERT_ESCALATION' | 'PDF_PARSER' | 'VISUAL_RESEARCH'
  label       text not null,
  hint        text not null,
  model_id    text not null references public.ai_models(model_id),
  sort_order  int not null default 100,
  updated_at  timestamptz not null default now()
);

-- A role may not point at a disabled model.
create or replace function public.ai_roles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if not exists (select 1 from public.ai_models m where m.model_id = new.model_id and m.enabled) then
    raise exception 'role % points at % which is not an enabled model', new.role_id, new.model_id;
  end if;
  return new;
end;
$$;

create trigger ai_roles_guard
  before insert or update on public.ai_roles
  for each row execute function public.ai_roles_guard();

-- RLS: every signed-in user may read both tables (disabled rows carry no
-- secret); only the service role writes, and only through admin-models.
alter table public.ai_models enable row level security;
alter table public.ai_roles  enable row level security;

create policy ai_models_read on public.ai_models for select to authenticated using (true);
create policy ai_roles_read  on public.ai_roles  for select to authenticated using (true);

grant select on public.ai_models, public.ai_roles to authenticated;
revoke all on public.ai_models, public.ai_roles from anon;
