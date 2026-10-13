// F142 (owner 2026-10-14): GET /api/site-figures, the marketing site's live counts. The handler is
// driven with an injected client and clock; no database is reached.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/authEmailProvider.mjs', () => ({
  getSupabaseAdminClient: vi.fn(() => { throw new Error('tests inject adminClient'); }),
}));

import { handleSiteFiguresApi, resetSiteFiguresCache } from '../../server/siteFiguresApi.mjs';
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
