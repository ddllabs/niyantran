import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NationalLandingContent } from './NationalLandingView.jsx';
import { NATIONAL_FEATURES } from '../lib/nationalLandingSummary.js';

describe('National v6 adapter', () => {
  it('exposes all17 canonical modules without invented totals or dates', () => {
    const html = renderToStaticMarkup(<NationalLandingContent summaries={{}} onFeature={() => {}} retry={() => {}}/>);
    expect(html).toContain('17 modules');
    expect(html).toContain('Loading summaries');
    expect(html).toContain('Policy Pipeline Tracker');
    expect(html).toContain('national');
    expect(html).not.toContain('9,819');
    expect(html).not.toContain('8,000');
    expect(html).not.toContain('1952–present');
  });
  it('labels the stored question sample and counts shared bills only once', () => {
    const feature = NATIONAL_FEATURES[2];
    const summaries = {
      [NATIONAL_FEATURES[0]]: { feature: NATIONAL_FEATURES[0],resourceKey:NATIONAL_FEATURES[0],count:9,availability:'ready',sourceMode:'stored',sectors:[] },
      [NATIONAL_FEATURES[1]]: { feature: NATIONAL_FEATURES[1],resourceKey:NATIONAL_FEATURES[0],count:9,availability:'ready',sourceMode:'stored',sectors:[] },
      [feature]: { feature,resourceKey:feature,count:8,availability:'ready',sourceMode:'stored',sectors:[] },
    };
    const html = renderToStaticMarkup(<NationalLandingContent summaries={summaries} onFeature={() => {}}/>);
    expect(html).toContain('Stored · Sampled questions');
    expect(html).toContain('data-v6-count="17"');
    expect(html).not.toContain('data-v6-count="26"');
  });
  it('shows Hindi desk identity and keeps unavailable totals unknown', () => {
    const html = renderToStaticMarkup(<NationalLandingContent lang="hi" summaries={{ [NATIONAL_FEATURES[0]]: { count:null,availability:'error',sourceMode:'unknown' } }} onFeature={() => {}}/>);
    expect(html).toContain('राष्ट्रीय');
    expect(html).toContain('Summary unavailable');
    expect(html).not.toContain('data-v6-count="0"');
  });
});
