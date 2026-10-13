// F142 (owner 2026-10-14): GET /api/site-figures, the marketing site's live counts. The handler is
// driven with an injected client and clock; no database is reached.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/authEmailProvider.mjs', () => ({
  getSupabaseAdminClient: vi.fn(() => { throw new Error('tests inject adminClient'); }),
}));

import { handleSiteFiguresApi, resetSiteFiguresCache, siteFiguresApiPlugin } from '../../server/siteFiguresApi.mjs';
import { MEASURED_FIGURES } from './measuredFigures.js';

const LIVE = { bills: 9901, documents: 3500, ministries: 57, fronts: 90, as_of: '2026-10-14T10:00:00Z' };
const client = (result) => ({ rpc: vi.fn(async (name) => (name === 'site_figures' ? result : { data: null, error: { message: 'no' } })) });

async function get(deps, method = 'GET', url = '/api/site-figures') {
  const headers = {};
  const res = { setHeader: vi.fn((k, v) => { headers[k.toLowerCase()] = v; }), end: vi.fn() };
  const next = vi.fn();
  await handleSiteFiguresApi({ method, url, headers: { host: 'localhost' } }, res, next, deps);
  const raw = res.end.mock.calls[0]?.[0];
  return { status: res.statusCode, body: raw ? JSON.parse(raw) : null, headers, next };
}

describe('GET /api/site-figures', () => {
  beforeEach(() => resetSiteFiguresCache());

  it('returns the database counts, live, with the CDN allowed to keep them 15 minutes', async () => {
    const db = client({ data: LIVE, error: null });
    const r = await get({ adminClient: () => db, now: () => 0 });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ bills: 9901, documents: 3500, ministries: 57, fronts: 90, as_of: '2026-10-14T10:00:00Z', source: 'live' });
    expect(db.rpc).toHaveBeenCalledWith('site_figures');
    expect(r.headers['cache-control']).toBe('public, s-maxage=900, stale-while-revalidate=3600');
  });

  it('asks the database at most once per 15 minutes per server', async () => {
    const db = client({ data: LIVE, error: null });
    let t = 0;
    const deps = { adminClient: () => db, now: () => t };
    await get(deps);
    t = 14 * 60 * 1000;
    await get(deps);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    t = 15 * 60 * 1000 + 1;
    await get(deps);
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });

  it('serves the last good counts when the database fails, then the measured figures, never zero', async () => {
    let t = 0;
    const ok = client({ data: LIVE, error: null });
    await get({ adminClient: () => ok, now: () => t });
    t = 16 * 60 * 1000;
    const down = client({ data: null, error: { message: 'connection refused' } });
    const cached = await get({ adminClient: () => down, now: () => t });
    expect(cached.body).toMatchObject({ bills: 9901, source: 'cached' });
    expect(cached.headers['cache-control']).toBe('public, s-maxage=60');
    resetSiteFiguresCache();
    const fallback = await get({ adminClient: () => down, now: () => t });
    expect(fallback.body).toMatchObject({ bills: MEASURED_FIGURES.bills, documents: MEASURED_FIGURES.documents, ministries: MEASURED_FIGURES.ministries, fronts: MEASURED_FIGURES.fronts, source: 'fallback' });
    expect(fallback.headers['cache-control']).toBe('public, s-maxage=60');
  });

  it('treats a missing secret key, a throw, or a count that is not a positive whole number as a failure', async () => {
    for (const deps of [
      { adminClient: () => { throw new Error('no secret key'); } },
      { adminClient: () => ({ rpc: vi.fn(async () => { throw new Error('boom'); }) }) },
      { adminClient: () => client({ data: { ...LIVE, bills: 0 }, error: null }) },
      { adminClient: () => client({ data: { ...LIVE, documents: '3500' }, error: null }) },
      { adminClient: () => client({ data: null, error: null }) },
    ]) {
      resetSiteFiguresCache();
      expect((await get({ ...deps, now: () => 0 })).body.source).toBe('fallback');
    }
  });

  it('answers only GET and HEAD on its own path', async () => {
    const db = client({ data: LIVE, error: null });
    expect((await get({ adminClient: () => db }, 'POST')).status).toBe(405);
    const other = await get({ adminClient: () => db }, 'GET', '/api/other');
    expect(other.next).toHaveBeenCalled();
  });
});

// Browser check (2026-10-14): the dev plugin returned the middleware app from configureServer, which
// Vite then ran as a post hook, and the dev server crashed on start.
it('registers one dev middleware and returns no post hook', () => {
  const plugin = siteFiguresApiPlugin();
  const use = vi.fn(() => () => {});
  expect(plugin.configureServer({ middlewares: { use } })).toBeUndefined();
  expect(plugin.configurePreviewServer({ middlewares: { use } })).toBeUndefined();
  expect(use).toHaveBeenCalledTimes(2);
});

// Review (2026-10-14): a stalled database must not hang the endpoint (or the carousel behind it), a
// failure is remembered briefly so an outage cannot flood the database, and concurrent requests share
// one call.
describe('robustness', () => {
  beforeEach(() => resetSiteFiguresCache());

  it('gives up on a database call after the timeout and serves the fallback', async () => {
    const hung = { rpc: vi.fn(() => new Promise(() => {})) };
    const r = await get({ adminClient: () => hung, now: () => 0, timeoutMs: 20 });
    expect(r.body.source).toBe('fallback');
  });

  it('remembers a failure for a minute before asking the database again', async () => {
    const down = client({ data: null, error: { message: 'down' } });
    let t = 0;
    const deps = { adminClient: () => down, now: () => t };
    await get(deps);
    t = 59 * 1000;
    await get(deps);
    expect(down.rpc).toHaveBeenCalledTimes(1);
    t = 61 * 1000;
    await get(deps);
    expect(down.rpc).toHaveBeenCalledTimes(2);
  });

  it('shares one database call between concurrent requests, and answers HEAD without a body', async () => {
    let release;
    const slow = { rpc: vi.fn(() => new Promise((r) => { release = () => r({ data: LIVE, error: null }); })) };
    const deps = { adminClient: () => slow, now: () => 0 };
    const both = Promise.all([get(deps), get(deps)]);
    await new Promise((r) => setTimeout(r, 0));
    release();
    const [a, b] = await both;
    expect(slow.rpc).toHaveBeenCalledTimes(1);
    expect([a.body.source, b.body.source]).toEqual(['live', 'live']);
    const head = await get(deps, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
  });

  it('ignores a malformed Host header', async () => {
    const res = { setHeader: vi.fn(), end: vi.fn() };
    await handleSiteFiguresApi({ method: 'GET', url: '/api/site-figures', headers: { host: 'bad host::' } }, res, vi.fn(), { adminClient: () => client({ data: LIVE, error: null }), now: () => 0 });
    expect(res.statusCode).toBe(200);
  });
});
