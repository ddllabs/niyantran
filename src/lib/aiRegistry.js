import { supabase as defaultClient } from './supabaseClient.js';

/**
 * The model allowlist as the browser sees it (foundation spec §C): enabled
 * models, Niyantran's roles, and pricing for cost hints, read under RLS.
 * There is no generated mirror; the database is the only source.
 */

const EVENT = 'niy-ai-registry';

const bySortOrder = (a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || String(a.model_id || a.role_id).localeCompare(String(b.model_id || b.role_id));

export async function loadRegistry(client = defaultClient) {
  if (!client) throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  const [models, roles, pricing] = await Promise.all([
    client.from('ai_models').select('model_id,label,vendor,tier,efforts,params,is_default,sort_order').eq('enabled', true),
    client.from('ai_roles').select('role_id,label,hint,model_id,sort_order'),
    client.from('model_pricing').select('model_id,prompt_usd,completion_usd,context_length,max_completion_tokens,supported_parameters').eq('is_available', true),
  ]);
  for (const r of [models, roles, pricing]) if (r.error) throw new Error(r.error.message);
  const pricingById = {};
  for (const p of pricing.data || []) pricingById[p.model_id] = p;
  return {
    models: [...(models.data || [])].sort(bySortOrder),
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
