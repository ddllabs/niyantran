import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NationalLandingContent } from './NationalLandingView.jsx';
import { modulesForTier, bucketsFor } from './catalog.js';
import { NATIONAL_FEATURES } from '../lib/nationalLandingSummary.js';
const buckets = bucketsFor(modulesForTier('national'), 'national');
describe('National landing presentation', () => {
  it('labels the known stored question sample without presenting it as complete coverage', () => {
    const feature = NATIONAL_FEATURES[2];
    const summaries = { [feature]: { feature, resourceKey: feature, count: 8000, availability: 'ready', sourceMode: 'stored', columns: [], sources: [], sectors: [] } };
    const html = renderToStaticMarkup(<NationalLandingContent buckets={buckets} summaries={summaries} onFeature={() => {}} retry={() => {}} />);
    expect(html).toContain('Stored · Sampled questions');
    expect(html).toContain('8,000');
    const unavailable = renderToStaticMarkup(<NationalLandingContent buckets={buckets} summaries={{ [feature]: { ...summaries[feature], count: null, availability: 'error' } }} onFeature={() => {}} retry={() => {}} />);
    expect(unavailable).not.toContain('Stored · Sampled questions');
  });
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
