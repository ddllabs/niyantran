import { classifyApis } from './apiStatus.js';
import { fetchFeature } from './featureFeed.js';
import { hasRealRows } from './archiveFeed.js';
import { isStoreAnswer } from './plainSourceNote.js';
import {
  getAbort,
  loadProbes,
  saveProbe,
  saveProbes,
  saveRefreshCfg,
  setAbort,
  setProgress,
  refreshProgress,
} from './refreshStore.js';

const CONCURRENCY = 3;

const STORED_ADAPTERS = new Set(['embedded', 'register', 'source-library']);

/**
 * F169 T10: what one check of a module found, the same verdict the production probe uses
 * (scripts/module-probe.mjs): rows from the source, rows from storage, or nothing.
 */
export function checkOutcome(body) {
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const real = hasRealRows(body);
  const n = real ? rows.filter((r) => r?.status !== 'source_status').length : 0;
  const note = String(body?.source?.note || body?.error || '');
  if (!real) return { ok: false, fallback: false, rows: 0, status: 'inactive', error: note || 'No rows showing.' };
  // F169 C4: an answer from the scheduled feed store is fresh, served data, whatever adapter the live answer had.
  const stored = !isStoreAnswer(body) && (body?.served === 'archive' || Boolean(body?.fallback) || STORED_ADAPTERS.has(String(body?.source?.adapter || '')));
  return stored
    ? { ok: true, fallback: true, rows: n, status: 'archive', error: null }
    : { ok: true, fallback: false, rows: n, status: 'live', error: null };
}

export async function probeOne(row, signal) {
  try {
    const body = await fetchFeature({ tier: row.htmlTier, feature: row.feature, signal });
    return checkOutcome(body);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { ok: false, fallback: false, rows: 0, status: 'inactive', error: err.message || String(err) };
  }
}

async function runPool(items, signal, onEach) {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const idx = i;
      i += 1;
      const item = items[idx];
      const result = await probeOne(item, signal);
      onEach(item, result, idx);
    }
  }
  const n = Math.min(CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
}

export function decorateApis(classified = classifyApis()) {
  const probes = loadProbes();
  const prog = refreshProgress();
  const labels = { live: 'Live', archive: 'Stored', local: 'Local pack', inactive: 'Inactive', unchecked: 'Not checked' };
  return classified.map((r) => {
    // F169 T10: the last check's verdict, as it was; nothing is promoted or demoted.
    const p = probes[r.key];
    const status = p?.status || 'unchecked';
    return {
      ...r,
      status,
      statusLabel: labels[status] || 'Inactive',
      lastAt: p?.at || 0,
      lastRows: p?.rows,
      lastError: p?.error || '',
      lastFallback: Boolean(p?.fallback),
      probing: prog.running && prog.current === r.key,
    };
  });
}

export function liveRows(classified = decorateApis(classifyApis())) {
  return classified.filter((r) => r.status === 'live' || r.status === 'unchecked');
}

export async function sweepApis({ scope = 'live' } = {}) {
  if (refreshProgress().running) return { ok: false, reason: 'A sweep is already running.' };
  const all = decorateApis(classifyApis());
  // "live" re-checks what was live or never checked; "all" re-checks everything.
  const items = scope === 'all' ? all : liveRows(all);
  const ac = new AbortController();
  setAbort(ac);
  setProgress({ running: true, scope, done: 0, total: items.length, current: items[0]?.key || '' });
  const patch = {};
  try {
    await runPool(items, ac.signal, (row, result) => {
      patch[row.key] = { ...result, at: Date.now() };
      saveProbe(row.key, patch[row.key]);
      const done = Object.keys(patch).length;
      setProgress({ done, current: row.key });
    });
    saveProbes(patch);
    if (scope === 'all') saveRefreshCfg({ lastFullSweep: Date.now(), lastLiveSweep: Date.now() });
    else saveRefreshCfg({ lastLiveSweep: Date.now() });
    return { ok: true, count: items.length };
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, reason: 'Sweep cancelled.' };
    return { ok: false, reason: err.message || String(err) };
  } finally {
    setAbort(null);
    setProgress({ running: false, current: '', done: 0, total: 0, scope: '' });
  }
}

export async function refreshOne(row) {
  const result = await probeOne(row);
  saveProbe(row.key, { ...result, at: Date.now() });
  return result;
}

export function cancelSweep() {
  getAbort()?.abort();
}
