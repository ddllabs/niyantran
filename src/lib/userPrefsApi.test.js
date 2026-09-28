import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
// The handler must never reach SQLite (ADR 0005: nothing durable under /tmp).
vi.mock('../../server/db.mjs', () => ({
  getDb: vi.fn(async () => { throw new Error('SQLite must not be used for preferences'); }),
  queryAll: vi.fn(() => { throw new Error('SQLite must not be used for preferences'); }),
  run: vi.fn(() => { throw new Error('SQLite must not be used for preferences'); }),
}));

import { createClient } from '@supabase/supabase-js';
import { getDb } from '../../server/db.mjs';
import { handleUserPrefsApi } from '../../server/userPrefsApi.mjs';

const TABLE = 'user_preferences';
const USERS = {
  'token-a': { id: '00000000-0000-4000-8000-00000000000a', email: 'Owner.A@Example.test' },
  'token-b': { id: '00000000-0000-4000-8000-00000000000b', email: 'owner.b@example.test' },
  // Same Auth user as token-a after an email change.
  'token-a-renamed': { id: '00000000-0000-4000-8000-00000000000a', email: 'renamed.a@example.test' },
};

// In-memory stand-in for PostgREST behind RLS. Each client is bound to one
// token and sees only its own rows, like `user_id = auth.uid()` policies.
// The real policy is proven by supabase/tests/user_preferences.sql.
function fakeSupabase() {
  const rows = new Map();
  const calls = [];
  let clock = 0;
  let failWith = null;
  function clientFor(token) {
    const user = USERS[token];
    const uid = user?.id;
    return {
      token,
      auth: {
        getUser: vi.fn(async (jwt) => (user && jwt === token
          ? { data: { user: { id: user.id, email: user.email } }, error: null }
          : { data: {}, error: { message: 'invalid' } })),
      },
      rpc: vi.fn(async (name) => (name === 'get_my_profile'
        ? { data: { user_id: uid, role: 'user', status: 'active' }, error: null }
        : { data: false, error: null })),
      from(table) {
        const query = { token, table, filters: [], columns: null, write: null, options: null };
        calls.push(query);
        const visible = () => [...rows.values()].filter((row) => row.user_id === uid);
        const pick = (row) => {
          if (!row) return null;
          if (!query.columns) return { ...row };
          return Object.fromEntries(query.columns.split(',').map((c) => c.trim()).map((c) => [c, row[c]]));
        };
        const execute = () => {
          if (failWith) return { data: null, error: failWith };
          if (table !== TABLE) return { data: null, error: { code: '42P01', message: 'no table' } };
          if (query.write) {
            const values = query.write;
            if (values.user_id !== uid) return { data: null, error: { code: '42501', message: 'row-level security' } };
            const current = rows.get(uid) || { user_id: uid, watchlist: null, ai_chats: null, tours: null };
            // PostgREST merge-duplicates updates only the columns in the payload.
            const next = { ...current, ...values, updated_at: `2026-09-28T00:00:0${++clock}.000Z` };
            rows.set(uid, next);
            return { data: [next], error: null };
          }
          const matched = visible().filter((row) => query.filters.every(([col, val]) => row[col] === val));
          return { data: matched, error: null };
        };
        const builder = {
          select(columns) { query.columns = columns; return builder; },
          eq(col, val) { query.filters.push([col, val]); return builder; },
          upsert(values, options) { query.write = values; query.options = options; return builder; },
          async maybeSingle() {
            const { data, error } = execute();
            if (error) return { data: null, error };
            return { data: pick(data[0]), error: null };
          },
          async single() {
            const { data, error } = execute();
            if (error) return { data: null, error };
            if (data.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'not one row' } };
            return { data: pick(data[0]), error: null };
          },
        };
        return builder;
      },
    };
  }
  return {
    rows,
    calls,
    fail(error) { failWith = error; },
    clientForToken: vi.fn((token) => clientFor(token)),
  };
}

function request(method, url, body, { authorization = 'Bearer token-a', parsed } = {}) {
  const req = {
    method,
    url,
    headers: { host: 'localhost', ...(authorization == null ? {} : { authorization }) },
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield typeof body === 'string' ? body : JSON.stringify(body); },
  };
  if (parsed !== undefined) req.body = parsed;
  return req;
}

async function invoke(req, deps) {
  const res = { setHeader: vi.fn(), end: vi.fn() };
  const next = vi.fn();
  await handleUserPrefsApi(req, res, next, deps);
  const raw = res.end.mock.calls[0]?.[0];
  return { status: res.statusCode, body: raw ? JSON.parse(raw) : undefined, next };
}

let db;
beforeEach(() => {
  vi.clearAllMocks();
  db = fakeSupabase();
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('user preferences on Supabase', () => {
  it('requires a bearer before any client or storage access', async () => {
    const response = await invoke(request('GET', '/api/user-prefs', undefined, { authorization: null }), db);
    expect(response.status).toBe(401);
    expect(db.clientForToken).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('returns the empty default shape when the caller has no row', async () => {
    const response = await invoke(request('GET', '/api/user-prefs'), db);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      email: 'owner.a@example.test',
      prefs: { watchlist: null, tours: null },
      updatedAt: null,
      engine: 'supabase',
    });
    expect(db.rows.size).toBe(0);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('builds the data client from the caller token and scopes the query to the caller', async () => {
    await invoke(request('GET', '/api/user-prefs'), db);
    expect(db.clientForToken).toHaveBeenCalled();
    expect(db.clientForToken.mock.calls.every(([token]) => token === 'token-a')).toBe(true);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toMatchObject({ token: 'token-a', table: TABLE, filters: [['user_id', USERS['token-a'].id]] });
  });

  it('upserts own preferences and merges partial writes', async () => {
    const full = { watchlist: [{ id: 'w1' }], tours: { home: true, desks: {} } };
    const saved = await invoke(request('PUT', '/api/user-prefs', full), db);
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ ok: true, email: 'owner.a@example.test', updatedAt: '2026-09-28T00:00:01.000Z', engine: 'supabase' });
    const upsert = db.calls.find((call) => call.write);
    expect(upsert).toMatchObject({ token: 'token-a', table: TABLE, options: { onConflict: 'user_id' } });
    expect(upsert.write).toEqual({ user_id: USERS['token-a'].id, watchlist: full.watchlist, tours: full.tours });

    const partial = await invoke(request('PUT', '/api/user-prefs', { watchlist: [{ id: 'w2' }] }), db);
    expect(partial.status).toBe(200);
    // Only supplied fields travel, so a partial PUT cannot erase the others.
    expect(db.calls.filter((call) => call.write).at(-1).write).toEqual({ user_id: USERS['token-a'].id, watchlist: [{ id: 'w2' }] });

    const loaded = await invoke(request('GET', '/api/user-prefs'), db);
    expect(loaded.body).toEqual({
      ok: true,
      email: 'owner.a@example.test',
      prefs: { ...full, watchlist: [{ id: 'w2' }] },
      updatedAt: '2026-09-28T00:00:02.000Z',
      engine: 'supabase',
    });
  });

  it('ignores the retired aiChats field: nothing is written or returned for it', async () => {
    const saved = await invoke(request('PUT', '/api/user-prefs', { aiChats: { chats: [{ id: 'c1' }] }, tours: { home: true } }), db);
    expect(saved.status).toBe(200);
    expect(db.calls.find((call) => call.write).write).toEqual({ user_id: USERS['token-a'].id, tours: { home: true } });
    const loaded = await invoke(request('GET', '/api/user-prefs'), db);
    expect(loaded.body.prefs).toEqual({ watchlist: null, tours: { home: true } });
  });

  it('clears a field only when it is explicitly null', async () => {
    await invoke(request('PUT', '/api/user-prefs', { watchlist: ['a'], tours: { home: true } }), db);
    await invoke(request('PUT', '/api/user-prefs', { tours: null }), db);
    expect((await invoke(request('GET', '/api/user-prefs'), db)).body.prefs).toEqual({ watchlist: ['a'], tours: null });
  });

  it('keeps separate users isolated', async () => {
    await invoke(request('PUT', '/api/user-prefs', { watchlist: [{ id: 'private' }] }), db);
    const other = await invoke(request('GET', '/api/user-prefs', undefined, { authorization: 'Bearer token-b' }), db);
    expect(other.body.prefs).toEqual({ watchlist: null, tours: null });
    expect(other.body.email).toBe('owner.b@example.test');
  });

  it('keys rows by the verified user ID, so an email change keeps preferences', async () => {
    await invoke(request('PUT', '/api/user-prefs', { watchlist: ['same-owner'] }), db);
    const renamed = { authorization: 'Bearer token-a-renamed' };
    const loaded = await invoke(request('GET', '/api/user-prefs?email=renamed.a%40example.test', undefined, renamed), db);
    expect(loaded.body.email).toBe('renamed.a@example.test');
    expect(loaded.body.prefs.watchlist).toEqual(['same-owner']);
    expect((await invoke(request('GET', '/api/user-prefs?email=owner.a%40example.test', undefined, renamed), db)).status).toBe(403);
  });

  it('serves an ordinary active caller without admin authority', async () => {
    const clients = [];
    const deps = { clientForToken: vi.fn((token) => { const c = db.clientForToken(token); clients.push(c); return c; }) };
    expect((await invoke(request('PUT', '/api/user-prefs', { tours: {} }), deps)).status).toBe(200);
    expect(clients.flatMap((c) => c.rpc.mock.calls)).toEqual([['get_my_profile']]);
  });

  it('accepts a body that the platform pre-parsed (ADR 0010)', async () => {
    const asObject = await invoke(request('PUT', '/api/user-prefs', undefined, { parsed: { tours: { home: true } } }), db);
    expect(asObject.status).toBe(200);
    const asString = await invoke(request('PUT', '/api/user-prefs', undefined, { parsed: JSON.stringify({ watchlist: ['s'] }) }), db);
    expect(asString.status).toBe(200);
    expect((await invoke(request('GET', '/api/user-prefs'), db)).body.prefs).toEqual({ watchlist: ['s'], tours: { home: true } });
  });

  it('rejects a request body over the 256 KiB limit before storage', async () => {
    const huge = JSON.stringify({ watchlist: 'x'.repeat(256 * 1024) });
    const streamed = await invoke(request('PUT', '/api/user-prefs', huge), db);
    expect(streamed.status).toBe(413);
    const preParsed = await invoke(request('PUT', '/api/user-prefs', undefined, { parsed: JSON.parse(huge) }), db);
    expect(preParsed.status).toBe(413);
    expect(db.calls).toEqual([]);
  });

  it.each([
    ['watchlist', 64 * 1024],
    ['tours', 64 * 1024],
  ])('rejects an oversized %s field before storage', async (field, limit) => {
    // JSON.stringify of a string adds two quote bytes, so limit - 1 is one over.
    const response = await invoke(request('PUT', '/api/user-prefs', { [field]: 'x'.repeat(limit - 1) }), db);
    expect(response.status).toBe(413);
    expect(response.body.ok).toBe(false);
    expect(db.calls).toEqual([]);
    const fits = await invoke(request('PUT', '/api/user-prefs', { [field]: 'x'.repeat(limit - 2) }), db);
    expect(fits.status).toBe(200);
  });

  it('maps a database size check violation to 413', async () => {
    db.fail({ code: '23514', message: 'private-db-detail' });
    const response = await invoke(request('PUT', '/api/user-prefs', { watchlist: [] }), db);
    expect(response.status).toBe(413);
    expect(JSON.stringify(response.body)).not.toContain('private-db-detail');
  });

  it.each(['GET', 'PUT'])('hides storage errors on %s', async (method) => {
    db.fail({ code: '42501', message: 'private-db-detail' });
    const response = await invoke(request(method, '/api/user-prefs', { watchlist: [] }), db);
    expect(response.status).toBe(500);
    expect(response.body.ok).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain('private-db-detail');
  });

  it('rejects an invalid payload before storage', async () => {
    for (const body of ['null', '[]', '{not json', '"text"']) {
      const response = await invoke(request('PUT', '/api/user-prefs', body), db);
      expect(response.status).toBe(400);
    }
    expect(db.calls).toEqual([]);
  });

  it.each([
    ['GET', '/api/user-prefs?email=victim@example.test', undefined],
    ['PUT', '/api/user-prefs', { email: 'victim@example.test', watchlist: [] }],
  ])('refuses another account email on %s before storage', async (method, url, body) => {
    const response = await invoke(request(method, url, body), db);
    expect(response.status).toBe(403);
    expect(db.calls).toEqual([]);
  });

  it('accepts the matching normalised email for compatibility', async () => {
    expect((await invoke(request('GET', '/api/user-prefs?email=OWNER.A%40example.test'), db)).status).toBe(200);
    expect((await invoke(request('PUT', '/api/user-prefs', { email: ' owner.a@EXAMPLE.test ', tours: {} }), db)).status).toBe(200);
    expect(db.calls.find((call) => call.write).write).not.toHaveProperty('email');
  });

  it('keeps routing behaviour for other paths and methods', async () => {
    const other = await invoke(request('GET', '/api/elsewhere'), db);
    expect(other.next).toHaveBeenCalled();
    expect((await invoke(request('DELETE', '/api/user-prefs'), db)).status).toBe(405);
    expect((await invoke(request('GET', '/api/user-prefs/extra'), db)).status).toBe(404);
  });

  it('defaults to the publishable-key client bound to the caller token', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.example.test');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
    createClient.mockImplementation((_url, _key, options) => db.clientForToken(options.global.headers.Authorization.slice(7)));
    const response = await invoke(request('GET', '/api/user-prefs'), {});
    expect(response.status).toBe(200);
    expect(createClient).toHaveBeenCalled();
    for (const [url, key, options] of createClient.mock.calls) {
      expect(url).toBe('https://project.example.test');
      expect(key).toBe('test-publishable-key');
      expect(options.global.headers.Authorization).toBe('Bearer token-a');
    }
    expect(db.calls[0]).toMatchObject({ token: 'token-a', table: TABLE });
  });

  it('never reaches for a privileged key or SQLite in the handler source', () => {
    const source = fs.readFileSync(new URL('../../server/userPrefsApi.mjs', import.meta.url), 'utf8');
    expect(source).not.toMatch(/service_role|SERVICE_ROLE|SECRET_KEY|sb_secret|getSupabaseAdminClient/);
    expect(source).not.toMatch(/['"]\.\/db\.mjs['"]/);
  });
});
