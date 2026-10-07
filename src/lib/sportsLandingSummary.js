import { prepareDeskFeed } from './prepareDeskFeed.js';
import { feedColumns } from './columns.js';
import { sportsSlice } from './sportsPack.js';
export const SPORTS_FEATURES = ['Cricket Wire', 'Fixtures & Results — World Leagues', 'Football Wire', 'ISL Tracker', 'Indian Sports Wire', 'Sports Governance & Policy', 'Sports Business & Media Rights', 'Athlete Index'];
const present = value => value != null && !['', '—', 'Not reported', 'unknown'].includes(String(value).trim());
const safeUrl = value => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; } };
const validDate = value => /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(String(value || '')) && Number.isFinite(Date.parse(value)) ? value : null;
const UNITS = {cricket:'articles',football:'articles',india:'articles',fixtures:'events',isl:'events',business:'observations',athletes:'identities',governance:'entries'};
const LIMITATIONS = {
  cricket:'ESPNcricinfo story RSS, not a live score stream or complete match register.',
  football:'BBC Sport football reporting, not a complete fixture or live score stream.',
  india:'Google News RSS covering selected Indian sports; reporting completeness is not established.',
  fixtures:'TheSportsDB next and last events for Premier League, NBA, IPL and La Liga. These configured leagues are not complete global sports coverage.',
  isl:'ISL fixtures from ESPN, with TheSportsDB fallback if ESPN is empty. Event dates are not source-update dates.',
  governance:'No extracted MYAS or National Sports Code table is available in the existing adapter. No governance records are invented.',
  business:'Wikidata Indian league and owner observations. Broadcast rights valuations and sponsorships are not supplied.',
  athletes:'Wikidata Indian athlete identities. Rankings, medals and endorsements are not supplied.',
};
export function projectSportsSummary(raw,retrievedAt=new Date().toISOString()) {
  const feature=raw?.feature;
  if(!SPORTS_FEATURES.includes(feature)) throw new Error('Unknown Sports module');
  const slice=sportsSlice(feature), adapter=raw.source?.adapter || 'unknown';
  const rows=(prepareDeskFeed(raw)?.rows || []).filter(row=>row && row.status!=='source_status');
  const unavailable=slice==='governance';
  const unsupportedSource=adapter!=='api' || raw.source?.kind==='backup-pack' || raw.kind==='backup-pack' || Boolean(raw.gdelt || raw.source?.gdelt);
  const headlinesAsFixtures=['fixtures','isl'].includes(slice) && rows.some(row=>!present(row.home) && !present(row.away) && !present(row.league));
  const headlinesAsDirectory=(slice==='business' && rows.some(row=>!present(row.league))) || (slice==='athletes' && rows.some(row=>!present(row.person)));
  const sourceNote=String(raw.source?.note || '').slice(0,600);
  const failed=raw.ok===false || unsupportedSource || headlinesAsFixtures || headlinesAsDirectory || (!rows.length && raw.rows?.some(row=>row?.status==='source_status'));
  const usable=!unavailable && !failed;
  const columns=usable ? feedColumns(feature,rows).filter(c=>rows.some(row=>present(row[c.key]) || (c.fallback && present(row[c.fallback])))).slice(0,16).map(({key,label})=>({key,label})) : [];
  const links=[...(raw.source?.links || []),...rows.map(row=>row.source_url)].map(safeUrl).filter(Boolean);
  const sources=[...new Map(links.map(url=>[new URL(url).hostname,url])).values()].slice(0,4).map(url=>({name:new URL(url).hostname.replace(/^www\./,''),url}));
  const dates=usable ? rows.map(row=>row.date).filter(validDate).map(String).sort() : [];
  const observationPeriod=dates.length ? {from:dates[0],through:dates.at(-1)} : null;
  const asOf=validDate(raw.meta?.as_of) || validDate(raw.meta?.asOf) || validDate(raw.meta?.lastupdated) || null;
  const leagues=new Map();let leagueUnreported=0;
  if(usable && ['fixtures','isl'].includes(slice)) for(const row of rows) {
    if(present(row.league)) leagues.set(String(row.league),(leagues.get(String(row.league)) || 0)+1);
    else leagueUnreported++;
  }
  const leagueDistribution=[...leagues].sort(([a],[b])=>a.localeCompare(b)).slice(0,12).map(([label,count])=>({label,count}));
  const shown=new Set(leagueDistribution.map(item=>item.label));
  leagueUnreported += [...leagues].filter(([label])=>!shown.has(label)).reduce((sum,[,count])=>sum+count,0);
  return {ok:unavailable || usable,version:1,feature,resourceKey:feature,count:usable ? rows.length : null,countBasis:'prepared-feed',availability:unavailable ? 'unavailable' : failed ? 'error' : rows.length ? 'ready' : 'empty',sourceMode:adapter==='api' && !unavailable ? 'feed-backed' : 'unknown',sourceAdapter:adapter,fallback:Boolean(raw.fallback),unit:UNITS[slice],asOf,observationPeriod,period:observationPeriod ? observationPeriod.from===observationPeriod.through ? observationPeriod.from : `${observationPeriod.from}–${observationPeriod.through}` : null,retrievedAt,columns,sources,leagueDistribution,leagueUnreported,sourceNote,limitations:`${LIMITATIONS[slice]}${sourceNote ? ` ${sourceNote}` : ''}${!unavailable && (unsupportedSource || headlinesAsFixtures || headlinesAsDirectory) ? ' The returned source does not establish this Sports module’s measured coverage.' : ''}`};
}
