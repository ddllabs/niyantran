-- Reasoning efforts come from OpenRouter, not from a text box.
--
-- public.ai_models.efforts is hand-typed through the admin allowlist editor and
-- nothing has ever checked it. Measured against the live catalogue on
-- 2026-09-22, three of the seven enabled models were wrong:
--
--   deepseek/deepseek-v4-flash   offered low, medium, high - accepts xhigh, high
--   deepseek/deepseek-v4-pro     offered low, medium, high - accepts xhigh, high
--   google/gemini-2.5-flash-lite offered low, medium, high - publishes none
--
-- OpenRouter maps a requested effort to the nearest supported level, so on the
-- two DeepSeek rows Low, Medium and High were the same request at the same
-- price: three buttons, one outcome. On gemini-2.5-flash-lite all three did
-- nothing - its four logged calls returned reasoning_tokens 0. In the other
-- direction, claude-sonnet-5 and gpt-6-astra both accept `max` and `xhigh` and
-- neither was reachable.
--
-- The catalogue publishes the answer per model, in `reasoning`:
--   { mandatory, default_enabled, supported_efforts[], default_effort }
-- omitted entirely for non-reasoning models. `supported_parameters` cannot
-- answer this - it says whether the parameter is taken, not which rungs exist,
-- and 26 distinct vocabularies exist across the 444 catalogue entries.
--
-- refresh-model-pricing already fetches that payload every twelve hours and
-- already parses this object's siblings. This migration stores the three fields
-- it was dropping, and clamps ai_models.efforts to them on every run.
--
-- The clamp treats ai_models.efforts as the admin's *filter*, not as the truth:
--   empty     -> every rung the model publishes (the sensible default)
--   non-empty -> the intersection, so a rung the model rejects cannot be offered
-- An admin can still withhold an expensive rung; an admin can no longer invent
-- one. `off` is this codebase's sentinel for "send no reasoning block" and is
-- offered whenever the model does not mandate reasoning.

alter table public.model_pricing
  add column if not exists reasoning_efforts  text[] not null default '{}',
  add column if not exists reasoning_default  text,
  add column if not exists reasoning_required boolean not null default false;

comment on column public.model_pricing.reasoning_efforts is
  'OpenRouter reasoning.supported_efforts, cheapest first, with `none` folded onto `off`.';
comment on column public.model_pricing.reasoning_required is
  'OpenRouter reasoning.mandatory: reasoning cannot be turned off on this model.';

-- Cheapest first, and the only place this order is defined.
create or replace function public.effort_rank(p_effort text)
returns int
language sql
immutable
set search_path = ''
as $$
  select array_position(array['off','minimal','low','medium','high','xhigh','max'], p_effort)
$$;

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
  v_clamped      int;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  insert into public.model_pricing as p (
    model_id, context_length, max_completion_tokens, prompt_usd, completion_usd,
    cache_read_usd, cache_write_usd, internal_reasoning_usd, supported_parameters,
    reasoning_efforts, reasoning_default, reasoning_required, is_available, fetched_at
  )
  select r.model_id, r.context_length, r.max_completion_tokens, r.prompt_usd, r.completion_usd,
         r.cache_read_usd, r.cache_write_usd, r.internal_reasoning_usd, coalesce(r.supported_parameters, '{}'),
         coalesce(r.reasoning_efforts, '{}'), r.reasoning_default, coalesce(r.reasoning_required, false),
         true, v_run
    from jsonb_to_recordset(p_rows) as r(
           model_id text, context_length int, max_completion_tokens int, prompt_usd numeric, completion_usd numeric,
           cache_read_usd numeric, cache_write_usd numeric, internal_reasoning_usd numeric, supported_parameters text[],
           reasoning_efforts text[], reasoning_default text, reasoning_required boolean)
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
         reasoning_efforts      = excluded.reasoning_efforts,
         reasoning_default      = excluded.reasoning_default,
         reasoning_required     = excluded.reasoning_required,
         is_available           = true,
         fetched_at             = v_run;
  get diagnostics v_upserted = row_count;

  update public.model_pricing
     set is_available = false
   where is_available and fetched_at < v_run;
  get diagnostics v_unavailable = row_count;

  -- Clamp the allowlist to what the catalogue says each model accepts. Runs
  -- before the tool-support sweep below so a model about to be disabled is not
  -- also given a fresh effort list.
  with resolved as (
    select m.model_id,
           (select coalesce(array_agg(e order by public.effort_rank(e)), '{}')
              from (
                select unnest(p.reasoning_efforts) as e
                union
                select 'off'::text where not p.reasoning_required
              ) t
             where m.efforts = '{}'::text[] or t.e = any(m.efforts)) as efforts
      from public.ai_models m
      join public.model_pricing p on p.model_id = m.model_id and p.is_available
  )
  update public.ai_models m
     set efforts = r.efforts
    from resolved r
   where r.model_id = m.model_id and m.efforts is distinct from r.efforts;
  get diagnostics v_clamped = row_count;

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
    'clamped_efforts', v_clamped,
    'disabled_models', to_jsonb(v_disabled),
    'orphan_roles',    to_jsonb(v_orphans),
    'run_at',          v_run);
end;
$$;

revoke all on function public.model_pricing_reconcile(jsonb) from public, anon, authenticated;
grant execute on function public.model_pricing_reconcile(jsonb) to service_role;

-- The next scheduled run is up to twelve hours away and the wrong rungs are on
-- screen now, so seed the three columns for the enabled models from the values
-- read off the live catalogue on 2026-09-22, then let the clamp above correct
-- ai_models.efforts. The scheduled run overwrites all of this with whatever the
-- catalogue says then; this is a starting point, not a second source.
update public.model_pricing p set
  reasoning_efforts  = v.efforts,
  reasoning_default  = v.fallback,
  reasoning_required = v.required
from (values
  ('google/gemini-3.5-flash-lite', array['minimal','low','medium','high'], 'minimal', true),
  ('google/gemini-3.7-flash',      array['low','medium','high'],           'medium',  true),
  ('deepseek/deepseek-v4-flash',   array['high','xhigh'],                  'high',    false),
  ('deepseek/deepseek-v4-pro',     array['high','xhigh'],                  'high',    false),
  ('openai/gpt-6-astra',           array['low','medium','high','xhigh','max'], 'medium', true),
  ('anthropic/claude-sonnet-5',    array['low','medium','high','xhigh','max'], 'high',   false),
  ('google/gemini-2.5-flash-lite', array[]::text[],                        null,      false)
) as v(model_id, efforts, fallback, required)
where p.model_id = v.model_id;

-- Clear the existing lists first. Every enabled row currently reads exactly
-- `{low,medium,high}`, which is the seed default rather than a decision anyone
-- made - treating it as an admin filter would intersect DeepSeek down to a
-- single rung and drop the `xhigh` it actually accepts. From here on an edit in
-- the allowlist editor is real intent and the filter semantics apply.
update public.ai_models set efforts = '{}'::text[];

-- Apply the clamp once now, with the same rule the RPC uses.
with resolved as (
  select m.model_id,
         (select coalesce(array_agg(e order by public.effort_rank(e)), '{}')
            from (
              select unnest(p.reasoning_efforts) as e
              union
              select 'off'::text where not p.reasoning_required
            ) t
           where m.efforts = '{}'::text[] or t.e = any(m.efforts)) as efforts
    from public.ai_models m
    join public.model_pricing p on p.model_id = m.model_id and p.is_available
)
update public.ai_models m
   set efforts = r.efforts
  from resolved r
 where r.model_id = m.model_id and m.efforts is distinct from r.efforts;

-- Down (manual):
--   alter table public.model_pricing
--     drop column reasoning_efforts, drop column reasoning_default, drop column reasoning_required;
--   drop function public.effort_rank(text);
--   -- and restore model_pricing_reconcile from 20260921000007.
