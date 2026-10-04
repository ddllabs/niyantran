import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NationalLandingContent } from './NationalLandingView.jsx';
import { modulesForTier, bucketsFor } from './catalog.js';
const buckets = bucketsFor(modulesForTier('national'), 'national');
describe('National landing presentation', () => {
  it('offers exactly the existing modules without inventing counts or freshness', () => {
    const html = renderToStaticMarkup(<NationalLandingContent buckets={buckets} summaries={{}} onFeature={() => {}} retry={() => {}} />);
    expect((html.match(/class="nl-open"/g) || []).length).toBe(12);
    expect(html).toContain('Bills by sector');
    expect(html).toContain('Loading summaries');
    expect(html).not.toContain('Verified Records');
    expect(html).not.toContain('Delimitation');
  });
  it('dims nonmatches in place while removing them from accessible navigation', () => {
    const html = renderToStaticMarkup(<NationalLandingContent buckets={buckets} summaries={{}} onFeature={() => {}} retry={() => {}} query="affidavit" />);
    expect((html.match(/class="nl-open"/g) || []).length).toBe(12);
    expect((html.match(/inert=""/g) || []).length).toBe(11);
    expect(html).toContain('Candidate Affidavit');
    expect(html).toContain('aria-hidden="true"');
  });
});
