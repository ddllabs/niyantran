import { serviceClient } from '../_shared/supabase.ts';
import { handleRefresh, type PricingRow, type ReconcileResult } from './handler.ts';

const CATALOGUE_URL = 'https://openrouter.ai/api/v1/models';

async function fetchCatalogue(): Promise<unknown> {
  const res = await fetch(CATALOGUE_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`OpenRouter catalogue: HTTP ${res.status}`);
  return await res.json();
}

async function reconcile(rows: PricingRow[]): Promise<ReconcileResult> {
  const { data, error } = await serviceClient().rpc('model_pricing_reconcile', { p_rows: rows });
  if (error) throw new Error(`model_pricing_reconcile: ${error.message}`);
  return data as ReconcileResult;
}

Deno.serve((req) =>
  handleRefresh(req, {
    fetchCatalogue,
    reconcile,
    secrets: {
      refreshSecret: Deno.env.get('REFRESH_SECRET') || undefined,
      serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || undefined,
    },
  })
);
