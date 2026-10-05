import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GlobalLandingContent } from './GlobalLandingView.jsx';
import { modulesForTier, bucketsFor } from './catalog.js';
const buckets = bucketsFor(modulesForTier('geopolitics'), 'geopolitics');
const render = props => renderToStaticMarkup(<GlobalLandingContent buckets={buckets} summaries={{}} onFeature={() => {}} retry={() => {}} {...props}/>);

describe('Global landing presentation', () => {
  it('keeps all16 existing modules and source-specific identity without reference numbers', () => {
    const html = render({});
    expect((html.match(/class="nl-open"/g) || []).length).toBe(16);
    expect(html).toContain('Upcoming launches');
    expect(html).toContain('Where the desk looks');
    expect(html).toContain('Loading summaries');
    expect(html).not.toContain('Verified Records');
    expect(html).not.toContain('12,000');
  });
  it('dims search nonmatches and makes them inert', () => {
    const html = render({ query: 'nuclear' });
    expect((html.match(/inert=""/g) || []).length).toBe(15);
    expect(html).toContain('1 matching module');
  });
  it('does not turn illustrative or failed summaries into measured totals', () => {
    const html = render({ summaries: {
      'Global Commodities': { count: null, availability: 'unavailable', sourceMode: 'unknown', locations: [] },
      'Open Fronts': { count: 88, availability: 'ready', sourceMode: 'stored', locations: [] },
    } });
    expect(html).toContain('Illustrative · measured data unavailable');
    expect(html).toContain('1/16 measured counts');
    expect(html).toContain('88');
  });
});
