import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../ai/AiPanel.jsx', () => ({ default: (p) => <div data-ai-panel={p.open ? 'open' : 'hidden'} data-embedded={String(p.embedded)} data-actions-slot={String(p.actionsSlot)} /> }));
vi.mock('./RailContent.jsx', () => ({ default: (p) => <div data-rail={p.view} />, railClasses: () => 'right-rail' }));
import SidePanel, { attachRailDismiss, dragOpensAi, escapeAction, panelDragProps, pickIntent, railDismissible } from './SidePanel.jsx';
import { panelReducer } from './sidePanelModel.js';

const panel = (state, extra = {}) => ({
  state: { open: true, collapsed: false, mounted: ['desk'], active: 'desk', ...state }, act: () => {}, seed: null, consumeSeed: () => {},
  expanded: false, userExpanded: false, setUserExpanded: () => {}, citation: { open: false }, setCitation: () => {}, citationExpanded: false, ...extra,
});
const render = (state, props = {}, extra = {}) => renderToStaticMarkup(<SidePanel panel={panel(state, extra)} hasRail feed={{ feature: 'Bills' }} selected={null} lang="en" {...props} />);

// side-panel spec point 1: one real tablist for Desk, Record and AI research.
describe('the side panel', () => {
  it('is one tablist: the active tab is selected and focusable, each tab controls its panel', () => {
    const html = render({});
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(2); // Desk and AI; no Record without a selection
    expect(html).toMatch(/id="side-panel-tab-desk"[^>]*aria-selected="true"[^>]*aria-controls="side-panel-desk"[^>]*tabindex="0"/);
    expect(html).toMatch(/id="side-panel-tab-ai"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    expect(html).toMatch(/role="tabpanel" id="side-panel-desk" aria-labelledby="side-panel-tab-desk"/);
  });

  it('offers Record while a row is selected', () => {
    expect(render({}, { selected: { id: 1 } })).toContain('id="side-panel-tab-record"');
  });

  it('keeps every mounted tab rendered, hiding the inactive ones rather than removing them', () => {
    const html = render({ active: 'ai', mounted: ['desk', 'record', 'ai'] }, { selected: { id: 1 } });
    expect(html).toMatch(/id="side-panel-desk"[^>]*hidden=""/);
    expect(html).toMatch(/id="side-panel-record"[^>]*hidden=""/);
    expect(html).toContain('data-rail="desk"');
    expect(html).toContain('data-rail="record"');
    expect(html).toContain('data-ai-panel="open"');
    expect(html).toContain('data-embedded="true"');
    const desk = render({ active: 'desk', mounted: ['desk', 'ai'] });
    expect(desk).toContain('data-ai-panel="hidden"');
  });

  it('only the AI tab shows on a desk without a rail, and it closes rather than collapses', () => {
    const html = render({ active: 'ai', mounted: ['ai'] }, { hasRail: false });
    expect(html.match(/role="tab"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Close"');
    expect(render({ open: false, active: 'ai', mounted: ['ai'] }, { hasRail: false })).toMatch(/<aside[^>]*hidden=""/);
  });

  it('collapsed (owner decision 2), it shows a handle to reopen any tab and keeps the tabs mounted', () => {
    const html = render({ open: false, collapsed: true, mounted: ['desk', 'ai'] });
    expect(html).toContain('class="side-panel-handle"');
    expect(html).not.toContain('role="tablist"');
    expect(html).toMatch(/class="side-panel-body" hidden=""/);
    expect(html).toContain('data-rail="desk"');
    expect(html).toContain('data-ai-panel="hidden"');
    expect(html).not.toMatch(/<aside[^>]*hidden=""/);
  });

  // side-panel spec point 2: the panel's left edge resizes it, by pointer or keyboard, on every tab.
  it('has one resize edge, a focusable vertical separator, on every tab and not while collapsed', () => {
    for (const active of ['desk', 'ai']) {
      expect(render({ active, mounted: ['desk', 'ai'] })).toMatch(/<div[^>]*role="separator"[^>]*aria-orientation="vertical"[^>]*aria-label="Resize the panel"[^>]*tabindex="0"[^>]*class="side-panel-edge"/);
    }
    expect(render({ open: false, collapsed: true, mounted: ['desk'] })).not.toContain('role="separator"');
  });

  // side-panel spec point 3: one expand mode, on every tab, using the overlay's design.
  it('every tab offers Expand; docked, the panel is the overlay\'s plain wrapper', () => {
    for (const active of ['desk', 'ai']) {
      const html = render({ active, mounted: ['desk', 'ai'] });
      expect(html).toMatch(/class="side-panel-expand"[^>]*aria-pressed="false"[^>]*aria-label="Expand the panel"/);
      expect(html).toContain('<div class="cov"><div class="cov-chat">');
    }
  });

  it('expanded without a citation: one column, Restore pressed, and no docked edge', () => {
    const html = render({ active: 'desk' }, {}, { expanded: true, userExpanded: true });
    expect(html).toMatch(/<div class="cov is-open is-solo"/);
    expect(html).toMatch(/class="side-panel-expand on"[^>]*aria-pressed="true"[^>]*aria-label="Restore the panel"/);
    expect(html).not.toContain('class="side-panel-edge"');
    expect(html).not.toContain('cov-viewer');
  });

  it('a citation open in AI expands it with the viewer pane beside the panel, and Expand is locked meanwhile', () => {
    const html = render({ active: 'ai', mounted: ['ai'] }, {}, { expanded: true, citationExpanded: true, citation: { open: true } });
    expect(html).toMatch(/<div class="cov is-open"[ >]/);
    expect(html).toContain('<div class="cov-viewer"></div>');
    expect(html).toMatch(/class="side-panel-expand on"[^>]*disabled=""/);
  });

  // Amendment 2: AI's actions sit in the tab bar, in a slot shown only while AI is active.
  it('the tab bar holds a slot for AI\'s actions, shown only on AI, and AI is handed it', () => {
    expect(render({ active: 'ai', mounted: ['desk', 'ai'] })).toMatch(/<div class="side-panel-tab-actions"><\/div>/);
    expect(render({ active: 'desk', mounted: ['desk', 'ai'] })).toMatch(/<div class="side-panel-tab-actions" hidden="">/);
    expect(render({ active: 'ai', mounted: ['ai'] })).toContain('data-actions-slot="null"'); // the node arrives after mount
  });

  it('each tab keeps its full name as its accessible label, with a short form for a narrow bar', () => {
    const html = render({ active: 'ai', mounted: ['ai'] });
    expect(html).toMatch(/id="side-panel-tab-ai"[^>]*aria-label="AI research"/);
    expect(html).toContain('<span class="tab-long">AI research</span><span class="tab-short" aria-hidden="true">AI</span>');
  });
});

it('dock separator exposes a numeric range and current width', () => {
  const html = render({});
  expect(html).toMatch(/role="separator"[^>]*aria-valuemin="[0-9]+"[^>]*aria-valuemax="[0-9]+"[^>]*aria-valuenow="[0-9]+"/);
});

// panel-drag-ai (F113): a record or file dragged over the panel switches it to AI, from Desk,
// Record or collapsed, and a drop the chat did not take is handed over rather than lost.
describe('dragging onto the panel', () => {
  const RECORD = { types: ['application/x-niyantran-ai', 'text/plain'] };
  const event = (dataTransfer, extra = {}) => ({ dataTransfer, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra });
  const setup = (onAi) => {
    const acts = [];
    const handed = [];
    const props = panelDragProps({ onAi, act: (a) => acts.push(a), handOff: (e) => handed.push(e) });
    return { acts, handed, props };
  };

  it('a record dragged over Desk, Record or the collapsed handle opens AI and accepts the drop', () => {
    const { acts, props } = setup(false);
    const enter = event(RECORD);
    props.onDragEnter(enter);
    const over = event(RECORD);
    props.onDragOver(over);
    expect(acts).toEqual([{ type: 'ai-open' }, { type: 'ai-open' }]);
    expect(enter.defaultPrevented && over.defaultPrevented).toBe(true);
  });

  it('a dragged file does the same', () => {
    const { acts, props } = setup(false);
    props.onDragOver(event({ types: ['Files'] }));
    expect(acts).toEqual([{ type: 'ai-open' }]);
  });

  it('on AI already, it does not dispatch again', () => {
    const { acts, props } = setup(true);
    const over = event(RECORD);
    props.onDragOver(over);
    expect(acts).toEqual([]);
    expect(over.defaultPrevented).toBe(true);
  });

  it('other drags are left alone', () => {
    const { acts, handed, props } = setup(false);
    const text = event({ types: ['text/plain'] });
    props.onDragOver(text);
    props.onDrop(text);
    expect(acts).toEqual([]);
    expect(handed).toEqual([]);
    expect(text.defaultPrevented).toBe(false);
  });

  it('a drop the chat took is not handed over twice; one it did not take is', () => {
    const { handed, props } = setup(true);
    const taken = event(RECORD, { defaultPrevented: true });
    props.onDrop(taken);
    expect(handed).toEqual([]);
    const missed = event(RECORD);
    props.onDrop(missed);
    expect(handed).toEqual([missed]);
    expect(missed.defaultPrevented).toBe(true);
  });
});

// F114: the panel starts collapsed on module pages, so a record picked up anywhere on the page opens
// AI at once, giving a full-size drop target instead of the slim bar.
describe('a drag that starts on the page', () => {
  const RECORD = { types: ['application/x-niyantran-ai', 'text/plain'] };
  const opens = (ctx, dataTransfer = RECORD) => {
    const acts = [];
    dragOpensAi({ ...ctx, act: (a) => acts.push(a) })({ dataTransfer });
    return acts;
  };

  it('opens AI on a module page with the panel collapsed or on Desk or Record', () => {
    expect(opens({ hasRail: true, landing: false, aiActive: false })).toEqual([{ type: 'ai-open' }]);
    expect(opens({ hasRail: true, landing: false, aiActive: false }, { types: ['Files'] })).toEqual([{ type: 'ai-open' }]);
  });

  it('does nothing when AI is already open, on a landing or desk without the panel, or for other drags', () => {
    expect(opens({ hasRail: true, landing: false, aiActive: true })).toEqual([]);
    expect(opens({ hasRail: false, landing: false, aiActive: false })).toEqual([]);
    expect(opens({ hasRail: true, landing: true, aiActive: false })).toEqual([]);
    expect(opens({ hasRail: true, landing: false, aiActive: false }, { types: ['text/plain'] })).toEqual([]);
  });
});

// F135 (owner 2026-10-13): on a rail desk the open Desk or Record view collapses to the slim bar on
// a click outside it or on Escape, as the side-panel plan said; AI and expanded mode keep their rules.
describe('Desk and Record close on a click outside or Escape', () => {
  const el = (keep = false) => ({ isConnected: true, closest: () => (keep ? {} : null) });
  const fakeDoc = (dialogs = []) => {
    const on = {};
    return {
      addEventListener: (type, fn) => { on[type] = fn; },
      removeEventListener: (type) => { delete on[type]; },
      querySelector: () => null,
      querySelectorAll: (sel) => (sel === 'dialog[open]' ? dialogs : []),
      click(target) { on.pointerdown?.({ target, button: 0 }); on.pointerup?.({ target, button: 0 }); on.click?.({ target, button: 0 }); },
      on,
    };
  };
  const zone = (...inside) => ({ contains: (t) => inside.includes(t) });

  it('is armed on a rail desk with Desk or Record open, and not otherwise', () => {
    expect(railDismissible({ hasRail: true, open: true, active: 'record', expanded: false })).toBe(true);
    expect(railDismissible({ hasRail: true, open: true, active: 'desk', expanded: false })).toBe(true);
    expect(railDismissible({ hasRail: true, open: true, active: 'ai', expanded: false })).toBe(false);
    expect(railDismissible({ hasRail: true, open: true, active: 'record', expanded: true })).toBe(false);
    expect(railDismissible({ hasRail: true, open: false, active: 'record', expanded: false })).toBe(false);
    expect(railDismissible({ hasRail: false, open: true, active: 'ai', expanded: false })).toBe(false);
  });

  it('collapses on a completed click outside the panel, and not on one inside it or inside an open dialog', () => {
    const inPanel = el();
    const inDialog = el();
    const doc = fakeDoc([zone(inDialog)]);
    const acts = [];
    const detach = attachRailDismiss(doc, { aside: () => zone(inPanel), act: (a) => acts.push(a) });
    doc.click(inPanel);
    doc.click(inDialog);
    expect(acts).toEqual([]);
    doc.click(el());
    expect(acts).toEqual([{ type: 'collapse' }]);
    detach();
    expect(doc.on.click).toBeUndefined();
  });

  it('keeps the selected row, so a row click after the collapse reopens Record', () => {
    const ctx = { hasRail: true, selected: { id: 1 } };
    const open = { active: 'record', open: true, collapsed: false, mounted: ['record'] };
    const collapsed = panelReducer(open, { type: 'collapse' }, ctx);
    expect(collapsed).toMatchObject({ open: false, collapsed: true, active: 'record' });
    expect(panelReducer(collapsed, { type: 'select' }, { hasRail: true, selected: { id: 2 } })).toMatchObject({ open: true, active: 'record' });
  });

  it('Escape collapses Desk or Record, but not over an open dialog; expanded and AI keep their order', () => {
    const base = { userExpanded: false, citationExpanded: false, aiActive: false, railOpen: true, modalOpen: false };
    expect(escapeAction(base)).toBe('collapse');
    expect(escapeAction({ ...base, modalOpen: true })).toBe(null);
    expect(escapeAction({ ...base, railOpen: false })).toBe(null);
    expect(escapeAction({ ...base, userExpanded: true })).toBe('restore');
    expect(escapeAction({ ...base, railOpen: false, aiActive: true })).toBe('close-ai');
  });
});

// F135: once the panel has collapsed, picking the selected row again reopens its record. The desks
// that deselect on a second click pass `{ toggled: row }`; a clear with no row picked (a feature or
// filter change) still clears.
describe('picking a row while the panel is collapsed', () => {
  const sel = { id: 1 };
  it('reopens Record for the selected row, whether the desk toggles or re-picks it', () => {
    expect(pickIntent({ row: null, toggled: sel, selected: sel, collapsed: true })).toBe('reopen');
    expect(pickIntent({ row: sel, selected: sel, collapsed: true })).toBe('reopen');
  });
  it('sets the selection otherwise', () => {
    expect(pickIntent({ row: null, toggled: sel, selected: sel, collapsed: false })).toBe('set');
    expect(pickIntent({ row: null, selected: sel, collapsed: true })).toBe('set');
    expect(pickIntent({ row: { id: 2 }, selected: sel, collapsed: true })).toBe('set');
    expect(pickIntent({ row: sel, selected: null, collapsed: true })).toBe('set');
  });
});
