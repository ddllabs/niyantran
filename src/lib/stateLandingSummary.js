import { STATE_PRESENTATION } from '../desks/landing/statePresentation.js';
import { feedColumns } from './columns.js';
import { sensitiveNoteFor } from './sensitiveData.js';

export const STATE_MODULES = STATE_PRESENTATION.groups.flatMap(group => group.modules);
const safeUrl = value => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; } };
const sourceDate = value => /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(String(value || '')) && Number.isFinite(Date.parse(value)) ? value : null;
const populated = value => value != null && !['', '—', 'unknown', 'Not reported'].includes(String(value).trim());

export function projectStateSummary(module, raw) {
  if (raw && (raw.tier !== module.tier || raw.feature !== module.feature)) throw new Error('State source identity mismatch');
  const source = raw?.source || {};
  const kind = source.kind || raw?.kind || '';
  const adapter = source.adapter || 'unknown';
  const rows = (Array.isArray(raw?.rows) ? raw.rows : []).filter(row => row && typeof row === 'object' && !Array.isArray(row) && row.status !== 'source_status');
  const unavailable = (adapter === 'embedded' && !rows.length && kind !== 'geo-pack') || (!rows.length && raw?.rows?.some(row => row?.status === 'source_status')) || !module.configured || adapter === 'planned' || kind === 'backup-pack' || !['embedded', 'api', 'news-search'].includes(adapter) || Boolean(source.gdelt || raw?.gdelt);
  const failed = raw?.ok !== true || !Array.isArray(raw?.rows);
  const measured = !unavailable && !failed;
  const geo = kind === 'geo-pack';
  const news = adapter === 'news-search';
  const modelled = module.feature === 'Community Bloc Matrix';
  const method = sensitiveNoteFor(module.feature);
  const directory = /MLA Directory|District Performance/.test(module.feature);
  const report = module.feature === 'MLA Report Card + Statement Tracker';
  const unit = modelled ? 'modelled constituency entries' : geo ? /Booth/.test(module.feature) ? 'booth records' : module.feature === 'Local Governance Brief' ? 'district/taluka summaries' : 'constituency records' : news ? 'articles' : kind === 'budget-xlsx' ? 'budget lines' : directory ? 'directory entries' : report ? 'profiles and articles' : 'source entries';
  const links = [...(source.links || []), ...rows.map(row => row.source_url)].map(safeUrl).filter(Boolean);
  const sources = [...new Map(links.map(url => [new URL(url).hostname, url])).values()].slice(0, 4).map(url => ({ name: new URL(url).hostname.replace(/^www\./, ''), url }));
  const columns = measured ? feedColumns(module.feature, rows).filter(column => rows.some(row => populated(row[column.key]) || (column.fallback && populated(row[column.fallback])))).slice(0, 16).map(({ key, label }) => ({ key, label })) : [];
  const districts = new Map();
  if (measured && module.feature === 'Constituency Register') for (const row of rows) {
    if (populated(row.district)) districts.set(String(row.district), (districts.get(String(row.district)) || 0) + 1);
  }
  const limitations = [
    source.note,
    method && `${method.title}. ${method.body}`,
    geo && 'Stored Goa coverage only; this is not a register for every Indian state.',
    news && 'Returned news coverage, not a complete official register or measured analytical result. State coverage varies.',
    report && 'Profiles and assembly news only; attendance, questions and performance scores are not established.',
    module.feature === 'District Performance Tracker (Composite)' && 'District directory fields only; no composite performance score is supplied.',
    kind === 'budget-xlsx' && 'Union Budget expenditure lines, not individual state allocations or disbursement transactions.',
    unavailable && 'Measured coverage for this module is not established by the returned source. No stand-in rows are counted.',
  ].filter(Boolean).join(' ');
  return {
    version: 1, tier: module.tier, feature: module.feature, resourceKey: geo ? /Booth/.test(module.feature) ? 'goa-booths' : module.feature === 'Local Governance Brief' ? 'goa-district-taluka' : 'goa-constituencies' : module.feature,
    count: measured ? rows.length : null, unit,
    availability: failed ? 'error' : unavailable ? 'unavailable' : rows.length ? 'ready' : 'empty',
    sourceMode: measured ? modelled ? 'curated' : adapter === 'embedded' ? 'stored' : 'feed-backed' : 'unknown',
    columns, sources, limitations, fallback: Boolean(raw?.fallback),
    asOf: sourceDate(raw?.meta?.as_of) || sourceDate(raw?.meta?.asOf),
    period: raw?.meta?.vintage || raw?.meta?.profile || null,
    districts: [...districts].map(([label, count]) => ({ label, count })),
  };
}
