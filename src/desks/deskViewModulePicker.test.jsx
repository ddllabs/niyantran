// F196: the Table control on the RBI handbook modules and the Cross-State Comparison Engine, and the
// request it makes. Same small hooks runtime as deskViewMlaState.test.jsx (the repo has no DOM library).
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
import ModulePicker from './ModulePicker.jsx';
import MlaStatePicker from './MlaStatePicker.jsx';

function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
const pickers = (tree) => nodes(tree).filter((n) => n.type === ModulePicker);
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
async function settle() {
  for (let n = 0; n < 30; n += 1) {
    render();
    const effects = rt.pending.splice(0);
    effects.forEach((run) => run());
    await new Promise((r) => setTimeout(r, 0));
    if (!effects.length && !rt.dirty) return tree;
    rt.dirty = false;
  }
  throw new Error('the page did not settle');
}
function pendingRequests() {
  const asked = [];
  api.whole.mockImplementation((opts) => new Promise((resolve) => { asked.push({ opts, resolve }); }));
  return asked;
}

beforeEach(() => {
  Object.assign(rt, { slots: [], effects: [], refs: [], pending: [], dirty: false });
  api.page.mockReset(); api.whole.mockReset(); onFeed.mockClear(); onSelect.mockClear(); onLoading.mockClear();
  props = { featureName: 'State Fiscal Deep-Dive', tier: 'state', selected: null, onSelect, onFeed, onLoading, reload: 0 };
});

describe('the Table control (F196)', () => {
  it('a handbook module asks for its first table, then the table picked; other modules get no control and no table', async () => {
    const asked = pendingRequests();
    await settle();
    expect(pickers(tree)).toHaveLength(1);
    expect(pickers(tree)[0].props.picker).toMatchObject({ param: 'table', defaultValue: '164' });
    expect(nodes(tree).filter((n) => n.type === MlaStatePicker)).toHaveLength(0);
    pickers(tree)[0].props.onChange('176');
    await settle();
    expect(asked.map((a) => a.opts.params)).toEqual([undefined, { table: '176' }]);
    props = { ...props, featureName: 'Cabinet Decisions' };
    await settle();
    expect(pickers(tree)).toHaveLength(0);
    expect(asked.at(-1).opts.params).toBeUndefined();
  });

  // F196 review: the table picked on one module is never sent with the next module's first request.
  it('moving from one handbook module to another asks for the new module\'s first table only', async () => {
    const asked = pendingRequests();
    await settle();
    pickers(tree)[0].props.onChange('176');
    await settle();
    const before = asked.length;
    props = { ...props, featureName: 'Cross-State Comparison Engine' };
    await settle();
    const after = asked.slice(before).map((a) => a.opts.params);
    expect(after).toEqual([undefined]);
    expect(pickers(tree)[0].props.value).toBe('');
  });

  it('the Comparison Engine offers every handbook table; a renamed theme offers its own', async () => {
    pendingRequests();
    props = { ...props, featureName: 'Cross-State Comparison Engine' };
    await settle();
    expect(pickers(tree)[0].props.picker.defaultValue).toBe('21');
    props = { ...props, featureName: 'District Education Indicators' };
    await settle();
    expect(pickers(tree)[0].props.picker.options.map((o) => o.value)).toEqual(['1', '12', '151']);
  });
});
