// The Vite dev server serves /api/ai/desk-brief through handleAiApi. Like the
// Vercel route, it must forward the caller's bearer to the desk-brief Edge
// Function, and a missing bearer is 401 (not 400) with no network call.
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAiApi } from '../../server/aiApi.mjs';

function request(body, headers = {}) {
  const req = new EventEmitter();
  Object.assign(req, { method: 'POST', url: '/api/ai/desk-brief', headers: { host: 'localhost', ...headers } });
  queueMicrotask(() => {
    req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req;
}

async function invoke(req) {
  const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
  await handleAiApi(req, res, vi.fn());
  return { status: res.statusCode, body: JSON.parse(res.end.mock.calls[0][0]) };
}

const payload = () => ({ feature: 'Bills', tier: 'Legislative', row: { title: `Bill ${Math.random()}` }, force: true, scope: 'substance' });

describe('dev /api/ai/desk-brief', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, headline: 'H', summary: ['Purpose: x'] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('forwards the caller bearer to the desk-brief Edge Function', async () => {
    const out = await invoke(request(payload(), { authorization: 'Bearer caller.jwt' }));
    expect(out.status).toBe(200);
    expect(out.body.headline).toBe('H');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/functions\/v1\/desk-brief$/);
    expect(init.headers.Authorization ?? init.headers.authorization).toBe('Bearer caller.jwt');
  });

  it('answers 401 without a bearer and makes no network call', async () => {
    const out = await invoke(request(payload()));
    expect(out.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
