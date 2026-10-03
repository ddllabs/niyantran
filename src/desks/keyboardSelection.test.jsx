import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ index: 0, overrides: {} }));
vi.mock('react', async (original) => ({ ...await original(),
  useState: (init) => { const i = hooks.index++; return [i in hooks.overrides ? hooks.overrides[i] : typeof init === 'function' ? init() : init, () => {}]; },
  useEffect: () => {}, useMemo: (fn) => fn(), useRef: (v) => ({ current: v }), useDeferredValue: (v) => v,
}));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: null }));
import BudgetDesk from './BudgetDesk.jsx';
import FundFlowDesk from './FundFlowDesk.jsx';
import ProjectsDesk from './ProjectsDesk.jsx';
import DelimitationDesk from './DelimitationDesk.jsx';
import IndustryDesk from './IndustryDesk.jsx';
import ManifestosDesk from './ManifestosDesk.jsx';
import DeskView from './DeskView.jsx';
import HomeDesk from './HomeDesk.jsx';
function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
beforeEach(() => { hooks.index = 0; hooks.overrides = {}; });
for (const Component of [BudgetDesk, FundFlowDesk, ProjectsDesk, DelimitationDesk, IndustryDesk, ManifestosDesk]) {
  it(`${Component.name} activates selectable rows with Enter/Space and ignores descendant keys`, () => {
    const select = vi.fn(); const tree = Component({ selected: null, onSelect: select, feed: { rows: [{ line: 1, category: 'Health', title: 'Health' }] } });
    const rows = nodes(tree).filter((n) => n.type === 'tr' && n.props.onClick); expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.props.tabIndex).toBe(0);
      const target = {}, preventDefault = vi.fn();
      row.props.onKeyDown({ key: 'Enter', target, currentTarget: target, preventDefault }); expect(select).toHaveBeenCalled(); select.mockClear();
      row.props.onKeyDown({ key: ' ', target, currentTarget: target, preventDefault }); expect(preventDefault).toHaveBeenCalled(); expect(select).toHaveBeenCalled(); select.mockClear();
      row.props.onKeyDown({ key: 'Enter', target: {}, currentTarget: target, preventDefault }); expect(select).not.toHaveBeenCalled();
    }
  });
}
it('generic table keeps row keyboard selection and announces active sort direction', () => {
  const row = { title: 'Alpha', value: 1 }; hooks.overrides = { 1: { key: 'title', dir: 'desc' }, 2: { ok: true, rows: [row], columns: [{ key: 'title', label: 'Title' }], meta: {} }, 4: false };
  const select = vi.fn(); const tree = DeskView({ featureName: 'Test feed', tier: 'test', selected: null, onSelect: select });
  const all = nodes(tree), tr = all.find((n) => n.type === 'tr' && n.props.onClick); expect(tr).toBeDefined(); expect(tr.props.tabIndex).toBe(0);
  const target = {}; tr.props.onKeyDown({ key: 'Enter', target, currentTarget: target, preventDefault: () => {} }); expect(select).toHaveBeenCalledWith(row);
  expect(all.find((n) => n.type === 'th' && n.props['aria-sort'] === 'descending')).toBeDefined();
});

it('home ticker visual clones are hidden from both the screen reader and keyboard focus', () => {
  hooks.overrides = { 7: [{ key: 'bill', tab: 'national', feature: 'Bills', text: 'A bill', cat: 'National' }] };
  const tree = HomeDesk({ onOpen: vi.fn() });
  const topics = nodes(tree).filter((n) => n.type === 'button' && n.props.className === 'nh-topic');
  expect(topics).toHaveLength(2);
  expect(topics[0].props['aria-hidden']).toBeUndefined();
  expect(topics[0].props.tabIndex).toBeUndefined();
  expect(topics[1].props['aria-hidden']).toBe(true);
  expect(topics[1].props.tabIndex).toBe(-1);
});
