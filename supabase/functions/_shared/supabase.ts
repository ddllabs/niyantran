// Two clients. userClient carries the caller's JWT so RLS applies; serviceClient
// bypasses RLS and is used only after the function has done its own checks.
//
// Keys: the platform injects SUPABASE_PUBLISHABLE_KEYS and SUPABASE_SECRET_KEYS
// as JSON objects keyed by key name ('default'). The legacy SUPABASE_ANON_KEY
// and SUPABASE_SERVICE_ROLE_KEY are read only as a fallback; this project's
// legacy keys were disabled on 2026-09-21 after a service_role JWT leaked.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** Read a named key from a JSON-object env var, or null when absent or unparsable. */
export function namedKey(raw: string | undefined, name = 'default'): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const v = parsed?.[name];
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

export function publishableKey(): string {
  const k = namedKey(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')) ?? Deno.env.get('SUPABASE_ANON_KEY');
  if (!k) throw new Error('no publishable key: SUPABASE_PUBLISHABLE_KEYS (or SUPABASE_ANON_KEY) is not set');
  return k;
}

export function secretKey(): string {
  const k = namedKey(Deno.env.get('SUPABASE_SECRET_KEYS')) ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!k) throw new Error('no secret key: SUPABASE_SECRET_KEYS (or SUPABASE_SERVICE_ROLE_KEY) is not set');
  return k;
}

export function userClient(token: string): SupabaseClient {
  return createClient(env('SUPABASE_URL'), publishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

let service: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (!service) {
    service = createClient(env('SUPABASE_URL'), secretKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return service;
}
