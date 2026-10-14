// F159: the side panel of a module that is still waiting for live data (or has stopped waiting)
// says so in the page's plain words, not the status row's account of archives.
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
import { LIVE_WAIT_TEXT, MODULE_UNAVAILABLE_TEXT } from '../desks/moduleLiveRetry.js';

function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
const text = (tree) => nodes(tree).flatMap((n) => [n.props?.children].flat()).filter((c) => typeof c === 'string').join(' ');
const STATUS = { status: 'source_status', title: 'Source offline or empty', detail: 'No live rows and no last-known-good archive were available. No records were invented.' };
const pending = { ok: false, tier: 'national', feature: 'Test feed', rows: [STATUS], source: { adapter: 'api', note: 'Live data is taking longer than usual.' }, served: 'archive', meta: {} };
const show = (feed) => text(RailContent({ view: 'desk', feed, selected: null, onSelect: vi.fn(), loading: false }));

beforeEach(() => { hooks.index = 0; });

it('while the page asks again', () => {
  const all = show(pending);
  expect(all).toContain(LIVE_WAIT_TEXT);
  expect(all).not.toMatch(/archive|stored pack|last-known-good/i);
});

it('after the page gave up', () => {
  expect(show({ ...pending, liveGaveUp: true })).toContain(MODULE_UNAVAILABLE_TEXT);
});

it('a genuine failure keeps its own account', () => {
  expect(show({ ...pending, served: 'live' })).toContain('No records were invented');
});
