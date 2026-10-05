import { prepareDeskFeed } from './prepareDeskFeed.js';
import { feedColumns } from './columns.js';

export const LAW_FEATURES = ['Supreme Court Order & Judgment Feed', 'Order Archive by Topic (Cross-Court)', 'UP High Court (Allahabad) Order Feed', 'District Court Case Tracker', 'NGT Environmental Litigation Tracker', 'CAT & Consumer Disputes (NCDRC) Watch', 'HC Judge Profiles & Bench Analytics', 'ICC Proceedings', 'ICJ Proceedings', 'WTO Dispute Settlement', 'NCLT / NCLAT (Insolvency)', 'Sector Tribunals (ITAT / TDSAT / SAT / DRT)'];
const present = value => value != null && !['', '—', 'Not reported', 'unknown'].includes(String(value).trim());
const safeUrl = value => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; } };

export function projectLawSummary(raw, retrievedAt = new Date().toISOString()) {
  const feature = raw?.feature;
  if (!LAW_FEATURES.includes(feature)) throw new Error('Unknown Law module');
  const rows = prepareDeskFeed(raw)?.rows?.filter(row => row.status !== 'source_status') || [];
  const failed = raw.ok === false || (!rows.length && raw.rows?.some(row => row.status === 'source_status'));
  const adapter = raw.source?.adapter;
  const reporting = adapter === 'news-search' || Boolean(raw.gdelt || raw.source?.gdelt) || rows.some(row => present(row.reporting_search));
  const stored = adapter === 'embedded' && !reporting;
  const sourceMode = failed ? 'unknown' : stored ? 'stored' : ['news-search', 'api', 'live'].includes(adapter) ? 'feed-backed' : 'unknown';
  const shared = stored && LAW_FEATURES.slice(0, 2).includes(feature);
  const limitations = reporting
    ? 'Reporting search / RSS coverage, not an official docket, cause list, judge directory or bench analytics. Broad provider queries do not establish topic-specific completeness.'
    : shared ? 'Stored Supreme Court order table shared by both order views; topic labels are classifiers. Cross-court coverage is not established. SCI PDF links may require a live court session.'
      : feature === LAW_FEATURES[10] ? 'Stored NCLT orders and IBBI public announcements; entries are not all court orders. NCLAT coverage and completeness are not established.'
        : 'Available source entries; court coverage and completeness are not established.';
  const candidate = raw.meta?.as_of || raw.meta?.asOf;
  const asOf = candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
  const fields = reporting ? [{ key: 'title', label: 'Headline' }, { key: 'date', label: 'Published' }, { key: 'summary', label: 'Summary' }, { key: 'source_url', label: 'Source' }] : feedColumns(feature, rows);
  const columns = failed ? [] : fields.filter(c => rows.some(row => present(row[c.key]) || (c.fallback && present(row[c.fallback])))).slice(0, 16).map(({ key, label }) => ({ key, label }));
  const links = [...(raw.source?.links || []), ...rows.map(row => row.source_url)].map(safeUrl).filter(Boolean);
  const sources = [...new Map(links.map(url => [new URL(url).hostname, url])).values()].slice(0, 4).map(url => ({ name: new URL(url).hostname.replace(/^www\./, ''), url }));
  return { ok: !failed, version: 1, feature, resourceKey: shared ? 'judiciary-sc-orders' : feature, count: failed ? null : rows.length, countBasis: 'prepared-feed', availability: failed ? 'error' : rows.length ? 'ready' : 'empty', sourceMode, unit: reporting ? 'reports' : 'entries', asOf, retrievedAt, columns, sources, limitations };
}

export function aggregateLawSummaries(summaries) {
  const resources = new Map(summaries.filter(summary => Number.isInteger(summary?.count)).map(summary => [summary.resourceKey, summary.count]));
  return { count: resources.size ? [...resources.values()].reduce((sum, count) => sum + count, 0) : null, loaded: resources.size };
}
