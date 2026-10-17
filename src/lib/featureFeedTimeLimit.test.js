// F154 (owner request 2026-10-14): a landing count or a module page waited for the slowest live
// source (Cabinet Decisions 9-21 s, Morning Brief 28 s or a 504 at 60 s). The feed now gives
// live sources a fixed time and then answers from the stored archive, saying which it served.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARCHIVE_NOTES,
  LIVE_TIME_LIMIT_MS,
  resetFeedCache,
  serveFeatureFeed,
  serveFeatureFeedWithBackup as withBackup,
  serveFeatureFeedWithinLimit as withinLimit,
} from '../../server/featureFeed.mjs';
import { serveNationalLanding } from '../../server/nationalLandingSummary.mjs';
import { serveEconomicsLanding } from '../../server/economicsLandingSummary.mjs';
import { serveStateLanding } from '../../server/stateLandingSummary.mjs';

const CABINET = new URLSearchParams({ tier: 'national', feature: 'Cabinet Decisions' });

const originalFetch = globalThis.fetch;
const sources = new Set();
const producers = new Set();
const deferredFinishes = new Set();

// A source stays pending until abort/disposal, including fallback requests.
function hangingFetch() {
  let closing = false;
  const pending = new Set();
  const fetch = vi.fn((_url, init = {}) => {
    if (closing) return Promise.reject(new Error('test source disposed'));
    return new Promise((_resolve, reject) => {
      const end = () => {
        init.signal?.removeEventListener('abort', end);
        pending.delete(end);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      };
      pending.add(end);
      if (init.signal?.aborted) end();
      else init.signal?.addEventListener('abort', end, { once: true });
    });
  });
  sources.add(() => {
    closing = true;
    for (const end of [...pending]) end();
  });
  return fetch;
}

function deferredLive() {
  let finish;
  const promise = new Promise((resolve) => { finish = resolve; });
  deferredFinishes.add(() => finish({ ok: true, rows: [] }));
  return { live: vi.fn(() => promise), finish };
}

function trackedOptions({ live = serveFeatureFeed, ...options } = {}) {
  return { ...options, live: (params) => {
    const producer = Promise.resolve().then(() => live(params));
    producers.add(producer);
    return producer;
  } };
}
const serveFeatureFeedWithinLimit = (params, options) => withinLimit(params, trackedOptions(options));
const serveFeatureFeedWithBackup = (params, options) => withBackup(params, trackedOptions(options));

// Drain under the source mock: releasing fetch first lets tryUrls escape into
// another test after its original source deadline (F221).
async function releaseFeedTest() {
  try {
    for (const dispose of sources) dispose();
    for (const finish of deferredFinishes) finish();
    await Promise.allSettled([...producers]);
  } finally {
    sources.clear();
    producers.clear();
    deferredFinishes.clear();
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    resetFeedCache();
  }
}
beforeEach(() => resetFeedCache());
afterEach(releaseFeedTest);

const realRows = (body) => (body?.rows || []).filter((r) => r?.status !== 'source_status');

describe('serveFeatureFeedWithinLimit (F154)', () => {
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
    // F159: the reader is told in plain words; the reason stays in the diagnostic.
    expect(body.source.note).toBe(ARCHIVE_NOTES.slowStored);
    expect(body.source.diagnostic).toBe('timeout');
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
    const { live, finish } = deferredLive();
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
    const { live: slow, finish } = deferredLive();
    const first = await serveFeatureFeedWithinLimit(CABINET, { live: slow, limitMs: 20 });
    expect(first.served).toBe('archive');
    finish({ ok: true, rows: [{ title: 'Late live decision' }], source: { adapter: 'api' } });
    await new Promise((r) => setTimeout(r, 0));

    const stillSlow = deferredLive().live;
    const second = await serveFeatureFeedWithinLimit(CABINET, { live: stillSlow, limitMs: 20 });
    expect(second.served).toBe('live');
    expect(second.rows).toEqual([{ title: 'Late live decision' }]);
    expect(Number.isFinite(Date.parse(second.liveAt))).toBe(true);
  });

  it('does not keep a late answer that has no rows', async () => {
    const { live: slow, finish } = deferredLive();
    await serveFeatureFeedWithinLimit(CABINET, { live: slow, limitMs: 20 });
    finish({ ok: true, rows: [], source: { adapter: 'api' } });
    await new Promise((r) => setTimeout(r, 0));
    const next = await serveFeatureFeedWithinLimit(CABINET, { live: deferredLive().live, limitMs: 20 });
    expect(next.served).toBe('archive');
  });
});

describe('landing summaries within the limit (F154)', () => {

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

// F159 (owner, 2026-10-14): "it's showing that the 4-second limit has passed ... This kind of error
// is not very user-friendly." What a reader sees of an archive answer is plain English; the
// technical reason is kept in `source.diagnostic`, which no screen shows.
describe('archive answers in plain words (F159)', () => {
  const DEVELOPER = /\b\d+\s*s\b|time limit|HTTP|feature-feed|archive|adapter|ECONN|host did not respond|Live source failed/i;
  const failing = vi.fn(async () => { throw new Error('ECONNRESET'); });

  it('stored records after a slow live source', async () => {
    globalThis.fetch = hangingFetch();
    const body = await serveFeatureFeedWithinLimit(CABINET, { limitMs: 50 });
    expect(realRows(body).length).toBeGreaterThan(0);
    expect(body.source.note).toBe('Showing the latest stored records. Live data is still loading.');
    expect(body.source.note).not.toMatch(DEVELOPER);
    expect(body.source.diagnostic).toBe('timeout');
  });

  it('stored records after a failed live source', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network off')));
    const body = await serveFeatureFeedWithinLimit(CABINET, { live: failing });
    expect(realRows(body).length).toBeGreaterThan(0);
    expect(body.source.note).toBe('The live source isn\u2019t responding. Showing the latest stored records.');
    expect(body.source.note).not.toMatch(DEVELOPER);
    expect(body.source.diagnostic).toBe('upstream-error');
  });

  it('nothing stored while a slow live source is still loading', async () => {
    globalThis.fetch = hangingFetch();
    const body = await serveFeatureFeedWithinLimit(new URLSearchParams({ tier: 'national', feature: 'National Morning Brief (Auto-digest)' }), { limitMs: 50 });
    expect(body.served).toBe('archive');
    expect(realRows(body)).toHaveLength(0);
    expect(body.source.note).toBe('Live data is taking longer than usual.');
    expect(body.source.diagnostic).toBe('timeout');
  });

  it('nothing stored after a failed live source', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network off')));
    const body = await serveFeatureFeedWithinLimit(new URLSearchParams({ tier: 'national', feature: 'National Morning Brief (Auto-digest)' }), { live: failing });
    expect(body.source.note).toBe('The live source isn\u2019t responding.');
    expect(body.source.note).not.toMatch(DEVELOPER);
  });

  it('a State landing card that quotes the source note quotes the plain words', async () => {
    globalThis.fetch = hangingFetch();
    const load = (params) => serveFeatureFeedWithBackup(params, { live: deferredLive().live, limitMs: 50 });
    const summary = await serveStateLanding(new URLSearchParams({ feature: 'Constituency Register' }), load);
    expect(summary.served).toBe('archive');
    expect(summary.count).toBeGreaterThan(0);
    expect(summary.limitations).toMatch(/^Showing the latest stored records\./);
    expect(summary.limitations).not.toMatch(/time limit|\b4 s\b/i);
  });

  it('a backup pack served after a failed live source keeps the reason for debugging', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network off')));
    const body = await serveFeatureFeedWithBackup(new URLSearchParams({ tier: 'sports', feature: 'Athlete Index' }), { live: failing });
    expect(body.source.kind).toBe('backup-pack');
    expect(body.served).toBe('archive');
    expect(body.source.diagnostic).toBe('upstream-error');
    // F159 review: the page does not retry a failed live source as if it were slow.
    expect(body.source.liveFailed).toBe(true);
  });
});

// F159 review: `source.diagnostic` is in the public answer, so it is a short code from a fixed list;
// the raw reason (which can name a server file) goes to the server log. A live attempt that threw is
// marked `source.liveFailed`, so the page does not retry it as if it were only slow.
describe('the public reason is a fixed code (F159 review)', () => {
  const CODES = /^(timeout|upstream-error|no-stored-records|backup-error)( · (timeout|upstream-error|no-stored-records|backup-error))*$/;
  const RAW = "ENOENT: no such file or directory, open '/var/task/server/private-loader.mjs'";
  let warn;
  beforeEach(() => {
    resetFeedCache();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });
  const throwing = async () => { throw new Error(RAW); };

  it('a slow live source: timeout, and not marked failed', async () => {
    globalThis.fetch = hangingFetch();
    const body = await serveFeatureFeedWithinLimit(CABINET, { limitMs: 50 });
    expect(body.source.diagnostic).toBe('timeout');
    expect(body.source.liveFailed).toBeUndefined();
  });

  it('a failed live source with stored records: upstream-error, marked failed, raw reason only in the log', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network off')));
    const body = await serveFeatureFeedWithinLimit(CABINET, { live: throwing });
    expect(realRows(body).length).toBeGreaterThan(0);
    expect(body.source.diagnostic).toMatch(CODES);
    expect(body.source.diagnostic).toBe('upstream-error');
    expect(body.source.liveFailed).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/private-loader|\/var\/task|ENOENT/);
    expect(warn.mock.calls.flat().join(' ')).toContain(RAW);
  });

  it('a failed live source with nothing stored: marked failed, raw reason not in the answer', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network off')));
    const body = await serveFeatureFeedWithinLimit(new URLSearchParams({ tier: 'national', feature: 'National Morning Brief (Auto-digest)' }), { live: throwing });
    expect(body.served).toBe('archive');
    expect(body.source.diagnostic).toMatch(CODES);
    expect(body.source.liveFailed).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/private-loader|\/var\/task|ENOENT/);
  });
});

describe('a backup pack that cannot be read (F159 review)', () => {
  const RAW = "ENOENT: no such file or directory, open '/var/task/backup/sports/athletes.xlsx'";
  let warn;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => {
    warn.mockRestore();
    vi.doUnmock('../../server/backupFeed.mjs');
    vi.resetModules();
  });

  it('says backup-error in the answer and logs the file path on the server only', async () => {
    vi.resetModules();
    vi.doMock('../../server/backupFeed.mjs', () => ({ loadBackupForFeature: () => { throw new Error(RAW); } }));
    const { serveFeatureFeedWithBackup: withBackup } = await import('../../server/featureFeed.mjs');
    const empty = { ok: true, feature: 'Athlete Index', rows: [{ status: 'source_status' }], source: { adapter: 'api' } };
    const body = await withBackup(new URLSearchParams({ tier: 'sports', feature: 'Athlete Index' }), { live: async () => empty });
    expect(body.source.diagnostic).toBe('backup-error');
    expect(JSON.stringify(body)).not.toMatch(/athletes\.xlsx|\/var\/task|ENOENT/);
    expect(warn.mock.calls.flat().join(' ')).toContain(RAW);
  });
});

// F221: a source fallback must not escape into the next test's fetch mock.
describe('feed producer isolation (F221)', () => {
  let producer;

  it.each([0, 1])('leaves exactly %i consumer calls after the source deadline', async (consumerCalls) => {
    resetFeedCache();
    vi.useFakeTimers();
    const source = hangingFetch();
    globalThis.fetch = source;
    const request = serveFeatureFeedWithinLimit(CABINET, {
      limitMs: 50,
      live: (params) => { producer = serveFeatureFeed(params); return producer; },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect((await request).served).toBe('archive');
    expect(source).toHaveBeenCalledTimes(1);
    await releaseFeedTest();
    vi.useFakeTimers();
    const consumer = vi.fn(async () => new Response('<rss><channel/></rss>'));
    globalThis.fetch = consumer;
    for (let i = 0; i < consumerCalls; i++) await fetch('/api/user-prefs');
    await vi.advanceTimersByTimeAsync(12_000);
    await producer;
    expect(source.mock.calls.some(([url]) => String(url).includes('ViewRss.aspx'))).toBe(true);
    expect(consumer).toHaveBeenCalledTimes(consumerCalls);
  });
});
