import { describe, it, expect } from 'vitest';
import { SPORTS_FEATURES as F, projectSportsSummary } from './sportsLandingSummary.js';
import { sportsDbRows, espnScoreboardRows, rssWireRows, wikidataLeagueRows, wikidataAthleteRows } from './sportsPack.js';
const raw = (feature, rows = [], extra = {}) => ({ ok: true, tier: 'sports', feature, rows, source: { adapter: 'api' }, ...extra });
describe('Sports source summaries', () => {
  it('distinguishes unavailable governance, provider status, valid empty and errors', () => {
    const status = [{ status: 'source_status', title: 'Offline', date: '2026-10-08' }];
    expect(projectSportsSummary(raw(F[5], status))).toMatchObject({ ok: true, count: null, availability: 'unavailable', columns: [] });
    expect(projectSportsSummary(raw(F[0], status))).toMatchObject({ ok: false, count: null, availability: 'error', observationPeriod: null });
    expect(projectSportsSummary(raw(F[1]))).toMatchObject({ count: 0, availability: 'empty' });
    expect(projectSportsSummary(raw(F[1], [], { ok: false })).count).toBeNull();
  });
  it('projects source fixtures for all implemented modules without invented rankings or rights', () => {
    const wires = rssWireRows([{ title: 'Sport report', date: '2026-10-07', link: 'https://example.org/report' }], 'Outlet');
    for(const feature of [F[0],F[2],F[4]]) expect(projectSportsSummary(raw(feature,wires))).toMatchObject({ count: 1, unit: 'articles' });
    const events = sportsDbRows({ events: [{ strEvent: 'Home vs Away', strLeague: 'Premier League', strHomeTeam: 'Home', strAwayTeam: 'Away', dateEvent: '2027-01-01', idEvent: '1' }] });
    expect(projectSportsSummary(raw(F[1],events))).toMatchObject({ count: 1, unit: 'events', leagueDistribution: [{label:'Premier League',count:1}], period:'2027-01-01',asOf:null });
    expect(projectSportsSummary(raw(F[3],espnScoreboardRows({ events:[{name:'ISL fixture',date:'2026-11-01'}] },'ISL'))).unit).toBe('events');
    const businesses=wikidataLeagueRows({results:{bindings:[{leagueLabel:{value:'Indian league'},ownerLabel:{value:'Owner'}}]}});
    const business=projectSportsSummary(raw(F[6],businesses)); expect(business.count).toBe(1);expect(business.columns.some(c=>/rights|valuation/i.test(c.key))).toBe(false);
    const athletes=wikidataAthleteRows({results:{bindings:[{personLabel:{value:'Athlete'},sportLabel:{value:'Chess'}}]}});
    expect(projectSportsSummary(raw(F[7],athletes))).toMatchObject({count:1,unit:'identities'});
    expect(projectSportsSummary(raw(F[7],athletes)).columns.some(c=>/ranking|medals/i.test(c.key))).toBe(false);
  });
  it('rejects backups, GDELT, unknown adapters and headlines pretending to be fixtures', () => {
    for(const source of [{adapter:'news-search'},{adapter:'embedded',kind:'backup-pack'},{adapter:'unknown'},{adapter:'api',gdelt:true}]) expect(projectSportsSummary(raw(F[1],[{title:'Fixture',home:'Home',away:'Away',league:'NBA'}],{source}))).toMatchObject({count:null,availability:'error',columns:[],leagueDistribution:[]});
    expect(projectSportsSummary(raw(F[1],[{title:'Headline',date:'2026-10-01'}])).count).toBeNull();
    for(const feature of [F[6],F[7]]) expect(projectSportsSummary(raw(feature,[{title:'Headline',date:'2026-10-01'}])).count).toBeNull();
  });
  it('caps measured league counts and reports missing or undisplayed labels', () => {
    const events=Array.from({length:14},(_,i)=>({title:'Fixture',home:'Home',away:'Away',league:`League ${String(i).padStart(2,'0')}`}));events.push({title:'Fixture',home:'Home',away:'Away'});
    const summary=projectSportsSummary(raw(F[1],events));expect(summary.leagueDistribution).toHaveLength(12);expect(summary.leagueUnreported).toBe(3);
    expect(summary.leagueDistribution.reduce((sum,item)=>sum+item.count,0)+summary.leagueUnreported).toBe(summary.count);
  });
  it('preserves safe metadata and fallback notes without deriving update dates from events', () => {
    const summary=projectSportsSummary(raw(F[3],[{title:'Fixture',home:'A',away:'B',date:'2027-01-01'}],{meta:{as_of:'2026-10-08'},source:{adapter:'api',note:'ESPN empty; TheSportsDB ISL.',links:['https://www.thesportsdb.com/','javascript:bad']}}));
    expect(summary).toMatchObject({asOf:'2026-10-08',observationPeriod:{from:'2027-01-01',through:'2027-01-01'},sourceNote:'ESPN empty; TheSportsDB ISL.',sources:[{name:'thesportsdb.com',url:'https://www.thesportsdb.com/'}]});
    expect(summary).not.toHaveProperty('rows');expect(summary.resourceKey).toBe(F[3]);
    expect(summary.limitations).toContain('ESPN empty; TheSportsDB ISL.');
    expect(projectSportsSummary(raw(F[5],[],{source:{adapter:'internal'}})).limitations).not.toContain('returned source');
    expect(()=>projectSportsSummary(raw('unknown'))).toThrow('Unknown');
  });
});
