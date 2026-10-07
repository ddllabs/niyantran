import { prepareDeskFeed } from './prepareDeskFeed.js';
import { feedColumns } from './columns.js';
import { entertainmentSlice } from './entertainmentPack.js';
export const ENTERTAINMENT_FEATURES = ['TV & Streaming Tonight','Box Office Tracker','Entertainment News Wire','Bollywood & Film Wire','Music Charts — India Top 25','Music Charts — Global Top 25','OTT & Studio Intelligence','Celebrity Influence Index'];
const present = value => value != null && !['','—','Not reported','unknown'].includes(String(value).trim());
const safeUrl = value => { try { const url=new URL(value);return /^https?:$/.test(url.protocol)?url.href:null; } catch { return null; } };
const validDate = value => /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(String(value || '')) && Number.isFinite(Date.parse(value)) ? value : null;
const UNITS = {tv:'listings',box:'films',variety:'articles',bollywood:'articles','music-in':'tracks','music-us':'tracks',ott:'identities',celebrity:'observations'};
const LIMITATIONS = {
 tv:'TVmaze India and United States schedule listings. No complete streaming catalogue or universal television coverage.',
 box:'Wikidata Indian film identities with release dates from 2024, including future-dated entries. Future dates do not confirm a release. Gross is shown only when supplied. Currency and reporting completeness are not established; gross values are not summed. Not weekend box-office charts.',
 variety:'Variety screen-trade RSS reporting, not a complete industry register.',
 bollywood:'NDTV Movies RSS, with declared Google News Bollywood wire fallback. Reporting is not an official film register.',
 'music-in':'Apple Music most-played tracks for India, with iTunes Top Songs fallback. Song release dates are not chart timestamps; no chart history supplied.',
 'music-us':'Apple Music most-played tracks for the United States, not global coverage, with iTunes Top Songs fallback. Song release dates are not chart timestamps; no chart history supplied.',
 ott:'Wikidata Indian service and studio owner identities. No subscriber, pricing or production slate tables.',
 celebrity:'Wikidata public follower observations for Indian actors, singers and directors. No composite influence score or endorsement/box-office measure.',
};
export function projectEntertainmentSummary(raw, retrievedAt = new Date().toISOString()) {
 const feature=raw?.feature;
 if(!ENTERTAINMENT_FEATURES.includes(feature)) throw new Error('Unknown Entertainment module');
 const slice=entertainmentSlice(feature),adapter=raw.source?.adapter || 'unknown';
 const rows=(prepareDeskFeed(raw)?.rows || []).filter(row=>row && row.status!=='source_status');
 const unsupported=adapter!=='api' || raw.source?.kind==='backup-pack' || raw.kind==='backup-pack' || Boolean(raw.gdelt || raw.source?.gdelt);
 const identityField={tv:'show',box:'film','music-in':'track','music-us':'track',ott:'service',celebrity:'person'}[slice];
 const invalidShape=Boolean(identityField && rows.some(row=>!present(row[identityField])));
 const failed=invalidShape || raw.ok===false || unsupported || (!rows.length && raw.rows?.some(row=>row?.status==='source_status'));
 const columns=failed?[]:feedColumns(feature,rows).filter(c=>rows.some(row=>present(row[c.key]) || (c.fallback && present(row[c.fallback])))).slice(0,16).map(({key,label})=>({key,label}));
 const links=[...(raw.source?.links || []),...rows.map(row=>row.source_url)].map(safeUrl).filter(Boolean);
 const sources=[...new Map(links.map(url=>[new URL(url).hostname,url])).values()].slice(0,4).map(url=>({name:new URL(url).hostname.replace(/^www\./,''),url}));
 const dates=failed || slice.startsWith('music-')?[]:rows.flatMap(row=>[row.date,row.release_date]).filter(validDate).map(String).sort();
 const observationPeriod=dates.length?{from:dates[0],through:dates.at(-1)}:null;
 const counts=new Map();let countryUnreported=0;
 if(!failed && slice==='tv') for(const row of rows){if(present(row.country)) counts.set(String(row.country),(counts.get(String(row.country)) || 0)+1);else countryUnreported++;}
 const countryDistribution=[...counts].sort(([a],[b])=>a.localeCompare(b)).slice(0,12).map(([label,count])=>({label,count}));
 const shown=new Set(countryDistribution.map(row=>row.label));countryUnreported += [...counts].filter(([label])=>!shown.has(label)).reduce((sum,[,count])=>sum+count,0);
 // Source notes are public adapter prose. React renders them as text; keep them bounded.
 const sourceNote=String(raw.source?.note || '').slice(0,800);
 return {ok:!failed,version:1,feature,resourceKey:feature,count:failed?null:rows.length,countBasis:'prepared-feed',availability:failed?'error':rows.length?'ready':'empty',sourceMode:adapter==='api'?'feed-backed':'unknown',sourceAdapter:adapter,fallback:Boolean(raw.fallback),unit:UNITS[slice],asOf:validDate(raw.meta?.as_of) || validDate(raw.meta?.asOf) || validDate(raw.meta?.lastupdated) || null,observationPeriod,period:observationPeriod?observationPeriod.from===observationPeriod.through?observationPeriod.from:`${observationPeriod.from}–${observationPeriod.through}`:null,retrievedAt,columns,sources,countryDistribution,countryUnreported,limitations:`${LIMITATIONS[slice]}${sourceNote?` Source context: ${sourceNote}`:''}${unsupported || invalidShape?' The returned source does not establish measured Entertainment coverage.':''}`};
}
