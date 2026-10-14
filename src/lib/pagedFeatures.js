/**
 * F156 (spec docs/specs/2026-10-14-paged-module-lists.md, sections 4, 5 and 7): the modules whose
 * table the server answers one page at a time, and the page request's parameters. The browser builds
 * the request with pageQuery and the server reads it with parsePageQuery, so both agree on it.
 */

// A module is paged when its whole answer is over either limit (src/lib/featurePage.test.js checks
// the list against every module's stored register).
export const PAGED_THRESHOLD = { gzipBytes: 250 * 1024, rows: 5000 };
export const PAGED_FEATURES = ['Bill Passage Probability Index', 'Parliamentary Question Database'];
// Over the threshold but kept whole: the graph draws every bill (spec section 5).
export const UNPAGED_LARGE_FEATURES = ['Policy Intelligence Graph'];

export const PAGE_SIZES = [50, 100, 200];
export const DEFAULT_PAGE_SIZE = 100;
export const ANSWER_VALUES = ['yes', 'no', 'unknown'];
const MAX_PAGE = 10000;
const MAX_Q = 100;
const MAX_FILTER_CHARS = 2048;
const MAX_CLAUSES = 20;
const MAX_KEY = 200;
const COLUMN = /^[A-Za-z0-9_]{1,64}$/;

export function isPagedFeature(feature) {
  return PAGED_FEATURES.includes(String(feature || '').trim());
}

/**
 * The rows a record panel lists beside a selected row (same sector for a bill, same member for a
 * question), newest first, as one filtered page of up to 200; null when the row has none.
 */
export function relatedRowsView(feature, row) {
  const value = (v) => String(v ?? '').trim();
  if (feature === PAGED_FEATURES[0] && value(row?.sector)) {
    return { pageSize: 200, sort: 'date_introduced', dir: 'desc', filter: [{ col: 'sector', value: value(row.sector) }] };
  }
  if (feature === PAGED_FEATURES[1] && value(row?.mp_name)) {
    return { pageSize: 200, sort: 'date', dir: 'desc', filter: [{ col: 'mp_name', value: value(row.mp_name) }] };
  }
  return null;
}

/** The search text as the server reads it: trimmed and lower case (search ignores case). */
export function canonicalQ(q) {
  return String(q || '').trim().toLowerCase();
}

function clauseList(filter) {
  if (!filter) return [];
  const list = Array.isArray(filter) ? filter : [filter];
  return list.filter((c) => c && typeof c === 'object' && c.col);
}

/** One chart filter, as applyVizFilter reads it: {col, value, map?, values?}, in that key order. */
function canonicalClause(c) {
  return {
    col: String(c.col),
    value: String(c.value ?? ''),
    ...(c.map ? { map: String(c.map) } : {}),
    ...(Array.isArray(c.values) && c.values.length ? { values: c.values.map(String) } : {}),
  };
}

function canonicalFilter(filter) {
  const list = clauseList(filter).map((c) => JSON.stringify(canonicalClause(c))).sort();
  return list.length ? `[${list.join(',')}]` : '';
}

function canonicalAnswer(answer) {
  const list = Array.isArray(answer) ? answer : answer == null || answer === '' ? [] : [answer];
  const wanted = new Set(list.map(String));
  return ANSWER_VALUES.filter((v) => wanted.has(v)).join(',');
}

/**
 * The query string for one page, with its parameters always in the same order and defaults left
 * out, so one view always has one URL and the edge can serve it again (spec section 7).
 */
export function pageQuery({ tier, feature, page = 1, pageSize = DEFAULT_PAGE_SIZE, q, sort, dir, filter, answer, key } = {}) {
  const p = new URLSearchParams();
  if (tier) p.set('tier', tier);
  p.set('feature', feature);
  p.set('page', String(page));
  if (Number(pageSize) !== DEFAULT_PAGE_SIZE) p.set('pageSize', String(pageSize));
  const text = canonicalQ(q);
  if (text) p.set('q', text);
  if (sort) {
    p.set('sort', sort);
    if (dir === 'desc') p.set('dir', 'desc');
  }
  const clauses = canonicalFilter(filter);
  if (clauses) p.set('filter', clauses);
  const answers = canonicalAnswer(answer);
  if (answers) p.set('answer', answers);
  if (key) p.set('key', String(key));
  return p.toString();
}

const bad = (name) => ({ ok: false, error: `Bad parameter: ${name}` });

function parseFilter(raw) {
  if (raw == null || raw === '') return [];
  if (raw.length > MAX_FILTER_CHARS) return null;
  let list;
  try {
    list = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(list) || list.length > MAX_CLAUSES) return null;
  for (const c of list) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
    if (Object.keys(c).some((k) => !['col', 'value', 'map', 'values'].includes(k))) return null;
    if (typeof c.col !== 'string' || !COLUMN.test(c.col)) return null;
    if (!['string', 'number'].includes(typeof c.value)) return null;
    if (c.map != null && (typeof c.map !== 'string' || c.map.length > 32)) return null;
    if (c.values != null && (!Array.isArray(c.values) || c.values.some((v) => !['string', 'number'].includes(typeof v)))) return null;
  }
  return list.map(canonicalClause);
}

/** Reads a page request; `{ ok: false, error }` for a bad parameter (answered 400, never cached). */
export function parsePageQuery(searchParams) {
  const pageRaw = searchParams.get('page') || '';
  const page = Number(pageRaw);
  if (!/^\d+$/.test(pageRaw) || page < 1 || page > MAX_PAGE) return bad('page');

  const sizeRaw = searchParams.get('pageSize');
  const pageSize = sizeRaw == null ? DEFAULT_PAGE_SIZE : Number(sizeRaw);
  if (!PAGE_SIZES.includes(pageSize) || (sizeRaw != null && String(pageSize) !== sizeRaw)) return bad('pageSize');

  const qRaw = String(searchParams.get('q') || '').trim();
  if (qRaw.length > MAX_Q) return bad('q');

  const sort = searchParams.get('sort') || '';
  if (sort && !COLUMN.test(sort)) return bad('sort');
  const dir = searchParams.get('dir') || 'asc';
  if (dir !== 'asc' && dir !== 'desc') return bad('dir');

  const filter = parseFilter(searchParams.get('filter'));
  if (!filter) return bad('filter');

  const answerRaw = searchParams.get('answer') || '';
  const answer = answerRaw ? answerRaw.split(',') : [];
  if (answer.some((v) => !ANSWER_VALUES.includes(v))) return bad('answer');

  const key = searchParams.get('key') || '';
  if (key.length > MAX_KEY) return bad('key');

  return { ok: true, page, pageSize, q: qRaw.toLowerCase(), sort, dir, filter, answer, key };
}
