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
    // The first import of featureFeed.mjs compiles the whole loader, which can pass the default 5 s
    // when the full suite runs in one busy process.
  }, 30_000);

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
  }, 30_000);

  it('the client asks the server nothing for a planned module', async () => {
    const fetch = vi.fn(async () => { throw new Error('no request expected'); });
    vi.stubGlobal('fetch', fetch);
    const { fetchFeature } = await import('./featureFeed.js');
    const out = await fetchFeature({ tier: 'state', feature: 'District Crime & Safety Indicators' });
    expect(out.source.adapter).toBe('planned');
    expect(fetch.mock.calls.filter(([u]) => /\/api\/feature-feed/.test(String(u)))).toEqual([]);
  }, 30_000);

  it('maps the request tier names', () => {
    expect(isPlannedModule('local', 'Municipal & Panchayat Tender Aggregator')).toBe(true);
    expect(isPlannedModule('state', 'Cabinet Decisions')).toBe(false);
  });

  // F196: modules built from sources the repository already named (the party map from the MLA register).
  it('no longer lists the modules F196 built', () => {
    expect(PLANNED_MODULES.size).toBe(4);
    for (const [tier, feature] of [
      ['sports', 'Sports Governance & Policy'],
      ['state', "Governor Friction & President's Rule Tracker"],
      ['state', 'Legislative Productivity Comparison'],
      ['state', 'MLA Defection & Anti-defection Case Tracker'],
      ['economics', 'Election Forecast Aggregator'],
      ['state', 'Party Organisation Map'],
    ]) expect(isPlannedModule(tier, feature), feature).toBe(false);
  });

  // F196 batch 2: nine modules from the RBI Handbook of Statistics on Indian States and RBI's press releases.
  it('no longer lists the RBI handbook modules, the Comparison Engine or the SDL auctions', () => {
    for (const feature of [
      'State Economic Data (GSDP, sectors)', 'State Fiscal Deep-Dive', 'NITI Aayog State Indices', 'Cross-State Comparison Engine',
      'District Health & Nutrition Indicators', 'District Education Indicators', 'District Economic & Livelihood Indicators',
      'District Agriculture & Rural Indicators', 'District Infrastructure & Connectivity', 'SDL Auction & Borrowing Tracker',
    ]) expect(isPlannedModule('state', feature), feature).toBe(false);
    // No source yet (owner, 2026-10-15): these stay planned.
    expect([...PLANNED_MODULES].sort()).toEqual([
      'local:Municipal & Panchayat Tender Aggregator', 'state:District Crime & Safety Indicators',
      'state:District Governance & Grievance Indicators', 'state:State Tender Aggregator (State e-Procurement)',
    ]);
  });

  // F202 (module-quality audit 2026-10-15): the page answered "Module planned" (its scrape adapter
  // has no extraction) while the catalogue marked it configured and the landing counted it. The
  // owner will supply a source later; until then it is planned everywhere.
  it('State Tender Aggregator is planned, and the catalogue agrees', () => {
    expect(isPlannedModule('state', 'State Tender Aggregator (State e-Procurement)')).toBe(true);
    const entry = DESK_CATALOGUE.find((m) => m.id === 'state:State Tender Aggregator (State e-Procurement)');
    expect(entry.configured).toBe(false);
  });
});
