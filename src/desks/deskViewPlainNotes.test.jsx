// F164 (2026-10-14): module pages showed the feed's technical notes, e.g. Geopolitics News Wire's
// "24 stories · GDELT paced ≥5s; primary DOC 2.0 search retries on the next refresh", and planned or
// offline state cards spoke of adapters, archives and the "Configured host". The feed data is
// unchanged (refreshFeeds.js reads it); the page shows plain words and keeps the original as a title.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ index: 0, overrides: {} }));
vi.mock('react', async (original) => ({ ...await original(),
  useState: (init) => { const i = hooks.index++; return [i in hooks.overrides ? hooks.overrides[i] : typeof init === 'function' ? init() : init, vi.fn()]; },
  useEffect: () => {}, useMemo: (fn) => fn(), useRef: (v) => ({ current: v }), useDeferredValue: (v) => v,
}));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: null }));
vi.mock('../lib/featureFeed.js', () => ({ fetchFeaturePage: vi.fn(), fetchFeature: vi.fn() }));
vi.mock('../lib/apiMode.js', () => ({ featureFeedApiEnabled: () => true, liveApiEnabled: () => true }));
import DeskView from './DeskView.jsx';
import DeskStateShell from '../shell/DeskStateShell.jsx';

const DEVELOPER =
  /GDELT DOC|DOC 2\.0|TimelineVol|rate.?limit|≥|paced|\barchives?\b|\bhost\b|backend|adapter|\/api\/|\bRSS\b|https?:|unavailable:|HTTP \d|SPARQL|proxy|last-known-good|shipped backup|feature map|\bPACK\b|BACKUP/i;
const BBC = 'https://feeds.bbci.co.uk/news/world/rss.xml';
const GDELT = 'https://api.gdeltproject.org/api/v2/doc/doc?query=x&mode=artlist&format=json';

function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
const text = (tree) => nodes(tree).flatMap((n) => [n.props?.children].flat()).filter((c) => typeof c === 'string' || typeof c === 'number').map(String);
const shellOf = (tree) => nodes(tree).find((n) => n.type === DeskStateShell);
// DeskView's useState order: q 0, sort 1, feed 2, err 3, loading 4 (deskViewPaging.test.jsx).
function page(feed) {
  hooks.index = 0;
  hooks.overrides = { 2: feed, 4: false };
  const tree = DeskView({ featureName: 'Test feed', tier: 'global', selected: null, onSelect: vi.fn(), onFeed: vi.fn(), onLoading: vi.fn() });
  const shell = shellOf(tree);
  const shellTree = shell ? DeskStateShell(shell.props) : null;
  return { tree, shellTree, all: [...text(tree), ...(shellTree ? text(shellTree) : [])] };
}
const developerText = (all) => all.filter((t) => DEVELOPER.test(t));

beforeEach(() => { hooks.index = 0; hooks.overrides = {}; });

// The production answer of 2026-10-14 when GDELT was paced out (server/featureFeed.mjs).
const geoNewsOnBbc = {
  ok: true, tier: 'global', feature: 'Test feed', served: 'live', fallback: false,
  rows: Array.from({ length: 24 }, (_, i) => ({ title: `World story ${i}`, outlet: 'BBC World', source_url: `https://www.bbc.co.uk/news/${i}` })),
  source: { adapter: 'news-search', links: [BBC, GDELT], gdelt: false, kind: '',
    note: 'Live BBC World RSS (GDELT DOC 2.0 unavailable: api.gdeltproject.org: GDELT rate limited (need ≥5s between calls)).' },
  meta: { section: 'TOP WORLD STORIES — BBC WORLD RSS', status: 'LIVE · BBC WORLD', note: '24 stories · GDELT paced ≥5s; primary DOC 2.0 search retries on the next refresh' },
};

describe('a module page shows source notes in plain words (F164)', () => {
  it('Geopolitics News Wire on BBC World: a plain source line, the technical note kept as its title', () => {
    const { tree, all } = page(geoNewsOnBbc);
    expect(all).toContain('Live · 24 stories from BBC World');
    expect(all).toContain('TOP WORLD STORIES — BBC WORLD');
    expect(all).toContain('LIVE · BBC WORLD');
    expect(developerText(all)).toEqual([]);
    const line = nodes(tree).find((n) => n.props?.children === 'Live · 24 stories from BBC World');
    expect(line.props.title).toMatch(/GDELT paced/);
  });

  it('a plain note is shown as written, with no title', () => {
    const { tree, all } = page({ ...geoNewsOnBbc, meta: { note: '40 articles · reporting search, not an official feed' } });
    expect(all).toContain('40 articles · reporting search, not an official feed');
    expect(nodes(tree).find((n) => n.props?.children === '40 articles · reporting search, not an official feed').props.title).toBeUndefined();
  });

  it("stored records with the archive's own note: a plain banner", () => {
    const { all } = page({ ok: true, tier: 'global', feature: 'Test feed', rows: [{ title: 'Stored' }], fallback: true, served: 'archive',
      source: { adapter: 'embedded', links: [], note: 'World Bank open data. Live host only on the static archive.' }, meta: { status: 'BACKUP · EXHAUSTIVE PACK' } });
    expect(all).toContain('Showing the latest stored records. World Bank open data.');
    expect(developerText(all)).toEqual([]);
  });

  it('a planned module: no adapter, map or archive wording on the state card', () => {
    // The production answer for an unmatched module name, 2026-10-14.
    const { shellTree, all } = page({ ok: true, tier: 'global', feature: 'Test feed', served: 'live', fallback: false,
      rows: [{ status: 'source_status', title: 'Module planned', host: '',
        detail: 'This adapter is listed in the source map, but table extraction is not scheduled. Intended coverage ships when the family adapter is ready. No records were invented to fill this table.' }],
      source: { adapter: '', links: [], note: 'No matching HTML FEATURE MAP row.' } });
    expect(shellTree).toBeTruthy();
    expect(all).toContain('Test feed has no records yet. No records were invented to fill this table.');
    expect(all).toContain('Filters, export and AI research turn on once records are available.');
    expect(developerText(all)).toEqual([]);
    expect(shellTree.props.title).toMatch(/adapter is listed/);
  });

  it('a source that returned nothing: no host, and the sources by name as links', () => {
    const { shellTree, all } = page({ ok: true, tier: 'global', feature: 'Test feed', served: 'live', fallback: false,
      rows: [{ status: 'source_status', title: 'Source offline or empty', host: 'api.gdeltproject.org',
        detail: 'api.gdeltproject.org did not return rows and there is no last-known-good archive for this module. No records were invented.' }],
      source: { adapter: 'news-search', links: [GDELT, BBC], note: 'GDELT DOC 2.0 reporting search did not return rows (rate limit or empty). No stories were invented.' } });
    expect(developerText(all)).toEqual([]);
    expect(all.join(' ')).not.toMatch(/Configured host|gdeltproject\.org/);
    const links = nodes(shellTree).filter((n) => n.type === 'a');
    expect(links.map((a) => [a.props.children, a.props.href])).toEqual([['GDELT news search', GDELT], ['BBC World', BBC]]);
    expect(shellTree.props.title).toMatch(/Host: api\.gdeltproject\.org/);
  });
});
