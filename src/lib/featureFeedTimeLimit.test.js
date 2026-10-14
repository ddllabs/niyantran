// F154 (owner request 2026-10-14): a landing count or a module page waited for the slowest live
// source (Cabinet Decisions 9-21 s, Morning Brief 28 s or a 504 at 60 s). The feed now gives
// live sources a fixed time and then answers from the stored archive, saying which it served.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIVE_TIME_LIMIT_MS,
  resetFeedCache,
  serveFeatureFeedWithinLimit,
} from '../../server/featureFeed.mjs';
import { serveNationalLanding } from '../../server/nationalLandingSummary.mjs';
import { serveEconomicsLanding } from '../../server/economicsLandingSummary.mjs';

const CABINET = new URLSearchParams({ tier: 'national', feature: 'Cabinet Decisions' });

// A source that never answers until the request gives up on it, like PIB on a bad day.
function hangingFetch() {
  return vi.fn((_url, init = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }));
}

const realRows = (body) => (body?.rows || []).filter((r) => r?.status !== 'source_status');

describe('serveFeatureFeedWithinLimit (F154)', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => resetFeedCache());
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('gives live sources four seconds in all', () => {
    expect(LIVE_TIME_LIMIT_MS).toBe(4000);
  });

  it('answers from the live source when it is quick, and says so', async () => {
    const live = vi.fn(async () => ({ ok: true, rows: [{ title: 'Live decision' }], source: { adapter: 'api' }, fallback: false }));
    const body = await serveFeatureFeedWithinLimit(CABINET, { live });
    expect(body.served).toBe('live');
    expect(body.rows).toEqual([{ title: 'Live decision' }]);
    expect(body.fallback).toBe(false);
  });

  it('answers from the stored archive when the live source passes the limit, without waiting for it', async () => {
    globalThis.fetch = hangingFetch();
    const started = Date.now();
    const body = await serveFeatureFeedWithinLimit(CABINET, { limitMs: 50 });
    const took = Date.now() - started;
    expect(took).toBeLessThan(2000);
    expect(body.served).toBe('archive');
    expect(body.fallback).toBe(true);
    expect(realRows(body).length).toBeGreaterThan(0);
    expect(body.source.note).toMatch(/time limit/i);
    // The archive pass itself reaches no live source: only the live attempt's first request was made.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('in the archive pass a slow source behind another server module is not waited on either', async () => {
    globalThis.fetch = hangingFetch();
    const started = Date.now();
    const body = await serveFeatureFeedWithinLimit(new URLSearchParams({ tier: 'sports', feature: 'Athlete Index' }), { limitMs: 50 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(body.served).toBe('archive');
  });

  it('answers from the archive when the live source fails outright', async () => {
    const live = vi.fn(async () => { throw new Error('ECONNRESET'); });
    globalThis.fetch = vi.fn(() => { throw new Error('the archive must not reach the network'); });
    const body = await serveFeatureFeedWithinLimit(CABINET, { live });
    expect(body.served).toBe('archive');
    expect(realRows(body).length).toBeGreaterThan(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('shares one slow live request between callers instead of starting another', async () => {
    let finish;
    const live = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const [a, b] = await Promise.all([
      serveFeatureFeedWithinLimit(CABINET, { live, limitMs: 20 }),
      serveFeatureFeedWithinLimit(CABINET, { live, limitMs: 20 }),
    ]);
    expect(live).toHaveBeenCalledTimes(1);
    expect(a.served).toBe('archive');
    expect(b.served).toBe('archive');
    finish({ ok: true, rows: [{ title: 'Late live decision' }], source: { adapter: 'api' } });
  });

  it('serves a live answer that arrived after an earlier request gave up on it', async () => {
    let finish;
    const slow = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const first = await serveFeatureFeedWithinLimit(CABINET, { live: slow, limitMs: 20 });
    expect(first.served).toBe('archive');
    finish({ ok: true, rows: [{ title: 'Late live decision' }], source: { adapter: 'api' } });
    await new Promise((r) => setTimeout(r, 0));

    const stillSlow = vi.fn(() => new Promise(() => {}));
    const second = await serveFeatureFeedWithinLimit(CABINET, { live: stillSlow, limitMs: 20 });
    expect(second.served).toBe('live');
    expect(second.rows).toEqual([{ title: 'Late live decision' }]);
    expect(Number.isFinite(Date.parse(second.liveAt))).toBe(true);
  });

  it('does not keep a late answer that has no rows', async () => {
    let finish;
    const slow = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    await serveFeatureFeedWithinLimit(CABINET, { live: slow, limitMs: 20 });
    finish({ ok: true, rows: [], source: { adapter: 'api' } });
    await new Promise((r) => setTimeout(r, 0));
    const next = await serveFeatureFeedWithinLimit(CABINET, { live: vi.fn(() => new Promise(() => {})), limitMs: 20 });
    expect(next.served).toBe('archive');
  });
});

describe('landing summaries within the limit (F154)', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => resetFeedCache());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('a National count comes from the archive when PIB is slow, and says so', async () => {
    globalThis.fetch = hangingFetch();
    const load = (params) => serveFeatureFeedWithinLimit(params, { limitMs: 50 });
    const summary = await serveNationalLanding(new URLSearchParams({ feature: 'Cabinet Decisions' }), load);
    expect(summary.served).toBe('archive');
    expect(Number.isInteger(summary.count)).toBe(true);
    expect(summary.count).toBeGreaterThan(0);
  });

  it('a summary from a quick live source says live', async () => {
    const load = async (params) => ({ ok: true, feature: params.get('feature'), rows: [{ title: 'Quote', exchange: 'NSE' }], source: { adapter: 'api', links: [] }, served: 'live' });
    const summary = await serveEconomicsLanding(new URLSearchParams({ feature: 'NSE/BSE Delayed Market Feed' }), load);
    expect(summary.served).toBe('live');
  });
});
