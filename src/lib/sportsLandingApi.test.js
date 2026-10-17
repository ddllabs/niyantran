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

describe('World League source completeness', () => {
  it('uses the documented free configuration and accounts for every league and window', async () => {
    vi.resetModules();
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async input => {
      const url = new URL(String(input)); calls.push(url);
      if (!url.pathname.includes('/123/')) return new Response('', { status: 403 });
      const id = url.searchParams.get('id');
      return Response.json({ events: [{ idEvent: `${id}-${url.pathname.includes('past') ? 'past' : 'next'}`, strEvent: `Event ${id}`, dateEvent: '2026-10-17' }] });
    }));
    try {
      const { loadWorldFixtures } = await import('../../server/sportsApi.mjs');
      const answer = await loadWorldFixtures();
      expect(answer.ok).toBe(true);
      expect(answer.rows).toHaveLength(8);
      expect(answer.coverage).toHaveLength(4);
      expect(answer.coverage.every(c => c.next === 'ok' && c.past === 'ok')).toBe(true);
      expect(calls).toHaveLength(8);
    } finally { vi.unstubAllGlobals(); vi.resetModules(); }
  });

  it('a failed league is partial, while a verified empty window is not a failed request', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async input => {
      const url = new URL(String(input));
      if (url.searchParams.get('id') === '4387') return new Response('', { status: 429 });
      return Response.json({ events: null });
    }));
    try {
      const { loadWorldFixtures } = await import('../../server/sportsApi.mjs');
      const answer = await loadWorldFixtures();
      expect(answer.ok).toBe(false);
      expect(answer.coverage.find(c => c.league === 'NBA')).toMatchObject({ next: 'failed', past: 'failed' });
      expect(answer.coverage.find(c => c.league === 'Premier League')).toMatchObject({ next: 'empty', past: 'empty' });
    } finally { vi.unstubAllGlobals(); vi.resetModules(); }
  });
});
