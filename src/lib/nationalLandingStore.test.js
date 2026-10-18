import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/router.js';
import { handleFeatureFeedRequest, resetFeedCache } from '../../server/featureFeed.mjs';
import { withoutLoaderCaches } from '../../server/loaderCache.mjs';

const FEATURE = 'Policy Pipeline Tracker (Draft-to-Gazette)';
const NOW = Date.parse('2026-10-18T12:00:00Z');
const FETCHED = '2026-10-18T11:55:00.000Z';
const TITLES = ['Draft rules opened for public consultation', 'Ministry issues operational guidelines', 'Bank reservation policy consultation', 'Sports awards ceremony'];

describe.each([false, true])('Policy Pipeline stored summary (local=%s)', local => {
  function snapshot(over = {}) {
    return {
      tier: 'national', feature: FEATURE, variant: '', class: 'official', kind: 'official',
      serve: true, interval_minutes: 60, fetched_at: FETCHED, total: 4,
      meta: { adapter: 'api', links: ['https://www.pib.gov.in/'], view: {} },
      items: TITLES.map((title, i) => ({ item_key: `policy:${i}`, published_at: '2026-10-17T00:00:00Z', last_seen: FETCHED,
        row: { title, date: '2026-10-17', stage: 'PIB release', source_url: `https://www.pib.gov.in/PressReleasePage.aspx?PRID=${i + 1}` } })),
      ...over,
    };
  }
  function network(stored, live = false) {
    const fetch = vi.fn(async (url, init) => {
      if (String(url) === 'https://db.example/rest/v1/rpc/feed_page') {
        expect(JSON.parse(init.body)).toMatchObject({ p_tier: 'national', p_feature: FEATURE, p_variant: '' });
        return new Response(JSON.stringify(stored));
      }
      if (live && String(url).includes('pib.gov.in/')) {
        const title = 'Cabinet approves the Example Scheme for 2026-27';
        const rss = `<rss><channel><item><title>${title}</title><link>https://www.pib.gov.in/PressReleasePage.aspx?PRID=701</link></item></channel></rss>`;
        const page = `<html><head><meta property="og:title" content="${title} | Press Information Bureau" /></head><body>Posted On: 17 Oct 2026</body></html>`;
        return new Response(String(url).includes('RssMain') ? rss : page);
      }
      // PIB's index answers, but its release page is unavailable: the production
      // failure must stay unavailable rather than becoming an embedded fallback.
      if (String(url).includes('pib.gov.in/RssMain')) {
        return new Response('<rss><channel><item><title>मसौदा नीति</title><link>https://www.pib.gov.in/PressReleasePage.aspx?PRID=702</link></item></channel></rss>');
      }
      throw new Error('Synthetic upstream unavailable');
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }
  async function request(feature = FEATURE, method = 'GET') {
    const req = { method, url: `/api/national-landing?${new URLSearchParams({ feature })}`, headers: { host: 'localhost' } };
    const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, end(body) { this.body = JSON.parse(body); } };
    await withoutLoaderCaches(() => local ? handleFeatureFeedRequest(req, res, () => { throw new Error('Skipped'); }) : handler(req, res));
    return res;
  }
  beforeEach(() => {
    resetFeedCache();
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('SUPABASE_URL', 'https://db.example');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic-f226-key');
    vi.stubEnv('VERCEL', '1');
  });
  afterEach(() => {
    resetFeedCache();
    vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });
  it('counts only relevant stored releases without contacting a failed live source', async () => {
    const fetch = network(snapshot());
    const res = await request();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, count: 3, availability: 'ready', served: 'store', fetchedAt: FETCHED });
    expect(res.body).not.toHaveProperty('rows');
    expect(res.body).not.toHaveProperty('stale');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retains stale provenance when a permitted stored copy answers live failure', async () => {
    const old = '2026-10-18T07:00:00.000Z';
    network(snapshot({ fetched_at: old }));
    const res = await request();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ count: 3, served: 'store', fetchedAt: old, stale: true, ageMinutes: 300 });
  });
  it.each([['missing', null], ['disabled', { serve: false }], ['empty', { items: [], total: 0 }], ['over ceiling', { fetched_at: '2026-10-01T00:00:00Z' }]])('keeps an unavailable answer truthful when the store is %s', async (_name, over) => {
    network(over === null ? null : snapshot(over));
    const res = await request();
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ ok: false, availability: 'error', count: null });
    expect(res.body.served).not.toBe('store');
  });
  it('keeps the live fallback when no store can answer', async () => {
    network(null, true);
    const res = await request();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ count: 1, served: 'live' });
    expect(res.body).not.toHaveProperty('fetchedAt');
  });
  it('does not route other National summaries through this store', async () => {
    const fetch = network(snapshot());
    await request('Cabinet Decisions');
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/rpc/feed_page'))).toBe(false);
  });
  it('rejects invalid features and non-GET requests before reading data', async () => {
    const fetch = network(snapshot());
    expect((await request('unknown')).statusCode).toBe(400);
    expect((await request(FEATURE, 'POST')).statusCode).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });
});
