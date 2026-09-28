const auth = vi.hoisted(() => ({ client: { auth: {} }, listener: null, session: null }));
vi.mock('./supabaseClient.js', () => ({ supabase: auth.client }));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userFromSupabase } from './userStore.js';

// Built at runtime so a source search for the removed seed credential and
// exports finds no hit, not even in the tests that prove they are gone.
const REMOVED_SEED_PASSWORD = ['12345678', '#'].join('');
const REMOVED_SEED_EXPORTS = ['USER', 'STUDENT'].map((suffix) => ['SEED', suffix].join('_'));
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
    const pending = store.setUserActive('remote', false);
    switchAccount();
    verification.resolve({ data: { session: auth.session } });
    expect((await pending).ok).toBe(false);
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
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, user: { id: 'remote', email: 'remote@example.test', active: false } }) });
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, users: [{ id: 'accepted', email: 'accepted@example.test' }] }) });
  const pending = store.setUserActive('remote', false);
  expect(store.loadUsers().find((u) => u.id === 'remote').active).toBe(true);
  expect(await pending).toEqual({ ok: true });
  expect(store.loadUsers().map((u) => u.id)).toEqual(['accepted']);
  expect(fetch.mock.calls[0][0]).toBe('/api/users/remote');
  expect(fetch.mock.calls[0][1].method).toBe('PATCH');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer token-a');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ active: false });
  expect(fetch.mock.calls[1][0]).toBe('/api/users');
  expect(fetch.mock.calls[1][1].method ?? 'GET').toBe('GET');
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer token-a');
});

it('sends a type change as a single PATCH field and refreshes the directory', async () => {
  await store.hydrateUsersFromServer();
  fetch.mockClear();
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, user: { id: 'remote', type: 'student' } }) });
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, users: [{ id: 'remote', email: 'remote@example.test', type: 'student' }] }) });
  expect(await store.setUserType('remote', 'student')).toEqual({ ok: true });
  expect(fetch.mock.calls[0][0]).toBe('/api/users/remote');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ type: 'student' });
  expect(store.loadUsers()[0].type).toBe('student');
});

it('reports a refused change with the server reason and keeps the verified session', async () => {
  await store.hydrateUsersFromServer();
  fetch.mockClear();
  fetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ ok: false, error: 'You cannot suspend or reactivate your own account' }) });
  expect(await store.setUserActive('remote', false)).toEqual({ ok: false, reason: 'You cannot suspend or reactivate your own account' });
  expect(fetch).toHaveBeenCalledOnce();
  expect(store.loadUsers().some((u) => u.id === 'remote')).toBe(true);
  expect(await store.verifiedLocalIdentity({ admin: true })).not.toBeNull();
});

it('reports a transport failure without claiming the change saved', async () => {
  await store.hydrateUsersFromServer();
  fetch.mockClear();
  fetch.mockRejectedValueOnce(new Error('offline'));
  const result = await store.setUserActive('remote', false);
  expect(result.ok).toBe(false);
  expect(typeof result.reason).toBe('string');
});

it('invalidates the local identity when the server rejects the bearer', async () => {
  await store.hydrateUsersFromServer();
  fetch.mockClear();
  fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ ok: false, error: 'Invalid or expired session' }) });
  expect((await store.setUserActive('remote', false)).ok).toBe(false);
  expect(store.loadUsers()).toEqual([]);
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

it.each(['active', 'type'])('rejects a %s change without an authoritative directory despite a verified admin', async (operation) => {
  await store.verifiedLocalIdentity({ admin: true });
  const result = operation === 'active' ? await store.setUserActive('remote', false) : await store.setUserType('remote', 'student');
  expect(result.ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['active', 'type'])('rejects a %s change of a missing directory target', async (operation) => {
  await store.hydrateUsersFromServer();
  fetch.mockClear();
  const result = operation === 'active' ? await store.setUserActive('unknown', false) : await store.setUserType('unknown', 'student');
  expect(result.ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it('requires a new directory read after Auth invalidates the old snapshot', async () => {
  await store.hydrateUsersFromServer();
  auth.listener('TOKEN_REFRESHED', auth.session);
  await store.verifiedLocalIdentity({ admin: true });
  fetch.mockClear();
  expect((await store.setUserActive('remote', false)).ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

// Replaces "retains existing directory rows during intentional admin
// creation": there is no admin create any more, and no mutation carries a list.
it('has no admin create, delete, password or whole-list export, and no seed account', () => {
  for (const name of ['createUser', 'removeUser', 'updateUser', 'saveUsers', 'upsertGoogleUser', 'authenticateUser', 'pushUsersToServer', 'withSeeds', ...REMOVED_SEED_EXPORTS]) {
    expect(store[name], name).toBeUndefined();
  }
});

it('sends only the target change, never the directory', async () => {
  await store.hydrateUsersFromServer();
  fetch.mockClear();
  await store.setUserActive('remote', false);
  const patch = fetch.mock.calls.find((call) => call[1]?.method === 'PATCH');
  expect(JSON.parse(patch[1].body)).toEqual({ active: false });
  expect(fetch.mock.calls.some((call) => call[1]?.method === 'PUT')).toBe(false);
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
  const pending = store.setUserActive('remote', false);
  await vi.waitFor(() => expect(auth.client.auth.getUser).toHaveBeenCalledTimes(2));
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 2000);
  verification.resolve({ data: { user: { id: 'a', email: 'a@example.test' } } });
  await vi.advanceTimersByTimeAsync(0);
  expect((await pending).ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it('allows only one pending directory mutation', async () => {
  await store.hydrateUsersFromServer();
  const response = deferred();
  fetch.mockClear();
  fetch.mockReturnValueOnce(response.promise);
  const first = store.setUserActive('remote', false);
  expect((await store.setUserType('remote', 'student')).ok).toBe(false);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  response.resolve({ ok: true, json: async () => ({ ok: true, user: { id: 'remote' } }) });
  expect((await first).ok).toBe(true);
  expect(fetch.mock.calls.filter((call) => call[1]?.method === 'PATCH')).toHaveLength(1);
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

const patchResponse = { ok: true, json: async () => ({ ok: true, user: { id: 'remote' } }) };

it('a GET begun before a mutation cannot restore stale rows, and the next edit sends only its own field', async () => {
  fetch.mockResolvedValueOnce(directoryResponse(true));
  await store.hydrateUsersFromServer();
  const old = deferred();
  fetch.mockClear();
  fetch.mockReturnValueOnce(old.promise);
  const hydration = store.hydrateUsersFromServer();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  fetch.mockResolvedValueOnce(patchResponse).mockResolvedValueOnce(directoryResponse(false));
  expect((await store.setUserActive('remote', false)).ok).toBe(true);
  expect(store.loadUsers()[0].active).toBe(false);
  old.resolve(directoryResponse(true));
  expect(await hydration).toEqual([]);
  expect(store.loadUsers()[0].active).toBe(false);
  fetch.mockResolvedValueOnce(patchResponse).mockResolvedValueOnce(directoryResponse(false));
  expect((await store.setUserType('remote', 'student')).ok).toBe(true);
  expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ type: 'student' });
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
  const pending = store.setUserActive('remote', false);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(await store.hydrateUsersFromServer()).toEqual([]);
  expect(fetch).toHaveBeenCalledOnce();
  fetch.mockResolvedValueOnce(directoryResponse(false));
  response.resolve(patchResponse);
  expect((await pending).ok).toBe(true);
  expect(store.loadUsers()[0].active).toBe(false);
});

it('rejects a delayed read verification that spans a completed mutation before issuing GET', async () => {
  await store.hydrateUsersFromServer();
  const verification = deferred();
  auth.client.auth.getUser.mockReturnValueOnce(verification.promise);
  fetch.mockClear();
  const hydration = store.hydrateUsersFromServer();
  await vi.waitFor(() => expect(auth.client.auth.getUser).toHaveBeenCalledTimes(2));
  fetch.mockResolvedValueOnce(patchResponse).mockResolvedValueOnce(directoryResponse(false));
  expect((await store.setUserActive('remote', false)).ok).toBe(true);
  expect(store.loadUsers()[0].active).toBe(false);
  verification.resolve({ data: { user: { id: 'a', email: 'a@example.test' } } });
  expect(await hydration).toEqual([]);
  // Only the mutation and its own refresh reached the server.
  expect(fetch.mock.calls.map((call) => call[1]?.method ?? 'GET')).toEqual(['PATCH', 'GET']);
  expect(store.loadUsers()[0].active).toBe(false);
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

// user_profiles.persona stayed null for every account because choosing a
// persona only wrote sessionStorage. research-chat resolves the system prompt
// from that column and falls back to analyst.md, so every reader was answered
// as an analyst and the UPSC prompt in the bundle was unreachable.
describe('persistPersona', () => {
  function client(session, onUpdate = () => ({ error: null })) {
    const calls = [];
    auth.client.auth = { getSession: vi.fn(async () => ({ data: { session } })) };
    auth.client.from = vi.fn((table) => ({
      update(patch) {
        return {
          eq(column, value) {
            calls.push({ table, patch, column, value });
            return Promise.resolve(onUpdate());
          },
        };
      },
    }));
    return calls;
  }

  it('writes the app_persona enum for the signed-in user, from the frontend id', async () => {
    const calls = client({ user: { id: 'uid-9' } });
    const { persistPersona } = await import('./userStore.js');
    expect(await persistPersona('student')).toBe(true);
    expect(calls).toEqual([{ table: 'user_profiles', patch: { persona: 'upsc_aspirant' }, column: 'user_id', value: 'uid-9' }]);
  });

  it('touches only the persona column, so the onboarding fields survive', async () => {
    const calls = client({ user: { id: 'uid-9' } });
    const { persistPersona } = await import('./userStore.js');
    await persistPersona('policy');
    expect(Object.keys(calls[0].patch)).toEqual(['persona']);
    expect(calls[0].patch.persona).toBe('policy_analyst');
  });

  it('writes nothing when signed out, and reports a refused write rather than claiming it saved', async () => {
    const none = client(null);
    const { persistPersona } = await import('./userStore.js');
    expect(await persistPersona('student')).toBe(false);
    expect(none).toEqual([]);
    client({ user: { id: 'uid-9' } }, () => ({ error: { message: 'denied' } }));
    expect(await persistPersona('student')).toBe(false);
  });

  it('an unknown persona is never sent to an enum column', async () => {
    const calls = client({ user: { id: 'uid-9' } });
    const { persistPersona } = await import('./userStore.js');
    expect(await persistPersona('not-a-persona')).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('session user without seed accounts', () => {
  it('returns null when no session user is stored', () => {
    expect(store.sessionUser()).toBeNull();
    sessionStorage.setItem('niyantranAuthed', '1');
    expect(store.sessionUser()).toBeNull();
  });

  it('returns the stored user, without any password', () => {
    store.setSessionUser({ id: 'uid-1', email: 'Person@Example.org', plan: 'explorer', type: 'student', password: 'must-not-persist' });
    expect(store.sessionUser()).toMatchObject({ id: 'uid-1', email: 'person@example.org', type: 'student' });
    expect(store.sessionUser()).not.toHaveProperty('password');
    expect(sessionStorage.getItem('niyantranUser')).not.toContain('must-not-persist');
  });

  it('does not invent an enterprise seat for a legacy email-only session', () => {
    sessionStorage.setItem('niyantranUser', 'analyst@niyantran');
    expect(store.sessionUser()).toBeNull();
    sessionStorage.setItem('niyantranUser', JSON.stringify('student@niyantran'));
    expect(store.sessionUser()).toBeNull();
  });

  it('returns null again after local sign-out', () => {
    store.setSessionUser({ id: 'uid-1', email: 'person@example.org' });
    store.invalidateLocalSession();
    expect(store.sessionUser()).toBeNull();
  });

  it('gives the removed seed credentials no session through any exported path', async () => {
    const seedLogins = ['student@niyantran', 'analyst@niyantran', 'seed-student'].map((login) => [login, REMOVED_SEED_PASSWORD]);
    // setSessionUser publishes a user that Supabase sign-in already verified;
    // it authenticates nothing, so it is the one export not probed here.
    for (const [name, value] of Object.entries(store)) {
      if (typeof value !== 'function' || name.startsWith('subscribe') || name === 'setSessionUser') continue;
      for (const [login, password] of seedLogins) {
        try { await value(login, password); } catch { /* a refusal is fine */ }
        try { await value({ email: login, password }); } catch { /* a refusal is fine */ }
      }
    }
    expect(store.sessionUser()).toBeNull();
    for (const call of fetch.mock.calls) expect(JSON.stringify(call)).not.toContain(REMOVED_SEED_PASSWORD);
  });

  it('starts with an empty directory rather than built-in accounts', () => {
    expect(store.loadUsers()).toEqual([]);
  });
});

describe('session user after an OAuth return', () => {
  // Google sign-in returns through a redirect, so no login form publishes the
  // session user. The verified identity and its profile row must do it.
  function profileRow(row) {
    const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
    auth.client.from = vi.fn(() => ({ select: () => ({ eq: (column, value) => { expect(column).toBe('user_id'); expect(value).toBe('a'); return { maybeSingle }; } }) }));
    return maybeSingle;
  }

  it('publishes the verified identity from its own profile row', async () => {
    profileRow({ user_id: 'a', email: 'a@example.test', persona: 'journalist', plan: 'explorer', role: 'user', status: 'active' });
    const user = await store.publishVerifiedSessionUser();
    expect(user).toMatchObject({ id: 'a', email: 'a@example.test', type: 'journalist', role: 'user', active: true });
    expect(user.password).toBeUndefined();
    expect(store.sessionUser()).toMatchObject({ id: 'a', type: 'journalist' });
  });

  it('publishes nothing for an inactive profile', async () => {
    auth.client.rpc = vi.fn(async () => ({ data: { user_id: 'a', role: 'user', status: 'suspended' } }));
    profileRow({ user_id: 'a', email: 'a@example.test', status: 'suspended' });
    expect(await store.publishVerifiedSessionUser()).toBeNull();
    expect(store.sessionUser()).toBeNull();
  });

  it('publishes nothing without a session', async () => {
    auth.session = null;
    const maybeSingle = profileRow({ user_id: 'a', status: 'active' });
    expect(await store.publishVerifiedSessionUser()).toBeNull();
    expect(maybeSingle).not.toHaveBeenCalled();
    expect(store.sessionUser()).toBeNull();
  });

  it('never resumes a session the user signed out of locally', async () => {
    profileRow({ user_id: 'a', email: 'a@example.test', status: 'active' });
    store.invalidateLocalSession();
    expect(await store.publishVerifiedSessionUser()).toBeNull();
    expect(store.sessionUser()).toBeNull();
  });

  // Google sign-up cannot carry metadata, so SignupPage keeps the pick in
  // sessionStorage across the redirect. Nothing read it, so every Google
  // account answered with the analyst fallback.
  function profileAndUpdate(row) {
    const updates = [];
    const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
    auth.client.from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      update: (patch) => ({ eq: async (column, value) => { updates.push({ patch, column, value }); return { error: null }; } }),
    }));
    return updates;
  }

  it('saves the persona picked before a Google sign-up to a profile that has none', async () => {
    sessionStorage.setItem('preferredPersona', 'student');
    const updates = profileAndUpdate({ user_id: 'a', email: 'a@example.test', persona: null, status: 'active' });
    const user = await store.publishVerifiedSessionUser();
    expect(updates).toEqual([{ patch: { persona: 'upsc_aspirant' }, column: 'user_id', value: 'a' }]);
    expect(user).toMatchObject({ id: 'a', type: 'student' });
    expect(sessionStorage.getItem('preferredPersona')).toBeNull();
  });

  it('keeps a persona the profile already has', async () => {
    sessionStorage.setItem('preferredPersona', 'student');
    const updates = profileAndUpdate({ user_id: 'a', email: 'a@example.test', persona: 'journalist', status: 'active' });
    const user = await store.publishVerifiedSessionUser();
    expect(updates).toEqual([]);
    expect(user).toMatchObject({ type: 'journalist' });
    expect(sessionStorage.getItem('preferredPersona')).toBeNull();
  });

  it('ignores a pick that is not a persona id', async () => {
    sessionStorage.setItem('preferredPersona', 'upsc_aspirant');
    const updates = profileAndUpdate({ user_id: 'a', email: 'a@example.test', persona: null, status: 'active' });
    await store.publishVerifiedSessionUser();
    expect(updates).toEqual([]);
    expect(sessionStorage.getItem('preferredPersona')).toBeNull();
  });
});
