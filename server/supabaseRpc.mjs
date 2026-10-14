/**
 * F169 phase 4: the feed store's database client, PostgREST RPC with the server-side secret key.
 * Shared by the store writer (feedStore.mjs, C3) and the page server (feedServe.mjs, C4). It imports
 * nothing from the loaders, so neither of them has to import the other (feedStore.mjs imports the
 * loaders, and the loaders' route now asks feedServe.mjs for stored pages).
 */

export function cutChars(value, n) {
  const s = String(value ?? '');
  if (s.length <= n) return s;
  return Array.from(s).slice(0, n).join('');
}

/** Query strings can carry keys: a reason never shows one. */
export function safeText(value, n = 300) {
  return cutChars(String(value ?? '').replace(/(https?:\/\/[^\s?#'"]+)[?#][^\s'"]*/gi, '$1?…').replace(/\s+/g, ' ').trim(), n);
}

/**
 * rpc(name, args) against `${SUPABASE_URL}/rest/v1/rpc/<name>` with SUPABASE_SECRET_KEY (an
 * sb_secret_… value, server-side only). An error carries the database's code (22023 for a refused
 * input); its message never includes the key.
 */
export function supabaseRpc({
  url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  key = process.env.SUPABASE_SECRET_KEY || '',
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = 10_000,
} = {}) {
  return async (name, args) => {
    if (!url || !key) {
      throw Object.assign(new Error('Supabase is not configured for the feed store'), { code: 'not_configured' });
    }
    const res = await fetchImpl(`${String(url).replace(/\/+$/, '')}/rest/v1/rpc/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(args ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const message = safeText(data?.message || `HTTP ${res.status}`).split(key).join('[key]');
      throw Object.assign(new Error(`${name}: ${message}`), { code: data?.code || `HTTP ${res.status}`, status: res.status });
    }
    return data;
  };
}
