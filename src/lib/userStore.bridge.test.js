const auth = vi.hoisted(() => ({ client: { auth: {} }, listener: null, session: null }));
vi.mock('./supabaseClient.js', () => ({ supabase: auth.client }));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userFromSupabase } from './userStore.js';

const USER = { id: 'uid-1', email: 'Person@Example.org', created_at: '2026-09-21T00:00:00Z' };

describe('userFromSupabase', () => {
  it('maps the profile persona to the frontend type and normalises plan and email', () => {
    const u = userFromSupabase(USER, { user_id: 'uid-1', first_name: 'Pat', last_name: 'Lee', persona: 'upsc_aspirant', plan: 'professional', role: 'admin', status: 'active', onboarding_complete: true });
    expect(u).toMatchObject({ id: 'uid-1', email: 'person@example.org', name: 'Pat Lee', type: 'student', personaId: 'student', plan: 'pro', role: 'admin', active: true, onboardingComplete: true, supabase: true });
    expect(u.password).toBeUndefined();
  });

  it('falls back to the signup persona when the profile has none, and to the email local part for the name', () => {
    const u = userFromSupabase(USER, { persona: null }, { personaId: 'policy', plan: 'pro', planStatus: 'trial', trialEndsAt: '2026-10-05T00:00:00Z' });
    expect(u.type).toBe('policy');
    expect(u.name).toBe('person');
    expect(u.plan).toBe('explorer');
    expect(u.planStatus).toBe('free');
    expect(u.trialEndsAt).toBeNull();
  });

  it('marks suspended and inactive profiles inactive, and returns null without a user id', () => {
    expect(userFromSupabase(USER, { status: 'suspended' }).active).toBe(false);
    expect(userFromSupabase(USER, { status: 'inactive' }).active).toBe(false);
    expect(userFromSupabase(USER, null).active).toBe(false);
    expect(userFromSupabase(null, {})).toBeNull();
  });
});

function memoryStorage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k), key: (i) => [...values.keys()][i] ?? null, get length() { return values.size; } };
}
let store;
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('window', new EventTarget());
  auth.session = { access_token: 'token-a', user: { id: 'a' }, expires_at: Date.now() / 1000 + 3600 };
  auth.client.auth = {
    getSession: vi.fn(async () => ({ data: { session: auth.session } })),
    getUser: vi.fn(async () => ({ data: { user: { id: auth.session?.user.id, email: 'a@example.test' } } })),
    onAuthStateChange: vi.fn((fn) => { auth.listener = fn; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
  };
  auth.client.rpc = vi.fn(async (name) => ({ data: name === 'is_platform_admin' ? true : { user_id: auth.session?.user.id, role: 'admin', status: 'active' } }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, users: [{ id: 'remote', email: 'remote@example.test' }] }) })));
  store = await import('./userStore.js');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('admin user adapter', () => {
  it('does not upload a browser/server union during hydration', async () => {
    localStorage.setItem('niyantranUsers', JSON.stringify([{ id: 'stale', email: 'stale@example.test' }]));
    const users = await store.hydrateUsersFromServer();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(users.some((u) => u.id === 'stale')).toBe(false);
    expect(fetch.mock.calls[0][1]?.headers?.Authorization).toBe('Bearer token-a');
  });
  it('makes no request without a real session', async () => {
    auth.session = null;
    await store.hydrateUsersFromServer();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('profile authority bridge', () => {
  it('does not elevate plan from signup extras', () => {
    expect(store.userFromSupabase(USER, { user_id: 'uid-1', plan: 'explorer', status: 'active' }, { plan: 'enterprise' }).plan).toBe('explorer');
  });
  it('does not mark a missing profile active', () => {
    expect(store.userFromSupabase(USER, null).active).toBe(false);
  });
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function switchAccount(id = 'b') {
  auth.session = { access_token: `token-${id}`, user: { id }, expires_at: Date.now() / 1000 + 3600 };
  auth.listener?.('SIGNED_IN', auth.session);
}

describe('admin adapter identity races', () => {
  it.each(['expired', 'provider-error', 'suspended', 'ordinary', 'owner', 'wrong-profile', 'rpc-error'])('makes no request for %s', async (condition) => {
    if (condition === 'expired') auth.session.expires_at = 1;
    if (condition === 'provider-error') auth.client.auth.getUser.mockRejectedValue(new Error('offline'));
    if (condition === 'suspended') auth.client.rpc.mockImplementation(async (name) => ({ data: name === 'is_platform_admin' ? true : { user_id: 'a', role: 'admin', status: 'suspended' } }));
    if (condition === 'ordinary' || condition === 'owner') auth.client.rpc.mockImplementation(async (name) => ({ data: name === 'is_platform_admin' ? true : { user_id: 'a', role: condition === 'ordinary' ? 'user' : 'owner', status: 'active' } }));
    if (condition === 'wrong-profile') auth.client.rpc.mockImplementation(async (name) => ({ data: name === 'is_platform_admin' ? true : { user_id: 'other', role: 'admin', status: 'active' } }));
    if (condition === 'rpc-error') auth.client.rpc.mockResolvedValue({ error: new Error('offline') });
    expect(await store.hydrateUsersFromServer()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not publish a late response after account switch', async () => {
    const response = deferred();
    fetch.mockReturnValueOnce(response.promise);
    const pending = store.hydrateUsersFromServer();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    switchAccount();
    response.resolve({ ok: true, json: async () => ({ ok: true, users: [{ id: 'private-a', email: 'secret@example.test' }] }) });
    expect(await pending).toEqual([]);
    expect(store.loadUsers().some((u) => u.id === 'private-a')).toBe(false);
  });
  it('clears exported users immediately on logout', async () => {
    await store.hydrateUsersFromServer();
    expect(store.loadUsers().some((u) => u.id === 'remote')).toBe(true);
    auth.session = null;
    auth.listener('SIGNED_OUT', null);
    expect(store.loadUsers().some((u) => u.id === 'remote')).toBe(false);
    expect(localStorage.getItem('niyantranUsers')).toBeNull();
  });
  it('never sends an edit from A under B after a switch during verification', async () => {
    await store.hydrateUsersFromServer();
    fetch.mockClear();
    const verification = deferred();
    auth.client.auth.getSession.mockReturnValueOnce(verification.promise);
    store.saveUsers([{ id: 'private-a', email: 'a@example.test' }]);
    switchAccount();
    verification.resolve({ data: { session: auth.session } });
    await new Promise(setImmediate);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not retain exported users beyond token expiry', async () => {
    auth.session.expires_at = Date.now() / 1000 + 10;
    await store.hydrateUsersFromServer();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11000);
    expect(store.loadUsers().some((u) => u.id === 'remote')).toBe(false);
    vi.useRealTimers();
  });
});

it('signs out real Auth regardless of the AI backend and immediately invalidates exports', async () => {
  vi.stubEnv('VITE_AI_BACKEND', 'legacy');
  await store.hydrateUsersFromServer();
  auth.client.auth.signOut = vi.fn(async () => ({}));
  store.clearSessionUser();
  expect(auth.client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(store.loadUsers().some((u) => u.id === 'remote')).toBe(false);
});

it('sends explicit admin mutations with a verified bearer and updates from the server only', async () => {
  await store.hydrateUsersFromServer();
  fetch.mockClear();
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, users: [{ id: 'accepted', email: 'accepted@example.test' }] }) });
  store.saveUsers([{ id: 'submitted', email: 'submitted@example.test' }]);
  expect(store.loadUsers().some((u) => u.id === 'submitted')).toBe(false);
  await vi.waitFor(() => expect(store.loadUsers().some((u) => u.id === 'accepted')).toBe(true));
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer token-a');
  expect(fetch.mock.calls[0][1].method).toBe('PUT');
  expect(JSON.parse(fetch.mock.calls[0][1].body).users[0].id).toBe('submitted');
});

it('ignores forged browser export caches and does not persist real exports', async () => {
  localStorage.setItem('niyantranUsers', JSON.stringify([{ id: 'forged', email: 'forged@example.test' }]));
  expect(store.loadUsers().some((u) => u.id === 'forged')).toBe(false);
  await store.hydrateUsersFromServer();
  expect(localStorage.getItem('niyantranUsers')).not.toContain('remote');
});

it('uses no plan or active authority from a mismatched profile', () => {
  expect(store.userFromSupabase(USER, { user_id: 'other', role: 'admin', status: 'active', plan: 'enterprise' })).toMatchObject({ active: false, role: 'user', plan: 'explorer' });
});

it('keeps protected adapters signed out after provider logout failure', async () => {
  await store.hydrateUsersFromServer();
  auth.client.auth.signOut = vi.fn(async () => { throw new Error('offline'); });
  store.clearSessionUser();
  fetch.mockClear();
  expect(await store.hydrateUsersFromServer()).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

it('requires a fresh sign-in after local logout instead of a repeated old-session event', async () => {
  await store.hydrateUsersFromServer();
  auth.client.auth.signOut = vi.fn(async () => { throw new Error('offline'); });
  store.clearSessionUser();
  auth.listener('SIGNED_IN', auth.session);
  expect(await store.hydrateUsersFromServer()).toEqual([]);
  auth.session = { ...auth.session, access_token: 'fresh-sign-in-token' };
  auth.listener('SIGNED_IN', auth.session);
  expect(await store.hydrateUsersFromServer()).toEqual([]);
  expect(await store.resumeLocalIdentityAfterSignIn(auth.session)).not.toBeNull();
  expect((await store.hydrateUsersFromServer()).some((user) => user.id === 'remote')).toBe(true);
});

it.each(['create', 'update', 'remove', 'replace'])('rejects %s without an authoritative directory despite a verified admin', async (operation) => {
  await store.verifiedLocalIdentity({ admin: true });
  if (operation === 'create') expect(store.createUser({ email: 'new@example.test', password: 'fixture-only' }).ok).toBe(false);
  if (operation === 'update') expect(store.updateUser('unknown', { active: false }).ok).toBe(false);
  if (operation === 'remove') expect(store.removeUser('unknown').ok).toBe(false);
  if (operation === 'replace') expect(store.saveUsers(store.loadUsers())).toEqual([]);
  await new Promise(setImmediate);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['update', 'remove'])('rejects %s of a missing directory target', async (operation) => {
  await store.hydrateUsersFromServer();
  fetch.mockClear();
  const result = operation === 'update' ? store.updateUser('unknown', { active: false }) : store.removeUser('unknown');
  expect(result.ok).toBe(false);
  await new Promise(setImmediate);
  expect(fetch).not.toHaveBeenCalled();
});

it('requires a new directory read after Auth invalidates the old snapshot', async () => {
  await store.hydrateUsersFromServer();
  auth.listener('TOKEN_REFRESHED', auth.session);
  await store.verifiedLocalIdentity({ admin: true });
  fetch.mockClear();
  expect(store.updateUser('remote', { active: false }).ok).toBe(false);
  await new Promise(setImmediate);
  expect(fetch).not.toHaveBeenCalled();
});

it('retains existing directory rows during intentional admin creation', async () => {
  await store.hydrateUsersFromServer();
  fetch.mockClear();
  expect(store.createUser({ email: 'new@example.test', password: 'fixture-only' }).ok).toBe(true);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const users = JSON.parse(fetch.mock.calls[0][1].body).users;
  expect(users.map((user) => user.email)).toEqual(['new@example.test', 'remote@example.test']);
});

it('rechecks the snapshot after verification even when the account has not changed', async () => {
  auth.session.expires_at = Date.now() / 1000 + 1;
  await store.hydrateUsersFromServer();
  // The same account now has a longer-lived session; the directory snapshot
  // still expires at its original authorization deadline while verification waits.
  auth.session = { ...auth.session, expires_at: Date.now() / 1000 + 3600 };
  fetch.mockClear();
  const verification = deferred();
  auth.client.auth.getUser.mockReturnValueOnce(verification.promise);
  store.updateUser('remote', { active: false });
  await vi.waitFor(() => expect(auth.client.auth.getUser).toHaveBeenCalledTimes(2));
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 2000);
  verification.resolve({ data: { user: { id: 'a', email: 'a@example.test' } } });
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).not.toHaveBeenCalled();
});

it('allows only one pending directory mutation', async () => {
  await store.hydrateUsersFromServer();
  const response = deferred();
  fetch.mockClear();
  fetch.mockReturnValueOnce(response.promise);
  expect(store.updateUser('remote', { active: false }).ok).toBe(true);
  expect(store.updateUser('remote', { type: 'student' }).ok).toBe(false);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  response.resolve({ ok: true, json: async () => ({ ok: true, users: [] }) });
  await new Promise(setImmediate);
});

it.each(['before-verification', 'after-refresh'])('passive cached SIGNED_IN cannot reopen logout %s', async (condition) => {
  store.subscribeLocalIdentity(() => {});
  if (condition === 'after-refresh') {
    await store.verifiedLocalIdentity();
    auth.session = { ...auth.session, access_token: 'refreshed-unverified' };
    auth.listener('TOKEN_REFRESHED', auth.session);
  }
  auth.client.auth.signOut = vi.fn(async () => { throw new Error('offline'); });
  store.clearSessionUser();
  auth.listener('SIGNED_IN', auth.session);
  expect(await store.verifiedLocalIdentity()).toBeNull();
});

it('failed verification of an explicit resume leaves the logout latch closed', async () => {
  auth.client.auth.signOut = vi.fn(async () => ({}));
  store.clearSessionUser();
  auth.client.auth.getUser.mockRejectedValueOnce(new Error('offline'));
  expect(await store.resumeLocalIdentityAfterSignIn(auth.session)).toBeNull();
  expect(await store.verifiedLocalIdentity()).toBeNull();
});

const directoryResponse = (active) => ({ ok: true, json: async () => ({ ok: true, users: [{ id: 'remote', email: 'remote@example.test', active }] }) });

it('a GET begun before a mutation cannot restore stale rows or undo the saved edit in the next PUT', async () => {
  fetch.mockResolvedValueOnce(directoryResponse(true));
  await store.hydrateUsersFromServer();
  const old = deferred();
  fetch.mockClear();
  fetch.mockReturnValueOnce(old.promise);
  const hydration = store.hydrateUsersFromServer();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  fetch.mockResolvedValueOnce(directoryResponse(false));
  store.updateUser('remote', { active: false });
  await vi.waitFor(() => expect(store.loadUsers()[0].active).toBe(false));
  old.resolve(directoryResponse(true));
  expect(await hydration).toEqual([]);
  expect(store.loadUsers()[0].active).toBe(false);
  fetch.mockResolvedValueOnce(directoryResponse(false));
  expect(store.updateUser('remote', { type: 'student' }).ok).toBe(true);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetch.mock.calls[2][1].body).users[0].active).toBe(false);
});

it('a later directory read wins over an out-of-order earlier response', async () => {
  const old = deferred();
  fetch.mockReturnValueOnce(old.promise);
  const first = store.hydrateUsersFromServer();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  fetch.mockResolvedValueOnce(directoryResponse(false));
  await store.hydrateUsersFromServer();
  old.resolve(directoryResponse(true));
  expect(await first).toEqual([]);
  expect(store.loadUsers()[0].active).toBe(false);
});

it('does not start a directory GET while a mutation is pending', async () => {
  await store.hydrateUsersFromServer();
  const response = deferred();
  fetch.mockClear();
  fetch.mockReturnValueOnce(response.promise);
  store.updateUser('remote', { active: false });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(await store.hydrateUsersFromServer()).toEqual([]);
  expect(fetch).toHaveBeenCalledOnce();
  response.resolve(directoryResponse(false));
  await vi.waitFor(() => expect(store.loadUsers()[0].active).toBe(false));
});

it('rejects a delayed read verification that spans a completed mutation before issuing GET', async () => {
  await store.hydrateUsersFromServer();
  const verification = deferred();
  auth.client.auth.getUser.mockReturnValueOnce(verification.promise);
  fetch.mockClear();
  const hydration = store.hydrateUsersFromServer();
  await vi.waitFor(() => expect(auth.client.auth.getUser).toHaveBeenCalledTimes(2));
  fetch.mockResolvedValueOnce(directoryResponse(false));
  store.updateUser('remote', { active: false });
  await vi.waitFor(() => expect(store.loadUsers()[0].active).toBe(false));
  verification.resolve({ data: { user: { id: 'a', email: 'a@example.test' } } });
  expect(await hydration).toEqual([]);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][1].method).toBe('PUT');
});

it('an obsolete failed GET cannot invalidate a newer authoritative directory', async () => {
  const old = deferred();
  fetch.mockReturnValueOnce(old.promise);
  const first = store.hydrateUsersFromServer();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  fetch.mockResolvedValueOnce(directoryResponse(false));
  await store.hydrateUsersFromServer();
  old.resolve({ ok: false });
  expect(await first).toEqual([]);
  expect(store.loadUsers()[0].active).toBe(false);
});

it('local-only session invalidation synchronously clears authority without any SDK call', async () => {
  await store.hydrateUsersFromServer();
  auth.client.auth.signOut = vi.fn();
  vi.clearAllMocks();
  store.invalidateLocalSession();
  expect(store.loadUsers().some((user) => user.id === 'remote')).toBe(false);
  for (const method of Object.values(auth.client.auth)) expect(method).not.toHaveBeenCalled();
  expect(await store.verifiedLocalIdentity()).toBeNull();
  expect(auth.client.auth.signOut).not.toHaveBeenCalled();
});
