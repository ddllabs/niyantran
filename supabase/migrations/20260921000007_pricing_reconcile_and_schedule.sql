-- 0007: catalogue reconciliation in one transaction, and the twelve-hour schedule.
-- Spec: docs/specs/2026-09-20-ai-backend-foundation-design.md §C (Decision 9); ADR 0002 point 4.
-- Plan: docs/plans/2026-09-21-ai-backend-foundation.md Task 6.
--
-- The refresh-model-pricing function maps OpenRouter's catalogue and hands
-- the rows to model_pricing_reconcile, which upserts them, marks absent rows
-- unavailable, and disables any allowlist row whose model left the catalogue
-- or lost tool support — atomically, so the picker never sees a half state.
--
-- The schedule calls the function through pg_net with the REFRESH_SECRET
-- header, read from Vault under the name 'refresh_secret'. The secret itself
-- is never in this file: the owner (or the supervisor on instruction) runs
--   select vault.create_secret('<value>', 'refresh_secret');
-- and sets the same value as the function secret REFRESH_SECRET.
--
-- Down (manual):
--   select cron.unschedule('refresh-model-pricing');
--   drop function if exists public.model_pricing_reconcile(jsonb);

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.model_pricing_reconcile(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- clock_timestamp(), not now(): two runs inside one transaction must still
  -- see distinct run times, or the "absent from this run" test is vacuous.
  v_run          timestamptz := clock_timestamp();
  v_upserted     int;
  v_unavailable  int;
  v_disabled     text[];
  v_orphans      text[];
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  insert into public.model_pricing as p (
    model_id, context_length, max_completion_tokens, prompt_usd, completion_usd,
    cache_read_usd, cache_write_usd, internal_reasoning_usd, supported_parameters, is_available, fetched_at
  )
  select r.model_id, r.context_length, r.max_completion_tokens, r.prompt_usd, r.completion_usd,
         r.cache_read_usd, r.cache_write_usd, r.internal_reasoning_usd, coalesce(r.supported_parameters, '{}'), true, v_run
    from jsonb_to_recordset(p_rows) as r(
           model_id text, context_length int, max_completion_tokens int, prompt_usd numeric, completion_usd numeric,
           cache_read_usd numeric, cache_write_usd numeric, internal_reasoning_usd numeric, supported_parameters text[])
   where r.model_id is not null and r.model_id <> ''
  on conflict (model_id) do update
     set context_length         = excluded.context_length,
         max_completion_tokens  = excluded.max_completion_tokens,
         prompt_usd             = excluded.prompt_usd,
         completion_usd         = excluded.completion_usd,
         cache_read_usd         = excluded.cache_read_usd,
         cache_write_usd        = excluded.cache_write_usd,
         internal_reasoning_usd = excluded.internal_reasoning_usd,
         supported_parameters   = excluded.supported_parameters,
         is_available           = true,
         fetched_at             = v_run;
  get diagnostics v_upserted = row_count;

  update public.model_pricing
     set is_available = false
   where is_available and fetched_at < v_run;
  get diagnostics v_unavailable = row_count;

  with gone as (
    update public.ai_models m
       set enabled = false, is_default = false
     where m.enabled
       and not exists (
         select 1 from public.model_pricing p
          where p.model_id = m.model_id and p.is_available and 'tools' = any(p.supported_parameters))
    returning m.model_id)
  select coalesce(array_agg(model_id), '{}') into v_disabled from gone;

  select coalesce(array_agg(r.role_id), '{}') into v_orphans
    from public.ai_roles r
    join public.ai_models m on m.model_id = r.model_id
   where not m.enabled;

  return jsonb_build_object(
    'upserted',        v_upserted,
    'unavailable',     v_unavailable,
    'disabled_models', to_jsonb(v_disabled),
    'orphan_roles',    to_jsonb(v_orphans),
    'run_at',          v_run);
end;
$$;

-- Supabase's default privileges grant execute on new public functions to
-- anon and authenticated; revoking from PUBLIC alone leaves those in place.
revoke all on function public.model_pricing_reconcile(jsonb) from public, anon, authenticated;
grant execute on function public.model_pricing_reconcile(jsonb) to service_role;

-- Same tightening for the health probe (0006): signed-in users only.
revoke execute on function public.ai_health() from anon;

-- Every twelve hours (Decision 9). Idempotent: an existing job of this name is replaced.
select cron.unschedule(jobid) from cron.job where jobname = 'refresh-model-pricing';
select cron.schedule(
  'refresh-model-pricing',
  '0 */12 * * *',
  $cron$
    select net.http_post(
      url     := 'https://vfgcppstyzjarlzyqdac.supabase.co/functions/v1/refresh-model-pricing',
      headers := jsonb_build_object(
                   'content-type',     'application/json',
                   'x-refresh-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_secret')),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000);
  $cron$);
