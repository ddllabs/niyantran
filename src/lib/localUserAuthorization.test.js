import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

vi.mock('../../server/db.mjs', () => ({
  getDb: vi.fn(async () => ({})),
  queryAll: vi.fn(() => [{ id: 'local', email: 'local@example.test', password: 'fixture-secret' }]),
  run: vi.fn(),
}));
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
// In-memory public.user_preferences behind the caller-scoped client. It applies
// the migration's RLS: a caller reads and writes only its own user_id row.
let prefRows = new Map();
let prefCalls = [];
let prefFailure = null;
function preferenceTable(userId) {
  return vi.fn((table) => {
    expect(table).toBe('user_preferences');
    return {
      select: () => ({
        eq: (column, value) => ({
          maybeSingle: async () => {
            expect(column).toBe('user_id');
            prefCalls.push(['select', value]);
            if (prefFailure) return { data: null, error: { message: prefFailure } };
            const row = value === userId ? prefRows.get(value) : undefined;
            return { data: row ? structuredClone(row) : null, error: null };
          },
        }),
      }),
      upsert: (row, options) => ({
        select: () => ({
          single: async () => {
            expect(options).toEqual({ onConflict: 'user_id' });
            prefCalls.push(['upsert', row.user_id]);
            if (row.user_id !== userId) return { data: null, error: { code: '42501', message: 'row-level security' } };
            const stored = { watchlist: null, ai_chats: null, tours: null, ...prefRows.get(row.user_id), ...structuredClone(row), updated_at: 'db-time' };
            prefRows.set(row.user_id, stored);
            return { data: { updated_at: stored.updated_at }, error: null };
          },
        }),
      }),
    };
  });
}

function setup({ role = 'admin', status = 'active', admin = true, userId = 'auth-user', profileId = userId, email = 'Caller@Example.test' } = {}) {
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId, email, user_metadata: { role: 'admin' } } }, error: null })) },
    rpc: vi.fn(async (name) => ({ data: name === 'is_platform_admin' ? admin : { user_id: profileId, role, status }, error: null })),
    from: preferenceTable(userId),
  };
  const directory = profileDirectory();
  const deps = {
    clientForToken: vi.fn(() => client),
    adminClient: vi.fn(() => directory.client),
  };
  return { client, deps, directory };
}

// public.user_profiles behind the server's secret-key client. The row carries
// a stray password column so a leak through the directory mapping would show.
const TARGET_ID = '00000000-0000-4000-8000-0000000000a1';
function profileDirectory() {
  const row = { user_id: TARGET_ID, email: 'local@example.test', first_name: 'Local', last_name: null, persona: null, role: 'user', plan: 'explorer', status: 'active', created_at: '2026-09-01T00:00:00Z', password: 'fixture-secret' };
  const directory = { writes: [], failure: null };
  directory.client = {
    from: vi.fn((table) => {
      expect(table).toBe('user_profiles');
      let patch = null;
      const result = () => (directory.failure ? { data: null, error: { message: directory.failure } } : null);
      const builder = {
        select: () => builder,
        order: () => builder,
        eq: () => builder,
        neq: () => builder,
        update: (value) => { patch = value; return builder; },
        maybeSingle: async () => {
          if (result()) return result();
          if (patch) directory.writes.push(patch);
          return { data: { ...row, ...patch }, error: null };
        },
        then: (resolve, reject) => Promise.resolve(result() || { data: [{ ...row }], error: null }).then(resolve, reject),
      };
      return builder;
    }),
  };
  return directory;
}

beforeEach(() => {
  vi.clearAllMocks();
  run.mockReset();
  prefRows = new Map();
  prefCalls = [];
  prefFailure = null;
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

  it('never exports a password to even a verified admin', async () => {
    const { deps } = setup();
    const response = await invoke(handleUsersApi, request('GET', '/api/users'), deps);
    expect(response.status).toBe(200);
    expect(response.body.users.every((user) => !Object.hasOwn(user, 'password'))).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('fixture-secret');
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
  [handleUsersApi, 'PATCH', `/api/users/${'00000000-0000-4000-8000-0000000000a1'}`, { active: true }],
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
    expect(deps.adminClient).not.toHaveBeenCalled();
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
    expect(deps.adminClient).not.toHaveBeenCalled();
  });
});

describe('internal admin authority and safe export', () => {
  it.each([['GET', '/api/users'], ['PATCH', `/api/users/${TARGET_ID}`]])('verifies identity and both server checks for %s', async (method, url) => {
    const { client, deps, directory } = setup();
    const response = await invoke(handleUsersApi, request(method, url, { active: false }), deps);
    expect(response.status).toBe(200);
    expect(deps.clientForToken).toHaveBeenCalledWith('verified-token');
    expect(client.auth.getUser).toHaveBeenCalledWith('verified-token');
    expect(client.rpc.mock.calls).toEqual([['get_my_profile'], ['is_platform_admin']]);
    expect(JSON.stringify(response.body)).not.toContain('fixture-secret');
    expect(response.body.users?.[0] ?? response.body.user).not.toHaveProperty('password');
    if (method === 'PATCH') expect(directory.writes).toEqual([{ status: 'suspended' }]);
  });
  it.each(['user', 'owner'])('denies %s despite forged metadata and true admin RPC', async (role) => {
    const { deps, directory } = setup({ role });
    expect((await invoke(handleUsersApi, request('PATCH', `/api/users/${TARGET_ID}`, { active: true, role: 'admin' }), deps)).status).toBe(403);
    expect(deps.adminClient).not.toHaveBeenCalled();
    expect(directory.writes).toEqual([]);
  });
  it.each([false, null, 'true', 1])('requires boolean server admin authority %s', async (admin) => {
    const { deps } = setup({ admin });
    expect((await invoke(handleUsersApi, request('GET', '/api/users'), deps)).status).toBe(403);
    expect(deps.adminClient).not.toHaveBeenCalled();
  });
  it('denies admin RPC errors without leaking provider detail', async () => {
    const { client, deps } = setup();
    client.rpc.mockResolvedValueOnce({ data: { user_id: 'auth-user', role: 'admin', status: 'active' } })
      .mockResolvedValueOnce({ error: { message: 'private-provider-detail' } });
    const response = await invoke(handleUsersApi, request('GET', '/api/users'), deps);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('private-provider-detail');
  });
  // Whole-list replacement is gone: PUT answers 405 for any payload, before
  // authorization or storage, so no list can be written back.
  it.each([{}, null, { users: null }, { users: [null] }, { users: [[]] }, { users: [{ id: 'local', email: 'local@example.test', password: 'fixture-secret' }] }])('refuses whole-list replacement %j with 405 and no write', async (payload) => {
    const { deps, directory } = setup();
    expect((await invoke(handleUsersApi, request('PUT', '/api/users', payload), deps)).status).toBe(405);
    expect(deps.adminClient).not.toHaveBeenCalled();
    expect(directory.writes).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
  // There are no stored passwords to preserve any more; no route accepts one.
  it('accepts no password through the narrow admin edit', async () => {
    const { deps, directory } = setup();
    const response = await invoke(handleUsersApi, request('PATCH', `/api/users/${TARGET_ID}`, { active: true, password: 'fixture-secret' }), deps);
    expect(response.status).toBe(400);
    expect(directory.writes).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
  it('does not expose storage errors', async () => {
    const { deps, directory } = setup();
    directory.failure = 'fixture-secret';
    const response = await invoke(handleUsersApi, request('GET', '/api/users'), deps);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('fixture-secret');
  });
});

describe('preferences identity', () => {
  it.each(['GET', 'PUT'])('allows active ordinary caller %s without admin authority', async (method) => {
    const { client, deps } = setup({ role: 'user', admin: false });
    prefRows.set('auth-user', { user_id: 'auth-user', watchlist: ['own'], ai_chats: [], tours: {}, updated_at: 'fixture-time' });
    const response = await invoke(handleUserPrefsApi, request(method, '/api/user-prefs', { watchlist: ['updated'] }), deps);
    expect(response.status).toBe(200);
    expect(response.body.email).toBe('caller@example.test');
    expect(prefCalls[0]).toEqual([method === 'GET' ? 'select' : 'upsert', 'auth-user']);
    expect(client.rpc.mock.calls).toEqual([['get_my_profile']]);
    if (method === 'GET') expect(response.body.prefs.watchlist).toEqual(['own']);
    else {
      expect(prefRows.get('auth-user')).toMatchObject({ watchlist: ['updated'], ai_chats: [], tours: {} });
    }
  });
  it.each(['GET', 'PUT'])('accepts matching normalized email for %s compatibility', async (method) => {
    const { deps } = setup();
    const url = method === 'GET' ? '/api/user-prefs?email=CALLER%40example.test' : '/api/user-prefs';
    expect((await invoke(handleUserPrefsApi, request(method, url, { email: ' CALLER@example.test ' }), deps)).status).toBe(200);
  });
  it('denies cross-account PUT even for an admin before storage', async () => {
    const { client, deps } = setup();
    const response = await invoke(handleUserPrefsApi, request('PUT', '/api/user-prefs', { email: 'victim@example.test', tours: {} }), deps);
    expect(response.status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects conflicting duplicate email query parameters', async () => {
    const { client, deps } = setup();
    expect((await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs?email=caller@example.test&email=victim@example.test'), deps)).status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });
  it('returns empty own preferences without writing when no row exists', async () => {
    const { deps } = setup();
    const response = await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs'), deps);
    expect(response.body.prefs).toEqual({ watchlist: null, tours: null });
    expect(prefCalls).toEqual([['select', 'auth-user']]);
    expect(prefRows.size).toBe(0);
  });
  it('rejects invalid preference payload before storage', async () => {
    const { client, deps } = setup();
    expect((await invoke(handleUserPrefsApi, request('PUT', '/api/user-prefs', null), deps)).status).toBe(400);
    expect(client.from).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });
  it('does not expose preference storage errors', async () => {
    const { deps } = setup();
    prefFailure = 'private-db-detail';
    const response = await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs'), deps);
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('private-db-detail');
  });
});

describe('stable preference row ownership', () => {
  // public.user_preferences is keyed by the verified Auth user ID (a uuid
  // foreign key), so rows keyed by anything else cannot exist in it.
  const ordinary = (options = {}) => setup({ role: 'user', admin: false, ...options }).deps;

  it('round-trips ordinary own preferences and preserves omitted fields on partial writes', async () => {
    const deps = ordinary();
    const prefs = { watchlist: ['owned'], tours: { done: true } };
    const saved = await invoke(handleUserPrefsApi, request('PUT', '/api/user-prefs', { ...prefs, email: ' CALLER@example.test ' }), deps);
    expect(saved.status).toBe(200);
    expect(saved.body.email).toBe('caller@example.test');
    expect((await invoke(handleUserPrefsApi, request('PUT', '/api/user-prefs', { watchlist: ['updated'] }), deps)).status).toBe(200);
    const loaded = await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs?email=CALLER%40example.test'), deps);
    expect(loaded.status).toBe(200);
    expect(loaded.body.prefs).toEqual({ ...prefs, watchlist: ['updated'] });
    expect([...prefRows.keys()]).toEqual(['auth-user']);
  });

  it('retains preferences for the same verified user ID after an email change', async () => {
    const before = ordinary({ email: 'before@example.test' });
    const after = ordinary({ email: 'after@example.test' });
    expect((await invoke(handleUserPrefsApi, request('PUT', '/api/user-prefs', { watchlist: ['same-owner'] }), before)).status).toBe(200);
    const loaded = await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs?email=after%40example.test'), after);
    expect(loaded.status).toBe(200);
    expect(loaded.body.email).toBe('after@example.test');
    expect(loaded.body.prefs).toEqual({ watchlist: ['same-owner'], tours: null });
    expect((await invoke(handleUserPrefsApi, request('PUT', '/api/user-prefs', { tours: { newEmail: true } }), after)).status).toBe(200);
    expect((await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs'), after)).body.prefs).toEqual({ watchlist: ['same-owner'], tours: { newEmail: true } });
    expect(prefCalls.every(([, userId]) => userId === 'auth-user')).toBe(true);
    expect((await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs?email=before%40example.test'), after)).status).toBe(403);
  });

  it('isolates different verified user IDs even when an email address is reused', async () => {
    const first = ordinary({ userId: 'original-owner' });
    const second = ordinary({ userId: 'new-owner' });
    expect((await invoke(handleUserPrefsApi, request('PUT', '/api/user-prefs', { tours: { first: 'private' } }), first)).status).toBe(200);
    const loaded = await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs'), second);
    expect(loaded.status).toBe(200);
    expect(loaded.body.prefs).toEqual({ watchlist: null, tours: null });
    expect((await invoke(handleUserPrefsApi, request('PUT', '/api/user-prefs', { watchlist: ['second private watchlist'] }), second)).status).toBe(200);
    expect((await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs'), first)).body.prefs).toEqual({ watchlist: null, tours: { first: 'private' } });
    expect((await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs'), second)).body.prefs).toEqual({ watchlist: ['second private watchlist'], tours: null });
    expect([...prefRows.keys()]).toEqual(['original-owner', 'new-owner']);
  });

  it("never reads or adopts another user ID's row and leaves its stored bytes untouched", async () => {
    // The pre-Supabase store also held rows keyed by email; the uuid key makes
    // those impossible, so the same guarantee is proven against other owners.
    const others = ['other-owner-1', 'other-owner-2'].map((userId) => ({
      user_id: userId, watchlist: [' legacy '], ai_chats: [{ text: 'private 😀' }], tours: { preserve: true }, updated_at: 'legacy timestamp',
    }));
    for (const row of others) prefRows.set(row.user_id, structuredClone(row));
    const originalBytes = others.map((row) => JSON.stringify(row));
    const deps = ordinary();
    const loaded = await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs'), deps);
    expect(loaded.status).toBe(200);
    expect(loaded.body.prefs).toEqual({ watchlist: null, tours: null });
    expect((await invoke(handleUserPrefsApi, request('PUT', '/api/user-prefs', { tours: { owned: true } }), deps)).status).toBe(200);
    expect((await invoke(handleUserPrefsApi, request('GET', '/api/user-prefs'), deps)).body.prefs).toEqual({ watchlist: null, tours: { owned: true } });
    expect(others.map((row) => JSON.stringify(prefRows.get(row.user_id)))).toEqual(originalBytes);
    expect(prefCalls.every(([, userId]) => userId === 'auth-user')).toBe(true);
    expect(prefRows.size).toBe(3);
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
