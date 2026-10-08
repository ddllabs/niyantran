import { prepareDeskFeed } from './prepareDeskFeed.js';
import { feedColumns } from './columns.js';
import { econSlice } from './econPack.js';

export const ECONOMICS_FEATURES = [
  'NSE/BSE Delayed Market Feed', 'Live Global Stock Exchanges', 'Economic Overview of All Countries',
  'Key Financial Indicators (GDP, CPI, PMI, Emp-to-Pop)', 'Sector Policy — Power/Energy/Green/Critical Minerals',
  'Economic Simulator', 'Trade Agreements & Economic Sanctions', 'Top Financial & Business Players',
  'AI & the Tech Industry', 'Prediction Market Political Odds', 'Election Forecast Aggregator',
];
const present = value => value != null && !['', '—', 'Not reported', 'unknown'].includes(String(value).trim());
const safeUrl = value => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; } };
const validDate = value => /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(String(value || '')) && Number.isFinite(Date.parse(value)) ? value : null;
const LIMITATIONS = {
  nse: 'Delayed NSE quotes or a frozen embedded quote snapshot. No live ticks or sector coverage is established; a missing quote date remains unreported.',
  world: 'Last index quotes for configured Yahoo venues, not a licensed tick stream or universal exchange coverage.',
  countries: 'Latest non-empty World Bank GDP observations per country, in current US$ billions. Aggregates excluded; no trade-balance table.',
  indicators: 'World Bank GDP growth, CPI and employment-to-population observations. PMI is not in this table. The row year belongs to GDP growth; CPI and employment observation years are not separately reported by this adapter.',
  simulator: 'Historical India GDP growth baseline, annual %. No what-if engine or generated scenario outcomes.',
  sector: 'India electricity-access observations, % of population. No full policy, ministry or critical-mineral register.',
  trade: 'Stored DGFT notifications. No complete sanctions, WTO tariff or agreement inventory.',
  leaders: 'Wikidata Indian enterprise chief-executive identities. No ranking, financials or market capitalization.',
  ai: 'PIB RSS reporting; topic-specific completeness is not established and not every release is necessarily about AI. No investment database.',
  manifold: 'Political Manifold markets ranked by recent volume, from polling or a stored snapshot. Market probabilities are not NTER forecasts. Close dates are not quote-update dates.',
  elections: 'No election-forecast table is available in the existing adapter. No forecasts or consensus values are supplied.',
};
const UNITS = { nse: 'quotes', world: 'quotes', countries: 'countries', indicators: 'countries', simulator: 'observations', sector: 'observations', trade: 'notifications', leaders: 'identities', ai: 'reports', manifold: 'markets', elections: 'forecasts' };

/** Compact source projection; prepared rows remain private to the feed endpoint. */
export function projectEconomicsSummary(raw, retrievedAt = new Date().toISOString()) {
  const feature = raw?.feature;
  if (!ECONOMICS_FEATURES.includes(feature)) throw new Error('Unknown Economics module');
  const slice = econSlice(feature);
  const adapter = raw.source?.adapter || 'unknown';
  let rows = (prepareDeskFeed(raw)?.rows || []).filter(row => row && row.status !== 'source_status');
  // Existing feeds already project political markets; this rejects raw non-political entries too.
  if (slice === 'manifold') rows = rows.filter(row => /^(yes|true|1)$/i.test(String(row.is_political || '')));
  const unavailable = slice === 'elections';
  const wrongSource = slice !== 'ai' && (adapter === 'news-search' || raw.gdelt || raw.source?.gdelt);
  const unsupportedSource = raw.source?.kind === 'backup-pack' || raw.kind === 'backup-pack' || !['api', 'live', 'embedded', ...(slice === 'ai' ? ['news-search'] : [])].includes(adapter);
  const failed = raw.ok === false || wrongSource || unsupportedSource || (!rows.length && raw.rows?.some(row => row?.status === 'source_status'));
  const usable = !unavailable && !failed;
  const columns = usable ? feedColumns(feature, rows).filter(c => rows.some(row => present(row[c.key]) || (c.fallback && present(row[c.fallback])))).slice(0, 16).map(({ key, label }) => ({ key, label })) : [];
  const links = [...(raw.source?.links || []), ...rows.map(row => row.source_url)].map(safeUrl).filter(Boolean);
  const sources = [...new Map(links.map(url => [new URL(url).hostname, url])).values()].slice(0, 4).map(url => ({ name: new URL(url).hostname.replace(/^www\./, ''), url }));
  const periods = usable && slice !== 'manifold' ? rows.flatMap(row => [row.year, row.as_of, row.asOf, row.date]).filter(value => /^\d{4}$/.test(String(value)) || validDate(value)).map(String).sort() : [];
  const observationPeriod = periods.length ? { from: periods[0], through: periods.at(-1) } : null;
  const asOf = validDate(raw.meta?.as_of) || validDate(raw.meta?.asOf) || validDate(raw.meta?.lastupdated) || null;
  const exchanges = new Map();
  let exchangeUnreported = 0;
  if (usable && ['nse', 'world'].includes(slice)) for (const row of rows) {
    const label = row.exchange || row.venue;
    if (present(label)) exchanges.set(String(label), (exchanges.get(String(label)) || 0) + 1);
    else exchangeUnreported++;
  }
  const exchangeDistribution = [...exchanges].sort(([a], [b]) => a.localeCompare(b)).slice(0, 12).map(([label, count]) => ({ label, count }));
  const displayedExchanges = new Set(exchangeDistribution.map(item => item.label));
  exchangeUnreported += [...exchanges].filter(([label]) => !displayedExchanges.has(label)).reduce((sum, [, count]) => sum + count, 0);
  return {
    ok: unavailable || usable, version: 1, feature, resourceKey: feature, count: usable ? rows.length : null,
    countBasis: 'prepared-feed', availability: unavailable ? 'unavailable' : failed ? 'error' : rows.length ? 'ready' : 'empty',
    sourceMode: unavailable ? 'unknown' : adapter === 'embedded' ? 'stored' : ['api', 'live', 'news-search'].includes(adapter) ? 'feed-backed' : 'unknown',
    sourceAdapter: adapter, fallback: Boolean(raw.fallback), unit: UNITS[slice], asOf, observationPeriod, retrievedAt,
    period: observationPeriod ? observationPeriod.from === observationPeriod.through ? observationPeriod.from : `${observationPeriod.from}–${observationPeriod.through}` : null,
    columns, sources, exchangeDistribution, exchangeUnreported,
    limitations: `${LIMITATIONS[slice]}${wrongSource ? ' Returned news cannot supply this module’s economic data.' : unsupportedSource ? ' The returned source does not establish measured economic coverage.' : ''}`,
  };
}
