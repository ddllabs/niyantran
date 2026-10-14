// F159: a module page answered from stored records while live data loads (`served: 'archive'`) asks
// again, as a landing count does: with nothing to show, after 6 s and 15 s, then it gives up; with
// stored records on screen, once after 8 s, swapping in live records if they have arrived.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PENDING_RETRY_AFTER_MS } from './landingRetry.js';
import {
  STORED_RETRY_AFTER_MS,
  followUpLive,
  liveFollowUpKind,
  liveHoldState,
} from './moduleLiveRetry.js';

const STATUS = { status: 'source_status', title: 'Source offline or empty' };
const pending = { ok: false, rows: [STATUS], source: { note: 'Live data is taking longer than usual.' }, served: 'archive' };
const stored = { ok: true, rows: [{ title: 'Stored' }], fallback: true, source: { note: 'Showing the latest stored records. Live data is still loading.' }, served: 'archive' };
const live = { ok: true, rows: [{ title: 'Live' }], fallback: false, source: { note: 'Live PIB' }, served: 'live' };
const failed = { ok: false, rows: [STATUS], source: { note: 'Source offline.' }, served: 'live' };

function run(first, answers) {
  const calls = [];
  const published = [];
  const refetch = vi.fn(async () => {
    calls.push(Date.now());
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next instanceof Error) throw next;
    return next;
  });
  const ac = new AbortController();
  const done = followUpLive({ first, refetch, signal: ac.signal, publish: (b) => published.push(b) });
  return { calls, published, refetch, ac, done, started: Date.now() };
}

describe('which answers are followed up', () => {
  it('only answers served from stored records, not paged pages or genuine failures', () => {
    expect(liveFollowUpKind(pending)).toBe('pending');
    expect(liveFollowUpKind({ ...pending, rows: [] })).toBe('pending');
    expect(liveFollowUpKind(stored)).toBe('stored');
    expect(liveFollowUpKind(live)).toBeNull();
    expect(liveFollowUpKind(failed)).toBeNull();
    expect(liveFollowUpKind({ ...failed, served: undefined })).toBeNull();
    expect(liveFollowUpKind({ ...stored, paged: true })).toBeNull();
    expect(liveFollowUpKind({ ...pending, paged: true, rows: [] })).toBeNull();
    expect(liveFollowUpKind(null)).toBeNull();
  });

  it('names how a page with nothing to show holds', () => {
    expect(liveHoldState(pending)).toBe('wait');
    expect(liveHoldState({ ...pending, liveGaveUp: true })).toBe('gaveUp');
    expect(liveHoldState(stored)).toBeNull();
    expect(liveHoldState({ ...stored, liveGaveUp: true })).toBeNull();
    expect(liveHoldState(failed)).toBeNull();
    expect(liveHoldState({ ...pending, paged: true, rows: [] })).toBeNull();
  });
});

describe('followUpLive (F159)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses the landing counts’ schedule for a page with nothing to show', () => {
    expect(PENDING_RETRY_AFTER_MS).toEqual([6000, 15000]);
    expect(STORED_RETRY_AFTER_MS).toBe(8000);
  });

  it('asks again 6 s and 15 s after the first answer and shows the live rows when they arrive', async () => {
    const r = run(pending, [pending, live]);
    await vi.advanceTimersByTimeAsync(5999);
    expect(r.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.calls).toEqual([r.started + 6000]);
    expect(r.published).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(9000);
    expect(r.calls).toEqual([r.started + 6000, r.started + 15000]);
    await r.done;
    expect(r.published).toEqual([{ ...live, updatedLive: true }]);
  });

  it('gives up after the 15 s request when live data still has not arrived', async () => {
    const r = run(pending, [pending]);
    await vi.advanceTimersByTimeAsync(60000);
    await r.done;
    expect(r.refetch).toHaveBeenCalledTimes(2);
    expect(r.published).toEqual([{ ...pending, liveGaveUp: true }]);
    expect(liveHoldState(r.published[0])).toBe('gaveUp');
  });

  it('a failed retry request counts as still waiting', async () => {
    const r = run(pending, [new TypeError('Failed to fetch'), live]);
    await vi.advanceTimersByTimeAsync(15000);
    await r.done;
    expect(r.published).toEqual([{ ...live, updatedLive: true }]);
  });

  it('stops when the reader leaves the module', async () => {
    const r = run(pending, [pending]);
    await vi.advanceTimersByTimeAsync(6000);
    expect(r.calls).toHaveLength(1);
    r.ac.abort();
    await vi.advanceTimersByTimeAsync(60000);
    await r.done;
    expect(r.calls).toHaveLength(1);
    expect(r.published).toHaveLength(0);
  });

  it('stops before the first request when the reader leaves at once', async () => {
    const r = run(stored, [live]);
    r.ac.abort();
    await vi.advanceTimersByTimeAsync(60000);
    await r.done;
    expect(r.refetch).not.toHaveBeenCalled();
    expect(r.published).toHaveLength(0);
  });

  it('with stored records on screen, asks once after 8 s and swaps in live rows', async () => {
    const r = run(stored, [live]);
    await vi.advanceTimersByTimeAsync(7999);
    expect(r.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await r.done;
    expect(r.calls).toEqual([r.started + 8000]);
    expect(r.published).toEqual([{ ...live, updatedLive: true }]);
  });

  it('keeps the stored records, no longer saying live data is loading, when live has not arrived', async () => {
    const r = run(stored, [stored]);
    await vi.advanceTimersByTimeAsync(60000);
    await r.done;
    expect(r.refetch).toHaveBeenCalledTimes(1);
    expect(r.published).toHaveLength(1);
    expect(r.published[0].rows).toEqual(stored.rows);
    expect(r.published[0].source.note).toBe('Showing the latest stored records.');
    expect(r.published[0].updatedLive).toBeUndefined();
  });

  it('does not retry a genuine failure or a paged answer', async () => {
    for (const first of [failed, live, { ...stored, paged: true }]) {
      const r = run(first, [live]);
      await vi.advanceTimersByTimeAsync(60000);
      await r.done;
      expect(r.refetch).not.toHaveBeenCalled();
      expect(r.published).toHaveLength(0);
    }
  });
});
