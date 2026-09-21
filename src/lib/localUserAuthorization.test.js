import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

vi.mock('../../server/db.mjs', () => ({
  getDb: vi.fn(async () => ({})),
  queryAll: vi.fn(() => [{ id: 'local', email: 'local@example.test', password: 'fixture-secret' }]),
  run: vi.fn(),
}));
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { getDb, queryAll, run } from '../../server/db.mjs';
import { handleUsersApi, localClientForToken } from '../../server/usersApi.mjs';
import { handleUserPrefsApi } from '../../server/userPrefsApi.mjs';

function request(method, url, body, authorization = 'Bearer verified-token') {
  return {
    method, url, headers: { host: 'localhost', ...(authorization == null ? {} : { authorization }) },
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield JSON.stringify(body); },
  };
}
async function invoke(handler, req, deps = {}) {
  const res = { setHeader: vi.fn(), end: vi.fn() };
  await handler(req, res, vi.fn(), deps);
  return { status: res.statusCode, body: JSON.parse(res.end.mock.calls[0][0]) };
}
function setup({ role = 'admin', status = 'active', admin = true, userId = 'auth-user', profileId = userId } = {}) {
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId, email: 'Caller@Example.test', user_metadata: { role: 'admin' } } }, error: null })) },
    rpc: vi.fn(async (name) => ({ data: name === 'is_platform_admin' ? admin : { user_id: profileId, role, status }, error: null })),
  };
  const deps = {
    clientForToken: vi.fn(() => client),
    readUsers: vi.fn(async () => [{ id: 'local', email: 'local@example.test', password: 'fixture-secret' }]),
    writeUsers: vi.fn(async (users) => users),
  };
  return { client, deps };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryAll.mockReturnValue([{ id: 'local', email: 'local@example.test', password: 'fixture-secret' }]);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('local route authorization', () => {
  it.each([
    [handleUsersApi, '/api/users'],
    [handleUserPrefsApi, '/api/user-prefs?email=victim@example.test'],
  ])('rejects unauthenticated reads before storage', async (handler, url) => {
    const response = await invoke(handler, request('GET', url, undefined, null));
    expect(response.status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('never exports stored passwords to even a verified admin', async () => {
    const { deps } = setup();
    const response = await invoke(handleUsersApi, request('GET', '/api/users'), deps);
    expect(response.status).toBe(200);
    expect(response.body.users.every((user) => !Object.hasOwn(user, 'password'))).toBe(true);
  });

  it('rejects another email on preferences reads', async () => {
    const { deps } = setup({ role: 'user', admin: false });
    const response = await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs?email=victim@example.test'), deps);
    expect(response.status).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
  });
});

const routes = [
  [handleUsersApi, 'GET', '/api/users', undefined],
  [handleUsersApi, 'PUT', '/api/users', { users: [] }],
  [handleUserPrefsApi, 'GET', '/api/user-prefs', undefined],
  [handleUserPrefsApi, 'PUT', '/api/user-prefs', { watchlist: ['own'] }],
];

describe.each(routes)('%s %s %s', (handler, method, url, body) => {
  it.each([null, '', 'Basic abc', 'Bearer', 'Bearer token extra', 'Bearer a,b', ['Bearer a', 'Bearer b']])('rejects malformed authorization %s before provider or storage', async (header) => {
    const { deps } = setup();
    const response = await invoke(handler, request(method, url, body, header), deps);
    expect(response.status).toBe(401);
    expect(deps.clientForToken).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
    expect(deps.readUsers).not.toHaveBeenCalled();
    expect(deps.writeUsers).not.toHaveBeenCalled();
  });
  it.each(['expired', 'missing-user', 'missing-email', 'throws', 'profile-error', 'wrong-profile', 'suspended', 'missing-profile'])('fails closed for %s', async (condition) => {
    const { client, deps } = setup();
    let expected = 403;
    if (condition === 'expired') { client.auth.getUser.mockResolvedValue({ error: { message: 'private-provider-detail' } }); expected = 401; }
    if (condition === 'missing-user') { client.auth.getUser.mockResolvedValue({ data: {} }); expected = 401; }
    if (condition === 'missing-email') { client.auth.getUser.mockResolvedValue({ data: { user: { id: 'auth-user' } } }); expected = 401; }
    if (condition === 'throws') { client.auth.getUser.mockRejectedValue(new Error('private-provider-detail')); expected = 503; }
    if (condition === 'profile-error') { client.rpc.mockResolvedValue({ error: { message: 'private-provider-detail' } }); expected = 503; }
    if (condition === 'wrong-profile') client.rpc.mockResolvedValue({ data: { user_id: 'other', role: 'admin', status: 'active' } });
    if (condition === 'suspended') client.rpc.mockResolvedValue({ data: { user_id: 'auth-user', role: 'admin', status: 'suspended' } });
    if (condition === 'missing-profile') client.rpc.mockResolvedValue({ data: null });
    const response = await invoke(handler, request(method, url, body), deps);
    expect(response.status).toBe(expected);
    expect(JSON.stringify(response.body)).not.toContain('private-provider-detail');
    expect(getDb).not.toHaveBeenCalled();
    expect(deps.readUsers).not.toHaveBeenCalled();
    expect(deps.writeUsers).not.toHaveBeenCalled();
  });
});

describe('internal admin authority and safe export', () => {
  it.each(['GET', 'PUT'])('verifies identity and both server checks for %s', async (method) => {
    const { client, deps } = setup();
    const users = [{ id: 'local', email: 'local@example.test', password: 'fixture-secret', name: 'Edited' }];
    const response = await invoke(handleUsersApi, request(method, '/api/users', { users }), deps);
    expect(response.status).toBe(200);
    expect(deps.clientForToken).toHaveBeenCalledWith('verified-token');
    expect(client.auth.getUser).toHaveBeenCalledWith('verified-token');
    expect(client.rpc.mock.calls).toEqual([['get_my_profile'], ['is_platform_admin']]);
    expect(JSON.stringify(response.body)).not.toContain('fixture-secret');
    expect(response.body.users[0]).not.toHaveProperty('password');
    if (method === 'PUT') expect(deps.writeUsers).toHaveBeenCalledWith(users);
  });
  it.each(['user', 'owner'])('denies %s despite forged metadata and true admin RPC', async (role) => {
    const { deps } = setup({ role });
    expect((await invoke(handleUsersApi, request('PUT', '/api/users', { users: [], role: 'admin' }), deps)).status).toBe(403);
    expect(deps.writeUsers).not.toHaveBeenCalled();
  });
  it.each([false, null, 'true', 1])('requires boolean server admin authority %s', async (admin) => {
    const { deps } = setup({ admin });
    expect((await invoke(handleUsersApi, request('GET', '/api/users'), deps)).status).toBe(403);
    expect(deps.readUsers).not.toHaveBeenCalled();
  });
  it('denies admin RPC errors without leaking provider detail', async () => {
    const { client, deps } = setup();
    client.rpc.mockResolvedValueOnce({ data: { user_id: 'auth-user', role: 'admin', status: 'active' } })
      .mockResolvedValueOnce({ error: { message: 'private-provider-detail' } });
    const response = await invoke(handleUsersApi, request('GET', '/api/users'), deps);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('private-provider-detail');
  });
  it.each([{}, null, { users: null }, { users: [null] }, { users: [[]] }])('rejects invalid replacements before writes: %j', async (payload) => {
    const { deps } = setup();
    expect((await invoke(handleUsersApi, request('PUT', '/api/users', payload), deps)).status).toBe(400);
    expect(deps.writeUsers).not.toHaveBeenCalled();
  });
  it('preserves stored passwords when replacing exported metadata', async () => {
    const { deps } = setup();
    delete deps.writeUsers;
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const response = await invoke(handleUsersApi, request('PUT', '/api/users', { users: [{ id: 'local', email: 'local@example.test', name: 'Edited' }] }), deps);
    expect(response.status).toBe(200);
    const insert = run.mock.calls.find((call) => call[2]?.[0] === 'local');
    expect(insert[2][3]).toBe('fixture-secret');
    expect(JSON.stringify(response.body)).not.toContain('fixture-secret');
  });
  it('does not expose storage errors', async () => {
    const { deps } = setup();
    deps.readUsers.mockRejectedValue(new Error('fixture-secret'));
    const response = await invoke(handleUsersApi, request('GET', '/api/users'), deps);
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('fixture-secret');
  });
});

describe('preferences identity', () => {
  it.each(['GET', 'PUT'])('allows active ordinary caller %s without admin authority', async (method) => {
    const { client, deps } = setup({ role: 'user', admin: false });
    queryAll.mockReturnValue([{ watchlist_json: '["own"]', ai_chats_json: '[]', tours_json: '{}', updated_at: 'fixture-time' }]);
    const response = await invoke(handleUserPrefsApi, request(method, '/api/user-prefs', { watchlist: ['updated'] }), deps);
    expect(response.status).toBe(200);
    expect(response.body.email).toBe('caller@example.test');
    expect(queryAll.mock.calls[0][2]).toEqual(['caller@example.test']);
    expect(client.rpc.mock.calls).toEqual([['get_my_profile']]);
    if (method === 'GET') expect(response.body.prefs.watchlist).toEqual(['own']);
    else {
      expect(run.mock.calls[0][2].slice(0, 4)).toEqual(['caller@example.test', '["updated"]', '[]', '{}']);
    }
  });
  it.each(['GET', 'PUT'])('accepts matching normalized email for %s compatibility', async (method) => {
    const { deps } = setup();
    const url = method === 'GET' ? '/api/user-prefs?email=CALLER%40example.test' : '/api/user-prefs';
    expect((await invoke(handleUserPrefsApi, request(method, url, { email: ' CALLER@example.test ' }), deps)).status).toBe(200);
  });
  it('denies cross-account PUT even for an admin before storage', async () => {
    const { deps } = setup();
    const response = await invoke(handleUserPrefsApi, request('PUT', '/api/user-prefs', { email: 'victim@example.test', tours: {} }), deps);
    expect(response.status).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects conflicting duplicate email query parameters', async () => {
    const { deps } = setup();
    expect((await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs?email=caller@example.test&email=victim@example.test'), deps)).status).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
  });
  it('returns empty own preferences without writing when no row exists', async () => {
    const { deps } = setup();
    queryAll.mockReturnValue([]);
    const response = await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs'), deps);
    expect(response.body.prefs).toEqual({ watchlist: null, aiChats: null, tours: null });
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects invalid preference payload before storage', async () => {
    const { deps } = setup();
    expect((await invoke(handleUserPrefsApi, request('PUT', '/api/user-prefs', null), deps)).status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });
  it('does not expose preference storage errors', async () => {
    const { deps } = setup();
    getDb.mockRejectedValueOnce(new Error('private-db-detail'));
    const response = await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs'), deps);
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('private-db-detail');
  });
});

describe('request-scoped Supabase transport', () => {
  function config() {
    vi.stubEnv('SUPABASE_URL', 'https://auth.example.test');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-public-key');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
  }
  it('binds each client RPC to its token without sharing a persisted session', () => {
    config();
    localClientForToken('first');
    localClientForToken('second');
    expect(createClient.mock.calls).toEqual(['first', 'second'].map((token) => [
      'https://auth.example.test', 'test-public-key', {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      },
    ]));
  });
  it('fails closed when public client configuration is missing', async () => {
    config();
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '');
    const response = await invoke(handleUsersApi, request('GET', '/api/users'));
    expect(response.status).toBe(503);
    expect(createClient).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });
  it('default handler factory executes provider identity verification', async () => {
    config();
    const { client, deps } = setup();
    createClient.mockReturnValue(client);
    delete deps.clientForToken;
    expect((await invoke(handleUsersApi, request('GET', '/api/users'), deps)).status).toBe(200);
    expect(client.auth.getUser).toHaveBeenCalledWith('verified-token');
  });
});
