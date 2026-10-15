// F196 Party Organisation Map: hover, focus, tap and click on a state. The component is called as a
// function with React's hooks replaced, so its handlers can be called directly (no DOM in these tests).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ active: '', setActive: null, ref: { current: '' } }));
vi.mock('react', async (original) => ({
  ...(await original()),
  useState: (init) => [hooks.active || (typeof init === 'function' ? init() : init), hooks.setActive],
  useRef: () => hooks.ref,
  useMemo: (fn) => fn(),
}));

import IndiaPartyMap from './IndiaPartyMap.jsx';
import { aggregatePartyStrength, partyStrengthRows } from '../lib/partyStrength.js';
import { clearPendingMlaState, pendingMlaState } from './mlaStateHandoff.js';

const many = (n, state, party) => Array.from({ length: n }, () => ({ state, party, as_of: '2026-08-19' }));
const result = aggregatePartyStrength([...many(6, 'Kerala', 'Indian National Congress'), ...many(4, 'Kerala', 'Communist Party of India (Marxist)'), ...many(3, 'Goa', 'Bharatiya Janata Party')]);
const feed = { ok: true, rows: partyStrengthRows(result), meta: { as_of: result.asOf, national: result.national, totalSeats: result.totalSeats } };

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree.type === 'function') return nodes(tree.type(tree.props));
  return [tree, ...nodes(tree.props?.children)];
}
const link = (tree, state) => nodes(tree).find((n) => n.type === 'a' && n.props.className === 'pm-link' && n.props['data-state'] === state);

beforeEach(() => {
  hooks.active = '';
  hooks.setActive = vi.fn();
  hooks.ref = { current: '' };
  clearPendingMlaState();
});

describe('a state on the map', () => {
  it('shows its tooltip on hover and keyboard focus, and hides it when left', () => {
    const kerala = link(IndiaPartyMap({ feed }), 'Kerala');
    kerala.props.onMouseEnter();
    expect(hooks.setActive).toHaveBeenLastCalledWith('Kerala');
    kerala.props.onFocus();
    expect(hooks.setActive).toHaveBeenLastCalledWith('Kerala');
    kerala.props.onMouseLeave();
    expect(hooks.setActive).toHaveBeenLastCalledWith('');
    kerala.props.onBlur();
    expect(hooks.setActive).toHaveBeenLastCalledWith('');
  });

  it('opens the MLA list for that state on a mouse click or Enter (the link’s own navigation)', () => {
    const kerala = link(IndiaPartyMap({ feed }), 'Kerala');
    const preventDefault = vi.fn();
    kerala.props.onPointerDown({ pointerType: 'mouse' });
    kerala.props.onClick({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(pendingMlaState()).toBe('Kerala');
  });

  it('on a touch screen, the first tap shows the tooltip and a second tap opens the list', () => {
    const preventDefault = vi.fn();
    let kerala = link(IndiaPartyMap({ feed }), 'Kerala');
    kerala.props.onPointerDown({ pointerType: 'touch' });
    kerala.props.onClick({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(hooks.setActive).toHaveBeenLastCalledWith('Kerala');
    expect(pendingMlaState()).toBe('');

    hooks.active = 'Kerala';
    kerala = link(IndiaPartyMap({ feed }), 'Kerala');
    kerala.props.onPointerDown({ pointerType: 'touch' });
    kerala.props.onClick({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(pendingMlaState()).toBe('Kerala');
  });

  it('a table row’s state link opens the same list', () => {
    const tree = IndiaPartyMap({ feed });
    const goa = nodes(tree).find((n) => n.type === 'a' && n.props.className === 'pm-table-link' && n.props.children === 'Goa');
    expect(goa.props.href).toBe('#/state/MLA%20Directory');
    goa.props.onClick();
    expect(pendingMlaState()).toBe('Goa');
  });
});

describe('the MLA Directory handoff', () => {
  it('keeps the chosen state for a few seconds only', () => {
    vi.useFakeTimers();
    try {
      const tree = IndiaPartyMap({ feed });
      link(tree, 'Goa').props.onClick({ preventDefault: () => {} });
      expect(pendingMlaState()).toBe('Goa');
      vi.advanceTimersByTime(10_001);
      expect(pendingMlaState()).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});
