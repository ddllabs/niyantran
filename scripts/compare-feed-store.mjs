#!/usr/bin/env node
/**
 * Compare each scheduled module's stored copy (the feed store, ADR 0012) with its live answer, read-only
 * (Task B of docs/plans/2026-10-16-leftover-phases.md). The report decides, class by class, where
 * `feed_state.serve` can be switched on.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co node --env-file=.env.local scripts/compare-feed-store.mjs
 *   … scripts/compare-feed-store.mjs --module "Music Charts" --json tmp/feed-compare.json
 *
 * For every run of server/feedSchedule.mjs scheduledRuns() (each Statement Tracker leader is its own
 * variant), one at a time with a pause between modules:
 *  - the stored copy: public.feed_page (every stored item up to 2,000, 500 at a time, newest first) and its
 *    feed_runs rows (the last 24 hours), read through the Supabase REST endpoint with SUPABASE_SECRET_KEY;
 *  - the live answer: GET <live base>/api/feature-feed for the module, with a cache-busting parameter.
 *
 * It only reads. The database client (readOnlyClient) sends GET requests only (PostgREST runs a GET
 * call of a stable function in a read-only transaction), only to feed_page and feed_page_across and to
 * the feed_state and feed_runs tables, and refuses anything else before a request is made. The only
 * files it writes are the local reports asked for with --json and --md.
 *
 * Options: --module <schedule id or part of a feature name> (any case), --delay <ms between modules,
 * default 500>, --live-base <site, default https://niyantran-six.vercel.app>, --json <file>, --md <file>.
 * The database URL is SUPABASE_URL, else VITE_SUPABASE_URL.
 *
 * Verdict per module:
 *  - store empty: no state, or no stored items;
 *  - store worse: with a live answer that has live rows, the stored copy is past its freshness limit
 *    (server/feedServe.mjs storeMaxAgeMinutes), or live lists items dated more than a day after the newest
 *    stored one, or the store holds far fewer rows than live shows (under 90% for a replacing list,
 *    under half for a kept one), or the page the store would serve (its first 500) holds under half of
 *    the live items (of 10 or more);
 *  - store equal-or-better: anything else, including every module whose live answer had no live rows
 *    (empty, a status row, a fallback, the archive, an error), which the store would serve in its place.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPLACING_KINDS, itemKeysFor, scheduledRuns } from '../server/feedSchedule.mjs';
import { liveAnswerIsUsable, storeMaxAgeMinutes } from '../server/feedServe.mjs';
import { safeText } from '../server/supabaseRpc.mjs';

export const READ_RPCS = Object.freeze(new Set(['feed_page', 'feed_page_across']));
export const READ_TABLES = Object.freeze(new Set(['feed_state', 'feed_runs']));
export const DEFAULT_LIVE_BASE = 'https://niyantran-six.vercel.app';
export const VERDICTS = Object.freeze(['store equal-or-better', 'store worse', 'store empty']);
const DAY_MS = 86_400_000;
/** feed_page's largest page, and the page a reader is served (server/feedServe.mjs STORE_PAGE_ROWS). */
export const PAGE_ROWS = 500;
/** At most this many stored items are read for the overlap (feed_record's 2,000-item record). */
export const MAX_STORED_READ = 2000;

/**
 * The database, read-only: rpc(name, args) for READ_RPCS and select(table, query) for READ_TABLES, both
 * as GET requests with the arguments in the query string. Anything else throws before any request.
 */
export function readOnlyClient({ url, key, fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = 20_000 }) {
  const base = String(url || '').replace(/\/+$/, '');
  async function get(path, query) {
    if (!base || !key) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SECRET_KEY are required');
    const qs = new URLSearchParams(Object.entries(query || {}).map(([k, v]) => [k, String(v ?? '')]));
    const res = await fetchImpl(`${base}/rest/v1/${path}?${qs}`, {
      method: 'GET',
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) throw new Error(`${path}: ${safeText(data?.message || `HTTP ${res.status}`, 200, [key])}`);
    return data;
  }
  return {
    async rpc(name, args) {
      if (!READ_RPCS.has(name)) throw new Error(`read-only: the function ${name} is not one this script may call`);
      return get(`rpc/${encodeURIComponent(name)}`, args);
    },
    async select(table, query) {
      if (!READ_TABLES.has(table)) throw new Error(`read-only: the table ${table} is not one this script may read`);
      return get(encodeURIComponent(table), query);
    },
  };
}

const isRow = (r) => Boolean(r) && typeof r === 'object' && !Array.isArray(r);
const realRows = (body) => (Array.isArray(body?.rows) ? body.rows : []).filter((r) => isRow(r) && r.status !== 'source_status');
const DATE_KEYS = ['date', 'published_at', 'published', 'pub_date', 'pubDate'];

function dayOf(value) {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  // Day-first dates (05/10/2026) are ambiguous and are not guessed, as server/feedStore.mjs publishedAt.
  if (!/^\d{4}-\d{2}(?:-\d{2})?(?:[T ]|$)|[A-Za-z]{3}/.test(s)) return '';
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
}

function rowDay(row) {
  for (const k of DATE_KEYS) {
    const d = dayOf(row?.[k]);
    if (d) return d;
  }
  return '';
}

const newest = (days) => days.filter(Boolean).sort().pop() || '';

function linkOf(row) {
  const u = [row?.source_url, row?.link, row?.url, row?.detail_url].find((v) => typeof v === 'string' && v.trim());
  return u ? u.trim().replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '').toLowerCase() : '';
}

const minutesSince = (iso, now) => {
  const t = Date.parse(String(iso || ''));
  return Number.isFinite(t) ? Math.round((now - t) / 60_000) : null;
};

/**
 * One module's comparison. `run` is a scheduledRuns() entry, `stored` the feed_page answer (null: no
 * state), `live` the /api/feature-feed body (null: the request failed), `lastRun` its newest feed_runs
 * row and `runs24h` the last day's statuses.
 */
export function compareModule({ run, stored, live, liveError = '', lastRun = null, runs24h = [], now = Date.now() }) {
  const id = `${run.tier}:${run.feature}`;
  const kind = stored?.kind || run.kind;
  const items = Array.isArray(stored?.items) ? stored.items.filter((i) => isRow(i?.row)) : [];
  const total = Number.isFinite(Number(stored?.total)) ? Number(stored.total) : items.length;
  // A replacing list's rows share their dataset's link, so only keys say which row is which.
  const byLink = !REPLACING_KINDS.has(kind);
  const liveReal = realRows(live);
  const liveKeys = itemKeysFor(liveReal, kind);
  const holds = (list) => {
    const keys = new Set(list.map((i) => i.item_key));
    const links = new Set(byLink ? list.map((i) => linkOf(i.row)).filter(Boolean) : []);
    return liveReal.map((r, i) => keys.has(liveKeys[i]) || Boolean(byLink && linkOf(r) && links.has(linkOf(r))));
  };
  const storedNewest = newest(items.map((i) => dayOf(i.published_at) || rowDay(i.row)));
  const inStore = holds(items);
  const overlap = inStore.filter(Boolean).length;
  // What a reader would be served: the first page, newest first.
  const servedOverlap = holds(items.slice(0, PAGE_ROWS)).filter(Boolean).length;
  const liveNewest = newest(liveReal.map(rowDay));
  const ageMin = minutesSince(stored?.fetched_at, now);
  const limitMin = storeMaxAgeMinutes(stored?.interval_minutes ?? run.every);
  const usable = liveAnswerIsUsable(live);
  const counts = {};
  for (const r of runs24h) counts[r.status] = (counts[r.status] || 0) + 1;

  const reasons = [];
  let verdict;
  if (live?.served === 'store') reasons.push('the live endpoint answered served from the store (serve is on), so this is not a live comparison');
  if (!stored || total <= 0) {
    verdict = 'store empty';
    reasons.push(stored ? 'no stored items' : 'no feed_state row for this module');
  } else if (!usable) {
    verdict = 'store equal-or-better';
    const why = !live
      ? `the live request failed${liveError ? ` (${liveError})` : ''}`
      : live.served === 'archive' ? 'the live answer came from the archive'
        : live.fallback ? 'the live answer was stored rows standing in for a failed source'
          : live.source?.kind === 'backup-pack' ? 'the live answer came from the backup pack'
            : !liveReal.length ? 'the live answer had no rows' : 'the live answer was not a live one';
    reasons.push(why);
    if (ageMin != null && ageMin > limitMin) reasons.push(`the stored copy is ${ageMin} min old, past its ${limitMin} min limit`);
  } else {
    if (ageMin == null || ageMin > limitMin) {
      reasons.push(ageMin == null ? 'the stored copy has no fetched time' : `the stored copy is ${ageMin} min old, past its ${limitMin} min limit`);
    }
    const newer = liveReal.filter((r, i) => {
      if (inStore[i]) return false;
      const d = rowDay(r);
      return d && (!storedNewest || Date.parse(d) - Date.parse(storedNewest) > DAY_MS);
    }).length;
    if (newer) reasons.push(`${newer} live item${newer === 1 ? '' : 's'} not stored and dated more than a day newer than the newest stored (${storedNewest || 'none dated'})`);
    const share = REPLACING_KINDS.has(kind) ? 0.9 : 0.5;
    if (total < share * liveReal.length) reasons.push(`${total} stored against ${liveReal.length} live`);
    // The page the store would serve shows other items than live does (unstable keys, or a source that
    // answers a different sample each run): for a person to look at before serving is switched on.
    if (liveReal.length >= 10 && servedOverlap < 0.5 * liveReal.length) {
      reasons.push(`the served page (the first ${Math.min(PAGE_ROWS, items.length)} stored) holds ${servedOverlap} of the ${liveReal.length} live items (${overlap} of them stored at all)`);
    }
    verdict = reasons.some((r) => !/served from the store/.test(r)) ? 'store worse' : 'store equal-or-better';
  }

  return {
    id,
    variant: run.variant || '',
    class: run.cls,
    kind,
    serve: stored?.serve === true,
    storedRows: total,
    storedRead: items.length,
    liveRows: liveReal.length,
    storedNewest,
    liveNewest,
    overlap,
    servedOverlap,
    liveServed: live?.served || (live ? '' : 'error'),
    liveFallback: Boolean(live?.fallback),
    storedAgeMin: ageMin,
    freshLimitMin: limitMin,
    failures: Number(stored?.consecutive_failures) || 0,
    lastError: stored?.last_error || '',
    lastRunStatus: lastRun?.status || '',
    lastRunAgeMin: minutesSince(lastRun?.started_at, now),
    lastRunMs: lastRun?.ms ?? null,
    lastRunError: lastRun?.error || '',
    runs24h: counts,
    verdict,
    reasons,
  };
}

/** The runs named by --module: a schedule id (tier:feature) or part of a feature name, any case. */
export function selectRuns(runs, filter) {
  const f = String(filter || '').trim().toLowerCase();
  if (!f) return runs;
  return runs.filter((r) => `${r.tier}:${r.feature}`.toLowerCase() === f || r.feature.toLowerCase().includes(f));
}

export function parseArgs(argv) {
  const out = { module: '', delayMs: 500, liveBase: DEFAULT_LIVE_BASE, json: '', md: '', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v == null || v.startsWith('--')) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--module') out.module = next();
    else if (a === '--delay') out.delayMs = Math.max(0, Number(next()) || 0);
    else if (a === '--live-base') out.liveBase = next().replace(/\/+$/, '');
    else if (a === '--json') out.json = next();
    else if (a === '--md') out.md = next();
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchLive(run, { liveBase, fetchImpl, now, timeoutMs = 30_000 }) {
  const qs = new URLSearchParams({ tier: run.tier, feature: run.feature, ...(run.params || {}), _cb: String(now()) });
  try {
    const res = await fetchImpl(`${liveBase}/api/feature-feed?${qs}`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'NiyantranFeedCompare/1.0 (read-only)' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) return { live: null, liveError: `HTTP ${res.status}` };
    return { live: JSON.parse(text), liveError: '' };
  } catch (err) {
    return { live: null, liveError: safeText(err?.message || err, 120) };
  }
}

/** Every run, one after another: the stored copy, its runs, then the live answer. */
export async function compareAll({
  runs = scheduledRuns(),
  url,
  key,
  fetchImpl = (...a) => globalThis.fetch(...a),
  liveBase = DEFAULT_LIVE_BASE,
  delayMs = 500,
  now = Date.now,
  log = () => {},
}) {
  const db = readOnlyClient({ url, key, fetchImpl });
  const rows = [];
  for (const [n, run] of runs.entries()) {
    const variant = run.variant || '';
    let stored = null;
    let storeError = '';
    try {
      const ask = (offset) => db.rpc('feed_page', { p_tier: run.tier, p_feature: run.feature, p_variant: variant, p_limit: PAGE_ROWS, p_offset: offset });
      stored = await ask(0);
      // The rest of the stored items, one page at a time, so the overlap is against everything kept.
      const total = Number(stored?.total) || 0;
      for (let offset = PAGE_ROWS; stored && offset < Math.min(total, MAX_STORED_READ); offset += PAGE_ROWS) {
        const next = await ask(offset);
        stored.items = [...(stored.items || []), ...(Array.isArray(next?.items) ? next.items : [])];
      }
    } catch (err) {
      storeError = safeText(err?.message || err, 160, [key]);
    }
    let recent = [];
    try {
      const since = new Date(now() - DAY_MS).toISOString();
      recent = await db.select('feed_runs', {
        select: 'status,started_at,ms,items,new_items,error',
        tier: `eq.${run.tier}`,
        feature: `eq.${run.feature}`,
        variant: `eq.${variant}`,
        started_at: `gte.${since}`,
        order: 'started_at.desc',
        limit: 300,
      });
    } catch (err) {
      storeError ||= safeText(err?.message || err, 160, [key]);
    }
    const { live, liveError } = await fetchLive(run, { liveBase, fetchImpl, now });
    const row = compareModule({ run, stored, live, liveError, lastRun: Array.isArray(recent) ? recent[0] : null, runs24h: Array.isArray(recent) ? recent : [], now: now() });
    if (storeError) row.reasons.push(`store read failed: ${storeError}`);
    rows.push(row);
    log(`${n + 1}/${runs.length} ${row.id}${variant ? ` / ${variant}` : ''}: ${row.verdict}`);
    if (delayMs && n < runs.length - 1) await sleep(delayMs);
  }
  return { generatedAt: new Date(now()).toISOString(), liveBase, rows, summary: summarise(rows) };
}

export function summarise(rows) {
  const byVerdict = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  const byClass = {};
  for (const r of rows) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
    byClass[r.class] ||= {};
    byClass[r.class][r.verdict] = (byClass[r.class][r.verdict] || 0) + 1;
  }
  return { modules: rows.length, byVerdict, byClass, worse: rows.filter((r) => r.verdict === 'store worse') };
}

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|');

export function renderMarkdown(rows, summary = summarise(rows), { generatedAt = new Date().toISOString(), liveBase = DEFAULT_LIVE_BASE } = {}) {
  const lines = [
    `# Feed store against live (${generatedAt})`,
    '',
    `Read-only. Stored copy: public.feed_page and feed_runs. Live: ${liveBase}/api/feature-feed. ${summary.modules} module runs.`,
    '',
    '## By verdict',
    '',
    '| Verdict | Modules |',
    '|---|---|',
    ...VERDICTS.map((v) => `| ${v} | ${summary.byVerdict[v] || 0} |`),
    '',
    '## By class',
    '',
    '| Class | Equal or better | Worse | Empty |',
    '|---|---|---|---|',
    ...Object.keys(summary.byClass).sort().map((c) => {
      const k = summary.byClass[c];
      return `| ${c} | ${k['store equal-or-better'] || 0} | ${k['store worse'] || 0} | ${k['store empty'] || 0} |`;
    }),
    '',
    '## Where the store is worse',
    '',
    ...(summary.worse.length
      ? summary.worse.map((r) => `- ${cell(r.id)}${r.variant ? ` / ${cell(r.variant)}` : ''}: ${cell(r.reasons.join('; '))}`)
      : ['None.']),
    '',
    '## Modules',
    '',
    'Overlap: live items found among the stored ones (by item key, or by link for a kept kind); served: among the first 500, the page a reader gets.',
    '',
    '| Module | Variant | Class | Stored | Live | Newest stored | Newest live | Overlap (served) | Live served | Stored age (min) | Last run | Run age (min) | 24 h runs | Serve | Verdict | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => [
      r.id, r.variant, r.class, r.storedRows, r.liveRows, r.storedNewest, r.liveNewest, `${r.overlap}/${r.liveRows} (${r.servedOverlap})`,
      `${r.liveServed}${r.liveFallback ? ' (fallback)' : ''}`, r.storedAgeMin ?? '', r.lastRunStatus, r.lastRunAgeMin ?? '',
      Object.entries(r.runs24h || {}).map(([s, n]) => `${s} ${n}`).join(', '), r.serve ? 'on' : 'off', r.verdict, r.reasons.join('; '),
    ].map(cell).join(' | ')).map((l) => `| ${l} |`),
    '',
  ];
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write('node scripts/compare-feed-store.mjs [--module <name>] [--delay <ms>] [--live-base <url>] [--json <file>] [--md <file>]\n');
    return 0;
  }
  const runs = selectRuns(scheduledRuns(), opts.module);
  if (!runs.length) throw new Error(`no scheduled module matches "${opts.module}"`);
  const report = await compareAll({
    runs,
    url: env.SUPABASE_URL || env.VITE_SUPABASE_URL,
    key: env.SUPABASE_SECRET_KEY,
    liveBase: opts.liveBase,
    delayMs: opts.delayMs,
    log: (line) => process.stderr.write(`${line}\n`),
  });
  const md = renderMarkdown(report.rows, report.summary, report);
  if (opts.json) writeFileSync(resolve(opts.json), `${JSON.stringify(report, null, 2)}\n`);
  if (opts.md) writeFileSync(resolve(opts.md), md);
  process.stdout.write(md);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`compare-feed-store: ${err?.message || err}\n`);
      process.exit(1);
    },
  );
}
