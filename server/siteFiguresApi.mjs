/**
 * F142 (owner 2026-10-14): the marketing site's live figures.
 *
 *   GET /api/site-figures   public
 *     -> { bills, documents, ministries, fronts, as_of, source: 'live' | 'cached' | 'fallback' }
 *
 * The counts come from public.site_figures() (migration 20261014120000), which returns aggregate counts
 * only and is executable by the service role alone, so this calls it with the server's secret-key
 * client. Each server keeps the answer for 15 minutes, and the CDN may serve it for as long. When the
 * database cannot be read, the last good answer is served ('cached'), else the measured figures
 * ('fallback'), and the CDN keeps either for a minute only. Modules and source endpoints are not here:
 * they are counted from the code (src/lib/siteFigures.js).
 */
import { getSupabaseAdminClient } from './authEmailProvider.mjs';
import { MEASURED_FIGURES } from '../src/lib/measuredFigures.js';

const PATH = '/api/site-figures';
const TTL_MS = 15 * 60 * 1000;
const FIELDS = ['bills', 'documents', 'ministries', 'fronts'];

let cache = null; // { figures, at }
let inflight = null;

export function resetSiteFiguresCache() {
  cache = null;
  inflight = null;
}

/** The function's answer, or null unless every count is a positive whole number. */
function validFigures(data) {
  if (!data || typeof data !== 'object') return null;
  if (!FIELDS.every((k) => Number.isInteger(data[k]) && data[k] > 0)) return null;
  const figures = Object.fromEntries(FIELDS.map((k) => [k, data[k]]));
  return { ...figures, as_of: String(data.as_of || new Date().toISOString()) };
}

async function fetchFigures(adminClient) {
  try {
    const { data, error } = await adminClient().rpc('site_figures');
    return error ? null : validFigures(data);
  } catch {
    return null;
  }
}

export async function readSiteFigures({ adminClient = getSupabaseAdminClient, now = Date.now } = {}) {
  if (cache && now() - cache.at < TTL_MS) return { ...cache.figures, source: 'live' };
  inflight ??= fetchFigures(adminClient).finally(() => { inflight = null; });
  const figures = await inflight;
  if (figures) {
    cache = { figures, at: now() };
    return { ...figures, source: 'live' };
  }
  if (cache) return { ...cache.figures, source: 'cached' };
  return { ...MEASURED_FIGURES, source: 'fallback' };
}

export async function handleSiteFiguresApi(req, res, next, deps = {}) {
  const host = req.headers?.host || 'localhost';
  if (new URL(req.url || '/', `http://${host}`).pathname !== PATH) {
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
  const use = (server) => server.middlewares.use((req, res, next) => {
    handleSiteFiguresApi(req, res, next).catch(next);
  });
  return { name: 'niyantran-site-figures-api', configureServer: use, configurePreviewServer: use };
}
