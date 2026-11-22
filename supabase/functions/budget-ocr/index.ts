// budget-ocr: wiring. The pure entry point is handler.ts; this module binds BudgetOcrDb to supabase-js with the service
// client and the OCR call to Mistral's key (F391, docs/specs/2026-11-21-budget-ocr-text.md).
//
// Environment (read here only, never logged): BUDGET_OCR_SECRET, MISTRAL_API_KEY, SUPABASE_URL (and the secret key
// through _shared/supabase.ts). Function secrets are set by the developer; none is on the operator's laptop.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { log } from '../_shared/logging.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { type BudgetOcrDb, type Claimed, handleBudgetOcr, mistralOcr, type WorkDeps } from './handler.ts';

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
  // Without the key no request is claimed: a claim would use up an attempt for a configuration fault.
  if (!mistralKey) throw new Error('MISTRAL_API_KEY is not set');
  return {
    db: supabaseBudgetOcrDb(client),
    ocr: mistralOcr(fetch, mistralKey),
    log: (event, fields) => log(event, fields),
    secrets: [mistralKey, env('BUDGET_OCR_SECRET') ?? ''].filter(Boolean),
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
      log: (event, fields) => log(event, fields),
    })
  );
}
