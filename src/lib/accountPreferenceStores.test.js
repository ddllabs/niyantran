import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function memoryStorage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k), key: (i) => [...values.keys()][i] ?? null, get length() { return values.size; }, snapshot: () => Object.fromEntries(values) };
}
const legacy = {
  niyWatchlist: '[{"tab":"law","feature":"legacy-watch"}]',
  niyantranAiChats: '{"chats":[{"id":"legacy-chat","messages":[{"content":"private legacy"}]}],"activeId":"legacy-chat"}',
  niyOnboardHomeDone: '1',
  niyTourDesks: '{"legacy-desk":true}',
  'niyTour:legacy-desk': '1',
  unrelated: 'preserve',
};
let watchlist, chats, tours;
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', memoryStorage());
  for (const [key, value] of Object.entries(legacy)) localStorage.setItem(key, value);
  [watchlist, chats, tours] = await Promise.all([import('./watchlistStore.js'), import('./aiChatStore.js'), import('./onboarding.js')]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('first reads hide unowned legacy data without changing it', () => {
  expect(chats.loadAiState()).toEqual({ chats: [], activeId: '' });
  expect(watchlist.loadWatchlist().some((row) => row.feature === 'legacy-watch')).toBe(false);
  expect(tours.readToursState()).toEqual({ home: false, desks: {} });
  expect(localStorage.snapshot()).toEqual(legacy);
});

it('unbound demo edits remain ephemeral and preserve every original key', () => {
  chats.createAiChat({ title: 'temporary demo' });
  watchlist.saveWatchlist([{ feature: 'temporary demo' }]);
  tours.markHomeTourDone();
  tours.markDeskTourDone('new-desk');
  expect(localStorage.snapshot()).toEqual(legacy);
});

function bind(id, expiresAt = Date.now() + 3600000) {
  const identity = id ? { id, expiresAt } : null;
  watchlist.setWatchlistOwner(identity);
  chats.setAiChatOwner(identity);
  tours.setToursOwner(identity);
}
function writeAccount(label) {
  chats.createAiChat({ title: label });
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
      'niyPrefsRevision:user:account-a:aiChats', 'niyPrefsRevision:user:account-a:tours', 'niyPrefsRevision:user:account-a:watchlist',
      'niyTours:user:account-a', 'niyWatchlist:user:account-a', 'niyantranAiChats:user:account-a',
    ]);
    expectLegacyUnchanged();
  });
  it('switches accounts without exposing, overwriting, or deleting the other account', () => {
    bind('a');
    writeAccount('owned-a');
    const a = localStorage.snapshot();
    bind('b');
    expect(chats.loadAiState().chats).toEqual([]);
    expect(watchlist.loadWatchlist().some((item) => item.feature === 'owned-a')).toBe(false);
    expect(tours.readToursState()).toEqual({ home: false, desks: {} });
    writeAccount('owned-b');
    for (const [key, value] of Object.entries(a)) expect(localStorage.getItem(key)).toBe(value);
    bind('a');
    expect(chats.loadAiState().chats[0].title).toBe('owned-a');
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
    expect(chats.loadAiState()).toEqual({ chats: [], activeId: '' });
    expect(tours.readToursState()).toEqual({ home: false, desks: {} });
    expect(watchlist.loadWatchlist().some((item) => item.feature === 'owned-a')).toBe(false);
    expect(localStorage.snapshot()).toEqual(stored);
  });
  it('does not restore owned caches from storage alone after a module reload', async () => {
    bind('a');
    writeAccount('owned-a');
    vi.resetModules();
    const restored = await import('./aiChatStore.js');
    expect(restored.loadAiState().chats).toEqual([]);
    restored.setAiChatOwner({ id: 'a', expiresAt: Date.now() + 3600000 });
    expect(restored.loadAiState().chats[0].title).toBe('owned-a');
    expectLegacyUnchanged();
  });
  it('read guards hide expired ownership without timers or deleting the cache', () => {
    vi.useFakeTimers();
    bind('a', Date.now() + 1000);
    writeAccount('owned-a');
    const stored = localStorage.snapshot();
    vi.setSystemTime(Date.now() + 1001);
    expect(chats.loadAiState().chats).toEqual([]);
    expect(watchlist.loadWatchlist().some((item) => item.feature === 'owned-a')).toBe(false);
    expect(tours.readToursState()).toEqual({ home: false, desks: {} });
    expect(localStorage.snapshot()).toEqual(stored);
  });
  it('server apply functions cannot write unbound data into demo or legacy stores', () => {
    chats.applyAiStateFromServer({ chats: [{ id: 'unverified' }] });
    watchlist.applyWatchlistFromServer([{ feature: 'unverified' }]);
    tours.applyToursFromServer({ home: true, desks: { unverified: true } });
    expect(chats.loadAiState().chats).toEqual([]);
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
    const unsubscribe = chats.subscribeAiChats((state) => seen.push(state));
    bind(null);
    expect(seen.at(-1).chats).toEqual([]);
    expect(dirty).not.toHaveBeenCalled();
    unsubscribe();
  });
  it('supports an intentionally empty owned watchlist', () => {
    bind('a');
    watchlist.applyWatchlistFromServer([]);
    expect(watchlist.loadWatchlist()).toEqual([]);
    expectLegacyUnchanged();
  });
  it('ignores delayed message writes for a chat absent from the current account', () => {
    bind('a');
    const a = chats.createAiChat({ title: 'owned-a' }).activeId;
    bind('b');
    writeAccount('owned-b');
    chats.appendAiMessage(a, { role: 'assistant', content: 'late private A content' });
    expect(JSON.stringify(chats.loadAiState())).not.toContain('private A');
    bind('a');
    expect(JSON.stringify(chats.loadAiState())).not.toContain('private A');
    expectLegacyUnchanged();
  });
});
