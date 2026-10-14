// F169 phase 4, C5: the pure side of the admin screen's feed-store section.
import { describe, expect, it, vi } from 'vitest';
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
  sortFeedRows, formatInterval } from './feedAdmin.js';

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
  it('recognises a missing function', () => {
    expect(isNotSetUp({ code: 'PGRST202', message: 'x' })).toBe(true);
    expect(isNotSetUp({ code: '42883', message: 'x' })).toBe(true);
    expect(isNotSetUp({ message: 'Could not find the function public.feed_admin_status without parameters in the schema cache' })).toBe(true);
  });
  it('does not take a refusal or a network failure for it', () => {
    expect(isNotSetUp({ code: '42501', message: 'Only an admin can read the feed store\'s health' })).toBe(false);
    expect(isNotSetUp({ message: 'Failed to fetch' })).toBe(false);
    expect(isNotSetUp(null)).toBe(false);
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
