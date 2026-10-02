import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../ai/AiPanel.jsx', () => ({ default: (p) => <div data-ai-panel={p.open ? 'open' : 'hidden'} data-embedded={String(p.embedded)} data-actions-slot={String(p.actionsSlot)} /> }));
vi.mock('./RailContent.jsx', () => ({ default: (p) => <div data-rail={p.view} />, railClasses: () => 'right-rail' }));
import SidePanel from './SidePanel.jsx';

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
