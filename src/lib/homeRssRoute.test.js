import { afterEach, expect, it, vi } from 'vitest';
const rss = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../server/newsPublisher.mjs', () => ({ servePublisherNews: rss.read }));
import handler from '../../api/router.js';
afterEach(() => vi.useRealTimers());
function response() {
  return { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; }, end() { return this; } };
}
const request = (method = 'GET', query = '') => ({ method, url: `/api/home/latest?${query}`, query: {}, headers: { host: 'localhost' } });
it('bounds CDN freshness by the last source check, supports HEAD and bypasses caching on manual refresh', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));
  rss.read.mockResolvedValue({ ok: true, stale: false, checked_at: '2026-10-24T23:59:00Z', rows: [] });
  const get = response(); await handler(request(), get);
  expect(get.headers['vercel-cdn-cache-control']).toBe('public, s-maxage=240');
  const head = response(); await handler(request('HEAD'), head);
  expect(head.statusCode).toBe(200); expect(head.body).toBeUndefined();
  const fresh = response(); await handler(request('GET', '&fresh=1&limit=8'), fresh);
  expect(fresh.headers['cache-control']).toBe('no-store');
  expect(rss.read).toHaveBeenLastCalledWith({ limit: '8', fresh: true });
});
it('does not cache stale or unavailable stories and rejects mutation methods', async () => {
  for (const body of [{ ok: true, stale: true }, { ok: false, stale: true }]) {
    rss.read.mockResolvedValue({ ...body, rows: [], checked_at: new Date().toISOString() });
    const res = response(); await handler(request(), res);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.statusCode).toBe(body.ok ? 200 : 503);
  }
  rss.read.mockClear();
  const res = response(); await handler(request('POST'), res);
  expect(res.statusCode).toBe(405); expect(rss.read).not.toHaveBeenCalled();
});
