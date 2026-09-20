// Two clients. userClient carries the caller's JWT so RLS applies; serviceClient
// bypasses RLS and is used only after the function has done its own checks.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function userClient(token: string): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

let service: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (!service) {
    service = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return service;
}
