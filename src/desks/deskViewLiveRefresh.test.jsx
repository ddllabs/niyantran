// F154: a module page now shows the stored archive while the live feed loads. A small note keeps
// those rows from being taken for live ones, and says when the live rows have replaced them.
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ index: 0, overrides: {} }));
vi.mock('react', async (original) => ({ ...await original(),
  useState: (init) => { const i = hooks.index++; return [i in hooks.overrides ? hooks.overrides[i] : typeof init === 'function' ? init() : init, () => {}]; },
  useEffect: () => {}, useMemo: (fn) => fn(), useRef: (v) => ({ current: v }), useDeferredValue: (v) => v,
}));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: null }));
import DeskView, { liveRefreshNote } from './DeskView.jsx';

function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
const text = (tree) => nodes(tree).flatMap((n) => [n.props?.children].flat()).filter((c) => typeof c === 'string');
const feed = (extra) => ({ ok: true, rows: [{ title: 'Alpha' }], columns: [{ key: 'title', label: 'Title' }], meta: {}, source: { adapter: 'embedded', note: 'Stored rows.' }, ...extra });
// Index 2 of DeskView's useState calls is the feed (as in keyboardSelection.test.jsx).
const render = (f) => { hooks.overrides = { 2: f, 4: false }; return DeskView({ featureName: 'Test feed', tier: 'test', selected: null, onSelect: vi.fn() }); };

beforeEach(() => { hooks.index = 0; hooks.overrides = {}; });

it('names the state of the rows on screen', () => {
  expect(liveRefreshNote(feed({ fallback: true, refreshing: true }))).toBe('Showing stored rows. Refreshing live data…');
  expect(liveRefreshNote(feed({ updatedLive: true }))).toBe('Updated live.');
  expect(liveRefreshNote(feed({ fallback: true, refreshing: false }))).toBeNull();
  expect(liveRefreshNote(feed({}))).toBeNull();
  expect(liveRefreshNote(null)).toBeNull();
});

it('shows the refreshing note over stored rows while live data loads', () => {
  expect(text(render(feed({ fallback: true, refreshing: true })))).toContain('Showing stored rows. Refreshing live data…');
});

it('shows that the live rows have arrived', () => {
  expect(text(render(feed({ updatedLive: true })))).toContain('Updated live.');
});

it('shows neither note on an ordinary answer', () => {
  const all = text(render(feed({})));
  expect(all).not.toContain('Updated live.');
  expect(all.some((t) => /Refreshing live data/.test(t))).toBe(false);
});
