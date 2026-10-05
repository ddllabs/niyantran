import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LawLandingContent } from './LawLandingView.jsx';
import { modulesForTier, bucketsFor } from './catalog.js';
const buckets = bucketsFor(modulesForTier('judiciary'), 'judiciary');
const render = props => renderToStaticMarkup(<LawLandingContent buckets={buckets} summaries={{}} onFeature={() => {}} retry={() => {}} {...props}/>);
describe('Law landing presentation', () => {
  it('retains all12 canonical routes and the reference composition without mock numbers', () => {
    const html = render({});
    expect((html.match(/class="nl-open"/g) || []).length).toBe(12);
    expect(html).toContain('Every order,'); expect(html).toContain('Coverage by tier of the system');
    expect(html).toContain('Loading summaries'); expect(html).not.toContain('Verified Records');
  });
  it('makes nonmatching modules inert', () => {
    const html = render({ query: 'insolvency' });
    expect((html.match(/inert=""/g) || []).length).toBe(11);
    expect(html).toContain('1 matching modules');
  });
  it('exposes reporting units and deduplicates shared source totals', () => {
    const summary = { count: 220, availability: 'ready', sourceMode: 'stored', resourceKey: 'judiciary-sc-orders' };
    const html = render({ summaries: { 'Supreme Court Order & Judgment Feed': summary, 'Order Archive by Topic (Cross-Court)': summary, 'ICC Proceedings': { count: 10, availability: 'ready', sourceMode: 'feed-backed', unit: 'reports', resourceKey: 'ICC Proceedings' } } });
    expect(html).toContain('230'); expect(html).toContain('2/11 resources measured'); expect(html).toContain('<small>reports</small>');
    expect(html).not.toContain('class="v">450</b>');
  });
});
