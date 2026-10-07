import { describe, it, expect } from 'vitest';
import { ENTERTAINMENT_FEATURES as F, projectEntertainmentSummary as project } from './entertainmentLandingSummary.js';
const raw = (feature, rows = [], extra = {}) => ({ ok: true, feature, tier: 'entertainment', rows, source: { adapter: 'api' }, ...extra });
describe('Entertainment measured coverage', () => {
  it('preserves unknown failures versus a valid empty source', () => {
    expect(project(raw(F[0], [{ status: 'source_status', title: 'Offline' }]))).toMatchObject({count:null,availability:'error',columns:[],countryDistribution:[]});
    expect(project(raw(F[0]))).toMatchObject({count:0,availability:'empty'});
    for(const source of [{adapter:'embedded',kind:'backup-pack'},{adapter:'news-search'},{adapter:'api',gdelt:true},{adapter:'unknown'}]) expect(project(raw(F[0],[{title:'Row'}],{source})).count).toBeNull();
  });
  it('rejects API headlines masquerading as structured records', () => {
    for(const feature of [F[0],F[1],F[4],F[5],F[6],F[7]]) expect(project(raw(feature,[{title:'Headline',date:'2026-10-08'}]))).toMatchObject({count:null,availability:'error',columns:[]});
  });
  it.each(F)('exposes compact populated fields and correct identity for %s', feature => {
    const fixtures = [{show:'Show',country:'IN',network:'Network',time:'20:00'}, {film:'Film',release_date:'2025-01-01',box_office:'—'}, {title:'Headline',outlet:'Variety',date:'2026-10-01'}, {title:'Film report',outlet:'NDTV',date:'2026-10-01'}, {track:'Song',rank:1,artist:'Artist'}, {track:'Song',rank:1,artist:'Artist'}, {service:'Studio',kind:'Studio',owner:'Owner'}, {person:'Actor',followers:'10,000'}];
    const summary=project(raw(feature,[fixtures[F.indexOf(feature)]]));
    expect(summary).toMatchObject({count:1,feature,resourceKey:feature,version:1});
    expect(summary.columns.length).toBeGreaterThan(0);expect(summary).not.toHaveProperty('rows');
    expect(summary).not.toHaveProperty('grossTotal');expect(summary).not.toHaveProperty('influenceScore');
  });
  it('song release dates never become chart observation periods or update dates', () => {
    for(const feature of F.slice(4,6)) expect(project(raw(feature,[{track:'Song',date:'1999-01-01'}]))).toMatchObject({observationPeriod:null,period:null,asOf:null});
    expect(project(raw(F[5],[])).limitations).toMatch(/United States.*not global/i);
  });
  it('counts TV listings by country rather than using gross or followers', () => {
    const rows=Array.from({length:14},(_,i)=>({show:'Show',country:`Country ${i}`,box_office:999999}));rows.push({show:'Show',country:'Country 0'},{show:'Show',country:'—'});
    const summary=project(raw(F[0],rows));expect(summary.countryDistribution).toHaveLength(12);
    expect(summary.countryDistribution.reduce((sum,r)=>sum+r.count,0)+summary.countryUnreported).toBe(16);
    expect(summary.countryDistribution.find(r=>r.label==='Country 0').count).toBe(2);
    expect(project(raw(F[1],rows)).countryDistribution).toEqual([]);
  });
  it('preserves safe fallback context and only reports source metadata as update dates', () => {
    const summary=project(raw(F[5],[{track:'Song',date:'2000-01-01',source_url:'javascript:bad'}],{source:{adapter:'api',note:'Apple Music empty; iTunes Top Songs.',links:['https://itunes.apple.com/']},meta:{as_of:'2026-10-08'}}));
    expect(summary).toMatchObject({asOf:'2026-10-08',sources:[{name:'itunes.apple.com',url:'https://itunes.apple.com/'}]});expect(summary.limitations).toContain('iTunes Top Songs');
  });
});
