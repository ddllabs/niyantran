import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CarbonLandingContent } from './CarbonLandingView.jsx';
const render = props => renderToStaticMarkup(<CarbonLandingContent summaries={{}} onFeature={() => {}} {...props}/>);
describe('Carbon v6 coverage', () => {
  it('keeps seven modules and exact four reference images without mock totals', () => {
    const html = render({});
    expect(html).toContain('data-desk="carbon"');
    expect(html).toContain('7 modules');
    expect((html.match(/class="sector-card"/g)||[]).length).toBe(4);
    for (const image of ['resources.jpg','trade.jpg','steel-web.jpg','earth.jpg']) expect(html).toContain(`data-image="${image}"`);
    expect(html).toContain('Loading summaries');
    expect(html).not.toContain('data-v6-count="52"');
  });
  it('charts jurisdiction record counts rather than prices, and excludes failed source totals', () => {
    const html = render({ summaries: {
      'Global Carbon Pricing Tracker': {count:2,availability:'ready',sourceMode:'stored',resourceKey:'Global Carbon Pricing Tracker',jurisdictionDistribution:[{label:'Sweden',count:1},{label:'Norway',count:1}],jurisdictionUnreported:0},
      'Climate Newswire': {count:5,availability:'ready',sourceMode:'feed-backed',resourceKey:'Climate Newswire'},
      'Carbon Registry Wire': {count:null,availability:'error',sourceMode:'feed-backed'},
    }});
    expect(html).toContain('data-v6-count="7"');
    expect(html).toContain('2/7 measured counts');
    expect(html).toContain('Sweden: 1 jurisdictions');
    expect(html).toContain('Jurisdiction records');
    expect(html).toContain('units vary by module');
    expect(html).not.toContain('data-v6-count="500"');
  });
  it('preserves unknown values and Hindi identity', () => {
    const html=render({lang:'hi'});
    expect(html).toContain('कार्बन');
    expect(html).not.toContain('data-v6-count="0"');
  });
});
