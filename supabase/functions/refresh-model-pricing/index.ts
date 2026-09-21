import { namedKey, serviceClient } from '../_shared/supabase.ts';
import { handleRefresh, type PricingRow, type ReconcileResult, type RefreshDeps, type Secrets } from './handler.ts';

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

type ReadEnv = (name: string) => string | undefined;

export function refreshSecrets(readEnv: ReadEnv): Secrets {
  // Disabled legacy JWTs must never become application-level bearer secrets.
  const serviceKey = namedKey(readEnv('SUPABASE_SECRET_KEYS'));
  const refreshSecret = readEnv('REFRESH_SECRET');
  return {
    refreshSecret: refreshSecret?.trim() ? refreshSecret : undefined,
    serviceKey: serviceKey && /^sb_secret_\S+$/.test(serviceKey) ? serviceKey : undefined,
  };
}

/** Injected boundaries allow entry-point authorization tests without I/O. */
export function createRefreshHandler(
  readEnv: ReadEnv,
  deps: Pick<RefreshDeps, 'fetchCatalogue' | 'reconcile'> = { fetchCatalogue, reconcile },
): (req: Request) => Promise<Response> {
  return (req) => handleRefresh(req, { ...deps, secrets: refreshSecrets(readEnv) });
}

if (import.meta.main) Deno.serve(createRefreshHandler((name) => Deno.env.get(name)));
