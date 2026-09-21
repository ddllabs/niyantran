/**
 * Client helpers for Gemini entry briefs (one selected table row).
 * Lookup: localStorage → server DB/disk cache → Gemini generate (only on miss).
 */

const STORE_KEY = 'niy-entry-brief-v7';

function cell(v) {
  if (v == null) return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, 220);
}

/** FNV fallback when Web Crypto is unavailable. */
export function entryFingerprintFnv(row, feature, tier) {
  const r = row && typeof row === 'object' ? row : {};
  const parts = Object.keys(r)
    .filter((k) => !/^__|backup_/i.test(k))
    .sort()
    .map((k) => `${k}=${cell(r[k])}`);
  const id = r.record_id || r.id || r.source_url || r.title || '';
  const raw = `v7-entry::entry::${tier || ''}::${feature || ''}::${id}::${parts.join('|')}`;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export async function entryFingerprintSha(row, feature, tier) {
  const r = row && typeof row === 'object' ? row : {};
  const parts = Object.keys(r)
    .filter((k) => !/^__|backup_/i.test(k))
    .sort()
    .map((k) => `${k}=${cell(r[k])}`);
  const id = r.record_id || r.id || r.source_url || r.title || '';
  const raw = `v7-entry::entry::${tier || ''}::${feature || ''}::${id}::${parts.join('|')}`;
  if (globalThis.crypto?.subtle) {
    const buf = new TextEncoder().encode(raw);
    const dig = await crypto.subtle.digest('SHA-256', buf);
    const hex = [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 24);
  }
  return entryFingerprintFnv(row, feature, tier);
}

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* quota */
  }
}

function storeKeyFor(feature, hash, scope) {
  return scope === 'substance' ? `${feature}::substance::${hash}` : `${feature}::${hash}`;
}

export function readLocalBrief(feature, hash, scope = 'entry') {
  if (!feature || !hash) return null;
  const store = loadStore();
  return store[storeKeyFor(feature, hash, scope)]?.brief || null;
}

export function writeLocalBrief(feature, hash, brief, scope = 'entry') {
  if (!feature || !hash || !brief) return;
  const store = loadStore();
  store[storeKeyFor(feature, hash, scope)] = { at: Date.now(), brief };
  const keys = Object.keys(store);
  if (keys.length > 80) {
    keys
      .map((k) => ({ k, at: store[k]?.at || 0 }))
      .sort((a, b) => a.at - b.at)
      .slice(0, keys.length - 80)
      .forEach(({ k }) => delete store[k]);
  }
  saveStore(store);
}

function slimEntry(row) {
  const o = {};
  let n = 0;
  for (const [k, v] of Object.entries(row || {})) {
    if (/^__|backup_/i.test(k)) continue;
    o[k] = cell(v);
    n += 1;
    if (n >= 40) break;
  }
  return o;
}

/**
 * Cache-only lookup (localStorage + server GET). Never calls Gemini.
 * Returns null on miss.
 */
export async function peekDeskBrief({
  feature,
  tier,
  row,
  signal,
  scope = 'entry',
} = {}) {
  if (!row || row.status === 'source_status') return null;
  if (!feature) return null;
  const hash = await entryFingerprintSha(row, feature, tier);
  const briefScope = scope === 'substance' ? 'substance' : 'entry';

  const local = readLocalBrief(feature, hash, briefScope);
  if (local?.headline || local?.summary?.length) {
    return { ...local, cached: true, hash };
  }

  try {
    const q = new URLSearchParams({
      feature,
      tier: tier || '',
      hash,
      scope: briefScope,
    });
    const res = await fetch(`/api/ai/desk-brief?${q}`, { signal });
    if (res.ok) {
      const body = await res.json();
      if (body?.ok && (body.headline || body.summary?.length)) {
        writeLocalBrief(feature, hash, body, briefScope);
        return { ...body, cached: true, hash };
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
  }
  return null;
}

/**
 * Resolve an entry brief for the selected row.
 * local → server DB → Gemini generate (only when cache misses or force).
 */
export async function ensureDeskBrief({
  feature,
  tier,
  row,
  sourceNote,
  sourceExtract,
  force = false,
  signal,
  scope = 'entry',
} = {}) {
  if (!row || row.status === 'source_status') {
    throw new Error('Select a row to organise');
  }
  const hash = await entryFingerprintSha(row, feature, tier);
  const briefScope = scope === 'substance' ? 'substance' : 'entry';

  if (!force) {
    const hit = await peekDeskBrief({ feature, tier, row, signal, scope: briefScope });
    if (hit) return hit;
  }

  const res = await fetch('/api/ai/desk-brief', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      feature,
      tier,
      hash,
      scope: briefScope,
      force: Boolean(force),
      sourceNote: sourceNote || '',
      sourceExtract: String(sourceExtract || '').slice(0, 12_000),
      row: slimEntry(row),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.ok) {
    if (res.status === 404) {
      throw new Error(
        'Desk brief API is not deployed on this host. After a Vercel rebuild, set GEMINI_API_KEY in the project environment.',
      );
    }
    throw new Error(body?.error || `desk-brief HTTP ${res.status}`);
  }
  writeLocalBrief(feature, hash, body, briefScope);
  return { ...body, hash };
}
