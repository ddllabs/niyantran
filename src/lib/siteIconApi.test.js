import { describe, expect, it } from 'vitest';
import { handleSiteIconRequest, siteIconApiPlugin, siteIconHost } from '../../server/siteIconApi.mjs';

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: undefined, ended: false };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = (b) => { res.body = b; res.ended = true; };
  return res;
}

function upstream(status, type, bytes) {
  return async (url, init) => {
    upstream.calls.push({ url, init });
    return new Response(bytes ?? new Uint8Array([1, 2, 3]), { status, headers: { 'content-type': type } });
  };
}
upstream.calls = [];

async function call(domain, fetchImpl, method = 'GET') {
  const res = fakeRes();
  let passed = false;
  const q = domain === undefined ? '' : `?domain=${encodeURIComponent(domain)}`;
  await handleSiteIconRequest({ url: `/api/site-icon${q}`, method, headers: { host: 'x' } }, res, () => { passed = true; }, { fetchImpl });
  return { res, passed };
}

describe('siteIconHost', () => {
  it('accepts ordinary hosts', () => {
    for (const h of ['reuters.com', 'pib.gov.in', 'en.wikipedia.org', 'xn--h2brj9c.xn--h2brj9c', 'a-b.co']) expect(siteIconHost(h)).toBe(h);
  });
  it('refuses IP literals, reserved names, uppercase, paths and overlong hosts', () => {
    const bad = ['127.0.0.1', '10.0.0.1', '[::1]', '::1', 'localhost', 'foo.localhost', 'printer.local', 'db.internal',
      'site.test', 'Reuters.com', 'reuters.com/x', 'reuters.com?x', 'user@reuters.com', 'reuters.com:443', 'com',
      '-bad.com', 'bad-.com', 'a..com', '', null, undefined, 1, `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`];
    for (const h of bad) expect(siteIconHost(h), String(h)).toBeNull();
  });
});

describe('handleSiteIconRequest', () => {
  it('passes other paths to the next handler', async () => {
    const res = fakeRes();
    let passed = false;
    await handleSiteIconRequest({ url: '/api/other', method: 'GET', headers: {} }, res, () => { passed = true; });
    expect(passed).toBe(true);
    expect(res.ended).toBe(false);
  });

  it('returns 400 for a refused host without calling upstream', async () => {
    upstream.calls = [];
    for (const d of ['127.0.0.1', 'localhost', 'Reuters.com', 'reuters.com/x', undefined]) {
      const { res } = await call(d, upstream(200, 'image/png'));
      expect(res.statusCode, String(d)).toBe(400);
    }
    expect(upstream.calls).toHaveLength(0);
  });

  it('asks only the fixed DuckDuckGo URL and returns the icon with cache headers', async () => {
    upstream.calls = [];
    const { res } = await call('reuters.com', upstream(200, 'image/x-icon'));
    expect(upstream.calls[0].url).toBe('https://icons.duckduckgo.com/ip3/reuters.com.ico');
    expect(upstream.calls[0].init.redirect).toBe('error');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/x-icon');
    expect(res.headers['cache-control']).toBe('public, max-age=86400, s-maxage=604800');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    expect([...res.body]).toEqual([1, 2, 3]);
  });

  it('returns a bare, cached 404 for a missing, SVG, HTML or oversized icon, a failure or a timeout', async () => {
    const cases = [
      upstream(404, 'image/png'),
      upstream(200, 'image/svg+xml'),
      upstream(200, 'text/html'),
      upstream(200, 'image/png', new Uint8Array(100 * 1024 + 1)),
      upstream(200, 'image/png', new Uint8Array(0)),
      async () => { throw new Error('network'); },
      async () => { throw new DOMException('timed out', 'TimeoutError'); },
    ];
    for (const fetchImpl of cases) {
      const { res } = await call('reuters.com', fetchImpl);
      expect(res.statusCode).toBe(404);
      expect(res.body).toBeUndefined();
      expect(res.headers['cache-control']).toBe('public, max-age=86400, s-maxage=86400');
    }
  });

  it('accepts an icon at exactly the size limit', async () => {
    const { res } = await call('reuters.com', upstream(200, 'image/png', new Uint8Array(100 * 1024)));
    expect(res.statusCode).toBe(200);
  });

  it('refuses other methods and sends no body for HEAD', async () => {
    expect((await call('reuters.com', upstream(200, 'image/png'), 'POST')).res.statusCode).toBe(405);
    const head = await call('reuters.com', upstream(200, 'image/png'), 'HEAD');
    expect(head.res.statusCode).toBe(200);
    expect(head.res.body).toBeUndefined();
  });
});

describe('siteIconApiPlugin', () => {
  // Vite calls a function returned from configureServer as a post-middleware hook, so the hooks
  // must return nothing (the local run caught `app()` being called with no request).
  it('registers one middleware and returns nothing from either hook', () => {
    const plugin = siteIconApiPlugin();
    for (const hook of ['configureServer', 'configurePreviewServer']) {
      const used = [];
      const server = { middlewares: { use: (fn) => { used.push(fn); return () => {}; } } };
      expect(plugin[hook](server), hook).toBeUndefined();
      expect(used).toHaveLength(1);
    }
  });
});
