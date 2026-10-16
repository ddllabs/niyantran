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
import { clearRecordBriefCache, RECORD_BRIEF_ANIMATION_MS, RECORD_BRIEF_POLL_MS, RECORD_BRIEF_WAIT_MS, useRecordBrief } from './useRecordBrief.js';

const feed = { feature: 'Open Fronts', tier: 'geopolitics' };
const READY = { state: 'ready', headline: 'H', points: ['a'], model: 'm/x', writtenAt: '2026-10-15T06:00:00Z' };
// `record` is checked on its own below; the other tests compare the state.
function Render(selected, loading = false) { hooks.index = 0; const { record, ...state } = useRecordBrief({ feed, selected, loading }); return state; }
function RecordOf(selected) { hooks.index = 0; return useRecordBrief({ feed, selected, loading: false }).record; }
function effects() { if (hooks.effect) { const fn = hooks.effect; hooks.effect = null; hooks.cleanup = fn(); } }
const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

beforeEach(() => {
  hooks.cleanup?.();
  Object.assign(hooks, { values: [], index: 0, effect: null, deps: null, cleanup: null });
  getRecordBrief.mockReset();
  clearRecordBriefCache();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

// F214 (owner 2026-10-16): the animation plays every time a record's brief is shown, whether it is
// stored, written now or seen earlier this session; the brief appears when the 2.5 s have run.
const reveal = () => vi.advanceTimersByTimeAsync(RECORD_BRIEF_ANIMATION_MS);

it('starts in loading, then shows the stored brief from one request once the animation has run', async () => {
  getRecordBrief.mockResolvedValueOnce(READY);
  expect(Render({ id: 'a' })).toEqual({ state: 'loading' });
  effects(); await settle();
  expect(Render({ id: 'a' })).toEqual({ state: 'loading' });
  await vi.advanceTimersByTimeAsync(RECORD_BRIEF_ANIMATION_MS - 1);
  expect(Render({ id: 'a' })).toEqual({ state: 'loading' });
  await vi.advanceTimersByTimeAsync(1);
  expect(Render({ id: 'a' })).toEqual(READY);
  expect(getRecordBrief).toHaveBeenCalledTimes(1);
  expect(getRecordBrief.mock.calls[0][0]).toMatchObject({ tier: 'geopolitics', feature: 'Open Fronts', row: { id: 'a' }, mode: 'read' });
});

// Owner 2026-10-16: the writing look only while a brief is really written. The panel reads first; a
// read never writes. Only when nothing is stored does it say it is writing and ask for the write.
it('reads first; when nothing is stored it says it is writing and then asks for the write', async () => {
  let written;
  getRecordBrief.mockResolvedValueOnce({ state: 'missing' }).mockReturnValueOnce(new Promise((r) => { written = r; }));
  expect(Render({ id: 'a' })).toEqual({ state: 'loading' });
  effects(); await settle();
  expect(Render({ id: 'a' })).toEqual({ state: 'writing' });
  expect(getRecordBrief.mock.calls[0][0].mode).toBe('read');
  expect(getRecordBrief.mock.calls[1][0].mode).toBeUndefined();
  written(READY); await settle();
  // F211: a write that lands early waits for the client's 2.5 s animation to finish.
  expect(RECORD_BRIEF_ANIMATION_MS).toBe(2500);
  expect(Render({ id: 'a' })).toEqual({ state: 'writing' });
  await vi.advanceTimersByTimeAsync(2499);
  expect(Render({ id: 'a' })).toEqual({ state: 'writing' });
  await vi.advanceTimersByTimeAsync(1);
  expect(Render({ id: 'a' })).toEqual(READY);
  expect(getRecordBrief).toHaveBeenCalledTimes(2);
});

it('shows a write that took longer than the animation as soon as it lands', async () => {
  let written;
  getRecordBrief.mockResolvedValueOnce({ state: 'missing' }).mockReturnValueOnce(new Promise((r) => { written = r; }));
  Render({ id: 'a' }); effects(); await settle();
  await vi.advanceTimersByTimeAsync(3200);
  written(READY); await settle();
  expect(Render({ id: 'a' })).toEqual(READY);
});

it('waits for the animation even when the stored brief arrives at once', async () => {
  getRecordBrief.mockResolvedValueOnce(READY);
  Render({ id: 'a' }); effects(); await settle();
  await vi.advanceTimersByTimeAsync(1000);
  expect(Render({ id: 'a' })).toEqual({ state: 'loading' });
  await vi.advanceTimersByTimeAsync(1500);
  expect(Render({ id: 'a' })).toEqual(READY);
});

it('never says it is writing for a stored brief, however slowly it arrives', async () => {
  let read;
  getRecordBrief.mockReturnValueOnce(new Promise((r) => { read = r; }));
  Render({ id: 'a' }); effects();
  await vi.advanceTimersByTimeAsync(5000);
  expect(Render({ id: 'a' })).toEqual({ state: 'loading' });
  read(READY); await settle();
  expect(Render({ id: 'a' })).toEqual(READY);
});

it('plays the animation again for a brief seen this session, without asking again', async () => {
  getRecordBrief.mockResolvedValueOnce(READY);
  Render({ id: 'a' }); effects(); await settle(); await reveal();
  expect(Render({ id: 'a' })).toEqual(READY);
  getRecordBrief.mockResolvedValueOnce({ ...READY, headline: 'B' });
  Render({ id: 'b' }); effects(); await settle(); await reveal();
  expect(Render({ id: 'a' })).toEqual({ state: 'loading' });
  effects(); await settle();
  expect(Render({ id: 'a' })).toEqual({ state: 'loading' });
  await reveal();
  expect(Render({ id: 'a' })).toEqual(READY);
  expect(getRecordBrief).toHaveBeenCalledTimes(2);
});

it('replays the animation for a record reopened before the next one finished its animation', async () => {
  getRecordBrief.mockResolvedValue(READY);
  Render({ id: 'a' }); effects(); await settle(); await reveal();
  Render({ id: 'b' }); effects(); await settle();
  await vi.advanceTimersByTimeAsync(1000);
  expect(Render({ id: 'a' })).toEqual({ state: 'loading' });
  effects(); await settle();
  await vi.advanceTimersByTimeAsync(RECORD_BRIEF_ANIMATION_MS - 1);
  expect(Render({ id: 'a' })).toEqual({ state: 'loading' });
  await vi.advanceTimersByTimeAsync(1);
  expect(Render({ id: 'a' })).toEqual(READY);
});

it('names the record each state belongs to, so the card can restart the animation for a new one', async () => {
  getRecordBrief.mockResolvedValue(READY);
  const a = RecordOf({ id: 'a' }); effects(); await settle();
  expect(a).toBeTruthy();
  expect(RecordOf({ id: 'b' })).not.toBe(a);
  expect(RecordOf({ id: 'a' })).toBe(a);
  expect(RecordOf(null)).toBeUndefined();
});

it('a write that loses the race to another request reads until that brief lands', async () => {
  getRecordBrief.mockResolvedValueOnce({ state: 'missing' }).mockResolvedValueOnce({ state: 'pending' }).mockResolvedValueOnce(READY);
  Render({ id: 'a' }); effects(); await settle();
  expect(Render({ id: 'a' })).toEqual({ state: 'writing' });
  await vi.advanceTimersByTimeAsync(2000); await settle();
  await vi.advanceTimersByTimeAsync(500);
  expect(Render({ id: 'a' })).toEqual(READY);
  expect(getRecordBrief.mock.calls.map((c) => c[0].mode)).toEqual(['read', undefined, 'read']);
});

it('remembers only a ready brief: a record that failed is asked again next time', async () => {
  getRecordBrief.mockResolvedValueOnce({ state: 'unavailable' });
  Render({ id: 'a' }); effects(); await settle();
  getRecordBrief.mockResolvedValueOnce(READY);
  Render({ id: 'b' }); effects(); await settle();
  getRecordBrief.mockResolvedValueOnce(READY);
  expect(Render({ id: 'a' })).toEqual({ state: 'loading' });
  effects(); await settle(); await reveal();
  expect(Render({ id: 'a' })).toEqual(READY);
  expect(getRecordBrief).toHaveBeenCalledTimes(3);
});

it('polls every two seconds while pending, then shows the brief', async () => {
  expect(RECORD_BRIEF_POLL_MS).toBe(2000);
  getRecordBrief.mockResolvedValueOnce({ state: 'pending' }).mockResolvedValueOnce({ state: 'pending' }).mockResolvedValueOnce(READY);
  Render({ id: 'a' }); effects(); await settle();
  // Another request is writing it: that is a real write, and the polls only read.
  expect(Render({ id: 'a' }).state).toBe('writing');
  await vi.advanceTimersByTimeAsync(1999); expect(getRecordBrief).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); await settle(); expect(getRecordBrief).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000); await settle();
  expect(getRecordBrief).toHaveBeenCalledTimes(3);
  expect(getRecordBrief.mock.calls.every((c) => c[0].mode === 'read')).toBe(true);
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
  Render({ id: 'a' }); effects(); await settle(); await reveal();
  expect(Render({ id: 'a' })).toEqual({ state: 'unavailable' });
  getRecordBrief.mockRejectedValueOnce(new Error('offline'));
  Render({ id: 'b' }); effects(); await settle(); await reveal();
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
  await settle(); await reveal();
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
