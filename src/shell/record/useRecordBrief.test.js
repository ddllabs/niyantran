// F123: useRecordBrief asks for the record's stored brief when its panel opens, polls every two
// seconds while another viewer's request is writing it, gives up after about a minute, aborts on
// unmount or a new record, and never shows the previous record's brief.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ values: [], index: 0, effect: null, deps: null, cleanup: null }));
vi.mock('react', async (original) => ({
  ...await original(),
  useState: (init) => {
    const i = hooks.index++;
    if (!(i in hooks.values)) hooks.values[i] = typeof init === 'function' ? init() : init;
    return [hooks.values[i], (v) => { hooks.values[i] = typeof v === 'function' ? v(hooks.values[i]) : v; }];
  },
  useEffect: (fn, deps) => {
    if (!hooks.deps || deps.some((v, i) => v !== hooks.deps[i])) {
      hooks.cleanup?.(); hooks.effect = fn; hooks.deps = deps;
    }
  },
}));
vi.mock('../../lib/deskBrief.js', () => ({ entryFingerprintFnv: (row) => JSON.stringify(row), getRecordBrief: vi.fn() }));
import { getRecordBrief } from '../../lib/deskBrief.js';
import { RECORD_BRIEF_POLL_MS, RECORD_BRIEF_SLOW_MS, RECORD_BRIEF_WAIT_MS, useRecordBrief } from './useRecordBrief.js';

const feed = { feature: 'Open Fronts', tier: 'geopolitics' };
const READY = { state: 'ready', headline: 'H', points: ['a'], model: 'm/x', writtenAt: '2026-10-15T06:00:00Z' };
function Render(selected, loading = false) { hooks.index = 0; return useRecordBrief({ feed, selected, loading }); }
function effects() { if (hooks.effect) { const fn = hooks.effect; hooks.effect = null; hooks.cleanup = fn(); } }
const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

beforeEach(() => {
  hooks.cleanup?.();
  Object.assign(hooks, { values: [], index: 0, effect: null, deps: null, cleanup: null });
  getRecordBrief.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it('starts in loading, then shows the stored brief from one request', async () => {
  getRecordBrief.mockResolvedValueOnce(READY);
  expect(Render({ id: 'a' })).toEqual({ state: 'loading' });
  effects(); await settle();
  expect(Render({ id: 'a' })).toEqual(READY);
  expect(getRecordBrief).toHaveBeenCalledTimes(1);
  expect(getRecordBrief.mock.calls[0][0]).toMatchObject({ tier: 'geopolitics', feature: 'Open Fronts', row: { id: 'a' } });
});

// F205: a stored brief comes back quickly; an answer still out after 1.2 s is being written.
it('says it is writing once the answer takes longer than a stored read, and never for a quick one', async () => {
  expect(RECORD_BRIEF_SLOW_MS).toBe(1200);
  let answer;
  getRecordBrief.mockReturnValueOnce(new Promise((r) => { answer = r; }));
  expect(Render({ id: 'a' })).toEqual({ state: 'loading' });
  effects();
  await vi.advanceTimersByTimeAsync(1199);
  expect(Render({ id: 'a' })).toEqual({ state: 'loading' });
  await vi.advanceTimersByTimeAsync(1);
  expect(Render({ id: 'a' })).toEqual({ state: 'writing' });
  answer(READY); await settle();
  expect(Render({ id: 'a' })).toEqual(READY);
  // A quick answer: never "writing".
  getRecordBrief.mockResolvedValueOnce(READY);
  expect(Render({ id: 'b' })).toEqual({ state: 'loading' });
  effects(); await settle();
  expect(Render({ id: 'b' })).toEqual(READY);
  await vi.advanceTimersByTimeAsync(2000);
  expect(Render({ id: 'b' })).toEqual(READY);
});

it('does not carry "writing" back to a record after a quick visit elsewhere', async () => {
  getRecordBrief.mockReturnValueOnce(new Promise(() => {}));
  Render({ id: 'a' }); effects();
  await vi.advanceTimersByTimeAsync(1300);
  expect(Render({ id: 'a' })).toEqual({ state: 'writing' });
  getRecordBrief.mockResolvedValueOnce(READY);
  Render({ id: 'b' }); effects(); await settle();
  expect(Render({ id: 'b' })).toEqual(READY);
  getRecordBrief.mockReturnValueOnce(new Promise(() => {}));
  expect(Render({ id: 'a' })).toEqual({ state: 'loading' });
});

it('polls every two seconds while pending, then shows the brief', async () => {
  expect(RECORD_BRIEF_POLL_MS).toBe(2000);
  getRecordBrief.mockResolvedValueOnce({ state: 'pending' }).mockResolvedValueOnce({ state: 'pending' }).mockResolvedValueOnce(READY);
  Render({ id: 'a' }); effects(); await settle();
  expect(Render({ id: 'a' }).state).toBe('pending');
  await vi.advanceTimersByTimeAsync(1999); expect(getRecordBrief).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); await settle(); expect(getRecordBrief).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000); await settle();
  expect(getRecordBrief).toHaveBeenCalledTimes(3);
  expect(Render({ id: 'a' })).toEqual(READY);
});

it('gives up after about a minute of pending, as an error', async () => {
  expect(RECORD_BRIEF_WAIT_MS).toBe(60_000);
  getRecordBrief.mockResolvedValue({ state: 'pending' });
  Render({ id: 'a' }); effects(); await settle();
  await vi.advanceTimersByTimeAsync(61_000); await settle();
  expect(Render({ id: 'a' })).toEqual({ state: 'error' });
  const calls = getRecordBrief.mock.calls.length;
  expect(calls).toBeGreaterThan(25);
  expect(calls).toBeLessThanOrEqual(31);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(getRecordBrief.mock.calls.length).toBe(calls);
});

it('shows unavailable and error states, and a thrown lookup as an error', async () => {
  getRecordBrief.mockResolvedValueOnce({ state: 'unavailable' });
  Render({ id: 'a' }); effects(); await settle();
  expect(Render({ id: 'a' })).toEqual({ state: 'unavailable' });
  getRecordBrief.mockRejectedValueOnce(new Error('offline'));
  Render({ id: 'b' }); effects(); await settle();
  expect(Render({ id: 'b' })).toEqual({ state: 'error' });
});

it('aborts and stops polling when the record changes or the panel closes; never shows the old brief', async () => {
  getRecordBrief.mockResolvedValueOnce({ state: 'pending' });
  Render({ id: 'a' }); effects(); await settle();
  const signalA = getRecordBrief.mock.calls[0][0].signal;
  getRecordBrief.mockResolvedValueOnce(READY);
  expect(Render({ id: 'b' })).toEqual({ state: 'loading' });
  effects();
  expect(signalA.aborted).toBe(true);
  await settle();
  expect(Render({ id: 'b' })).toEqual(READY);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(getRecordBrief).toHaveBeenCalledTimes(2);
  expect(Render(null)).toEqual({ state: 'none' });
  effects();
  expect(getRecordBrief.mock.calls[1][0].signal.aborted).toBe(true);
  expect(Render({ id: 'b' }, true)).toEqual({ state: 'none' });
});

it('makes no further request when the panel closes while a pending answer is in flight', async () => {
  let answer;
  getRecordBrief.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
  Render({ id: 'a' }); effects();
  expect(Render(null)).toEqual({ state: 'none' });
  effects();
  expect(getRecordBrief.mock.calls[0][0].signal.aborted).toBe(true);
  // The answer lands after the abort: the poll's sleep must see the signal already aborted.
  answer({ state: 'pending' }); await settle();
  await vi.advanceTimersByTimeAsync(10_000); await settle();
  expect(getRecordBrief).toHaveBeenCalledTimes(1);
});

it('makes no request for a source-status row or while the feed loads', () => {
  expect(Render({ status: 'source_status' })).toEqual({ state: 'none' }); effects();
  expect(Render({ id: 'a' }, true)).toEqual({ state: 'none' }); effects();
  expect(getRecordBrief).not.toHaveBeenCalled();
});
