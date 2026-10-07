import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DeskLandingFrame, { ModuleDetail, DataBreakdown, groupsWithSources } from './DeskLandingFrame.jsx';
import { deskHash, parseDeskHash } from '../../lib/deskRoute.js';
import { NATIONAL_PRESENTATION } from './deskPresentation.js';

const bill = NATIONAL_PRESENTATION.groups[0].modules[0];
describe('v6 desk presentation', () => {
  it('shows canonical module discovery without inventing a record snapshot', () => {
    const html = renderToStaticMarkup(<DeskLandingFrame presentation={NATIONAL_PRESENTATION} summaries={{}} onFeature={() => {}} />);
    expect(html).toContain('Loading summary');
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
});
