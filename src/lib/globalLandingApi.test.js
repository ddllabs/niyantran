import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import handler from '../../api/router.js';
import { handleFeatureFeedRequest, resetFeedCache } from '../../server/featureFeed.mjs';
import { serveGlobalLanding } from '../../server/globalLandingSummary.mjs';
import { withoutLoaderCaches } from '../../server/loaderCache.mjs';

describe('Global summary API', () => {
  it('enforces GET and canonical validation in both routers', async () => {
    for (const method of ['POST', 'GET']) for (const local of [false, true]) {
      const req = { method, url: '/api/global-landing?feature=unknown', headers: { host: 'localhost' } };
      const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, end(body) { this.body = JSON.parse(body); } };
      if (local) await handleFeatureFeedRequest(req, res, () => { throw new Error('Skipped'); }); else await handler(req, res);
      expect(res.statusCode).toBe(method === 'POST' ? 405 : 400);
    }
  });
  it('loads the same canonical geopolitics feed and returns a bounded projection', async () => {
    const load = vi.fn(async () => ({ ok: true, rows: [{ title: 'Site', lat: 47, lon: 34 }], source: { adapter: 'embedded' } }));
    const summary = await serveGlobalLanding(new URLSearchParams({ feature: 'Nuclear Watch', tier: 'national' }), load);
    expect(load.mock.calls[0][0].get('tier')).toBe('geopolitics');
    expect(summary.count).toBe(1); expect(summary).not.toHaveProperty('rows');
    expect(JSON.stringify(summary).length).toBeLessThan(30000);
    await expect(serveGlobalLanding(new URLSearchParams({ feature: '../secret' }), load)).rejects.toThrow('Unknown');
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe.each([false, true])('Satellite summary stored-first routing (local=%s)', local => {
  const now = Date.parse('2030-01-10T12:00:00Z');
  const fetchedAt = '2030-01-10T11:55:00.000Z';
  function snapshot(over = {}) {
    const runAt = over.fetched_at || fetchedAt;
    return {
      tier: 'geopolitics', feature: 'Satellite Infrastructure', variant: '',
      class: 'events', kind: 'events', serve: true, interval_minutes: 60,
      fetched_at: runAt, total: 2,
      meta: { adapter: 'live', links: ['https://ll.thespacedevs.com/'], view: {} },
      items: ['Launch A', 'Launch B'].map((title, index) => ({
        item_key: `launch:${index}`, last_seen: runAt,
        row: { title, provider: 'Provider', net: '2030-01-11T12:00:00Z', status: 'Go' },
      })),
      ...over,
    };
  }
  async function request(feature = 'Satellite Infrastructure', method = 'GET') {
    const req = { method, url: `/api/global-landing?${new URLSearchParams({ feature })}`, headers: { host: 'localhost' } };
    const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, end(body) { this.body = JSON.parse(body); } };
    await withoutLoaderCaches(() => local ? handleFeatureFeedRequest(req, res, () => { throw new Error('Skipped'); }) : handler(req, res));
    return res;
  }
  function network(stored, live = null) {
    const fetch = vi.fn(async (url, init) => {
      if (String(url) === 'https://db.example/rest/v1/rpc/feed_page') {
        expect(JSON.parse(init.body)).toMatchObject({ p_tier: 'geopolitics', p_feature: 'Satellite Infrastructure', p_variant: '' });
        return new Response(JSON.stringify(stored));
      }
      if (live && String(url).startsWith('https://ll.thespacedevs.com/')) return new Response(JSON.stringify({ results: live }));
      throw new Error('Upstream unavailable');
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }
  beforeEach(() => {
    resetFeedCache();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('SUPABASE_URL', 'https://db.example');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic-f218-test-key');
    // Match production: local-only backup workbooks must not conceal an outage.
    vi.stubEnv('VERCEL', '1');
  });
  afterEach(() => {
    resetFeedCache();
    vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  it('serves the stored launch count and provenance without contacting the unavailable upstream', async () => {
    const fetch = network(snapshot());
    const res = await request();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, count: 2, availability: 'ready', served: 'store', fetchedAt, asOf: null, sources: [{ name: 'll.thespacedevs.com', url: 'https://ll.thespacedevs.com/' }] });
    expect(res.body.limitations).toContain('not a complete satellite or constellation inventory');
    expect(res.body).not.toHaveProperty('rows');
    expect(JSON.stringify(res.body)).not.toContain('synthetic-f218-test-key');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves the stale marker when a retained snapshot answers an upstream failure', async () => {
    const old = '2030-01-10T07:00:00.000Z';
    network(snapshot({ fetched_at: old }));
    const res = await request();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ count: 2, served: 'store', fetchedAt: old, stale: true, ageMinutes: 300 });
  });
  it.each([
    ['missing', null], ['disabled', { serve: false }], ['empty', { items: [], total: 0 }],
    ['over ceiling', { fetched_at: '2029-12-01T12:00:00Z' }],
  ])('reports an outage when the store is %s and upstream fails', async (name, over) => {
    network(over === null ? null : snapshot(over));
    const res = await request();
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ ok: false, count: null, availability: 'error' });
    expect(res.body.served).not.toBe('store');
    if (name === 'over ceiling') expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('over the ceiling'));
  });
  it('retains the live fallback when no store is available', async () => {
    network(null, [{ id: 'live-launch', name: 'Live launch', net: '2030-01-11T12:00:00Z', status: { name: 'Go' } }]);
    const res = await request();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ count: 1, served: 'live', availability: 'ready' });
    expect(res.body).not.toHaveProperty('fetchedAt');
  });
  it('keeps validation and GET-only rejection ahead of any data read', async () => {
    const fetch = network(snapshot());
    expect((await request('unknown')).statusCode).toBe(400);
    expect((await request('Satellite Infrastructure', 'POST')).statusCode).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });
});
