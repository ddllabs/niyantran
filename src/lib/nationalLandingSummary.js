import { prepareDeskFeed } from './prepareDeskFeed.js';
import { feedColumns } from './columns.js';

// Canonical route identities, guarded against the live catalog in tests.
export const NATIONAL_FEATURES = [
  'Bill Passage Probability Index', 'Policy Intelligence Graph', 'Parliamentary Question Database',
  'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)', 'Candidate Affidavit Database (Structured + API)',
  'MP Profiles & Performance (MPLAD, attendance, debates)', 'Central Tender Aggregator + Constituency Filter',
  'Bureaucratic Transfers — AGMUT Cadre', 'Cabinet Decisions', 'Centre-sanctioned Projects & Completion Rate',
  'Budget Utilisation & Schemes', 'Industry Updates (Ministry Data)',
];
export const BILL_FEATURE = NATIONAL_FEATURES[0];
export const GRAPH_FEATURE = NATIONAL_FEATURES[1];
export const nationalResourceKey = feature => feature === GRAPH_FEATURE ? BILL_FEATURE : feature;
const LIMITS = [
  'Stored bill register; continuous refresh and passing dates are unavailable.',
  'A graph of the bill register; not an additional record collection.',
  'Sampled questions; substantive answer text is not available for all records.',
  'Source coverage varies; not all advertised regulators are connected.',
  'Stored MyNeta/ADR-linked records; not a live ECI API.',
  'Stored member profiles; attendance is not populated.',
  'Only unexpired tenders are counted; live procurement coverage is limited.',
  'Stored posting orders; continuous refresh is not connected.',
  'PIB releases may include general news, not only Cabinet decisions.',
  'Curated programmes; verified expenditure and completion series are unavailable.',
  'Curated allocations, not measured budget utilisation.',
  'World Bank India series; not comprehensive ministry coverage.',
];
const graphFields = [{ key: 'sector', label: 'Sector' }, { key: 'house', label: 'House' }, { key: 'current_stage', label: 'Stage' }];
const populated = (rows, key) => rows.some(r => r[key] != null && String(r[key]).trim() !== '');
const safeLink = value => {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; }
};

export function projectNationalSummary(raw, retrievedAt = new Date().toISOString()) {
  const feature = raw?.feature;
  if (!NATIONAL_FEATURES.includes(feature)) throw new Error('Unknown National module');
  const rows = prepareDeskFeed(raw)?.rows?.filter(r => r.status !== 'source_status') || [];
  const unavailable = raw.ok === false || (!rows.length && raw.rows?.some(r => r.status === 'source_status'));
  const adapter = raw.source?.adapter;
  const sourceMode = [NATIONAL_FEATURES[9], NATIONAL_FEATURES[10]].includes(feature) ? 'curated'
    : adapter === 'embedded' ? 'stored' : ['live', 'api'].includes(adapter) && !raw.fallback ? 'feed-backed' : 'unknown';
  const rowDates = [...new Set(rows.map(r => r.as_of).filter(Boolean))];
  const asOfValue = raw.meta?.as_of || (rowDates.length === 1 ? rowDates[0] : null);
  const asOf = asOfValue && Number.isFinite(Date.parse(asOfValue)) ? asOfValue : null;
  const columns = feature === GRAPH_FEATURE ? graphFields.filter(c => populated(rows, c.key))
    : feedColumns(feature, rows).filter(c => populated(rows, c.key) || (c.fallback && populated(rows, c.fallback))).map(({ key, label }) => ({ key, label }));
  const sectors = new Map();
  if (nationalResourceKey(feature) === BILL_FEATURE) for (const row of rows) {
    const label = String(row.sector || '').trim() || 'Not classified';
    sectors.set(label, (sectors.get(label) || 0) + 1);
  }
  const ranked = [...sectors].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const sectorSummary = ranked.slice(0, 7).map(([label, count]) => ({ label, count }));
  if (ranked.length > 7) sectorSummary.push({ label: 'Other sectors', count: ranked.slice(7).reduce((n, [, count]) => n + count, 0) });
  return {
    ok: !unavailable, feature, resourceKey: nationalResourceKey(feature), version: 1,
    count: unavailable ? null : rows.length, countBasis: 'prepared-feed',
    availability: unavailable ? 'error' : rows.length ? 'ready' : 'empty', sourceMode,
    asOf, retrievedAt, columns: unavailable ? [] : columns,
    graphColumns: graphFields.filter(c => populated(rows, c.key)),
    sources: [...new Set((raw.source?.links || []).map(safeLink).filter(Boolean))].slice(0, 4).map(url => ({ name: new URL(url).hostname.replace(/^www\./, ''), url })),
    limitations: LIMITS[NATIONAL_FEATURES.indexOf(feature)], sectors: unavailable ? [] : sectorSummary,
  };
}

export function aggregateNationalSummaries(summaries) {
  const resources = new Map(summaries.filter(s => Number.isInteger(s.count)).map(s => [s.resourceKey, s.count]));
  return { count: resources.size ? [...resources.values()].reduce((a, b) => a + b, 0) : null, loaded: resources.size };
}
