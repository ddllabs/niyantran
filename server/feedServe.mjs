/**
 * F169 phase 4 (C4): a scheduled module is served from the feed store (ADR 0012, decision 4).
 *
 * serveFromStore asks public.feed_page for the module's first page of stored items, newest first
 * (the database orders them), and rebuilds the envelope a live answer has. It answers null whenever
 * the live path should answer instead: the database is not configured (local dev), the call fails or
 * passes its time limit, the module has no state, `serve` is off, it has no items, or its items are too old.
 *
 * The store is served only while it is fresh: items fetched longer ago than three of the module's
 * intervals, or two hours, whichever is more, are left to the live path (storeMaxAgeMinutes).
 *
 * A store answer is the normal path, not a fallback. It is marked `served: 'store'` with the time the
 * items were fetched (`fetchedAt`, ISO), keeps `fallback: false`, and never passes through the archive
 * or backup passes, so the page does not take it for a stored or old copy (src/lib/plainSourceNote.js).
 *
 * This file imports no loaders: the route (featureFeed.mjs, serveFeatureFeedStoredFirst) decides which
 * module a request names and what to do when this answers null.
 */
import { FEED_SCHEDULE, FEED_VARIANTS } from './feedSchedule.mjs';
import { safeText, supabaseRpc } from './supabaseRpc.mjs';

/** The store gets this long. Past it the live path answers; the live path has its own 4 s limit after that. */
export const STORE_TIME_LIMIT_MS = 1500;
/**
 * One page of the module at the live path's usual row count (MAX_ROWS, 500, which is also the most
 * feed_page returns). No scheduled module is paged by the browser (the paged modules are Bills and
 * Parliamentary Questions, neither of which is scheduled), so only the first page is asked for.
 */
export const STORE_PAGE_ROWS = 500;
/** The least a module's items stay fresh for, however short its interval (a 15-minute market module). */
export const STORE_MIN_FRESH_MINUTES = 120;

/**
 * How old (minutes since the items were fetched) a module's items may be and still be served: three
 * of its refresh intervals, or two hours, whichever is more. News (30 min) and markets (15 min) get
 * two hours; hourly classes three hours; daily reference modules three days.
 */
export function storeMaxAgeMinutes(intervalMinutes) {
  const every = Number(intervalMinutes);
  return Math.max(STORE_MIN_FRESH_MINUTES, Number.isFinite(every) && every > 0 ? 3 * every : 0);
}

/**
 * The stored variant a request means. The Statement Tracker's `person` is the variant (a listed
 * leader, else the first, as the live loader reads it); every other module has the empty variant.
 */
export function storeVariant(id, searchParams) {
  const v = FEED_VARIANTS[id];
  if (!v) return '';
  const want = String(searchParams.get(v.param) || '').trim().toLowerCase();
  return v.values.find((value) => value.toLowerCase() === want) || v.values[0];
}

const isRow = (r) => Boolean(r) && typeof r === 'object' && !Array.isArray(r);

function isoOrNull(value) {
  if (!value) return null;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * A feed_page result as the live envelope (server/featureFeed.mjs envelope()), or null for the live
 * path. `id` and `now` (ms) are for the log line and the freshness rule.
 */
function storedAnswer(id, page, now) {
  if (!isRow(page) || page.serve !== true) return null;
  const rows = (Array.isArray(page.items) ? page.items : []).map((i) => i?.row).filter(isRow);
  if (!rows.length) return null;
  const meta = isRow(page.meta) ? page.meta : {};
  // Without a fetched time the page could not say how old its items are.
  const fetchedAt = isoOrNull(page.fetched_at) || isoOrNull(meta.fetched_at);
  if (!fetchedAt) return null;
  const ageMinutes = (now - Date.parse(fetchedAt)) / 60_000;
  const limit = storeMaxAgeMinutes(page.interval_minutes);
  if (ageMinutes > limit) {
    console.warn(`[feed-store] ${id}: the items are ${Math.floor(ageMinutes)} min old, over the limit of ${limit} min; the live path answers`);
    return null;
  }
  const coverage = isRow(meta.coverage) ? meta.coverage : {};
  return {
    ok: true,
    tier: page.tier,
    feature: page.feature,
    rows,
    source: {
      adapter: String(meta.adapter || ''),
      links: Array.isArray(meta.links) ? meta.links : [],
      note: String(meta.note || ''),
      gdelt: false,
      kind: String(meta.kind || ''),
    },
    coverage: {
      from: String(coverage.from || ''),
      through: String(coverage.through || ''),
      exhaustive: Boolean(coverage.exhaustive),
    },
    fallback: false,

    timeline: Array.isArray(meta.timeline) ? meta.timeline : [],
    meta: isRow(meta.view) ? meta.view : null,
    served: 'store',
    fetchedAt,
    // The module's item count in the store; `rows` holds the first page of them.
    storeTotal: Number.isFinite(Number(page.total)) ? Number(page.total) : rows.length,
  };
}

const storeConfigured = (env) => Boolean((env.SUPABASE_URL || env.VITE_SUPABASE_URL) && env.SUPABASE_SECRET_KEY);

/**
 * The stored answer for module `id` (a FEED_SCHEDULE key), or null when the live path should answer.
 * `rpc(name, args)` is the database call (default: supabaseRpc with the server-side secret key).
 */
export async function serveFromStore(
  id,
  searchParams,
  { rpc, timeoutMs = STORE_TIME_LIMIT_MS, env = process.env, limit = STORE_PAGE_ROWS, offset = 0, now = Date.now } = {},
) {
  if (!Object.hasOwn(FEED_SCHEDULE, id)) return null;
  if (!rpc && !storeConfigured(env)) return null;
  const [tier, feature] = id.split(/:(.*)/s);
  const ask = rpc || supabaseRpc({ timeoutMs });
  let timer;
  try {
    const page = await Promise.race([
      ask('feed_page', { p_tier: tier, p_feature: feature, p_variant: storeVariant(id, searchParams), p_limit: limit, p_offset: offset }),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    return storedAnswer(id, page, now());
  } catch (err) {
    // The message has no key (supabaseRpc masks it) and no query string (safeText).
    console.warn(`[feed-store] ${id}: ${safeText(err?.message || err, 200)}; the live path answers`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
