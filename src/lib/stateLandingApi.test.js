// F157: /api/state-landing, the State desk landing's count-only route.
import { describe, it, expect, vi } from 'vitest';
import handler from '../../api/router.js';
import { handleFeatureFeedRequest } from '../../server/featureFeed.mjs';
import { serveStateLanding } from '../../server/stateLandingSummary.mjs';
import { STATE_FEATURES, STATE_MODULES } from './stateLandingSummary.js';
import featureMap from '../data/html-feature-map.json';

const call = async (local, method, query) => {
  const req = { method, url: `/api/state-landing?${query}`, headers: { host: 'localhost' } };
  const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, end(body) { this.body = body ? JSON.parse(body) : null; } };
  if (local) await handleFeatureFeedRequest(req, res, () => { throw new Error('Route skipped'); });
  else await handler(req, res);
  return res;
};

describe('State summary API (F157)', () => {
  it('enforces GET and module validation in both the local and the Vercel router', async () => {
    for (const local of [false, true]) {
      expect((await call(local, 'POST', 'feature=Constituency%20Register')).statusCode).toBe(405);
      for (const query of ['feature=unknown', 'feature=District%20Crime%20%26%20Safety%20Indicators', '']) {
        const res = await call(local, 'GET', query);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ ok: false, error: 'State summary unavailable' });
      }
    }
  });

  it('answers a count without rows from both routers', async () => {
    for (const local of [false, true]) {
      const res = await call(local, 'GET', 'feature=Booth-level%20Results%20Database');
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ ok: true, version: 1, tier: 'local', feature: 'Booth-level Results Database', count: 1731, unit: 'booth records', availability: 'ready' });
      expect(res.body).not.toHaveProperty('rows');
      expect(JSON.stringify(res.body).length).toBeLessThan(8000);
    }
  });

  it('answers only modules the feed knows, in the tier the catalogue gives them', () => {
    expect(STATE_FEATURES).toHaveLength(37); // F173: two more State modules are planned; F196 built four, then ten; F202 planned the State Tender Aggregator
    for (const feature of STATE_FEATURES) {
      const module = STATE_MODULES.find(item => item.feature === feature);
      expect(featureMap.filter(row => row.htmlFeature === feature).map(row => row.htmlTier)).toContain(module.tier);
    }
  });

  it('asks the feed for the catalogue tier and module, whatever the request adds', async () => {
    const load = vi.fn(async params => ({ ok: true, tier: params.get('tier'), feature: params.get('feature'), rows: [{ title: 'Booth 1' }], source: { adapter: 'embedded', kind: 'geo-pack' }, served: 'live' }));
    const summary = await serveStateLanding(new URLSearchParams({ feature: 'Booth Political History', tier: 'state' }), load);
    expect(Object.fromEntries(load.mock.calls[0][0])).toEqual({ tier: 'local', feature: 'Booth Political History' });
    expect(summary).toMatchObject({ ok: true, tier: 'local', count: 1, served: 'live' });
  });

  it('rejects unknown and planned modules before requesting a feed', async () => {
    const load = vi.fn();
    for (const feature of ['../../secret', 'District Crime & Safety Indicators', 'Bill Passage Probability Index']) {
      await expect(serveStateLanding(new URLSearchParams({ feature }), load)).rejects.toThrow('Unknown State module');
    }
    expect(load).not.toHaveBeenCalled();
  });

  it('marks a count pending only when the live source missed its time limit and nothing was counted', async () => {
    const feature = 'Cabinet Decisions';
    const statusOnly = served => async () => ({ ok: true, tier: 'state', feature, rows: [{ status: 'source_status' }], source: { adapter: 'news-search' }, served });
    expect(await serveStateLanding(new URLSearchParams({ feature }), statusOnly('archive'))).toMatchObject({ ok: false, count: null, availability: 'error', served: 'archive' });
    expect(await serveStateLanding(new URLSearchParams({ feature }), statusOnly('live'))).toMatchObject({ ok: true, count: null, availability: 'unavailable', served: 'live' });
    const stored = async () => ({ ok: true, tier: 'state', feature, rows: [{ title: 'Decision', source_url: 'https://pib.gov.in/x' }], source: { adapter: 'news-search' }, served: 'archive' });
    expect(await serveStateLanding(new URLSearchParams({ feature }), stored)).toMatchObject({ ok: true, count: 1, availability: 'ready', served: 'archive' });
  });

  it('a pending count is answered 502 and never kept by the CDN', async () => {
    vi.resetModules();
    vi.doMock('../../server/featureFeed.mjs', () => ({
      serveFeatureFeed: vi.fn(),
      serveFeatureFeedWithinLimit: vi.fn(),
      serveFeatureFeedWithBackup: vi.fn(async params => ({ ok: true, tier: params.get('tier'), feature: params.get('feature'), rows: [], source: { adapter: 'news-search' }, served: 'archive' })),
    }));
    try {
      const { default: mocked } = await import('../../api/router.js');
      const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, end() {} };
      await mocked({ method: 'GET', url: '/api/state-landing?feature=Cabinet%20Decisions', headers: { host: 'localhost' } }, res);
      expect(res.statusCode).toBe(502);
      expect(res.body).toMatchObject({ ok: false, availability: 'error', served: 'archive', feature: 'Cabinet Decisions' });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
    } finally {
      vi.doUnmock('../../server/featureFeed.mjs');
      vi.resetModules();
    }
  });
});
