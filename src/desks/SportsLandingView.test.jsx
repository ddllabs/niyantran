import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SportsLandingContent} from './SportsLandingView.jsx';
const render=props=>renderToStaticMarkup(<SportsLandingContent summaries={{}} onFeature={()=>{}} {...props}/>);
describe('Sports v6 coverage',()=>{
  it('keeps eight modules and four exact reference images without mock totals',()=>{
    const html=render({});expect(html).toContain('data-desk="sports"');expect(html).toContain('8 modules');expect((html.match(/class="sector-card"/g)||[])).toHaveLength(4);
    for(const image of ['sports-hero.png','football-hero.png','press-cameras.jpg','sports-industry.png']) expect(html).toContain(`data-image="${image}"`);
    expect(html).toContain('Loading summaries');expect(html).not.toContain('data-v6-count="0"');
  });
  it('charts measured fixture league counts, excludes unavailable and error totals',()=>{
    const html=render({summaries:{
      'Fixtures & Results — World Leagues':{count:2,availability:'ready',sourceMode:'feed-backed',resourceKey:'Fixtures & Results — World Leagues',leagueDistribution:[{label:'NBA',count:2}],leagueUnreported:0},
      'Cricket Wire':{count:5,availability:'ready',sourceMode:'feed-backed',resourceKey:'Cricket Wire'},
      'Sports Governance & Policy':{count:null,availability:'unavailable',sourceMode:'unknown'},
      'Athlete Index':{count:null,availability:'error',sourceMode:'feed-backed'},
    }});
    expect(html).toContain('data-v6-count="7"');expect(html).toContain('2/8 measured counts');expect(html).toContain('NBA: 2 events');expect(html).toContain('units vary by module');
  });
  it('preserves unknown counts and Hindi identity',()=>{const html=render({lang:'hi'});expect(html).toContain('खेल');expect(html).not.toContain('data-v6-count="0"');});
});
