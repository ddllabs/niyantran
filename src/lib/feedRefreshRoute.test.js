// F169 phase 4 (C3): POST /api/feeds/refresh, which the pg_cron job calls through pg_net. It stays
// dormant until FEED_REFRESH_SECRET is set, checks the secret timing-safely, answers only POST,
// is never cached, and never shows the secret in an answer or a log.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleFeedRefresh } from '../../server/feedStore.mjs';
import routerHandler from '../../api/router.js';

const SECRET = 'feed-refresh-test-secret-7f3a9c';

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; },
    getHeader(k) { return res.headers[k.toLowerCase()]; },
    end(chunk) { if (chunk != null) res.body += String(chunk); res.ended = true; },
  };
  // The Vercel helpers api/router.js uses.
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return res; };
  return res;
}

const req = (method, headers = {}) => ({ method, url: '/api/feeds/refresh', headers: { host: 'localhost', ...headers } });

describe('handleFeedRefresh', () => {
  let logs;
  beforeEach(() => {
    logs = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
      vi.spyOn(console, m).mockImplementation((...args) => { logs.push(args.map(String).join(' ')); });
    }
  });
  afterEach(() => vi.restoreAllMocks());

  const expectNoSecret = (res) => {
    expect(res.body).not.toContain(SECRET);
    expect(JSON.stringify(res.headers)).not.toContain(SECRET);
    for (const line of logs) expect(line).not.toContain(SECRET);
  };

  it('answers 503 and runs nothing while FEED_REFRESH_SECRET is missing or empty', async () => {
    for (const env of [{}, { FEED_REFRESH_SECRET: '' }, { FEED_REFRESH_SECRET: '   ' }]) {
      const refresh = vi.fn();
      const res = fakeRes();
      await handleFeedRefresh(req('POST', { 'x-feed-refresh-secret': SECRET }), res, { refresh, env });
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body)).toMatchObject({ ok: false, error: expect.stringMatching(/not configured/i) });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(refresh).not.toHaveBeenCalled();
      expectNoSecret(res);
    }
  });

  it('answers 401 to a missing, wrong, longer, shorter or repeated secret', async () => {
    const env = { FEED_REFRESH_SECRET: SECRET };
    const tries = [{}, { 'x-feed-refresh-secret': 'wrong' }, { 'x-feed-refresh-secret': `${SECRET}x` },
      { 'x-feed-refresh-secret': SECRET.slice(0, -1) }, { 'x-feed-refresh-secret': [SECRET, SECRET] },
      { authorization: `Bearer ${SECRET}` }];
    for (const headers of tries) {
      const refresh = vi.fn();
      const res = fakeRes();
      await handleFeedRefresh(req('POST', headers), res, { refresh, env });
      expect(res.statusCode, JSON.stringify(Object.keys(headers))).toBe(401);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(refresh).not.toHaveBeenCalled();
      expect(res.body).not.toContain(SECRET);
    }
    for (const line of logs) expect(line).not.toContain(SECRET);
  });

  it('runs the refresh with the right secret and answers its summary as JSON, not cached', async () => {
    const summary = { ok: true, claimed: 2, counts: { ok: 2 }, ms: 10 };
    const refresh = vi.fn(async () => summary);
    const res = fakeRes();
    await handleFeedRefresh(req('POST', { 'x-feed-refresh-secret': SECRET }), res, { refresh, env: { FEED_REFRESH_SECRET: SECRET } });
    expect(res.statusCode).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.body)).toEqual(summary);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expectNoSecret(res);
  });

  it('answers 405 to anything but POST, before looking at the secret', async () => {
    for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) {
      const refresh = vi.fn();
      const res = fakeRes();
      await handleFeedRefresh(req(method, { 'x-feed-refresh-secret': SECRET }), res, { refresh, env: { FEED_REFRESH_SECRET: SECRET } });
      expect(res.statusCode, method).toBe(405);
      expect(res.headers.allow).toBe('POST');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(refresh).not.toHaveBeenCalled();
    }
  });

  it('answers 502 without detail when the refresh fails, and 503 when the store is not configured', async () => {
    const env = { FEED_REFRESH_SECRET: SECRET };
    const failing = fakeRes();
    await handleFeedRefresh(req('POST', { 'x-feed-refresh-secret': SECRET }), failing, {
      env, refresh: async () => { throw new Error(`database said no (${SECRET})`); },
    });
    expect(failing.statusCode).toBe(502);
    expect(failing.headers['cache-control']).toBe('no-store');
    expectNoSecret(failing);

    const unconfigured = fakeRes();
    await handleFeedRefresh(req('POST', { 'x-feed-refresh-secret': SECRET }), unconfigured, {
      env, refresh: async () => { throw Object.assign(new Error('Supabase is not configured'), { code: 'not_configured' }); },
    });
    expect(unconfigured.statusCode).toBe(503);
  });
});

describe('api/router.js /api/feeds/refresh', () => {
  afterEach(() => vi.unstubAllEnvs());

  const routed = (method, headers = {}) => ({
    method,
    url: '/api/router?__route=feeds/refresh',
    query: { __route: 'feeds/refresh' },
    headers: { host: 'localhost', ...headers },
  });

  it('is wired: 503 without the secret, 401 with a wrong one, 405 for GET, always no-store', async () => {
    vi.stubEnv('FEED_REFRESH_SECRET', '');
    let res = fakeRes();
    await routerHandler(routed('POST', { 'x-feed-refresh-secret': SECRET }), res);
    expect(res.statusCode).toBe(503);
    expect(res.headers['cache-control']).toBe('no-store');

    vi.stubEnv('FEED_REFRESH_SECRET', SECRET);
    res = fakeRes();
    await routerHandler(routed('POST', { 'x-feed-refresh-secret': 'nope' }), res);
    expect(res.statusCode).toBe(401);
    expect(res.headers['cache-control']).toBe('no-store');

    res = fakeRes();
    await routerHandler(routed('GET', { 'x-feed-refresh-secret': SECRET }), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).not.toContain(SECRET);
  });

  it('with the right secret, reaches the store (here unconfigured, so 503 and no outside request)', async () => {
    vi.stubEnv('FEED_REFRESH_SECRET', SECRET);
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    const original = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    try {
      const res = fakeRes();
      await routerHandler(routed('POST', { 'x-feed-refresh-secret': SECRET }), res);
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).error).toMatch(/not configured/i);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
