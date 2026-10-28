import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../lib/supabaseClient.js', () => ({ supabase: null }));
import { refreshCoverage, resetCoverageCache } from '../lib/corpusCoverage.js';
import { deskRowKey, recordDocumentKey } from '../lib/deskRows.js';
import MpCardsDesk from './MpCardsDesk.jsx';
import ProjectsDesk from './ProjectsDesk.jsx';
import IndustryDesk from './IndustryDesk.jsx';
import ManifestosDesk from './ManifestosDesk.jsx';
import RailContent from '../shell/RailContent.jsx';
import RecordFocus from '../shell/RecordFocus.jsx';
import AttachmentTray from '../ai/AttachmentTray.jsx';
import { INDUSTRY_V1 } from '../data/nationalCurated.js';
const plain = html => {
 expect(html).not.toMatch(/Partial text|Index incomplete|Mapping held|Text lookup failed|Record snapshot|Record unverified/);
 return html;
};
beforeEach(resetCoverageCache);

it('F264 MP listing exposes caller-verified Full text and conservative Record only on neighboring records', async () => {
 const rows=[{id:'m1',mp_name:'Member One'},{id:'m2',mp_name:'Member Two'}];
 const feed={tier:'national',feature:'MP Report Cards',rows};
 const key=recordDocumentKey(feed.tier,feed.feature,deskRowKey(rows[0]));
 await refreshCoverage([key],{rpc:async()=>({data:[{document_key:key,document_id:'ready',coverage:'full'}],error:null})});
 const html=plain(renderToStaticMarkup(<MpCardsDesk feed={feed}/>));
 expect(html).toContain('>Full text<'); expect(html).toContain('>Record only<');
 expect(html.match(/class="corpus-capability/g)).toHaveLength(2);
});

it.each([
 ['national','Bill Passage Probability Index'],['national','Parliamentary Question Database'],
 ['law','Supreme Court Order & Judgment Feed'],['global','Unlisted record feature'],['carbon','Unlisted carbon feature'],
])('F264 %s / %s selected record shares fresh public capability across adapter and fallback hosts',async(tier,feature)=>{
 const row={id:'record',title:'Sample record',subject:'Sample question',bill_name:'Sample Bill, 2026',bill_number:'1'};
 const feed={tier,feature,rows:[row],source:{adapter:'stored',note:''},coverage:{},meta:{}};
 const key=recordDocumentKey(tier,feature,deskRowKey(row));
 for(const state of ['full','partial','held']) {
  await refreshCoverage([key],{rpc:async()=>({data:[{document_key:key,document_id:state==='held'?null:'ready',coverage:state}],error:null})});
  const html=plain(renderToStaticMarkup(<RailContent view="record" feed={feed} selected={row} loading={false}/>));
  expect(html).toContain(state==='full'?'>Full text<':'>Record only<');
  if(state!=='full') expect(html).not.toContain('>Full text<');
 }
});

it('F264 exact search record handles a supplied snapshot and excludes absent records and aggregate placeholders',()=>{
 const snapshot=renderToStaticMarkup(<RecordFocus tier="national" feature="Questions" focus={{row:{id:'missing',title:'Supplied fields'}}}/>);
 expect(snapshot).toContain('>Record only<'); expect(snapshot).not.toMatch(/snapshot|unverified|indexed|mapping/i);
 expect(renderToStaticMarkup(<RecordFocus tier="national" feature="Questions" focus={{row:null}}/>)).not.toContain('corpus-capability');
 const feed={tier:'national',feature:'Totals',rows:[],meta:{},coverage:{},source:{}};
 const aggregate=renderToStaticMarkup(<RailContent view="record" feed={feed} selected={{title:'Total',is_aggregate:true}} loading={false}/>);
 expect(aggregate).not.toContain('class="corpus-capability');
});

it('F264 bespoke record rows use the same public capability without changing their business statuses', () => {
 const project=plain(renderToStaticMarkup(<ProjectsDesk/>));
 expect(project).toContain('>Record only<');
 const industry=plain(renderToStaticMarkup(<IndustryDesk feed={{tier:'national',feature:'Industry Updates',rows:[{id:'observation',title:'Electricity access',indicator:'EG.ELC.ACCS.ZS',value:99.6}]}}/>));
 expect(industry).toContain('>Record only<');
 const manifesto=plain(renderToStaticMarkup(<ManifestosDesk/>));
 expect(manifesto).toContain('>Record only<');
});

it('F264 Industry indicator catalogue placeholders never claim record capability; actual feed observations do',()=>{
 const empty={tier:'national',feature:'Industry Updates',rows:[]};
 const catalogue=renderToStaticMarkup(<IndustryDesk feed={empty}/>);
 expect(catalogue).toContain('not wired');
 expect(catalogue).not.toContain('class="corpus-capability');
 const observed=renderToStaticMarkup(<IndustryDesk feed={{...empty,rows:[{id:'live-observation',title:'Electricity access',indicator:'EG.ELC.ACCS.ZS',value:99.6}]}}/>);
 expect(observed.match(/class="corpus-capability/g)).toHaveLength(1);
 expect(observed).toContain('>Record only<');
});

it('F264 selecting or attaching an unsupported Industry placeholder cannot restore a capability badge',()=>{
 const placeholders=INDUSTRY_V1.filter(row=>!row.indicator);
 expect(placeholders).toHaveLength(5);
 for(const row of placeholders) {
  const feed={tier:'national',feature:'Industry Updates',rows:[],meta:{},coverage:{},source:{}};
  const selected=renderToStaticMarkup(<RailContent view="record" feed={feed} selected={{...row,title:row.label}} loading={false}/>);
  expect(selected).not.toContain('class="corpus-capability');
  const attached=renderToStaticMarkup(<AttachmentTray attachments={[{kind:'row',id:row.id,title:row.label,preview:row}]} indexedKeys={new Set()} onRemove={()=>{}}/>);
  expect(attached).not.toContain('class="corpus-capability');
 }
});
