/**
 * Client helpers for Gemini entry briefs (one selected table row).
 * Lookup: localStorage → server DB/disk cache → Gemini generate (only on miss).
 */

import { functionsUrl } from './supabaseClient.js';
import { verifiedLocalIdentity } from './userStore.js';
import { entryFingerprintSha } from './entryFingerprint.js';

export { entryFingerprintFnv, entryFingerprintSha } from './entryFingerprint.js';

const STORE_KEY = 'niy-entry-brief-v7';

function cell(v) {
  if (v == null) return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, 220);
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

  const payload = {
    feature,
    tier,
    hash,
    scope: briefScope,
    force: Boolean(force),
    sourceNote: sourceNote || '',
    sourceExtract: String(sourceExtract || '').slice(0, 12_000),
    row: slimEntry(row),
  };

  let body = null;
  const identity = await verifiedLocalIdentity().catch(() => null);
  const auth = identity?.token ? { Authorization: `Bearer ${identity.token}` } : {};
  try {
    if (identity?.token) {
      const edgeRes = await fetch(functionsUrl('desk-brief'), {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify(payload),
      });
      // Fall back only when the function is missing (404) or unreachable.
      // Any other answer is final: retrying through Vercel would call the same
      // function again and could pay for a failed brief twice.
      if (edgeRes.status !== 404) {
        const edgeBody = await edgeRes.json().catch(() => ({}));
        if (!edgeRes.ok || !edgeBody?.ok) {
          throw Object.assign(new Error(edgeBody?.error || 'AI research service is temporarily unavailable.'), { final: true });
        }
        body = edgeBody;
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError' || err?.final) throw err;
  }

  if (!body) {
    // The route forwards to the same function and refuses without a bearer.
    const res = await fetch('/api/ai/desk-brief', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify(payload),
    });
    body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.ok) {
      throw new Error(body?.error || 'AI research service is temporarily unavailable.');
    }
  }

  writeLocalBrief(feature, hash, body, briefScope);
  return { ...body, hash };
}

/** The desk-brief function's row bound (MAX_ROW_BYTES), less a margin. */
const RECORD_ROW_BYTES = 30_000;

/**
 * The row as sent for a record brief: whole when it fits, so the server keys it exactly as
 * desk_rows does; else the slimmed entry (40 fields, 220 characters each).
 */
function recordPayloadRow(row) {
  try {
    if (new TextEncoder().encode(JSON.stringify(row)).length <= RECORD_ROW_BYTES) return row;
  } catch {
    /* not serialisable as is */
  }
  return slimEntry(row);
}

/**
 * The stored AI brief for one record (F123). The desk-brief Edge Function (scope 'record') reads
 * it, or writes it once at the platform's cost when nobody has; the server derives the record's
 * key and hash from the row. Resolves to {state: 'ready', headline, points, model, writtenAt},
 * or {state} of 'pending' (another request is writing it), 'unavailable' (signed out, switched
 * off or limited), 'error' (failed or refused) or 'none' (nothing to brief). Rejects only on abort.
 */
export async function getRecordBrief({ tier, feature, row, signal } = {}) {
  if (!row || typeof row !== 'object' || row.status === 'source_status' || !feature) return { state: 'none' };
  const identity = await verifiedLocalIdentity().catch(() => null);
  if (!identity?.token) return { state: 'unavailable' };
  let res;
  try {
    res = await fetch(functionsUrl('desk-brief'), {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.token}` },
      body: JSON.stringify({ scope: 'record', tier: tier || '', feature, row: recordPayloadRow(row) }),
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { state: 'error' };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.ok) return { state: 'error' };
  if (body.state === 'ready') {
    const points = Array.isArray(body.points) ? body.points.filter((p) => typeof p === 'string' && p.trim()) : [];
    if (typeof body.headline !== 'string' || !body.headline.trim() || !points.length) return { state: 'error' };
    return { state: 'ready', headline: body.headline, points, model: body.model || null, writtenAt: body.writtenAt || null };
  }
  if (body.state === 'pending' || body.state === 'unavailable') return { state: body.state };
  return { state: 'error' };
}

