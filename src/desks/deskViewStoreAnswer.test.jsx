// F169 phase 4 (C4): the module header for an answer from the scheduled feed store. It says
// "Updated N min ago" from the fetched time; "stored copy" is for real stored answers only.
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

function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
const text = (tree) => nodes(tree).flatMap((n) => [n.props?.children].flat()).filter((c) => typeof c === 'string' || typeof c === 'number').map(String);
// DeskView's useState order: q 0, sort 1, feed 2, err 3, loading 4 (deskViewPaging.test.jsx).
function page(feed) {
  hooks.index = 0;
  hooks.overrides = { 2: feed, 4: false };
  return text(DeskView({ featureName: 'Test feed', tier: 'finance', selected: null, onSelect: vi.fn(), onFeed: vi.fn(), onLoading: vi.fn() }));
}
const headerOf = (all) => all.find((t) => / rows\b/.test(t));
beforeEach(() => { hooks.index = 0; hooks.overrides = {}; });

const MIN = 60_000;
const fromStore = (msAgo, extra = {}) => ({
  ok: true, tier: 'finance', feature: 'Test feed', served: 'store', fallback: false,
  fetchedAt: new Date(Date.now() - msAgo).toISOString(),
  rows: [{ title: 'A', date: '2026-10-15' }, { title: 'B', date: '2026-10-14' }],
  coverage: { from: '', through: '7d', exhaustive: false },
  source: { adapter: 'news-search', links: ['https://feeds.bbci.co.uk/news/world/rss.xml'], note: 'Google News topic search.', kind: '' },
  meta: null, timeline: [],
  ...extra,
});

describe('the module header for an answer from the store (F169 C4)', () => {
  it('says how long ago the items were fetched, in place of the source line', () => {
    expect(headerOf(page(fromStore(5 * MIN + 20_000)))).toBe('2 rows · Updated 5 min ago');
    expect(headerOf(page(fromStore(3 * 60 * MIN + 5 * MIN)))).toBe('2 rows · Updated 3 h ago');
    expect(headerOf(page(fromStore(2 * 24 * 60 * MIN + 60 * MIN)))).toBe('2 rows · Updated 2 d ago');
  });

  it('never says "stored copy", even when the live answer came from a register-type adapter', () => {
    for (const adapter of ['api', 'embedded', 'register', 'source-library']) {
      const header = headerOf(page(fromStore(MIN, { source: { adapter, links: [], note: '' } })));
      expect(header, adapter).toBe('2 rows · Updated 1 min ago');
      expect(header, adapter).not.toMatch(/stored copy/i);
    }
  });

  it('shows no "Updated live." note and no stored-records banner', () => {
    const all = page({ ...fromStore(MIN), updatedLive: true });
    expect(all).not.toContain('Updated live.');
    expect(all.join(' ')).not.toMatch(/latest stored records/i);
  });

  it('a real stored answer still says "stored copy"', () => {
    const all = page({ ok: true, tier: 'finance', feature: 'Test feed', served: 'archive', fallback: true,
      rows: [{ title: 'A', date: '2026-07-10' }], coverage: { from: '', through: '', exhaustive: false },
      source: { adapter: 'embedded', links: [], note: 'Stored.' } });
    expect(headerOf(all)).toBe('1 rows · stored copy · as of 10 Jul 2026');
  });
});
