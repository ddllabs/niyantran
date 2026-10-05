import { describe, it, expect, vi } from 'vitest';
import handler from '../../api/router.js';
import { handleFeatureFeedRequest } from '../../server/featureFeed.mjs';
import { serveGlobalLanding } from '../../server/globalLandingSummary.mjs';

describe('Global summary API', () => {
  it('enforces GET and canonical validation in both routers', async () => {
    for (const method of ['POST', 'GET']) for (const local of [false, true]) {
      const req = { method, url: '/api/global-landing?feature=unknown', headers: { host: 'localhost' } };
      const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, end(body) { this.body = JSON.parse(body); } };
      if (local) await handleFeatureFeedRequest(req, res, () => { throw new Error('Skipped'); }); else await handler(req, res);
      expect(res.statusCode).toBe(method === 'POST' ? 405 : 400);
    }
  });
  it('loads the same canonical geopolitics feed and returns a bounded projection', async () => {
    const load = vi.fn(async () => ({ ok: true, rows: [{ title: 'Site', lat: 47, lon: 34 }], source: { adapter: 'embedded' } }));
    const summary = await serveGlobalLanding(new URLSearchParams({ feature: 'Nuclear Watch', tier: 'national' }), load);
    expect(load.mock.calls[0][0].get('tier')).toBe('geopolitics');
    expect(summary.count).toBe(1); expect(summary).not.toHaveProperty('rows');
    expect(JSON.stringify(summary).length).toBeLessThan(30000);
    await expect(serveGlobalLanding(new URLSearchParams({ feature: '../secret' }), load)).rejects.toThrow('Unknown');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
