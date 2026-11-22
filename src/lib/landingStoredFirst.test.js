import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/router.js';
import { handleFeatureFeedRequest, landingLoadFeed, resetFeedCache, serveFeatureFeedStoredFirst, serveFeatureFeedWithBackup, serveFeatureFeedWithinLimit } from '../../server/featureFeed.mjs';
import { withoutLoaderCaches } from '../../server/loaderCache.mjs';

// F404: a desk landing counts the module the way its table does. A module the 5-minute timer keeps in
// the feed store is read from the store first on every landing endpoint, on the Vite server and on the
// Vercel router. Before, the landings tried the live source within a time limit and showed an error or
// a smaller live count where the table showed the stored rows.

const now = Date.parse('2030-01-10T12:00:00Z');
const fetchedAt = '2030-01-10T11:55:00.000Z';

const rowsFor = {
  'national:Cabinet Decisions': n => Array.from({ length: n }, (_, i) => ({ title: `Cabinet approves scheme ${i}`, date: '2030-01-09', prid: String(2000 + i), source_url: `https://pib.gov.in/PressReleasePage.aspx?PRID=${2000 + i}`, ministry: 'Cabinet' })),
  'entertainment:Box Office Tracker': n => Array.from({ length: n }, (_, i) => ({ film: `Film ${i}`, release_date: '2029-05-01', source_url: `https://www.wikidata.org/entity/Q${i + 1}` })),
  'entertainment:Celebrity Influence Index': n => Array.from({ length: n }, (_, i) => ({ person: `Person ${i}`, followers: 1000 + i, source_url: `https://www.wikidata.org/entity/Q${i + 1}` })),
  'state:SDL Auction & Borrowing Tracker': n => Array.from({ length: n }, (_, i) => ({ title: `SDL auction ${i}`, date: '2030-01-08', source_url: `https://www.rbi.org.in/pr/${i}` })),
  'state:MLA Defection & Anti-defection Case Tracker': n => Array.from({ length: n }, (_, i) => ({ title: `Defection report ${i}`, date: '2030-01-08', source: 'Example', source_url: `https://example.com/d/${i}` })),
  'sports:Cricket Wire': n => Array.from({ length: n }, (_, i) => ({ title: `Cricket story ${i}`, date: '2030-01-09', source_url: `https://example.com/c/${i}` })),
};
const adapterOf = id => (id.startsWith('state:MLA') ? 'news-search' : 'api');
const classOf = id => (id.startsWith('national:') || id.includes('SDL') ? 'official' : id.startsWith('entertainment:') ? 'reference' : 'news');

// [landing path, tier the table asks, feature, rows the store holds, rows the store reports in all]
const CASES = [
  // The store reports more than the table lists, but under a page: a filtered table, not a capped one.
  ['/api/national-landing', 'national', 'Cabinet Decisions', 7, 9],
  ['/api/entertainment-landing', 'entertainment', 'Box Office Tracker', 6, 6],
  ['/api/entertainment-landing', 'entertainment', 'Celebrity Influence Index', 5, 5],
  ['/api/state-landing', 'state', 'SDL Auction & Borrowing Tracker', 4, 4],
  ['/api/state-landing', 'state', 'MLA Defection & Anti-defection Case Tracker', 3, 3],
  ['/api/sports-landing', 'sports', 'Cricket Wire', 500, 1200],
];

function network() {
  const fetch = vi.fn(async (url, init) => {
    const u = String(url);
    if (u === 'https://db.example/rest/v1/rpc/feed_page') {
      const body = JSON.parse(init.body);
      const id = `${body.p_tier}:${body.p_feature}`;
      const made = CASES.find(([, tier, feature]) => `${tier}:${feature}` === id);
      if (!made || !rowsFor[id]) return Response.json(null);
      const rows = rowsFor[id](made[3]);
      return Response.json({
        tier: body.p_tier, feature: body.p_feature, variant: '', class: classOf(id), kind: classOf(id) === 'news' ? 'news' : 'official',
        serve: true, interval_minutes: 60, fetched_at: fetchedAt, total: made[4],
        meta: { adapter: adapterOf(id), note: 'Stored copy', links: ['https://example.com/'] },
        items: rows.map((row, i) => ({ item_key: `k:${i}`, row, last_seen: fetchedAt })),
      });
    }
    // Every live source is slow or down: the landing must not depend on it.
    return new Response('Source unavailable', { status: 503 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function request(local, path, params) {
  const req = { method: 'GET', url: `${path}?${new URLSearchParams(params)}`, headers: { host: 'localhost' } };
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; },
    end(body) { this.body = JSON.parse(body); } };
  await withoutLoaderCaches(() => local ? handleFeatureFeedRequest(req, res, () => { throw new Error('Skipped route'); }) : handler(req, res));
  return res;
}

beforeEach(() => {
  resetFeedCache();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubEnv('SUPABASE_URL', 'https://db.example');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic-f403-key');
  vi.stubEnv('VERCEL', '1');
});
afterEach(() => { resetFeedCache(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the landing loader choice (F404)', () => {
  it('shares one loader per route family, so the Vite server and the Vercel router cannot drift', () => {
    expect(landingLoadFeed('/api/sports-landing')).toBe(landingLoadFeed('/api/carbon-landing'));
    expect(landingLoadFeed('/api/economics-landing')).toBe(landingLoadFeed('/api/entertainment-landing'));
    expect(landingLoadFeed('/api/national-landing')).toBe(landingLoadFeed('/api/law-landing'));
    expect(landingLoadFeed('/api/state-landing')).toBe(landingLoadFeed('/api/global-landing'));
    expect(landingLoadFeed('/api/national-landing')).not.toBe(landingLoadFeed('/api/sports-landing'));
    for (const path of ['/api/national-landing', '/api/sports-landing']) {
      expect([serveFeatureFeedStoredFirst, serveFeatureFeedWithBackup, serveFeatureFeedWithinLimit]).not.toContain(landingLoadFeed(path));
    }
  });

  it('reads the store for a scheduled module and never for an unscheduled one', async () => {
    const fetch = network();
    for (const path of ['/api/sports-landing', '/api/national-landing']) {
      fetch.mockClear();
      const feature = path.startsWith('/api/sports') ? 'Cricket Wire' : 'Cabinet Decisions';
      const tier = path.startsWith('/api/sports') ? 'sports' : 'national';
      const body = await landingLoadFeed(path)(new URLSearchParams({ tier, feature }));
      expect(body.served).toBe('store');
      expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/rpc/feed_page'))).toBe(true);
    }
    fetch.mockClear();
    // Bill Passage Probability Index: embedded, not scheduled.
    await landingLoadFeed('/api/national-landing')(new URLSearchParams({ tier: 'national', feature: 'Bill Passage Probability Index' }));
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/rpc/'))).toBe(false);
  });
});

describe.each([false, true])('landing equals table (local=%s)', local => {
  it.each(CASES)('%s %s %s: the landing counts the table\'s stored rows', async (path, tier, feature, held, total) => {
    const fetch = network();
    const table = await request(local, '/api/feature-feed', { tier, feature });
    const landing = await request(local, path, { feature });
    expect(table.body.served).toBe('store');
    expect(table.body.rows).toHaveLength(held);
    expect(landing.statusCode).toBe(200);
    expect(landing.body).toMatchObject({ ok: true, served: 'store', count: held });
    expect(landing.body.count).toBe(table.body.rows.length);
    expect(landing.body.availability).toBe('ready');
    // No live source was needed for either answer.
    expect(fetch.mock.calls.every(([url]) => String(url).endsWith('/rpc/feed_page'))).toBe(true);
    if (total > held && held >= 500) {
      expect(landing.body).toMatchObject({ capped: true, storeTotal: total });
      expect(landing.body.limitations).toContain(`${held.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}`);
    } else {
      expect(landing.body).not.toHaveProperty('capped');
    }
  });

  it('leaves an unscheduled module on its live loader', async () => {
    const fetch = network();
    const landing = await request(local, '/api/national-landing', { feature: 'Bill Passage Probability Index' });
    expect(landing.statusCode).toBe(200);
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/rpc/'))).toBe(false);
  });
});
