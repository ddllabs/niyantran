// F13 (docs/specs/2026-09-29-f13-transient-identity-failure.md): a transient
// failure (network, 5xx) refuses the request but keeps the identity; only an
// authoritative answer (signed out, inactive, another user, a rejected token)
// announces that nobody is signed in.
const auth = vi.hoisted(() => ({ client: { auth: {} }, session: null }));
vi.mock('./supabaseClient.js', () => ({ supabase: auth.client }));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PROFILE = { user_id: 'a', role: 'admin', status: 'active' };
const networkError = () => new TypeError('Failed to fetch');
const retryable = (status) => Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError', status });
const apiError = (status) => Object.assign(new Error('invalid JWT'), { name: 'AuthApiError', status });

let store;
let listener;
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('window', new EventTarget());
  auth.session = { access_token: 'token-a', user: { id: 'a' }, expires_at: Date.now() / 1000 + 3600 };
  auth.client.auth = {
    getSession: vi.fn(async () => ({ data: { session: auth.session } })),
    getUser: vi.fn(async () => ({ data: { user: { id: 'a', email: 'a@example.test' } } })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  };
  auth.client.rpc = vi.fn(async (name) => ({ data: name === 'is_platform_admin' ? true : PROFILE, error: null, status: 200 }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, users: [] }) })));
  store = await import('./userStore.js');
  // A first successful verification announces the identity; count from here.
  expect(await store.verifiedLocalIdentity()).toMatchObject({ id: 'a' });
  listener = vi.fn();
  store.subscribeLocalIdentity(listener);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('transient failures refuse the request but keep the identity', () => {
  it.each([
    ['get_my_profile rejects with a network error', () => { auth.client.rpc.mockRejectedValueOnce(networkError()); }],
    ['get_my_profile answers 503', () => {
      auth.client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Service Unavailable', code: '' }, status: 503 });
    }],
    ['get_my_profile fails with status 0 (fetch failed inside the client)', () => {
      auth.client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: fetch failed', code: '' }, status: 0 });
    }],
    ['getUser fails with AuthRetryableFetchError', () => {
      auth.client.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: retryable(0) });
    }],
    ['getUser answers 502', () => {
      auth.client.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: retryable(502) });
    }],
  ])('%s', async (_label, arrange) => {
    arrange();
    expect(await store.verifiedLocalIdentity()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    expect(store.lastIdentityFailure()).toBe('transient');
    expect(store.identityRefusalMessage('Sign in again.')).toBe('Connection problem. Try again.');
    // The identity is intact: the next check succeeds without a new announcement.
    expect(await store.verifiedLocalIdentity()).toMatchObject({ id: 'a' });
    expect(listener).not.toHaveBeenCalled();
    expect(store.lastIdentityFailure()).toBeNull();
  });

  it('localIdentityIsCurrent returns false without announcing when getSession throws a network error', async () => {
    const identity = await store.verifiedLocalIdentity();
    auth.client.auth.getSession.mockRejectedValueOnce(networkError());
    expect(await store.localIdentityIsCurrent(identity)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(store.lastIdentityFailure()).toBe('transient');
    expect(await store.localIdentityIsCurrent(identity)).toBe(true);
  });

  it.each([
    ['a network error', () => fetch.mockRejectedValueOnce(networkError())],
    ['a 502', () => fetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })],
    ['an unreadable body', () => fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } })],
  ])('the admin directory read keeps the identity after %s', async (_label, arrange) => {
    arrange();
    expect(await store.hydrateUsersFromServer()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('authoritative failures still announce that nobody is signed in', () => {
  it.each([
    ['an inactive profile', () => { auth.client.rpc.mockResolvedValueOnce({ data: { ...PROFILE, status: 'suspended' }, error: null, status: 200 }); }],
    ['a different verified user', () => { auth.client.auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'b', email: 'b@example.test' } } }); }],
    ['getUser answering 401', () => { auth.client.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: apiError(401) }); }],
    ['get_my_profile answering 401 (JWT error)', () => {
      auth.client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 });
    }],
    ['no session', () => { auth.session = null; }],
  ])('%s', async (_label, arrange) => {
    arrange();
    expect(await store.verifiedLocalIdentity()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(null, null);
    expect(store.lastIdentityFailure()).toBe('authoritative');
    expect(store.identityRefusalMessage('Sign in again.')).toBe('Sign in again.');
  });

  it.each([401, 403])('the admin directory read announces on %i', async (status) => {
    fetch.mockResolvedValueOnce({ ok: false, status, json: async () => ({}) });
    expect(await store.hydrateUsersFromServer()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(null, null);
  });
});
