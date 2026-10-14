// F156 (spec section 8.1): Morning Brief, Statement Tracker and Economic Overview counts showed
// "unavailable" because their live source missed the server's 4 s limit, although the late live
// answer reached the server seconds later (measured: Morning Brief answered on its third request).
// A count served from the archive after the limit is now pending: retried after 6 s and 15 s.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadNationalSummaries } from './useNationalLanding.js';
import { loadGlobalSummaries } from './useGlobalLanding.js';
import { loadLawSummaries } from './useLawLanding.js';
import { loadEconomicsSummaries } from './useEconomicsLanding.js';
import { loadCarbonSummaries } from './useCarbonLanding.js';
import { loadSportsSummaries } from './useSportsLanding.js';
import { loadEntertainmentSummaries } from './useEntertainmentLanding.js';
import { featuresToLoad, isPendingCount, PENDING_RETRY_AFTER_MS } from './landingRetry.js';
import { moduleAvailability, summarizeModules } from './landing/deskPresentation.js';

const LOADERS = {
  national: loadNationalSummaries,
  global: loadGlobalSummaries,
  law: loadLawSummaries,
  economics: loadEconomicsSummaries,
  carbon: loadCarbonSummaries,
  sports: loadSportsSummaries,
  entertainment: loadEntertainmentSummaries,
};

const FEATURE = 'Morning Brief';
const pending = (feature = FEATURE) => ({ ok: false, version: 1, feature, resourceKey: feature, count: null, availability: 'error', sourceMode: 'unknown', served: 'archive' });
const counted = (feature = FEATURE) => ({ ok: true, version: 1, feature, resourceKey: feature, count: 219, availability: 'available', sourceMode: 'feed-backed', served: 'live' });
const failed = (feature = FEATURE) => ({ ok: false, version: 1, feature, resourceKey: feature, count: null, availability: 'error', sourceMode: 'unknown' });

// Answers in order, one per request; an answer that is a function is called with the feature.
function scripted(...answers) {
  const calls = [];
  const fetcher = vi.fn(async (url) => {
    const feature = new URL(url, 'http://localhost').searchParams.get('feature');
    calls.push({ feature, at: Date.now() });
    const next = answers.length > 1 ? answers.shift() : answers[0];
    const body = typeof next === 'function' ? next(feature) : next;
    if (body instanceof Error) throw body;
    return { ok: body.ok, json: async () => body };
  });
  return { fetcher, calls };
}

describe.each(Object.entries(LOADERS))('%s landing: pending counts (F156)', (_desk, load) => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows a pending count as loading and asks again after 6 s and 15 s until the live count arrives', async () => {
    const { fetcher, calls } = scripted(pending(), pending(), counted());
    const shown = [];
    const started = Date.now();
    const done = load({ features: [FEATURE], fetcher, onSummary: (s) => shown.push(s) });
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toHaveLength(1);
    expect(shown[0].pending).toBe(true);
    expect(moduleAvailability({ configured: true }, shown[0])).toBe('Loading live count…');

    await vi.advanceTimersByTimeAsync(5999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(9000);
    await done;
    expect(calls.map((c) => c.at - started)).toEqual([0, 6000, 15000]);
    const last = shown.at(-1);
    expect(last.count).toBe(219);
    expect(last.pending).toBeUndefined();
  });

  it('gives up after two retries and shows the count as unavailable', async () => {
    const { fetcher, calls } = scripted(pending());
    const shown = [];
    const done = load({ features: [FEATURE], fetcher, onSummary: (s) => shown.push(s) });
    await vi.advanceTimersByTimeAsync(20000);
    await done;
    expect(calls).toHaveLength(3);
    const last = shown.at(-1);
    expect(last.pending).toBeUndefined();
    expect(moduleAvailability({ configured: true }, last)).toBe('Summary unavailable');
  });

  it('does not retry a real failure or a failed request', async () => {
    for (const answer of [failed(), new Error('offline')]) {
      const { fetcher, calls } = scripted(answer);
      const shown = [];
      const done = load({ features: [FEATURE], fetcher, onSummary: (s) => shown.push(s) });
      await vi.advanceTimersByTimeAsync(20000);
      await done;
      expect(calls).toHaveLength(1);
      expect(shown).toHaveLength(1);
      expect(shown[0].pending).toBeUndefined();
      expect(shown[0].availability).toBe('error');
    }
  });

  it('stops retrying when the page is left', async () => {
    const controller = new AbortController();
    const { fetcher, calls } = scripted(pending());
    const shown = [];
    const done = load({ features: [FEATURE], fetcher, signal: controller.signal, onSummary: (s) => shown.push(s) });
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(20000);
    await done;
    expect(calls).toHaveLength(1);
    expect(shown).toHaveLength(1);
  });
});

describe('pending counts do not hold up the other modules (F156)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('publishes every other module before the pending ones are asked again', async () => {
    // Three pending counts would take all three request slots if their retries waited in them.
    const features = ['A', 'B', 'C', 'D', 'E'];
    const { fetcher } = scripted((feature) => (['A', 'B', 'C'].includes(feature) ? pending(feature) : counted(feature)));
    const shown = [];
    const done = loadGlobalSummaries({ features, fetcher, onSummary: (s) => shown.push(s) });
    await vi.advanceTimersByTimeAsync(0);
    expect(shown.map((s) => s.feature).sort()).toEqual(features);
    await vi.advanceTimersByTimeAsync(20000);
    await done;
  });
});

describe('landing retry helpers (F156)', () => {
  it('a count is pending only when the archive answered it after the live limit', () => {
    expect(isPendingCount(pending())).toBe(true);
    expect(isPendingCount(failed())).toBe(false);
    expect(isPendingCount({ ...counted(), served: 'archive' })).toBe(false);
    expect(PENDING_RETRY_AFTER_MS).toEqual([6000, 15000]);
  });

  it('a desk re-requests pending counts with the missing ones when one module is retried', () => {
    expect(featuresToLoad(['A', 'B', 'C', ''], { A: counted('A'), B: { ...pending('B'), pending: true } })).toEqual(['B', 'C']);
  });

  it('a desk still loading a pending count says so', () => {
    expect(summarizeModules([{ feature: 'A' }], { A: { ...pending('A'), pending: true } }).pending).toBe(1);
  });
});
