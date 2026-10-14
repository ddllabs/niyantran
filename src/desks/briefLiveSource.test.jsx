// F169 T3 (F166): Morning Brief and the Statement Tracker fetched their items through /api/rss,
// which only the local dev server has, so neither loaded on the live site. Both now read
// /api/feature-feed through fetchFeature; the Statement Tracker asks for the selected leader.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const hooks = vi.hoisted(() => ({ index: 0, overrides: {}, effects: [] }));
vi.mock('react', async (original) => ({ ...await original(),
  useState: (init) => { const i = hooks.index++; return [i in hooks.overrides ? hooks.overrides[i] : typeof init === 'function' ? init() : init, vi.fn()]; },
  useEffect: (fn) => { hooks.effects.push(fn); }, useLayoutEffect: () => {}, useMemo: (fn) => fn(), useRef: (v) => ({ current: v }), useCallback: (fn) => fn,
}));
const feed = vi.hoisted(() => ({ calls: [] }));
vi.mock('../lib/featureFeed.js', () => ({
  fetchFeature: vi.fn(async (args) => { feed.calls.push(args); return { rows: [], source: { note: '' } }; }),
}));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: null }));
import MorningBriefDesk, { briefSection } from './MorningBriefDesk.jsx';
import StatementsDesk, { mentionVolume } from './StatementsDesk.jsx';

function mountAndRunEffects(Component, overrides = {}) {
  hooks.index = 0;
  hooks.overrides = overrides;
  hooks.effects = [];
  renderToStaticMarkup(<Component onSelect={vi.fn()} onFeed={vi.fn()} />);
  for (const fn of hooks.effects) fn();
}

beforeEach(() => {
  feed.calls = [];
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('the page must not fetch directly'); }));
});

describe('Morning Brief and Statement Tracker read /api/feature-feed (F169 T3)', () => {
  it('Morning Brief asks fetchFeature for its module and never fetches directly', () => {
    mountAndRunEffects(MorningBriefDesk);
    expect(feed.calls.map((c) => [c.tier, c.feature])).toContainEqual(['national', 'National Morning Brief (Auto-digest)']);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('the Statement Tracker asks for the selected leader', () => {
    // StatementsDesk's useState order: i 0, rows 1, vol 2, err 3, loading 4, q 5.
    mountAndRunEffects(StatementsDesk, { 0: 1 });
    const call = feed.calls.find((c) => /Statement & Quote Tracker/.test(c.feature));
    expect(call?.params).toEqual({ person: 'Amit Shah' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('briefSection', () => {
  const row = (title, section) => ({ title, section, source_url: `https://example.com/${encodeURIComponent(title)}` });
  it('keeps the rows of one section', () => {
    const f = { rows: [row('A', 'Top of the Day'), row('B', 'Government Wire'), row('C', 'Economy')] };
    const out = briefSection(f, 'Government Wire');
    expect(out.err).toBe('');
    expect(out.rows.map((r) => r.title)).toEqual(['B']);
  });
  it('an empty section of a feed that has rows is empty, not down', () => {
    expect(briefSection({ rows: [row('A', 'Top of the Day')] }, 'Economy')).toEqual({ rows: [], err: '' });
  });
  it('a feed with only a status row marks every section down', () => {
    expect(briefSection({ rows: [{ status: 'source_status' }], source: { note: 'sources empty' } }, 'Economy').err).toBe('sources empty');
  });
});

describe('mentionVolume', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  it('counts mentions per day over the last 7 days', () => {
    const rows = [{ date: 'Tue, 14 Oct 2026 10:00:00 GMT' }, { date: 'Tue, 14 Oct 2026 08:00:00 GMT' }, { date: 'Mon, 13 Oct 2026 08:00:00 GMT' }, { date: 'Mon, 01 Sep 2026 08:00:00 GMT' }];
    const series = mentionVolume(rows, now);
    expect(series).toHaveLength(7);
    expect(series.at(-1)).toEqual({ year: '10/14', n: 2 });
    expect(series.at(-2)).toEqual({ year: '10/13', n: 1 });
  });
  it('is null when fewer than two days have mentions', () => {
    expect(mentionVolume([{ date: 'Tue, 14 Oct 2026 10:00:00 GMT' }], now)).toBeNull();
  });
});
