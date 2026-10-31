// F169 phase 2 review fixes: the Statement Tracker's leader keeps each leader's in-flight and late
// answers apart; the business-leaders and Manifold loaders keep what they have when a source fails;
// ISL marks and orders upcoming matches.
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('per-leader live answers stay apart (review 2)', () => {
  afterEach(() => { vi.resetModules(); });

  it('a late answer for one leader is not served for another', async () => {
    const { serveFeatureFeedWithinLimit } = await import('../../server/featureFeed.mjs');
    const feature = 'Statement & Quote Tracker with Contradiction Detection';
    const params = (person) => new URLSearchParams({ tier: 'national', feature, person });
    const answer = (person) => ({ ok: true, rows: [{ title: `${person} said something`, person }], source: { adapter: 'news-search' } });
    let release;
    const slow = new Promise((r) => { release = r; });
    const live = vi.fn(async (sp) => {
      const person = sp.get('person');
      if (person === 'Narendra Modi') { await slow; return answer(person); }
      return answer(person);
    });
    // Modi's answer is late: the request falls back, the live attempt keeps running.
    await serveFeatureFeedWithinLimit(params('Narendra Modi'), { limitMs: 20, live });
    // Shah asked while Modi's attempt is still in flight: must get Shah's own answer.
    const shah = await serveFeatureFeedWithinLimit(params('Amit Shah'), { limitMs: 500, live });
    expect(shah.rows[0].person).toBe('Amit Shah');
    release();
    await new Promise((r) => setTimeout(r, 10));
    // Modi's late answer is now held; Shah still gets Shah's.
    const shahAgain = await serveFeatureFeedWithinLimit(params('Amit Shah'), { limitMs: 500, live });
    expect(shahAgain.rows[0].person).toBe('Amit Shah');
  });
});

describe('loaders keep what they have (review 3)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

  it('business leaders: the last good answer, marked stale, when Wikidata fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-10-14T00:00:00Z'));
    const ok = { ok: true, status: 200, json: async () => ({ results: { bindings: [{ personLabel: { value: 'Salil Parekh' }, companyLabel: { value: 'Infosys' }, company: { value: 'http://www.wikidata.org/entity/Q2' } }] } }) };
    vi.stubGlobal('fetch', vi.fn(async () => ok));
    const { loadIndiaCeos } = await import('../../server/financeApi.mjs');
    await loadIndiaCeos();
    vi.setSystemTime(Date.parse('2026-10-16T00:00:00Z')); // past the 24 h cache
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 504, json: async () => ({}) })));
    const out = await loadIndiaCeos();
    expect(out.stale).toBe(true);
    expect(out.rows[0].person).toBe('Salil Parekh');
  });

  it('Manifold: one failed search does not discard the others', async () => {
    const market = (id, q) => ({ id, question: q, probability: 0.5, url: `https://manifold.markets/${id}`, outcomeType: 'BINARY', isResolved: false, closeTime: Date.now() + 365 * 86400000, volume: 100 }); // open a year past the test clock
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      if (/term=politics/.test(u)) return { ok: false, status: 500, json: async () => ({}) };
      if (/term=election/.test(u)) return { ok: true, status: 200, json: async () => [market('a', 'Who will win the 2026 election?')] };
      return { ok: true, status: 200, json: async () => [market('b', 'Will the summit produce a geopolitics deal?')] };
    }));
    const { loadManifoldPolitical } = await import('../../server/financeApi.mjs');
    const out = await loadManifoldPolitical();
    expect(out.rows.length).toBeGreaterThan(0);
  });
});
