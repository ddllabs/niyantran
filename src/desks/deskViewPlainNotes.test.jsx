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
import { applyGlobalBoardShapingToFeed } from '../lib/shapeGlobalBoards.js';

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

// F165: the header beside the row count read "500 rows · exhaustive · sync backup" or "· sync present",
// and the Critical Minerals board said values are Not reported "unless the pack supplies them".
const HEADER_DEVELOPER = /exhaustive|\bsync\b|backup|archive|\bpack\b|\bpresent\b(?<!the present)|GDELT|adapter|\bhost\b|\bAPI\b|\bRSS\b|fallback|endpoint|\/api\//i;
const headerOf = (all) => all.find((t) => / rows\b/.test(t));

describe('the module header and board notes in plain words (F165)', () => {
  it('a stored copy of an exhaustive register capped for display: how many the full list holds, and that it is a stored copy', () => {
    // The production backup answer (server/featureFeed.mjs withBackup, server/backupFeed.mjs).
    const rows = Array.from({ length: 500 }, (_, i) => ({ title: `Row ${i}`, backup_part: 'FULL' }));
    const { all } = page({ ok: true, tier: 'global', feature: 'Test feed', rows, fallback: true, served: 'archive',
      coverage: { from: '', through: 'backup', exhaustive: true },
      source: { adapter: 'embedded', kind: 'backup-pack', links: ['/backup/global/x.xlsx'], note: 'Exhaustive shipped backup · 500 rows (pack has 4,104; capped for display). Live and archive returned no rows.' },
      meta: { backup: true, exhaustive: true, declaredRecords: 4104, status: 'BACKUP · EXHAUSTIVE PACK' } });
    expect(headerOf(all)).toBe('500 rows · 4,104 in the full list · page 1/5 · stored copy · date not recorded');
    expect(headerOf(all)).not.toMatch(HEADER_DEVELOPER);
  });

  // F169 T9: a stored answer says how old its records are.
  it('a stored register: the date of its newest record', () => {
    const { all } = page({ ok: true, tier: 'global', feature: 'Test feed', rows: [{ title: 'A', date: '2026-07-10' }, { title: 'B', as_of: '2026-07-15T03:45:00Z' }],
      fallback: false, coverage: { from: '', through: '', exhaustive: false }, source: { adapter: 'embedded', links: [], note: 'Stored.' } });
    expect(headerOf(all)).toBe('2 rows · stored copy · as of 15 Jul 2026');
  });

  it('a complete register that runs to the present', () => {
    const { all } = page({ ok: true, tier: 'global', feature: 'Test feed', rows: [{ title: 'A' }, { title: 'B' }], fallback: false,
      coverage: { from: '1952-01-01', through: 'present', exhaustive: true }, source: { adapter: 'bill-history', links: [], note: 'Register.' } });
    expect(headerOf(all)).toBe('2 rows · complete list · to the present');
  });

  it('a news window and an update time', () => {
    expect(headerOf(page({ ...geoNewsOnBbc, coverage: { from: '', through: '7d', exhaustive: false } }).all)).toBe('24 rows · last 7 days');
    expect(headerOf(page({ ...geoNewsOnBbc, updated: '2026-10-14T05:30:00Z', coverage: { through: '3d' } }).all)).toBe('24 rows · updated 14 Oct 2026');
  });

  it('Critical Minerals: the board note does not mention a pack', () => {
    const feed = applyGlobalBoardShapingToFeed({ ok: true, tier: 'global', feature: 'Critical Minerals', rows: [{ name: 'Lithium', topProducers: 'Australia, Chile' }],
      source: { adapter: 'embedded', links: [], note: 'Curated.' } });
    const { all } = page(feed);
    const note = all.find((t) => /Not reported/.test(t));
    expect(note).toMatch(/when the source does not give them; nothing is invented/);
    expect(note).not.toMatch(/\bpacks?\b|archive|adapter/i);
  });
});
