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
 *
 * Served from the store (Task B follow-up, 2026-10-16), for every module of kind news, official, events
 * or measurement: the stored page (its first 500 items, as feed_page answers the page server) is passed
 * through the store-serving code itself (server/feedServe.mjs serveFromStore, with the module's row rules
 * from server/feedRows.mjs), locally, on a copy with `serve` simulated on, and compared with the live
 * answer: rows served against live, the rows each side lacks, served rows that fail the module's current
 * rules when applied again (filterFailures, 0 expected), live rows the rules would drop (liveDropped: the
 * live branch and the store's rules have drifted apart, 0 expected), and for a measurement or events
 * module served rows from before its latest run (notLatestRun, 0 expected). Nothing is written.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPLACING_KINDS, itemKeysFor, scheduledRuns } from '../server/feedSchedule.mjs';
import { LATEST_RUN_MARGIN_MS, STORE_PAGE_ROWS, liveAnswerIsUsable, serveFromStore, storeMaxAgeMinutes } from '../server/feedServe.mjs';
import { servesLatestRunOnly, storeRowsFor } from '../server/feedRows.mjs';
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

/** The kinds whose stored page is passed through the store-serving code (compareServed). */
export const SERVED_KINDS = Object.freeze(new Set(['news', 'official', 'events', 'measurement']));
/** The modules whose top ten titles, served and live, the report lists. */
export const SAMPLE_MODULES = Object.freeze([
  'state:State Governance Brief',
  'local:Municipal Watch',
  'state:Assembly Proceedings Digest (Vernacular, Translated)',
  'finance:Prediction Market Political Odds',
]);
const TOP = 10;

/**
 * The stored page as the page server would serve it if `serve` were on: server/feedServe.mjs
 * serveFromStore on a local copy of the stored items (serve set to true), each feed_page call answered
 * with the page it asks for (its offset and limit, STORE_PAGE_ROWS by default: the first page, or more
 * when the store path reads a variant whole), kept even past its freshness limit (allowStale, as the
 * route keeps it). null: the live path answers.
 */
export async function servedFromStore(run, stored, { now = Date.now() } = {}) {
  if (!isRow(stored)) return null;
  const all = Array.isArray(stored.items) ? stored.items : [];
  const pageAt = (args = {}) => {
    const offset = Math.max(0, Number(args.p_offset) || 0);
    const limit = Math.min(STORE_PAGE_ROWS, Math.max(1, Number(args.p_limit) || STORE_PAGE_ROWS));
    return { ...stored, serve: true, items: all.slice(offset, offset + limit) };
  };
  const params = new URLSearchParams({ tier: run.tier, feature: run.feature, ...(run.params || {}) });
  return serveFromStore(`${run.tier}:${run.feature}`, params, { rpc: async (_name, args) => pageAt(args), now: () => now, allowStale: true });
}

/** One module's served rows against its live rows (see the header). `served` is servedFromStore's answer. */
export function compareServed({ run, stored, served, live, now = Date.now() }) {
  const id = `${run.tier}:${run.feature}`;
  const kind = stored?.kind || run.kind;
  const rows = (Array.isArray(served?.rows) ? served.rows : []).filter(isRow);
  const liveReal = realRows(live);
  const byLink = !REPLACING_KINDS.has(kind);
  const keysOf = (list) => itemKeysFor(list, kind);
  const index = (list) => {
    const keys = new Set(keysOf(list));
    const links = new Set(byLink ? list.map(linkOf).filter(Boolean) : []);
    return (r, key) => keys.has(key) || Boolean(byLink && linkOf(r) && links.has(linkOf(r)));
  };
  const inLive = index(liveReal);
  const inServed = index(rows);
  const servedKeys = keysOf(rows);
  const liveKeys = keysOf(liveReal);
  const opts = { now, variant: run.variant || '' };
  // Applied again to the rows as they are stored (a curated rule writes a day-only date over the stored
  // one, so a served row is judged by its stored date, as the store path judged it): to the whole served
  // list (one row per story) and to each row alone (guards, windows).
  const storedByLink = new Map((stored?.items || []).filter((i) => isRow(i?.row) && linkOf(i.row)).map((i) => [linkOf(i.row), i.row]));
  const asStored = rows.map((r) => storedByLink.get(linkOf(r)) || r);
  const againLinks = new Set(storeRowsFor(id, asStored, opts).map(linkOf));
  const failing = asStored.filter((r) => (linkOf(r) && !againLinks.has(linkOf(r))) || !storeRowsFor(id, [r], opts).length).length;
  const kept = new Set(keysOf(storeRowsFor(id, liveReal, opts)));
  let notLatestRun = 0;
  if (servesLatestRunOnly(id, kind)) {
    const runAt = Date.parse(String(stored?.fetched_at || ''));
    const seenAt = new Map((stored?.items || []).filter((i) => isRow(i?.row)).map((i) => [i.row, Date.parse(String(i.last_seen || ''))]));
    notLatestRun = rows.filter((r) => {
      const t = seenAt.get(r);
      return Number.isFinite(t) && Number.isFinite(runAt) && t < runAt - LATEST_RUN_MARGIN_MS;
    }).length;
  }
  const title = (r) => String(r.title || r.name || r.question || '').replace(/\s+/g, ' ').trim();
  return {
    servedRows: rows.length,
    liveRows: liveReal.length,
    storeOnly: rows.filter((r, i) => !inLive(r, servedKeys[i])).length,
    liveOnly: liveReal.filter((r, i) => !inServed(r, liveKeys[i])).length,
    filterFailures: failing,
    liveDropped: liveReal.filter((_r, i) => !kept.has(liveKeys[i])).length,
    notLatestRun,
    servedTop: rows.slice(0, TOP).map(title),
    liveTop: liveReal.slice(0, TOP).map(title),
    servedNote: [
      served ? (served.stale ? `stale copy (${served.ageMinutes} min old)` : '') : 'nothing to serve: the live path answers',
      live?.served === 'store' ? 'the live answer is the deployed store copy (serve on), not a live one' : '',
    ].filter(Boolean).join('; '),
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
    if (stored && SERVED_KINDS.has(stored.kind || run.kind)) {
      const at = now();
      row.served = compareServed({ run, stored, served: await servedFromStore(run, stored, { now: at }), live, now: at });
    }
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
    ...renderServed(rows),
  ];
  return lines.join('\n');
}

/** The served section: the stored page through the store-serving code against live, and the samples. */
function renderServed(rows) {
  const served = rows.filter((r) => r.served);
  if (!served.length) return [];
  const samples = served.filter((r) => SAMPLE_MODULES.includes(r.id));
  const list = (titles) => (titles.length ? titles.map((t, i) => `${i + 1}. ${cell(t)}`) : ['(none)']);
  return [
    '## Served from the store (the stored page through the store-serving code, serve simulated on) against live',
    '',
    'Store only / live only: rows one side shows and the other does not. Filter failures: served rows the module\'s rules drop when applied again. Live dropped: live rows the store\'s rules would drop (drift). Not latest run: served rows of a measurement or events module from before its latest run.',
    '',
    '| Module | Variant | Kind | Served | Live | Store only | Live only | Filter failures | Live dropped | Not latest run | Note |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...served.map((r) => {
      const s = r.served;
      return `| ${[r.id, r.variant, r.kind, s.servedRows, s.liveRows, s.storeOnly, s.liveOnly, s.filterFailures, s.liveDropped, s.notLatestRun, s.servedNote].map(cell).join(' | ')} |`;
    }),
    '',
    ...samples.flatMap((r) => [
      `### ${r.id}${r.variant ? ` / ${r.variant}` : ''}: top ${TOP}`,
      '',
      `Store (${r.served.servedRows} served):`,
      '',
      ...list(r.served.servedTop),
      '',
      `Live (${r.served.liveRows}):`,
      '',
      ...list(r.served.liveTop),
      '',
    ]),
  ];
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
