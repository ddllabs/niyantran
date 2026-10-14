#!/usr/bin/env node
/**
 * Module probe (F169 T0, docs/plans/2026-10-14-module-data-repair.md). Read-only.
 *
 * Requests /api/feature-feed for every desk module in the code's catalogue
 * (src/desks/landing/deskCatalogue.js), or for the desks and modules named, one request at a
 * time and at most one a second, with a `_probe` parameter so the edge cache is bypassed. For each
 * module it records what a reader would get: real rows (status rows excluded), `served`,
 * `fallback`, the source adapter and kind, the newest row date and the time taken.
 *
 *   npm run probe:modules -- --desk national
 *   node scripts/module-probe.mjs --host http://localhost:5173 --module "Cabinet Decisions"
 *   node scripts/module-probe.mjs --out run.json --compare docs/research/2026-10-14-module-audit/modules.json
 *
 * Options: --host <origin> (default production), --desk <name> and --module <name> (repeatable;
 * a module matches exactly, or else by substring, ignoring case), --out <file> (JSON),
 * --compare <file> (a previous run or the audit's modules.json), --json (JSON to stdout instead of
 * the table), --delay <ms> (at least 1000), --timeout <ms>.
 *
 * Record fields match the audit's modules.json, so runs compare directly: d (desk), m (module),
 * pr (rows), ps (served), pms (ms), pn (newest row date). Added here: tier, status (HTTP),
 * fallback, adapter, kind, statusRows, cache (x-vercel-cache), error.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_HOST = 'https://niyantran-six.vercel.app';
const MIN_DELAY_MS = 1000;
// The router's maxDuration is 60 s; a little over it so a slow answer is still measured.
const DEFAULT_TIMEOUT_MS = 65_000;
// Fields compared between runs. Time taken is shown but not compared: it varies on every request.
export const COMPARED_FIELDS = ['pr', 'ps', 'pn', 'fallback', 'adapter', 'kind'];

// The date fields the audit's probes read, less bare years ('year', 'enacted'): a year is not a
// date, so a module dated only by year shows no newest date here. 'net' (a launch's
// no-earlier-than date) is a schedule, not freshness.
const DATE_KEYS = [
  'date', 'record_date', 'order_date', 'published', 'published_at', 'pubDate', 'seendate', 'as_of',
  'asOf', 'updated', 'last_updated', 'last_verified', 'verified', 'dataThrough', 'date_of_judgment',
  'decision_date', 'filed', 'consultation_date', 'release_date', 'introduced_date',
  'date_of_introduction', 'occurred_at',
];
// A date this far ahead is a scheduled item or a typing error, not the data's freshness.
const FUTURE_SLACK_MS = 400 * 86_400_000;

/** Rows a reader sees: the status row the server adds when a source is empty is not one. */
export function realRows(body) {
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  return rows.filter((row) => row?.status !== 'source_status');
}

/** Newest row date as YYYY-MM-DD, or '' when no row carries a usable date. */
export function newestDate(rows, now = Date.now()) {
  let best = null;
  for (const row of rows || []) {
    for (const key of DATE_KEYS) {
      const value = row?.[key];
      if (value == null || value === '') continue;
      let text = String(value).trim();
      // GDELT's compact form: 20261014T093000Z.
      const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(text);
      if (compact) text = `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`;
      // A bare year or number is not a date.
      if (/^\d+$/.test(text)) continue;
      const t = Date.parse(text);
      if (!Number.isFinite(t) || t > now + FUTURE_SLACK_MS) continue;
      if (best == null || t > best) best = t;
    }
  }
  return best == null ? '' : new Date(best).toISOString().slice(0, 10);
}

/** One probe record from a parsed /api/feature-feed answer. */
export function summarise(body) {
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const real = realRows(body);
  return {
    pr: real.length,
    ps: body?.served ?? '',
    pn: newestDate(real),
    fallback: Boolean(body?.fallback),
    adapter: body?.source?.adapter ?? '',
    kind: body?.source?.kind ?? '',
    statusRows: rows.length - real.length,
  };
}

const lower = (s) => String(s ?? '').trim().toLowerCase();

/**
 * Catalogue entries to probe. `desks` match a desk name or tab id; `modules` match a feature or
 * title exactly, or by substring when nothing matches exactly. Unmatched names are returned too.
 */
export function selectModules(catalogue, { desks = [], modules = [] } = {}) {
  let list = catalogue;
  if (desks.length) {
    const want = new Set(desks.map(lower));
    list = list.filter((e) => want.has(lower(e.desk)) || want.has(lower(e.tab)));
  }
  const unmatched = [];
  if (modules.length) {
    const picked = new Set();
    for (const name of modules) {
      const n = lower(name);
      let hits = list.filter((e) => lower(e.feature) === n || lower(e.title) === n);
      if (!hits.length) hits = list.filter((e) => lower(e.feature).includes(n) || lower(e.title).includes(n));
      if (!hits.length) unmatched.push(name);
      for (const h of hits) picked.add(h);
    }
    list = list.filter((e) => picked.has(e));
  }
  return { list, unmatched };
}

function recordsOf(run) {
  if (Array.isArray(run)) return run;
  if (Array.isArray(run?.modules)) return run.modules;
  throw new Error('a run is an array of module records or { modules: [...] }');
}

const keyOf = (r) => `${r.d}\u0000${r.m}`;
const norm = (v) => (v == null ? '' : v);

/**
 * Differences between two runs, matched by desk and module. A field is compared only when both
 * records have it, so the audit's modules.json (no adapter or fallback) compares on rows, served
 * and newest date.
 */
export function compareRuns(baseline, current, { fields = COMPARED_FIELDS } = {}) {
  const before = new Map(recordsOf(baseline).map((r) => [keyOf(r), r]));
  const after = new Map(recordsOf(current).map((r) => [keyOf(r), r]));
  const changed = [];
  const onlyBefore = [];
  const onlyAfter = [];
  for (const [key, b] of before) {
    const a = after.get(key);
    if (!a) {
      onlyBefore.push({ d: b.d, m: b.m });
      continue;
    }
    const diffs = [];
    for (const f of fields) {
      if (!(f in b) || !(f in a)) continue;
      if (norm(b[f]) !== norm(a[f])) diffs.push({ field: f, before: norm(b[f]), after: norm(a[f]) });
    }
    if (diffs.length) changed.push({ d: a.d, m: a.m, diffs });
  }
  for (const [key, a] of after) if (!before.has(key)) onlyAfter.push({ d: a.d, m: a.m });
  return { changed, onlyBefore, onlyAfter };
}

export function formatComparison({ changed, onlyBefore, onlyAfter }, { baselineName = 'baseline' } = {}) {
  const lines = [];
  lines.push(`Compared with ${baselineName}: ${changed.length} changed, ${onlyBefore.length} only in baseline, ${onlyAfter.length} only in this run.`);
  for (const c of changed) {
    const parts = c.diffs.map((x) => `${x.field} ${JSON.stringify(x.before)} -> ${JSON.stringify(x.after)}`);
    lines.push(`  ${c.d} · ${c.m}: ${parts.join(', ')}`);
  }
  for (const r of onlyBefore) lines.push(`  only in baseline: ${r.d} · ${r.m}`);
  for (const r of onlyAfter) lines.push(`  only in this run: ${r.d} · ${r.m}`);
  return lines.join('\n');
}

export function formatTable(records) {
  const head = ['Desk', 'Module', 'HTTP', 'Rows', 'Served', 'Fallback', 'Adapter', 'Newest', 'ms'];
  const body = records.map((r) => [
    r.d,
    r.m.length > 48 ? `${r.m.slice(0, 47)}…` : r.m,
    String(r.status ?? ''),
    r.error ? 'error' : String(r.pr ?? ''),
    r.ps ?? '',
    r.fallback ? 'yes' : '',
    [r.adapter, r.kind].filter(Boolean).join('/'),
    r.pn || '',
    String(r.pms ?? ''),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return [line(head), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n');
}

export function parseArgs(argv) {
  const opts = { host: DEFAULT_HOST, desks: [], modules: [], out: '', compare: '', json: false, delay: MIN_DELAY_MS, timeout: DEFAULT_TIMEOUT_MS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v == null || v.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return v;
    };
    if (arg === '--host') opts.host = value().replace(/\/+$/, '');
    else if (arg === '--desk') opts.desks.push(value());
    else if (arg === '--module') opts.modules.push(value());
    else if (arg === '--out') opts.out = value();
    else if (arg === '--compare') opts.compare = value();
    else if (arg === '--json') opts.json = true;
    else if (arg === '--delay') opts.delay = Math.max(MIN_DELAY_MS, Number(value()) || MIN_DELAY_MS);
    else if (arg === '--timeout') opts.timeout = Number(value()) || DEFAULT_TIMEOUT_MS;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown option ${arg}`);
  }
  return opts;
}

/** The desk catalogue as the app builds it. Its modules import JSON the Vite way, so plain Node needs a hook. */
async function loadCatalogue() {
  registerHooks({
    load(url, context, next) {
      if (url.endsWith('.json')) return next(url, { ...context, importAttributes: { type: 'json' } });
      return next(url, context);
    },
  });
  const file = resolve(fileURLToPath(import.meta.url), '../../src/desks/landing/deskCatalogue.js');
  const { DESK_CATALOGUE } = await import(pathToFileURL(file).href);
  return DESK_CATALOGUE;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probeOne(entry, n, { host, timeout }) {
  const q = new URLSearchParams({ tier: entry.tier, feature: entry.feature, _probe: `${Date.now()}-${n}` });
  const url = `${host}/api/feature-feed?${q}`;
  const rec = { d: entry.desk, m: entry.feature, tier: entry.tier };
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { accept: 'application/json' } });
    const text = await res.text();
    rec.pms = Date.now() - started;
    rec.status = res.status;
    rec.cache = res.headers.get('x-vercel-cache') || '';
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      rec.error = `not JSON: ${text.slice(0, 80)}`;
      return rec;
    }
    Object.assign(rec, summarise(body));
    if (!res.ok || body?.ok === false) rec.error = String(body?.error || `HTTP ${res.status}`);
  } catch (err) {
    rec.pms = Date.now() - started;
    rec.error = String(err?.message || err);
  }
  return rec;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    return;
  }
  const catalogue = await loadCatalogue();
  const { list, unmatched } = selectModules(catalogue, opts);
  if (unmatched.length) throw new Error(`no module matches: ${unmatched.join('; ')}`);
  if (!list.length) throw new Error('no modules selected');

  const startedAt = new Date().toISOString();
  const records = [];
  let last = 0;
  for (const [i, entry] of list.entries()) {
    const wait = last + opts.delay - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const rec = await probeOne(entry, i + 1, opts);
    records.push(rec);
    if (!opts.json) {
      process.stderr.write(`${i + 1}/${list.length} ${rec.d} · ${rec.m}: ${rec.error ? `error (${rec.error})` : `${rec.pr} rows, ${rec.ps}`}${rec.kind ? `, ${rec.kind}` : ''}, ${rec.pms} ms\n`);
    }
  }
  const run = { host: opts.host, startedAt, finishedAt: new Date().toISOString(), modules: records };

  if (opts.out) writeFileSync(opts.out, `${JSON.stringify(run, null, 1)}\n`);
  if (opts.json) console.log(JSON.stringify(run, null, 1));
  else console.log(formatTable(records));
  if (opts.compare) {
    const baseline = JSON.parse(readFileSync(opts.compare, 'utf8'));
    let base = recordsOf(baseline);
    // A partial run is compared only with the same modules in the baseline.
    if (opts.desks.length || opts.modules.length) {
      const keys = new Set(records.map(keyOf));
      base = base.filter((r) => keys.has(keyOf(r)));
    }
    const out = formatComparison(compareRuns(base, records), { baselineName: opts.compare });
    (opts.json ? console.error : console.log)(`\n${out}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`module-probe: ${err?.message || err}`);
    process.exit(1);
  });
}
