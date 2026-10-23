/**
 * F156 (spec docs/specs/2026-10-14-paged-module-lists.md, section 4): one page of a large module's
 * table. The server runs the browser's own src/lib functions over the whole register in the browser's
 * order (prepare, search, chart filter, answer filter, sort), so a page is the same slice the browser
 * would have shown, and sends that slice with the register's columns, filter menu and overview.
 * Pure: the module is loaded by the caller's `load`, as for a whole answer.
 */
import { prepareDeskFeed } from '../src/lib/prepareDeskFeed.js';
import { filterRows, sortRows } from '../src/lib/normalise.js';
import { buildTableSearchIndex, searchTableRows, shouldIndexSearch } from '../src/lib/tableSearch.js';
import { applyVizFilter } from '../src/lib/nationalKpi.js';
import { matchesChoice } from '../src/lib/choiceFilter.js';
import { feedColumns } from '../src/lib/columns.js';
import { feedOverview, tableFilterGroups } from '../src/lib/analytics.js';
import { deskRowKey } from '../src/lib/deskRows.js';
import { isPagedFeature, parsePageQuery } from '../src/lib/pagedFeatures.js';

import { serveLawListingPage } from './lawListingPage.mjs';

const MAX_LINKS = 20;
// Recent searches, filters and sort orders kept per register, so a page change costs a slice.
const RESULTS_KEPT = 16;

/** A request is paged only with `page` and only for a module on the paged list. */
export function wantsPage(searchParams) {
  return searchParams.has('page') && isPagedFeature(searchParams.get('feature'));
}

function hasRealRows(body) {
  const rows = body?.rows;
  return Array.isArray(rows) && rows.length > 0 && rows[0]?.status !== 'source_status';
}

// Per server instance: the loaded rows array (the feed keeps one while its file is unchanged), then
// the rest of the answer, since the same rows can come back as a live or an archive answer.
const registers = new WeakMap();

function registerFor(body) {
  let byEnvelope = registers.get(body.rows);
  if (!byEnvelope) {
    byEnvelope = new Map();
    registers.set(body.rows, byEnvelope);
  }
  const envelopeKey = JSON.stringify({ ...body, rows: undefined });
  let reg = byEnvelope.get(envelopeKey);
  if (!reg) {
    const feed = prepareDeskFeed(body);
    const rows = Array.isArray(feed.rows) ? feed.rows : [];
    reg = {
      feed,
      rows,
      columns: feedColumns(feed.feature, rows),
      filterGroups: tableFilterGroups(feed),
      overview: feedOverview(feed),
      index: shouldIndexSearch(rows.length) ? buildTableSearchIndex(rows) : null,
      byKey: null,
      results: new Map(),
    };
    byEnvelope.set(envelopeKey, reg);
  }
  return reg;
}

function rowsWithKey(reg, key) {
  if (!reg.byKey) {
    reg.byKey = new Map();
    for (const row of reg.rows) {
      if (!row || typeof row !== 'object' || row.status === 'source_status') continue;
      const k = deskRowKey(row);
      if (!reg.byKey.has(k)) reg.byKey.set(k, []);
      reg.byKey.get(k).push(row);
    }
  }
  return reg.byKey.get(key) || [];
}

// DeskView's pipeline (src/desks/DeskView.jsx), step for step.
function matching(reg, opts) {
  const cacheKey = JSON.stringify([opts.key, opts.q, opts.filter, opts.answer, opts.sort, opts.dir]);
  const kept = reg.results.get(cacheKey);
  if (kept) {
    reg.results.delete(cacheKey);
    reg.results.set(cacheKey, kept);
    return kept;
  }
  const base = opts.key ? rowsWithKey(reg, opts.key) : reg.rows;
  let rows = shouldIndexSearch(base.length)
    ? searchTableRows(base, base === reg.rows ? reg.index : null, opts.q)
    : filterRows(base, opts.q);
  rows = rows.filter((r) => applyVizFilter(r, opts.filter));
  if (opts.answer.length) rows = rows.filter((r) => matchesChoice(opts.answer, r.has_answer_key || 'unknown'));
  rows = sortRows(rows, opts.sort || undefined, opts.dir);
  reg.results.set(cacheKey, rows);
  if (reg.results.size > RESULTS_KEPT) reg.results.delete(reg.results.keys().next().value);
  return rows;
}

/**
 * Answers a page request: `{ status: 400, body }` for a bad parameter; the module's ordinary answer
 * when it has no rows (the browser then falls back as it does today); otherwise one page.
 */
export async function serveFeaturePage(searchParams, load, options) {
  const canonical = await serveLawListingPage(searchParams, options);
  if (canonical) return canonical;
  const opts = parsePageQuery(searchParams);
  if (!opts.ok) return { status: 400, body: { ok: false, error: opts.error } };
  const moduleParams = new URLSearchParams();
  if (searchParams.get('tier')) moduleParams.set('tier', searchParams.get('tier'));
  moduleParams.set('feature', searchParams.get('feature'));
  const body = await load(moduleParams);
  if (!hasRealRows(body)) return { status: 200, body };

  const reg = registerFor(body);
  if (opts.sort && !reg.columns.some((c) => c.key === opts.sort)) {
    return { status: 400, body: { ok: false, error: 'Bad parameter: sort' } };
  }
  const rows = matching(reg, opts);
  const start = (opts.page - 1) * opts.pageSize;
  const { rows: _whole, ...envelope } = reg.feed;
  return {
    status: 200,
    body: {
      ...envelope,
      source: { ...(envelope.source || {}), links: (envelope.source?.links || []).slice(0, MAX_LINKS) },
      paged: true,
      prepared: true,
      rows: rows.slice(start, start + opts.pageSize),
      page: opts.page,
      pageSize: opts.pageSize,
      total: rows.length,
      totalAll: reg.rows.length,
      columns: reg.columns,
      filterGroups: reg.filterGroups,
      overview: reg.overview,
    },
  };
}
