import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EconomicsLandingContent } from './EconomicsLandingView.jsx';
import { ECONOMICS_FEATURES } from '../lib/economicsLandingSummary.js';
const render = props => renderToStaticMarkup(<EconomicsLandingContent summaries={{}} onFeature={() => {}} {...props}/>);
describe('Economics v6 adapter', () => {
  it('renders four exact reference sectors without mock totals or an old rail', () => {
    const html=render({});
    expect(html).toContain('data-desk="economics"');expect(html).toContain('Follow the economy.');
    expect(html).toContain('11 modules');expect((html.match(/class="sector-card"/g)||[]).length).toBe(4);
    for(const name of ['nse-bse','macro-indicators.png','trade.jpg','industry-machinery.png']) expect(html).toContain(`data-image="${name}"`);
    expect(html).toContain('Loading summaries');expect(html).not.toContain('Verified Records');
    expect(html).not.toContain('data-v6-count="500"');
  });
  it('counts prepared heterogeneous entries and highlights quote counts without summing values', () => {
    const html=render({summaries:{
      [ECONOMICS_FEATURES[0]]:{count:2,availability:'ready',sourceMode:'stored',resourceKey:ECONOMICS_FEATURES[0],exchangeDistribution:[{label:'NSE',count:2}],exchangeUnreported:0},
      'Prediction Market Political Odds':{count:31,availability:'ready',sourceMode:'stored',resourceKey:'Prediction Market Political Odds'},
      'Election Forecast Aggregator':{count:null,availability:'unavailable',sourceMode:'unknown'},
    }});
    expect(html).toContain('data-v6-count="33"');expect(html).toContain('2/11 measured counts');
    expect(html).toContain('NSE: 2 quotes');expect(html).toContain('Quotes by exchange');
    expect(html).not.toContain('data-v6-count="533"');
  });
  it('keeps pending counts unknown and shows the Hindi desk identity', () => {
    const html=render({lang:'hi'});expect(html).toContain('अर्थव्यवस्था');expect(html).not.toContain('data-v6-count="0"');
  });
});
