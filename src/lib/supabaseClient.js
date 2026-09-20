import { createClient } from '@supabase/supabase-js';

/**
 * One browser client for the whole app. Both values are public by design:
 * the publishable key is protected by row-level security. The env values
 * win; the fallbacks keep the client working in builds without a .env.
 * (Merged 2026-09-21 from the developer's auth branch and the AI backend
 * foundation: their client, plus the two helpers the admin page uses.)
 */
const SUPABASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
  'https://vfgcppstyzjarlzyqdac.supabase.co';

const SUPABASE_ANON_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  'sb_publishable_9X9OJnXkf-UuJcVvsY13nA_J_7oJ_-I';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: typeof window !== 'undefined',
    autoRefreshToken: true,
  },
});

/** The current session's JWT, or null when signed out. */
export async function accessToken(client = supabase) {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data?.session?.access_token ?? null;
}

/** Base URL for an edge function, without a trailing slash. */
export function functionsUrl(name) {
  return `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${name}`;
}
