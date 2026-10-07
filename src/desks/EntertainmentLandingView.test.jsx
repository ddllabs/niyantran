import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EntertainmentLandingContent } from './EntertainmentLandingView.jsx';
const render=props=>renderToStaticMarkup(<EntertainmentLandingContent onFeature={()=>{}} {...props}/>);
describe('Entertainment measured landing',()=>{
 it('shows eight modules and four exact reference images without invented counts',()=>{
  const html=render({});expect(html).toContain('8 modules');expect((html.match(/class="sector-card"/g)||[]).length).toBe(4);
  for(const image of ['entertainment-hero.png','press-cameras.jpg','music-hero.png'])expect(html).toContain(`data-image="${image}"`);
  expect(html).not.toContain('data-v6-count="0"');expect(html).toContain('India and US most-played');
 });
 it('counts schedule records by country and combined entries without monetary aggregation',()=>{
  const html=render({summaries:{'TV & Streaming Tonight':{count:3,resourceKey:'TV & Streaming Tonight',sourceMode:'feed-backed',availability:'ready',countryDistribution:[{label:'IN',count:1},{label:'US',count:2}],countryUnreported:1},'Box Office Tracker':{count:2,resourceKey:'Box Office Tracker',sourceMode:'feed-backed',availability:'ready'}}});
  expect(html).toContain('IN: 1 listings');expect(html).toContain('US: 2 listings');expect(html).toContain('data-v6-count="5"');expect(html).toContain('units vary by module');
 });
 it('supports Hindi identity',()=>expect(render({lang:'hi'})).toContain('मनोरंजन'));
});
