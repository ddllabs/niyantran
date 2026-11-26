// web-text: wiring. The pure entry point is handler.ts; this module binds WebTextDb to supabase-js with the service client
// and the scrape to Firecrawl's key (F369, docs/specs/2026-11-23-regulatory-web-text-firecrawl.md).
//
// Environment (read here only, never logged): WEB_TEXT_SECRET, FIRECRAWL_API_KEY, WEB_TEXT_CLAIM_LIMIT (optional, 1 to 5,
// default 2: the Firecrawl plan's concurrent browsers), SUPABASE_URL (and the secret key through _shared/supabase.ts).
// Function secrets are set by the developer; none is on the operator's laptop.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { log } from '../_shared/logging.ts';
import { serviceClient } from '../_shared/supabase.ts';
import {
  type Claimed,
  claimLimitOf,
  firecrawlScrape,
  handleWebText,
  type WebTextDb,
  type WorkDeps,
} from './handler.ts';

type Env = (name: string) => string | undefined;

/** WebTextDb over PostgREST with the service client (the handler checked the secret). */
export function supabaseWebTextDb(client: SupabaseClient): WebTextDb {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    // The message is not passed on: the handler logs codes only.
    if (error) throw new Error(`${name} failed`);
    return data as T;
  }
  return {
    async claim(limit, leaseSeconds) {
      const got = await rpc<{ claimed?: Claimed[]; refused?: string | null }>('web_text_claim', {
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      return { claimed: got?.claimed ?? [], refused: got?.refused ?? null };
    },
    async finish(id, token, result) {
      const got = await rpc<{ outcome?: string }>('web_text_finish', { p_id: id, p_token: token, p_result: result });
      return got?.outcome ?? 'unknown';
    },
    async fail(id, token, code, uncertain, permanent) {
      const got = await rpc<{ outcome?: string }>('web_text_fail', {
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
  const apiKey = env('FIRECRAWL_API_KEY') ?? '';
  // Without the key no request is claimed: a claim would use up an attempt for a configuration fault.
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set');
  return {
    db: supabaseWebTextDb(client),
    scrape: firecrawlScrape(fetch, apiKey),
    claimLimit: claimLimitOf(env('WEB_TEXT_CLAIM_LIMIT')),
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
    handleWebText(req, {
      secret: env('WEB_TEXT_SECRET') ?? '',
      waitUntil,
      work: () => buildWorkDeps(serviceClient(), env),
      log: (event, fields) => log(event, fields),
    })
  );
}
