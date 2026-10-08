import handler from '../../api/router.js';
import { handleFeatureFeedRequest } from '../../server/featureFeed.mjs';
import { describe, it, expect, vi } from 'vitest';
import { serveSportsLanding } from '../../server/sportsLandingSummary.mjs';
import { SPORTS_FEATURES } from './sportsLandingSummary.js';
describe('Sports summary boundary', () => {
  it.each(SPORTS_FEATURES)('forces canonical sports tier for %s', async feature => {
    const load = vi.fn(async () => ({ ok: true, rows: [], source: { adapter: 'api' } }));
    const summary = await serveSportsLanding(new URLSearchParams({ feature, tier: 'national' }), load);
    expect(load.mock.calls[0][0].get('tier')).toBe('sports');
    expect(load.mock.calls[0][0].get('feature')).toBe(feature);
    expect(summary).toMatchObject({ feature, resourceKey: feature, version: 1 });
    expect(summary).not.toHaveProperty('rows');
  });
  it('rejects unknown before fetching', async () => {
    const load = vi.fn();
    await expect(serveSportsLanding(new URLSearchParams({ feature: '../secret' }), load)).rejects.toThrow('Unknown');
    expect(load).not.toHaveBeenCalled();
  });
  it('retains safe useful source metadata for provider failure', async () => {
    const summary = await serveSportsLanding(new URLSearchParams({ feature: SPORTS_FEATURES[0] }), async () => ({ ok: false, rows: [], source: { adapter: 'api', links: ['https://sportspricingdashboard.worldbank.org/'] } }));
    expect(summary).toMatchObject({ count: null, availability: 'error', sources: [{ name: 'sportspricingdashboard.worldbank.org', url: 'https://sportspricingdashboard.worldbank.org/' }] });
  });
});


describe('Sports API registration', () => {
  it('enforces GET and exact feature allowlisting in local and deployed routers', async () => {
    for (const method of ['POST','GET']) for (const local of [false,true]) {
      const req={method,url:'/api/sports-landing?feature=unknown',headers:{host:'localhost'}};
      const res={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;},end(body){this.body=JSON.parse(body);}};
      if(local) await handleFeatureFeedRequest(req,res,()=>{throw new Error('Skipped');}); else await handler(req,res);
      expect(res.statusCode).toBe(method==='POST'?405:400);
    }
  });
});
