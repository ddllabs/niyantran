import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * F169 T7. Prediction Market Political Odds made three Manifold calls one after another (about
 * 4.3-5 s, over the 4 s limit); they now run together. Top Financial & Business Players asked
 * Wikidata for every subclass of "enterprise" (`wdt:P279*`), which timed out (HTTP 504 after
 * 67 s); it now asks for Indian companies of five named types (measured 3.3 s uncached, 142 rows).
 */
describe('Economics live sources (F169 T7)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

  it('the Manifold searches run together', async () => {
    let open = 0;
    let most = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      open += 1;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 50));
      open -= 1;
      return { ok: true, status: 200, json: async () => [] };
    }));
    const { loadManifoldPolitical } = await import('../../server/financeApi.mjs');
    await loadManifoldPolitical();
    expect(most).toBeGreaterThan(1);
  });

  it('the business-leaders query has no subclass walk and returns the leaders', async () => {
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      seen.push(decodeURIComponent(String(url)));
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: { bindings: [{ person: { value: 'http://www.wikidata.org/entity/Q1' }, personLabel: { value: 'Salil Parekh' }, company: { value: 'http://www.wikidata.org/entity/Q2' }, companyLabel: { value: 'Infosys' } }] } }),
      };
    }));
    const { loadIndiaCeos } = await import('../../server/financeApi.mjs');
    const out = await loadIndiaCeos();
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toMatch(/P279\*/);
    expect(seen[0]).toMatch(/wdt:P17 wd:Q668/);
    expect(seen[0]).toMatch(/wdt:P169/);
    expect(out.rows).toEqual([expect.objectContaining({ person: 'Salil Parekh', company: 'Infosys' })]);
  });
});
