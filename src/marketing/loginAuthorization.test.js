import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ auth: {}, profile: null, session: null, listeners: new Set(), epoch: 0 }));
vi.mock('react', async (original) => ({ ...(await original()), useState: (value) => [typeof value === 'function' ? value() : value, vi.fn()], useRef: () => ({ current: null }), useEffect: () => {} }));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: {
  auth: fake.auth,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => fake.profile }) }) }),
} }));
vi.mock('../lib/userStore.js', async (original) => ({
  ...(await original()),
  authenticateUser: vi.fn(() => ({ ok: true, user: { id: 'demo', email: 'analyst@niyantran', type: 'analyst' } })),
  hydrateUsersFromServer: vi.fn(async () => []),
  setSessionUser: vi.fn(),
  resumeLocalIdentityAfterSignIn: vi.fn(),
  verifiedLocalIdentity: vi.fn(),
  localIdentityIsCurrent: vi.fn(async (identity) => identity.epoch === fake.epoch && fake.session?.access_token === identity.token && fake.session?.user.id === identity.id && identity.expiresAt > Date.now() && fake.session.expires_at * 1000 > Date.now()),
  subscribeLocalIdentity: (fn) => { fake.listeners.add(fn); return () => fake.listeners.delete(fn); },
}));
vi.mock('../lib/personas.js', () => ({ applyPersonaForUser: vi.fn() }));
vi.mock('../lib/userPrefsSync.js', () => ({ hydrateUserPrefs: vi.fn(async () => ({ ok: true })) }));
import LoginPage from './LoginPage.jsx';
import { authenticateUser, setSessionUser, resumeLocalIdentityAfterSignIn, verifiedLocalIdentity, localIdentityIsCurrent } from '../lib/userStore.js';
import { applyPersonaForUser } from '../lib/personas.js';
import { hydrateUserPrefs } from '../lib/userPrefsSync.js';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const changed = (id = null) => { fake.epoch++; for (const fn of fake.listeners) fn(id, id ? 'SIGNED_IN' : null); };
function find(node, type) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === type) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, type); if (found) return found; }
  return null;
}
function submit(email = 'user@example.invalid') {
  const success = vi.fn();
  const tree = LoginPage({ onSuccess: success });
  const pending = find(tree, 'form').props.onSubmit({ preventDefault() {}, target: { user: email, pass: 'fake-password' } });
  return { pending, success, tree };
}
beforeEach(() => {
  vi.resetAllMocks(); fake.listeners.clear(); fake.epoch = 0;
  fake.session = { access_token: 'fake-token', expires_at: Date.now() / 1000 + 60, user: { id: 'user-1', email: 'user@example.invalid' } };
  fake.profile = { data: { user_id: 'user-1', status: 'active', role: 'user', persona: 'policy_analyst' }, error: null };
  fake.auth.signInWithPassword = vi.fn(async () => ({ data: { session: fake.session, user: fake.session?.user }, error: null }));
  fake.auth.getSession = vi.fn(async () => ({ data: { session: fake.session }, error: null }));
  fake.auth.getUser = vi.fn(async () => ({ data: { user: fake.session?.user }, error: null }));
  resumeLocalIdentityAfterSignIn.mockImplementation(async (session) => session && ({ id: session.user.id, email: session.user.email, token: session.access_token, expiresAt: session.expires_at * 1000, epoch: fake.epoch }));
  verifiedLocalIdentity.mockImplementation(async () => fake.profile.data?.status === 'active' && !fake.profile.error ? ({ id: fake.session?.user.id, token: fake.session?.access_token }) : null);
  authenticateUser.mockReturnValue({ ok: true, user: { id: 'demo', email: 'analyst@niyantran', type: 'analyst' } });
  hydrateUserPrefs.mockResolvedValue({ ok: true });
  vi.stubGlobal('FormData', class { constructor(target) { this.target = target; } get(key) { return this.target[key]; } });
  vi.stubGlobal('sessionStorage', { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal('location', { search: '?demo=1', href: '', hash: '' });
});
afterEach(() => vi.unstubAllGlobals());

describe('terminal login authorization', () => {
  it.each(['rejected', 'network'])('has no local credential fallback after %s Auth failure, even in demo query mode', async (kind) => {
    if (kind === 'network') fake.auth.signInWithPassword.mockRejectedValue(new Error('offline'));
    else fake.auth.signInWithPassword.mockResolvedValue({ error: { message: 'invalid' }, data: {} });
    const { pending, success } = submit('analyst@niyantran'); await pending;
    expect(success).not.toHaveBeenCalled(); expect(authenticateUser).not.toHaveBeenCalled();
  });
  it.each(['missing', 'error', 'inactive', 'mismatch'])('rejects %s profiles without publishing a session', async (kind) => {
    if (kind === 'missing') fake.profile.data = null;
    if (kind === 'error') fake.profile.error = { message: 'denied' };
    if (kind === 'inactive') fake.profile.data.status = 'suspended';
    if (kind === 'mismatch') fake.profile.data.user_id = 'other';
    const { pending, success } = submit(); await pending;
    expect(success).not.toHaveBeenCalled(); expect(setSessionUser).not.toHaveBeenCalled();
  });
  it.each(['missing', 'expired', 'missing-expiry', 'user-mismatch'])('rejects %s sign-in sessions', async (kind) => {
    const user = fake.session.user;
    if (kind === 'missing') fake.session = null;
    if (kind === 'expired') fake.session.expires_at = 1;
    if (kind === 'missing-expiry') delete fake.session.expires_at;
    fake.auth.signInWithPassword.mockImplementation(async () => ({ data: { session: fake.session, user: kind === 'user-mismatch' ? { ...user, id: 'other' } : user }, error: null }));
    const { pending, success } = submit(); await pending;
    expect(success).not.toHaveBeenCalled(); expect(setSessionUser).not.toHaveBeenCalled();
  });
  it('requires explicit shared identity resumption', async () => {
    resumeLocalIdentityAfterSignIn.mockResolvedValue(null);
    const { pending, success } = submit(); await pending;
    expect(success).not.toHaveBeenCalled(); expect(setSessionUser).not.toHaveBeenCalled();
  });
  it('publishes persona and navigates only after successful verified resumption and hydration', async () => {
    const hydration = deferred(); hydrateUserPrefs.mockReturnValue(hydration.promise);
    const { pending, success } = submit(); await vi.waitFor(() => expect(hydrateUserPrefs).toHaveBeenCalled());
    expect(success).not.toHaveBeenCalled(); expect(setSessionUser).not.toHaveBeenCalled();
    hydration.resolve({ ok: true }); await pending;
    expect(resumeLocalIdentityAfterSignIn).toHaveBeenCalledWith(fake.session);
    expect(setSessionUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1', active: true, personaId: 'policy' }));
    expect(applyPersonaForUser).toHaveBeenCalled(); expect(success).toHaveBeenCalledOnce();
  });
  it.each(['logout', 'switch', 'expiry'])('rejects %s during preference hydration without publishing stale identity', async (kind) => {
    const hydration = deferred(); hydrateUserPrefs.mockReturnValue(hydration.promise);
    const { pending, success } = submit(); await vi.waitFor(() => expect(hydrateUserPrefs).toHaveBeenCalled());
    if (kind === 'expiry') fake.session.expires_at = 1;
    else { changed(kind === 'logout' ? null : 'other'); if (kind === 'switch') fake.session = { ...fake.session, access_token: 'other', user: { id: 'other' } }; }
    hydration.resolve({ ok: true }); await pending;
    expect(success).not.toHaveBeenCalled(); expect(setSessionUser).not.toHaveBeenCalled();
  });
  it('does not resume a login completed after a newer local logout', async () => {
    const auth = deferred(); fake.auth.signInWithPassword.mockReturnValue(auth.promise);
    const { pending, success } = submit(); changed();
    auth.resolve({ data: { session: fake.session, user: fake.session.user }, error: null }); await pending;
    expect(resumeLocalIdentityAfterSignIn).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
  });
});


it('rejects a profile suspended while preferences were hydrating', async () => {
  const hydration = deferred(); hydrateUserPrefs.mockReturnValue(hydration.promise);
  const { pending, success } = submit(); await vi.waitFor(() => expect(hydrateUserPrefs).toHaveBeenCalled());
  fake.profile.data.status = 'suspended'; hydration.resolve({ ok: false }); await pending;
  expect(success).not.toHaveBeenCalled(); expect(setSessionUser).not.toHaveBeenCalled();
});
it('permits unavailable preference backup only while account authority remains valid', async () => {
  hydrateUserPrefs.mockResolvedValue({ ok: false, reason: 'network' });
  const { pending, success } = submit(); await pending;
  expect(success).toHaveBeenCalledOnce();
});
it('does not resume an old attempt after another account signed in and returned', async () => {
  const auth = deferred(); fake.auth.signInWithPassword.mockReturnValue(auth.promise);
  const { pending, success } = submit(); changed('other'); changed('user-1');
  auth.resolve({ data: { session: fake.session, user: fake.session.user }, error: null }); await pending;
  expect(resumeLocalIdentityAfterSignIn).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
});

it('allows the initial anonymous SDK observation during deliberate first login', async () => {
  const auth = deferred(); fake.auth.signInWithPassword.mockReturnValue(auth.promise);
  const { pending, success } = submit();
  for (const listener of fake.listeners) listener(null, 'INITIAL_SESSION');
  auth.resolve({ data: { session: fake.session, user: fake.session.user }, error: null }); await pending;
  expect(success).toHaveBeenCalledOnce();
});

it.each(['logout', 'switch', 'token'])('rejects %s while matching profile is loading', async (kind) => {
  const response = fake.profile; const profile = deferred(); fake.profile = profile.promise;
  const { pending, success } = submit(); await vi.waitFor(() => expect(resumeLocalIdentityAfterSignIn).toHaveBeenCalled());
  if (kind === 'token') fake.session = { ...fake.session, access_token: 'refreshed' };
  else changed(kind === 'logout' ? null : 'other');
  fake.profile = response; profile.resolve(response); await pending;
  expect(hydrateUserPrefs).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled(); expect(setSessionUser).not.toHaveBeenCalled();
});
it.each(['throw', 'wrong-user', 'wrong-token'])('rejects %s shared resume results', async (kind) => {
  if (kind === 'throw') resumeLocalIdentityAfterSignIn.mockRejectedValue(new Error('offline'));
  else resumeLocalIdentityAfterSignIn.mockResolvedValue({ id: kind === 'wrong-user' ? 'other' : 'user-1', token: kind === 'wrong-token' ? 'other' : 'fake-token' });
  const { pending, success } = submit(); await pending;
  expect(success).not.toHaveBeenCalled(); expect(setSessionUser).not.toHaveBeenCalled();
});
it('does not trust the returned Auth payload email over the verified identity', async () => {
  fake.auth.signInWithPassword.mockResolvedValue({ data: { session: fake.session, user: { id: 'user-1', email: 'untrusted@example.invalid' } }, error: null });
  const { pending, success } = submit(); await pending;
  expect(setSessionUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'user@example.invalid' })); expect(success).toHaveBeenCalledOnce();
});
it('fails closed when the profile transport reports an error', async () => {
  const profile = deferred(); fake.profile = profile.promise;
  const { pending, success } = submit(); await vi.waitFor(() => expect(resumeLocalIdentityAfterSignIn).toHaveBeenCalled());
  profile.resolve({ data: null, error: { message: 'offline' } }); await pending;
  expect(success).not.toHaveBeenCalled(); expect(setSessionUser).not.toHaveBeenCalled();
});
it('does not display or prefill a demo credential mode', () => {
  const { tree, pending } = submit();
  expect(JSON.stringify(tree)).not.toContain('Demo mode');
  return pending;
});


it.each(['valid', 'Auth rejected'])('uses the real shared boundary with a fake Auth provider: %s', async (kind) => {
  const actual = await vi.importActual('../lib/userStore.js');
  const { supabase } = await import('../lib/supabaseClient.js');
  supabase.auth.onAuthStateChange = vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } }));
  supabase.rpc = vi.fn(async () => fake.profile);
  if (kind === 'Auth rejected') fake.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid token' } });
  actual.invalidateLocalSession();
  resumeLocalIdentityAfterSignIn.mockImplementation(actual.resumeLocalIdentityAfterSignIn);
  verifiedLocalIdentity.mockImplementation(actual.verifiedLocalIdentity);
  localIdentityIsCurrent.mockImplementation(actual.localIdentityIsCurrent);
  const { pending, success } = submit(); await pending;
  expect(fake.auth.getUser).toHaveBeenCalled();
  if (kind === 'valid') {
    expect(success).toHaveBeenCalledOnce();
    expect(await actual.verifiedLocalIdentity()).toMatchObject({ id: 'user-1' });
  } else {
    expect(success).not.toHaveBeenCalled();
    expect(await actual.verifiedLocalIdentity()).toBeNull();
  }
});
