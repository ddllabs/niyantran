/**
 * The v7 entry fingerprint of one desk row: SHA-256 over the tier, the module, the row's id slot
 * and its sorted `key=value` pairs (values whitespace-collapsed and cut at 220 characters), as 24
 * hex characters. server/deskBrief.mjs `entryFingerprint` and the desk-brief Edge Function's
 * supabase/functions/_shared/entryFingerprint.ts compute the same value; all three assert
 * src/lib/__fixtures__/entryFingerprint.json, so they cannot drift.
 */

function cell(v) {
  if (v == null) return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, 220);
}

function source(row, feature, tier) {
  const r = row && typeof row === 'object' ? row : {};
  const parts = Object.keys(r)
    .filter((k) => !/^__|backup_/i.test(k))
    .sort()
    .map((k) => `${k}=${cell(r[k])}`);
  const id = r.record_id || r.id || r.source_url || r.title || '';
  return `v7-entry::entry::${tier || ''}::${feature || ''}::${id}::${parts.join('|')}`;
}

/** FNV fallback when Web Crypto is unavailable. */
export function entryFingerprintFnv(row, feature, tier) {
  const raw = source(row, feature, tier);
  let h = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export async function entryFingerprintSha(row, feature, tier) {
  const raw = source(row, feature, tier);
  if (globalThis.crypto?.subtle) {
    const dig = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  }
  return entryFingerprintFnv(row, feature, tier);
}
