-- 0006: the health probe the `health` edge function calls.
-- Spec: docs/specs/2026-09-20-ai-backend-foundation-design.md §C.
-- Plan: docs/plans/2026-09-21-ai-backend-foundation.md Task 5.
-- PostgREST cannot read pg_extension, so this definer function reports it,
-- together with the two counts health returns and the caller's auth.uid(),
-- which proves the JWT reached the database.
--
-- Down (manual):
--   drop function if exists public.ai_health();

create or replace function public.ai_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'vector',         exists (select 1 from pg_catalog.pg_extension where extname = 'vector'),
    'pricing_rows',   (select count(*) from public.model_pricing),
    'models_enabled', (select count(*) from public.ai_models where enabled),
    'uid',            auth.uid()
  );
$$;

revoke all on function public.ai_health() from public;
grant execute on function public.ai_health() to authenticated, service_role;
