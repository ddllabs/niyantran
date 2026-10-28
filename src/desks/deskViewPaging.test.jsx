// F156 (spec docs/specs/2026-10-14-paged-module-lists.md, section 6): Bills and Questions show one
// page from the server behind the existing 100-row pager, with counts from the answer's `total`; the
// whole module is loaded only when the paged API is not there.
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
import { openInDesk, pendingDeskRow } from '../ai/openRowSource.js';
import { deskRowKey } from '../lib/deskRows.js';
import { LAW_LISTING_FEATURE } from '../lib/pagedFeatures.js';

// DeskView's useState order: q 0, sort 1, feed 2, err 3, loading 4, visibleKeys 5, reloadTick 6,
// pageAt 7, hasAnswerFilter 8, pagedMode 9, pagedQ 10, paging 11.
const BILLS = 'Bill Passage Probability Index';
const QUESTIONS = 'Parliamentary Question Database';
// Labels unlike the browser's own Bills columns, so the test shows which list is used.
const COLUMNS = [{ key: 'bill_name', label: 'Bill (register)', default: true }, { key: 'house', label: 'House (register)', default: true }];
const rows = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: String(from + i), bill_name: `Bill ${from + i}`, house: 'Lok Sabha' }));
const paged = (extra) => ({ ok: true, paged: true, prepared: true, feature: BILLS, tier: 'national', rows: rows(100), page: 1, pageSize: 100,
  total: 2345, totalAll: 9819, columns: COLUMNS, filterGroups: [], overview: { kpis: [], charts: [] }, meta: {}, source: { adapter: 'embedded', note: '' }, ...extra });

function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
const text = (tree) => nodes(tree).flatMap((n) => [n.props?.children].flat()).filter((c) => typeof c === 'string' || typeof c === 'number').map(String);
const render = (props = {}) => DeskView({ featureName: BILLS, tier: 'national', selected: null, onSelect: vi.fn(), onFeed: vi.fn(), onLoading: vi.fn(), ...props });
const tick = () => new Promise((r) => setTimeout(r, 0));
const oldLawPage=()=>paged({tier:'judiciary',feature:LAW_LISTING_FEATURE,rows:[{id:'order',title:'Company order',availability:'indexed'}],total:1,
 columns:[{key:'title',label:'Title'},{key:'availability',label:'Text availability'}],
 filterGroups:[{col:'availability',title:'Text availability',options:[{label:'Indexed text',filterValue:'indexed',filterCol:'availability'}]},{col:'court',title:'Forum',options:[]}],
 source:{adapter:'law-canonical',note:''}});

beforeEach(() => {
  hooks.index = 0; hooks.overrides = {}; hooks.setters = {}; hooks.runEffects = false;
  api.page.mockReset(); api.whole.mockReset();
});

it('F264 cached Law columns and retained readiness selections cannot leak into public rows or filter chrome',()=>{
 hooks.overrides={2:oldLawPage(),4:false,5:['availability']};
 const tree=render({featureName:LAW_LISTING_FEATURE,tier:'judiciary',vizFilter:[{col:'availability',value:'indexed'}]});
 expect(text(tree).join(' ')).not.toMatch(/Text availability|Indexed text|indexed/);
 const all=nodes(tree);
 expect(all.filter(n=>n.type==='th').map(n=>text(n)[0])).toEqual(['Title']);
 expect(all.find(n=>n.type?.name==='VizFilterChip').props.vizFilter).toBeNull();
 const menu=all.find(n=>n.type?.name==='TableFilterPop');
 expect(menu.props.feed.filterGroups.map(group=>group.col)).toEqual(['court']);
 const row=all.find(n=>n.type?.name==='CorpusCapability').props.row;
 expect(row.id).toBe('order');expect(row).not.toHaveProperty('availability');
});

it('F264 a retained Law readiness sort/filter is dropped before the browser requests a page',()=>{
 api.page.mockReturnValue(new Promise(()=>{}));hooks.runEffects=true;
 hooks.overrides={1:{key:'availability',dir:'asc'}};
 render({featureName:LAW_LISTING_FEATURE,tier:'judiciary',vizFilter:[{col:'availability',value:'indexed'},{col:'court',value:'NCLT'}]});
 expect(api.page.mock.calls[0][0]).toMatchObject({sort:'date',dir:'desc',filter:[{col:'court',value:'NCLT'}]});
});

it('F264 old paged API envelopes are sanitized before the shell receives their records',async()=>{
 api.page.mockResolvedValue(oldLawPage());hooks.runEffects=true;
 const onFeed=vi.fn();render({featureName:LAW_LISTING_FEATURE,tier:'judiciary',onFeed});await tick();
 expect(onFeed.mock.calls[0][0].rows[0]).not.toHaveProperty('availability');
 expect(onFeed.mock.calls[0][0].columns.map(column=>column.key)).toEqual(['title']);
});

describe('a paged module on screen (F156)', () => {
  it('shows the server’s page as it is, with counts and columns from the answer', () => {
    // A search typed into the box does not filter the page again in the browser.
    hooks.overrides = { 0: 'no such words', 2: paged(), 4: false };
    const tree = render();
    const body = nodes(tree).filter((n) => n.type === 'tr' && n.props.onClick);
    expect(body).toHaveLength(100);
    const all = text(tree).join(' ');
    expect(all).toContain('2345 / 9819 rows');
    expect(all).toContain('page 1/24');
    expect(all).toMatch(/1\s*-\s*100\s*of\s*2,345/);
    expect(nodes(tree).filter((n) => n.type === 'th').map((n) => text(n)[0])).toEqual(['Bill (register)', 'House (register)']);
  });

  it('numbers a later page from the server’s page, not by slicing it again', () => {
    hooks.overrides = { 2: paged({ rows: rows(100, 200), page: 3 }), 4: false };
    const viewKey = JSON.stringify([BILLS, '', { key: '', dir: 'asc' }, undefined, '']);
    hooks.overrides[7] = { view: viewKey, n: 2 };
    hooks.overrides[9] = true;
    const tree = render();
    expect(nodes(tree).filter((n) => n.type === 'tr' && n.props.onClick)).toHaveLength(100);
    expect(text(tree).join(' ')).toMatch(/201\s*-\s*300\s*of\s*2,345/);
  });

  it('a search with no matches says so, rather than calling the module empty', () => {
    hooks.overrides = { 0: 'zzz', 2: paged({ rows: [], total: 0 }), 4: false };
    expect(text(render()).join(' ')).toContain('No rows in this view.');
  });
});

describe('what a paged module asks for (F156)', () => {
  it('asks the server for the page of the current view and never loads the whole module', () => {
    api.page.mockReturnValue(new Promise(() => {}));
    hooks.runEffects = true;
    hooks.overrides = { 1: { key: 'date', dir: 'desc' }, 8: ['unknown'], 10: 'railway' };
    render({ featureName: QUESTIONS, vizFilter: [{ col: 'ministry', value: 'RAILWAYS' }] });
    expect(api.whole).not.toHaveBeenCalled();
    expect(api.page).toHaveBeenCalledTimes(1);
    expect(api.page.mock.calls[0][0]).toMatchObject({ tier: 'national', feature: QUESTIONS, page: 1, q: 'railway', sort: 'date', dir: 'desc',
      filter: [{ col: 'ministry', value: 'RAILWAYS' }], answer: ['unknown'] });
  });

  it('waits 300 ms after typing stops before searching', () => {
    vi.useFakeTimers();
    try {
      api.page.mockReturnValue(new Promise(() => {}));
      hooks.runEffects = true;
      hooks.overrides = { 0: '  Railway ' };
      render();
      vi.advanceTimersByTime(299);
      expect(hooks.setters[10]).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(hooks.setters[10]).toHaveBeenCalledWith('railway');
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands the page to the shell and clears the selection on the first answer', async () => {
    const answer = paged();
    api.page.mockResolvedValue(answer);
    hooks.runEffects = true;
    const onFeed = vi.fn(), onSelect = vi.fn();
    render({ onFeed, onSelect });
    await tick();
    expect(onFeed).toHaveBeenCalledWith(answer);
    expect(hooks.setters[2]).toHaveBeenCalledWith(answer);
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(hooks.setters[9]).not.toHaveBeenCalled();
  });

  it('selects a cited row that is on another page by asking the server for it', async () => {
    const cited = { id: '9000', bill_name: 'The Cited Bill, 2019', house: 'Rajya Sabha' };
    openInDesk({ kind: 'row', tier: 'national', feature: BILLS, row_key: deskRowKey(cited) });
    api.page.mockImplementation(async (view) => (view.key ? paged({ rows: [cited], total: 1 }) : paged()));
    hooks.runEffects = true;
    const onSelect = vi.fn(), onReveal = vi.fn();
    render({ onSelect, onReveal });
    await tick();
    await tick();
    expect(api.page).toHaveBeenCalledWith(expect.objectContaining({ feature: BILLS, key: deskRowKey(cited) }));
    expect(onSelect).toHaveBeenLastCalledWith(cited);
    expect(onReveal).toHaveBeenCalledWith(cited);
    expect(pendingDeskRow()).toBeNull();
  });

  it('loads the whole module, as before, when the paged API is not there', async () => {
    api.page.mockResolvedValue(null);
    hooks.runEffects = true;
    render();
    await tick();
    expect(hooks.setters[9]).toHaveBeenCalledWith(false);
  });

  it('a module that is not paged loads whole, as before', () => {
    api.whole.mockReturnValue(new Promise(() => {}));
    hooks.runEffects = true;
    render({ featureName: 'Cabinet Decisions' });
    expect(api.page).not.toHaveBeenCalled();
    expect(api.whole).toHaveBeenCalledTimes(1);
  });
});

it('Law errors retain bounded paging and clear stale rows instead of switching to whole-feed mode', async () => {
  api.page.mockRejectedValue(new Error('Law listings unavailable'));
  hooks.runEffects = true;
  const onFeed = vi.fn(), onLoading = vi.fn();
  render({ featureName: 'NCLT / NCLAT (Insolvency)', tier: 'judiciary', onFeed, onLoading });
  await tick();
  expect(hooks.setters[9]).not.toHaveBeenCalledWith(false);
  expect(onFeed).toHaveBeenCalledWith(null);
  expect(onLoading).toHaveBeenCalledWith(false);
  expect(api.whole).not.toHaveBeenCalled();
});

it('Law table selection identifies the record, never another order or announcement with the same title', () => {
  const feature = 'NCLT / NCLAT (Insolvency)';
  const order = { id: 'order-1', title: 'Future Consumer' };
  const announcement = { id: 'announcement-1', title: 'Future Consumer' };
  hooks.overrides = { 2: paged({ feature, rows: [order, announcement], columns: [{ key: 'title', label: 'Title' }] }), 4: false };
  const tree = render({ featureName: feature, tier: 'judiciary', selected: order });
  const body = nodes(tree).filter(n => n.type === 'tr' && n.props.onClick);
  expect(body.map(n => n.props.className)).toEqual(['on', '']);
});

it('does not erase the restored search when a desk mounts', () => {
  api.page.mockReturnValue(new Promise(() => {}));
  hooks.runEffects = true;
  hooks.overrides = { 0: 'railway', 10: 'railway' };
  render({ featureName: QUESTIONS });
  expect(hooks.setters[0]).not.toHaveBeenCalledWith('');
});

it('reports an unavailable off-page target instead of silently keeping an unrelated record', async () => {
  openInDesk({ kind: 'row', tier: 'national', feature: BILLS, row_key: 'missing' });
  api.page.mockImplementation(async view => view.key ? paged({ rows: [], total: 0 }) : paged());
  hooks.runEffects = true;
  const onReveal = vi.fn();
  render({ onReveal }); await tick(); await tick();
  expect(onReveal).toHaveBeenCalledWith(null);
});
