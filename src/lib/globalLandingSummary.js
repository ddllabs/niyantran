import { prepareDeskFeed } from './prepareDeskFeed.js';
import { feedColumns } from './columns.js';

export const GLOBAL_FEATURES = ['Open Fronts', 'Global Intelligence', 'Alliances', 'Sanctions', 'Global Aid', 'Infra', 'Nuclear Watch', 'Satellite Infrastructure', 'Maritime Choke-Points', 'World Constitutions', 'Growth Indicators', 'Geopolitics News Wire', 'Heads of State', 'Global Commodities', 'Global Trade', 'Energy'];
const LIMITS = [
  'Stored conflict register; continuous verification and geographic completeness are not established.',
  'Stored defence procurement programmes; not comprehensive defence intelligence.',
  'Stored alliance dossiers; membership exceptions and source dates vary.',
  'Stored sanctions programmes, not a current entity-designation list. Live lists are separate workspace overlays.',
  'Stored aid appeal dossiers; appeal periods and data-through dates differ by row, so no single source date is implied. Live funding flows are separate workspace overlays.',
  'Stored infrastructure projects; live project retrieval is a separate workspace overlay.',
  'Stored facility records with source-supplied coordinate precision; not a live reactor or arsenal count.',
  'Upcoming launches from The Space Devs; not a complete satellite or constellation inventory.',
  'Stored chokepoint dossiers; live transit data is a separate workspace overlay.',
  'Constitute Project retrieval; available constitutions do not establish complete country coverage.',
  'World Bank indicators for the existing country set; observation years differ, missing values are not reported.',
  'Reporting search / RSS; stories are not official government records and coverage varies.',
  'Stored leader profiles as of their recorded dates; not continuous officeholder verification.',
  'Existing board uses illustrative price levels. Measured market data and a reliable record count are unavailable.',
  'World Bank trade indicators for the existing country set; observation years differ.',
  'Curated mineral references; workspace price overlays are illustrative and are excluded here.',
];
const present = value => value != null && !['', '—', 'Not reported', 'unknown'].includes(String(value).trim());
const safeUrl = value => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; } };

export function projectGlobalSummary(raw, retrievedAt = new Date().toISOString()) {
  const feature = raw?.feature;
  if (!GLOBAL_FEATURES.includes(feature)) throw new Error('Unknown Global module');
  const rows = prepareDeskFeed(raw)?.rows?.filter(row => row.status !== 'source_status') || [];
  const failed = raw.ok === false || (!rows.length && raw.rows?.some(row => row.status === 'source_status'));
  const illustrative = feature === 'Global Commodities';
  const available = !failed && !illustrative;
  const adapter = raw.source?.adapter;
  const sourceMode = !available ? 'unknown' : feature === 'Energy' ? 'curated' : adapter === 'embedded' ? 'stored' : ['live', 'api', 'news-search'].includes(adapter) && !raw.fallback ? 'feed-backed' : 'unknown';
  const dates = [...new Set(rows.map(row => row.as_of).filter(Boolean))];
  const candidate = raw.meta?.as_of || raw.meta?.asOf || raw.meta?.verified || (dates.length === 1 ? dates[0] : null);
  const asOf = candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
  const years = [...new Set(rows.map(row => Number(row.year)).filter(year => Number.isInteger(year) && year >= 1900 && year <= 2200))].sort();
  const period = years.length ? years.length === 1 ? String(years[0]) : `${years[0]}–${years.at(-1)}` : null;
  const populated = key => rows.some(row => present(row[key]));
  const specificFields = {
    Energy: [{ key: 'name', label: 'Mineral' }, { key: 'use', label: 'Use' }, { key: 'topProducers', label: 'Top producers' }, { key: 'chinaShare', label: 'China share' }, { key: 'status', label: 'Supply status' }, { key: 'intensity', label: 'Relative supply risk' }, { key: 'latest', label: 'Latest context' }, { key: 'note', label: 'Source note' }],
    'Global Aid': [{ key: 'title', label: 'Appeal' }, { key: 'agency', label: 'Agency' }, { key: 'region', label: 'Region' }, { key: 'requirement', label: 'Requirement' }, { key: 'funded', label: 'Funded' }, { key: 'people_target', label: 'People targeted' }, { key: 'people_need', label: 'People in need' }, { key: 'period', label: 'Appeal period' }, { key: 'dataThrough', label: 'Data through' }, { key: 'appeal_status', label: 'Appeal status' }],
  };
  let fields = specificFields[feature] || (feature === 'Satellite Infrastructure' ? [{ key: 'title', label: 'Launch' }, { key: 'provider', label: 'Provider' }, { key: 'country', label: 'Country' }, { key: 'pad', label: 'Launchpad' }, { key: 'status', label: 'Status' }, { key: 'net', label: 'Scheduled launch' }] : feedColumns(feature, rows));
  if (feature === 'Infra') fields = [...fields, { key: 'expected', label: 'Expected completion' }, { key: 'detail', label: 'Project context' }];
  if (feature === 'Nuclear Watch') fields = fields.map(field => field.key === 'latest' ? { ...field, label: 'Notes' } : field);
  if (feature === 'Maritime Choke-Points') fields = [...fields, { key: 'width', label: 'Width' }, { key: 'operators', label: 'Operators' }, { key: 'risk', label: 'Risk context' }, { key: 'note', label: 'Notes' }];
  fields = [...new Map(fields.map(field => [field.key, field])).values()];
  const columns = available ? fields.filter(c => populated(c.key) || (c.fallback && populated(c.fallback))).slice(0, 16).map(({ key, label }) => ({ key, label })) : [];
  const locations = ['Nuclear Watch', 'Maritime Choke-Points'].includes(feature) && available ? rows.flatMap(row => {
    if (!present(row.lat) || !present(row.lon)) return [];
    const lat = Number(row.lat), lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    return [{ name: String(row.title || row.name || 'Unnamed record').slice(0, 120), lat, lon, precision: String(row.precision || 'Source-supplied; schematic location').slice(0, 80) }];
  }).slice(0, 160) : [];
  const links = [...(raw.source?.links || []), ...rows.map(row => row.source_url)].map(safeUrl).filter(Boolean);
  const sources = [...new Map(links.map(url => [new URL(url).hostname, url])).values()].slice(0, 4).map(url => ({ name: new URL(url).hostname.replace(/^www\./, ''), url }));
  return { ok: !failed, version: 1, feature, resourceKey: feature, count: available ? rows.length : null, countBasis: 'prepared-feed', availability: failed ? 'error' : illustrative ? 'unavailable' : rows.length ? 'ready' : 'empty', sourceMode, asOf, period, retrievedAt, columns, sources, limitations: LIMITS[GLOBAL_FEATURES.indexOf(feature)], locations };
}
