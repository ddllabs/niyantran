import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DeskLandingFrame, { ModuleDetail, ModuleExplorer, DataBreakdown, groupsWithSources } from './DeskLandingFrame.jsx';
import { deskHash, parseDeskHash } from '../../lib/deskRoute.js';
import { NATIONAL_PRESENTATION } from './deskPresentation.js';
import { DESK_CATALOGUE } from './deskCatalogue.js';
import { GLOBAL_PRESENTATION } from './globalPresentation.js';
import { LAW_PRESENTATION } from './lawPresentation.js';
import { CARBON_PRESENTATION } from './carbonPresentation.js';
import { SPORTS_PRESENTATION } from './sportsPresentation.js';
import { ENTERTAINMENT_PRESENTATION } from './entertainmentPresentation.js';
import { STATE_PRESENTATION } from './statePresentation.js';
import { ECONOMICS_PRESENTATION } from './economicsPresentation.js';

const bill = NATIONAL_PRESENTATION.groups[0].modules[0];
describe('v6 desk presentation', () => {
  it('exposes a polite atomic source-filter announcement', () => {
    const html = renderToStaticMarkup(<DeskLandingFrame presentation={NATIONAL_PRESENTATION} onFeature={() => {}} />);
    expect(html).toContain('aria-live="polite" aria-atomic="true"');
  });
  it('shows canonical module discovery without inventing a record snapshot', () => {
    const html = renderToStaticMarkup(<DeskLandingFrame presentation={NATIONAL_PRESENTATION} summaries={{}} onFeature={() => {}} />);
    expect(html).toContain('Loading summaries');
    expect(html).toContain('17 modules');
    expect(html).not.toContain('9,819');
    expect(html).not.toContain('8,000');
    expect(html).toContain('government-scene');
  });
  it('sizes the desktop grid to the visible sectors, capped at five', () => {
    const presentation = { ...NATIONAL_PRESENTATION, groups: NATIONAL_PRESENTATION.groups.slice(0, 4) };
    const html = renderToStaticMarkup(<DeskLandingFrame presentation={presentation} onFeature={() => {}}/>);
    expect(html).toContain('--sector-columns:4');
    expect(renderToStaticMarkup(<DeskLandingFrame presentation={NATIONAL_PRESENTATION} onFeature={() => {}}/>)).toContain('--sector-columns:5');
  });
  it('exposes each exact canonical terminal destination as a hyperlink', () => {
    for (const module of NATIONAL_PRESENTATION.groups.flatMap(group => group.modules)) {
      const html = renderToStaticMarkup(<ModuleDetail module={module} tab="national" onOpen={() => {}} />);
      const target = "/" + deskHash('national', module.feature);
      expect(html).toContain(`href="${target}"`);
      expect(parseDeskHash(target.slice(1))).toEqual({ tab: 'national', feature: module.feature });
    }
  });
  it('names the shared Supreme Court source without exposing an internal resource key', () => {
    const module = {tier:'judiciary',feature:'Order Archive by Topic (Cross-Court)',title:'Supreme Court orders by topic'};
    const html = renderToStaticMarkup(<ModuleDetail tab="law" module={module} summary={{count:220,resourceKey:'judiciary-sc-orders'}} onOpen={()=>{}}/>);
    expect(html).toContain('shared Supreme Court order register');
    expect(html).not.toContain('judiciary-sc-orders');
  });
  it('filters by established coverage rather than configuration', () => {
    const presentation = { groups: [{ id: 'a', modules: [{ feature: 'missing', configured: true }] }, { id: 'b', modules: [{ feature: 'stored' }] }] };
    expect(groupsWithSources(presentation.groups, { stored: { sourceMode: 'stored', sources: [] } }).map(g => g.id)).toEqual(['b']);
    expect(groupsWithSources(presentation.groups, { stored: { sourceMode: 'stored', availability: 'error', sources: [] } })).toEqual([]);
  });
  it('keeps zero distinct from unknown and rejects unsafe source links', () => {
    const zero = renderToStaticMarkup(<ModuleDetail module={bill} summary={{ count: 0, availability: 'empty', sourceMode: 'stored', columns: [], sources: [{ name: 'Unsafe', url: 'javascript:alert(1)' }], limitations: 'Coverage limitation' }} onOpen={() => {}} />);
    expect(zero).toContain('<b>0</b>');
    expect(zero).toContain('No populated fields');
    expect(zero).toContain('Coverage limitation');
    expect(zero).not.toContain('javascript:');
    const unknown = renderToStaticMarkup(<ModuleDetail module={bill} onOpen={() => {}} />);
    expect(unknown).toContain('<b>—</b>');
    expect(unknown).toContain('Source date unavailable');
  });
  it('renders only supplied classification/stage values, preserving unclassified records', () => {
    const html = renderToStaticMarkup(<DataBreakdown title="Bills by sector" items={[{ label: 'Not classified', count: 3 }]} stages={[{ label: 'Pending', count: 2 }]} />);
    expect(html).toContain('Not classified');
    expect(html).toContain('Pending');
    expect(html).toContain('2');
    expect(html).not.toContain('4120');
    expect(html).not.toContain('Sponsoring ministr');
  });
  it('uses an optional measured chart without mixing economic values or desk totals', () => {
    const html = renderToStaticMarkup(<DeskLandingFrame presentation={ECONOMICS_PRESENTATION} summaries={{}} onFeature={() => {}} dataHighlight={{title:'Quotes by exchange', count:2, items:[{label:'NSE',count:2}], unit:'quotes', description:'Counts of reported exchange labels; prices are not summed.'}}/>);
    expect(html).toContain('aria-label="Quotes by exchange"');
    expect(html).toContain('NSE: 2 quotes');
    expect(html).toContain('data-v6-count="2"');
    expect(html).not.toContain('bills on record');
  });

});


describe('restored V6 sector explorer', () => {
  const presentations = [NATIONAL_PRESENTATION, GLOBAL_PRESENTATION, LAW_PRESENTATION, ECONOMICS_PRESENTATION, CARBON_PRESENTATION, SPORTS_PRESENTATION, ENTERTAINMENT_PRESENTATION, STATE_PRESENTATION];
  it('shows the original explorer and first sector without expanding a disclosure', () => {
    for (const presentation of presentations) {
      const html = renderToStaticMarkup(<DeskLandingFrame presentation={presentation} onFeature={() => {}} />);
      expect(html, presentation.id).toContain('class="explorer');
      expect(html).toContain('INSIDE THIS SECTOR');
      expect(html).toContain('class="explorer-heading"');
      expect(html).toContain('class="module-icon"');
      expect(html).toContain('class="module-copy"');
      expect(html).toContain('aria-label="Modules in the selected sector"');
      expect(html).toContain('Select a sector');
      expect((html.match(/<option /g) || []).length).toBe(presentation.groups.length);
      expect((html.match(/class="module-item"/g) || []).length).toBe(presentation.groups[0].modules.length);
      expect(html).not.toContain('module-discovery');
    }
  });
  it('renders every exact module destination in its original sector card layout', () => {
    let links = 0;
    for (const presentation of presentations) for (const group of presentation.groups) {
      const html = renderToStaticMarkup(<ModuleExplorer presentation={presentation} group={group} summaries={{}} onFeature={() => {}} onSector={() => {}} id="fixture" />);
      const expected = DESK_CATALOGUE.filter(module => module.tab === presentation.id && group.modules.some(item => item.feature === module.feature));
      expect((html.match(/class="module-item"/g) || []).length).toBe(expected.length);
      for (const module of expected) expect(html).toContain(`href="/${deskHash(module.tab, module.feature).replaceAll("'", "&#x27;")}"`);
      expect(html).not.toContain('Open in Terminal');
      links += expected.length;
    }
    expect(links).toBe(120);
  });
  it('retains source counts and distinguishes zero from missing summary values', () => {
    const group = NATIONAL_PRESENTATION.groups[0];
    const html = renderToStaticMarkup(<ModuleExplorer presentation={NATIONAL_PRESENTATION} group={group} summaries={{[group.modules[0].feature]:{count:0, unit:'records', sourceMode:'stored'}}} onSector={() => {}} onFeature={() => {}} id="fixture" />);
    expect(html).toContain('0 records');
    expect(html).toContain('— records');
    expect(html).toContain('5 modules · 1 with sources');
  });
});

// Owner, 2026-10-13: choosing a sector must be noticeable. When the module list is off screen (a
// phone, a short window) it is scrolled into view; keyboard selection also moves focus to it.
describe('revealing the chosen sector\'s modules', () => {
  const list = (top, height = 300) => {
    const explorer = { getBoundingClientRect: () => ({ top, height }), scrollIntoView: vi.fn() };
    return { explorer, el: { closest: () => explorer, focus: vi.fn() } };
  };

  it('scrolls the module list into view when it starts below the fold', async () => {
    const { revealModules } = await import('./DeskLandingFrame.jsx');
    const { explorer, el } = list(900);
    expect(revealModules(el, { viewportHeight: 800 })).toBe(true);
    expect(explorer.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(el.focus).not.toHaveBeenCalled();
  });

  it('leaves a list that is already in view where it is, and jumps without animation when motion is off', async () => {
    const { revealModules } = await import('./DeskLandingFrame.jsx');
    const shown = list(400);
    expect(revealModules(shown.el, { viewportHeight: 800 })).toBe(false);
    expect(shown.explorer.scrollIntoView).not.toHaveBeenCalled();
    const below = list(1200);
    revealModules(below.el, { viewportHeight: 800, instant: true });
    expect(below.explorer.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('treats a list hidden above the scrolling area (under the header) as off screen', async () => {
    const { revealModules } = await import('./DeskLandingFrame.jsx');
    const { explorer, el } = list(120);
    expect(revealModules(el, { viewportTop: 193, viewportHeight: 567 })).toBe(true);
    expect(explorer.scrollIntoView).toHaveBeenCalled();
  });

  it('moves focus to the module list after a keyboard selection, without a second scroll', async () => {
    const { revealModules } = await import('./DeskLandingFrame.jsx');
    const { el } = list(400);
    revealModules(el, { viewportHeight: 800, keyboard: true });
    expect(el.focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
