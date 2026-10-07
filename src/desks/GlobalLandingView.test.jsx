import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { modulesForTier, bucketsFor } from './catalog.js';
import { GlobalLandingContent } from './GlobalLandingView.jsx';

const buckets = bucketsFor(modulesForTier('geopolitics'), 'geopolitics');
const render = props => renderToStaticMarkup(<GlobalLandingContent buckets={buckets} summaries={{}} onFeature={() => {}} retry={() => {}} {...props}/>);
describe('Global v6 adapter', () => {
  it('uses the five reference photo sectors and canonical security modules without reference totals', () => {
    const html = render({});
    expect(html).toContain('data-desk="global"');
    expect(html).toContain('A world of signals.');
    expect(html).toContain('One clear perspective.');
    expect(html).toContain('16 modules');
    expect((html.match(/class="sector-card"/g) || []).length).toBe(5);
    for (const image of ['earth', 'elections', 'trade', 'energy-plants', 'global-trade']) expect(html).toContain(`data-image="${image}"`);
    expect(html).toContain('Geopolitics News Wire');
    expect(html).toContain('Loading summaries');
    expect(html).not.toContain('12,000');
    expect(html).not.toContain('Verified Records');
  });
  it('combines supplied counts only and keeps illustrative commodities and failures uncounted', () => {
    const html = render({ summaries: {
      'Global Commodities': { count: null, availability: 'unavailable', sourceMode: 'unknown' },
      'Open Fronts': { count: 88, resourceKey: 'Open Fronts', availability: 'ready', sourceMode: 'stored' },
      'Global Intelligence': { count: 0, resourceKey: 'Global Intelligence', availability: 'empty', sourceMode: 'stored' },
      'Geopolitics News Wire': { count: null, availability: 'error', sourceMode: 'unknown' },
    } });
    expect(html).toContain('data-v6-count="88"');
    expect(html).toContain('2/16 measured counts');
    expect(html).toContain('Mixed entry types; illustrative commodities excluded');
    expect(html).toContain('Summary unavailable');
    expect(html).toContain('Stored register · empty');
  });
  it('shows Hindi desk identity while unknown source-mode counts remain unknown', () => {
    const html = render({ lang: 'hi' });
    expect(html).toContain('वैश्विक');
    expect(html).not.toContain('data-v6-count="0"');
  });
});
