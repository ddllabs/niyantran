import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ index: 0 }));
vi.mock('react', async (original) => ({ ...await original(),
  useState: (init) => { hooks.index++; return [typeof init === 'function' ? init() : init, () => {}]; },
  useEffect: () => {}, useMemo: (fn) => fn(), useRef: (v) => ({ current: v }),
}));
import pack from '../data/commodities.json';
import leadersPack from '../data/leaders.json';
import { commoditiesFromPack, flattenLeader } from '../lib/globalResources.js';
import CommoditiesDesk from './CommoditiesDesk.jsx';
import LeadersDesk from './LeadersDesk.jsx';

/** Every element in a tree, expanding the desk's own row components (not the shared chrome). */
const EXPAND = new Set(['GroupPanel', 'BarRow']);
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree.type === 'function' && EXPAND.has(tree.type.name)) return [tree, ...nodes(tree.type(tree.props))];
  return [tree, ...nodes(tree.props?.children)];
}
const text = (tree) => nodes(tree).map((n) => (typeof n.props?.children === 'string' ? n.props.children : '')).join(' ');
beforeEach(() => { hooks.index = 0; });

const rows = commoditiesFromPack(pack);
const feed = { rows, meta: { asOf: pack.meta.asOf, stats: pack.stats, groups: pack.groups } };

// F121 T15: a commodity benchmark is a selectable record, so it opens the Record tab.
it('selects a commodity benchmark as its feed row, and clears it on a second click', () => {
  const select = vi.fn();
  const buttons = nodes(CommoditiesDesk({ feed, selected: null, onSelect: select })).filter((n) => n.type === 'button' && n.props.className?.includes('geo-bar'));
  expect(buttons.length).toBe(rows.length);
  buttons[0].props.onClick();
  expect(select).toHaveBeenCalledWith(rows.find((r) => r.commodity === buttons[0].props['data-commodity']));
  hooks.index = 0;
  const chosen = rows[0];
  const again = nodes(CommoditiesDesk({ feed, selected: chosen, onSelect: select })).filter((n) => n.type === 'button' && n.props['data-commodity'] === chosen.commodity);
  expect(again[0].props['aria-pressed']).toBe(true);
  again[0].props.onClick();
  // F135: the second click names the row, so a collapsed panel can reopen it instead.
  expect(select).toHaveBeenLastCalledWith(null, { toggled: chosen });
});

// F121 T15: the Record tab now shows the selected leader, so the desk no longer repeats it inline.
it('leaves the selected leader to the Record tab instead of an inline profile', () => {
  const leaders = leadersPack.leaders.map(flattenLeader).filter((r) => r.name);
  const tree = LeadersDesk({ feed: { rows: leaders, meta: { asOf: leadersPack.asOf } }, selected: leaders[0], onSelect: () => {} });
  expect(text(tree)).not.toMatch(/Selected profile/);
  expect(nodes(tree).some((n) => n.props?.className === 'geo-panel geo-leader-detail')).toBe(false);
});
