import { describe, expect, it } from 'vitest';
import {
  PANEL_MAX_PCT, PANEL_MIN_PX, PANEL_WIDTH_STORAGE_KEY,
  availableTabs, clampPanelWidth, defaultPanelWidth, dragPanelWidth, initialPanel, panelBounds, panelReducer,
  readStoredPanelWidth, resolvePanelWidth, stepPanelWidth,
} from './sidePanelModel.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

// side-panel spec point 1: Desk | Record | AI, as one tablist.
describe('which tabs the panel has', () => {
  it('a desk with a rail today has Desk and AI, and Record while a row is selected', () => {
    expect(availableTabs({ hasRail: true, selected: null })).toEqual(['desk', 'ai']);
    expect(availableTabs({ hasRail: true, selected: { id: 1 } })).toEqual(['desk', 'record', 'ai']);
  });

  it('a desk without a rail today (home, holistic desks) has AI only', () => {
    expect(availableTabs({ hasRail: false, selected: { id: 1 } })).toEqual(['ai']);
  });
});

describe('the active tab', () => {
  const rail = { hasRail: true, selected: null };
  const row = { id: 7 };

  it('opens on Desk where there is a rail, and stays hidden where there is not', () => {
    expect(initialPanel(rail)).toMatchObject({ active: 'desk', open: true, mounted: ['desk'] });
    expect(initialPanel({ hasRail: false, selected: null })).toMatchObject({ active: null, open: false, mounted: [] });
  });

  it('selecting a row opens Record; clearing it returns to Desk', () => {
    const s1 = panelReducer(initialPanel(rail), { type: 'select', row }, { hasRail: true, selected: row });
    expect(s1).toMatchObject({ active: 'record', mounted: ['desk', 'record'] });
    const s2 = panelReducer(s1, { type: 'clear' }, rail);
    expect(s2.active).toBe('desk');
  });

  it('an "Ask AI" entry point selects AI and opens the panel, even collapsed or on a desk without a rail', () => {
    const collapsed = panelReducer(initialPanel(rail), { type: 'collapse' }, rail);
    expect(collapsed.open).toBe(false);
    expect(panelReducer(collapsed, { type: 'ai-open' }, rail)).toMatchObject({ active: 'ai', open: true, collapsed: false });
    expect(panelReducer(initialPanel({ hasRail: false, selected: null }), { type: 'ai-open' }, { hasRail: false, selected: null }))
      .toMatchObject({ active: 'ai', open: true, mounted: ['ai'] });
  });

  it('selecting a row while on AI keeps AI (the chat is not interrupted); Record becomes available', () => {
    const ai = panelReducer(initialPanel(rail), { type: 'ai-open' }, rail);
    expect(panelReducer(ai, { type: 'select', row }, { hasRail: true, selected: row }).active).toBe('ai');
  });

  // Amendment 2 (owner, 2026-10-03): "clicking on any of these bills ... must always open the panel".
  it('selecting a row while collapsed opens the panel on Record', () => {
    const collapsed = panelReducer(initialPanel(rail), { type: 'collapse' }, rail);
    const s = panelReducer(collapsed, { type: 'select', row }, { hasRail: true, selected: row });
    expect(s).toMatchObject({ open: true, collapsed: false, active: 'record' });
  });

  it('selecting a row with AI collapsed opens the panel on Record (AI is not in use)', () => {
    const ai = panelReducer(initialPanel(rail), { type: 'ai-open' }, rail);
    const collapsed = panelReducer(ai, { type: 'collapse' }, rail);
    expect(panelReducer(collapsed, { type: 'select', row }, { hasRail: true, selected: row })).toMatchObject({ open: true, active: 'record' });
  });

  it('a module change reopens a collapsed panel (a new page opens it)', () => {
    const collapsed = panelReducer(initialPanel(rail), { type: 'collapse' }, rail);
    expect(panelReducer(collapsed, { type: 'context' }, rail)).toMatchObject({ open: true, collapsed: false, active: 'desk' });
  });

  it('a tab click switches only to an available tab', () => {
    const s = initialPanel(rail);
    expect(panelReducer(s, { type: 'tab', tab: 'record' }, rail)).toBe(s);
    expect(panelReducer(s, { type: 'tab', tab: 'ai' }, rail)).toMatchObject({ active: 'ai', mounted: ['desk', 'ai'] });
  });

  it('closing AI returns to Record or Desk where there is a rail, and hides the panel where there is not', () => {
    const ai = panelReducer(initialPanel(rail), { type: 'ai-open' }, rail);
    expect(panelReducer(ai, { type: 'close-ai' }, rail)).toMatchObject({ active: 'desk', open: true });
    expect(panelReducer(ai, { type: 'close-ai' }, { hasRail: true, selected: row })).toMatchObject({ active: 'record' });
    const bare = panelReducer(initialPanel({ hasRail: false, selected: null }), { type: 'ai-open' }, { hasRail: false, selected: null });
    expect(panelReducer(bare, { type: 'close-ai' }, { hasRail: false, selected: null })).toMatchObject({ open: false, mounted: ['ai'] });
  });

  it('reopening from the collapsed handle opens the chosen tab', () => {
    const collapsed = panelReducer(initialPanel(rail), { type: 'collapse' }, rail);
    expect(panelReducer(collapsed, { type: 'reopen', tab: 'ai' }, rail)).toMatchObject({ open: true, collapsed: false, active: 'ai' });
    expect(panelReducer(collapsed, { type: 'reopen' }, rail)).toMatchObject({ open: true, active: 'desk' });
  });

  it('a desk change re-derives the tabs: off a rail desk Desk and Record go, AI stays if it was open', () => {
    const ai = panelReducer(initialPanel(rail), { type: 'ai-open' }, rail);
    expect(panelReducer(ai, { type: 'context' }, { hasRail: false, selected: null })).toMatchObject({ active: 'ai', open: true });
    expect(panelReducer(initialPanel(rail), { type: 'context' }, { hasRail: false, selected: null })).toMatchObject({ active: null, open: false });
    const back = panelReducer(initialPanel({ hasRail: false, selected: null }), { type: 'context' }, rail);
    expect(back).toMatchObject({ active: 'desk', open: true });
  });

  it('the mounted set only grows, so no tab once shown is unmounted', () => {
    let s = initialPanel(rail);
    const steps = [
      [{ type: 'ai-open' }, rail], [{ type: 'select', row }, { hasRail: true, selected: row }], [{ type: 'tab', tab: 'record' }, { hasRail: true, selected: row }],
      [{ type: 'clear' }, rail], [{ type: 'collapse' }, rail], [{ type: 'context' }, { hasRail: false, selected: null }], [{ type: 'close-ai' }, { hasRail: false, selected: null }],
    ];
    let seen = new Set(s.mounted);
    for (const [action, ctx] of steps) {
      s = panelReducer(s, action, ctx);
      for (const t of seen) expect(s.mounted).toContain(t);
      seen = new Set(s.mounted);
    }
    expect(s.mounted).toEqual(expect.arrayContaining(['desk', 'ai', 'record']));
  });

  it('a page load always opens the panel where there is a rail (a collapse is not remembered)', () => {
    expect(initialPanel(rail)).toMatchObject({ open: true, collapsed: false, active: 'desk' });
    expect(initialPanel({ hasRail: true, selected: row })).toMatchObject({ open: true, active: 'record' });
  });
});

// side-panel spec point 2 and owner decision 1: one docked width, 50% by default, 400 px to 60%
// (amendment 2: 340 px left no room for the tab bar with AI's actions in it).
describe('the docked width', () => {
  it('defaults to 50% of the workspace within 400 px and 60%', () => {
    expect(PANEL_MIN_PX).toBe(400);
    expect(defaultPanelWidth(1400)).toBe(700);
    expect(defaultPanelWidth(800)).toBe(PANEL_MIN_PX);
    expect(panelBounds(1400)).toEqual({ min: PANEL_MIN_PX, max: Math.round(1400 * PANEL_MAX_PCT / 100) });
  });

  it('never lets the bounds cross on a narrow workspace', () => {
    expect(panelBounds(300)).toEqual({ min: 300, max: 300 });
  });

  it('clamps a chosen width, and a non-number gives the default', () => {
    expect(clampPanelWidth(100, 1400)).toBe(PANEL_MIN_PX);
    expect(clampPanelWidth(5000, 1400)).toBe(840);
    expect(clampPanelWidth(Number.NaN, 1400)).toBe(700);
    expect(resolvePanelWidth(null, 1400)).toBe(700);
    expect(resolvePanelWidth(600.4, 1400)).toBe(600);
  });

  it('the left edge widens as the pointer moves left', () => {
    expect(dragPanelWidth(500, 900, 850, 1400)).toBe(550);
    expect(dragPanelWidth(500, 900, 950, 1400)).toBe(450);
  });

  it('keys step 16 px (Shift four times), Home and End go to the bounds, other keys are not taken', () => {
    expect(stepPanelWidth(500, 'ArrowLeft', { workspaceWidth: 1400 })).toBe(516);
    expect(stepPanelWidth(500, 'ArrowRight', { shift: true, workspaceWidth: 1400 })).toBe(436);
    expect(stepPanelWidth(500, 'Home', { workspaceWidth: 1400 })).toBe(PANEL_MIN_PX);
    expect(stepPanelWidth(500, 'End', { workspaceWidth: 1400 })).toBe(840);
    expect(stepPanelWidth(500, 'Enter', { workspaceWidth: 1400 })).toBeNull();
  });

  it('a stored width is read back clamped, and junk or a throwing storage reads as none', () => {
    expect(readStoredPanelWidth(memory({ [PANEL_WIDTH_STORAGE_KEY]: '9999' }), 1400)).toBe(840);
    expect(readStoredPanelWidth(memory({ [PANEL_WIDTH_STORAGE_KEY]: 'wide' }), 1400)).toBeNull();
    expect(readStoredPanelWidth({ getItem() { throw new Error('blocked'); } }, 1400)).toBeNull();
  });
});
