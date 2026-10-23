// F154 (owner request 2026-10-14): a module page waited for /api/feature-feed before it looked at
// the shipped archive, so Cabinet Decisions spun about 8 s although its archive loads in 0.15 s.
// With onUpdate, fetchFeature shows the archive as soon as it is in, then swaps in live rows.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const archive = vi.hoisted(() => ({ fetch: null, signals: [] }));

vi.mock('./apiMode.js', () => ({ featureFeedApiEnabled: () => true, liveApiEnabled: () => true }));
vi.mock('./archiveFeed.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchArchiveFeature: vi.fn((opts) => {
    archive.signals.push(opts.signal);
    return archive.fetch(opts);
  }),
}));

import { fetchFeature, fetchFeaturePage } from './featureFeed.js';

const TIER = 'national';
const FEATURE = 'Cabinet Decisions';
const LIVE = { ok: true, feature: FEATURE, rows: [{ title: 'Live decision' }], source: { adapter: 'api', note: 'Live PIB' }, fallback: false };
const STORED = { ok: true, feature: FEATURE, rows: [{ title: 'Stored decision' }], source: { adapter: 'embedded', note: 'Stored Cabinet decisions.' }, fallback: false };

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('fetchFeature archive first (F154)', () => {
  const originalFetch = globalThis.fetch;
  let api;
  beforeEach(() => {
    api = deferred();
    archive.signals = [];
    globalThis.fetch = vi.fn(() => api.promise);
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('shows the archive within half a second when the API is slower, marked as refreshing', async () => {
    archive.fetch = async () => STORED;
    const onUpdate = vi.fn();
    const shown = await fetchFeature({ tier: TIER, feature: FEATURE, onUpdate });
    expect(shown.rows).toEqual(STORED.rows);
    expect(shown.fallback).toBe(true);
    expect(shown.refreshing).toBe(true);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('then swaps in the live rows when the API answers', async () => {
    archive.fetch = async () => STORED;
    const onUpdate = vi.fn();
    await fetchFeature({ tier: TIER, feature: FEATURE, onUpdate });
    api.resolve(response(LIVE));
    await tick();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const live = onUpdate.mock.calls[0][0];
    expect(live.rows).toEqual(LIVE.rows);
    expect(live.fallback).toBe(false);
    expect(live.refreshing).toBeFalsy();
    expect(live.updatedLive).toBe(true);
  });

  it('keeps the archive, no longer refreshing, when the API answers with nothing', async () => {
    archive.fetch = async () => STORED;
    const onUpdate = vi.fn();
    await fetchFeature({ tier: TIER, feature: FEATURE, onUpdate });
    api.resolve(response({ ok: false, error: 'upstream' }, 502));
    await tick();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const kept = onUpdate.mock.calls[0][0];
    expect(kept.rows).toEqual(STORED.rows);
    expect(kept.refreshing).toBe(false);
    expect(kept.fallback).toBe(true);
    expect(kept.updatedLive).toBeFalsy();
  });

  it('keeps the old behaviour when the API is quicker: live rows, no archive note', async () => {
    const slowArchive = deferred();
    archive.fetch = () => slowArchive.promise;
    api.resolve(response(LIVE));
    const onUpdate = vi.fn();
    const shown = await fetchFeature({ tier: TIER, feature: FEATURE, onUpdate });
    expect(shown).toEqual(LIVE);
    expect(archive.signals[0].aborted).toBe(true);
    slowArchive.resolve(STORED);
    await tick();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('keeps the old behaviour when the API answers within a moment, even if the archive was quicker', async () => {
    archive.fetch = async () => STORED;
    const onUpdate = vi.fn();
    setTimeout(() => api.resolve(response(LIVE)), 100);
    const shown = await fetchFeature({ tier: TIER, feature: FEATURE, onUpdate });
    expect(shown).toEqual(LIVE);
    await tick();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('waits for the API when the archive is quicker but empty', async () => {
    archive.fetch = async () => ({ ...STORED, rows: [] });
    const pending = fetchFeature({ tier: TIER, feature: FEATURE, onUpdate: vi.fn() });
    await tick();
    api.resolve(response(LIVE));
    expect(await pending).toEqual(LIVE);
  });

  it('a caller without onUpdate still waits for the API first, as before', async () => {
    archive.fetch = async () => STORED;
    const pending = fetchFeature({ tier: TIER, feature: FEATURE });
    await tick();
    api.resolve(response(LIVE));
    expect(await pending).toEqual(LIVE);
  });

  it('sends no update after the page has moved on', async () => {
    archive.fetch = async () => STORED;
    const ac = new AbortController();
    const onUpdate = vi.fn();
    await fetchFeature({ tier: TIER, feature: FEATURE, signal: ac.signal, onUpdate });
    ac.abort();
    api.resolve(response(LIVE));
    await tick();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

// F156: Bills and Questions ask for one page instead of the whole register (0.9 MB and 0.6 MB as sent).
describe('fetchFeaturePage (F156)', () => {
  const originalFetch = globalThis.fetch;
  const BILLS = 'Bill Passage Probability Index';
  const PAGE = { ok: true, paged: true, prepared: true, feature: BILLS, rows: [{ bill_name: 'A bill' }], total: 1, totalAll: 9819 };
  beforeEach(() => {
    archive.fetch = vi.fn(async () => STORED);
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('asks for one page with its view in the fixed URL form, and never for the shipped register', async () => {
    globalThis.fetch = vi.fn(async () => response(PAGE));
    const body = await fetchFeaturePage({ tier: TIER, feature: BILLS, page: 2, q: ' Finance ', sort: 'house', dir: 'desc', filter: [{ col: 'sector', value: 'FINANCE' }] });
    expect(body).toEqual(PAGE);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][0]).toBe(
      `/api/feature-feed?tier=national&feature=Bill+Passage+Probability+Index&page=2&q=finance&sort=house&dir=desc&filter=${encodeURIComponent('[{"col":"sector","value":"FINANCE"}]')}`,
    );
    expect(archive.fetch).not.toHaveBeenCalled();
  });

  it('is null, so the desk loads the whole module as before, when the API fails or answers whole', async () => {
    for (const answer of [response({ ok: false, error: 'Bad parameter: q' }, 400), response(STORED), response(null, 502)]) {
      globalThis.fetch = vi.fn(async () => answer);
      expect(await fetchFeaturePage({ tier: TIER, feature: BILLS, page: 1 })).toBeNull();
    }
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await fetchFeaturePage({ tier: TIER, feature: BILLS, page: 1 })).toBeNull();
  });

  it('asks nothing for a module that is not paged', async () => {
    globalThis.fetch = vi.fn();
    expect(await fetchFeaturePage({ tier: TIER, feature: FEATURE, page: 1 })).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// F159: an answer the server gave from stored records while live data loads (`served: 'archive'`)
// is not a live update, and keeps saying so, so that the page asks again (moduleLiveRetry.js).
describe('stored answers while live data loads (F159)', () => {
  const originalFetch = globalThis.fetch;
  const SERVED_STORED = { ...STORED, rows: [{ title: 'Server stored decision' }], fallback: true, served: 'archive', source: { adapter: 'embedded', note: 'Showing the latest stored records. Live data is still loading.' } };
  const SERVED_PENDING = { ok: false, feature: FEATURE, rows: [{ status: 'source_status', title: 'Source offline or empty' }], source: { adapter: 'api', note: 'Live data is taking longer than usual.' }, served: 'archive' };
  let api;
  beforeEach(() => {
    api = deferred();
    globalThis.fetch = vi.fn(() => api.promise);
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('stored records from the server replace the shipped ones without being called live', async () => {
    archive.fetch = async () => STORED;
    const onUpdate = vi.fn();
    await fetchFeature({ tier: TIER, feature: FEATURE, onUpdate });
    api.resolve(response(SERVED_STORED));
    await tick();
    const next = onUpdate.mock.calls[0][0];
    expect(next.rows).toEqual(SERVED_STORED.rows);
    expect(next.served).toBe('archive');
    expect(next.updatedLive).toBeUndefined();
  });

  it('the shipped records stay, marked as served from storage, when the server has none yet', async () => {
    archive.fetch = async () => STORED;
    const onUpdate = vi.fn();
    await fetchFeature({ tier: TIER, feature: FEATURE, onUpdate });
    api.resolve(response(SERVED_PENDING));
    await tick();
    const kept = onUpdate.mock.calls[0][0];
    expect(kept.rows).toEqual(STORED.rows);
    expect(kept.served).toBe('archive');
    expect(kept.refreshing).toBe(false);
  });

  it('with nothing stored anywhere, the answer stays pending instead of looking empty', async () => {
    archive.fetch = async () => ({ ...STORED, rows: [] });
    api.resolve(response(SERVED_PENDING));
    const body = await fetchFeature({ tier: TIER, feature: FEATURE });
    expect(body.rows).toEqual([]);
    expect(body.served).toBe('archive');
  });

  it('a failure that is not a stored answer is not marked', async () => {
    archive.fetch = async () => ({ ...STORED, rows: [] });
    api.resolve(response({ ok: false, error: 'upstream' }, 502));
    const body = await fetchFeature({ tier: TIER, feature: FEATURE });
    expect(body.served).toBeUndefined();
  });

  it('stored records without a note of their own are described in plain words', async () => {
    archive.fetch = async () => ({ ...STORED, source: { adapter: 'embedded' } });
    api.resolve(response({ ok: false, error: 'upstream' }, 502));
    const body = await fetchFeature({ tier: TIER, feature: FEATURE });
    expect(body.source.note).toBe('Showing the latest stored records.');
  });
});

// F159 review: a live attempt that failed on the server (`source.liveFailed`) stays marked when the
// page shows its own shipped records instead, so the page does not retry it as if it were slow.
describe('a failed live attempt stays marked (F159 review)', () => {
  const originalFetch = globalThis.fetch;
  const FAILED_PENDING = { ok: false, feature: FEATURE, rows: [{ status: 'source_status', title: 'Source offline or empty' }], source: { adapter: 'api', note: 'The live source isn’t responding.', liveFailed: true, diagnostic: 'upstream-error' }, served: 'archive' };
  let api;
  beforeEach(() => {
    api = deferred();
    globalThis.fetch = vi.fn(() => api.promise);
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('shipped records shown once the server answered', async () => {
    archive.fetch = async () => STORED;
    api.resolve(response(FAILED_PENDING));
    const body = await fetchFeature({ tier: TIER, feature: FEATURE });
    expect(body.rows).toEqual(STORED.rows);
    expect(body.served).toBe('archive');
    expect(body.source.liveFailed).toBe(true);
  });

  it('shipped records kept when the server answers after them', async () => {
    archive.fetch = async () => STORED;
    const onUpdate = vi.fn();
    await fetchFeature({ tier: TIER, feature: FEATURE, onUpdate });
    api.resolve(response(FAILED_PENDING));
    await tick();
    const kept = onUpdate.mock.calls[0][0];
    expect(kept.served).toBe('archive');
    expect(kept.source.liveFailed).toBe(true);
  });

  it('nothing stored anywhere', async () => {
    archive.fetch = async () => ({ ...STORED, rows: [] });
    api.resolve(response(FAILED_PENDING));
    const body = await fetchFeature({ tier: TIER, feature: FEATURE });
    expect(body.served).toBe('archive');
    expect(body.source.liveFailed).toBe(true);
  });
});

describe('canonical Law register never hides a serving failure', () => {
  const feature = 'NCLT / NCLAT (Insolvency)';
  it('refuses an API error instead of falling back to the archive', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: 'unavailable' }) })));
    await expect(fetchFeaturePage({ tier: 'judiciary', feature, page: 1 })).rejects.toThrow();
    await expect(fetchFeature({ tier: 'judiciary', feature })).rejects.toThrow();
  });
  it('keeps an authoritative empty result', async () => {
    const body = { ok: true, paged: true, rows: [], total: 0, totalAll: 436 };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
    expect(await fetchFeature({ tier: 'judiciary', feature })).toEqual(body);
  });
});
