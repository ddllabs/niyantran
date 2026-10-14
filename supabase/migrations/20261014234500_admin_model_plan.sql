-- The admin sets a model's plan (open-work F155; docs/specs/2026-10-14-ai-credits.md §6.1).
--
-- admin_models_upsert (20260921000008) is the one write path to the
-- allowlist, called only by the admin-models function with the service role.
-- It did not name ai_models.min_plan (added by 20261014230000), so an admin
-- could not change which plans may use a model. This replaces the function
-- with the same signature, settings and privileges, and one change for kind
-- 'model':
--
--   * min_plan in the row must be a JSON string naming an app_plan value
--     (free, plus, pro, max). Anything else, null included, is refused with
--     22023 "min_plan must be one of free, plus, pro, max".
--   * A new model without min_plan gets plus (the column's default): it needs
--     a paid plan until an admin says otherwise.
--   * An existing model without min_plan in the row keeps its stored plan:
--     the row is merged over the stored row, as every other field already is.
--
-- Kind 'role' is unchanged and ignores min_plan. No model's plan is changed
-- by this migration. CREATE OR REPLACE keeps the owner and ACL; the revoke
-- and grant are restated exactly as 0008 has them.
--
-- No BEGIN/COMMIT: the migration tool runs each file in one transaction.
--
-- Down (manual): put back 0008's function body. Plans set through the new
-- path stay in ai_models; 0008's function keeps a stored plan on update.
--   begin;
--   -- run the "create or replace function public.admin_models_upsert" statement
--   -- from 20260921000008_admin_models_rpc.sql, then its revoke and grant:
--   revoke all on function public.admin_models_upsert(text, jsonb) from public, anon, authenticated;
--   grant execute on function public.admin_models_upsert(text, jsonb) to service_role;
--   commit;

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
  v_plans    text[] := enum_range(null::public.app_plan)::text[];
begin
  if jsonb_typeof(p_row) <> 'object' then
    raise exception 'row must be a JSON object';
  end if;

  if p_kind = 'model' then
    if coalesce(p_row->>'model_id', '') = '' then
      raise exception 'model_id is required';
    end if;
    if p_row ? 'min_plan'
       and (jsonb_typeof(p_row->'min_plan') <> 'string' or not (p_row->>'min_plan' = any (v_plans))) then
      raise exception 'min_plan must be one of %', array_to_string(v_plans, ', ')
        using errcode = '22023';
    end if;
    select to_jsonb(m) into v_existing from public.ai_models m where m.model_id = p_row->>'model_id';
    v_merged := coalesce(v_existing, '{}'::jsonb) || p_row;

    if coalesce((v_merged->>'is_default')::boolean, false) then
      update public.ai_models set is_default = false
       where is_default and model_id <> (v_merged->>'model_id');
    end if;

    insert into public.ai_models as m (model_id, label, vendor, tier, efforts, params, enabled, is_default, sort_order, min_plan)
    select r.model_id,
           coalesce(r.label, r.model_id),
           coalesce(r.vendor, ''),
           coalesce(r.tier, 2),
           coalesce(r.efforts, '{}'),
           coalesce(r.params, '{}'::jsonb),
           coalesce(r.enabled, false),
           coalesce(r.is_default, false),
           coalesce(r.sort_order, 100),
           coalesce(r.min_plan, 'plus')
      from jsonb_to_record(v_merged) as r(
             model_id text, label text, vendor text, tier smallint, efforts text[], params jsonb,
             enabled boolean, is_default boolean, sort_order int, min_plan public.app_plan)
    on conflict (model_id) do update
       set label = excluded.label, vendor = excluded.vendor, tier = excluded.tier, efforts = excluded.efforts,
           params = excluded.params, enabled = excluded.enabled, is_default = excluded.is_default, sort_order = excluded.sort_order,
           min_plan = excluded.min_plan
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
