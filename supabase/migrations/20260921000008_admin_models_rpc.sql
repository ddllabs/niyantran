-- 0008: the one write path to the allowlist, used by the admin-models function.
-- Spec: docs/specs/2026-09-20-ai-backend-foundation-design.md §C (Decision 10).
-- Plan: docs/plans/2026-09-21-ai-backend-foundation.md Task 7.
--
-- A partial row is merged over the existing row, so a toggle sends only the
-- field it changes. Making a model the default clears the previous default
-- in the same transaction (the partial unique index allows exactly one).
-- The guard triggers from 0005 still run, so their refusals surface as
-- errors, which admin-models returns as 400 with the trigger's message.
--
-- Down (manual):
--   drop function if exists public.admin_models_upsert(text, jsonb);

create or replace function public.admin_models_upsert(p_kind text, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing jsonb;
  v_merged   jsonb;
  v_out      jsonb;
begin
  if jsonb_typeof(p_row) <> 'object' then
    raise exception 'row must be a JSON object';
  end if;

  if p_kind = 'model' then
    if coalesce(p_row->>'model_id', '') = '' then
      raise exception 'model_id is required';
    end if;
    select to_jsonb(m) into v_existing from public.ai_models m where m.model_id = p_row->>'model_id';
    v_merged := coalesce(v_existing, '{}'::jsonb) || p_row;

    if coalesce((v_merged->>'is_default')::boolean, false) then
      update public.ai_models set is_default = false
       where is_default and model_id <> (v_merged->>'model_id');
    end if;

    insert into public.ai_models as m (model_id, label, vendor, tier, efforts, params, enabled, is_default, sort_order)
    select r.model_id,
           coalesce(r.label, r.model_id),
           coalesce(r.vendor, ''),
           coalesce(r.tier, 2),
           coalesce(r.efforts, '{}'),
           coalesce(r.params, '{}'::jsonb),
           coalesce(r.enabled, false),
           coalesce(r.is_default, false),
           coalesce(r.sort_order, 100)
      from jsonb_to_record(v_merged) as r(
             model_id text, label text, vendor text, tier smallint, efforts text[], params jsonb,
             enabled boolean, is_default boolean, sort_order int)
    on conflict (model_id) do update
       set label = excluded.label, vendor = excluded.vendor, tier = excluded.tier, efforts = excluded.efforts,
           params = excluded.params, enabled = excluded.enabled, is_default = excluded.is_default, sort_order = excluded.sort_order
    returning to_jsonb(m) into v_out;

  elsif p_kind = 'role' then
    if coalesce(p_row->>'role_id', '') = '' then
      raise exception 'role_id is required';
    end if;
    select to_jsonb(r) into v_existing from public.ai_roles r where r.role_id = p_row->>'role_id';
    v_merged := coalesce(v_existing, '{}'::jsonb) || p_row;

    insert into public.ai_roles as r (role_id, label, hint, model_id, sort_order)
    select x.role_id, coalesce(x.label, x.role_id), coalesce(x.hint, ''), x.model_id, coalesce(x.sort_order, 100)
      from jsonb_to_record(v_merged) as x(role_id text, label text, hint text, model_id text, sort_order int)
    on conflict (role_id) do update
       set label = excluded.label, hint = excluded.hint, model_id = excluded.model_id, sort_order = excluded.sort_order
    returning to_jsonb(r) into v_out;

  else
    raise exception 'kind must be model or role';
  end if;

  return v_out;
end;
$$;

revoke all on function public.admin_models_upsert(text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_models_upsert(text, jsonb) to service_role;
