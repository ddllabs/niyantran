// The model allowlist, read from the database. The server is the authority
// (ADR 0002, amended): a request naming a model that is not an enabled row
// is refused by the caller of resolveModel. Cached briefly per isolate so a
// toggle in the admin page takes effect within a minute.

export interface AiModel {
  model_id: string;
  label: string;
  vendor: string;
  tier: number;
  efforts: string[];
  params: Record<string, unknown>;
  is_default: boolean;
  sort_order: number;
}

export interface AiRole {
  role_id: string;
  label: string;
  hint: string;
  model_id: string;
  sort_order: number;
}

export interface Registry {
  models: AiModel[];
  roles: AiRole[];
  loaded_at: number;
}

/** The slice of a Supabase client the loader needs; a test passes a fake. */
export interface RegistryClient {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

export interface LoadOptions {
  client?: RegistryClient;
  now?: () => number;
  ttlMs?: number;
}

export const REGISTRY_TTL_MS = 60_000;

let cache: Registry | null = null;

export function invalidateRegistry(): void {
  cache = null;
}

async function defaultClient(): Promise<RegistryClient> {
  const { serviceClient } = await import('./supabase.ts');
  return serviceClient();
}

export async function loadRegistry(opts: LoadOptions = {}): Promise<Registry> {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? REGISTRY_TTL_MS;
  if (cache && now() - cache.loaded_at < ttl) return cache;

  const client = opts.client ?? (await defaultClient());
  const [models, roles] = await Promise.all([
    client.from('ai_models').select('model_id,label,vendor,tier,efforts,params,is_default,sort_order').eq('enabled', true).order('sort_order', { ascending: true }),
    client.from('ai_roles').select('role_id,label,hint,model_id,sort_order').order('sort_order', { ascending: true }),
  ]);
  if (models.error) throw new Error(`ai_models: ${models.error.message}`);
  if (roles.error) throw new Error(`ai_roles: ${roles.error.message}`);

  cache = { models: (models.data ?? []) as AiModel[], roles: (roles.data ?? []) as AiRole[], loaded_at: now() };
  return cache;
}

export async function resolveModel(id: string, opts: LoadOptions = {}): Promise<AiModel | null> {
  const { models } = await loadRegistry(opts);
  return models.find((m) => m.model_id === id) ?? null;
}

export async function defaultModel(opts: LoadOptions = {}): Promise<AiModel | null> {
  const { models } = await loadRegistry(opts);
  return models.find((m) => m.is_default) ?? null;
}
