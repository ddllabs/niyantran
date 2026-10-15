/**
 * F169 phase 4 (C4): a scheduled module is served from the feed store (ADR 0012, decision 4).
 *
 * serveFromStore asks public.feed_page for the module's first page of stored items, newest first
 * (the database orders them), and rebuilds the envelope a live answer has. It answers null whenever
 * the live path should answer instead: the database is not configured (local dev), the call fails or
 * passes its time limit, the module has no state, `serve` is off, it has no items, or its items are too old.
 *
 * The store is served only while it is fresh: items fetched longer ago than three of the module's
 * intervals, or two hours, whichever is more, are left to the live path (storeMaxAgeMinutes). With
 * `allowStale` such items are answered marked `stale: true` instead, so that the route can keep them
 * when the live path brings nothing better (liveAnswerIsUsable): an empty or failed live answer never
 * hides a good stored copy (Task B, 2026-10-16). Up to a ceiling: items older than seven days, or 20 of
 * the module's intervals when that is longer (storeCeilingMinutes), are never served, and the live,
 * archive and backup path answers as before. A stored copy, fresh or stale, never says LIVE (storedView).
 *
 * A register module (server/feedSchedule.mjs FEED_REGISTERS: MLA Directory, the RBI handbook modules) is loaded by a script
 * (a reload replaces a variant's list, served in load order) and never refreshed by the timer, so it
 * is served whatever its age, marked `register: true` so the page dates it by its
 * records ("register · as of …") rather than by its load time. A request's `state` picks its variant;
 * with no state (or one the register does not hold) the page gets a first page across every variant,
 * the same share of each, in one read (registerAcross, public.feed_page_across). F201: a handbook
 * register's variant (a table, or a whole-year block of a large table, `table` and `years`) is read
 * whole, up to 2,000 items in four pages asked for at once (wholeVariant).
 *
 * Task B follow-up (2026-10-16): a stored answer shows only rows the module's live code would show now:
 * the latest run of a measurement or events module, an undated item only while its source lists it
 * (servableItems), and the live branch's own row rules, its guards, age window and one row per story
 * (server/feedRows.mjs storeRowsFor). When none is left, the live path answers.
 *
 * A store answer is the normal path, not a fallback. It is marked `served: 'store'` with the time the
 * items were fetched (`fetchedAt`, ISO), keeps `fallback: false`, and never passes through the archive
 * or backup passes, so the page does not take it for a stored or old copy (src/lib/plainSourceNote.js).
 *
 * This file imports no loaders: the route (featureFeed.mjs, serveFeatureFeedStoredFirst) decides which
 * module a request names and what to do when this answers null.
 */
import { classifyAnswer } from './feedAnswer.mjs';
import { FEED_CLASSES, FEED_REGISTERS, FEED_SCHEDULE, FEED_VARIANTS, isStoreServed } from './feedSchedule.mjs';
import { storeRowsFor } from './feedRows.mjs';
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

/** The least time a stale copy may still be kept for the route (allowStale): seven days. */
export const STORE_STALE_CEILING_MINUTES = 7 * 24 * 60;

/**
 * Review of 1345bfd (finding 2): the oldest a module's items may be and still be served at all, even
 * marked stale: seven days, or 20 of its refresh intervals when that is longer (a daily reference
 * module: 20 days). Past it the store answers null, so the live, archive and backup path answers.
 */
export function storeCeilingMinutes(intervalMinutes) {
  const every = Number(intervalMinutes);
  return Math.max(STORE_STALE_CEILING_MINUTES, Number.isFinite(every) && every > 0 ? 20 * every : 0);
}

/**
 * Task B follow-up (2026-10-16): which stored items a page may show, by the module's keeping kind.
 * feed_record stamps every item a run lists with last_seen = the run's time, the same time it writes to
 * feed_state.fetched_at; an item the run does not list keeps its older last_seen.
 *  - measurement and events (LATEST_RUN_KINDS): only the items of the latest run, last_seen at or after
 *    the state's fetched_at less LATEST_RUN_MARGIN_MS. A market that closed, a launch that flew,
 *    yesterday's TV schedule: the live branch no longer shows them. A run that failed moves neither
 *    time, so the previous run's items stay the latest.
 *  - official and news: every item, except that an undated one (no published_at, no readable date) is
 *    served only while its source still lists it (last_seen within the margin of the newest last_seen
 *    on the page, the latest run that recorded items: a run that found nothing new moves fetched_at
 *    but not last_seen). Its age cannot be judged from a date, so it is shown as long as live shows it.
 *  - latest and reference replace their items each run, so all are served.
 * An item without a readable last_seen is kept (public.feed_page always returns one).
 */
export const LATEST_RUN_KINDS = Object.freeze(new Set(['measurement', 'events']));
const KEPT_KINDS = new Set(['official', 'news']);
/** How far before the run's time an item's last_seen may be and still count as that run's. */
export const LATEST_RUN_MARGIN_MS = 60_000;

const timeOf = (value) => Date.parse(String(value ?? ''));
const isDated = (i) => Number.isFinite(timeOf(i?.published_at)) || Number.isFinite(timeOf(i?.row?.date));

export function servableItems(kind, items, fetchedAt) {
  const latestOnly = LATEST_RUN_KINDS.has(kind);
  if (!latestOnly && !KEPT_KINDS.has(kind)) return items;
  const seen = items.map((i) => timeOf(i?.last_seen)).filter(Number.isFinite);
  const runAt = latestOnly ? timeOf(fetchedAt) : Math.max(...seen);
  if (!Number.isFinite(runAt)) return items;
  const inLatestRun = (i) => {
    const t = timeOf(i?.last_seen);
    return !Number.isFinite(t) || t >= runAt - LATEST_RUN_MARGIN_MS;
  };
  return items.filter((i) => (latestOnly ? inLatestRun(i) : isDated(i) || inLatestRun(i)));
}

/** The module's refresh interval from the schedule (server/feedSchedule.mjs), else the stored state's. */
function intervalOf(id, stored) {
  return FEED_CLASSES[FEED_SCHEDULE[id]]?.every ?? stored;
}

// Review of 1345bfd (finding 1): a stored copy was not fetched for this request, so it never says LIVE.
const LEADING_LIVE = /^\s*live\b/i;
const ANY_LIVE = /\blive\b/i;

/**
 * The stored envelope meta (the loader's own: heading, section, status, as-of) as the page may show it.
 * The desk strip prints `status` as it is (src/desks/DeskView.jsx), and about twenty loaders write
 * "LIVE · …": a leading LIVE reads STORED, and a status that claims LIVE anywhere else is left out
 * (the strip then shows the section alone). Everything else is passed on unchanged; the stored row
 * is not changed in place.
 */
export function storedView(view) {
  if (!isRow(view)) return null;
  if (typeof view.status !== 'string' || !ANY_LIVE.test(view.status)) return view;
  const status = view.status.replace(LEADING_LIVE, 'STORED');
  const { status: _claim, ...rest } = view;
  return ANY_LIVE.test(status) ? rest : { ...rest, status };
}

/**
 * The stored variant a request means. The Statement Tracker's `person` is the variant (a listed
 * leader, else the first, as the live loader reads it). A register's variant is its parameter's
 * value, normalised (MLA Directory's `state`, a handbook module's `table`), or, when the request names
 * none it holds, the register's defaultVariant (a handbook module's first table) or '' (MLA Directory:
 * the page across every state). Every other module has the empty variant.
 */
export function storeVariant(id, searchParams) {
  const register = FEED_REGISTERS[id];
  // F201: a handbook register reads `table` and `years` (a block of a large table).
  if (register?.variantFrom) return register.variantFrom(searchParams);
  // F196: a register with a default variant (the handbook modules' first table) never pages across variants.
  if (register) return register.variantOf(searchParams.get(register.param)) || register.defaultVariant || '';
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
 * path. `id` and `now` (ms) are for the log line and the freshness rule; a register (`register`) is
 * exempt from the freshness rule.
 */
function storedAnswer(id, page, now, register = false, allowStale = false) {
  if (!isRow(page) || page.serve !== true) return null;
  const meta = isRow(page.meta) ? page.meta : {};
  // Without a fetched time the page could not say how old its items are.
  const fetchedAt = isoOrNull(page.fetched_at) || isoOrNull(meta.fetched_at);
  const items = (Array.isArray(page.items) ? page.items : []).filter((i) => isRow(i?.row));
  if (!items.length) return null;
  if (!fetchedAt) return null;
  // Task B follow-up (2026-10-16): only the items the module's live code would show: the latest run of a
  // measurement or events module, undated items only while listed, then the live branch's own row rules
  // (server/feedRows.mjs; F187: one release per Cabinet decision is one of them).
  const kind = String(page.kind || FEED_CLASSES[FEED_SCHEDULE[id]]?.kind || '');
  const listed = register ? items : servableItems(kind, items, page.fetched_at || meta.fetched_at);
  const rows = storeRowsFor(id, listed.map((i) => i.row), { now, variant: String(page.variant ?? '') });
  if (!rows.length) {
    console.warn(`[feed-store] ${id}: none of the ${items.length} stored items is one the live branch would show now; the live path answers`);
    return null;
  }
  const ageMinutes = (now - Date.parse(fetchedAt)) / 60_000;
  const limit = storeMaxAgeMinutes(page.interval_minutes);
  const stale = !register && ageMinutes > limit;
  if (stale && !allowStale) {
    console.warn(`[feed-store] ${id}: the items are ${Math.floor(ageMinutes)} min old, over the limit of ${limit} min; the live path answers`);
    return null;
  }
  const ceiling = storeCeilingMinutes(intervalOf(id, page.interval_minutes));
  if (stale && ageMinutes > ceiling) {
    console.warn(`[feed-store] ${id}: the items are ${Math.floor(ageMinutes)} min old, over the ceiling of ${ceiling} min for a stale copy; the live path answers`);
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
      kind: String(meta.kind || ''),
    },
    coverage: {
      from: String(coverage.from || ''),
      through: String(coverage.through || ''),
      exhaustive: Boolean(coverage.exhaustive),
    },
    fallback: false,

    timeline: Array.isArray(meta.timeline) ? meta.timeline : [],
    meta: storedView(meta.view),
    served: 'store',
    ...(register ? { register: true } : {}),
    // Past the freshness limit, kept only for the route to weigh against the live answer (allowStale).
    ...(stale ? { stale: true, ageMinutes: Math.floor(ageMinutes) } : {}),
    fetchedAt,
    // The module's item count in the store; `rows` holds the first page of them.
    storeTotal: Number.isFinite(Number(page.total)) ? Number(page.total) : rows.length,
  };
}

/** The most items per variant public.feed_page_across returns (it clamps to 1..100). */
export const ACROSS_MAX_PER_VARIANT = 100;

/**
 * A register with no variant asked for: the first page across every variant, the same share of each
 * (floor(limit / variants): 16 of each of MLA Directory's 31 states in 500 rows), in the variants'
 * order. One read, public.feed_page_across (supabase/migrations/20261015170000_feed_register_page.sql),
 * which returns the pages only when every variant has serve on: until then (serve is off before
 * go-live) the live path answers straight away. Every variant must also have items; one missing
 * leaves the whole page to the live path, so the page never shows some states as if they were all.
 */
async function registerAcross(id, ask, limit, now) {
  const register = FEED_REGISTERS[id];
  const [tier, feature] = id.split(/:(.*)/s);
  const each = Math.min(ACROSS_MAX_PER_VARIANT, Math.max(1, Math.floor(limit / register.values.length)));
  const page = await ask('feed_page_across', { p_tier: tier, p_feature: feature, p_per_variant: each });
  // Not fully served (or not loaded): the live path, quietly, as feed_page's serve-off answer is.
  if (!isRow(page) || page.all_served !== true) return null;
  const byVariant = new Map((Array.isArray(page.pages) ? page.pages : []).filter(isRow).map((p) => [p.variant, p]));
  const at = now();
  const answers = register.values.map((v) => (byVariant.has(v) ? storedAnswer(id, { ...byVariant.get(v), tier, feature }, at, true) : null));
  const missing = register.values.filter((_v, i) => !answers[i]);
  if (missing.length) {
    console.warn(`[feed-store] ${id}: ${missing.length} of ${register.values.length} variants have nothing to serve (${safeText(missing.slice(0, 3).join(', '), 100)}); the live path answers`);
    return null;
  }
  const total = answers.reduce((sum, a) => sum + a.storeTotal, 0);
  const dates = (key) => answers.map((a) => a.coverage[key]).filter(Boolean).sort();
  const [first] = answers;
  return {
    ...first,
    rows: answers.flatMap((a) => a.rows),
    source: {
      ...first.source,
      links: [...new Set(answers.flatMap((a) => a.source.links))].slice(0, 25),
      note: `${each} ${register.noun} from each of the ${register.values.length} ${register.unit} in the stored register of ${total.toLocaleString('en-IN')}. A ${register.param}'s own list holds all of its ${register.noun}.`,
    },
    coverage: { from: dates('from')[0] || '', through: dates('through').pop() || '', exhaustive: false },
    meta: null,
    fetchedAt: answers.map((a) => a.fetchedAt).sort().pop(),
    storeTotal: total,
  };
}

/** F201: a whole variant is read in this many pages of STORE_PAGE_ROWS (2,000 items, feed_record's cap). */
export const WHOLE_VARIANT_PAGES = 4;

/**
 * F201: a register variant read whole (a handbook table, or one whole-year block of a large one): the
 * pages at offsets 0, 500, 1000 and 1500, asked for at once, joined in offset order. null (the live
 * path) unless every page agrees on fetched_at and total and the pages together hold `total` items: a
 * reload between the reads, or a variant larger than the reads, is never served part-way.
 */
async function wholeVariant(id, ask, tier, feature, variant, now) {
  const offsets = Array.from({ length: WHOLE_VARIANT_PAGES }, (_v, i) => i * STORE_PAGE_ROWS);
  const pages = await Promise.all(offsets.map((offset) => ask('feed_page', { p_tier: tier, p_feature: feature, p_variant: variant, p_limit: STORE_PAGE_ROWS, p_offset: offset })));
  const [first] = pages;
  // No state, or not served: the live path, quietly, as for one page.
  if (!isRow(first) || first.serve !== true) return null;
  if (pages.some((p) => !isRow(p) || p.fetched_at !== first.fetched_at || p.total !== first.total)) {
    console.warn(`[feed-store] ${id} / ${safeText(variant, 40)}: the reads of one variant disagree (a reload between them?); the live path answers`);
    return null;
  }
  const items = pages.flatMap((p) => (Array.isArray(p.items) ? p.items : []));
  if (items.length !== Number(first.total)) {
    console.warn(`[feed-store] ${id} / ${safeText(variant, 40)}: ${items.length} items read of ${first.total}; the live path answers`);
    return null;
  }
  return storedAnswer(id, { ...first, items }, now(), true);
}

/**
 * Whether a live answer may take the place of a stored copy (Task B, 2026-10-16): a live attempt that
 * finished (`served: 'live'`) with an answer the refresh itself would keep (feedAnswer.mjs
 * classifyAnswer, status ok): real rows from a live adapter, not a fallback, the archive, the backup
 * pack, an embedded or planned answer, or only a status row. An answer that is none of these never
 * hides a stored copy that is merely past its freshness limit.
 */
export function liveAnswerIsUsable(body) {
  if (!isRow(body) || body.served !== 'live') return false;
  return classifyAnswer(body).status === 'ok';
}

const storeConfigured = (env) => Boolean((env.SUPABASE_URL || env.VITE_SUPABASE_URL) && env.SUPABASE_SECRET_KEY);

/**
 * The stored answer for module `id` (a FEED_SCHEDULE or FEED_REGISTERS key), or null when the live path should answer.
 * `rpc(name, args)` is the database call (default: supabaseRpc with the server-side secret key).
 */
export async function serveFromStore(
  id,
  searchParams,
  { rpc, timeoutMs = STORE_TIME_LIMIT_MS, env = process.env, limit = STORE_PAGE_ROWS, offset = 0, now = Date.now, allowStale = false } = {},
) {
  if (!isStoreServed(id)) return null;
  if (!rpc && !storeConfigured(env)) return null;
  const [tier, feature] = id.split(/:(.*)/s);
  const ask = rpc || supabaseRpc({ timeoutMs });
  const register = Object.hasOwn(FEED_REGISTERS, id);
  const variant = storeVariant(id, searchParams);
  let timer;
  try {
    const work = register && !variant
      ? registerAcross(id, ask, limit, now)
      : register && FEED_REGISTERS[id].wholeVariant
        ? wholeVariant(id, ask, tier, feature, variant, now)
        : ask('feed_page', { p_tier: tier, p_feature: feature, p_variant: variant, p_limit: limit, p_offset: offset })
          .then((page) => storedAnswer(id, page, now(), register, allowStale));
    return await Promise.race([
      work,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } catch (err) {
    // The message has no key (supabaseRpc masks it) and no query string (safeText).
    console.warn(`[feed-store] ${id}: ${safeText(err?.message || err, 200)}; the live path answers`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
