import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./AdminPages.jsx', () => ({
  OverviewPage: () => 'PRIVATE OVERVIEW', ApisPage: () => null,
  PricingAdminPage: () => null, UsersPage: () => null,
}));
vi.mock('./AiModelsPage.jsx', () => ({ AiModelsPage: () => null }));
vi.mock('./AiPersonasPage.jsx', () => ({ AiPersonasPage: () => null }));
vi.mock('./AdminSitePages.jsx', () => ({
  PrivacyAdminPage: () => null, SiteSettingsPage: () => null, TermsAdminPage: () => null,
}));
vi.mock('../lib/userStore.js', () => ({
  loadUsers: vi.fn(() => []), hydrateUsersFromServer: vi.fn(async () => []),
}));
vi.mock('../lib/refreshFeeds.js', () => ({ sweepApis: vi.fn() }));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: {} }));

import AdminApp from './AdminApp.jsx';
import { createAdminSession, signInAdmin, verifyAdminSession } from './adminSession.js';
import { loadUsers } from '../lib/userStore.js';

const NOW = Date.UTC(2026, 8, 21);
const user = (id = 'admin-1') => ({ id, email: `${id}@example.invalid` });
const session = (id = 'admin-1') => ({
  access_token: `fake-token-${id}`, user: user(id), expires_at: NOW / 1000 + 60,
});

function fakeClient() {
  let callback;
  const state = {
    session: session(), user: user(), authority: true,
    profile: { user_id: 'admin-1', role: 'admin', status: 'active' },
  };
  const unsubscribe = vi.fn(() => { callback = null; });
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: state.session }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: state.user }, error: null })),
      signInWithPassword: vi.fn(async () => ({ data: { session: state.session, user: state.user }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      onAuthStateChange: vi.fn((fn) => {
        callback = fn;
        return { data: { subscription: { unsubscribe } } };
      }),
    },
    rpc: vi.fn(async (name) => ({
      data: name === 'is_platform_admin' ? state.authority : state.profile,
      error: null,
    })),
  };
  return { client, state, unsubscribe, emit: (event, value) => callback?.(event, value) };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('admin console entry', () => {
  it('never renders private content from a forged browser admin flag', () => {
    vi.stubGlobal('location', { hash: '#overview' });
    vi.stubGlobal('sessionStorage', { getItem: () => '1', removeItem: vi.fn() });
    const html = renderToStaticMarkup(createElement(AdminApp));
    expect(html).not.toContain('PRIVATE OVERVIEW');
    expect(html).toContain('ADMIN ACCESS');
    expect(loadUsers).not.toHaveBeenCalled();
  });
});

describe('verified admin authority', () => {
  it('accepts an Auth-verified user only with active profile and server admin authority', async () => {
    const { client } = fakeClient();
    const result = await verifyAdminSession(client, () => NOW);
    expect(result).toEqual({ status: 'verified', user: user(), expiresAt: NOW + 60000, message: '' });
    expect(client.auth.getUser).toHaveBeenCalledWith('fake-token-admin-1');
    expect(client.rpc.mock.calls.map(([name]) => name)).toEqual(['is_platform_admin', 'get_my_profile']);
    expect(result).not.toHaveProperty('access_token');
  });

  it.each([
    ['ordinary user', { role: 'user', status: 'active' }],
    ['organisation owner', { role: 'owner', status: 'active' }],
    ['suspended admin', { role: 'admin', status: 'suspended' }],
    ['inactive admin', { role: 'admin', status: 'inactive' }],
    ['missing profile', null],
    ['different user profile', { user_id: 'other-admin', role: 'admin', status: 'active' }],
  ])('rejects %s even if an admin RPC response is inconsistent', async (_label, profile) => {
    const { client, state } = fakeClient();
    state.profile = profile && { ...state.profile, ...profile };
    expect(await verifyAdminSession(client, () => NOW)).toMatchObject({ status: 'denied', user: null });
  });

  it.each([false, null, 'true', 1])('requires literal true server authority, received %s', async (authority) => {
    const { client, state } = fakeClient();
    state.authority = authority;
    expect(await verifyAdminSession(client, () => NOW)).toMatchObject({ status: 'denied', user: null });
  });

  it('does not authorize cached session user metadata when Auth rejects the token', async () => {
    const { client, state } = fakeClient();
    state.session.user.user_metadata = { role: 'admin', status: 'active' };
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error('invalid token') });
    expect(await verifyAdminSession(client, () => NOW)).toMatchObject({ status: 'signedOut', user: null });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('rejects a different Auth user from the cached session user', async () => {
    const { client, state } = fakeClient();
    state.user = user('other-admin');
    expect(await verifyAdminSession(client, () => NOW)).toMatchObject({ status: 'signedOut', user: null });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([null, { ...session(), expires_at: NOW / 1000 }, { ...session(), expires_at: undefined }])(
    'starts closed without a usable unexpired session: %s', async (value) => {
      const { client, state } = fakeClient();
      state.session = value;
      expect(await verifyAdminSession(client, () => NOW)).toMatchObject({ status: 'signedOut', user: null });
      expect(client.auth.getUser).not.toHaveBeenCalled();
    },
  );

  it.each(['session', 'auth', 'rpc'])('fails closed for a %s network error without exposing error detail', async (stage) => {
    const { client } = fakeClient();
    const method = stage === 'session' ? client.auth.getSession : stage === 'auth' ? client.auth.getUser : client.rpc;
    method.mockRejectedValue(new Error('private transport details'));
    const result = await verifyAdminSession(client, () => NOW);
    expect(result).toMatchObject({ status: 'error', user: null });
    expect(result.message).not.toContain('private transport');
  });

  it('fails closed for an RPC error result', async () => {
    const { client } = fakeClient();
    client.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    expect(await verifyAdminSession(client, () => NOW)).toMatchObject({ status: 'error', user: null });
  });

  it('rejects an account or token change during the remote checks', async () => {
    const { client } = fakeClient();
    client.auth.getSession
      .mockResolvedValueOnce({ data: { session: session() }, error: null })
      .mockResolvedValueOnce({ data: { session: session('other-admin') }, error: null });
    expect(await verifyAdminSession(client, () => NOW)).toMatchObject({ status: 'signedOut', user: null });
  });

  it('rejects a token that expires while authority checks are pending', async () => {
    const { client } = fakeClient();
    const clock = vi.fn().mockReturnValueOnce(NOW).mockReturnValue(NOW + 60000);
    expect(await verifyAdminSession(client, clock)).toMatchObject({ status: 'signedOut', user: null });
  });
});

describe('admin sign-in', () => {
  it('uses Supabase password sign-in and then independently verifies authority', async () => {
    const { client } = fakeClient();
    expect(await signInAdmin(' admin@example.invalid ', 'fake password', client, () => NOW))
      .toMatchObject({ status: 'verified' });
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'admin@example.invalid', password: 'fake password' });
    expect(client.auth.getUser).toHaveBeenCalledOnce();
  });

  it('rejects successful ordinary-user authentication', async () => {
    const { client, state } = fakeClient();
    state.profile.role = 'user';
    expect(await signInAdmin('user@example.invalid', 'fake', client, () => NOW))
      .toMatchObject({ status: 'denied', user: null });
  });

  it('does not reuse an earlier admin session when a different account just signed in', async () => {
    const { client } = fakeClient();
    client.auth.signInWithPassword.mockResolvedValue({
      data: { session: session('ordinary-2'), user: user('ordinary-2') }, error: null,
    });
    expect(await signInAdmin('ordinary-2@example.invalid', 'fake', client, () => NOW))
      .toMatchObject({ status: 'signedOut', user: null });
  });

  it('never falls back to local credentials when password sign-in fails', async () => {
    const { client } = fakeClient();
    client.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'private auth details' } });
    expect(await signInAdmin('admin@example.invalid', 'fake', client, () => NOW))
      .toMatchObject({ status: 'signedOut', user: null, message: 'Sign-in failed. Check your email and password.' });
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });
});

describe('admin session lifecycle', () => {
  it('clears access synchronously on account change and defers rechecking outside the Auth callback', async () => {
    vi.useFakeTimers();
    const { client, state, emit } = fakeClient();
    const changed = vi.fn();
    const controller = createAdminSession(client, changed, () => NOW);
    await controller.refresh();
    expect(changed.mock.lastCall[0].status).toBe('verified');
    const callsBeforeEvent = client.auth.getSession.mock.calls.length;
    state.session = session('ordinary-2');
    state.user = user('ordinary-2');
    state.profile = { user_id: 'ordinary-2', role: 'user', status: 'active' };
    emit('SIGNED_IN', state.session);
    expect(changed.mock.lastCall[0]).toMatchObject({ status: 'checking', user: null });
    expect(client.auth.getSession).toHaveBeenCalledTimes(callsBeforeEvent);
    await vi.advanceTimersByTimeAsync(0);
    expect(changed.mock.lastCall[0]).toMatchObject({ status: 'denied', user: null });
    controller.dispose();
  });

  it('ignores successful authority results completed after an external sign-out', async () => {
    const { client, emit } = fakeClient();
    const authority = deferred();
    client.rpc.mockImplementation((name) => name === 'is_platform_admin'
      ? authority.promise : Promise.resolve({ data: { user_id: 'admin-1', role: 'admin', status: 'active' }, error: null }));
    const changed = vi.fn();
    const controller = createAdminSession(client, changed, () => NOW);
    const pending = controller.refresh();
    await Promise.resolve();
    await Promise.resolve();
    expect(client.rpc).toHaveBeenCalled();
    emit('SIGNED_OUT', null);
    authority.resolve({ data: true, error: null });
    await pending;
    expect(changed.mock.lastCall[0]).toMatchObject({ status: 'signedOut', user: null });
    expect(changed.mock.calls.some(([value]) => value.status === 'verified')).toBe(false);
    controller.dispose();
  });

  it('clears access before awaiting local sign-out and stays closed if sign-out fails', async () => {
    vi.useFakeTimers();
    const { client, emit } = fakeClient();
    const logout = deferred();
    client.auth.signOut.mockReturnValue(logout.promise);
    const changed = vi.fn();
    const controller = createAdminSession(client, changed, () => NOW);
    await controller.refresh();
    const pending = controller.signOut();
    expect(changed.mock.lastCall[0]).toMatchObject({ status: 'checking', user: null });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    emit('SIGNED_IN', session());
    logout.resolve({ error: new Error('offline') });
    await pending;
    await controller.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(changed.mock.lastCall[0]).toMatchObject({ status: 'signedOut', user: null });
    expect(client.auth.getUser).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('expires verified access without requiring an Auth event', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { client } = fakeClient();
    const changed = vi.fn();
    const controller = createAdminSession(client, changed);
    await controller.refresh();
    await vi.advanceTimersByTimeAsync(60000);
    expect(changed.mock.lastCall[0]).toMatchObject({ status: 'signedOut', user: null });
    controller.dispose();
  });

  it('clears prior access when a later verification fails', async () => {
    const { client } = fakeClient();
    const changed = vi.fn();
    const controller = createAdminSession(client, changed, () => NOW);
    await controller.refresh();
    client.rpc.mockRejectedValue(new Error('offline'));
    const pending = controller.refresh();
    expect(changed.mock.lastCall[0]).toMatchObject({ status: 'checking', user: null });
    await pending;
    expect(changed.mock.lastCall[0]).toMatchObject({ status: 'error', user: null });
    controller.dispose();
  });

  it('unsubscribes and ignores a pending check after disposal', async () => {
    const { client, unsubscribe } = fakeClient();
    const auth = deferred();
    client.auth.getUser.mockReturnValue(auth.promise);
    const changed = vi.fn();
    const controller = createAdminSession(client, changed, () => NOW);
    const pending = controller.refresh();
    await Promise.resolve();
    controller.dispose();
    auth.resolve({ data: { user: user() }, error: null });
    await pending;
    expect(changed).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
