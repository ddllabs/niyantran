import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ id: 'owner-a', token: null, callback: null, blocked: false, offline: false }));
vi.mock('./supabaseClient.js', () => ({ supabase: {
  auth: {
    onAuthStateChange: (fn) => { auth.callback = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    getSession: async () => ({ data: { session: auth.id ? { access_token: auth.token || `token-${auth.id}`, user: { id: auth.id }, expires_at: Date.now() / 1000 + 3600 } : null } }),
    getUser: async () => ({ data: { user: auth.id ? { id: auth.id, email: `${auth.id}@example.invalid` } : null } }),
  },
  rpc: async () => (auth.offline ? { error: { message: 'down' }, status: 503 } : { data: { user_id: auth.id, status: auth.blocked ? 'suspended' : 'active' } }),
} }));
import { localIdentityIsCurrent, resumeLocalIdentityAfterSignIn, reverifiedAccount, verifiedLocalIdentity } from './userStore.js';

const announce = (event = 'SIGNED_IN') => auth.callback?.(event, auth.id ? { access_token: auth.token || `token-${auth.id}`, user: { id: auth.id } } : null);

beforeEach(async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  Object.assign(auth, { id: 'owner-a', token: null, blocked: false, offline: false });
  announce();
  await resumeLocalIdentityAfterSignIn({ access_token: 'token-owner-a', user: { id: 'owner-a' }, expires_at: Date.now() / 1000 + 3600 });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// F43: each Auth event supersedes the identities issued before it.
it('returns a still-current identity unchanged', async () => {
  const identity = await verifiedLocalIdentity();
  expect(await reverifiedAccount(identity)).toBe(identity);
});

it('verifies the same account again after a refocus SIGNED_IN superseded the identity', async () => {
  const identity = await verifiedLocalIdentity();
  announce();
  expect(await localIdentityIsCurrent(identity)).toBe(false);
  const live = await reverifiedAccount(identity);
  expect(live).toMatchObject({ id: 'owner-a', token: 'token-owner-a' });
  expect(live.epoch).toBeGreaterThan(identity.epoch);
  expect(await localIdentityIsCurrent(live)).toBe(true);
});

it('adopts the refreshed token after a token refresh', async () => {
  const identity = await verifiedLocalIdentity();
  auth.token = 'token-owner-a-refreshed';
  announce('TOKEN_REFRESHED');
  expect(await reverifiedAccount(identity)).toMatchObject({ id: 'owner-a', token: 'token-owner-a-refreshed' });
});

it('refuses another account, a sign-out, a suspended account and an unanswered check', async () => {
  const identity = await verifiedLocalIdentity();
  auth.id = 'owner-b';
  announce();
  expect(await reverifiedAccount(identity)).toBeNull();

  auth.id = 'owner-a';
  announce();
  const again = await verifiedLocalIdentity();
  auth.id = null;
  announce('SIGNED_OUT');
  expect(await reverifiedAccount(again)).toBeNull();

  auth.id = 'owner-a';
  announce();
  const third = await verifiedLocalIdentity();
  auth.blocked = true;
  announce();
  expect(await reverifiedAccount(third)).toBeNull();

  auth.blocked = false;
  announce();
  const fourth = await verifiedLocalIdentity();
  auth.offline = true;
  announce();
  expect(await reverifiedAccount(fourth)).toBeNull();
  expect(await reverifiedAccount(null)).toBeNull();
});
