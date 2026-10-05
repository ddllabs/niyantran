import { describe, it, expect, vi } from 'vitest';
import handler from '../../api/router.js';
import { handleFeatureFeedRequest } from '../../server/featureFeed.mjs';
import { serveNationalLanding } from '../../server/nationalLandingSummary.mjs';
import { NATIONAL_FEATURES } from './nationalLandingSummary.js';
import { modulesForTier } from '../desks/catalog.js';
describe('National summary API', () => {
  it('enforces GET and feature validation in both local and Vercel routers', async () => {
    for (const method of ['POST', 'GET']) for (const local of [false, true]) {
      const req = { method, url: '/api/national-landing?feature=unknown', headers: { host: 'localhost' } };
      const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, end(body) { this.body = body ? JSON.parse(body) : null; } };
      if (local) await handleFeatureFeedRequest(req, res, () => { throw new Error('Route skipped'); });
      else await handler(req, res);
      expect(res.statusCode).toBe(method === 'POST' ? 405 : 400);
      expect(res.body.ok).toBe(false);
    }
  });
  it('keeps its whitelist synchronized with the catalog', () => {
    expect(NATIONAL_FEATURES).toEqual(modulesForTier('national').map(m => m.htmlFeature));
  });
  it('rejects arbitrary tiers/features before requesting a feed', async () => {
    const load = vi.fn();
    await expect(serveNationalLanding(new URLSearchParams({ feature: '../../secret' }), load)).rejects.toThrow('Unknown');
    expect(load).not.toHaveBeenCalled();
  });
  it('reuses one in-flight bill register for the graph and sends no full rows', async () => {
    let finish;
    const load = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const bill = serveNationalLanding(new URLSearchParams({ feature: NATIONAL_FEATURES[0] }), load);
    const graph = serveNationalLanding(new URLSearchParams({ feature: NATIONAL_FEATURES[1] }), load);
    finish({ ok: true, rows: [{ title: 'Bill', sector: 'Finance', house: 'LS' }], source: { adapter: 'embedded', links: [] } });
    const [a, b] = await Promise.all([bill, graph]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a.count).toBe(1); expect(b.count).toBe(1);
    expect(b.feature).toBe(NATIONAL_FEATURES[1]);
    expect(b.columns).toContainEqual({ key: 'sector', label: 'Sector' });
    expect(JSON.stringify(a).length).toBeLessThan(30000);
    expect(a).not.toHaveProperty('rows');
  });
});
