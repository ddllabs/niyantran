// The v7 entry fingerprint — the Deno mirror of src/lib/entryFingerprint.js
// (and server/deskBrief.mjs `entryFingerprint`). All three assert the shared
// fixture src/lib/__fixtures__/entryFingerprint.json, so they cannot drift.

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, 220);
}

/** SHA-256 over the tier, module, id slot and sorted key=value pairs; 24 hex characters. */
export async function entryFingerprint(row: unknown, feature: string, tier: string): Promise<string> {
  const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  const parts = Object.keys(r)
    .filter((k) => !/^__|backup_/i.test(k))
    .sort()
    .map((k) => `${k}=${cell(r[k])}`);
  const id = r.record_id || r.id || r.source_url || r.title || '';
  const raw = `v7-entry::entry::${tier || ''}::${feature || ''}::${id}::${parts.join('|')}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
