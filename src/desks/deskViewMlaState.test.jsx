// F190: the State picker on MLA Directory (only), and the request it makes. DeskView is called with
// its hooks replaced (as in deskViewPaging.test.jsx); useState order: q 0, sort 1, feed 2, err 3,
// loading 4, visibleKeys 5, reloadTick 6, pageAt 7, hasAnswerFilter 8, pagedMode 9, pagedQ 10,
// paging 11, mlaState 12.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ index: 0, overrides: {}, setters: {}, runEffects: false }));
vi.mock('react', async (original) => ({ ...await original(),
  useState: (init) => {
    const i = hooks.index++;
    hooks.setters[i] ??= vi.fn();
    return [i in hooks.overrides ? hooks.overrides[i] : typeof init === 'function' ? init() : init, hooks.setters[i]];
  },
  useEffect: (fn) => { if (hooks.runEffects) fn(); },
  useMemo: (fn) => fn(), useRef: (v) => ({ current: v }), useDeferredValue: (v) => v,
}));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: null }));
const api = vi.hoisted(() => ({ page: vi.fn(), whole: vi.fn() }));
vi.mock('../lib/featureFeed.js', () => ({ fetchFeaturePage: api.page, fetchFeature: api.whole }));
vi.mock('../lib/apiMode.js', () => ({ featureFeedApiEnabled: () => true, liveApiEnabled: () => true }));
import DeskView from './DeskView.jsx';
import MlaStatePicker from './MlaStatePicker.jsx';

const MLA_STATE = 12;
const render = (props = {}) => DeskView({ featureName: 'MLA Directory', tier: 'state', selected: null, onSelect: vi.fn(), onFeed: vi.fn(), onLoading: vi.fn(), ...props });
function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
const pickers = (tree) => nodes(tree).filter((n) => n.type === MlaStatePicker);
const answer = (rows = [{ title: 'A' }]) => ({ ok: true, tier: 'state', feature: 'MLA Directory', rows, served: 'store', register: true, fetchedAt: '2026-10-15T00:00:00Z', source: { adapter: 'register', links: [], note: '' }, coverage: { from: '', through: '', exhaustive: false } });

beforeEach(() => {
  hooks.index = 0; hooks.overrides = {}; hooks.setters = {}; hooks.runEffects = false;
  api.page.mockReset(); api.whole.mockReset();
  api.whole.mockImplementation(() => new Promise(() => {}));
});

function load(state, props) {
  hooks.index = 0; hooks.overrides = { 4: false, ...(state === undefined ? {} : { [MLA_STATE]: state }) }; hooks.runEffects = true;
  render(props);
  hooks.runEffects = false;
}

describe('the picker is on MLA Directory only (F190)', () => {
  it('renders once on MLA Directory, beside the header', () => {
    expect(pickers(render())).toHaveLength(1);
  });

  it('renders on no other module, nor on MLA Directory of another tier', () => {
    for (const [tier, featureName] of [['state', 'Constituency Register'], ['state', 'MLA Report Card + Statement Tracker'], ['national', 'Cabinet Decisions'], ['national', 'MLA Directory']]) {
      hooks.index = 0;
      expect(pickers(render({ tier, featureName })), `${tier}:${featureName}`).toHaveLength(0);
    }
  });

  it('is still there while the list loads and when the load failed, so a state can be changed', () => {
    hooks.index = 0; hooks.overrides = { 4: true };
    expect(pickers(render())).toHaveLength(1);
    hooks.index = 0; hooks.overrides = { 4: false, 3: 'Module unavailable' };
    expect(pickers(render())).toHaveLength(1);
  });

  it('shows the chosen state, and passes the setter as its onChange', () => {
    hooks.index = 0; hooks.overrides = { [MLA_STATE]: 'Kerala' };
    const [picker] = pickers(render());
    expect(picker.props.value).toBe('Kerala');
    picker.props.onChange('Assam');
    expect(hooks.setters[MLA_STATE]).toHaveBeenCalledWith('Assam');
  });
});

describe('the request the picker makes (F190)', () => {
  it('"All states" sends no params at all', () => {
    load('');
    expect(api.whole).toHaveBeenCalledTimes(1);
    expect(api.whole.mock.calls[0][0]).toMatchObject({ tier: 'state', feature: 'MLA Directory' });
    expect(api.whole.mock.calls[0][0].params).toBeUndefined();
  });

  it('a chosen state sends params.state, and nothing else', () => {
    load('Kerala');
    expect(api.whole).toHaveBeenCalledTimes(1);
    expect(api.whole.mock.calls[0][0].params).toEqual({ state: 'Kerala' });
  });

  it('asks again with the same state when the answer is a stored one waiting for live data', async () => {
    vi.useFakeTimers();
    try {
      api.whole.mockImplementationOnce(() => Promise.resolve({ ...answer([]), served: 'archive', rows: [] }));
      api.whole.mockImplementation(() => new Promise(() => {}));
      load('Kerala');
      await vi.advanceTimersByTimeAsync(7000); // the first retry comes 6 s after the first answer (moduleLiveRetry.js)
      expect(api.whole.mock.calls.length).toBeGreaterThanOrEqual(2);
      for (const [opts] of api.whole.mock.calls) expect(opts.params).toEqual({ state: 'Kerala' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('other modules never send a state, even if one was left chosen', () => {
    load('Kerala', { tier: 'state', featureName: 'Constituency Register' });
    expect(api.whole.mock.calls[0][0].params).toBeUndefined();
  });

  it('starts again at the first page when the state changes', () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ title: `MLA ${i}` }));
    // The page the reader is on belongs to a view: [feature, search, sort, chart filter, answer filter], and a chosen state.
    const allStatesView = JSON.stringify(['MLA Directory', '', { key: '', dir: 'asc' }, undefined, '']);
    const pager = (state) => {
      hooks.index = 0;
      hooks.overrides = { 2: answer(rows), 4: false, 7: { view: allStatesView, n: 2 }, [MLA_STATE]: state };
      return nodes(render()).flatMap((n) => [n.props?.children].flat()).find((c) => typeof c === 'string' && /page \d+\/\d+/.test(c));
    };
    expect(pager('')).toMatch(/page 3\/3/);
    expect(pager('Kerala')).toMatch(/page 1\/3/);
  });
});
