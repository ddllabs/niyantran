// refresh-model-pricing: OpenRouter's catalogue → public.model_pricing, and
// the allowlist rows whose model left the catalogue are disabled in the same
// database transaction (model_pricing_reconcile). Never called by a browser:
// the caller presents the REFRESH_SECRET header (pg_cron via pg_net) or the
// service-role key as a bearer.

import { corsHeaders, preflight } from '../_shared/cors.ts';
import { errorResponse, HttpError, json } from '../_shared/http.ts';
import { log } from '../_shared/logging.ts';

export interface PricingRow {
  model_id: string;
  context_length: number | null;
  max_completion_tokens: number | null;
  prompt_usd: number | null;
  completion_usd: number | null;
  cache_read_usd: number | null;
  cache_write_usd: number | null;
  internal_reasoning_usd: number | null;
  supported_parameters: string[];
}

export interface ReconcileResult {
  upserted: number;
  unavailable: number;
  disabled_models: string[];
  orphan_roles: string[];
  run_at: string;
}

export interface Secrets {
  refreshSecret?: string;
  serviceKey?: string;
}

export interface RefreshDeps {
  fetchCatalogue: () => Promise<unknown>;
  reconcile: (rows: PricingRow[]) => Promise<ReconcileResult>;
  secrets: Secrets;
  origins?: string[];
  /** A catalogue smaller than this is treated as a bad fetch; nothing is marked unavailable. */
  minRows?: number;
}

/** OpenRouter listed 446 models on 2026-09-21; a fetch returning far fewer is a failure, not a shrink. */
export const MIN_CATALOGUE_ROWS = 100;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Field names verified against the live response on 2026-09-21:
 * id, context_length, pricing.{prompt, completion, input_cache_read, input_cache_write, internal_reasoning}
 * (strings, USD per token), top_provider.{context_length, max_completion_tokens}, supported_parameters[].
 * Entries without a string id are skipped; every other field is optional.
 */
export function mapCatalogue(payload: unknown): PricingRow[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new HttpError(502, 'catalogue payload has no data array');
  const rows: PricingRow[] = [];
  for (const raw of data) {
    const m = (raw ?? {}) as Record<string, unknown>;
    if (typeof m.id !== 'string' || !m.id) continue;
    const pricing = (m.pricing ?? {}) as Record<string, unknown>;
    const top = (m.top_provider ?? {}) as Record<string, unknown>;
    const params = Array.isArray(m.supported_parameters) ? m.supported_parameters.filter((s): s is string => typeof s === 'string') : [];
    rows.push({
      model_id: m.id,
      context_length: num(m.context_length) ?? num(top.context_length),
      max_completion_tokens: num(top.max_completion_tokens),
      prompt_usd: num(pricing.prompt),
      completion_usd: num(pricing.completion),
      cache_read_usd: num(pricing.input_cache_read),
      cache_write_usd: num(pricing.input_cache_write),
      internal_reasoning_usd: num(pricing.internal_reasoning),
      supported_parameters: params,
    });
  }
  return rows;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function authorised(req: Request, secrets: Secrets): boolean {
  const header = req.headers.get('x-refresh-secret');
  if (header && secrets.refreshSecret && timingSafeEqual(header, secrets.refreshSecret)) return true;
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]?.trim();
  if (bearer && secrets.serviceKey && timingSafeEqual(bearer, secrets.serviceKey)) return true;
  return false;
}

export async function handleRefresh(req: Request, deps: RefreshDeps): Promise<Response> {
  const pre = preflight(req, deps.origins);
  if (pre) return pre;
  const cors = corsHeaders(req, deps.origins);
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
    if (!authorised(req, deps.secrets)) throw new HttpError(401, 'refresh secret required');
    const rows = mapCatalogue(await deps.fetchCatalogue());
    const min = deps.minRows ?? MIN_CATALOGUE_ROWS;
    if (rows.length < min) throw new HttpError(502, `catalogue too small to trust: ${rows.length} rows (minimum ${min})`);
    const result = await deps.reconcile(rows);
    log('pricing.refreshed', { fetched: rows.length, ...result });
    return json({ fetched: rows.length, ...result }, 200, cors);
  } catch (err) {
    log('pricing.refresh_failed', { status: err instanceof HttpError ? err.status : 500, message: (err as Error).message });
    return errorResponse(err, cors);
  }
}
