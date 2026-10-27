import { describe, it, expect, vi, afterEach } from 'vitest';
import { serveLawListingPage } from '../../server/lawListingPage.mjs';
import { serveFeaturePage } from '../../server/featurePage.mjs';
import { serveLawLanding } from '../../server/lawLandingSummary.mjs';
import { documentKey, attachmentCoverageKey } from './deskRows.js';
import { projectLawSummary } from './lawLandingSummary.js';
import { refreshCoverage, resetCoverageCache } from './corpusCoverage.js';
const feature = 'NCLT / NCLAT (Insolvency)';
const key = 'law-record:12345678-1234-1234-1234-123456789abc';
const params = () => new URLSearchParams({ feature, page: '2', q: 'Globiz' });
const env = { SUPABASE_URL: 'https://db.invalid', SUPABASE_ANON_KEY: 'public-key', SUPABASE_SECRET_KEY: 'never-use' };
afterEach(resetCoverageCache);
describe('canonical Law serving', () => {
  it('uses bounded RPC pages under public credentials with authoritative totals', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ active: true, rows: [{ id: 'stable', title: 'Globiz', document_key: key }], total: 1, totalAll: 436, page: 2, pageSize: 100 }) }));
    const result = await serveLawListingPage(params(), { env, fetch });
    expect(result.body).toMatchObject({ paged: true, prepared: true, totalAll: 436, rows: [{ id: 'stable', document_key: key }] });
    expect(fetch.mock.calls[0][0]).toBe('https://db.invalid/rest/v1/rpc/law_listing_page');
    const request = fetch.mock.calls[0][1];
    expect(request.headers.apikey).toBe('public-key');
    expect(JSON.parse(request.body).p).toMatchObject({ page: 2, pageSize: 100, q: 'globiz', sort: 'date', dir: 'desc' });
    expect(JSON.stringify(request)).not.toContain('never-use');
  });
  it('only allows legacy fallback for an explicit inactive response and refuses missing configuration', async () => {
    await expect(serveLawListingPage(params(), { env: {} })).rejects.toThrow('configuration');
    expect(await serveLawListingPage(params(), { env, fetch: async () => ({ ok: true, json: async () => ({ active: false }) }) })).toBe(null);
    await expect(serveLawListingPage(params(), { env, fetch: async () => ({ ok: false, status: 503 }) })).rejects.toThrow();
    await expect(serveLawListingPage(params(), { env, fetch: async () => ({ ok: true, json: async () => ({}) }) })).rejects.toThrow();
  });
  it('does not turn a later empty page into an empty register count', () => {
    const summary = projectLawSummary({ ok: true, feature, paged: true, prepared: true, rows: [], totalAll: 436, source: { adapter: 'law-canonical' } });
    expect(summary).toMatchObject({ count: 436, countBasis: 'canonical-register', availability: 'ready' });
  });
  it('accepts only validated Law keys and keeps bill keys unchanged', () => {
    expect(documentKey({ document_key: key })).toBe(key);
    expect(documentKey({ document_key: 'law-record:not-a-uuid' })).toBe(null);
    expect(documentKey({ bill_number: '1', bill_name: 'Finance Bill, 2026' })).toBe('bill:2026:1');
  });
  it('resolves Law coverage through verified links rather than mutable document metadata', async () => {
    const client = { rpc: vi.fn(async () => ({ data: [{ document_key: key, document_id: 'doc' }], error: null })), from: vi.fn(() => { throw new Error('Law must not use metadata'); }) };
    expect(await refreshCoverage([key], client)).toEqual(new Set([key]));
    expect(client.rpc).toHaveBeenCalledWith('law_resolve_document_keys', { p_keys: [key] });
  });
});

it('canonical page and summary never load the full static register', async () => {
  const load = vi.fn(() => { throw new Error('must not read static'); });
  const options = { env, fetch: async () => ({ ok: true, json: async () => ({ active: true, rows: [], total: 436, totalAll: 436 }) }) };
  expect((await serveFeaturePage(params(), load, options)).body.totalAll).toBe(436);
  expect((await serveLawLanding(params(), load, options)).count).toBe(436);
  expect(load).not.toHaveBeenCalled();
});

it('keeps canonical pages and landing counts out of shared CDN caches', async () => {
  const { default: handler } = await import('../../api/router.js');
  vi.stubEnv('SUPABASE_URL', env.SUPABASE_URL); vi.stubEnv('SUPABASE_ANON_KEY', env.SUPABASE_ANON_KEY);
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ active: true, rows: [], total: 436, totalAll: 436 }) }));
  vi.stubGlobal('fetch', fetch);
  try {
    for (const route of ['feature-feed', 'law-landing']) {
      const req = { method: 'GET', url: `/api/${route}?${params()}`, headers: { host: 'localhost', authorization: 'Bearer caller-jwt' } };
      const headers = {};
      const res = { statusCode: 200, setHeader(k,v) { headers[k.toLowerCase()] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; }, end() {} };
      await handler(req,res);
      expect(res.statusCode).toBe(200);
      expect(headers['cache-control']).toBe('no-store');
      expect(headers['vercel-cdn-cache-control']).toBeUndefined();
    }
    expect(fetch.mock.calls.every(([,options]) => options.headers.Authorization === 'Bearer caller-jwt')).toBe(true);
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

it('Law coverage errors leave availability unknown rather than claiming missing text', async () => {
  const { coverageOf } = await import('./corpusCoverage.js');
  const client = { rpc: async () => ({ data: null, error: { message: 'denied' } }) };
  const row = {kind:'row',tab:'law',feature,row_key:'order-1',document_key:key};
  const indexed = await refreshCoverage([attachmentCoverageKey(row)], client);
  expect(coverageOf(row, indexed)).toBeNull();
  expect(coverageOf({kind:'row',document_key:key}, indexed)).toBe('unmapped');
});
