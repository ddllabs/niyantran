import { supabase as defaultClient } from './supabaseClient.js';
import { normalizePlanId } from './publicPlans.js';
import { modelLabel, modelName } from './creditUsage.js';

/**
 * The model allowlist as the browser sees it (foundation spec §C): enabled
 * models, Niyantran's roles, and pricing for cost hints, read under RLS.
 * There is no generated mirror; the database is the only source.
 */

const EVENT = 'niy-ai-registry';

/**
 * F200: the picker shows each model's `label` as stored. A label that is only the model's id (on D3,
 * "gpt-luna-latest" for ~openai/gpt-luna-latest) reads as the model's name instead, as Plan & billing
 * names models (F184, modelLabel). The stored label is not changed; fixing it is a data change.
 */
export function readableModelLabel(model) {
  const label = String(model?.label ?? '').trim();
  const id = String(model?.model_id ?? '');
  const raw = !label || [id, id.replace(/^~+/, ''), modelName(id)].includes(label);
  return raw && id ? modelLabel(id) : label;
}

const bySortOrder = (a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || String(a.model_id || a.role_id).localeCompare(String(b.model_id || b.role_id));

export async function loadRegistry(client = defaultClient) {
  if (!client) throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  const [models, roles, pricing] = await Promise.all([
    client.from('ai_models').select('model_id,label,vendor,tier,efforts,params,is_default,sort_order,min_plan').eq('enabled', true),
    client.from('ai_roles').select('role_id,label,hint,model_id,sort_order'),
    client.from('model_pricing').select('model_id,prompt_usd,completion_usd,context_length,max_completion_tokens,supported_parameters').eq('is_available', true),
  ]);
  for (const r of [models, roles, pricing]) if (r.error) throw new Error(r.error.message);
  const pricingById = {};
  for (const p of pricing.data || []) pricingById[p.model_id] = p;
  return {
    models: (models.data || []).map((m) => ({ ...m, label: readableModelLabel(m) })).sort(bySortOrder),
    roles: [...(roles.data || [])].sort(bySortOrder),
    pricingById,
  };
}

/** Called after an admin save so open pickers in this tab refresh. */
export function notifyRegistryChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

export function subscribeRegistry(fn, client = defaultClient) {
  if (typeof window === 'undefined') return () => {};
  const on = () => {
    loadRegistry(client).then(fn).catch(() => {});
  };
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}

/**
 * Which models a plan may use (F150, owner decision): each ai_models row names the lowest plan allowed to
 * use it in `min_plan`. This only decides what the picker offers; research-chat enforces it, refusing a
 * model the plan does not allow with 403 model_requires_plan.
 */
const PLAN_RANK = { free: 0, plus: 1, pro: 2, max: 3 };

/** The model's lowest plan. A missing or unknown value reads as plus, so a new model is never free by accident. */
export function minPlanOf(model) {
  return Object.hasOwn(PLAN_RANK, model?.min_plan) ? model.min_plan : 'plus';
}

/** Whether a plan ('free' | 'plus' | 'pro' | 'max') may use the model. An unknown plan may use only free models. */
export function modelAvailable(model, plan) {
  return (PLAN_RANK[plan] ?? 0) >= PLAN_RANK[minPlanOf(model)];
}

/**
 * The plan in force for a server entitlement (entitlementStore): a lapsed, ended or unread plan is free.
 * A platform admin may use every model (owner 2026-10-15); research-chat checks admin itself.
 */
export function effectivePlan(entitlement, now = Date.now(), { admin = false } = {}) {
  if (admin) return 'max';
  if (!entitlement || entitlement.status !== 'active' || entitlement.lapsed === true) return 'free';
  const end = entitlement.periodEnd ? Date.parse(entitlement.periodEnd) : NaN;
  if (Number.isFinite(end) && end <= now) return 'free';
  return normalizePlanId(entitlement.plan);
}

/** The short label for a model the plan cannot use, or '' when no plan is needed. */
export function planNeededLabel(model) {
  const min = minPlanOf(model);
  return min === 'plus' ? 'Paid plans' : min === 'pro' ? 'Pro and Max' : min === 'max' ? 'Max' : '';
}

/** The same in a sentence fragment, for a screen reader. */
export function planNeededReason(model) {
  const min = minPlanOf(model);
  return min === 'plus' ? 'available on paid plans' : min === 'pro' ? 'available on Pro and Max plans' : min === 'max' ? 'available on the Max plan' : '';
}
