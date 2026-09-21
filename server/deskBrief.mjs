/**
 * Gemini entry brief — organise ONE selected table row (not the whole desk).
 * Cached in SQLite (primary) + disk (secondary); regenerates only when the
 * row fingerprint changes or force=true.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getEntryBrief, upsertEntryBrief } from './db.mjs';
import { loadEnv } from './loadEnv.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = process.env.VERCEL
  ? path.join('/tmp', 'desk-briefs')
  : path.join(__dirname, '..', 'tmp', 'desk-briefs');
const CACHE_VER = 'v7-entry';
const MODEL =
  process.env.GEMINI_DESK_MODEL ||
  'gemini-3.5-flash-lite';
const CHAT_MS = 90_000;
const SAMPLE_ROWS = 40;
const MAX_CELL = 220;

/** Process-lifetime L1 so repeat GETs in the same Node process skip I/O. */
const memCache = new Map();

function memKey(scope, tier, feature, hash) {
  return `${scope || 'entry'}|${tier || ''}|${feature || ''}|${hash || ''}`;
}

const SYSTEM = `You are the Niyantran Terminal record analyst.
The analyst selected ONE row in a desk tab. Organise and explain THAT entry's fields only.
Do not summarise the whole desk, feed volume, or other rows.
Chart numbers are computed on the server from this row — you write narrative and may rename chart titles.

Hard rules:
- Never buy / sell / hold / accumulate / avoid language. No price targets or predicted moves.
- Never use the word "correlation". Prefer connections, linkages, pathways, what this touches.
- Evidence first: base every claim on the attached row fields. If a field is missing, say so.
- Confidence only as labelled bands: strong / moderate / weak / speculative.
- Market cap is market data — do not use it as materiality.
- Do not invent chart series. Do not talk about "25 stories" or desk-wide totals.
- Prefer summary bullets shaped as "Label: detail" (Facility:, Status:, Source:, etc.).
- Return ONLY valid JSON matching the schema. No markdown fences.`;

function ensureCacheDir() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch {
    /* Vercel /tmp or read-only — skip disk cache */
  }
}

export function feedFingerprint(rows, feature, tier) {
  const list = Array.isArray(rows) ? rows : [];
  const slim = list.slice(0, 200).map((r) => {
    if (!r || typeof r !== 'object') return '';
    const title = r.title || r.record_title || r.name || r.case_title || '';
    const date = r.date || r.record_date || r.published_at || '';
    const id = r.record_id || r.id || r.source_url || '';
    return `${date}|${title}|${id}`;
  });
  const raw = `${CACHE_VER}::${tier || ''}::${feature || ''}::${list.length}::${slim.join('\n')}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

/** Stable hash for one selected row — cache key for entry briefs. */
export function entryFingerprint(row, feature, tier) {
  const r = row && typeof row === 'object' ? row : {};
  const parts = Object.keys(r)
    .filter((k) => !/^__|backup_/i.test(k))
    .sort()
    .map((k) => `${k}=${cell(r[k])}`);
  const id = r.record_id || r.id || r.source_url || r.title || '';
  const raw = `${CACHE_VER}::entry::${tier || ''}::${feature || ''}::${id}::${parts.join('|')}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

function cachePath(tier, feature, hash, scope = 'entry') {
  const slug = String(feature || 'desk')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  const t = String(tier || 'x')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  const sc = scope === 'feed' ? 'feed' : scope === 'substance' ? 'substance' : 'entry';
  return path.join(CACHE_DIR, `${CACHE_VER}__${sc}__${t}__${slug}__${hash}.json`);
}

function readCache(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(file, payload) {
  try {
    ensureCacheDir();
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  } catch {
    /* ephemeral hosts may not persist — brief still returns */
  }
}

function cell(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, ' ').trim().slice(0, MAX_CELL);
}

function sampleRows(rows) {
  const list = (rows || []).filter((r) => r && r.status !== 'source_status');
  const take = list.slice(0, SAMPLE_ROWS);
  const keys = new Set();
  for (const r of take) {
    Object.keys(r)
      .filter((k) => !/^__|backup_/i.test(k))
      .slice(0, 24)
      .forEach((k) => keys.add(k));
  }
  const cols = [...keys].slice(0, 18);
  return take.map((r) => {
    const o = {};
    for (const k of cols) o[k] = cell(r[k]);
    return o;
  });
}

const SKIP_COLS = new Set([
  'title',
  'record_title',
  'record_id',
  'source_url',
  'publisher_url',
  'url',
  'link',
  'detail',
  'summary',
  'query',
  'provenance',
  'coverage_scope',
  'coverage_status',
  'quality_status',
  'reporting_search',
  'pdf_url',
  'html_url',
]);

function dateKeyOf(row) {
  for (const k of [
    'date',
    'record_date',
    'published_at',
    'order_date',
    'source_published_at',
    'filed_on',
    'hearing_date',
    'decision_date',
    'updated_at',
    'started',
  ]) {
    const raw = cell(row?.[k]);
    if (!raw) continue;
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})/) || raw.match(/^(\d{4}-\d{2})/);
    if (m) return m[1].length === 7 ? `${m[1]}-01` : m[1];
    // Excel serial day (backup packs sometimes leave these in)
    if (/^\d{4,5}(\.\d+)?$/.test(raw)) {
      const serial = Number(raw);
      if (serial > 20000 && serial < 80000) {
        const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
        return new Date(ms).toISOString().slice(0, 10);
      }
    }
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() > 1990) return d.toISOString().slice(0, 10);
  }
  return '';
}

function colStats(rows) {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0] || {}).filter(
    (k) => !SKIP_COLS.has(k) && !/^__|backup_|source_/i.test(k) && !/url|id$/i.test(k),
  );
  const out = [];
  for (const k of keys) {
    const counts = new Map();
    let nonempty = 0;
    for (const r of rows) {
      const v = cell(r[k]);
      if (!v || v.length > 48) continue;
      nonempty += 1;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    const distinct = counts.size;
    if (nonempty < 3 || distinct < 2 || distinct > Math.min(40, Math.ceil(rows.length * 0.85))) continue;
    const preferred = /publisher|outlet|source|category|status|sector|state|court|party|region|country|type|sport|league|ministry|band|stage|house|intensity|trend/i.test(
      k,
    )
      ? 10
      : 0;
    out.push({
      key: k,
      distinct,
      nonempty,
      score: preferred + (distinct >= 2 && distinct <= 14 ? 8 : distinct <= 24 ? 4 : 0),
      counts,
    });
  }
  return out.sort((a, b) => b.score - a.score || b.nonempty - a.nonempty);
}

function itemsFromCounts(counts, limit = 10) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([label, value]) => ({ label: String(label).slice(0, 40), value, tone: 'gradient' }));
}

function buildHeatMatrix(rows, rowKey, colKey) {
  const rowCounts = new Map();
  const colCounts = new Map();
  const cellMap = new Map();
  for (const r of rows) {
    const rk = cell(r[rowKey]).slice(0, 28);
    const ck = cell(r[colKey]).slice(0, 28);
    if (!rk || !ck) continue;
    rowCounts.set(rk, (rowCounts.get(rk) || 0) + 1);
    colCounts.set(ck, (colCounts.get(ck) || 0) + 1);
    const k = `${rk}||${ck}`;
    cellMap.set(k, (cellMap.get(k) || 0) + 1);
  }
  const rowsTop = [...rowCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([l]) => l);
  const colsTop = [...colCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l]) => l);
  if (rowsTop.length < 2 || colsTop.length < 2) return null;
  const matrixRows = rowsTop.map((label) => {
    const cells = colsTop.map((c) => cellMap.get(`${label}||${c}`) || 0);
    return { label, cells, total: cells.reduce((a, b) => a + b, 0) };
  });
  const colTotals = colsTop.map((_, i) => matrixRows.reduce((a, r) => a + r.cells[i], 0));
  const colMax = colsTop.map((_, i) => Math.max(1, ...matrixRows.map((r) => r.cells[i])));
  const grand = colTotals.reduce((a, b) => a + b, 0);
  return {
    cols: colsTop,
    rows: matrixRows,
    colTotals,
    colMax,
    grand,
    sequential: true,
  };
}

/** Deterministic multi-type charts from this desk's rows. */
export function buildLocalCharts(rows, feature) {
  const list = (rows || []).filter((r) => r && r.status !== 'source_status');
  if (!list.length) return [];
  const charts = [];
  const feat = String(feature || '').slice(0, 36);
  const stats = colStats(list);
  const usedFields = new Set();

  // 1) Donut — share of best low-cardinality field
  const shareCol = stats.find((c) => c.distinct >= 2 && c.distinct <= 8) || stats[0];
  if (shareCol) {
    const items = itemsFromCounts(shareCol.counts, 8);
    if (items.length >= 2) {
      charts.push({
        type: 'donut',
        title: `${feat}: ${shareCol.key.replace(/_/g, ' ')} share`.slice(0, 60),
        hint: `Share of rows by ${shareCol.key.replace(/_/g, ' ')}.`,
        field: shareCol.key,
        items,
      });
      usedFields.add(shareCol.key);
    }
  }

  // 2) Spark — timeline whenever ≥2 dates resolve
  const byDate = new Map();
  for (const r of list) {
    const d = dateKeyOf(r);
    if (!d) continue;
    byDate.set(d, (byDate.get(d) || 0) + 1);
  }
  if (byDate.size >= 2) {
    const series = [...byDate.entries()]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .slice(-45)
      .map(([t, n]) => ({ t, n, date: t }));
    const peak = series.reduce((a, b) => (b.n > a.n ? b : a), series[0]);
    if (peak.n > 0) {
      charts.push({
        type: 'spark',
        title: `${feat}: activity over time`.slice(0, 60),
        hint: 'Row counts by date in this desk.',
        series,
        peak,
        from: series[0].t,
        through: series[series.length - 1].t,
      });
    }
  }

  // 3) Vertical columns — prefer a second field; else reuse share field as columns (different shape)
  const colForColumns =
    stats.find((c) => c.key !== shareCol?.key && c.distinct >= 2 && c.distinct <= 12) ||
    stats.find((c) => c.key !== shareCol?.key) ||
    shareCol;
  if (colForColumns) {
    const items = itemsFromCounts(colForColumns.counts, 8);
    if (items.length >= 2) {
      charts.push({
        type: 'columns',
        title: `${feat}: by ${colForColumns.key.replace(/_/g, ' ')}`.slice(0, 60),
        hint: `Counts by ${colForColumns.key.replace(/_/g, ' ')}.`,
        field: colForColumns.key,
        items,
      });
      usedFields.add(colForColumns.key);
    }
  }

  // 4) Heatmap when two categoricals exist
  if (stats.length >= 2) {
    const matrix = buildHeatMatrix(list, stats[0].key, stats[1].key);
    if (matrix) {
      charts.push({
        type: 'matrix',
        title: `${feat}: ${stats[0].key.replace(/_/g, ' ')} × ${stats[1].key.replace(/_/g, ' ')}`.slice(0, 60),
        hint: 'Cross-tab of the two densest fields in this desk.',
        matrix,
      });
    }
  }

  // 5) Horizontal bars ONLY for real numeric rankings — and only if we still have room / variety
  const varietyCount = charts.filter((c) => c.type !== 'bars').length;
  const numKey = Object.keys(list[0] || {}).find((k) =>
    /metric_value|amount|gdp|pct|percent|score|total(?!$)/i.test(k),
  );
  const labelKey =
    Object.keys(list[0] || {}).find((k) =>
      /primary_entity|name|country|indicator|league|person|entity|title/i.test(k),
    ) || 'title';
  if (numKey && varietyCount < 4) {
    const scored = [];
    for (const r of list) {
      const label = cell(r[labelKey] || r.title);
      const n = Number(String(r[numKey] ?? '').replace(/,/g, ''));
      if (!label || !Number.isFinite(n) || n === 0) continue;
      scored.push({ label: label.slice(0, 40), value: n, tone: 'gradient' });
    }
    scored.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const top = scored.slice(0, 8);
    if (top.length >= 3) {
      charts.push({
        type: 'bars',
        title: `${feat}: top ${numKey.replace(/_/g, ' ')}`.slice(0, 60),
        hint: `Largest ${numKey.replace(/_/g, ' ')} values.`,
        field: numKey,
        items: top,
      });
    }
  } else if (varietyCount < 2 && stats.length) {
    // Sparse desk: one leftover category as columns (not another horizontal bar)
    const leftover = stats.find((c) => !usedFields.has(c.key));
    if (leftover && !charts.some((c) => c.type === 'columns')) {
      const items = itemsFromCounts(leftover.counts, 8);
      if (items.length >= 2) {
        charts.push({
          type: 'columns',
          title: `${feat}: by ${leftover.key.replace(/_/g, ' ')}`.slice(0, 60),
          hint: `Counts by ${leftover.key.replace(/_/g, ' ')}.`,
          field: leftover.key,
          items,
        });
      }
    }
  }

  // Prefer variety: donut, spark, columns, matrix, bars — keep up to 4, at most one of each type
  const order = ['donut', 'spark', 'columns', 'matrix', 'bars'];
  charts.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const seen = new Set();
  const unique = [];
  for (const c of charts) {
    if (seen.has(c.type)) continue;
    seen.add(c.type);
    unique.push(c);
  }

  // Never ship bars-only: promote the bar items to donut + columns
  if (unique.length === 1 && unique[0].type === 'bars' && unique[0].items?.length >= 2) {
    const items = unique[0].items;
    return [
      {
        type: 'donut',
        title: unique[0].title.replace(/^[^:]+:/, `${feat}:`).slice(0, 60) || `${feat}: share`,
        hint: unique[0].hint || 'Share of ranked values.',
        items,
      },
      {
        type: 'columns',
        title: `${feat}: ranked values`.slice(0, 60),
        hint: 'Same ranking as vertical columns.',
        items,
      },
    ];
  }

  return unique.slice(0, 4);
}

const ENTRY_SKIP = new Set([
  'status',
  'adapter',
  'fail_reason',
  'host',
  'detail',
  'reporting_search',
  'sources_json',
  'lat',
  'lon',
  'id',
  'brief',
  'why_it_matters',
  'watch_for',
  'tags',
  'sizeBand',
  '_blocRaw',
  '_otherRaw',
  'related_links',
]);

/** Charts for a single selected row — pie + vertical columns from THIS row's values. */
export function buildEntryCharts(row, feature) {
  const r = row && typeof row === 'object' ? row : {};
  const feat = String(feature || 'Entry').slice(0, 36);
  const fields = Object.entries(r).filter(
    ([k, v]) =>
      !ENTRY_SKIP.has(k) &&
      !/^__|backup_|source_\d|url$/i.test(k) &&
      !/url|link|href/i.test(k) &&
      v != null &&
      String(v).trim() !== '',
  );
  if (!fields.length) return [];

  const charts = [];
  const measures = extractMeasures(fields);
  const cats = extractCategories(fields);
  const tokens = extractTitleTokens(
    r.title || r.record_title || r.name || r.conflict_name || r.facility || '',
  );

  // 1) Pie — prefer numeric measures unique to this entry; else category mix; else title themes
  if (measures.length >= 2) {
    charts.push({
      type: 'pie',
      title: `${feat}: key figures`.slice(0, 60),
      hint: 'Numeric figures found on this entry.',
      items: measures.slice(0, 6).map((m) => ({
        label: m.label,
        value: m.value,
        display: m.display,
        tone: 'gradient',
      })),
    });
  } else if (cats.length >= 2) {
    charts.push({
      type: 'pie',
      title: `${feat}: attributes`.slice(0, 60),
      hint: 'Category fields on this entry (equal weight per attribute).',
      items: cats.slice(0, 6).map((c) => ({
        label: `${c.label}: ${c.value}`.slice(0, 36),
        value: Math.max(1, c.weight),
        tone: 'gradient',
      })),
    });
  } else if (tokens.length >= 2) {
    charts.push({
      type: 'pie',
      title: `${feat}: headline themes`.slice(0, 60),
      hint: 'Theme words from this entry’s title.',
      items: tokens.slice(0, 6),
    });
  }

  // 2) Vertical columns — different series when possible
  if (measures.length >= 2) {
    charts.push({
      type: 'columns',
      title: `${feat}: figures compared`.slice(0, 60),
      hint: 'Same key figures as vertical bars.',
      items: measures.slice(0, 8).map((m) => ({
        label: m.label,
        value: m.value,
        display: m.display,
        tone: 'gradient',
      })),
    });
  } else if (cats.length >= 2) {
    // Content weight (text length) — differs per entry
    charts.push({
      type: 'columns',
      title: `${feat}: detail depth`.slice(0, 60),
      hint: 'How much text each attribute carries on this entry.',
      items: cats.slice(0, 8).map((c) => ({
        label: c.label.slice(0, 28),
        value: c.weight,
        display: String(c.weight),
        tone: 'gradient',
      })),
    });
  } else if (tokens.length >= 2) {
    charts.push({
      type: 'columns',
      title: `${feat}: theme weight`.slice(0, 60),
      hint: 'Theme word emphasis in the title.',
      items: tokens.slice(0, 8),
    });
  }

  // Ensure we always try to ship pie + columns when anything usable exists
  const order = ['pie', 'donut', 'columns', 'spark', 'bars'];
  charts.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const seen = new Set();
  const unique = [];
  for (const c of charts) {
    if (seen.has(c.type)) continue;
    seen.add(c.type);
    unique.push(c);
  }
  return unique.slice(0, 2);
}

function prettyField(k) {
  return String(k || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 28);
}

function extractMeasures(fields) {
  const out = [];
  const seen = new Set();
  for (const [k, v] of fields) {
    if (/date|published|filed|updated|started|as_of|time|year|month/i.test(k)) continue;
    const text = cell(v);
    if (!text || text.length > 80) continue;
    if (/^https?:/i.test(text)) continue;
    // Skip bare ISO / calendar strings
    if (/^\d{4}-\d{2}(-\d{2})?/.test(text) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(text)) continue;

    const full = Number(String(text).replace(/,/g, '').replace(/[^\d.\-]/g, ''));
    if (
      Number.isFinite(full) &&
      full !== 0 &&
      /^[\d,.\s\-]+[a-zA-Z%]*$/.test(text.replace(/\s/g, ' ').trim())
    ) {
      const label = prettyField(k);
      if (!seen.has(label)) {
        seen.add(label);
        out.push({ label, value: Math.abs(full), display: text.slice(0, 16) });
      }
      continue;
    }

    const re = /(\d+(?:\.\d+)?)\s*(GWe|GW|MWe|MW|kV|%|units?|reactors?|tonnes?|tons?|km|mt)?/gi;
    let m;
    let hits = 0;
    while ((m = re.exec(text)) && hits < 2) {
      const n = Number(m[1]);
      if (!Number.isFinite(n) || n === 0) continue;
      // Ignore year-like numbers without a unit
      if (!m[2] && n >= 1900 && n <= 2100) continue;
      if (!m[2] && n <= 31 && /status|stage|type|category/i.test(k)) continue;
      const unit = m[2] || '';
      const label = (unit ? `${prettyField(k)} (${unit})` : prettyField(k)).slice(0, 28);
      const key = `${label}:${n}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        label,
        value: Math.abs(n),
        display: `${m[1]}${unit ? ` ${unit}` : ''}`.slice(0, 16),
      });
      hits += 1;
    }
  }
  out.sort((a, b) => b.value - a.value);
  return out;
}

function extractCategories(fields) {
  const out = [];
  for (const [k, v] of fields) {
    const text = cell(v);
    if (!text || text.length > 48) continue;
    if (/^https?:/i.test(text)) continue;
    if (/title|headline|summary|detail|notes|description/i.test(k)) continue;
    if (/^\d+(\.\d+)?$/.test(text)) continue;
    out.push({
      label: prettyField(k),
      value: text.slice(0, 32),
      weight: Math.min(48, Math.max(3, text.length)),
    });
  }
  return out.slice(0, 8);
}

function extractTitleTokens(title) {
  const stop = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'that',
    'this',
    'into',
    'over',
    'under',
    'after',
    'before',
    'about',
    'says',
    'said',
    'has',
    'have',
    'been',
    'were',
    'will',
    'near',
    'amid',
  ]);
  const counts = new Map();
  for (const w of String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !stop.has(t))) {
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 6)
    .map(([label, value]) => ({
      label: label.replace(/\b\w/g, (c) => c.toUpperCase()),
      value,
      tone: 'gradient',
    }));
}

function slimEntry(row) {
  const o = {};
  let n = 0;
  for (const [k, v] of Object.entries(row || {})) {
    if (/^__|backup_/i.test(k)) continue;
    o[k] = cell(v);
    n += 1;
    if (n >= 40) break;
  }
  return o;
}

function parseJsonLoose(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Model did not return JSON');
  return JSON.parse(body.slice(start, end + 1));
}

function sanitizeModelCharts(rawCharts) {
  // Fallback only — prefer buildLocalCharts. Accept all viz types the UI can draw.
  const charts = [];
  for (const c of Array.isArray(rawCharts) ? rawCharts.slice(0, 4) : []) {
    const type = String(c.type || '').toLowerCase();
    const title = cell(c.title);
    if (/sample topic mentions|feed volume by date/i.test(title)) continue;
    if ((type === 'bars' || type === 'columns' || type === 'donut' || type === 'pie') && Array.isArray(c.items) && c.items.length) {
      const items = c.items
        .slice(0, 12)
        .map((it) => ({
          label: cell(it.label).slice(0, 40) || '—',
          value: Number(it.value) || 0,
          display: it.display != null ? cell(it.display) : undefined,
          tone: it.tone || 'gradient',
        }))
        .filter((it) => it.value > 0);
      if (items.length >= 2) {
        charts.push({
          type: type === 'bars' ? 'bars' : type === 'donut' ? 'pie' : type,
          title: title.slice(0, 60) || 'Breakdown',
          hint: cell(c.hint).slice(0, 120),
          items,
        });
      }
    } else if (type === 'spark' && Array.isArray(c.series) && c.series.length) {
      const series = c.series.slice(0, 60).map((p) => {
        const n = Number(p.n ?? p.v ?? p.value) || 0;
        const t = cell(p.t || p.date || p.label).slice(0, 16);
        return { t, n, date: t };
      });
      const peak = series.reduce((a, b) => (b.n > (a?.n || 0) ? b : a), series[0]);
      if (peak?.n > 0 && series.some((p) => p.n > 0)) {
        charts.push({
          type: 'spark',
          title: title.slice(0, 60) || 'Timeline',
          hint: cell(c.hint).slice(0, 120),
          series,
          peak,
          from: cell(c.from) || series[0].t,
          through: cell(c.through) || series[series.length - 1].t,
        });
      }
    } else if (type === 'matrix' && c.matrix?.rows?.length) {
      charts.push({
        type: 'matrix',
        title: title.slice(0, 60) || 'Cross-tab',
        hint: cell(c.hint).slice(0, 120),
        matrix: c.matrix,
      });
    }
  }
  return charts;
}

function normalizeBrief(raw, meta, localCharts) {
  const kpis = Array.isArray(raw.kpis)
    ? raw.kpis.slice(0, 4).map((k) => ({
        label: cell(k.label).slice(0, 40) || 'KPI',
        value: cell(k.value).slice(0, 48) || '—',
        sub: cell(k.sub).slice(0, 80),
        tone: ['ok', 'warn', 'bad', ''].includes(k.tone) ? k.tone : '',
      }))
    : [];

  // Prefer server-built charts so each desk differs; model titles can rename matching slots.
  let charts = Array.isArray(localCharts) && localCharts.length ? localCharts : sanitizeModelCharts(raw.charts);
  const titled = Array.isArray(raw.chartTitles) ? raw.chartTitles : [];
  if (titled.length && charts.length) {
    charts = charts.map((c, i) => ({
      ...c,
      title: cell(titled[i] || c.title).slice(0, 60) || c.title,
    }));
  }

  return {
    ok: true,
    cached: Boolean(meta.cached),
    hash: meta.hash,
    model: meta.model || '',
    generatedAt: meta.generatedAt || new Date().toISOString(),
    feature: meta.feature,
    tier: meta.tier,
    rowCount: meta.rowCount,
    headline: cell(raw.headline).slice(0, 160) || meta.feature,
    summary: (Array.isArray(raw.summary) ? raw.summary : [])
      .map((s) => cell(s))
      .filter(Boolean)
      .slice(0, 6),
    findings: (Array.isArray(raw.findings) ? raw.findings : [])
      .slice(0, 5)
      .map((f) => ({
        title: cell(f.title).slice(0, 80),
        detail: cell(f.detail).slice(0, 280),
        band: /strong|moderate|weak|speculative/i.test(f.band || '')
          ? String(f.band).toLowerCase()
          : 'moderate',
      })),
    kpis,
    charts,
    caveats: (Array.isArray(raw.caveats) ? raw.caveats : [])
      .map((s) => cell(s))
      .filter(Boolean)
      .slice(0, 4),
  };
}

async function callGemini({ key, model, prompt }) {
  const tried = [
    model,
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-flash-latest',
    'gemini-2.0-flash',
  ];
  let last = '';
  for (const m of [...new Set(tried)]) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), CHAT_MS);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(key)}`;
    try {
      const r = await fetch(url, {
        method: 'POST',
        signal: ac.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.25,
            responseMimeType: 'application/json',
          },
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        last = body?.error?.message || `Gemini HTTP ${r.status}`;
        continue;
      }
      const text = (body?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('\n');
      if (!text.trim()) {
        last = 'Empty Gemini response';
        continue;
      }
      return { text, model: m };
    } catch (err) {
      last = err.message || String(err);
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error(last || 'Gemini request failed');
}

/**
 * Organise one selected row. Pass `row` (preferred) or a single-element `rows`.
 * @param {{ feature: string, tier?: string, row?: object, rows?: object[], hash?: string, force?: boolean, sourceNote?: string, sourceExtract?: string, scope?: 'entry'|'substance' }} input
 */
export async function runDeskBrief(input = {}) {
  loadEnv();
  const feature = String(input.feature || '').trim();
  const tier = String(input.tier || '').trim();
  if (!feature) throw new Error('feature required');

  const row =
    input.row && typeof input.row === 'object'
      ? input.row
      : (Array.isArray(input.rows) ? input.rows : []).find((r) => r && r.status !== 'source_status');
  if (!row || row.status === 'source_status') throw new Error('Select a row to organise');

  const scope = String(input.scope || 'entry') === 'substance' ? 'substance' : 'entry';
  const hash = String(input.hash || entryFingerprint(row, feature, tier));
  const file = cachePath(tier, feature, hash, scope);
  if (!input.force) {
    const hit = await getCachedDeskBrief(feature, tier, hash, scope);
    if (hit?.headline || hit?.summary?.length) {
      return { ...hit, cached: true, hash, generatedAt: hit.generatedAt };
    }
  } else {
    memCache.delete(memKey(scope, tier, feature, hash));
  }

  const key = String(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NIYANTRAN_AI_KEY || '',
  ).trim();
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY missing on the server. Add it to niyantran-react/.env (never in the browser).',
    );
  }

  const entry = slimEntry(row);
  const localCharts = scope === 'substance' ? [] : buildEntryCharts(row, feature);
  const chartSketch = localCharts.map((c) => ({
    type: c.type,
    title: c.title,
    field: c.field || '',
    itemCount: c.items?.length || c.series?.length || 0,
    topLabels: (c.items || []).slice(0, 5).map((i) => i.label),
  }));
  const title =
    entry.bill_name ||
    entry.policy_name ||
    entry.title ||
    entry.record_title ||
    entry.name ||
    entry.subject ||
    entry.case_title ||
    entry.conflict_name ||
    'Untitled entry';

  const sourceBody = String(input.sourceExtract || '').replace(/\s+/g, ' ').trim().slice(0, 12_000);
  const nounHint = /bill|act|amendment/i.test(feature) || entry.bill_name
    ? 'bill / Act'
    : /question/i.test(feature)
      ? 'parliamentary question'
      : /regulator|circular|notice/i.test(feature)
        ? 'regulatory notice'
        : /policy/i.test(feature)
          ? 'policy'
          : 'record';

  const prompt =
    scope === 'substance'
      ? `You write the "What this ${nounHint} does" panel for Niyantran Terminal.
Title: ${title}
Desk: ${tier || '—'} / ${feature}

Row fields (context only — do NOT turn these into the summary):
${JSON.stringify(entry)}

${
  sourceBody
    ? `Source document text (PRIMARY evidence — base the summary on this):\n${sourceBody}`
    : 'No source document text was extracted. Infer only what the title and fields clearly state; say if substance is thin.'
}

Return ONLY valid JSON:
{
  "headline": "one plain sentence: what this ${nounHint} is about",
  "summary": [
    "Purpose: …",
    "What it changes / provides: …",
    "Who / what it covers: …",
    "optional Mechanism: …",
    "optional Why it exists: …"
  ],
  "findings": [],
  "kpis": [],
  "chartTitles": [],
  "caveats": ["optional limits of the source text"]
}

Hard rules:
- Summary must explain SUBSTANCE (what the law/notice/policy is about), not registry metadata.
- FORBIDDEN labels in summary: Facility, Status, Source, Source and Verification, Bill Category, House, Sector, Ministry, Stage, Date, Verification, Adapter.
- Prefer Purpose / What it changes / Scope / Mechanism / Context.
- 3–5 short bullets. Plain English. No buy/sell/hold language. Never say "correlation".
- Do not paste raw PDF preamble, Act number lines, or "WHEREAS" blocks.
- Evidence first from the source text; if the extract is thin, say so in caveats — do not invent clauses.`
      : `Desk tab: ${tier || '—'} / ${feature}
Selected entry only (do NOT summarise other feed rows):
Title: ${title}
Source note: ${String(input.sourceNote || '').slice(0, 400)}
Entry fingerprint: ${hash}

Full field map for THIS entry:
${JSON.stringify(entry)}
${sourceBody ? `\nReadable text extracted from the source document / page for THIS entry (prefer this over thin row fields when they conflict):\n${sourceBody}\n` : ''}
Charts already computed from THIS entry's fields (do not invent other series):
${JSON.stringify(chartSketch)}

Produce JSON with this exact shape:
{
  "headline": "one short line naming what THIS entry is about",
  "summary": ["Facility: …", "Status: …", "Source: …", "3-6 Label: detail bullets for THIS entry only"],
  "findings": [{"title":"...","detail":"...","band":"strong|moderate|weak|speculative"}],
  "kpis": [{"label":"...","value":"...","sub":"...","tone":"ok|warn|bad|"}],
  "chartTitles": ["optional better title for chart 0", "optional for chart 1"],
  "caveats": ["missing fields or limits of this single record"]
}

Rules for this response:
- Organise the selected entry only. Never quote feed totals or other headlines.
- When source document text is present, write a short substance brief of what the document / notice does — not a field dump.
- Every summary bullet MUST start with a short Label then a colon (e.g. "Facility:", "Status:", "Source and Verification:").
- KPIs must come from fields on this row (source, date, verification, category, capacity, etc.).
- Do NOT include a "charts" array with invented numbers.
- chartTitles length should match the computed charts when you rename them.`;

  const got = await callGemini({ key, model: MODEL, prompt });
  const parsed = parseJsonLoose(got.text);
  const brief = normalizeBrief(
    parsed,
    {
      cached: false,
      hash,
      model: got.model,
      generatedAt: new Date().toISOString(),
      feature,
      tier,
      rowCount: 1,
    },
    localCharts,
  );
  brief.scope = scope;
  brief.entryTitle = String(title).slice(0, 160);

  const envelope = { hash, generatedAt: brief.generatedAt, model: got.model, brief };
  writeCache(file, envelope);
  memCache.set(memKey(scope, tier, feature, hash), { ...brief, cached: true, hash });
  try {
    await upsertEntryBrief({
      scope,
      tier,
      feature,
      hash,
      brief,
      model: got.model,
      generatedAt: brief.generatedAt,
    });
  } catch {
    /* DB write failure must not block the response — file + mem still hold it */
  }
  return brief;
}

/**
 * Lookup order: memory → SQLite → disk file.
 * Disk hits are back-filled into SQLite so the next cold start still skips Gemini.
 */
export async function getCachedDeskBrief(feature, tier, hash, scope = 'entry') {
  if (!feature || !hash) return null;
  const sc = scope === 'substance' ? 'substance' : 'entry';
  const mk = memKey(sc, tier, feature, hash);
  if (memCache.has(mk)) {
    return { ...memCache.get(mk), cached: true, hash };
  }

  try {
    const fromDb = await getEntryBrief(sc, tier, feature, hash);
    if (fromDb?.brief) {
      const out = {
        ...fromDb.brief,
        cached: true,
        hash,
        generatedAt: fromDb.generatedAt || fromDb.brief.generatedAt,
        model: fromDb.model || fromDb.brief.model || '',
      };
      memCache.set(mk, out);
      return out;
    }
  } catch {
    /* sql.js unavailable — fall through to file */
  }

  const hit = readCache(cachePath(tier, feature, hash, sc));
  if (!hit?.brief) return null;
  const out = {
    ...hit.brief,
    cached: true,
    hash,
    generatedAt: hit.generatedAt || hit.brief.generatedAt,
    model: hit.model || hit.brief.model || '',
  };
  memCache.set(mk, out);
  try {
    await upsertEntryBrief({
      scope: sc,
      tier,
      feature,
      hash,
      brief: hit.brief,
      model: out.model,
      generatedAt: out.generatedAt,
    });
  } catch {
    /* backfill best-effort */
  }
  return out;
}
