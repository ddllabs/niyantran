import { describe, it, expect, vi } from 'vitest';
import handler from '../../api/router.js';
import { handleFeatureFeedRequest } from '../../server/featureFeed.mjs';
import { serveLawLanding } from '../../server/lawLandingSummary.mjs';

describe('Law summary API', () => {
  it('enforces GET and canonical validation in both routers', async () => {
    for (const method of ['POST', 'GET']) for (const local of [false, true]) {
      const req = { method, url: '/api/law-landing?feature=unknown', headers: { host: 'localhost' } };
      const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, end(body) { this.body = JSON.parse(body); } };
      if (local) await handleFeatureFeedRequest(req, res, () => { throw new Error('Skipped'); }); else await handler(req, res);
      expect(res.statusCode).toBe(method === 'POST' ? 405 : 400);
    }
  });
  it('loads the same canonical judiciary feed and returns a bounded projection', async () => {
    const load = vi.fn(async () => ({ ok: true, rows: [{ title: 'Site', lat: 47, lon: 34 }], source: { adapter: 'embedded' } }));
    const summary = await serveLawLanding(new URLSearchParams({ feature: 'Supreme Court Order & Judgment Feed', tier: 'national' }), load);
    expect(load.mock.calls[0][0].get('tier')).toBe('judiciary');
    expect(summary.count).toBe(1); expect(summary).not.toHaveProperty('rows');
    expect(JSON.stringify(summary).length).toBeLessThan(30000);
    await expect(serveLawLanding(new URLSearchParams({ feature: '../secret' }), load)).rejects.toThrow('Unknown');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
