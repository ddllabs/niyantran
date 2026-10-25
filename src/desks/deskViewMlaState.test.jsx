// F190: the State picker on MLA Directory (only), the request it makes, and what happens when the state
// changes while a request is still out. The repo has no DOM library (vitest runs in node), so DeskView is
// called with a small hooks runtime in place of React's: state that persists between renders, effects that
// run when their dependencies change (the previous run's cleanup first, as React does), and refs. The state
// is picked by the picker's own onChange, as a reader does, so the test needs no hook positions.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rt = vi.hoisted(() => ({ slots: [], effects: [], refs: [], pending: [], dirty: false, cursor: 0, effectCursor: 0, refCursor: 0 }));
vi.mock('react', async (original) => ({ ...await original(),
  useState: (init) => {
    const slot = (rt.slots[rt.cursor] ??= { value: typeof init === 'function' ? init() : init });
    rt.cursor += 1;
    return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; rt.dirty = true; }];
  },
  useEffect: (fn, deps) => {
    const i = rt.effectCursor++;
    const prev = rt.effects[i];
    if (prev && deps && deps.every((d, k) => Object.is(d, prev.deps[k]))) return;
    rt.pending.push(() => { prev?.cleanup?.(); rt.effects[i] = { deps, cleanup: fn() }; });
  },
  useRef: (v) => (rt.refs[rt.refCursor++] ??= { current: v }),
  useMemo: (fn) => fn(),
  useDeferredValue: (v) => v,
}));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: null }));
const api = vi.hoisted(() => ({ page: vi.fn(), whole: vi.fn() }));
vi.mock('../lib/featureFeed.js', () => ({ fetchFeaturePage: api.page, fetchFeature: api.whole }));
vi.mock('../lib/apiMode.js', () => ({ featureFeedApiEnabled: () => true, liveApiEnabled: () => true }));
import DeskView from './DeskView.jsx';
import MlaStatePicker from './MlaStatePicker.jsx';
import { clearPendingMlaState, rememberMlaState } from './mlaStateHandoff.js';

function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
const pickers = (tree) => nodes(tree).filter((n) => n.type === MlaStatePicker);
const texts = (tree) => nodes(tree).flatMap((n) => [n.props?.children].flat()).filter((c) => typeof c === 'string' || typeof c === 'number').map(String);

// Props that stay the same between renders, as the shell's do (a changing one would re-run the effects).
const onFeed = vi.fn();
const onSelect = vi.fn();
const onLoading = vi.fn();
let props;
let tree;

function render() {
  rt.cursor = 0; rt.effectCursor = 0; rt.refCursor = 0;
  tree = DeskView(props);
  return tree;
}
/** Renders and runs effects until nothing changes, letting resolved requests land in between. */
async function settle() {
  for (let n = 0; n < 30; n += 1) {
    render();
    const effects = rt.pending.splice(0);
    effects.forEach((run) => run());
    await (vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(0) : new Promise((r) => setTimeout(r, 0)));
    if (!effects.length && !rt.dirty) return tree;
    rt.dirty = false;
  }
  throw new Error('the page did not settle');
}
const pick = (state) => pickers(tree)[0].props.onChange(state);

/** A request that stays out until the test answers it. */
function pendingRequests() {
  const asked = [];
  api.whole.mockImplementation((opts) => new Promise((resolve) => { asked.push({ opts, resolve }); }));
  return asked;
}
const answer = (state, n = 3) => ({
  ok: true, tier: 'state', feature: 'MLA Directory', served: 'store', register: true, fallback: false, fetchedAt: '2026-10-15T00:00:00Z',
  rows: Array.from({ length: n }, (_, i) => ({ title: `${state || 'All'} MLA ${i}`, state: state || 'Kerala' })),
  source: { adapter: 'register', links: [], note: `${state || 'All states'} note` }, coverage: { from: '', through: '', exhaustive: false },
});
const lastFeed = () => onFeed.mock.calls.filter(([f]) => f).at(-1)?.[0];

beforeEach(() => {
  vi.useRealTimers();
  Object.assign(rt, { slots: [], effects: [], refs: [], pending: [], dirty: false });
  api.page.mockReset(); api.whole.mockReset(); onFeed.mockClear(); onSelect.mockClear(); onLoading.mockClear();
  props = { featureName: 'MLA Directory', tier: 'state', selected: null, onSelect, onFeed, onLoading, reload: 0 };
});

describe('the picker is on MLA Directory only (F190)', () => {
  it('renders once on MLA Directory, beside the header, and nowhere else', async () => {
    pendingRequests();
    await settle();
    expect(pickers(tree)).toHaveLength(1);
    for (const [tier, featureName] of [['state', 'Constituency Register'], ['state', 'MLA Report Card + Statement Tracker'], ['national', 'Cabinet Decisions'], ['national', 'MLA Directory']]) {
      props = { ...props, tier, featureName };
      await settle();
      expect(pickers(tree), `${tier}:${featureName}`).toHaveLength(0);
    }
  });

  it('is still there while the list loads and when the load failed, so a state can be changed', async () => {
    pendingRequests();
    await settle();
    expect(pickers(tree)).toHaveLength(1); // the first request is still out
    api.whole.mockRejectedValue(new Error('down'));
    pick('Kerala');
    await settle();
    expect(pickers(tree)).toHaveLength(1);
  });

  it('announces the row count politely on MLA Directory, and on no other module', async () => {
    const live = (t) => nodes(t).filter((n) => n.props?.['aria-live']);
    pendingRequests();
    await settle();
    expect(live(tree).map((n) => [n.props['aria-live'], n.props.className])).toEqual([['polite', 'muted']]);
    props = { ...props, tier: 'national', featureName: 'Cabinet Decisions' };
    await settle();
    expect(live(tree)).toEqual([]);
  });
});

describe('the request the picker makes (F190)', () => {
  it('"All states" sends no params, a chosen state sends params.state and nothing else, and back again', async () => {
    const asked = pendingRequests();
    await settle();
    pick('Kerala');
    await settle();
    pick('');
    await settle();
    expect(asked.map((a) => a.opts.params)).toEqual([undefined, { state: 'Kerala' }, undefined]);
    for (const { opts } of asked) expect(opts).toMatchObject({ tier: 'state', feature: 'MLA Directory' });
  });

  it('other modules never send a state, even after a state was chosen on MLA Directory', async () => {
    const asked = pendingRequests();
    await settle();
    pick('Kerala');
    await settle();
    props = { ...props, featureName: 'Constituency Register' };
    await settle();
    expect(asked.at(-1).opts).toMatchObject({ feature: 'Constituency Register' });
    expect(asked.at(-1).opts.params).toBeUndefined();
  });

  it('asks again with the same state when the answer is a stored one waiting for live data', async () => {
    vi.useFakeTimers();
    try {
      const asked = pendingRequests();
      await settle();
      pick('Kerala');
      await settle();
      const kerala = asked.at(-1);
      kerala.resolve({ ...answer('Kerala', 0), served: 'archive', rows: [] });
      await vi.advanceTimersByTimeAsync(7000); // the first retry comes 6 s after the first answer (moduleLiveRetry.js)
      expect(asked.length).toBeGreaterThanOrEqual(3);
      expect(asked.at(-1).opts.params).toEqual({ state: 'Kerala' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts again at the first page when the state changes', async () => {
    const asked = pendingRequests();
    await settle();
    asked[0].resolve(answer('', 250));
    await settle();
    const pageOf = () => texts(tree).find((t) => /page \d+\/\d+/.test(t));
    expect(pageOf()).toMatch(/page 1\/3/);
    nodes(tree).find((n) => n.type === 'button' && n.props.children === 'Next').props.onClick();
    await settle();
    expect(pageOf()).toMatch(/page 2\/3/);
    pick('Kerala');
    await settle();
    asked.at(-1).resolve(answer('Kerala', 250));
    await settle();
    expect(pageOf()).toMatch(/page 1\/3/);
  });
});

describe('a state changed while a request is out (F190 review)', () => {
  it('shows the last state picked when an earlier request answers after it', async () => {
    const asked = pendingRequests();
    await settle();
    pick('Kerala');
    await settle();
    pick('Assam');
    await settle();
    const [, kerala, assam] = asked;
    expect(kerala.opts.params).toEqual({ state: 'Kerala' });
    expect(assam.opts.params).toEqual({ state: 'Assam' });
    expect(kerala.opts.signal.aborted).toBe(true); // leaving a state stops its request
    assam.resolve(answer('Assam', 5));
    await settle();
    kerala.resolve(answer('Kerala', 7)); // the earlier request answers last
    await settle();
    expect(lastFeed().source.note).toBe('Assam note');
    expect(lastFeed().rows).toHaveLength(5);
    expect(onFeed.mock.calls.some(([f]) => f?.source?.note === 'Kerala note')).toBe(false);
    expect(texts(tree).find((t) => / rows\b/.test(t))).toMatch(/^5 rows/);
    expect(pickers(tree)[0].props.value).toBe('Assam');
  });

  it('clears the parent\'s feed and selection when the state changes, so the old list cannot be attached', async () => {
    const asked = pendingRequests();
    await settle();
    asked[0].resolve(answer('', 4));
    await settle();
    expect(lastFeed().rows).toHaveLength(4);
    onFeed.mockClear(); onSelect.mockClear();
    pick('Kerala');
    await settle();
    expect(onFeed).toHaveBeenCalledWith(null);
    expect(onFeed.mock.calls.every(([f]) => f === null)).toBe(true); // nothing of the old list is handed up while Kerala loads
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(texts(tree)).not.toContain('All MLA 0');
  });

  it('does not clear anything when the state has not changed (a retry, a reload)', async () => {
    const asked = pendingRequests();
    await settle();
    asked[0].resolve(answer('', 4));
    await settle();
    onFeed.mockClear();
    props = { ...props, reload: 1 };
    await settle();
    expect(onFeed).not.toHaveBeenCalledWith(null);
  });

  it('retains the chosen state when the reader leaves MLA Directory and returns', async () => {
    const asked = pendingRequests();
    await settle();
    pick('Kerala');
    await settle();
    props = { ...props, featureName: 'Constituency Register' };
    await settle();
    props = { ...props, featureName: 'MLA Directory' };
    await settle();
    expect(pickers(tree)[0].props.value).toBe('Kerala');
    expect(asked.at(-1).opts.params).toEqual({ state: 'Kerala' });
  });
});

describe('the picker on a touch screen (F190 review)', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  it('is 44 px tall with 16 px text under (pointer: coarse), so iOS does not zoom on focus', () => {
    const block = css.match(/@media \(pointer: coarse\)\s*\{\s*\.mla-state select\s*\{([^}]*)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/min-height:\s*44px/);
    expect(block[1]).toMatch(/font-size:\s*16px/);
  });
});

describe('opening MLA Directory from the Party Organisation Map (F196)', () => {
  it('starts on the state chosen on the map, and on "All states" when nothing was chosen', async () => {
    try {
      rememberMlaState('Kerala');
      const asked = pendingRequests();
      await settle();
      expect(asked.map((a) => a.opts.params)).toEqual([{ state: 'Kerala' }]);
      expect(pickers(tree)[0].props.value).toBe('Kerala');

      clearPendingMlaState();
      Object.assign(rt, { slots: [], effects: [], refs: [], pending: [], dirty: false });
      const again = pendingRequests();
      await settle();
      expect(again.map((a) => a.opts.params)).toEqual([undefined]);
    } finally {
      clearPendingMlaState();
    }
  });
});
