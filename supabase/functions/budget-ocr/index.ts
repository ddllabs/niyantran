// budget-ocr: wiring. The pure entry point is handler.ts; this module binds BudgetOcrDb to supabase-js with the service
// client, the OCR call to Mistral's key and the vision call to OpenRouter's (F391, F409,
// docs/specs/2026-11-21-budget-ocr-text.md).
//
// Environment (read here only, never logged): BUDGET_OCR_SECRET, MISTRAL_API_KEY, OPENROUTER_API_KEY (the cron mode's
// vision engine and the vision trial, trial.ts), SUPABASE_URL (and the secret key through _shared/supabase.ts). Function secrets are set by the developer; none is on the operator's laptop.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { log } from '../_shared/logging.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { type BudgetOcrDb, type Claimed, handleBudgetOcr, mistralOcr, type WorkDeps } from './handler.ts';
import type { TrialDeps, TrialRow } from './trial.ts';

type Env = (name: string) => string | undefined;

/** BudgetOcrDb over PostgREST with the service client (the handler checked the secret). */
export function supabaseBudgetOcrDb(client: SupabaseClient): BudgetOcrDb {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as T;
  }
  return {
    async claim(limit, leaseSeconds) {
      const got = await rpc<{ claimed?: Claimed[]; refused?: string | null }>('budget_ocr_claim', {
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      return { claimed: got?.claimed ?? [], refused: got?.refused ?? null };
    },
    async finish(id, token, pages, texts) {
      const got = await rpc<{ outcome?: string }>('budget_ocr_finish', {
        p_id: id,
        p_token: token,
        p_pages: pages,
        p_texts: texts,
      });
      return got?.outcome ?? 'unknown';
    },
    async fail(id, token, code, uncertain, permanent) {
      const got = await rpc<{ outcome?: string }>('budget_ocr_fail', {
        p_id: id,
        p_token: token,
        p_code: code,
        p_uncertain: uncertain,
        p_permanent: permanent,
      });
      return got?.outcome ?? 'unknown';
    },
  };
}

export function buildWorkDeps(client: SupabaseClient, env: Env): WorkDeps {
  const mistralKey = env('MISTRAL_API_KEY') ?? '';
  const openRouterKey = env('OPENROUTER_API_KEY') ?? '';
  // Without either key no request is claimed: a claim would use up an attempt for a configuration fault. Both engines are
  // in use (engine.ts: the vision model up to 4 pages, Mistral above), and one claim can hold one of each.
  if (!mistralKey) throw new Error('MISTRAL_API_KEY is not set');
  if (!openRouterKey) throw new Error('OPENROUTER_API_KEY is not set');
  return {
    db: supabaseBudgetOcrDb(client),
    ocr: mistralOcr(fetch, mistralKey),
    vision: { fetch, apiKey: openRouterKey },
    log: (event, fields) => log(event, fields),
    secrets: [mistralKey, openRouterKey, env('BUDGET_OCR_SECRET') ?? ''].filter(Boolean),
  };
}

/** The vision trial's dependencies: the read-only public.budget_ocr_read and nothing that writes. */
export function buildTrialDeps(client: SupabaseClient, env: Env): TrialDeps {
  const apiKey = env('OPENROUTER_API_KEY') ?? '';
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  return {
    async read(keys) {
      const { data, error } = await client.rpc('budget_ocr_read', { p_keys: keys });
      if (error) throw new Error(`budget_ocr_read: ${error.message}`);
      return Array.isArray(data) ? (data as TrialRow[]) : [];
    },
    fetch,
    apiKey,
    log: (event, fields) => log(event, fields),
  };
}

type EdgeRuntimeGlobal = { waitUntil(promise: Promise<unknown>): void };

/** EdgeRuntime.waitUntil in Supabase's runtime; elsewhere the (never-rejecting) work just runs. */
function waitUntil(work: Promise<unknown>): void {
  const edge = (globalThis as { EdgeRuntime?: EdgeRuntimeGlobal }).EdgeRuntime;
  if (edge?.waitUntil) edge.waitUntil(work);
}

// Guarded, so a test can import this module without serving.
if (import.meta.main) {
  const env: Env = (name) => Deno.env.get(name);
  Deno.serve((req) =>
    handleBudgetOcr(req, {
      secret: env('BUDGET_OCR_SECRET') ?? '',
      waitUntil,
      work: () => buildWorkDeps(serviceClient(), env),
      trial: () => buildTrialDeps(serviceClient(), env),
      log: (event, fields) => log(event, fields),
    })
  );
}
