// F164: Morning Brief and the Statement Tracker load their own items and showed "GDELT wire
// unreachable from this network…" and "PIB releases arrive through the backend (/api/rss)…". The
// page now says a section couldn't load, in plain words; the reason stays as the banner's title.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const hooks = vi.hoisted(() => ({ index: 0, overrides: {} }));
vi.mock('react', async (original) => ({ ...await original(),
  useState: (init) => { const i = hooks.index++; return [i in hooks.overrides ? hooks.overrides[i] : typeof init === 'function' ? init() : init, vi.fn()]; },
  useEffect: () => {}, useLayoutEffect: () => {}, useMemo: (fn) => fn(), useRef: (v) => ({ current: v }), useCallback: (fn) => fn,
}));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: null }));
vi.mock('../lib/apiMode.js', () => ({ featureFeedApiEnabled: () => true, liveApiEnabled: () => true }));
import MorningBriefDesk from './MorningBriefDesk.jsx';
import StatementsDesk from './StatementsDesk.jsx';

const DEVELOPER =
  /GDELT DOC|DOC 2\.0|TimelineVol|rate.?limit|≥|paced|no archive|static archive|archive (on|returned|is|was)\b|\bhost\b|backend|adapter|\/api\/|\bRSS\b|https?:|unreachable|HTTP \d|proxy|last-known-good|from this network/i;
// (F165: the Statement Tracker now says "not a record of statements" rather than "not a statement archive".)
// What a reader sees: the page's text, without its markup or attributes.
const shown = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const render = (Component, overrides) => {
  hooks.index = 0;
  hooks.overrides = overrides;
  return renderToStaticMarkup(<Component onSelect={vi.fn()} onFeed={vi.fn()} />);
};

beforeEach(() => { hooks.index = 0; hooks.overrides = {}; });

describe('Morning Brief (F164)', () => {
  // MorningBriefDesk's useState order: top 0, pib 1, eco 2, q 3, loading 4.
  const down = {
    0: { rows: [], err: 'GDELT wire unreachable from this network — it will retry automatically.' },
    1: { rows: [], err: 'PIB releases arrive through the backend (/api/rss) and it is not reachable.' },
    2: { rows: [], err: 'GDELT wire unreachable from this network — it will retry automatically.' },
    4: false,
  };

  it('sections that could not load say so in plain words', () => {
    const html = render(MorningBriefDesk, down);
    expect(shown(html)).toContain('This section couldn’t load right now.');
    expect(shown(html).match(DEVELOPER)?.[0] ?? null).toBeNull();
    expect(html).toContain('title="PIB releases arrive through the backend (/api/rss) and it is not reachable."');
  });

  it('with no live API on the build', () => {
    const msg = 'Live RSS proxy is not deployed on this host.';
    expect(shown(render(MorningBriefDesk, { 0: { rows: [], err: msg }, 1: { rows: [], err: msg }, 2: { rows: [], err: msg }, 4: false })).match(DEVELOPER)?.[0] ?? null).toBeNull();
  });

  it('sections with items describe their source plainly', () => {
    const item = { title: 'Cabinet approves scheme', source: 'PIB', source_url: 'https://pib.gov.in/x', published: '2026-10-14' };
    const html = render(MorningBriefDesk, { 0: { rows: [item], err: '' }, 1: { rows: [{ ...item, title: 'PIB release' }], err: '' }, 2: { rows: [{ ...item, title: 'Rupee steady' }], err: '' }, 4: false });
    expect(shown(html)).toContain('The latest releases from the Press Information Bureau.');
    expect(shown(html).match(DEVELOPER)?.[0] ?? null).toBeNull();
  });
});

describe('Statement Tracker (F164)', () => {
  // StatementsDesk's useState order: i 0, rows 1, vol 2, err 3, loading 4, q 5.
  it('when no mentions could be fetched', () => {
    const html = render(StatementsDesk, { 3: 'GDELT wire unreachable from this network — it will retry automatically.', 4: false });
    expect(shown(html)).toContain('Media mentions couldn’t load right now.');
    expect(shown(html).match(DEVELOPER)?.[0] ?? null).toBeNull();
    expect(html).toContain('title="GDELT wire unreachable');
  });

  it('the coverage chart names its source plainly', () => {
    const html = render(StatementsDesk, { 2: [{ year: '10/13', n: 4 }, { year: '10/14', n: 9 }], 4: false });
    expect(shown(html)).toContain('news search');
    expect(shown(html).match(DEVELOPER)?.[0] ?? null).toBeNull();
  });
});
