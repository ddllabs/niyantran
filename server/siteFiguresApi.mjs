/**
 * F142 (owner 2026-10-14): the marketing site's live figures.
 *
 *   GET /api/site-figures   public
 *     -> { bills, documents, ministries, fronts, as_of, source: 'live' | 'cached' | 'fallback' }
 *
 * The counts come from public.site_figures() (migration 20261014120000), which returns aggregate counts
 * only and is executable by the service role alone, so this calls it with the server's secret-key
 * client. Each server keeps the answer for 15 minutes ('live' means read from the database within that
 * window; the CDN may add 15 minutes more, revalidating for up to an hour). A database call that takes
 * longer than 5 seconds is abandoned. When the database cannot be read, the last good answer is served
 * ('cached'), else the measured figures ('fallback'); the failure is remembered for a minute so an
 * outage cannot flood the database, and the CDN keeps either for a minute only. A deployment without
 * the secret key (a preview) serves the fallback. Modules and source endpoints are not here: they are
 * counted from the code (src/lib/siteFigures.js).
 */
import { getSupabaseAdminClient } from './authEmailProvider.mjs';
import { MEASURED_FIGURES } from '../src/lib/measuredFigures.js';

const PATH = '/api/site-figures';
const TTL_MS = 15 * 60 * 1000;
const FAILURE_MS = 60 * 1000;
const TIMEOUT_MS = 5000;
const FIELDS = ['bills', 'documents', 'ministries', 'fronts'];

let cache = null; // { figures, at }
let failedAt = null;
let inflight = null;

export function resetSiteFiguresCache() {
  cache = null;
  failedAt = null;
  inflight = null;
}

/** The function's answer, or null unless every count is a positive whole number. */
function validFigures(data) {
  if (!data || typeof data !== 'object') return null;
  if (!FIELDS.every((k) => Number.isInteger(data[k]) && data[k] > 0)) return null;
  const figures = Object.fromEntries(FIELDS.map((k) => [k, data[k]]));
  return { ...figures, as_of: String(data.as_of || new Date().toISOString()) };
}

async function fetchFigures(adminClient, timeoutMs) {
  let timer;
  try {
    const call = Promise.resolve(adminClient().rpc('site_figures'));
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), timeoutMs); });
    const { data, error } = await Promise.race([call, timeout]);
    return error ? null : validFigures(data);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const unavailable = () => (cache ? { ...cache.figures, source: 'cached' } : { ...MEASURED_FIGURES, source: 'fallback' });

export async function readSiteFigures({ adminClient = getSupabaseAdminClient, now = Date.now, timeoutMs = TIMEOUT_MS } = {}) {
  if (cache && now() - cache.at < TTL_MS) return { ...cache.figures, source: 'live' };
  if (failedAt !== null && now() - failedAt < FAILURE_MS) return unavailable();
  inflight ??= fetchFigures(adminClient, timeoutMs).finally(() => { inflight = null; });
  const figures = await inflight;
  if (figures) {
    cache = { figures, at: now() };
    failedAt = null;
    return { ...figures, source: 'live' };
  }
  failedAt = now();
  return unavailable();
}

export async function handleSiteFiguresApi(req, res, next, deps = {}) {
  // Only the path matters; a fixed base keeps a malformed Host header from throwing.
  if (new URL(req.url || '/', 'http://localhost').pathname !== PATH) {
    next();
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ok: false, error: 'GET only' }));
    return;
  }
  const body = await readSiteFigures(deps);
  res.statusCode = 200;
  res.setHeader('Cache-Control', body.source === 'live'
    ? 'public, s-maxage=900, stale-while-revalidate=3600'
    : 'public, s-maxage=60');
  res.end(method === 'HEAD' ? undefined : JSON.stringify(body));
}

export function siteFiguresApiPlugin() {
  // Returns nothing: Vite runs a function returned from configureServer as a post hook.
  const use = (server) => {
    server.middlewares.use((req, res, next) => {
      handleSiteFiguresApi(req, res, next).catch(next);
    });
  };
  return { name: 'niyantran-site-figures-api', configureServer: use, configurePreviewServer: use };
}
