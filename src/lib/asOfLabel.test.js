import { afterEach, describe, expect, it, vi } from 'vitest';
import { asOfLabel, isStoredAnswer } from './plainSourceNote.js';

// F169 T9: 46 modules show stored records with nothing saying how old they are. A stored answer's
// header now says "as of <newest record date>", or "date not recorded" when no record has a date.
const NOW = Date.parse('2026-10-14T12:00:00Z');

describe('asOfLabel (F169 T9)', () => {
  it('the newest record date of a stored answer', () => {
    const feed = { source: { adapter: 'embedded' }, rows: [{ date: '2026-07-10' }, { date_introduced: '2026-07-15' }, { title: 'no date' }] };
    expect(asOfLabel(feed, NOW)).toBe('as of 15 Jul 2026');
  });

  it('ignores dates in the future (scheduled releases, fixtures)', () => {
    const feed = { source: { adapter: 'embedded' }, rows: [{ date: '2026-07-10' }, { release_date: '2027-01-01' }] };
    expect(asOfLabel(feed, NOW)).toBe('as of 10 Jul 2026');
  });

  it('falls back to the answer\'s own as-of date, then says the date is not recorded', () => {
    expect(asOfLabel({ source: { adapter: 'embedded' }, rows: [{ title: 'x' }], meta: { as_of: '2026-05-01' } }, NOW)).toBe('as of 01 May 2026');
    expect(asOfLabel({ source: { adapter: 'embedded' }, rows: [{ title: 'x' }] }, NOW)).toBe('date not recorded');
  });

  it('knows a stored answer from a live one', () => {
    expect(isStoredAnswer({ source: { adapter: 'embedded' } })).toBe(true);
    expect(isStoredAnswer({ served: 'archive', source: { adapter: 'api' } })).toBe(true);
    expect(isStoredAnswer({ fallback: true, source: { adapter: 'api' } })).toBe(true);
    expect(isStoredAnswer({ source: { adapter: 'api' } })).toBe(false);
    expect(isStoredAnswer({ source: { adapter: 'news-search' } })).toBe(false);
  });
});

describe('every stored module has a date or says it has none (F169 T9)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('across the desk catalogue, with every live source down', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u) => ({ ok: false, status: 503, url: String(u), headers: new Headers(), text: async () => '', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) })));
    const { DESK_CATALOGUE } = await import('../desks/landing/deskCatalogue.js');
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const labels = {};
    for (const m of DESK_CATALOGUE) {
      const feed = await serveFeatureFeed(new URLSearchParams({ tier: m.tier, feature: m.feature })).catch(() => null);
      const real = (feed?.rows || []).filter((r) => r?.status !== 'source_status');
      if (!real.length || !isStoredAnswer(feed)) continue;
      labels[m.id] = asOfLabel(feed, NOW);
    }
    expect(Object.keys(labels).length).toBeGreaterThan(20);
    for (const [id, label] of Object.entries(labels)) expect(label, id).toMatch(/^as of \d{2} [A-Z][a-z]{2} \d{4}$|^date not recorded$/);
    expect(labels['finance:NSE/BSE Delayed Market Feed']).toBe('as of 15 Jul 2026');
  }, 120_000);
});
