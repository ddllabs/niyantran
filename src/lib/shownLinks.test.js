import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';

// F89 (F171 B1): modules listed GDELT's raw API address (which refuses every request) and
// ipm.mospi.gov.in (expired certificate, 2026-10-14) as their sources. Neither is shown now.
const HIDDEN = /api\.gdeltproject\.org|ipm\.mospi\.gov\.in/i;

describe('source links readers see (F89)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('no module answer lists a GDELT API address or the expired IPM site', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u) => ({ ok: false, status: 404, url: String(u), headers: new Headers(), text: async () => '', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) })));
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const bad = [];
    for (const m of DESK_CATALOGUE) {
      const out = await serveFeatureFeed(new URLSearchParams({ tier: m.tier, feature: m.feature })).catch(() => null);
      for (const link of out?.source?.links || []) if (HIDDEN.test(link)) bad.push(`${m.id}: ${link}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('the stored-copy answer built in the browser lists neither', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u) => ({ ok: false, status: 404, url: String(u), headers: new Headers(), text: async () => '', json: async () => ({}) })));
    const { fetchArchiveFeature } = await import('./archiveFeed.js');
    const bad = [];
    for (const m of DESK_CATALOGUE) {
      const out = await fetchArchiveFeature({ tier: m.tier, feature: m.feature }).catch(() => null);
      for (const link of out?.source?.links || []) if (HIDDEN.test(link)) bad.push(`${m.id}: ${link}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);
});
