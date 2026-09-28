// POST /api/ai/desk-brief on Vercel (api/router.js → server/deskBrief.mjs)
// must never call a model provider itself: it forwards to the Supabase
// desk-brief function with the caller's bearer, and refuses without one.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  getEntryBrief: vi.fn(async () => null),
  upsertEntryBrief: vi.fn(async () => {}),
}));

import handler from '../../api/router.js';

const SUPABASE_URL = 'https://project-ref.supabase.test';
const PUBLISHABLE = 'sb_publishable_route_test';
const BEARER = 'Bearer header.payload.signature';

function vercelResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader: vi.fn((name, value) => { res.headers[name.toLowerCase()] = value; }),
    status: vi.fn((code) => { res.statusCode = code; return res; }),
    json: vi.fn((body) => { res.body = body; return res; }),
    end: vi.fn(() => res),
  };
  return res;
}

function vercelRequest(method, { body, headers = {}, query = {} } = {}) {
  const search = new URLSearchParams({ __route: 'ai/desk-brief', ...query });
  return {
    method,
    url: `/api/router?${search}`,
    query: { __route: 'ai/desk-brief', ...query },
    headers: { host: 'localhost', ...headers },
    body,
  };
}

const uniqueHash = () => `route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const payload = (over = {}) => ({
  feature: 'Bills',
  tier: 'Legislative',
  hash: uniqueHash(),
  scope: 'substance',
  force: true,
  sourceNote: 'Source PDF from example.gov',
  sourceExtract: 'An Act to amend the tariff.',
  row: { title: 'Customs Tariff (Amendment) Bill', status: 'Passed' },
  ...over,
});

const BRIEF = {
  ok: true,
  headline: 'The Act amends the customs tariff schedule',
  summary: ['Purpose: revise duty rates', 'What it changes: two schedules'],
  findings: [],
  kpis: [],
  confidence: 'moderate',
  model: 'google/gemini-3.5-flash-lite',
  generatedAt: '2026-09-28T10:00:00.000Z',
};

const upstream = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api/router.js POST /api/ai/desk-brief', () => {
  let fetchMock;
  const saved = {};

  beforeEach(() => {
    for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'OPENROUTER_API_KEY']) saved[k] = process.env[k];
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_ANON_KEY = PUBLISHABLE;
    delete process.env.OPENROUTER_API_KEY;
    fetchMock = vi.fn(async (_url, init) => upstream(200, { ...BRIEF, hash: JSON.parse(init.body).hash }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('returns 401 without a bearer and makes no network call', async () => {
    const res = vercelResponse();
    await handler(vercelRequest('POST', { body: payload() }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 401 for a non-bearer Authorization header and makes no network call', async () => {
    const res = vercelResponse();
    await handler(vercelRequest('POST', { body: payload(), headers: { authorization: 'Basic abc' } }), res);
    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards to the desk-brief function with the caller bearer and the publishable apikey', async () => {
    const body = payload();
    const res = vercelResponse();
    await handler(vercelRequest('POST', { body, headers: { authorization: BEARER } }), res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SUPABASE_URL}/functions/v1/desk-brief`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(BEARER);
    expect(init.headers.apikey).toBe(PUBLISHABLE);
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({
      feature: 'Bills',
      tier: 'Legislative',
      hash: body.hash,
      scope: 'substance',
      sourceNote: body.sourceNote,
      sourceExtract: body.sourceExtract,
      row: body.row,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, headline: BRIEF.headline, summary: BRIEF.summary, hash: body.hash });
  });

  it('never calls a model provider directly, even when a provider key is present', async () => {
    process.env.OPENROUTER_API_KEY = 'must-not-be-used';
    const res = vercelResponse();
    await handler(vercelRequest('POST', { body: payload(), headers: { authorization: BEARER } }), res);
    expect(res.statusCode).toBe(200);
    for (const [url] of fetchMock.mock.calls) expect(String(url)).not.toMatch(/openrouter/i);
    const source = fs.readFileSync(path.resolve(__dirname, '../../server/deskBrief.mjs'), 'utf8');
    expect(source).not.toMatch(/OPENROUTER_API_KEY|openrouter\.ai/);
  });

  it('caches a successful brief so the GET cache route serves it', async () => {
    const body = payload({ force: false, scope: 'entry' });
    await handler(vercelRequest('POST', { body, headers: { authorization: BEARER } }), vercelResponse());
    const res = vercelResponse();
    await handler(
      vercelRequest('GET', { query: { feature: body.feature, tier: body.tier, hash: body.hash, scope: 'entry' } }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, cached: true, headline: BRIEF.headline, hash: body.hash });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes an upstream 4xx through', async () => {
    fetchMock.mockResolvedValueOnce(upstream(413, { error: 'row is limited to 32768 bytes' }));
    const res = vercelResponse();
    await handler(vercelRequest('POST', { body: payload(), headers: { authorization: BEARER } }), res);
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ ok: false, error: 'row is limited to 32768 bytes' });
  });

  it('maps an upstream 5xx to a generic 502 or 503', async () => {
    fetchMock.mockResolvedValueOnce(upstream(500, { error: 'internal detail' }));
    let res = vercelResponse();
    await handler(vercelRequest('POST', { body: payload(), headers: { authorization: BEARER } }), res);
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('internal detail');

    fetchMock.mockResolvedValueOnce(upstream(503, { error: 'provider detail' }));
    res = vercelResponse();
    await handler(vercelRequest('POST', { body: payload(), headers: { authorization: BEARER } }), res);
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('provider detail');
  });

  it('maps a network failure to a generic 502', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('getaddrinfo ENOTFOUND project-ref.supabase.test'));
    const res = vercelResponse();
    await handler(vercelRequest('POST', { body: payload(), headers: { authorization: BEARER } }), res);
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('ENOTFOUND');
  });

  it('still returns 400 for a missing row without a network call', async () => {
    const res = vercelResponse();
    await handler(vercelRequest('POST', { body: payload({ row: null }), headers: { authorization: BEARER } }), res);
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
