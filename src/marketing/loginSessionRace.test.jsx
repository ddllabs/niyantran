import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: {}, session: null, profile: null, listener: null }));
vi.mock('react', async (original) => ({ ...(await original()), useState: (value) => [typeof value === 'function' ? value() : value, vi.fn()], useRef: () => ({ current: null }), useEffect: () => {} }));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: fixture.client }));
vi.mock('../lib/personas.js', () => ({ applyPersonaForUser: vi.fn() }));
vi.mock('../lib/userPrefsSync.js', () => ({ hydrateUserPrefs: vi.fn(async () => ({ ok: true })) }));
vi.mock('../lib/loadTerminal.js', () => ({ prefetchTerminal: vi.fn() }));
vi.mock('./DataGlobe.jsx', () => ({ default: () => null }));
vi.mock('./GoogleSignInButton.jsx', () => ({ default: () => null }));

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}
function form(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'form') return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found = form(child); if (found) return found; }
  return null;
}
let store, LoginPage, session, events;
function emit(event, value = fixture.session) { fixture.listener(event, value); }
function submit() {
  const success = vi.fn();
  const pending = form(LoginPage({ onSuccess: success })).props.onSubmit({ preventDefault() {}, target: { user: 'user@example.invalid', pass: 'synthetic-password' } });
  return { success, pending };
}
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('location', { href: '', hash: '' });
  vi.stubGlobal('FormData', class { constructor(target) { this.target = target; } get(key) { return this.target[key]; } });
  session = { access_token: 'synthetic-new-token', expires_at: Date.now() / 1000 + 3600, user: { id: 'same-account', email: 'user@example.invalid' } };
  fixture.session = null;
  fixture.profile = { user_id: session.user.id, status: 'active', persona: 'policy_analyst' };
  fixture.client.auth = {
    onAuthStateChange: vi.fn((fn) => { fixture.listener = fn; return { data: { subscription: { unsubscribe() {} } } }; }),
    getSession: vi.fn(async () => ({ data: { session: fixture.session } })),
    getUser: vi.fn(async () => ({ data: { user: fixture.session?.user } })),
    signOut: vi.fn(async () => { fixture.session = null; emit('SIGNED_OUT', null); return { error: null }; }),
    signInWithPassword: vi.fn(async () => { fixture.session = session; emit('SIGNED_IN'); return { data: { session, user: session.user } }; }),
  };
  fixture.client.rpc = vi.fn(async () => ({ data: fixture.profile }));
  fixture.client.from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fixture.profile }) }) }) });
  store = await import('../lib/userStore.js');
  LoginPage = (await import('./LoginPage.jsx')).default;
  events = [];
  // The actual App subscription schedules passive publication from the SDK event,
  // before the login form has finished its independent verification.
  store.subscribeLocalIdentity((id) => {
    events.push(id);
    if (id && !store.sessionUser()) setTimeout(() => { void store.publishVerifiedSessionUser(); }, 0);
  });
});
afterEach(async () => { await vi.runOnlyPendingTimersAsync(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(['slow-verification', 'fast-verification'])('re-login after logout survives passive App publication: %s', async (order) => {
  store.clearSessionUser(); await flush(); events.length = 0;
  const verification = deferred();
  if (order === 'slow-verification') fixture.client.auth.getUser.mockReturnValueOnce(verification.promise);
  const { pending, success } = submit(); await flush();
  if (order === 'slow-verification') {
    expect(fixture.client.auth.getUser).toHaveBeenCalledOnce();
    await vi.runOnlyPendingTimersAsync();
    // A second passive consumer must also receive no authority without cancelling login.
    expect(await store.verifiedLocalIdentity()).toBeNull();
    verification.resolve({ data: { user: session.user } });
  }
  await pending; await vi.runOnlyPendingTimersAsync();
  expect(success).toHaveBeenCalledOnce();
  expect(store.sessionUser()?.id).toBe(session.user.id);
  expect(events).not.toContain(null);
  expect(await store.verifiedLocalIdentity()).toMatchObject({ id: session.user.id });
});

it.each(['local-logout', 'sdk-signout', 'account-switch', 'token-switch'])('a real %s during verification still prevents publication', async (kind) => {
  store.clearSessionUser(); await flush();
  const verification = deferred(); fixture.client.auth.getUser.mockReturnValueOnce(verification.promise);
  const { pending, success } = submit(); await flush(); await vi.runOnlyPendingTimersAsync();
  if (kind === 'local-logout') store.clearSessionUser();
  if (kind === 'sdk-signout') { fixture.session = null; emit('SIGNED_OUT'); }
  if (kind === 'account-switch') { fixture.session = { ...session, user: { id: 'another-account' } }; emit('SIGNED_IN'); }
  if (kind === 'token-switch') { fixture.session = { ...session, access_token: 'another-token' }; emit('TOKEN_REFRESHED'); }
  verification.resolve({ data: { user: session.user } }); await pending;
  expect(success).not.toHaveBeenCalled(); expect(store.sessionUser()).toBeNull();
});

it.each(['invalid-user', 'inactive-profile'])('failed %s verification keeps the logout latch closed', async (kind) => {
  store.clearSessionUser(); await flush();
  if (kind === 'invalid-user') fixture.client.auth.getUser.mockResolvedValue({ data: { user: { id: 'wrong-account' } } });
  else fixture.profile.status = 'suspended';
  const { pending, success } = submit(); await pending;
  expect(success).not.toHaveBeenCalled(); expect(store.sessionUser()).toBeNull();
  expect(await store.verifiedLocalIdentity()).toBeNull();
});

it('provider logout failure and passive cached events cannot restore access', async () => {
  fixture.session = session;
  fixture.client.auth.signOut.mockRejectedValue(new Error('synthetic offline'));
  store.clearSessionUser(); await flush(); emit('SIGNED_IN');
  await vi.runOnlyPendingTimersAsync();
  expect(await store.verifiedLocalIdentity()).toBeNull();
  expect(store.sessionUser()).toBeNull();
  expect(fixture.client.auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
  expect(fixture.client.auth.getUser).not.toHaveBeenCalled();
});
