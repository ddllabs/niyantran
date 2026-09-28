// api/router.js: source extraction fetches a caller-supplied URL, so it needs
// a signed-in active account; the unused raw fetch route is gone.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const extract = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../server/sourceExtract.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  extractSource: vi.fn(async () => { extract.calls += 1; return { url: 'https://example.org/a/b/c', kind: 'text', text: '' }; }),
}));

import handler from '../../api/router.js';

function response() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader: vi.fn((k, v) => { res.headers[k.toLowerCase()] = v; }),
    status: vi.fn((code) => { res.statusCode = code; return res; }),
    json: vi.fn((body) => { res.body = body; return res; }),
    end: vi.fn((raw) => { if (raw !== undefined) res.body = JSON.parse(raw); return res; }),
  };
  return res;
}

function request(route, query, headers = {}) {
  const url = `/api/router?__route=${route}&${new URLSearchParams(query)}`;
  return { method: 'GET', url, query: { __route: route, ...query }, headers: { host: 'localhost', ...headers } };
}

beforeEach(() => { extract.calls = 0; });

describe('AI source routes', () => {
  it('refuses source extraction without a bearer and fetches nothing', async () => {
    const res = response();
    await handler(request('ai/source-extract', { url: 'https://example.org/docs/bill/text.pdf' }), res);
    expect(res.statusCode).toBe(401);
    expect(extract.calls).toBe(0);
  });

  it('no longer serves the raw fetch route', async () => {
    const res = response();
    await handler(request('ai/fetch', { url: 'https://example.org/a/b/c' }), res);
    expect(res.statusCode).toBe(404);
    expect(extract.calls).toBe(0);
  });
});
