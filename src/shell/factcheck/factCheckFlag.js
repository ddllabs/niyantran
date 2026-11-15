// F344 T6: should this account be shown the Fact-check button?
//
// Reads the public app_flags row `livetv_factcheck`. The server applies the same rules again when a
// session starts (supabase private.factcheck_flag); this only decides what to show, so every doubt
// (no row, a malformed value, a read error, signed out) means off.
import { supabase } from '../../lib/supabaseClient.js';

const KEY = 'livetv_factcheck';
const MAX_PRICE = 5000;
const CACHE_MS = 60000;

/** The flag's value as { audience, creditsPerMinute }, or null when the feature is off. */
export function parseFactCheckFlag(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.enabled !== true) return null;
  if (value.audience !== 'admin' && value.audience !== 'all') return null;
  const price = value.credits_per_minute;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > MAX_PRICE) return null;
  return { audience: value.audience, creditsPerMinute: price };
}

const off = (userId = null) => ({ available: false, creditsPerMinute: null, userId });

let cache = null; // { userId, at, result }

export function clearFactCheckFlagCache() { cache = null; }

/**
 * { available, creditsPerMinute, userId } for the signed-in account. Read once and kept for a minute
 * per account; an answer is kept, a failed read never. `fresh` skips the kept answer (the price a
 * user is about to agree to must be current). Never rejects.
 */
export async function readFactCheckFlag({ client = supabase, now = Date.now, fresh = false } = {}) {
  let userId = null;
  try {
    const { data } = await client.auth.getSession();
    userId = data?.session?.user?.id ?? null;
    if (!userId) return off();
    if (!fresh && cache && cache.userId === userId && now() - cache.at < CACHE_MS) return cache.result;

    const row = await client.from('app_flags').select('value').eq('key', KEY).maybeSingle();
    if (row.error) return off(userId);
    const flag = parseFactCheckFlag(row.data?.value);
    let result = off(userId);
    if (flag) {
      let allowed = true;
      if (flag.audience === 'admin') {
        const admin = await client.rpc('is_platform_admin');
        if (admin.error) return off(userId);
        allowed = admin.data === true;
      }
      if (allowed) result = { available: true, creditsPerMinute: flag.creditsPerMinute, userId };
    }
    cache = { userId, at: now(), result };
    return result;
  } catch {
    return off(userId);
  }
}
