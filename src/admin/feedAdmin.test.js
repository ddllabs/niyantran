// F169 phase 4, C5: the pure side of the admin screen's feed-store section.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DB_WARN_BYTES,
  filterCounts,
  filterFeedRows,
  formatBytes,
  formatFeedAge,
  isNotSetUp,
  loadFeedStore,
  markersOf,
  shapeFeedRows,
  shapeSizes,
  sizeWarning,
  sortFeedRows,
  formatInterval,
  intervalLabel,
  formatClock,
  nextFeedState,
  startFeedPolling,
  POLL_MS,
} from './feedAdmin.js';

const GB = 1024 ** 3;
const raw = (over = {}) => ({
  tier: 'news', feature: 'Wire', variant: '', class: 'news', kind: 'news', interval_minutes: 30, serve: true,
  next_due_at: '2026-10-15T10:05:00Z', fetched_at: '2026-10-15T09:30:00Z', checked_at: '2026-10-15T09:30:00Z',
  last_error: null, consecutive_failures: 0, item_count: 40, leased: false, last_run_status: 'ok',
  last_run_at: '2026-10-15T09:30:00Z', runs_ok_24h: 40, runs_failed_24h: 1, stale_after_minutes: 120, stale: false,
  ...over,
});
const rows = (...overs) => shapeFeedRows(overs.map((o) => raw(o)));

describe('shapeFeedRows', () => {
  it('reads one row into the screen\'s names and numbers', () => {
    const [r] = shapeFeedRows([raw({ variant: 'Leader One', consecutive_failures: 3, last_error: 'HTTP 503' })]);
    expect(r).toMatchObject({
      key: 'news/Wire/Leader One', tier: 'news', feature: 'Wire', variant: 'Leader One', cls: 'news', serve: true,
      failures: 3, lastError: 'HTTP 503', items: 40, okRuns24h: 40, failedRuns24h: 1, staleAfterMinutes: 120, stale: false,
    });
    expect(r.fetchedAt).toBe(Date.parse('2026-10-15T09:30:00Z'));
  });
  it('keeps a missing time as null and drops what is not a module', () => {
    const out = shapeFeedRows([raw({ fetched_at: null }), null, { feature: 'x' }, 'text']);
    expect(out).toHaveLength(1);
    expect(out[0].fetchedAt).toBeNull();
  });
  it('treats anything but an array as no rows', () => {
    expect(shapeFeedRows(null)).toEqual([]);
    expect(shapeFeedRows({})).toEqual([]);
  });
  it('does not take a truthy non-boolean for serve or stale', () => {
    const [r] = shapeFeedRows([raw({ serve: 'true', stale: 1 })]);
    expect(r.serve).toBe(false);
    expect(r.stale).toBe(false);
  });
});

describe('failing and intervals', () => {
  it('one failed attempt is not yet failing; two in a row are', () => {
    expect(markersOf(rows({ feature: 'One miss', consecutive_failures: 1 })[0])).toEqual([]);
    expect(markersOf(rows({ feature: 'Two misses', consecutive_failures: 2 })[0])).toEqual(['failing']);
  });
  it('says an interval as a reader would', () => {
    expect([15, 30, 60, 360, 1440, 2880].map(formatInterval)).toEqual(['every 15 min', 'every 30 min', 'every 1 h', 'every 6 h', 'daily', 'every 2 days']);
  });
});

describe('a register row (C6 option 1)', () => {
  it('shows "register" in place of its interval; every other row keeps its interval', () => {
    const [register, wire] = rows({ feature: 'MLA Directory', variant: 'Kerala', class: 'register', kind: 'official', interval_minutes: 43200 }, { feature: 'Wire' });
    expect(intervalLabel(register)).toBe('register');
    expect(intervalLabel(wire)).toBe('every 30 min');
    expect(intervalLabel(rows({ feature: 'Monthly', class: 'official', kind: 'official', interval_minutes: 43200 })[0])).toBe('every 30 days');
  });
});

describe('markers, sorting and filtering', () => {
  const list = rows(
    { feature: 'Fine' },
    { feature: 'Stale only', stale: true },
    { feature: 'Failing only', consecutive_failures: 2 },
    { feature: 'Both', consecutive_failures: 4, stale: true },
    { feature: 'Off', serve: false },
  );
  it('names a failing module and a stale module, and both', () => {
    expect(markersOf(list[0])).toEqual([]);
    expect(markersOf(list[1])).toEqual(['stale']);
    expect(markersOf(list[2])).toEqual(['failing']);
    expect(markersOf(list[3])).toEqual(['failing', 'stale']);
  });
  it('sorts failing and stale first, then failing, then stale, then the rest by name', () => {
    expect(sortFeedRows(list).map((r) => r.feature)).toEqual(['Both', 'Failing only', 'Stale only', 'Fine', 'Off']);
  });
  it('does not change the list it sorts', () => {
    const before = list.map((r) => r.feature);
    sortFeedRows(list);
    expect(list.map((r) => r.feature)).toEqual(before);
  });
  it('filters by failing, stale and serve off', () => {
    expect(filterFeedRows(list, 'all')).toHaveLength(5);
    expect(filterFeedRows(list, 'failing').map((r) => r.feature)).toEqual(['Failing only', 'Both']);
    expect(filterFeedRows(list, 'stale').map((r) => r.feature)).toEqual(['Stale only', 'Both']);
    expect(filterFeedRows(list, 'serveOff').map((r) => r.feature)).toEqual(['Off']);
    expect(filterFeedRows(list, 'nonsense')).toHaveLength(5);
  });
  it('counts each filter', () => {
    expect(filterCounts(list)).toEqual({ all: 5, failing: 2, stale: 2, serveOff: 1 });
  });
});

describe('database size', () => {
  it('warns at 5 GB and not a byte under', () => {
    expect(DB_WARN_BYTES).toBe(5 * GB);
    expect(sizeWarning(5 * GB - 1)).toBe(false);
    expect(sizeWarning(5 * GB)).toBe(true);
    expect(sizeWarning(12 * GB)).toBe(true);
  });
  it('does not warn on nothing', () => {
    expect(sizeWarning(0)).toBe(false);
    expect(sizeWarning(null)).toBe(false);
    expect(sizeWarning(undefined)).toBe(false);
    expect(sizeWarning('x')).toBe(false);
  });
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536 * 1024)).toBe('1.5 MB');
    expect(formatBytes(5 * GB)).toBe('5.0 GB');
    expect(formatBytes(2048 * GB)).toBe('2.0 TB');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
  });
  it('reads db_size rows: the database, then tables largest first', () => {
    expect(shapeSizes([
      { name: 'feed_runs', bytes: 10 }, { name: 'database', bytes: 9000 }, { name: 'feed_items', bytes: 500 },
    ])).toEqual({ database: 9000, tables: [{ name: 'feed_items', bytes: 500 }, { name: 'feed_runs', bytes: 10 }] });
  });
  it('reads no database row, or no array, as no sizes', () => {
    expect(shapeSizes([{ name: 'feed_runs', bytes: 10 }])).toBeNull();
    expect(shapeSizes(null)).toBeNull();
  });
});

describe('formatFeedAge', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const ago = (s) => now - s * 1000;
  it('says how long ago', () => {
    expect(formatFeedAge(null, now)).toBe('Never');
    expect(formatFeedAge(ago(10), now)).toBe('just now');
    expect(formatFeedAge(ago(300), now)).toBe('5m ago');
    expect(formatFeedAge(ago(2 * 3600), now)).toBe('2h ago');
    expect(formatFeedAge(ago(2 * 3600 + 600), now)).toBe('2h 10m ago');
    expect(formatFeedAge(ago(3 * 86400 + 5), now)).toBe('3d ago');
  });
  it('does not go negative when the clock is behind the server', () => {
    expect(formatFeedAge(now + 60000, now)).toBe('just now');
  });
});

describe('isNotSetUp', () => {
  it('recognises feed_admin_status missing', () => {
    expect(isNotSetUp({ code: 'PGRST202', message: 'Could not find the function public.feed_admin_status without parameters in the schema cache' })).toBe(true);
    expect(isNotSetUp({ code: 'PGRST202', message: 'x' })).toBe(true);
    expect(isNotSetUp({ code: '42883', message: 'function public.feed_admin_status() does not exist' })).toBe(true);
  });
  it('does not take a 42883 about another function for it', () => {
    expect(isNotSetUp({ code: '42883', message: 'function public.is_platform_admin() does not exist' })).toBe(false);
    expect(isNotSetUp({ code: '42883', message: 'x' })).toBe(false);
  });
  it('does not take a refusal or a network failure for it', () => {
    expect(isNotSetUp({ code: '42501', message: 'Only an admin can read the feed store\'s health' })).toBe(false);
    expect(isNotSetUp({ message: 'Failed to fetch' })).toBe(false);
    expect(isNotSetUp({ message: 'Could not find the function public.feed_admin_status' })).toBe(false);
    expect(isNotSetUp(null)).toBe(false);
  });
});

describe('nextFeedState', () => {
  const good = { status: 'ready', rows: [1], sizes: null, sizesNote: 'x', refreshFailedAt: null };
  const error = { status: 'error', message: 'down' };
  it('replaces the state with a good read and clears the failure note', () => {
    const next = { status: 'ready', rows: [2], sizes: null, sizesNote: '' };
    expect(nextFeedState({ ...good, refreshFailedAt: 5 }, next, 9)).toEqual({ ...next, refreshFailedAt: null });
  });
  it('keeps the last good table when a refresh fails, and notes when', () => {
    expect(nextFeedState(good, error, 1234)).toEqual({ ...good, refreshFailedAt: 1234 });
  });
  it('updates the time on a second failure and still keeps the table', () => {
    const once = nextFeedState(good, error, 1000);
    expect(nextFeedState(once, error, 2000)).toEqual({ ...good, refreshFailedAt: 2000 });
  });
  it('shows the error when nothing has loaded yet', () => {
    expect(nextFeedState({ status: 'loading' }, error, 1)).toEqual(error);
  });
  it('shows not set up even over a good table', () => {
    expect(nextFeedState(good, { status: 'notSetUp' }, 1)).toEqual({ status: 'notSetUp' });
  });
});

describe('formatClock', () => {
  it('gives HH:MM', () => {
    expect(formatClock(Date.parse('2026-10-15T09:05:30Z'), 'UTC')).toBe('09:05');
    expect(formatClock(Date.parse('2026-10-15T23:59:00Z'), 'UTC')).toBe('23:59');
  });
});

describe('startFeedPolling', () => {
  afterEach(() => { vi.useRealTimers(); });
  const noVisibility = () => () => {};
  const setup = (opts = {}) => {
    vi.useFakeTimers();
    const load = vi.fn(async () => ({ status: 'ready' }));
    const onState = vi.fn();
    const stop = startFeedPolling(load, onState, { subscribeVisible: noVisibility, ...opts });
    return { load, onState, stop };
  };

  it('reads at once and then every minute', async () => {
    const { load, onState } = setup();
    expect(POLL_MS).toBe(60000);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120000);
    expect(load).toHaveBeenCalledTimes(4);
    expect(onState).toHaveBeenCalledTimes(4);
  });

  it('stops: the timer is cleared and no more reads are made', async () => {
    const { load, stop } = setup();
    await vi.advanceTimersByTimeAsync(60000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(300000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('drops a reply that arrives after stop', async () => {
    vi.useFakeTimers();
    let answer;
    const load = vi.fn(() => new Promise((resolve) => { answer = resolve; }));
    const onState = vi.fn();
    const stop = startFeedPolling(load, onState, { subscribeVisible: noVisibility });
    stop();
    answer({ status: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    expect(onState).not.toHaveBeenCalled();
  });

  it('delivers a reply that arrives while it is running', async () => {
    vi.useFakeTimers();
    let answer;
    const onState = vi.fn();
    startFeedPolling(() => new Promise((resolve) => { answer = resolve; }), onState, { subscribeVisible: noVisibility });
    answer({ status: 'ready', rows: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(onState).toHaveBeenCalledWith({ status: 'ready', rows: [] });
  });

  it('does not start another read while one is in flight', async () => {
    vi.useFakeTimers();
    const load = vi.fn(() => new Promise(() => {}));
    startFeedPolling(load, vi.fn(), { subscribeVisible: noVisibility });
    await vi.advanceTimersByTimeAsync(180000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('turns a rejected or throwing read into an error result and keeps going', async () => {
    vi.useFakeTimers();
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(() => { throw new Error('boom'); })
      .mockResolvedValue({ status: 'ready' });
    const onState = vi.fn();
    startFeedPolling(load, onState, { subscribeVisible: noVisibility });
    await vi.advanceTimersByTimeAsync(120000);
    expect(onState.mock.calls.map((c) => c[0])).toEqual([
      { status: 'error', message: 'offline' }, { status: 'error', message: 'boom' }, { status: 'ready' },
    ]);
  });

  it('skips the timer reads while the page is hidden', async () => {
    let hidden = false;
    const { load } = setup({ isHidden: () => hidden });
    hidden = true;
    await vi.advanceTimersByTimeAsync(300000);
    expect(load).toHaveBeenCalledTimes(1);
    hidden = false;
    await vi.advanceTimersByTimeAsync(60000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reads once when the page becomes visible after a minute, not before', async () => {
    vi.useFakeTimers();
    let hidden = true;
    let clock = 0;
    let show;
    const load = vi.fn(async () => ({ status: 'ready' }));
    const unsubscribe = vi.fn();
    startFeedPolling(load, vi.fn(), {
      isHidden: () => hidden, now: () => clock,
      subscribeVisible: (cb) => { show = cb; return unsubscribe; },
    });
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    clock = 30000; hidden = false; show();
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    clock = 90000; hidden = false; show();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not read on a visibility event while still hidden, and stops listening on stop', async () => {
    vi.useFakeTimers();
    let show;
    const unsubscribe = vi.fn();
    const load = vi.fn(async () => ({ status: 'ready' }));
    const stop = startFeedPolling(load, vi.fn(), {
      isHidden: () => true, now: () => 10 * 60000, subscribeVisible: (cb) => { show = cb; return unsubscribe; },
    });
    await vi.advanceTimersByTimeAsync(0);
    show();
    expect(load).toHaveBeenCalledTimes(1);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('loadFeedStore', () => {
  const client = (answers) => ({ rpc: vi.fn(async (name) => answers[name]) });
  const SIZES = { data: [{ name: 'database', bytes: 100 }, { name: 'feed_items', bytes: 40 }], error: null };

  it('asks for both reads, with no arguments, and shapes them', async () => {
    const c = client({ feed_admin_status: { data: [raw()], error: null }, db_size: SIZES });
    const out = await loadFeedStore(c);
    expect(c.rpc.mock.calls.map((a) => a.join())).toEqual(['feed_admin_status', 'db_size']);
    expect(out.status).toBe('ready');
    expect(out.rows).toHaveLength(1);
    expect(out.sizes.database).toBe(100);
    expect(out.sizesNote).toBe('');
  });
  it('is "not set up" when the status function is missing', async () => {
    const out = await loadFeedStore(client({
      feed_admin_status: { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }, db_size: SIZES,
    }));
    expect(out).toEqual({ status: 'notSetUp' });
  });
  it('is an error for a refusal, with the message', async () => {
    const out = await loadFeedStore(client({
      feed_admin_status: { data: null, error: { code: '42501', message: 'Only an admin can read the feed store\'s health' } }, db_size: SIZES,
    }));
    expect(out).toEqual({ status: 'error', message: 'Only an admin can read the feed store\'s health' });
  });
  it('is an error when the call throws', async () => {
    const c = { rpc: vi.fn(() => { throw new Error('offline'); }) };
    expect(await loadFeedStore(c)).toEqual({ status: 'error', message: 'offline' });
  });
  it('still shows the modules when only the size read fails', async () => {
    const out = await loadFeedStore(client({
      feed_admin_status: { data: [raw()], error: null }, db_size: { data: null, error: { message: 'nope' } },
    }));
    expect(out.status).toBe('ready');
    expect(out.rows).toHaveLength(1);
    expect(out.sizes).toBeNull();
    expect(out.sizesNote).toMatch(/size could not be read/);
  });
  it('still shows the modules when the size read rejects', async () => {
    const c = { rpc: vi.fn(async (name) => { if (name === 'db_size') throw new Error('x'); return { data: [raw()], error: null }; }) };
    const out = await loadFeedStore(c);
    expect(out.status).toBe('ready');
    expect(out.sizes).toBeNull();
  });
});
