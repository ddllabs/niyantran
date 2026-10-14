/**
 * F169 phase 4 (C3): the store writer behind POST /api/feeds/refresh (ADR 0012).
 *
 * refreshDue claims the scheduled modules that are due (public.feed_claim_due), runs each one's
 * existing loader (serveFeatureFeed) four at a time within a 55 s budget, keeps only live answers,
 * and records every claimed module with its lease token (public.feed_record). The database is
 * behind a small injectable rpc(name, args); the real one is supabaseRpc().
 *
 * While a run lasts, the loaders' requests (they call the global fetch) go through a gate scoped
 * to the run with AsyncLocalStorage: one request at a time to any one host, and a host that
 * answers 429 or 403 is closed for the rest of the run. A request made outside the run passes
 * straight through, and fetch is put back as it was when the last run ends.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, timingSafeEqual } from 'node:crypto';
import { feedRunsForDb, itemKeysFor } from './feedSchedule.mjs';
import { serveFeatureFeed } from './featureFeed.mjs';
import { cutChars, safeText, supabaseRpc } from './supabaseRpc.mjs';

// The database client lives in supabaseRpc.mjs so that the page server (feedServe.mjs) can use it without
// importing this file, which imports the loaders.
export { supabaseRpc };

/** The limits public.feed_record enforces (supabase/migrations/20261015120000_feed_records.sql). */
export const FEED_CAPS = Object.freeze({
  items: 2000,
  rowBytes: 64 * 1024,
  title: 1000,
  url: 2048,
  metaBytes: 16 * 1024,
  itemKeyBytes: 2000,
});

// The database measures a row as jsonb (pg_column_size), which can be larger than its JSON text:
// up to 1.2 times over 5,731 real rows (local run, 2026-10-15). These margins keep a batch from
// being refused for a row near the limit; a refused batch is still recorded, as failed (see
// recordModule).
const ROW_TEXT_LIMIT = 52 * 1024;
const META_TEXT_LIMIT = 12 * 1024;
// A response the gate buffers for a loader; fetchText itself refuses more than 8 MB.
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export const REFRESH_DEFAULTS = Object.freeze({
  budgetMs: 55_000,
  concurrency: 4,
  // Each module's own limit. A module starts only while this much time is left before the reserve.
  moduleMs: 20_000,
  // Kept at the end of the budget for the last feed_record calls.
  reserveMs: 5_000,
});

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const bytes = (text) => Buffer.byteLength(text);

// Postgres refuses NUL in text and jsonb, and lone surrogates in jsonb.
function cleanValue(_key, value) {
  return typeof value === 'string' ? value.replaceAll('\u0000', '').toWellFormed() : value;
}

/** A JSON-safe copy as the database will store it, or null when it cannot be serialised. */
function storable(value) {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? null : JSON.parse(text, cleanValue);
  } catch {
    return null;
  }
}

/** JSON with every object's keys sorted, so the same row always hashes the same. */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function errorText(err) {
  return safeText(err?.message || err || 'unknown error');
}

// ISO dates and dates with a month name ("Tue, 14 Oct 2026 10:00:00 GMT", "14 Oct 2026"). A
// day-first date such as 05/10/2026 is ambiguous and is not guessed.
const PARSEABLE_DATE = /^\d{4}-\d{2}(?:-\d{2})?(?:[T ]|$)|[A-Za-z]{3}/;

function publishedAt(row) {
  for (const key of ['date', 'published_at', 'published', 'pub_date']) {
    const raw = row[key];
    if (raw == null || raw === '') continue;
    const s = String(raw).trim();
    if (!PARSEABLE_DATE.test(s)) return null;
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return null;
    const year = new Date(t).getUTCFullYear();
    return year >= 1000 && year <= 9999 ? new Date(t).toISOString() : null;
  }
  return null;
}

function titleOf(row) {
  const t = [row.title, row.name, row.headline].find((v) => typeof v === 'string' && v.trim());
  return t ? cutChars(t.trim(), FEED_CAPS.title) : null;
}

function urlOf(row) {
  const u = [row.source_url, row.link, row.url, row.detail_url].find((v) => typeof v === 'string' && v.trim());
  if (!u) return null;
  const s = u.trim();
  // A link cut short would point somewhere else: one over the cap is left out.
  return /^https?:\/\//i.test(s) && s.length <= FEED_CAPS.url ? s : null;
}

/**
 * The served rows as feed_record items: status rows left out, a row over 64 KB dropped, one item
 * per key (the first kept), at most 2,000. `dropped` counts what was left out and why.
 */
export function itemsFromRows(rows) {
  const dropped = { status_rows: 0, invalid: 0, oversize: 0, duplicate: 0, over_limit: 0 };
  const items = [];
  const seen = new Set();
  const kept = [];
  for (const raw of Array.isArray(rows) ? rows : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      dropped.invalid += 1;
      continue;
    }
    if (raw.status === 'source_status') {
      dropped.status_rows += 1;
      continue;
    }
    const row = storable(raw);
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      dropped.invalid += 1;
      continue;
    }
    const text = stableJson(row);
    if (bytes(text) > ROW_TEXT_LIMIT) {
      dropped.oversize += 1;
      continue;
    }
    kept.push({ row, text });
  }
  // Keys over the whole answer: rows that share a dataset's link stay separate items.
  const keys = itemKeysFor(kept.map((k) => k.row));
  for (const [i, { row, text }] of kept.entries()) {
    let key = keys[i];
    if (bytes(key) > FEED_CAPS.itemKeyBytes) key = `k:${sha256(key)}`;
    if (seen.has(key)) {
      dropped.duplicate += 1;
      continue;
    }
    if (items.length >= FEED_CAPS.items) {
      dropped.over_limit += 1;
      continue;
    }
    seen.add(key);
    items.push({
      item_key: key,
      row,
      title: titleOf(row),
      url: urlOf(row),
      published_at: publishedAt(row),
      content_hash: sha256(text),
    });
  }
  return { items, dropped };
}

const isStatusRow = (r) => r && typeof r === 'object' && r.status === 'source_status';

/**
 * Whether a loader's answer is live (ok or empty) or must not be kept (failed). The envelope marks
 * a stored answer several ways (server/featureFeed.mjs): `fallback` when a live source failed and
 * stored rows stand in, `served: 'archive'` and kind `backup-pack` for the archive and backup
 * passes, adapter `embedded` for rows read from the bundled data, adapter `planned` for a module
 * with no source, and a `source_status` row when nothing could be shown.
 */
export function classifyAnswer(body) {
  if (!body || typeof body !== 'object') return { status: 'failed', reason: 'the loader gave no answer' };
  const source = body.source || {};
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const statusReason = rows.find(isStatusRow)?.fail_reason;
  const detail = safeText(statusReason || source.diagnostic || source.note || body.error || '', 200);
  const failed = (why) => ({ status: 'failed', reason: safeText(detail ? `${why}: ${detail}` : why) });
  if (body.ok === false) return failed('the loader could not serve this module');
  if (source.adapter === 'planned') return failed('a planned module has no live source');
  if (body.served === 'archive') return failed('the answer came from the stored archive');
  if (source.kind === 'backup-pack') return failed('the answer came from the backup pack');
  if (body.fallback) return failed('a live source failed and stored rows stood in');
  if (source.adapter === 'embedded') return failed('the answer is a stored copy, not a live one');
  const real = rows.filter((r) => !isStatusRow(r));
  if (rows.length && !real.length) return failed('the source was offline or empty');
  if (!real.length) return { status: 'empty', reason: 'the source answered with no items' };
  return { status: 'ok', reason: '' };
}

/** The answer's notes as feed_state.meta: note, links, coverage, adapter and fetched time, within 16 KB. */
export function metaFor(body, fetchedAt) {
  const source = body?.source || {};
  const coverage = body?.coverage || {};
  const meta = storable({
    note: cutChars(source.note || '', 2000),
    links: (Array.isArray(source.links) ? source.links : [])
      .filter((l) => typeof l === 'string' && /^https?:\/\//i.test(l) && l.length <= FEED_CAPS.url)
      .slice(0, 25),
    coverage: {
      from: cutChars(coverage.from || '', 100),
      through: cutChars(coverage.through || '', 100),
      exhaustive: Boolean(coverage.exhaustive),
    },
    adapter: cutChars(source.adapter || '', 100),
    kind: cutChars(source.kind || '', 100),
    fetched_at: fetchedAt,
  });
  // The envelope's own meta (heading, section, as-of) when small, so the stored module can be
  // shown as the live one is.
  const view = body?.meta && typeof body.meta === 'object' ? storable(body.meta) : null;
  if (view && bytes(JSON.stringify(view)) <= 4096) meta.view = view;
  const size = () => bytes(JSON.stringify(meta));
  while (size() > META_TEXT_LIMIT && meta.links.length) meta.links.pop();
  if (size() > META_TEXT_LIMIT) delete meta.view;
  if (size() > META_TEXT_LIMIT) meta.note = cutChars(meta.note, 500);
  return meta;
}

// ---------------------------------------------------------------------------------------------
// The fetch gate, scoped to a run.

const runScope = new AsyncLocalStorage();
let fetchHook = null;

function installFetchGate() {
  if (fetchHook) {
    fetchHook.users += 1;
    return;
  }
  const original = globalThis.fetch;
  const gated = function fetch(input, init) {
    const mod = runScope.getStore();
    return mod ? mod.gate.fetch(original, input, init, mod) : original(input, init);
  };
  fetchHook = { original, gated, users: 1 };
  globalThis.fetch = gated;
}

function uninstallFetchGate() {
  if (!fetchHook) return;
  fetchHook.users -= 1;
  if (fetchHook.users > 0) return;
  // Only our own wrapper is taken out; anything installed over it since is left alone.
  if (globalThis.fetch === fetchHook.gated) globalThis.fetch = fetchHook.original;
  fetchHook = null;
}

function requestHost(input) {
  try {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    return new URL(href).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function waitUnlessAborted(promise, signal) {
  if (signal.aborted) return Promise.reject(new Error('the module ended while waiting for its host'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('the module ended while waiting for its host'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
  });
}

// The whole body is read before the host's slot is released, so "one request at a time" covers
// the download too. The loaders read whole bodies anyway (fetchText buffers them).
async function buffered(res, host) {
  const noBody = res.body == null || [101, 204, 205, 304].includes(res.status);
  let body = null;
  if (!noBody) {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error(`${host}: response over ${MAX_RESPONSE_BYTES / 1024 / 1024} MB`);
      }
      chunks.push(value);
    }
    body = Buffer.concat(chunks);
  }
  const out = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  Object.defineProperties(out, { url: { value: res.url }, redirected: { value: res.redirected } });
  return out;
}

class RunGate {
  constructor() {
    this.tails = new Map();
    this.closed = new Map();
  }

  module() {
    return { gate: this, controller: new AbortController(), done: false, refusal: '' };
  }

  /** fn runs with the module as the fetch scope; everything it starts keeps that scope. */
  run(mod, fn) {
    return runScope.run(mod, async () => fn());
  }

  finish(mod) {
    mod.done = true;
    mod.controller.abort(new Error('the module has finished'));
  }

  refuseIfClosed(host, mod) {
    const why = this.closed.get(host);
    if (!why) return;
    if (!mod.refusal) mod.refusal = why;
    throw new Error(why);
  }

  async fetch(original, input, init, mod) {
    if (mod.done) throw new Error('the module has finished; no further requests');
    const host = requestHost(input);
    if (!host) return original(input, init);
    this.refuseIfClosed(host, mod);
    const before = this.tails.get(host) || Promise.resolve();
    let release;
    const mine = new Promise((resolve) => {
      release = resolve;
    });
    const tail = before.then(() => mine);
    this.tails.set(host, tail);
    try {
      await waitUnlessAborted(before, mod.controller.signal);
      this.refuseIfClosed(host, mod);
      const signals = [mod.controller.signal, init?.signal, input instanceof Request ? input.signal : null].filter(Boolean);
      const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
      const res = await original(input, { ...(init || {}), signal });
      if (res.status === 429 || res.status === 403) {
        const why = `${host} answered HTTP ${res.status}; closed for the rest of this run`;
        if (!this.closed.has(host)) this.closed.set(host, why);
        if (!mod.refusal) mod.refusal = why;
      }
      return await buffered(res, host);
    } finally {
      release();
      if (this.tails.get(host) === tail) this.tails.delete(host);
    }
  }
}

function settleWithin(promise, ms) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ state: 'late' }), ms);
  });
  const settled = promise.then(
    (value) => ({ state: 'done', value }),
    (error) => ({ state: 'failed', error }),
  );
  return Promise.race([settled, late]).finally(() => clearTimeout(timer));
}

const runKey = (r) => `${r.tier}\u0000${r.feature}\u0000${r.variant || ''}`;

/**
 * Refresh the modules that are due, within the budget. Returns a summary: claimed modules, counts
 * by recorded status, items sent, rows dropped, hosts closed, the time taken, and one line per
 * module. Throws only when the first claim fails (nothing was started).
 */
export async function refreshDue({
  budgetMs = REFRESH_DEFAULTS.budgetMs,
  concurrency = REFRESH_DEFAULTS.concurrency,
  moduleMs = REFRESH_DEFAULTS.moduleMs,
  reserveMs = REFRESH_DEFAULTS.reserveMs,
  rpc = supabaseRpc(),
  load = serveFeatureFeed,
  now = Date.now,
  runs = feedRunsForDb(),
  leaseSeconds,
} = {}) {
  const t0 = now();
  const workEnd = t0 + budgetMs - reserveMs;
  const slots = Math.min(100, Math.max(1, Math.floor(concurrency)));
  // The lease outlasts the whole run, so a module is never claimed twice while this run holds it.
  const lease = Math.min(3600, Math.max(10, leaseSeconds ?? Math.ceil(budgetMs / 1000) + 30));
  const paramsFor = new Map(runs.map((r) => [runKey(r), r.params || {}]));
  // The database ignores params; they stay here.
  const pRuns = runs.map(({ params: _params, ...r }) => r);
  const gate = new RunGate();
  const summary = {
    ok: true,
    claimed: 0,
    counts: {},
    items: 0,
    new_items: 0,
    dropped: { status_rows: 0, invalid: 0, oversize: 0, duplicate: 0, over_limit: 0 },
    closed_hosts: [],
    errors: [],
    ms: 0,
    modules: [],
  };

  async function recordModule(claim, payload) {
    try {
      return { answer: await rpc('feed_record', { p: payload }) };
    } catch (err) {
      if (payload.status === 'ok' && err?.code === '22023') {
        // The store refused the batch (a cap): record the run as failed so the lease is released.
        try {
          const failed = { ...payload, status: 'failed', error: safeText(`the store refused the answer: ${err.message}`) };
          delete failed.items;
          delete failed.meta;
          return { answer: await rpc('feed_record', { p: failed }), sent: 'failed' };
        } catch (again) {
          return { error: errorText(again) };
        }
      }
      return { error: errorText(err) };
    }
  }

  async function runModule(claim) {
    const started = now();
    const variant = claim.variant || '';
    const params = new URLSearchParams({ tier: claim.tier, feature: claim.feature, ...(paramsFor.get(runKey(claim)) || {}) });
    const mod = gate.module();
    const outcome = await settleWithin(gate.run(mod, () => load(params)), moduleMs);
    gate.finish(mod);
    const fetchedAt = new Date(now()).toISOString();

    let status;
    let reason = '';
    let items = [];
    let meta;
    let droppedRows = 0;
    if (outcome.state === 'late') {
      status = 'timeout';
      reason = `no answer within the module limit of ${Math.round(moduleMs / 1000)} s`;
    } else if (outcome.state === 'failed') {
      status = 'failed';
      reason = `the loader failed: ${errorText(outcome.error)}`;
    } else {
      ({ status, reason } = classifyAnswer(outcome.value));
      if (status === 'ok') {
        const built = itemsFromRows(outcome.value.rows);
        for (const [k, n] of Object.entries(built.dropped)) {
          summary.dropped[k] += n;
          droppedRows += n;
        }
        items = built.items;
        if (!items.length) {
          status = 'empty';
          reason = 'every row was left out (size limits or invalid rows)';
        } else {
          meta = metaFor(outcome.value, fetchedAt);
        }
      }
    }
    // A host this run closed explains the failure better than the loader's own words.
    if (mod.refusal && (status === 'failed' || status === 'empty')) {
      status = 'failed';
      reason = mod.refusal;
    }

    const payload = {
      tier: claim.tier,
      feature: claim.feature,
      variant,
      lease_token: claim.lease_token,
      status,
      ms: Math.max(0, Math.round(now() - started)),
      error: status === 'ok' ? null : safeText(reason),
      started_at: new Date(started).toISOString(),
      ...(status === 'ok' ? { items, meta } : {}),
    };
    const recorded = await recordModule(claim, payload);
    const recordedStatus = recorded.answer?.status || 'unrecorded';
    summary.counts[recordedStatus] = (summary.counts[recordedStatus] || 0) + 1;
    if (recorded.sent !== 'failed') summary.items += items.length;
    summary.new_items += Number(recorded.answer?.new_items) || 0;
    if (recorded.error) summary.errors.push(safeText(`record ${claim.tier}/${claim.feature}${variant ? `/${variant}` : ''}: ${recorded.error}`));
    summary.modules.push({
      tier: claim.tier,
      feature: claim.feature,
      variant,
      status: recordedStatus,
      sent: recorded.sent || status,
      ms: payload.ms,
      items: items.length,
      new_items: Number(recorded.answer?.new_items) || 0,
      ...(droppedRows ? { dropped: droppedRows } : {}),
      ...(status === 'ok' ? {} : { error: payload.error }),
    });
  }

  installFetchGate();
  try {
    const active = new Set();
    let more = true;
    for (;;) {
      const free = slots - active.size;
      if (more && free > 0 && now() + moduleMs <= workEnd) {
        let claimed;
        try {
          claimed = await rpc('feed_claim_due', { p_runs: pRuns, p_limit: free, p_lease_seconds: lease });
        } catch (err) {
          if (!summary.claimed && !active.size) throw err;
          summary.errors.push(safeText(`claim: ${errorText(err)}`));
          claimed = [];
          more = false;
        }
        claimed = Array.isArray(claimed) ? claimed : [];
        // Fewer than asked for: nothing else is due now.
        if (claimed.length < free) more = false;
        for (const claim of claimed) {
          summary.claimed += 1;
          const p = runModule(claim)
            .catch((err) => {
              summary.errors.push(safeText(`${claim.tier}/${claim.feature}: ${errorText(err)}`));
            })
            .finally(() => active.delete(p));
          active.add(p);
        }
        if (claimed.length) continue;
      }
      if (!active.size) break;
      await Promise.race(active);
    }
  } finally {
    uninstallFetchGate();
  }
  summary.closed_hosts = [...gate.closed.keys()].sort();
  summary.ms = Math.round(now() - t0);
  if (summary.errors.length) summary.ok = false;
  return summary;
}

// ---------------------------------------------------------------------------------------------
// The route.

const digest = (s) => createHash('sha256').update(String(s)).digest();

/** Timing-safe: both sides are hashed to the same length first, so neither length nor content leaks. */
export function secretMatches(given, expected) {
  if (typeof given !== 'string' || !given || !expected) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * POST /api/feeds/refresh (api/router.js). Dormant until FEED_REFRESH_SECRET is set: 503 without
 * it, 401 for a missing or wrong x-feed-refresh-secret, 405 for any method but POST. Always JSON
 * and `Cache-Control: no-store`. Neither the secret nor the database key is ever written out.
 */
export async function handleFeedRefresh(req, res, { refresh = () => refreshDue(), env = process.env, log = console } = {}) {
  const send = (status, body, headers = {}) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(JSON.stringify(body));
  };
  if (String(req.method || '').toUpperCase() !== 'POST') {
    send(405, { ok: false, error: 'POST /api/feeds/refresh only' }, { Allow: 'POST' });
    return;
  }
  const expected = String(env.FEED_REFRESH_SECRET || '').trim();
  if (!expected) {
    send(503, { ok: false, error: 'Feed refresh is not configured on this host.' });
    return;
  }
  const given = req.headers?.['x-feed-refresh-secret'];
  if (!secretMatches(typeof given === 'string' ? given.trim() : '', expected)) {
    send(401, { ok: false, error: 'Unauthorized' });
    return;
  }
  try {
    const summary = await refresh();
    log.info(`[feed-refresh] claimed ${summary.claimed}, ${JSON.stringify(summary.counts)}, ${summary.items} items, ${summary.ms} ms`);
    send(200, summary);
  } catch (err) {
    if (err?.code === 'not_configured') {
      send(503, { ok: false, error: 'The feed store is not configured on this host.' });
      return;
    }
    // Query strings are cut from the message (safeText), and the secret could never be in it, but
    // it is masked all the same.
    log.error(`[feed-refresh] failed: ${errorText(err).split(expected).join('[secret]')}`);
    send(502, { ok: false, error: 'Feed refresh failed' });
  }
}
