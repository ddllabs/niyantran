// F154 (owner request 2026-10-14): terminal pages waited 5-60 s on /api/* answers that were all
// sent `no-store`. Public, query-keyed GET routes may now be kept by Vercel's CDN; every other
// route, and every error, stays `no-store`.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const feed = vi.hoisted(() => ({ within: null }));

vi.mock('../../server/featureFeed.mjs', () => ({
  serveFeatureFeed: vi.fn(() => { throw new Error('the router must use the time-limited feed'); }),
  serveFeatureFeedWithinLimit: vi.fn((params) => feed.within(params)),
  // F156: the time-limited feed with the backup-pack fallback; the packs are out of this test.
  serveFeatureFeedWithBackup: vi.fn((params) => feed.within(params)),
}));

import handler, { API_CACHE, cachePolicyFor } from '../../api/router.js';

// Every route api/router.js serves, with the policy it must have. A new route fails the
// completeness check below until it is added here, and it is 'no-store' unless allow-listed.
const ROUTES = {
  '/api/national-landing': 'edge',
  '/api/global-landing': 'edge',
  '/api/law-landing': 'edge',
  '/api/economics-landing': 'edge',
  '/api/carbon-landing': 'edge',
  '/api/sports-landing': 'edge',
  '/api/entertainment-landing': 'edge',
  '/api/state-landing': 'edge',
  '/api/feature-feed': 'edge',
  '/api/home/segments': 'edge',
  '/api/constitutions': 'edge',
  '/api/growth': 'edge',
  // `fresh=1` is the user's refresh button on these three; caching would defeat it.
  '/api/home/markets': 'no-store',
  '/api/home/latest': 'no-store',
  '/api/home/pulse': 'no-store',
  '/api/ohlc': 'no-store',
  '/api/livetv': 'no-store',
  '/api/news/ingest': 'no-store',
  '/api/users': 'no-store',
  '/api/users/': 'no-store',
  '/api/site-figures': 'own',
  '/api/marketing/intro-video': 'no-store',
  '/api/analytics': 'no-store',
  '/api/user-prefs': 'no-store',
  '/api/billing': 'no-store',
  '/api/air': 'no-store',
  '/api/ships': 'no-store',
  '/api/ais': 'no-store',
  '/api/vessels': 'no-store',
  '/api/opensanctions': 'no-store',
  '/api/fts': 'no-store',
  '/api/site-icon': 'own',
  '/api/portwatch': 'no-store',
  '/api/launches': 'no-store',
  '/api/celestrak': 'no-store',
  '/api/wb-projects': 'no-store',
  '/api/ai/desk-brief': 'no-store',
  '/api/ai/source-extract': 'no-store',
};
// Literals in routePath() that name the router itself, not a route.
const NOT_ROUTES = new Set(['/api', '/api/', '/api/router', '/api/router.js']);

function vercelResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader: vi.fn((name, value) => { res.headers[name.toLowerCase()] = value; }),
    status: vi.fn((code) => { res.statusCode = code; return res; }),
    json: vi.fn((body) => { res.body = body; return res; }),
    end: vi.fn((raw) => { if (raw !== undefined) res.body = JSON.parse(raw); return res; }),
  };
  return res;
}

// As Vercel delivers it after the rewrite: the route in __route, the caller's query beside it.
const request = (method, route, headers = {}) => {
  const [path, query] = route.split('?');
  return {
    method,
    url: `/api/router?__route=${path}${query ? `&${query}` : ''}`,
    query: { __route: path },
    headers: { host: 'localhost', ...headers },
  };
};

describe('API cache policy (F154)', () => {
  it('names every route the router serves', () => {
    const source = readFileSync(new URL('../../api/router.js', import.meta.url), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '');
    const literals = [...source.matchAll(/'(\/api(?:\/[a-z0-9./-]*)?)'/g)].map((m) => m[1]);
    const served = [...new Set(literals)].filter((p) => !NOT_ROUTES.has(p));
    expect(served.filter((p) => !(p in ROUTES))).toEqual([]);
  });

  it.each(Object.entries(ROUTES))('%s is %s for GET', (path, policy) => {
    expect(cachePolicyFor(path, 'GET')).toBe(policy);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('no route is edge-cached for %s', (method) => {
    for (const path of Object.keys(ROUTES)) expect(cachePolicyFor(path, method)).not.toBe('edge');
  });

  it('keeps an unknown route no-store', () => {
    expect(cachePolicyFor('/api/something-new', 'GET')).toBe('no-store');
    expect(cachePolicyFor('/api/feature-feed/extra', 'GET')).toBe('no-store');
  });

  it('caches at the edge, not in the browser (Vercel-CDN-Cache-Control)', () => {
    expect(API_CACHE.browser).toBe('public, max-age=0, must-revalidate');
    expect(API_CACHE.cdn).toBe('public, s-maxage=300, stale-while-revalidate=86400');
    expect(API_CACHE.browser).not.toMatch(/no-store|no-cache|private/);
  });
});

describe('API cache headers on responses (F154)', () => {
  beforeEach(() => {
    feed.within = vi.fn(async () => ({ ok: true, rows: [{ title: 'A' }], source: { adapter: 'api' }, served: 'live' }));
  });

  it('a successful feature-feed answer may be kept by the CDN for five minutes', async () => {
    const res = vercelResponse();
    await handler(request('GET', 'feature-feed?tier=national&feature=Cabinet%20Decisions'), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(API_CACHE.browser);
    expect(res.headers['vercel-cdn-cache-control']).toBe(API_CACHE.cdn);
  });

  it('an archive answer served after the live time limit is kept for one minute only', async () => {
    feed.within = vi.fn(async () => ({ ok: true, rows: [{ title: 'A' }], source: { adapter: 'embedded' }, served: 'archive' }));
    const res = vercelResponse();
    await handler(request('GET', 'feature-feed?tier=national&feature=Cabinet%20Decisions'), res);
    expect(res.headers['vercel-cdn-cache-control']).toBe(API_CACHE.cdnArchive);
  });

  it('a landing summary answer may be kept by the CDN', async () => {
    feed.within = vi.fn(async (params) => ({ ok: true, feature: params.get('feature'), rows: [{ title: 'Decision' }], source: { adapter: 'api', links: [] } }));
    const res = vercelResponse();
    await handler(request('GET', 'national-landing?feature=Cabinet%20Decisions'), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['vercel-cdn-cache-control']).toBe(API_CACHE.cdn);
  });

  it('a State landing count may be kept by the CDN (F157)', async () => {
    feed.within = vi.fn(async (params) => ({ ok: true, tier: params.get('tier'), feature: params.get('feature'), rows: [{ title: 'Decision' }], source: { adapter: 'news-search', links: [] }, served: 'live' }));
    const res = vercelResponse();
    await handler(request('GET', 'state-landing?feature=Cabinet%20Decisions'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ count: 1, served: 'live' });
    expect(res.headers['vercel-cdn-cache-control']).toBe(API_CACHE.cdn);
  });

  it('an error is never cached', async () => {
    feed.within = vi.fn(async () => { throw new Error('upstream exploded'); });
    const res = vercelResponse();
    await handler(request('GET', 'feature-feed?tier=national&feature=Cabinet%20Decisions'), res);
    expect(res.statusCode).toBe(502);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
  });

  it('an unavailable landing summary (502) is never cached', async () => {
    feed.within = vi.fn(async (params) => ({ ok: false, feature: params.get('feature'), rows: [], source: { adapter: 'api', links: [] } }));
    const res = vercelResponse();
    await handler(request('GET', 'economics-landing?feature=Live%20Global%20Stock%20Exchanges'), res);
    expect(res.statusCode).toBe(502);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
  });

  it('a rejected request (400, 405) is never cached', async () => {
    for (const [method, route, status] of [['GET', 'national-landing?feature=unknown', 400], ['POST', 'feature-feed', 405]]) {
      const res = vercelResponse();
      await handler(request(method, route), res);
      expect(res.statusCode).toBe(status);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
    }
  });

  it('a route off the allow-list keeps no-store', async () => {
    const res = vercelResponse();
    await handler(request('GET', 'no-such-route'), res);
    expect(res.statusCode).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
  });
});
