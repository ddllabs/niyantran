// F156 (spec section 6): on Bills and Questions the browser holds one page, so the side panel's
// figures and the filter menu come with the answer (worked out over the whole register), and a
// record's related rows are asked of the server.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ index: 0, overrides: {}, runEffects: false, related: null, coverage: null }));
vi.mock('react', async (original) => ({ ...await original(),
  useState: (init) => {
    if (hooks.coverage && init?.key === null && 'value' in init) return [hooks.coverage, vi.fn()];
    // useRelatedRows' state, wherever it falls in a component's hooks.
    if (hooks.related && init && typeof init === 'object' && 'key' in init && 'rows' in init) return [hooks.related, vi.fn()];
    const i = hooks.index++; return [i in hooks.overrides ? hooks.overrides[i] : typeof init === 'function' ? init() : init, vi.fn()]; },
  useEffect: (fn) => { if (hooks.runEffects) fn(); }, useLayoutEffect: () => {},
  useMemo: (fn) => fn(), useRef: (v) => ({ current: v }), useCallback: (fn) => fn,
}));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: null }));
const api = vi.hoisted(() => ({ page: vi.fn() }));
vi.mock('../lib/featureFeed.js', () => ({ fetchFeaturePage: api.page }));
import RailContent, { useRelatedRows } from './RailContent.jsx';
import TableFilterPop from './TableFilterPop.jsx';

const BILLS = 'Bill Passage Probability Index';
const ROW = { id: '1', bill_name: 'The Finance Bill, 2026', house: 'Rajya Sabha', sector: 'FINANCE', date_introduced: '2026-02-01' };
const paged = (extra) => ({
  ok: true, paged: true, prepared: true, tier: 'national', feature: BILLS, rows: [ROW], total: 9819, totalAll: 9819, columns: [],
  overview: { title: 'BILL PASSAGE INDEX', kpis: [{ label: 'REGISTER BILLS', value: '9,819', sub: 'whole register' }], charts: [] },
  filterGroups: [{ id: 'house|', title: 'HOUSE', col: 'house', map: '', options: [{ label: 'Lok Sabha', n: 6522, filterCol: 'house', filterValue: 'Lok Sabha' }] }],
  meta: {}, source: { adapter: 'embedded', note: '' }, coverage: {}, fallback: false, served: 'live', ...extra,
});

function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
const text = (tree) => nodes(tree).flatMap((n) => [n.props?.children].flat()).filter((c) => typeof c === 'string' || typeof c === 'number').map(String);

beforeEach(() => { hooks.index = 0; hooks.overrides = {}; hooks.runEffects = false; hooks.related = null; api.page.mockReset(); });

describe('side panel and filter menu on a paged module (F156)', () => {
  it('shows the register’s figures from the answer, not figures of the page on screen', () => {
    const all = text(RailContent({ view: 'desk', feed: paged(), selected: null, onSelect: vi.fn(), loading: false }));
    expect(all).toContain('REGISTER BILLS');
    expect(all).toContain('9,819');
  });

  it('offers the register’s filter options and counts from the answer', () => {
    hooks.overrides = { 0: true };
    const all = text(TableFilterPop({ feed: paged(), q: '', onQ: vi.fn() }));
    expect(all).toContain('Lok Sabha');
    expect(all).toContain('6522');
    expect(all).not.toContain('Rajya Sabha');
  });
});

describe('a record’s related rows on a paged module (F156)', () => {
  it('asks the server for up to 200 rows of the same sector, newest first', () => {
    api.page.mockReturnValue(new Promise(() => {}));
    hooks.runEffects = true;
    expect(useRelatedRows(paged(), ROW)).toEqual([]);
    expect(api.page).toHaveBeenCalledTimes(1);
    expect(api.page.mock.calls[0][0]).toMatchObject({ tier: 'national', feature: BILLS, pageSize: 200, sort: 'date_introduced', dir: 'desc', filter: [{ col: 'sector', value: 'FINANCE' }] });
  });

  it('asks for the same member’s questions on the Questions desk', () => {
    api.page.mockReturnValue(new Promise(() => {}));
    hooks.runEffects = true;
    useRelatedRows(paged({ feature: 'Parliamentary Question Database' }), { id: '7', mp_name: ' Shri A. Member ', subject: 'Rail' });
    expect(api.page.mock.calls[0][0]).toMatchObject({ pageSize: 200, sort: 'date', dir: 'desc', filter: [{ col: 'mp_name', value: 'Shri A. Member' }] });
  });

  it('passes the fetched rows on, and the feed’s rows on a module that is not paged', () => {
    const feed = paged();
    const key = JSON.stringify(['national', BILLS, { pageSize: 200, sort: 'date_introduced', dir: 'desc', filter: [{ col: 'sector', value: 'FINANCE' }] }]);
    const related = [{ ...ROW, id: '2' }];
    hooks.overrides = { 0: { key, rows: related } };
    expect(useRelatedRows(feed, ROW)).toBe(related);
    hooks.index = 0;
    hooks.runEffects = true;
    const whole = { feature: 'Cabinet Decisions', rows: [{ title: 'A' }] };
    expect(useRelatedRows(whole, { title: 'A' })).toBe(whole.rows);
    expect(api.page).not.toHaveBeenCalled();
  });
});

describe('the record panel on a paged module (F156)', () => {
  it('lists the related rows the server sent, not rows of the page on screen', () => {
    const feed = paged({ rows: [ROW, { ...ROW, id: '3', bill_name: 'The Page Neighbour Bill, 2026' }] });
    const key = JSON.stringify(['national', BILLS, { pageSize: 200, sort: 'date_introduced', dir: 'desc', filter: [{ col: 'sector', value: 'FINANCE' }] }]);
    hooks.related = { key, rows: [ROW, { ...ROW, id: '2', bill_name: 'The Server Sent Bill, 2025' }] };
    const tree = RailContent({ view: 'record', feed, selected: ROW, onSelect: vi.fn(), loading: false });
    const host = nodes(tree).find((n) => typeof n.type === 'function' && n.props?.adapter);
    const panel = host.type(host.props);
    const titles = panel.props.model.touches.links.map((l) => l.title);
    expect(titles.join(' ')).toMatch(/Server Sent/i);
    expect(titles.join(' ')).not.toMatch(/Page Neighbour/i);
  });
});

it('F261 the Parliamentary host supplies verified coverage without rewriting register fields',()=>{
 const selected={id:'q1',subject:'Flood management',mp_name:'Member Name',has_answer:'Not reported'};
 const feed=paged({feature:'Parliamentary Question Database',rows:[selected],paged:false});
 const key='desk-record:["national","Parliamentary Question Database","q1"]';
 hooks.coverage={key,value:'full'};
 const tree=RailContent({view:'record',feed,selected,onSelect:vi.fn(),loading:false});
 const host=nodes(tree).find(n=>typeof n.type==='function'&&n.props?.adapter);
 const panel=host.type(host.props);
 expect(panel.props.model.glance.visual.steps[1].detail).toBe('Full text');
 expect(selected.has_answer).toBe('Not reported');
 hooks.coverage={key:'another-record',value:'full'};
 const other=host.type(host.props);
 expect(other.props.model.glance.visual.steps[1].detail).toBe('Record only');
 hooks.coverage=null;
});
