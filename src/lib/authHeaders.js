import { supabase } from './supabaseClient.js';

/** Bearer header for same-origin API routes that need a signed-in account. */
export async function authHeaders() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
