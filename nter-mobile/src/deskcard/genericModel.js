// The desk card model for a module without a website adapter. nter.pro shows those records in its
// older record view (src/shell/RecordDetail.jsx); this builds the same content — title, stage,
// source, date and verification, timeline, documents, related entities and every field — in the
// record panel's shape, so every desk card on the phone has one design. The rules (which fields are
// skipped, which are entities, where the source and dates come from) are RecordDetail's.
import { formatDate, formatDateTime, parseDate } from '../lib/format.js';
import { plainNote, plainSourceLine } from '../lib/plainSourceNote.js';

const SKIP = new Set([
  'source_url', 'pdf_url', 'status', 'adapter', 'fail_reason', 'host', 'detail', 'reporting_search',
  'sources_json', 'lat', 'lon', 'id', 'brief', 'why_it_matters', 'watch_for', 'tags', 'sizeBand',
  '_blocRaw', '_otherRaw', 'related_links', 'seat_list', 'pdf_note',
]);
const ENTITY_KEYS = /party|ministry|sector|region|state|constituency|vendor|origin|category|department|court|company|sponsor|financier|country|cadre|scheme|type|trend|intensity/i;
const TITLE_KEYS = ['conflict_name', 'title', 'bill_name', 'name', 'headline', 'case_title', 'scheme_name', 'project', 'company'];
const STAGE_KEYS = ['current_stage', 'stage', 'status', 'outcome', 'result', 'verdict'];
const RELATED_KEYS = ['ministry', 'sector', 'category', 'court', 'state', 'country', 'department', 'region', 'party'];
const NO_AS_OF = 'as-of not on record';
const MAX_ROWS = 24;
const MAX_RELATED = 3;

// "date_introduced" → "Date Introduced", "leadPct" → "Lead Pct" (RecordDetail's prettyKey, plus camelCase).
export const prettyKey = (k) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const isUrl = (v) => /^https?:\/\//i.test(String(v).trim());
const isHttps = (v) => /^https:\/\//i.test(String(v || '').trim());
const fieldText = (v) => (Array.isArray(v) ? v.filter((x) => x != null && typeof x !== 'object' && String(x).trim() !== '').join(', ') : typeof v === 'object' ? '' : String(v)).replace(/\s+/g, ' ').trim();
// A calendar date ("2026-10-14", "14.10.2026", an ISO time), not a word or a bare vintage.
const isDate = (v) => /^\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})/.test(String(v ?? '')) && Boolean(formatDate(v));
// Leaked values and bracketed placeholders are never shown as data.
const PLACEHOLDER = /\[[A-Za-z][A-Za-z0-9 /&,.'-]{0,40}\]|\bundefined\b|\bNaN\b|^\s*null\s*$/;

function entriesOf(row) {
  return Object.entries(row || {})
    .filter(([k, v]) => !SKIP.has(k) && !/^source_\d/.test(k) && v != null)
    .map(([k, v]) => [k, fieldText(v)])
    .filter(([, v]) => v !== '' && !PLACEHOLDER.test(v));
}

function pickField(row, keys) {
  for (const k of keys) {
    const v = fieldText(row?.[k] ?? '');
    if (v && !PLACEHOLDER.test(v)) return { key: k, value: v };
  }
  return null;
}

export function titleOf(row, fallback = 'Record') {
  return pickField(row, TITLE_KEYS)?.value || fallback;
}

export function stageOf(row) {
  const s = pickField(row, STAGE_KEYS);
  return s && s.value.length < 40 && s.value !== 'source_status' ? s.value : '';
}

export function stageTone(stage) {
  const s = String(stage || '').toLowerCase();
  if (!s) return undefined;
  if (/negativ|reject|dismiss|struck|fail|revok|cancel/.test(s)) return 'red';
  if (/pend|await|reserved|listed|ongoing|active|escalat|draft|consult|under/.test(s)) return 'amber';
  if (/assent|enact|pass|approv|allow|final|won|complete|notified|in force|disposed|resolved/.test(s)) return 'green';
  if (/laps|withdraw|remov|closed|inactive|archiv/.test(s)) return 'grey';
  return 'blue';
}

/** Every https document the row names: sources_json, source_1…6, the source and the PDF (RecordDetail's order). */
export function sourcePairs(row) {
  const out = [];
  const seen = new Set();
  const add = (label, url) => { const u = String(url || '').trim(); if (isHttps(u) && !seen.has(u)) { seen.add(u); out.push({ label, href: u }); } };
  if (row?.sources_json) {
    try { for (const s of JSON.parse(row.sources_json)) if (Array.isArray(s)) add(s[0] || 'Source', s[1]); } catch { /* not JSON */ }
  }
  for (let i = 1; i <= 6; i++) add(row?.[`source_${i}`] || `Source ${i}`, row?.[`source_${i}_url`]);
  add('Source record', row?.source_url);
  if (row?.pdf_url) add(/sci\.gov\.in/i.test(row.pdf_url) ? 'Order PDF (SCI)' : 'PDF', row.pdf_url);
  for (const [k, v] of Object.entries(row || {})) if (typeof v === 'string' && isHttps(v) && !SKIP.has(k)) add(prettyKey(k), v);
  return out;
}

/** Source, source date and last verified: the row's own fields first, else the feed's (RecordDetail's provenanceOf). */
export function provenanceOf(row, feed) {
  const own = pickField(row, ['source_label', 'source', 'outlet', 'domain', 'publisher']);
  const host = (() => { try { return new URL(row?.source_url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const source = own?.value || host || plainNote(feed?.source?.note || '') || plainSourceLine(feed) || '';
  const dated = pickField(row, ['source_date', 'published', 'published_at', 'pub_date', 'date', 'decision_date', 'date_introduced', 'as_of', 'updated', 'tabled', 'introduced', 'filed_on']);
  const sourceDate = dated ? { key: dated.key, display: formatDate(dated.value) || dated.value } : null;
  const datasetAsOf = [feed?.meta?.as_of, feed?.meta?.asOf, feed?.coverage?.through].find(isDate);
  const verifiedField = pickField(row, ['last_verified', 'verified', 'latestDate', 'dataThrough', 'verified_at']);
  const verified = verifiedField ? formatDateTime(verifiedField.value) || formatDate(verifiedField.value) || verifiedField.value : '';
  return {
    source,
    sourceDate,
    asOf: sourceDate?.display || (datasetAsOf ? `dataset as of ${formatDate(datasetAsOf)}` : ''),
    verified,
  };
}

function shortValue(v) {
  return v.length <= 28 && !isUrl(v);
}

/**
 * RecordPanelModel for any row. `ctx` = { rows, feed, module } — rows are the module's rows on
 * screen (for related records), feed is the module's answer, module the app's module entry.
 */
export default function genericModel(row, ctx = {}) {
  const { rows = [], feed = null, module = {} } = ctx;
  const title = titleOf(row, module.title || 'Record');
  const stage = stageOf(row);
  const tone = stageTone(stage);
  const entries = entriesOf(row);
  const prov = provenanceOf(row, feed);
  const used = new Set([...TITLE_KEYS.filter((k) => fieldText(row?.[k] ?? '') === title), ...STAGE_KEYS.filter((k) => fieldText(row?.[k] ?? '') === stage)]);

  const entities = entries.filter(([k, v]) => ENTITY_KEYS.test(k) && !isUrl(v) && v.length <= 40 && !used.has(k));
  const meta = [...new Set(entities.map(([, v]) => v))].slice(0, 3);

  const tiles = [];
  if (stage) tiles.push({ label: 'Stage', value: stage, sub: 'as recorded', ...(tone && tone !== 'grey' ? { tone } : {}) });
  if (prov.sourceDate) {
    tiles.push({ label: prettyKey(prov.sourceDate.key), value: prov.sourceDate.display, sub: 'on record' });
    used.add(prov.sourceDate.key);
  }
  const numeric = entries.filter(([k, v]) => !used.has(k) && shortValue(v) && /^[-+₹$€£]?\s?[\d.,]+\s?(%|cr|crore|lakh|bn|mn|m|k|years?|days?)?$/i.test(v));
  const short = entries.filter(([k, v]) => !used.has(k) && shortValue(v) && !numeric.some(([n]) => n === k) && !isDate(v));
  for (const [k, v] of [...numeric, ...short]) {
    if (tiles.length >= 4) break;
    tiles.push({ label: prettyKey(k), value: v });
    used.add(k);
  }
  if (tiles.length < 2) tiles.push({ label: 'Module', value: module.title || 'Record', sub: module.deskName ? `${module.deskName} desk` : undefined });
  if (tiles.length < 2) tiles.push({ label: 'Fields on record', value: String(entries.length) });

  const dates = entries
    .filter(([, v]) => isDate(v))
    .map(([k, v]) => ({ k, v, at: parseDate(v)?.getTime() || 0 }))
    .sort((a, b) => a.at - b.at);
  const visual = dates.length >= 2 ? {
    type: 'timeline',
    title: 'Dates on record',
    steps: dates.slice(0, 6).map((d, i, all) => ({ label: prettyKey(d.k), detail: formatDate(d.v) || d.v, done: i < all.length - 1, now: i === all.length - 1 })),
    caption: 'Dates as the source records them, in order.',
  } : undefined;

  const long = entries.filter(([, v]) => v.length > 160 && !isUrl(v));
  const aboutRows = entries.filter(([k, v]) => v.length <= 160 && !isUrl(v) && !(k === 'title' && v === title)).slice(0, MAX_ROWS);
  const tags = Array.isArray(row?.tags) ? row.tags.map(fieldText).filter((t) => t && t.length <= 40).slice(0, 10) : [];

  const relatedKey = RELATED_KEYS.find((k) => fieldText(row?.[k] ?? ''));
  const relatedValue = relatedKey ? fieldText(row[relatedKey]) : '';
  const related = relatedKey
    ? rows.filter((r) => r && r !== row && (r.id == null || r.id !== row.id) && fieldText(r[relatedKey] ?? '') === relatedValue && titleOf(r, '') !== title)
    : [];

  const links = sourcePairs(row).slice(0, 4);
  return {
    title,
    meta,
    badge: stage ? { text: stage, tone: tone || 'blue' } : undefined,
    links,
    glance: { tiles: tiles.slice(0, 4), visual },
    about: {
      label: '02 · About this record',
      rows: aboutRows.map(([k, v]) => [prettyKey(k), v]),
      chips: tags,
      cards: [
        ...long.slice(0, 4).map(([k, v]) => ({ heading: prettyKey(k), body: v })),
      ],
    },
    touches: related.length ? {
      label: `03 · Related on record`,
      links: [
        ...related.slice(0, MAX_RELATED).map((r) => ({ title: titleOf(r), detail: [stageOf(r), `${prettyKey(relatedKey)}: ${relatedValue}`].filter(Boolean).join(' · '), row: r })),
        ...(related.length > MAX_RELATED ? [{ title: `${related.length} records share ${prettyKey(relatedKey).toLowerCase()} ${relatedValue}`, detail: 'in this module' }] : []),
      ],
    } : undefined,
    footer: {
      ask: 'Ask AI about this record',
      provenance: { source: prov.source || module.title || 'Not on record', asOf: prov.asOf, flags: prov.asOf ? [] : [NO_AS_OF] },
      health: prov.verified ? [['Last verified', prov.verified]] : [],
      note: 'Fields are shown as the source publishes them. Information, not advice.',
    },
  };
}
