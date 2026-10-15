// F164: the side panel repeated the feed's technical source note ("Live BBC World RSS (GDELT DOC
// 2.0 unavailable: …)") and named the "Configured host". It now shows plain words; the original
// stays as the note's title.
import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ index: 0 }));
vi.mock('react', async (original) => ({ ...await original(),
  useState: (init) => { hooks.index++; return [typeof init === 'function' ? init() : init, vi.fn()]; },
  useEffect: () => {}, useLayoutEffect: () => {},
  useMemo: (fn) => fn(), useRef: (v) => ({ current: v }), useCallback: (fn) => fn,
}));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: null }));
vi.mock('../lib/featureFeed.js', () => ({ fetchFeaturePage: vi.fn() }));
import RailContent from './RailContent.jsx';

const DEVELOPER =
  /GDELT DOC|DOC 2\.0|rate.?limit|≥|paced|\barchives?\b|\bhost\b|backend|adapter|\/api\/|\bRSS\b|https?:|unavailable:|HTTP \d|proxy|last-known-good|shipped backup|feature map/i;
const BBC = 'https://feeds.bbci.co.uk/news/world/rss.xml';
const GDELT = 'https://api.gdeltproject.org/api/v2/doc/doc?query=x&mode=artlist&format=json';

function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
const strings = (tree) => nodes(tree).flatMap((n) => [n.props?.children].flat()).filter((c) => typeof c === 'string');
const panel = (feed) => RailContent({ view: 'desk', feed, selected: null, onSelect: vi.fn(), loading: false });

beforeEach(() => { hooks.index = 0; });

it("names the source in plain words, keeping the feed's note as a title", () => {
  const feed = { ok: true, tier: 'global', feature: 'Test feed', served: 'live', fallback: false,
    rows: Array.from({ length: 24 }, (_, i) => ({ title: `World story ${i}`, outlet: 'BBC World' })),
    source: { adapter: 'news-search', links: [BBC, GDELT],
      note: 'Live BBC World RSS (GDELT DOC 2.0 unavailable: api.gdeltproject.org: GDELT rate limited (need ≥5s between calls)).' },
    meta: {} };
  const tree = panel(feed);
  const all = strings(tree);
  expect(all).toContain('Live · 24 stories from BBC World');
  expect(all.filter((t) => DEVELOPER.test(t))).toEqual([]);
  expect(nodes(tree).find((n) => n.props?.children === 'Live · 24 stories from BBC World').props.title).toMatch(/GDELT DOC 2\.0 unavailable/);
});

it('a plain source note is shown as written', () => {
  const feed = { ok: true, tier: 'global', feature: 'Test feed', rows: [{ title: 'A' }], source: { adapter: 'api', links: [], note: 'World Bank open data — GDP growth, inflation and unemployment.' }, meta: {} };
  expect(strings(panel(feed))).toContain('World Bank open data — GDP growth, inflation and unemployment.');
});

it('an offline module: plain words and no configured host', () => {
  const feed = { ok: true, tier: 'global', feature: 'Test feed', served: 'live',
    rows: [{ status: 'source_status', title: 'Source offline or empty', host: 'api.gdeltproject.org',
      detail: 'api.gdeltproject.org did not return rows and there is no last-known-good archive for this module. No records were invented.' }],
    source: { adapter: 'news-search', links: [GDELT], note: 'GDELT DOC 2.0 reporting search did not return rows (rate limit or empty). No stories were invented.' }, meta: {} };
  const all = strings(panel(feed)).join(' ');
  expect(all).toContain('The source isn’t responding right now. No records were invented.');
  expect(all).not.toMatch(/Configured host|gdeltproject/);
  expect(all).not.toMatch(DEVELOPER);
});

it("stored records with the archive's own note: a plain banner", () => {
  const feed = { ok: true, tier: 'global', feature: 'Test feed', rows: [{ title: 'A' }], fallback: true, served: 'archive',
    source: { adapter: 'embedded', links: [], note: 'Shipped register on this host.' }, meta: {} };
  const all = strings(panel(feed));
  expect(all).toContain('Showing the latest stored records.');
  expect(all.filter((t) => DEVELOPER.test(t))).toEqual([]);
});

// F165, F179: a news-search module's side panel once warned "GDELT reporting search - not an official
// dataset", then "News search results, not an official dataset" from a `gdelt` flag the server set on
// failed searches only. The flag is gone; the panel never names GDELT.
it('a news-search module: the side panel names no GDELT and no longer carries the flag banner', () => {
  const feed = { ok: true, tier: 'global', feature: 'Test feed', served: 'live', fallback: false,
    rows: [{ title: 'Story', source_url: 'https://www.reuters.com/x' }],
    source: { adapter: 'news-search', links: [BBC], note: 'Reporting search, not an official dataset.' }, meta: {} };
  const all = strings(panel(feed));
  expect(all).not.toContain('News search results, not an official dataset.');
  expect(all.filter((t) => /GDELT/i.test(t))).toEqual([]);
});
