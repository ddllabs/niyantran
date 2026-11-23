// The same Supabase project nter.pro uses: same accounts, same row-level security, same
// credits. Sessions persist in Capacitor Preferences on a phone.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { kv } from './storage.js';

const authStorage = {
  getItem: (k) => kv.get(k),
  setItem: (k, v) => kv.set(k, v),
  removeItem: (k) => kv.remove(k),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: authStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

export async function accessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}
