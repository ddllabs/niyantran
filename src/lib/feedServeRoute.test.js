// F169 phase 4 (C4): /api/feature-feed reads a scheduled module from the feed store on both servers
// (the Vercel router and the Vite middleware), and answers today's live way when the store has nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { API_CACHE } from '../../api/router.js';
import { handleFeatureFeedRequest, resetFeedCache } from '../../server/featureFeed.mjs';

const SECRET = 'sb_secret_route-test-key-91ac';
const ROUTE = 'feature-feed?tier=finance&feature=AI%20%26%20the%20Tech%20Industry';

const page = (over = {}) => ({
  tier: 'finance', feature: 'AI & the Tech Industry', variant: '', class: 'news', kind: 'news', serve: true,
  fetched_at: '2026-10-15T10:00:00.000Z', interval_minutes: 30, total: 1,
  meta: { note: 'Google News topic search.', links: ['https://news.google.com/rss/search?q=ai'], coverage: { from: '', through: '7d', exhaustive: false }, adapter: 'news-search', kind: '', fetched_at: '2026-10-15T10:00:00.000Z' },
  items: [{ item_key: 'url:a.example/1', row: { title: 'Stored story', date: '2026-10-15', source_url: 'https://a.example/1' } }],
  ...over,
});

function vercelResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader: vi.fn((name, value) => { res.headers[name.toLowerCase()] = value; }),
    status: vi.fn((code) => { res.statusCode = code; return res; }),
    json: vi.fn((body) => { res.body = JSON.parse(JSON.stringify(body)); return res; }),
    end: vi.fn(() => res),
  };
  return res;
}
const routerGet = async (route) => {
  const [path, query] = route.split('?');
  const res = vercelResponse();
  await handler({ method: 'GET', url: `/api/router?__route=${path}&${query}`, query: { __route: path }, headers: { host: 'localhost' } }, res);
  return res;
};
const middlewareGet = async (route) => {
  const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(raw) { this.body = raw ? JSON.parse(raw) : undefined; } };
  await handleFeatureFeedRequest({ method: 'GET', url: `/api/${route}`, headers: { host: 'localhost' } }, res, () => { throw new Error('not handled'); });
  return res;
};

describe('/api/feature-feed reads a scheduled module from the store (F169 C4)', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    resetFeedCache();
    vi.stubEnv('SUPABASE_URL', 'https://db.example');
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRET);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('answers the same from the router and the Vite middleware, without reaching any outside source', async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/rest/v1/rpc/feed_page')) return new Response(JSON.stringify(page()), { status: 200 });
      throw new Error(`the live path must not run: ${url}`);
    });
    const router = await routerGet(ROUTE);
    const local = await middlewareGet(ROUTE);
    for (const res of [router, local]) {
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ ok: true, served: 'store', fallback: false, fetchedAt: '2026-10-15T10:00:00.000Z' });
      expect(res.body.rows).toEqual([{ title: 'Stored story', date: '2026-10-15', source_url: 'https://a.example/1' }]);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    }
    expect(router.body).toEqual(local.body);
    expect(calls).toEqual(['https://db.example/rest/v1/rpc/feed_page', 'https://db.example/rest/v1/rpc/feed_page']);
    // The deployed route keeps a store answer at the edge for one minute; the local server never caches.
    expect(router.headers['vercel-cdn-cache-control']).toBe(API_CACHE.cdnStore);
    expect(local.headers['cache-control']).toBe('no-store');
  });

  it('answers the live way, with no store marker, when serve is off', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).endsWith('/rest/v1/rpc/feed_page')) return new Response(JSON.stringify(page({ serve: false })), { status: 200 });
      throw new Error('offline');
    });
    const res = await routerGet(ROUTE);
    expect(res.statusCode).toBe(200);
    expect(res.body.served).not.toBe('store');
    expect(res.body.fetchedAt).toBeUndefined();
    // The live attempt ran: the loader tried an outside source after the store answered.
    expect(globalThis.fetch.mock.calls.length).toBeGreaterThan(1);
  });
});
