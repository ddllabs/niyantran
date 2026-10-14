import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';
import { PLANNED_MODULES, isPlannedModule } from './plannedModules.js';

// F173 (F171 B9): four unbuilt modules showed news rows or an empty state instead of "Module
// planned", and the server fetched news for all 19 though no page showed it.
describe('planned modules', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('the catalogue marks exactly the planned modules as not configured', () => {
    const notConfigured = DESK_CATALOGUE.filter((m) => m.configured === false).map((m) => m.id).sort();
    expect(notConfigured).toEqual([...PLANNED_MODULES].sort());
  });

  it('the server answers a planned module without fetching anything', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => '', headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }));
    vi.stubGlobal('fetch', fetch);
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    for (const id of PLANNED_MODULES) {
      const [tier, feature] = id.split(/:(.*)/s);
      const out = await serveFeatureFeed(new URLSearchParams({ tier, feature }));
      expect(out.rows, id).toEqual([]);
      expect(out.source.adapter, id).toBe('planned');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('the deployed route keeps a planned module planned (no stored rows borrowed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => '', headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) })));
    const { serveFeatureFeedWithBackup } = await import('../../server/featureFeed.mjs');
    for (const id of PLANNED_MODULES) {
      const [tier, feature] = id.split(/:(.*)/s);
      const out = await serveFeatureFeedWithBackup(new URLSearchParams({ tier, feature }), { limitMs: 2000 });
      expect(out.rows.filter((r) => r?.status !== 'source_status'), id).toEqual([]);
    }
  }, 60_000);

  it('the record loader skips planned modules', async () => {
    const { loadableModules } = await import('./deskRowsFeed.js');
    const ids = loadableModules().map(({ mod }) => `${mod.htmlTier}:${mod.htmlFeature}`);
    for (const id of PLANNED_MODULES) expect(ids, id).not.toContain(id);
  });

  it('the client asks the server nothing for a planned module', async () => {
    const fetch = vi.fn(async () => { throw new Error('no request expected'); });
    vi.stubGlobal('fetch', fetch);
    const { fetchFeature } = await import('./featureFeed.js');
    const out = await fetchFeature({ tier: 'sports', feature: 'Sports Governance & Policy' });
    expect(out.source.adapter).toBe('planned');
    expect(fetch.mock.calls.filter(([u]) => /\/api\/feature-feed/.test(String(u)))).toEqual([]);
  });

  it('maps the request tier names', () => {
    expect(isPlannedModule('economics', 'Election Forecast Aggregator')).toBe(true);
    expect(isPlannedModule('state', 'Cabinet Decisions')).toBe(false);
  });
});
