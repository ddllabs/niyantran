// F169 T8. F167: /api/home/refresh was public on the live site, and any visitor (or anyone at all)
// could make the function fetch every home source; it is now the local dev server's only. F168: a
// pending answer (stored records served, none to show) was a 200 the CDN kept for a minute, so the
// page's retries got the same empty answer; it is now `no-store`.
import { describe, expect, it, vi } from 'vitest';

const feed = vi.hoisted(() => ({ within: null }));
const home = vi.hoisted(() => ({ refresh: vi.fn(async () => ({ ok: true })) }));

vi.mock('../../server/featureFeed.mjs', () => ({
  serveFeatureFeed: vi.fn(),
  serveFeatureFeedWithinLimit: vi.fn((params) => feed.within(params)),
  serveFeatureFeedWithBackup: vi.fn((params) => feed.within(params)),
  // F169 C4: the scheduled-store-first route; the store is out of this test.
  serveFeatureFeedStoredFirst: vi.fn((params) => feed.within(params)),
}));
vi.mock('../../server/homeApi.mjs', async (original) => ({ ...await original(), refreshHomeSnapshots: home.refresh }));

import handler, { API_CACHE } from '../../api/router.js';

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
const request = (method, route) => {
  const [path, query] = route.split('?');
  return { method, url: `/api/router?__route=${path}${query ? `&${query}` : ''}`, query: { __route: path }, headers: { host: 'localhost' } };
};

describe('/api/home/refresh is not on the live function (F167)', () => {
  it.each(['GET', 'POST'])('%s answers 404 and fetches nothing', async (method) => {
    const res = vercelResponse();
    await handler(request(method, 'home/refresh'), res);
    expect(res.statusCode).toBe(404);
    expect(home.refresh).not.toHaveBeenCalled();
  });
});

describe('a pending feature-feed answer is not kept (F168)', () => {
  it('stored records served with nothing to show: no-store', async () => {
    feed.within = vi.fn(async () => ({ ok: true, rows: [{ status: 'source_status', title: 'Live data is taking longer than usual.' }], source: { adapter: 'api' }, served: 'archive' }));
    const res = vercelResponse();
    await handler(request('GET', 'feature-feed?tier=national&feature=Cabinet%20Decisions'), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
  });

  it('stored records with rows are kept at the edge for a few seconds', async () => {
    feed.within = vi.fn(async () => ({ ok: true, rows: [{ title: 'A decision' }], source: { adapter: 'embedded' }, served: 'archive' }));
    const res = vercelResponse();
    await handler(request('GET', 'feature-feed?tier=national&feature=Cabinet%20Decisions'), res);
    expect(res.headers['vercel-cdn-cache-control']).toBe(API_CACHE.cdnArchive);
  });
});
