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

  it('the Comparison Engine offers every handbook table; a renamed theme offers its own (F196)', async () => {
    pendingRequests();
    props = { ...props, featureName: 'Cross-State Comparison Engine' };
    await settle();
    expect(pickers(tree)[0].props.picker.defaultValue).toBe('21');
    props = { ...props, featureName: 'District Education Indicators' };
    await settle();
    expect(pickers(tree)[0].props.picker.options.map((o) => o.value)).toEqual(['1', '12', '151']);
  });
});

// F201: a table over 2,000 figures is stored as whole-year blocks; the Years control picks one.
const T176_BLOCKS = [['', '2023', '2025'], ['2020', '2020', '2022'], ['2017', '2017', '2019'], ['2014', '2014', '2016'], ['2011', '2011', '2013'], ['2008', '2008', '2010'], ['2005', '2005', '2007']]
  .map(([value, from, through]) => ({ value, variant: value ? `176@${value}` : '176', from, through, count: 1800 }));
const handbookAnswer = (table, { blocks, years } = {}) => ({
  ok: true, tier: 'state', feature: 'State Fiscal Deep-Dive', served: 'store', register: true, fallback: false, fetchedAt: '2026-10-15T00:00:00Z',
  rows: [{ title: `Goa · X · 2025`, state: 'Goa', indicator: 'X', year: '2025', value: 1, table_no: table }],
  source: { adapter: 'register', links: [], note: `Table ${table}` }, coverage: { from: '', through: '', exhaustive: false },
  meta: { heading: `Table ${table}`, table, ...(blocks ? { blocks } : {}), ...(years ? { years } : {}), status: 'RBI HANDBOOK · STATE LEVEL' },
});
const control = (id) => pickers(tree).find((p) => p.props.picker.id === id);

describe('the Years control (F201)', () => {
  it('appears only when the answer lists more than one block: not for one block, not for today\'s capped data', async () => {
    const asked = pendingRequests();
    await settle();
    asked[0].resolve(handbookAnswer(164, { blocks: [T176_BLOCKS[0]] }));
    await settle();
    expect(control('handbook-years')).toBeUndefined();
    pickers(tree)[0].props.onChange('176');
    await settle();
    asked.at(-1).resolve(handbookAnswer(176));
    await settle();
    expect(control('handbook-years')).toBeUndefined();
    expect(pickers(tree)).toHaveLength(1);
  });

  it('lists a split table\'s 7 blocks; a pick asks for that block of the table; the control stays while it loads', async () => {
    const asked = pendingRequests();
    await settle();
    pickers(tree)[0].props.onChange('176');
    await settle();
    asked.at(-1).resolve(handbookAnswer(176, { blocks: T176_BLOCKS }));
    await settle();
    const years = control('handbook-years');
    expect(years.props.picker).toMatchObject({ param: 'years', label: 'Years', defaultValue: '' });
    expect(years.props.picker.options).toHaveLength(7);
    expect(years.props.picker.options[0]).toEqual({ value: '', label: '2023 to 2025' });
    expect(years.props.picker.options.at(-1)).toEqual({ value: '2005', label: '2005 to 2007' });
    years.props.onChange('2005');
    await settle();
    expect(asked.at(-1).opts.params).toEqual({ table: '176', years: '2005' });
    // The other block's list is not left on screen while this one loads (F190), but the control is.
    expect(onFeed.mock.calls.at(-1)[0]).toBeNull();
    expect(control('handbook-years').props.value).toBe('2005');
  });

  it('a one-year block reads as its year', async () => {
    const { yearsPicker } = await import('../lib/modulePicker.js');
    const blocks = [{ value: '', variant: '151', from: '2020-21', through: '2024-25', count: 1850 }, { value: '2019-20', variant: '151@2019-20', from: '2019-20', through: '2019-20', count: 360 }];
    expect(yearsPicker('state', 'District Education Indicators', { meta: { blocks } }).options.map((o) => o.label)).toEqual(['2020-21 to 2024-25', '2019-20']);
    expect(yearsPicker('state', 'Cabinet Decisions', { meta: { blocks } })).toBeNull();
    expect(yearsPicker('state', 'District Education Indicators', null)).toBeNull();
  });

  it('changing the table drops the Years pick', async () => {
    const asked = pendingRequests();
    await settle();
    pickers(tree)[0].props.onChange('176');
    await settle();
    asked.at(-1).resolve(handbookAnswer(176, { blocks: T176_BLOCKS }));
    await settle();
    control('handbook-years').props.onChange('2005');
    await settle();
    control('handbook-table').props.onChange('177');
    await settle();
    expect(asked.at(-1).opts.params).toEqual({ table: '177' });
    expect(control('handbook-years')).toBeUndefined();
    // Back to 176: the newest block, not the old pick.
    control('handbook-table').props.onChange('176');
    await settle();
    expect(asked.at(-1).opts.params).toEqual({ table: '176' });
  });
});

describe('the Comparison Engine\'s Year control (F201)', () => {
  const YEARS = ['2024-25', '2023-24', '2015-16', '2011-12'];
  const comparisonAnswer = (table) => ({ ...handbookAnswer(table, { years: YEARS, blocks: T176_BLOCKS }), feature: 'Cross-State Comparison Engine' });
  beforeEach(() => {
    props = { ...props, featureName: 'Cross-State Comparison Engine' };
  });

  it('lists the table\'s years with "Latest" first; a pick asks for that year of the table', async () => {
    const asked = pendingRequests();
    await settle();
    asked[0].resolve(comparisonAnswer(21));
    await settle();
    const year = control('comparison-year');
    expect(year.props.picker).toMatchObject({ param: 'year', label: 'Year', defaultValue: '' });
    expect(year.props.picker.options).toEqual([{ value: '', label: 'Latest' }, ...YEARS.map((y) => ({ value: y, label: y }))]);
    // The Comparison has no Years control, whatever its answer lists.
    expect(control('handbook-years')).toBeUndefined();
    year.props.onChange('2015-16');
    await settle();
    expect(asked.at(-1).opts.params).toEqual({ table: '21', year: '2015-16' });
    expect(control('comparison-year').props.value).toBe('2015-16');
  });

  it('a table change drops the year', async () => {
    const asked = pendingRequests();
    await settle();
    asked[0].resolve(comparisonAnswer(21));
    await settle();
    control('comparison-year').props.onChange('2015-16');
    await settle();
    control('comparison-table').props.onChange('164');
    await settle();
    expect(asked.at(-1).opts.params).toEqual({ table: '164' });
    expect(control('comparison-year')).toBeUndefined();
  });

  it('offers only years the server ranks by: a span or a long form is left out (F201 review)', async () => {
    const { comparisonYearPicker } = await import('../lib/modulePicker.js');
    const picker = comparisonYearPicker('state', 'Cross-State Comparison Engine', { meta: { years: ['2024-25', '2019-23', '2015-19', '2020-2021', '2018', '1989-90'] } });
    expect(picker.options.map((o) => o.value)).toEqual(['', '2024-25', '2018']);
  });

  it('no years in the answer, no Year control; a handbook module never shows one', async () => {
    const { comparisonYearPicker } = await import('../lib/modulePicker.js');
    expect(comparisonYearPicker('state', 'Cross-State Comparison Engine', { meta: {} })).toBeNull();
    expect(comparisonYearPicker('state', 'State Fiscal Deep-Dive', { meta: { years: YEARS } })).toBeNull();
    const asked = pendingRequests();
    props = { ...props, featureName: 'State Fiscal Deep-Dive' };
    await settle();
    asked.at(-1).resolve(handbookAnswer(164, { years: YEARS }));
    await settle();
    expect(control('comparison-year')).toBeUndefined();
  });
});
