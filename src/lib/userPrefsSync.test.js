import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ client: { auth: {} }, listener: null, session: null }));
vi.mock('./supabaseClient.js', () => ({ supabase: auth.client }));
function memoryStorage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k), key: (i) => [...values.keys()][i] ?? null, get length() { return values.size; } };
}
let prefs;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('window', new EventTarget());
  auth.session = { access_token: 'token-a', user: { id: 'a' }, expires_at: Date.now() / 1000 + 3600 };
  auth.client.auth = {
    getSession: vi.fn(async () => ({ data: { session: auth.session } })),
    getUser: vi.fn(async () => ({ data: { user: { id: auth.session?.user.id, email: `${auth.session?.user.id}@example.test` } } })),
    onAuthStateChange: vi.fn((fn) => { auth.listener = fn; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
  };
  auth.client.rpc = vi.fn(async () => ({ data: { user_id: auth.session?.user.id, role: 'user', status: 'active' } }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, email: `${auth.session?.user.id}@example.test`, prefs: { watchlist: null, tours: null } }) })));
  prefs = await import('./userPrefsSync.js');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('preference adapter', () => {
  it('removes the retired localStorage chat copies at startup and never uploads them', async () => {
    localStorage.setItem('niyantranAiChats', JSON.stringify({ chats: [{ id: 'old-account', messages: [{ content: 'private' }] }] }));
    localStorage.setItem('niyantranAiChats:user:a', JSON.stringify({ chats: [{ id: 'owned', messages: [{ content: 'private owned' }] }] }));
    localStorage.setItem('niyPrefsRevision:user:a:aiChats', JSON.stringify({ revision: 'r', dirty: true }));
    localStorage.setItem('niyPrefsRevision:user:a:watchlist', JSON.stringify({ revision: 'w', dirty: false }));
    localStorage.setItem('unrelated', 'keep');
    prefs.startUserPrefsSync();
    await vi.advanceTimersByTimeAsync(1200);
    expect(localStorage.getItem('niyantranAiChats')).toBeNull();
    expect(localStorage.getItem('niyantranAiChats:user:a')).toBeNull();
    expect(localStorage.getItem('niyPrefsRevision:user:a:aiChats')).toBeNull();
    expect(localStorage.getItem('niyPrefsRevision:user:a:watchlist')).not.toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
    expect(fetch.mock.calls.every(([, options]) => options?.method !== 'PUT')).toBe(true);
    expect(fetch.mock.calls[0][1]?.headers?.Authorization).toBe('Bearer token-a');
  });
  it('rejects arbitrary email overrides before network access', async () => {
    await prefs.hydrateUserPrefs('victim@example.test');
    expect(fetch).not.toHaveBeenCalled();
  });
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function switchAccount(id = 'b') {
  auth.session = id ? { access_token: `token-${id}`, user: { id }, expires_at: Date.now() / 1000 + 3600 } : null;
  auth.listener?.(id ? 'SIGNED_IN' : 'SIGNED_OUT', auth.session);
}
function ownResponse(email = 'a@example.test', content = 'account-a') {
  return { ok: true, json: async () => ({ ok: true, email, prefs: { tours: { home: true, desks: { law: true } }, watchlist: [{ tab: 'law', feature: content }] } }) };
}

describe('preference identity races', () => {
  it.each(['absent', 'expired', 'provider-error', 'wrong-user', 'wrong-profile', 'suspended', 'profile-error'])('never requests preferences for %s identity', async (condition) => {
    if (condition === 'absent') auth.session = null;
    if (condition === 'expired') auth.session.expires_at = 1;
    if (condition === 'provider-error') auth.client.auth.getUser.mockRejectedValue(new Error('offline'));
    if (condition === 'wrong-user') auth.client.auth.getUser.mockResolvedValue({ data: { user: { id: 'other', email: 'other@example.test' } } });
    if (condition === 'wrong-profile') auth.client.rpc.mockResolvedValue({ data: { user_id: 'other', status: 'active' } });
    if (condition === 'suspended') auth.client.rpc.mockResolvedValue({ data: { user_id: 'a', status: 'suspended' } });
    if (condition === 'profile-error') auth.client.rpc.mockResolvedValue({ error: new Error('offline') });
    expect((await prefs.hydrateUserPrefs()).ok).toBe(false);
    expect((await prefs.pushPrefs()).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uploads only an explicitly edited hydrated account with a verified bearer', async () => {
    fetch.mockResolvedValueOnce(ownResponse());
    await prefs.hydrateUserPrefs();
    fetch.mockClear();
    (await import('./watchlistStore.js')).saveWatchlist([{ tab: 'law', feature: 'Edited' }]);
    expect(await prefs.pushPrefs()).toEqual({ ok: true });
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer token-a');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('email');
    expect(body).toEqual({ watchlist: [expect.objectContaining({ feature: 'Edited' })] });
    expect(auth.client.auth.getUser).toHaveBeenCalledWith('token-a');
  });
  it('requires successful hydration before explicit upload', async () => {
    expect((await prefs.pushPrefs()).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('clears the watchlist and tours synchronously on account switch and logout', async () => {
    fetch.mockResolvedValueOnce(ownResponse());
    await prefs.hydrateUserPrefs();
    expect(JSON.stringify((await import('./watchlistStore.js')).loadWatchlist())).toContain('account-a');
    switchAccount();
    expect(JSON.stringify((await import('./watchlistStore.js')).loadWatchlist())).not.toContain('account-a');
    expect(localStorage.getItem('niyOnboardHomeDone')).toBeNull();
    expect(localStorage.getItem('niyTour:law')).toBeNull();
    expect((await prefs.pushPrefs()).ok).toBe(false);
    switchAccount(null);
    expect((await prefs.pushPrefs()).ok).toBe(false);
  });
  it('ignores a late A response after B has hydrated', async () => {
    const response = deferred();
    fetch.mockReturnValueOnce(response.promise);
    const old = prefs.hydrateUserPrefs();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    switchAccount();
    fetch.mockResolvedValueOnce(ownResponse('b@example.test', 'account-b'));
    expect((await prefs.hydrateUserPrefs()).ok).toBe(true);
    response.resolve(ownResponse());
    expect((await old).ok).toBe(false);
    expect(JSON.stringify((await import('./watchlistStore.js')).loadWatchlist())).toContain('account-b');
    expect(JSON.stringify((await import('./watchlistStore.js')).loadWatchlist())).not.toContain('account-a');
  });
  it('rejects a response naming a different email', async () => {
    fetch.mockResolvedValueOnce(ownResponse('victim@example.test', 'private-victim'));
    expect((await prefs.hydrateUserPrefs()).ok).toBe(false);
    expect(JSON.stringify((await import('./watchlistStore.js')).loadWatchlist())).not.toContain('private-victim');
    expect((await prefs.pushPrefs()).ok).toBe(false);
  });
  it('does not upload old account data after a switch while verifying push', async () => {
    fetch.mockResolvedValueOnce(ownResponse());
    await prefs.hydrateUserPrefs();
    fetch.mockClear();
    const result = deferred();
    auth.client.auth.getUser.mockReturnValueOnce(result.promise);
    const pending = prefs.pushPrefs();
    await vi.waitFor(() => expect(auth.client.auth.getUser).toHaveBeenCalledTimes(2));
    switchAccount();
    result.resolve({ data: { user: { id: 'a', email: 'a@example.test' } } });
    expect((await pending).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cancels a debounce scheduled by the preceding account', async () => {
    fetch.mockResolvedValueOnce(ownResponse());
    await prefs.hydrateUserPrefs();
    fetch.mockClear();
    vi.useFakeTimers();
    prefs.schedulePrefsPush();
    switchAccount();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('debounces ordinary edits for the same verified account', async () => {
    fetch.mockResolvedValueOnce(ownResponse());
    await prefs.hydrateUserPrefs();
    fetch.mockClear();
    vi.useFakeTimers();
    (await import('./watchlistStore.js')).saveWatchlist([{ tab: 'law', feature: 'Edited' }]);
    prefs.schedulePrefsPush();
    prefs.schedulePrefsPush();
    await vi.advanceTimersByTimeAsync(600);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].method).toBe('PUT');
  });
  it('does not upload old cached data after B gets an empty server response', async () => {
    fetch.mockResolvedValueOnce(ownResponse());
    await prefs.hydrateUserPrefs();
    switchAccount();
    fetch.mockClear();
    await prefs.hydrateUserPrefs();
    expect(fetch).toHaveBeenCalledOnce();
    (await import('./watchlistStore.js')).saveWatchlist([{ tab: 'law', feature: 'Owned B' }]);
    await prefs.pushPrefs();
    expect(fetch.mock.calls[1][1].body).not.toContain('account-a');
  });
  it.each(['offline', 'unauthorized'])('does not upload after hydration fails %s', async (condition) => {
    if (condition === 'offline') fetch.mockRejectedValueOnce(new Error('offline'));
    else fetch.mockResolvedValueOnce({ ok: false, status: 401 });
    expect((await prefs.hydrateUserPrefs()).ok).toBe(false);
    expect((await prefs.pushPrefs()).ok).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('preserves unrelated browser storage when clearing preference working copies', async () => {
    localStorage.setItem('unrelated-work', 'keep');
    await prefs.hydrateUserPrefs();
    switchAccount();
    expect(localStorage.getItem('unrelated-work')).toBe('keep');
  });
  it('same-account newer hydration wins over an earlier response', async () => {
    const response = deferred();
    fetch.mockReturnValueOnce(response.promise);
    const old = prefs.hydrateUserPrefs();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    fetch.mockResolvedValueOnce(ownResponse('a@example.test', 'newest'));
    await prefs.hydrateUserPrefs();
    response.resolve(ownResponse());
    expect((await old).ok).toBe(false);
    expect(JSON.stringify((await import('./watchlistStore.js')).loadWatchlist())).toContain('newest');
  });
});

it('preserves every legacy preference key through hydration, edits, switches and logout', async () => {
  const legacy = {
    niyWatchlist: '[{"feature":"legacy-watch"}]',
    niyOnboardHomeDone: '1', niyTourDesks: '{"legacy":true}', 'niyTour:legacy': '1',
  };
  for (const [key, value] of Object.entries(legacy)) localStorage.setItem(key, value);
  fetch.mockResolvedValueOnce(ownResponse());
  await prefs.hydrateUserPrefs();
  (await import('./watchlistStore.js')).saveWatchlist([{ tab: 'law', feature: 'new-owned' }]);
  switchAccount();
  await prefs.hydrateUserPrefs();
  switchAccount(null);
  for (const [key, value] of Object.entries(legacy)) expect(localStorage.getItem(key)).toBe(value);
  expect(JSON.stringify((await import('./watchlistStore.js')).loadWatchlist())).not.toContain('new-owned');
});

it('shows known owned cache after independently verified identity when network hydration fails', async () => {
  fetch.mockResolvedValueOnce(ownResponse());
  await prefs.hydrateUserPrefs();
  switchAccount('b');
  await prefs.hydrateUserPrefs();
  switchAccount('a');
  fetch.mockRejectedValueOnce(new Error('offline'));
  expect((await prefs.hydrateUserPrefs()).ok).toBe(false);
  expect((await import('./watchlistStore.js')).loadWatchlist()[0].feature).toBe('account-a');
  expect((await import('./onboarding.js')).readToursState().home).toBe(true);
  expect((await prefs.pushPrefs()).ok).toBe(false);
});

it('expiry synchronously unbinds all stores and prevents queued uploads', async () => {
  vi.useFakeTimers();
  auth.session.expires_at = Date.now() / 1000 + 1;
  fetch.mockResolvedValueOnce(ownResponse());
  await prefs.hydrateUserPrefs();
  const owned = localStorage.getItem('niyWatchlist:user:a');
  fetch.mockClear();
  await vi.advanceTimersByTimeAsync(1001);
  expect(JSON.stringify((await import('./watchlistStore.js')).loadWatchlist())).not.toContain('account-a');
  expect((await import('./onboarding.js')).readToursState()).toEqual({ home: false, desks: {} });
  expect((await prefs.pushPrefs()).ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  expect(localStorage.getItem('niyWatchlist:user:a')).toBe(owned);
});

it('empty server hydration neither imports legacy data nor overwrites a known owned cache', async () => {
  localStorage.setItem('niyWatchlist:user:a', '[{"tab":"law","feature":"owned-local"}]');
  localStorage.setItem('niyWatchlist', '[{"tab":"law","feature":"legacy-private"}]');
  await prefs.hydrateUserPrefs();
  expect(fetch).toHaveBeenCalledOnce();
  expect((await import('./watchlistStore.js')).loadWatchlist()[0].feature).toBe('owned-local');
  expect(localStorage.getItem('niyWatchlist')).toContain('legacy-private');
});

it('preserves and resumes a dirty watchlist across same-account token refresh', async () => {
  fetch.mockResolvedValueOnce(ownResponse());
  await prefs.hydrateUserPrefs();
  prefs.startUserPrefsSync();
  vi.useFakeTimers();
  const store = await import('./watchlistStore.js');
  store.saveWatchlist([{ tab: 'law', feature: 'Unsynced edit' }]);
  auth.session = { ...auth.session, access_token: 'fresh-token' };
  auth.listener('TOKEN_REFRESHED', auth.session);
  fetch.mockResolvedValueOnce(ownResponse());
  await vi.advanceTimersByTimeAsync(0);
  expect(store.loadWatchlist()[0].feature).toBe('Unsynced edit');
  await vi.advanceTimersByTimeAsync(600);
  const put = fetch.mock.calls.find(([, options]) => options?.method === 'PUT');
  expect(put[1].headers.Authorization).toBe('Bearer fresh-token');
  expect(Object.keys(JSON.parse(put[1].body))).toEqual(['watchlist']);
  expect(put[1].body).toContain('Unsynced edit');
});

it('a dirty watchlist survives reload while clean tours hydrate', async () => {
  fetch.mockResolvedValueOnce(ownResponse());
  await prefs.hydrateUserPrefs();
  (await import('./watchlistStore.js')).saveWatchlist([{ tab: 'law', feature: 'Durable pending edit' }]);
  vi.resetModules();
  prefs = await import('./userPrefsSync.js');
  fetch.mockClear();
  fetch.mockResolvedValueOnce(ownResponse('a@example.test', 'fresh-server-fields'));
  await prefs.hydrateUserPrefs();
  expect((await import('./watchlistStore.js')).loadWatchlist()[0].feature).toBe('Durable pending edit');
  expect((await import('./onboarding.js')).readToursState().home).toBe(true);
  expect(fetch).toHaveBeenCalledOnce();
  await prefs.pushPrefs();
  expect(Object.keys(JSON.parse(fetch.mock.calls[1][1].body))).toEqual(['watchlist']);
});

it('a local edit made during GET wins while clean fields still hydrate', async () => {
  const response = deferred();
  fetch.mockReturnValueOnce(response.promise);
  const pending = prefs.hydrateUserPrefs();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const store = await import('./watchlistStore.js');
  store.saveWatchlist([{ tab: 'law', feature: 'Created during GET' }]);
  response.resolve(ownResponse('a@example.test', 'server-watchlist'));
  await pending;
  expect(store.loadWatchlist()[0].feature).toBe('Created during GET');
  expect((await import('./onboarding.js')).readToursState().home).toBe(true);
  await prefs.pushPrefs();
  expect(Object.keys(JSON.parse(fetch.mock.calls[1][1].body))).toEqual(['watchlist']);
});

it('an edit made during PUT remains dirty until that revision is acknowledged', async () => {
  fetch.mockResolvedValueOnce(ownResponse());
  await prefs.hydrateUserPrefs();
  const store = await import('./watchlistStore.js');
  const watchlist = store;
  store.saveWatchlist([{ tab: 'law', feature: 'First edit' }]);
  const response = deferred();
  fetch.mockClear();
  fetch.mockReturnValueOnce(response.promise);
  const pending = prefs.pushPrefs();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  store.saveWatchlist([{ tab: 'law', feature: 'Second edit' }]);
  response.resolve({ ok: true });
  await pending;
  expect(watchlist.preferenceRevisions('a').watchlist.dirty).toBe(true);
  expect(watchlist.preferenceRevisions('a').tours.dirty).toBe(false);
  await prefs.pushPrefs();
  expect(fetch.mock.calls[1][1].body).toContain('Second edit');
  expect(watchlist.preferenceRevisions('a').watchlist.dirty).toBe(false);
});

it('failed PUT retains durable edits and later GET cannot overwrite them', async () => {
  fetch.mockResolvedValueOnce(ownResponse());
  await prefs.hydrateUserPrefs();
  const store = await import('./watchlistStore.js');
  store.saveWatchlist([{ tab: 'law', feature: 'Keep after failure' }]);
  fetch.mockRejectedValueOnce(new Error('offline'));
  expect((await prefs.pushPrefs()).ok).toBe(false);
  fetch.mockResolvedValueOnce(ownResponse());
  await prefs.hydrateUserPrefs();
  expect(store.loadWatchlist()[0].feature).toBe('Keep after failure');
  expect((await import('./watchlistStore.js')).preferenceRevisions('a').watchlist.dirty).toBe(true);
});

it('server hydration alone creates no dirty revisions or PUT', async () => {
  fetch.mockResolvedValueOnce(ownResponse());
  await prefs.hydrateUserPrefs();
  const revisions = (await import('./watchlistStore.js')).preferenceRevisions('a');
  expect(Object.values(revisions).every((value) => value.revision === null && !value.dirty)).toBe(true);
  expect(await prefs.pushPrefs()).toMatchObject({ ok: true, source: 'clean' });
  expect(fetch).toHaveBeenCalledOnce();
});

it('resumes persisted dirty fields after verified startup without a new edit', async () => {
  localStorage.setItem('niyWatchlist:user:a', '[{"tab":"law","feature":"Persisted pending"}]');
  localStorage.setItem('niyWatchlist', '[{"tab":"law","feature":"legacy-private"}]');
  const revisions = await import('./watchlistStore.js');
  revisions.markPreferenceEdit('a', 'watchlist');
  await prefs.hydrateUserPrefs();
  prefs.startUserPrefsSync();
  await vi.advanceTimersByTimeAsync(1200);
  const puts = fetch.mock.calls.filter(([, options]) => options?.method === 'PUT');
  expect(puts).toHaveLength(1);
  expect(Object.keys(JSON.parse(puts[0][1].body))).toEqual(['watchlist']);
  expect(puts[0][1].body).toContain('Persisted pending');
  expect(puts[0][1].body).not.toContain('legacy-private');
  expect(revisions.preferenceRevisions('a').watchlist.dirty).toBe(false);
});

it('requeues dirty work when refresh hydration was blocked by an older pending PUT', async () => {
  fetch.mockResolvedValueOnce(ownResponse());
  await prefs.hydrateUserPrefs();
  prefs.startUserPrefsSync();
  const store = await import('./watchlistStore.js');
  store.saveWatchlist([{ tab: 'law', feature: 'First pending' }]);
  const old = deferred();
  fetch.mockReturnValueOnce(old.promise);
  const pending = prefs.pushPrefs();
  await vi.advanceTimersByTimeAsync(0);
  store.saveWatchlist([{ tab: 'law', feature: 'Newest pending' }]);
  auth.session = { ...auth.session, access_token: 'refreshed-token' };
  auth.listener('TOKEN_REFRESHED', auth.session);
  await vi.advanceTimersByTimeAsync(600);
  old.resolve({ ok: true });
  await pending;
  await vi.advanceTimersByTimeAsync(1200);
  const puts = fetch.mock.calls.filter(([, options]) => options?.method === 'PUT');
  expect(puts).toHaveLength(2);
  expect(puts[1][1].body).toContain('Newest pending');
  expect(puts[1][1].headers.Authorization).toBe('Bearer refreshed-token');
  expect((await import('./watchlistStore.js')).preferenceRevisions('a').watchlist.dirty).toBe(false);
});

it('a resumed dirty upload failure does not create a retry loop', async () => {
  localStorage.setItem('niyWatchlist:user:a', '[{"tab":"law","feature":"pending"}]');
  const revisions = await import('./watchlistStore.js');
  revisions.markPreferenceEdit('a', 'watchlist');
  await prefs.hydrateUserPrefs();
  fetch.mockRejectedValueOnce(new Error('offline'));
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1);
  expect(revisions.preferenceRevisions('a').watchlist.dirty).toBe(true);
});

it('draining an old account PUT only resumes the newly verified account dirty fields', async () => {
  fetch.mockResolvedValueOnce(ownResponse());
  await prefs.hydrateUserPrefs();
  prefs.startUserPrefsSync();
  const store = await import('./watchlistStore.js');
  store.saveWatchlist([{ tab: 'law', feature: 'Private A pending' }]);
  const old = deferred();
  fetch.mockReturnValueOnce(old.promise);
  const pending = prefs.pushPrefs();
  await vi.advanceTimersByTimeAsync(0);
  localStorage.setItem('niyWatchlist:user:b', '[{"tab":"law","feature":"Private B pending"}]');
  const revisions = await import('./watchlistStore.js');
  revisions.markPreferenceEdit('b', 'watchlist');
  switchAccount('b');
  await vi.advanceTimersByTimeAsync(600);
  old.resolve({ ok: true });
  await pending;
  await vi.advanceTimersByTimeAsync(1200);
  const puts = fetch.mock.calls.filter(([, options]) => options?.method === 'PUT');
  expect(puts).toHaveLength(2);
  expect(puts[1][1].headers.Authorization).toBe('Bearer token-b');
  expect(puts[1][1].body).toContain('Private B pending');
  expect(puts[1][1].body).not.toContain('Private A pending');
  expect(revisions.preferenceRevisions('a').watchlist.dirty).toBe(true);
  expect(revisions.preferenceRevisions('b').watchlist.dirty).toBe(false);
});
