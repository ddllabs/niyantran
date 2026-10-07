import { describe, it, expect, vi } from 'vitest';
import { serveEconomicsLanding } from '../../server/economicsLandingSummary.mjs';
import handler from '../../api/router.js';
import { handleFeatureFeedRequest } from '../../server/featureFeed.mjs';
import { ECONOMICS_FEATURES } from './economicsLandingSummary.js';
describe('Economics summary boundary', () => {
  it.each(ECONOMICS_FEATURES)('forces canonical finance feed for %s', async feature => {
    const load = vi.fn(async () => ({ ok: true, rows: [], source: { adapter: 'api', links: ['https://data.worldbank.org/'] } }));
    const summary = await serveEconomicsLanding(new URLSearchParams({ feature, tier: 'national' }), load);
    expect(load.mock.calls[0][0].get('tier')).toBe('finance');
    expect(load.mock.calls[0][0].get('feature')).toBe(feature);
    expect(summary).toMatchObject({ feature, resourceKey: feature, version: 1 });
    expect(summary).not.toHaveProperty('rows');
  });
  it('rejects unknown without fetching', async () => {
    const load = vi.fn();
    await expect(serveEconomicsLanding(new URLSearchParams({ feature: '../secret' }), load)).rejects.toThrow('Unknown');
    expect(load).not.toHaveBeenCalled();
  });
  it('preserves source metadata on provider failure without inventing zero', async () => {
    const summary = await serveEconomicsLanding(new URLSearchParams({ feature: ECONOMICS_FEATURES[1] }), async () => ({ ok: false, rows: [], source: { adapter: 'api', links: ['https://finance.yahoo.com/'] } }));
    expect(summary).toMatchObject({ count: null, availability: 'error', sources: [{ name: 'finance.yahoo.com', url: 'https://finance.yahoo.com/' }] });
  });
});


describe('Economics API registration', () => {
  it('enforces GET and exact feature allowlisting in both local and deployed routers', async () => {
    for (const method of ['POST', 'GET']) for (const local of [false, true]) {
      const req = { method, url: '/api/economics-landing?feature=unknown', headers: { host: 'localhost' } };
      const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, end(body) { this.body = JSON.parse(body); } };
      if (local) await handleFeatureFeedRequest(req, res, () => { throw new Error('Skipped'); }); else await handler(req, res);
      expect(res.statusCode).toBe(method === 'POST' ? 405 : 400);
    }
  });
});
