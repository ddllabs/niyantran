import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function memoryStorage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k), key: (i) => [...values.keys()][i] ?? null, get length() { return values.size; }, snapshot: () => Object.fromEntries(values) };
}
const legacy = {
  niyWatchlist: '[{"tab":"law","feature":"legacy-watch"}]',
  niyOnboardHomeDone: '1',
  niyTourDesks: '{"legacy-desk":true}',
  'niyTour:legacy-desk': '1',
  unrelated: 'preserve',
};
let watchlist, tours;
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', memoryStorage());
  for (const [key, value] of Object.entries(legacy)) localStorage.setItem(key, value);
  [watchlist, tours] = await Promise.all([import('./watchlistStore.js'), import('./onboarding.js')]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('first reads hide unowned legacy data without changing it', () => {
  expect(watchlist.loadWatchlist().some((row) => row.feature === 'legacy-watch')).toBe(false);
  expect(tours.readToursState()).toEqual({ home: false, desks: {} });
  expect(localStorage.snapshot()).toEqual(legacy);
});

it('unbound demo edits remain ephemeral and preserve every original key', () => {
  watchlist.saveWatchlist([{ feature: 'temporary demo' }]);
  tours.markHomeTourDone();
  tours.markDeskTourDone('new-desk');
  expect(localStorage.snapshot()).toEqual(legacy);
});

function bind(id, expiresAt = Date.now() + 3600000) {
  const identity = id ? { id, expiresAt } : null;
  watchlist.setWatchlistOwner(identity);
  tours.setToursOwner(identity);
}
function writeAccount(label) {
  watchlist.saveWatchlist([{ feature: label }]);
  tours.markHomeTourDone();
  tours.markDeskTourDone(label);
}
function expectLegacyUnchanged() {
  for (const [key, value] of Object.entries(legacy)) expect(localStorage.getItem(key)).toBe(value);
}

describe('account-bound preference stores', () => {
  it('writes only user ID-specific keys and preserves legacy keys byte for byte', () => {
    bind('account-a');
    writeAccount('owned-a');
    expect(Object.keys(localStorage.snapshot()).filter((key) => !(key in legacy)).sort()).toEqual([
      'niyPrefsRevision:user:account-a:tours', 'niyPrefsRevision:user:account-a:watchlist',
      'niyTours:user:account-a', 'niyWatchlist:user:account-a',
    ]);
    expectLegacyUnchanged();
  });
  it('switches accounts without exposing, overwriting, or deleting the other account', () => {
    bind('a');
    writeAccount('owned-a');
    const a = localStorage.snapshot();
    bind('b');
    expect(watchlist.loadWatchlist().some((item) => item.feature === 'owned-a')).toBe(false);
    expect(tours.readToursState()).toEqual({ home: false, desks: {} });
    writeAccount('owned-b');
    for (const [key, value] of Object.entries(a)) expect(localStorage.getItem(key)).toBe(value);
    bind('a');
    expect(watchlist.loadWatchlist()[0].feature).toBe('owned-a');
    expect(tours.isDeskTourDone('owned-a')).toBe(true);
    expect(tours.isDeskTourDone('owned-b')).toBe(false);
    expectLegacyUnchanged();
  });
  it('unbinds synchronously without deleting owned or legacy caches', () => {
    bind('a');
    writeAccount('owned-a');
    const stored = localStorage.snapshot();
    bind(null);
    expect(tours.readToursState()).toEqual({ home: false, desks: {} });
    expect(watchlist.loadWatchlist().some((item) => item.feature === 'owned-a')).toBe(false);
    expect(localStorage.snapshot()).toEqual(stored);
  });
  it('does not restore owned caches from storage alone after a module reload', async () => {
    bind('a');
    writeAccount('owned-a');
    vi.resetModules();
    const restored = await import('./watchlistStore.js');
    expect(restored.loadWatchlist().some((item) => item.feature === 'owned-a')).toBe(false);
    restored.setWatchlistOwner({ id: 'a', expiresAt: Date.now() + 3600000 });
    expect(restored.loadWatchlist()[0].feature).toBe('owned-a');
    expectLegacyUnchanged();
  });
  it('read guards hide expired ownership without timers or deleting the cache', () => {
    vi.useFakeTimers();
    bind('a', Date.now() + 1000);
    writeAccount('owned-a');
    const stored = localStorage.snapshot();
    vi.setSystemTime(Date.now() + 1001);
    expect(watchlist.loadWatchlist().some((item) => item.feature === 'owned-a')).toBe(false);
    expect(tours.readToursState()).toEqual({ home: false, desks: {} });
    expect(localStorage.snapshot()).toEqual(stored);
  });
  it('server apply functions cannot write unbound data into demo or legacy stores', () => {
    watchlist.applyWatchlistFromServer([{ feature: 'unverified' }]);
    tours.applyToursFromServer({ home: true, desks: { unverified: true } });
    expect(watchlist.loadWatchlist().some((item) => item.feature === 'unverified')).toBe(false);
    expect(tours.readToursState()).toEqual({ home: false, desks: {} });
    expect(localStorage.snapshot()).toEqual(legacy);
  });
  it('notifies subscribers on unbinding without emitting dirty upload events', () => {
    bind('a');
    writeAccount('owned-a');
    const seen = [];
    const dirty = vi.fn();
    window.addEventListener('niy-prefs-dirty', dirty);
    const unsubscribe = watchlist.subscribeWatchlist((list) => seen.push(list));
    bind(null);
    expect(seen.at(-1).some((item) => item.feature === 'owned-a')).toBe(false);
    expect(dirty).not.toHaveBeenCalled();
    unsubscribe();
  });
  it('supports an intentionally empty owned watchlist', () => {
    bind('a');
    watchlist.applyWatchlistFromServer([]);
    expect(watchlist.loadWatchlist()).toEqual([]);
    expectLegacyUnchanged();
  });
});
