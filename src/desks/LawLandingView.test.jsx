import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LawLandingContent } from './LawLandingView.jsx';
import { modulesForTier, bucketsFor } from './catalog.js';
const buckets = bucketsFor(modulesForTier('judiciary'), 'judiciary');
const render = props => renderToStaticMarkup(<LawLandingContent buckets={buckets} summaries={{}} onFeature={() => {}} retry={() => {}} {...props}/>);
describe('Law v6 adapter', () => {
  it('uses four reference photo sectors without mock counts or the old rail', () => {
    const html = render({});
    expect(html).toContain('data-desk="law"');
    expect(html).toContain('Every record matters.');
    expect(html).toContain('See the bigger picture.');
    expect((html.match(/class="sector-card"/g) || []).length).toBe(4);
    for (const image of ['supreme-front-web', 'judicial-books', 'elections', 'insolvency']) expect(html).toContain(`data-image="${image}"`);
    expect(html).toContain('12 modules');
    expect(html).toContain('Loading summaries');
    expect(html).not.toContain('Verified Records');
    expect(html).not.toContain('class="nl-open"');
  });
  it('deduplicates shared Supreme Court entries while counting reports as reports', () => {
    const summary = { count: 220, availability: 'ready', sourceMode: 'stored', resourceKey: 'judiciary-sc-orders', unit: 'entries' };
    const html = render({ summaries: {
      'Supreme Court Order & Judgment Feed': summary,
      'Order Archive by Topic (Cross-Court)': summary,
      'ICC Proceedings': { count: 10, availability: 'ready', sourceMode: 'feed-backed', unit: 'reports', resourceKey: 'ICC Proceedings' },
      'District Court Case Tracker': { count: 0, availability: 'empty', sourceMode: 'feed-backed', unit: 'reports', resourceKey: 'District Court Case Tracker' },
      'UP High Court (Allahabad) Order Feed': { count: null, availability: 'error', sourceMode: 'unknown' },
    } });
    expect(html).toContain('data-v6-count="230"');
    expect(html).toContain('4/12 measured counts');
    expect(html).toContain('shared orders counted once');
    expect(html).toContain('Entries and reports; overlapping coverage');
    expect(html).toContain('Supreme Court orders by topic');
    expect(html).toContain('Allahabad High Court reporting');
    expect(html).toContain('Summary unavailable');
    expect(html).not.toContain('data-v6-count="450"');
  });
  it('shows Hindi identity while pending source counts remain unknown', () => {
    const html = render({ lang: 'hi' });
    expect(html).toContain('विधि');
    expect(html).not.toContain('data-v6-count="0"');
  });
});
