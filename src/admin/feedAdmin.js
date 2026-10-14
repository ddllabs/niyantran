// F169 phase 4, C5: the admin screen's view of the scheduled feed store.
//
// The data comes from two admin-only database functions, called with the signed-in admin's own
// session: feed_admin_status() (one row per module and variant, with the stale rule applied in SQL
// so the page server and this screen share it; supabase/migrations/20261015160000_feed_admin.sql)
// and db_size() (20261015150000_feed_records.sql). Nothing here writes.
//
// "Failing" means the module's last two attempts or more failed (consecutive_failures resets on the next
// success): one timeout among dozens of runs a day is noise, not a failing module. "Stale" is the SQL rule: not fetched within three of its intervals or
// two hours, whichever is more. A module can be both.

/** The database size at which the screen warns: 5 GB, counted as pg_size_pretty counts (1024 cubed). */
export const DB_WARN_BYTES = 5 * 1024 ** 3;

export const FEED_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'failing', label: 'Failing' },
  { id: 'stale', label: 'Stale' },
  { id: 'serveOff', label: 'Serve off' },
];

const text = (v) => (typeof v === 'string' ? v : '');
const whole = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const when = (v) => {
  const t = Date.parse(text(v));
  return Number.isFinite(t) ? t : null;
};

/** The rows feed_admin_status() returned, as the screen reads them. Rows without a module name are dropped. */
export function shapeFeedRows(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((r) => r && typeof r === 'object' && text(r.tier) && text(r.feature))
    .map((r) => ({
      key: `${r.tier}/${r.feature}/${text(r.variant)}`,
      tier: text(r.tier),
      feature: text(r.feature),
      variant: text(r.variant),
      cls: text(r.class),
      kind: text(r.kind),
      intervalMinutes: whole(r.interval_minutes),
      serve: r.serve === true,
      nextDueAt: when(r.next_due_at),
      fetchedAt: when(r.fetched_at),
      checkedAt: when(r.checked_at),
      lastError: text(r.last_error),
      failures: whole(r.consecutive_failures),
      items: whole(r.item_count),
      leased: r.leased === true,
      lastRunStatus: text(r.last_run_status),
      lastRunAt: when(r.last_run_at),
      okRuns24h: whole(r.runs_ok_24h),
      failedRuns24h: whole(r.runs_failed_24h),
      staleAfterMinutes: whole(r.stale_after_minutes),
      stale: r.stale === true,
    }));
}

/** The database and per-table sizes db_size() returned: { database, tables: [{ name, bytes }] }, or null. */
export function shapeSizes(data) {
  if (!Array.isArray(data)) return null;
  const rows = data
    .filter((r) => r && typeof r === 'object' && text(r.name))
    .map((r) => ({ name: text(r.name), bytes: whole(r.bytes) }));
  const database = rows.find((r) => r.name === 'database');
  if (!database) return null;
  return {
    database: database.bytes,
    tables: rows.filter((r) => r.name !== 'database').sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name)),
  };
}

export const FAILING_AFTER = 2;
export const isFailing = (row) => row.failures >= FAILING_AFTER;

/** An interval as a reader says it: every 15 min, every 6 h, daily. */
export function formatInterval(minutes) {
  const m = Number(minutes) || 0;
  if (m > 0 && m % 1440 === 0) return m === 1440 ? 'daily' : `every ${m / 1440} days`;
  if (m >= 60 && m % 60 === 0) return `every ${m / 60} h`;
  return `every ${m} min`;
}

/** The markers a row shows, worst first. Text, never colour alone. */
export function markersOf(row) {
  const out = [];
  if (isFailing(row)) out.push('failing');
  if (row.stale) out.push('stale');
  return out;
}

/** Failing and stale first, then failing only, then stale only, then the rest; by name within each. */
export function sortFeedRows(rows) {
  const rank = (r) => (isFailing(r) && r.stale ? 0 : isFailing(r) ? 1 : r.stale ? 2 : 3);
  return [...rows].sort((a, b) => rank(a) - rank(b)
    || a.tier.localeCompare(b.tier) || a.feature.localeCompare(b.feature) || a.variant.localeCompare(b.variant));
}

const MATCH = {
  all: () => true,
  failing: isFailing,
  stale: (r) => r.stale,
  serveOff: (r) => !r.serve,
};

export function filterFeedRows(rows, filter) {
  return rows.filter(MATCH[filter] || MATCH.all);
}

export function filterCounts(rows) {
  const out = {};
  for (const f of FEED_FILTERS) out[f.id] = filterFeedRows(rows, f.id).length;
  return out;
}

/** True at or above the warning size. Just under is not a warning. */
export function sizeWarning(bytes) {
  return Number(bytes) >= DB_WARN_BYTES;
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.floor(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** "5m ago", "2h 10m ago", "3d ago"; "Never" when there is no time. `now` is in milliseconds. */
export function formatFeedAge(ts, now = Date.now()) {
  if (!ts) return 'Never';
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m ? `${h}h ${m}m ago` : `${h}h ago`;
  }
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * feed_admin_status() is not installed yet (the migration is not applied): PostgREST's PGRST202 (it
 * names only the function that was called), or Postgres 42883 whose message names feed_admin_status.
 * A 42883 about anything else, such as is_platform_admin() missing inside it, is a real error.
 */
export function isNotSetUp(error) {
  if (!error) return false;
  const code = text(error.code);
  if (code === 'PGRST202') return true;
  return code === '42883' && text(error.message).includes('feed_admin_status');
}

/**
 * Loads both reads with the admin's session (`client.rpc`). Resolves to one of:
 *   { status: 'notSetUp' }                       feed_admin_status() is not installed yet
 *   { status: 'error', message }                 the status read failed for another reason
 *   { status: 'ready', rows, sizes, sizesNote }  rows may be empty; sizes is null with a note if db_size() failed
 */
export async function loadFeedStore(client) {
  let status;
  let size;
  try {
    [status, size] = await Promise.all([
      client.rpc('feed_admin_status'),
      client.rpc('db_size').then((r) => r, (e) => ({ data: null, error: e })),
    ]);
  } catch (err) {
    return { status: 'error', message: text(err?.message) || 'The request failed.' };
  }
  if (status?.error) {
    if (isNotSetUp(status.error)) return { status: 'notSetUp' };
    return { status: 'error', message: text(status.error.message) || 'The request failed.' };
  }
  const sizes = size?.error ? null : shapeSizes(size?.data);
  return {
    status: 'ready',
    rows: shapeFeedRows(status?.data),
    sizes,
    sizesNote: sizes ? '' : 'The database size could not be read.',
  };
}

/** HH:MM on the reader's clock (or in `timeZone`, for a test). */
export function formatClock(ts, timeZone) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}) });
}

/**
 * The state after a read. A failed read keeps the last good table and notes when the refresh failed
 * (`refreshFailedAt`); the error screen is only for when nothing has loaded yet. A good read clears it.
 */
export function nextFeedState(prev, result, at) {
  if (result?.status === 'ready') return { ...result, refreshFailedAt: null };
  if (result?.status === 'error' && prev?.status === 'ready') return { ...prev, refreshFailedAt: at };
  return result;
}

export const POLL_MS = 60000;

const pageHidden = () => typeof document !== 'undefined' && document.hidden === true;
function onPageVisible(callback) {
  if (typeof document === 'undefined') return () => {};
  document.addEventListener('visibilitychange', callback);
  return () => document.removeEventListener('visibilitychange', callback);
}

/**
 * Reads now, then every `intervalMs`, and hands each result to `onState`. Returns a stop function.
 *  - A tick is skipped while the page is hidden; when it becomes visible again, one read is made if the
 *    last was started more than `intervalMs` ago. The first read is made whatever the page's state.
 *  - A tick is skipped while a read is still in flight.
 *  - After stop, the timer is cleared and a reply that was still on its way is dropped.
 * The timer, visibility and clock are injectable for tests.
 */
export function startFeedPolling(load, onState, {
  intervalMs = POLL_MS,
  setInterval: setTimer = (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: clearTimer = (id) => globalThis.clearInterval(id),
  isHidden = pageHidden,
  subscribeVisible = onPageVisible,
  now = Date.now,
} = {}) {
  let stopped = false;
  let inFlight = false;
  let lastAt = null;

  function read() {
    if (stopped || inFlight) return;
    inFlight = true;
    lastAt = now();
    let pending;
    try {
      pending = Promise.resolve(load());
    } catch (err) {
      pending = Promise.reject(err);
    }
    pending
      .catch((err) => ({ status: 'error', message: text(err?.message) || 'The request failed.' }))
      .then((result) => {
        inFlight = false;
        if (!stopped) onState(result);
      });
  }

  read();
  const timer = setTimer(() => { if (!isHidden()) read(); }, intervalMs);
  const unsubscribe = subscribeVisible(() => {
    if (!isHidden() && (lastAt === null || now() - lastAt > intervalMs)) read();
  });
  return function stop() {
    stopped = true;
    clearTimer(timer);
    unsubscribe();
  };
}
