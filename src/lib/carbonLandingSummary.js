import { prepareDeskFeed } from './prepareDeskFeed.js';
import { feedColumns } from './columns.js';
import { carbonSlice } from './carbonPack.js';

export const CARBON_FEATURES = ['Global Carbon Pricing Tracker', 'Carbon Price Monitor', 'ETS & Tax Adoption Timeline', 'Carbon Border (CBAM) Watch', 'India CCTS & Green Credits', 'Carbon Registry Wire', 'Climate Newswire'];
const present = value => value != null && !['', '—', 'Not reported', 'unknown'].includes(String(value).trim());
const safeUrl = value => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; } };
const validDate = value => /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(String(value || '')) && Number.isFinite(Date.parse(value)) ? value : null;
const UNITS = { pricing: 'jurisdictions', monitor: 'observations', ets: 'jurisdictions', cbam: 'milestones', ccts: 'milestones', registry: 'publications', news: 'articles' };
const LIMITATIONS = {
  pricing: 'Stored jurisdiction carbon-pricing observations, with instrument coverage and emissions-weighted USD/t. Record counts are not a combined price or live market ticks.',
  monitor: 'Stored jurisdiction-year carbon-price observations in USD/tCO2e. Prices across jurisdictions are not summed and emissions are not substituted for prices.',
  ets: 'Stored first-instrument years and reported ETS/tax adoption. Jurisdiction counts do not establish complete global coverage.',
  cbam: 'EU/UK official-source milestones. Future effective dates are policy observations, not source update dates or proof that an event has already occurred.',
  ccts: 'Official-source CCTS and Green Credit milestones. Effective dates do not establish current implementation or credit prices.',
  registry: 'Dated registry publications from the returned source; coverage is not a complete registry transaction or credit inventory.',
  news: 'Outlet articles from Carbon Brief, Mongabay India and Climate Home News, or a stored outlet snapshot. These are reporting, not regulatory records.',
};

export function projectCarbonSummary(raw, retrievedAt = new Date().toISOString()) {
  const feature = raw?.feature;
  if (!CARBON_FEATURES.includes(feature)) throw new Error('Unknown Carbon module');
  const slice = carbonSlice(feature);
  const adapter = raw.source?.adapter || 'unknown';
  const kind = raw.source?.kind || raw.kind || '';
  const rows = (prepareDeskFeed(raw)?.rows || []).filter(row => row && row.status !== 'source_status');
  const unsupportedSource = !['embedded', 'api'].includes(adapter) || kind === 'backup-pack' || Boolean(raw.gdelt || raw.source?.gdelt);
  const emissionsAsPrice = ['pricing', 'monitor'].includes(slice) && rows.some(row => /EN\.GHG\.CO2/i.test(String(row.indicator_id || row.indicator || '')) || (!present(row.weighted_price_usd) && !present(row.ets_price_usd) && present(row.value)));
  const failed = raw.ok === false || unsupportedSource || emissionsAsPrice || (!rows.length && raw.rows?.some(row => row?.status === 'source_status'));
  const columns = failed ? [] : feedColumns(feature, rows).filter(c => rows.some(row => present(row[c.key]) || (c.fallback && present(row[c.fallback])))).slice(0, 16).map(({ key, label }) => ({ key, label }));
  const links = [...(raw.source?.links || []), ...rows.map(row => row.source_url)].map(safeUrl).filter(Boolean);
  const sources = [...new Map(links.map(url => [new URL(url).hostname, url])).values()].slice(0, 4).map(url => ({ name: new URL(url).hostname.replace(/^www\./, ''), url }));
  const dates = failed ? [] : rows.flatMap(row => [row.year, row.date, row.first_instrument_year]).filter(value => /^\d{4}$/.test(String(value)) || validDate(value)).map(String).sort();
  const observationPeriod = dates.length ? { from: dates[0], through: dates.at(-1) } : null;
  const asOf = validDate(raw.meta?.as_of) || validDate(raw.meta?.asOf) || validDate(raw.meta?.lastupdated) || null;
  const jurisdictions = new Map();
  let jurisdictionUnreported = 0;
  if (!failed && ['pricing', 'monitor'].includes(slice)) for (const row of rows) {
    const label = row.jurisdiction;
    if (present(label)) jurisdictions.set(String(label), (jurisdictions.get(String(label)) || 0) + 1);
    else jurisdictionUnreported++;
  }
  const jurisdictionDistribution = [...jurisdictions].sort(([a], [b]) => a.localeCompare(b)).slice(0, 12).map(([label, count]) => ({ label, count }));
  const shown = new Set(jurisdictionDistribution.map(item => item.label));
  jurisdictionUnreported += [...jurisdictions].filter(([label]) => !shown.has(label)).reduce((sum, [, count]) => sum + count, 0);
  const blend = slice === 'registry' && adapter === 'api' ? ' The API response blends live Verra publications with stored entries for other registries; it is not wholly live.' : '';
  return {
    ok: !failed, version: 1, feature, resourceKey: feature, count: failed ? null : rows.length, countBasis: 'prepared-feed',
    availability: failed ? 'error' : rows.length ? 'ready' : 'empty',
    sourceMode: adapter === 'embedded' ? 'stored' : adapter === 'api' ? 'feed-backed' : 'unknown', sourceAdapter: adapter,
    fallback: Boolean(raw.fallback), unit: UNITS[slice], asOf, observationPeriod,
    period: observationPeriod ? observationPeriod.from === observationPeriod.through ? observationPeriod.from : `${observationPeriod.from}–${observationPeriod.through}` : null,
    retrievedAt, columns, sources, jurisdictionDistribution, jurisdictionUnreported,
    limitations: `${LIMITATIONS[slice]}${blend}${unsupportedSource || emissionsAsPrice ? ' The returned source does not establish this Carbon module’s measured coverage.' : ''}`,
  };
}
