// /api/users reads and narrowly edits public.user_profiles through the
// server's secret-key client, after the route's own internal-admin check.
// There is no local user list, no seed account and no password path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseJs = vi.hoisted(() => ({ client: null }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => supabaseJs.client) }));
const adminHolder = vi.hoisted(() => ({ client: null }));
vi.mock('../../server/authEmailProvider.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  getSupabaseAdminClient: vi.fn(() => adminHolder.client),
}));

import { handleUsersApi } from '../../server/usersApi.mjs';
import routerHandler from '../../api/router.js';

const ADMIN_ID = '00000000-0000-4000-8000-00000000000a';
const ALICE_ID = '00000000-0000-4000-8000-0000000000a1';
const OWNER_ID = '00000000-0000-4000-8000-0000000000f1';
const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000ff';

const FREE = { planStatus: 'free', planEnd: null, planSource: null, planLapsed: false };
const NO_CREDITS = { creditBalance: 0, creditDebt: 0 };
const ALICE_PLAN = { planStatus: 'active', planEnd: '2099-01-01T00:00:00Z', planSource: 'payment', planLapsed: false };
const OWNER_PLAN = { planStatus: 'active', planEnd: null, planSource: 'manual', planLapsed: false };

function profileRows() {
  // Deliberately out of order, and carrying columns the directory must not
  // expose (a provider that ignores the column list must not leak them).
  return [
    { id: 'p-3', user_id: OWNER_ID, email: 'owner@example.test', first_name: 'Olu', last_name: 'Owner', persona: null, role: 'owner', plan: 'max', plan_status: 'active', plan_period_end: null, plan_source: 'manual', status: 'active', created_at: '2026-09-03T00:00:00Z', phone_number: '+91-private', password: 'must-not-leak' },
    { id: 'p-1', user_id: ADMIN_ID, email: 'admin@example.test', first_name: 'Ada', last_name: null, persona: 'corporate_affairs', role: 'admin', plan: 'free', plan_status: 'free', plan_period_end: null, plan_source: null, status: 'active', created_at: '2026-09-01T00:00:00Z', phone_number: '+91-private', password: 'must-not-leak' },
    { id: 'p-2', user_id: ALICE_ID, email: 'alice@example.test', first_name: null, last_name: null, persona: 'upsc_aspirant', role: 'user', plan: 'pro', plan_status: 'active', plan_period_end: '2099-01-01T00:00:00Z', plan_source: 'payment', status: 'suspended', created_at: '2026-09-02T00:00:00Z', phone_number: '+91-private', password: 'must-not-leak' },
  ];
}

/**
 * PostgREST's `or=(...)` value, parsed as strictly as PostgREST does: top-level items are
 * `column.operator.value`, separated by commas; a value holding a reserved character (, ( ) . :)
 * must be double-quoted, with \" and \\ as the only escapes. Anything else throws, as PostgREST
 * answers 400. Returns the items, so a test can prove user text never became a clause of its own.
 */
function parseOrFilter(text) {
  const clauses = [];
  let i = 0;
  while (i <= text.length) {
    const head = /^([a-z_]+)\.(ilike)\./.exec(text.slice(i));
    if (!head) throw new Error(`unexpected clause at ${i}`);
    i += head[0].length;
    let value = '';
    if (text[i] === '"') {
      i += 1;
      for (;;) {
        if (i >= text.length) throw new Error('unterminated quote');
        const ch = text[i];
        if (ch === '\\') {
          if (text[i + 1] !== '"' && text[i + 1] !== '\\') throw new Error('bad escape');
          value += text[i + 1];
          i += 2;
        } else if (ch === '"') {
          i += 1;
          break;
        } else {
          value += ch;
          i += 1;
        }
      }
    } else {
      const end = text.indexOf(',', i) === -1 ? text.length : text.indexOf(',', i);
      value = text.slice(i, end);
      if (/["(),:]/.test(value)) throw new Error('unquoted reserved character');
      i = end;
    }
    clauses.push({ column: head[1], op: head[2], value });
    if (i === text.length) return clauses;
    if (text[i] !== ',') throw new Error('expected a comma');
    i += 1;
  }
  throw new Error('trailing comma');
}

/** value ILIKE pattern, with PostgREST's `*` as `%` and LIKE's backslash escape. */
function ilikeMatches(value, pattern) {
  if (value == null) return false;
  let source = '';
  const wanted = pattern.replaceAll('*', '%');
  for (let i = 0; i < wanted.length; i += 1) {
    const ch = wanted[i];
    if (ch === '\\' && i + 1 < wanted.length) { i += 1; source += wanted[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    else if (ch === '%') source += '[\\s\\S]*';
    else if (ch === '_') source += '[\\s\\S]';
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'i').test(String(value));
}

/** n more users, created after the three fixtures, oldest first by number. */
function moreProfiles(n, { prefix = 'user' } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p-more-${i}`,
    user_id: `00000000-0000-4000-8000-${String(i + 1000).padStart(12, '0')}`,
    email: `${prefix}${String(i).padStart(3, '0')}@example.test`,
    first_name: null, last_name: null, persona: null, role: 'user', plan: 'free', plan_status: 'free', plan_period_end: null, plan_source: null, status: 'active',
    created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(),
  }));
}

/** In-memory public.user_profiles behind a PostgREST-shaped builder. */
function profilesAdmin(rows = profileRows()) {
  const state = { rows, calls: [], fail: null, wallets: [], adjust: null };
  const matches = (row, filters) => filters.every(([kind, column, value]) => (kind === 'eq' ? row[column] === value : row[column] !== value));
  const client = {
    // grant_manual_plan, as the migration defines it (free revokes).
    rpc: vi.fn(async (name, args) => {
      state.calls.push({ op: 'rpc', name, args });
      if (state.fail === 'rpc' || state.fail === 'all') return { data: null, error: { message: 'private-provider-detail', code: 'XX000' } };
      if (state.rpcError) return { data: null, error: state.rpcError };
      if (name === 'admin_adjust_credits') {
        // The function's result shape (migration 20261014200000).
        return { data: state.adjust || { ok: true, repeated: false, request_id: args.p_request_id, kind: args.p_kind, credits: args.p_credits, lot_id: 'lot-1', expires_at: '2027-10-14T00:00:00Z', balance: 1250.5 }, error: null };
      }
      expect(name).toBe('grant_manual_plan');
      const row = state.rows.find((r) => r.user_id === args.p_user);
      if (!row) return { data: null, error: { message: 'No profile for this user', code: 'P0002' } };
      const plan = args.p_plan;
      Object.assign(row, plan === 'free'
        ? { plan, plan_status: 'free', plan_source: 'manual', plan_period_end: null }
        : { plan, plan_status: 'active', plan_source: 'manual', plan_period_end: args.p_period_end });
      return { data: { plan, status: row.plan_status }, error: null };
    }),
    from: vi.fn((table) => {
      if (table === 'credit_wallets') {
        // public.credit_wallets (user_id, balance, debt), read for the page's users only: select(...).in('user_id', ids).
        // `state.walletCap` is the most rows the server returns per request (PostgREST's max rows).
        const walletQuery = { columns: null, ids: null, column: null, order: null, from: null, to: null };
        const walletBuilder = {
          select: (columns) => { walletQuery.columns = columns; return walletBuilder; },
          in: (column, ids) => { walletQuery.column = column; walletQuery.ids = ids; return walletBuilder; },
          order: (column) => { walletQuery.order = column; return walletBuilder; },
          range: (from, to) => { walletQuery.from = from; walletQuery.to = to; return walletBuilder; },
          then: (resolve, reject) => {
            state.calls.push({ op: 'wallets', ...walletQuery });
            let result;
            if (state.fail === 'wallets' || state.fail === 'all') result = { data: null, error: { message: 'private-provider-detail', code: 'XX000' } };
            else {
              const rows = state.wallets.filter((w) => !walletQuery.ids || walletQuery.ids.includes(w.user_id));
              result = { data: rows.slice(0, state.walletCap || Infinity).map((w) => ({ ...w })), error: null };
            }
            return Promise.resolve(result).then(resolve, reject);
          },
        };
        return walletBuilder;
      }
      expect(table).toBe('user_profiles');
      const q = { op: 'select', patch: null, filters: [], order: null, orders: [], count: null, head: false, or: null, from: null, to: null };
      const execute = () => {
        state.calls.push({ op: q.op, patch: q.patch, filters: q.filters, order: q.order, orders: q.orders, count: q.count, head: q.head, or: q.or, from: q.from, to: q.to });
        if (state.fail === q.op || state.fail === 'all') return { data: null, error: { message: 'private-provider-detail', code: 'XX000' } };
        let hits = state.rows.filter((row) => matches(row, q.filters));
        if (q.or !== null) {
          let clauses;
          try { clauses = parseOrFilter(q.or); } catch (e) { return { data: null, error: { message: `PostgREST could not parse the filter: ${e.message}`, code: 'PGRST100' } }; }
          hits = hits.filter((row) => clauses.some((c) => ilikeMatches(row[c.column], c.value)));
        }
        if (q.op === 'update') for (const row of hits) Object.assign(row, q.patch);
        let out = hits.map((row) => ({ ...row }));
        for (const order of [...q.orders].reverse()) out.sort((a, b) => (order.ascending ? 1 : -1) * String(a[order.column]).localeCompare(String(b[order.column])));
        const count = q.count === 'exact' ? out.length : null;
        if (q.from !== null) {
          // PostgREST answers 416 (PGRST103) when the first row asked for is past the end.
          if (out.length > 0 && q.from >= out.length) return { data: null, error: { message: 'Requested range not satisfiable', code: 'PGRST103' }, status: 416, count: null };
          out = out.slice(q.from, q.to + 1);
        }
        return { data: q.head ? null : out, error: null, count };
      };
      const builder = {
        select: (_columns, options = {}) => { q.count = options.count ?? null; q.head = options.head === true; return builder; },
        update: (patch) => { q.op = 'update'; q.patch = patch; return builder; },
        eq: (column, value) => { q.filters.push(['eq', column, value]); return builder; },
        neq: (column, value) => { q.filters.push(['neq', column, value]); return builder; },
        or: (filter) => { q.or = filter; return builder; },
        range: (from, to) => { q.from = from; q.to = to; return builder; },
        order: (column, options = {}) => { q.order = { column, ascending: options.ascending !== false }; q.orders.push(q.order); return builder; },
        maybeSingle: async () => {
          const result = execute();
          if (result.error) return result;
          if (result.data.length > 1) return { data: null, error: { message: 'multiple rows' } };
          return { data: result.data[0] ?? null, error: null };
        },
        single: async () => {
          const result = execute();
          if (result.error) return result;
          if (result.data.length !== 1) return { data: null, error: { message: 'not exactly one row' } };
          return { data: result.data[0], error: null };
        },
        then: (resolve, reject) => Promise.resolve(execute()).then(resolve, reject),
      };
      return builder;
    }),
  };
  return {
    client,
    state,
    writes: () => state.calls.filter((call) => call.op === 'update'),
    grants: () => state.calls.filter((call) => call.op === 'rpc' && call.name === 'grant_manual_plan'),
    adjustments: () => state.calls.filter((call) => call.op === 'rpc' && call.name === 'admin_adjust_credits'),
    walletReads: () => state.calls.filter((call) => call.op === 'wallets'),
  };
}

function callerClient({ userId = ADMIN_ID, role = 'admin', status = 'active', admin = true } = {}) {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId, email: 'Admin@Example.test', user_metadata: { role: 'admin' } } }, error: null })) },
    rpc: vi.fn(async (name) => ({ data: name === 'is_platform_admin' ? admin : { user_id: userId, role, status }, error: null })),
  };
}

function request(method, url, body, authorization = 'Bearer verified-token') {
  return {
    method,
    url,
    headers: { host: 'localhost', ...(authorization == null ? {} : { authorization }) },
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield typeof body === 'string' ? body : JSON.stringify(body); },
  };
}

async function invoke(req, deps) {
  const res = { setHeader: vi.fn(), end: vi.fn() };
  await handleUsersApi(req, res, vi.fn(), deps);
  return { status: res.statusCode, body: JSON.parse(res.end.mock.calls[0][0]), headers: res.setHeader.mock.calls };
}

function setup(caller = {}, rows) {
  const admin = profilesAdmin(rows);
  const client = callerClient(caller);
  return { admin, client, deps: { clientForToken: vi.fn(() => client), adminClient: vi.fn(() => admin.client) } };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('GET /api/users', () => {
  it('returns user_profiles oldest first in the directory shape, with no password or other column', async () => {
    const { deps } = setup();
    const response = await invoke(request('GET', '/api/users'), deps);
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.users).toEqual([
      { id: ADMIN_ID, name: 'Ada', email: 'admin@example.test', type: 'analyst', personaId: 'analyst', plan: 'free', ...FREE, ...NO_CREDITS, active: true, status: 'active', role: 'admin', createdAt: '2026-09-01T00:00:00Z' },
      { id: ALICE_ID, name: 'alice', email: 'alice@example.test', type: 'student', personaId: 'student', plan: 'pro', ...ALICE_PLAN, ...NO_CREDITS, active: false, status: 'suspended', role: 'user', createdAt: '2026-09-02T00:00:00Z' },
      { id: OWNER_ID, name: 'Olu Owner', email: 'owner@example.test', type: null, personaId: null, plan: 'max', ...OWNER_PLAN, ...NO_CREDITS, active: true, status: 'active', role: 'owner', createdAt: '2026-09-03T00:00:00Z' },
    ]);
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('password');
    expect(raw).not.toContain('must-not-leak');
    expect(raw).not.toContain('+91-private');
  });

  it('requires an internal admin before touching the directory', async () => {
    for (const caller of [{ role: 'user', admin: false }, { role: 'user' }, { role: 'owner' }, { admin: false }]) {
      const { deps } = setup(caller);
      expect((await invoke(request('GET', '/api/users'), deps)).status).toBe(403);
      expect(deps.adminClient).not.toHaveBeenCalled();
    }
    const { deps } = setup();
    expect((await invoke(request('GET', '/api/users', undefined, null), deps)).status).toBe(401);
    expect(deps.adminClient).not.toHaveBeenCalled();
  });

  it('answers 503 without provider detail when the directory read fails', async () => {
    const { admin, deps } = setup();
    admin.state.fail = 'select';
    const response = await invoke(request('GET', '/api/users'), deps);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('private-provider-detail');
  });

  it('answers 503 when the secret-key client is not configured', async () => {
    const { deps } = setup();
    deps.adminClient.mockImplementation(() => { throw new Error('SUPABASE_SECRET_KEY private detail'); });
    const response = await invoke(request('GET', '/api/users'), deps);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('private detail');
  });
});

describe('removed whole-list replacement', () => {
  it.each([
    ['PUT', '/api/users', { users: [{ id: 'x', email: 'x@example.test', password: 'fixture' }] }],
    ['POST', '/api/users', { email: 'new@example.test', password: 'fixture' }],
    ['DELETE', '/api/users', undefined],
    ['PATCH', '/api/users', { active: false }],
    ['DELETE', `/api/users/${ALICE_ID}`, undefined],
    ['GET', `/api/users/${ALICE_ID}`, undefined],
  ])('%s %s answers 405 and writes nothing', async (method, url, body) => {
    const { admin, deps } = setup();
    const response = await invoke(request(method, url, body), deps);
    expect(response.status).toBe(405);
    expect(admin.writes()).toEqual([]);
    expect(deps.adminClient).not.toHaveBeenCalled();
  });

  it('answers 404 for deeper paths', async () => {
    const { deps } = setup();
    expect((await invoke(request('PATCH', `/api/users/${ALICE_ID}/password`, { active: true }), deps)).status).toBe(404);
  });
});

describe('PATCH /api/users/:userId', () => {
  it('suspends a user as status suspended and returns the mapped row', async () => {
    const { admin, deps } = setup();
    const response = await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { active: false }), deps);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      user: { id: ALICE_ID, name: 'alice', email: 'alice@example.test', type: 'student', personaId: 'student', plan: 'pro', ...ALICE_PLAN, active: false, status: 'suspended', role: 'user', createdAt: '2026-09-02T00:00:00Z' },
    });
    expect(admin.writes()).toHaveLength(1);
    expect(admin.writes()[0].patch).toEqual({ status: 'suspended' });
  });

  it('reactivates a user as status active', async () => {
    const { admin, deps } = setup();
    const response = await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { active: true }), deps);
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: ALICE_ID, active: true, status: 'active' });
    expect(admin.writes()[0].patch).toEqual({ status: 'active' });
  });

  it('writes a frontend type as its app_persona value', async () => {
    const { admin, deps } = setup();
    const response = await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { type: 'lawyer' }), deps);
    expect(response.status).toBe(200);
    expect(admin.writes()[0].patch).toEqual({ persona: 'legal_researcher' });
    expect(response.body.user).toMatchObject({ type: 'lawyer', personaId: 'lawyer' });
  });

  it('accepts active and type together', async () => {
    const { admin, deps } = setup();
    expect((await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { active: true, type: 'policy' }), deps)).status).toBe(200);
    expect(admin.writes()[0].patch).toEqual({ status: 'active', persona: 'policy_analyst' });
  });

  it('never returns a password field', async () => {
    const { deps } = setup();
    const response = await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { active: true }), deps);
    expect(JSON.stringify(response.body)).not.toContain('password');
    expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
  });

  it.each([
    ['an empty object', {}],
    ['null', null],
    ['an array', [{ active: true }]],
    ['a string active', { active: 'false' }],
    ['a numeric active', { active: 0 }],
    ['an unknown type', { type: 'wizard' }],
    ['a database persona instead of a frontend type', { type: 'upsc_aspirant' }],
    ['a null type', { type: null }],
    ['a plan change', { active: true, plan: 'max' }],
    ['a role change', { role: 'admin' }],
    ['a status field', { status: 'active' }],
    ['a password', { active: true, password: 'new-secret' }],
    ['an email change', { email: 'x@example.test' }],
    ['malformed JSON', '{"active":'],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const { admin, deps } = setup();
    const response = await invoke(request('PATCH', `/api/users/${ALICE_ID}`, body), deps);
    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(admin.writes()).toEqual([]);
  });

  it('rejects an empty body with 400', async () => {
    const { admin, deps } = setup();
    expect((await invoke(request('PATCH', `/api/users/${ALICE_ID}`), deps)).status).toBe(400);
    expect(admin.writes()).toEqual([]);
  });

  it('prevents an admin from changing their own active state', async () => {
    for (const active of [false, true]) {
      const { admin, deps } = setup();
      const response = await invoke(request('PATCH', `/api/users/${ADMIN_ID}`, { active }), deps);
      expect(response.status).toBe(409);
      expect(admin.writes()).toEqual([]);
      expect(admin.state.rows.find((row) => row.user_id === ADMIN_ID).status).toBe('active');
    }
  });

  it('still lets an admin change their own type', async () => {
    const { admin, deps } = setup();
    expect((await invoke(request('PATCH', `/api/users/${ADMIN_ID}`, { type: 'journalist' }), deps)).status).toBe(200);
    expect(admin.writes()[0].patch).toEqual({ persona: 'journalist' });
  });

  it.each([{ active: false }, { type: 'student' }])('refuses to modify an owner row with 403: %j', async (body) => {
    const { admin, deps } = setup();
    const response = await invoke(request('PATCH', `/api/users/${OWNER_ID}`, body), deps);
    expect(response.status).toBe(403);
    expect(admin.writes()).toEqual([]);
    expect(admin.state.rows.find((row) => row.user_id === OWNER_ID)).toMatchObject({ status: 'active', persona: null });
  });

  it('does not overwrite a row that became an owner after it was read', async () => {
    const { admin, deps } = setup();
    const original = admin.client.from;
    admin.client.from = vi.fn((table) => {
      const builder = original(table);
      const update = builder.update;
      builder.update = (patch) => {
        admin.state.rows.find((row) => row.user_id === ALICE_ID).role = 'owner';
        return update(patch);
      };
      return builder;
    });
    const response = await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { active: true }), deps);
    expect(response.status).toBe(403);
    expect(admin.state.rows.find((row) => row.user_id === ALICE_ID).status).toBe('suspended');
  });

  it.each([UNKNOWN_ID, 'not-a-uuid', 'seed-student', encodeURIComponent("x' or 1=1")])('answers 404 for unknown user %s', async (id) => {
    const { admin, deps } = setup();
    const response = await invoke(request('PATCH', `/api/users/${id}`, { active: true }), deps);
    expect(response.status).toBe(404);
    expect(admin.writes()).toEqual([]);
  });

  it('requires an internal admin before reading the body or the directory', async () => {
    for (const caller of [{ role: 'user', admin: false }, { role: 'owner' }, { admin: false }, { status: 'suspended' }]) {
      const { admin, deps } = setup(caller);
      const response = await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { active: true }), deps);
      expect(response.status).toBe(403);
      expect(deps.adminClient).not.toHaveBeenCalled();
      expect(admin.writes()).toEqual([]);
    }
    const { deps } = setup();
    expect((await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { active: true }, 'Bearer'), deps)).status).toBe(401);
    expect(deps.adminClient).not.toHaveBeenCalled();
  });

  it.each(['select', 'update'])('answers 503 without provider detail when the %s fails', async (failing) => {
    const { admin, deps } = setup();
    admin.state.fail = failing;
    const response = await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { active: true }), deps);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('private-provider-detail');
  });

  it('accepts a body the host has already parsed', async () => {
    const { admin, deps } = setup();
    const req = { ...request('PATCH', `/api/users/${ALICE_ID}`), body: { type: 'academic' } };
    expect((await invoke(req, deps)).status).toBe(200);
    expect(admin.writes()[0].patch).toEqual({ persona: 'academic' });
  });
});

// F2: an admin grants or revokes a plan through grant_manual_plan(), never a table write.
describe('PATCH /api/users/:userId plan', () => {
  it('grants a plan until an end date, recorded as the calling admin', async () => {
    const { admin, deps } = setup();
    const response = await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { plan: 'max', planEnd: '2099-12-31' }), deps);
    expect(response.status).toBe(200);
    expect(admin.grants()).toEqual([{ op: 'rpc', name: 'grant_manual_plan', args: { p_user: ALICE_ID, p_plan: 'max', p_period_end: '2099-12-31T00:00:00.000Z', p_granted_by: ADMIN_ID } }]);
    expect(admin.writes()).toEqual([]);
    expect(response.body.user).toMatchObject({ id: ALICE_ID, plan: 'max', planStatus: 'active', planSource: 'manual', planEnd: '2099-12-31T00:00:00.000Z' });
  });

  it('grants open-ended when there is no end date', async () => {
    for (const body of [{ plan: 'pro' }, { plan: 'pro', planEnd: null }, { plan: 'pro', planEnd: '' }]) {
      const { admin, deps } = setup();
      const response = await invoke(request('PATCH', `/api/users/${ADMIN_ID}`, body), deps);
      expect(response.status).toBe(200);
      expect(admin.grants()[0].args).toMatchObject({ p_plan: 'pro', p_period_end: null });
      expect(response.body.user).toMatchObject({ plan: 'pro', planStatus: 'active', planEnd: null });
    }
  });

  it('revokes to free', async () => {
    const { admin, deps } = setup();
    const response = await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { plan: 'free' }), deps);
    expect(response.status).toBe(200);
    expect(admin.grants()[0].args).toMatchObject({ p_plan: 'free', p_period_end: null });
    expect(response.body.user).toMatchObject({ plan: 'free', planStatus: 'free' });
  });

  it.each([
    ['an unknown plan', { plan: 'gov' }],
    ['a retired plan name', { plan: 'professional' }],
    ['the old free plan name', { plan: 'explorer' }],
    ['the old top plan name', { plan: 'enterprise' }],
    ['a non-string plan', { plan: 1 }],
    ['an unreadable end date', { plan: 'pro', planEnd: 'next tuesday' }],
    ['an end date in the past', { plan: 'pro', planEnd: '2020-01-01' }],
    ['an end date without a plan', { planEnd: '2099-01-01' }],
    ['a plan with an account change', { plan: 'pro', active: true }],
    ['a plan with a status', { plan: 'pro', planStatus: 'active' }],
  ])('rejects %s with 400 and grants nothing', async (_label, body) => {
    const { admin, deps } = setup();
    const response = await invoke(request('PATCH', `/api/users/${ALICE_ID}`, body), deps);
    expect(response.status).toBe(400);
    expect(admin.grants()).toEqual([]);
    expect(admin.writes()).toEqual([]);
  });

  it('refuses an owner row with 403', async () => {
    const { admin, deps } = setup();
    expect((await invoke(request('PATCH', `/api/users/${OWNER_ID}`, { plan: 'free' }), deps)).status).toBe(403);
    expect(admin.grants()).toEqual([]);
  });

  it('answers 404 for an unknown user', async () => {
    const { admin, deps } = setup();
    expect((await invoke(request('PATCH', `/api/users/${UNKNOWN_ID}`, { plan: 'pro' }), deps)).status).toBe(404);
    expect(admin.grants()).toEqual([]);
  });

  it('requires an internal admin', async () => {
    for (const caller of [{ role: 'user', admin: false }, { admin: false }]) {
      const { admin, deps } = setup(caller);
      expect((await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { plan: 'max' }), deps)).status).toBe(403);
      expect(admin.grants()).toEqual([]);
    }
  });

  it('answers 503 without provider detail when the grant fails', async () => {
    const { admin, deps } = setup();
    admin.state.fail = 'rpc';
    const response = await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { plan: 'pro' }), deps);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('private-provider-detail');
  });

  it('passes the database refusal of a bad argument back as 400', async () => {
    const { admin, deps } = setup();
    admin.state.rpcError = { code: '22023', message: 'The end date must be in the future' };
    const response = await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { plan: 'pro', planEnd: '2099-01-01' }), deps);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('The end date must be in the future');
  });
});

// F111 task 6, paged by F147: the directory carries each listed user's credit balance.
describe('GET /api/users credit balances', () => {
  const WALLETS = [
    { user_id: ALICE_ID, balance: '1250.5000', debt: '0.0000', created_at: 'private', updated_at: 'private' },
    { user_id: OWNER_ID, balance: 0, debt: '30.0000' },
    { user_id: UNKNOWN_ID, balance: 99, debt: 0 },
  ];

  it('reads the wallets of the listed users only, and shows balance and debt, zero when there is no wallet', async () => {
    const { admin, deps } = setup();
    admin.state.wallets = WALLETS;
    const response = await invoke(request('GET', '/api/users'), deps);
    expect(response.status).toBe(200);
    const byId = Object.fromEntries(response.body.users.map((u) => [u.id, u]));
    expect(byId[ALICE_ID]).toMatchObject({ creditBalance: 1250.5, creditDebt: 0 });
    expect(byId[OWNER_ID]).toMatchObject({ creditBalance: 0, creditDebt: 30 });
    expect(byId[ADMIN_ID]).toMatchObject({ creditBalance: 0, creditDebt: 0 });
    expect(admin.walletReads()).toHaveLength(1);
    expect(admin.walletReads()[0]).toMatchObject({ columns: 'user_id, balance, debt', column: 'user_id' });
    expect([...admin.walletReads()[0].ids].sort()).toEqual([ADMIN_ID, ALICE_ID, OWNER_ID].sort());
    // The wallet of someone not listed is never asked for, so it never leaves.
    expect(response.body.users.map((u) => u.id).sort()).toEqual([ADMIN_ID, ALICE_ID, OWNER_ID].sort());
    expect(JSON.stringify(response.body)).not.toContain('private');
    expect(JSON.stringify(response.body)).not.toContain(UNKNOWN_ID);
  });

  it('keeps the directory when the balance read fails, with the balance unknown rather than zero', async () => {
    const { admin, deps } = setup();
    admin.state.fail = 'wallets';
    const response = await invoke(request('GET', '/api/users'), deps);
    expect(response.status).toBe(200);
    expect(response.body.users).toHaveLength(3);
    for (const user of response.body.users) expect(user).toMatchObject({ creditBalance: null, creditDebt: null });
    expect(JSON.stringify(response.body)).not.toContain('private-provider-detail');
  });
});

// F147: the directory is read 100 users at a time, with an optional search.
describe('GET /api/users paging', () => {
  const idOf = (u) => u.id;

  it('answers the first page when no page is sent, with the total from an exact count', async () => {
    const { admin, deps } = setup({}, [...profileRows(), ...moreProfiles(247)]);
    const response = await invoke(request('GET', '/api/users'), deps);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, page: 1, pageSize: 100, total: 250 });
    expect(response.body.users).toHaveLength(100);
    const read = admin.state.calls.find((c) => c.op === 'select');
    expect(read.count).toBe('exact');
    expect([read.from, read.to]).toEqual([0, 99]);
  });

  it('keeps the order of the directory (oldest first) across pages, with no user twice', async () => {
    const { deps } = setup({}, [...profileRows(), ...moreProfiles(247)]);
    const pages = [];
    for (const page of [1, 2, 3]) pages.push((await invoke(request('GET', `/api/users?page=${page}`), deps)).body);
    expect(pages.map((p) => p.users.length)).toEqual([100, 100, 50]);
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
    const all = pages.flatMap((p) => p.users);
    expect(new Set(all.map(idOf)).size).toBe(250);
    const created = all.map((u) => u.createdAt);
    expect(created).toEqual([...created].sort());
    expect(all.slice(0, 3).map((u) => u.email)).toEqual(['admin@example.test', 'alice@example.test', 'owner@example.test']);
  });

  it('breaks ties in the creation time by id, so a page boundary never repeats or skips a user', async () => {
    const rows = moreProfiles(150).map((r) => ({ ...r, created_at: '2026-10-01T00:00:00Z' }));
    const { admin, deps } = setup({}, rows);
    await invoke(request('GET', '/api/users?page=2'), deps);
    expect(admin.state.calls.find((c) => c.op === 'select').orders.map((o) => o.column)).toEqual(['created_at', 'user_id']);
  });

  it('asks for exactly the rows of the page', async () => {
    const { admin, deps } = setup({}, [...profileRows(), ...moreProfiles(247)]);
    await invoke(request('GET', '/api/users?page=3'), deps);
    const read = admin.state.calls.find((c) => c.op === 'select');
    expect([read.from, read.to]).toEqual([200, 299]);
  });

  it('answers an empty list with the total for a page past the end, not an error', async () => {
    const { deps } = setup({}, [...profileRows(), ...moreProfiles(247)]);
    const response = await invoke(request('GET', '/api/users?page=9'), deps);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, users: [], page: 9, pageSize: 100, total: 250 });
  });

  it('answers page 1 of an empty directory', async () => {
    const { deps } = setup({}, []);
    const response = await invoke(request('GET', '/api/users'), deps);
    expect(response.body).toEqual({ ok: true, users: [], page: 1, pageSize: 100, total: 0 });
  });

  it.each(['0', '-1', '1.5', 'abc', '1e2', '', ' 2', '2 ', '0x10', '+3', '0001', '1000000'])('refuses the page %j with 400 and reads nothing', async (page) => {
    const { admin, deps } = setup();
    const response = await invoke(request('GET', `/api/users?page=${encodeURIComponent(page)}`), deps);
    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(admin.state.calls).toEqual([]);
  });

  it('reads the wallets of the page only, in one request', async () => {
    const rows = [...profileRows(), ...moreProfiles(247)];
    const { admin, deps } = setup({}, rows);
    admin.state.wallets = rows.map((r, i) => ({ user_id: r.user_id, balance: i + 1, debt: 0 }));
    const response = await invoke(request('GET', '/api/users?page=2'), deps);
    expect(admin.walletReads()).toHaveLength(1);
    const asked = admin.walletReads()[0].ids;
    expect(asked).toHaveLength(100);
    expect([...asked].sort()).toEqual(response.body.users.map(idOf).sort());
    expect(asked.length).toBeLessThanOrEqual(100);
    // Each listed user carries their own balance.
    for (const user of response.body.users) {
      const index = rows.findIndex((r) => r.user_id === user.id);
      expect(user.creditBalance).toBe(index + 1);
    }
  });

  it('reads no wallets for an empty page', async () => {
    const { admin, deps } = setup({}, [...profileRows(), ...moreProfiles(5)]);
    const response = await invoke(request('GET', '/api/users?page=4'), deps);
    expect(response.body.users).toEqual([]);
    expect(admin.walletReads()).toEqual([]);
  });

  it('answers 503 without provider detail when the count or the page cannot be read', async () => {
    const { admin, deps } = setup();
    admin.state.fail = 'select';
    const response = await invoke(request('GET', '/api/users?page=2&q=ali'), deps);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('private-provider-detail');
  });

  it('keeps every authorisation check, with or without a page and a search', async () => {
    for (const url of ['/api/users', '/api/users?page=2', '/api/users?q=ali', '/api/users?page=2&q=ali']) {
      for (const caller of [{ role: 'user', admin: false }, { role: 'user' }, { role: 'owner' }, { admin: false }, { status: 'suspended' }]) {
        const { deps } = setup(caller);
        expect((await invoke(request('GET', url), deps)).status).toBe(403);
        expect(deps.adminClient).not.toHaveBeenCalled();
      }
      const { deps } = setup();
      expect((await invoke(request('GET', url, undefined, null), deps)).status).toBe(401);
      expect((await invoke(request('GET', url, undefined, 'Basic abc'), deps)).status).toBe(401);
      expect(deps.adminClient).not.toHaveBeenCalled();
    }
  });

  it('checks the caller before it judges the page or the search, so a stranger learns nothing about them', async () => {
    const { deps } = setup({ role: 'user', admin: false });
    expect((await invoke(request('GET', '/api/users?page=zero&q=' + 'x'.repeat(500)), deps)).status).toBe(403);
    const { deps: anonymous } = setup();
    expect((await invoke(request('GET', '/api/users?page=zero', undefined, null), anonymous)).status).toBe(401);
  });

  it('still answers 405 to other methods on the paged path', async () => {
    const { admin, deps } = setup();
    expect((await invoke(request('POST', '/api/users?page=2'), deps)).status).toBe(405);
    expect(deps.adminClient).not.toHaveBeenCalled();
    expect(admin.writes()).toEqual([]);
  });
});

describe('GET /api/users search', () => {
  const SEARCHABLE = () => [
    ...profileRows(),
    { ...moreProfiles(1)[0], user_id: '00000000-0000-4000-8000-0000000000b1', email: 'a_b@example.test' },
    { ...moreProfiles(1)[0], user_id: '00000000-0000-4000-8000-0000000000b2', email: 'axb@example.test', created_at: '2026-10-02T00:00:00Z' },
    { ...moreProfiles(1)[0], user_id: '00000000-0000-4000-8000-0000000000b3', email: 'pct%sign@example.test', created_at: '2026-10-03T00:00:00Z' },
    { ...moreProfiles(1)[0], user_id: '00000000-0000-4000-8000-0000000000b4', email: 'back\\slash@example.test', created_at: '2026-10-04T00:00:00Z' },
    { ...moreProfiles(1)[0], user_id: '00000000-0000-4000-8000-0000000000b5', email: 'quote"mark@example.test', first_name: 'Quo,te', last_name: 'O)Brien', created_at: '2026-10-05T00:00:00Z' },
    { ...moreProfiles(1)[0], user_id: '00000000-0000-4000-8000-0000000000b6', email: 'plain@example.test', first_name: 'Grace', last_name: 'Hopper', created_at: '2026-10-06T00:00:00Z' },
  ];
  const emails = (response) => response.body.users.map((u) => u.email);
  const search = async (q, rows = SEARCHABLE()) => {
    const ctx = setup({}, rows);
    const response = await invoke(request('GET', `/api/users?q=${encodeURIComponent(q)}`), ctx.deps);
    return { ...ctx, response };
  };

  it('finds a user by part of the email, ignoring case', async () => {
    const { response } = await search('ALICE@Exam');
    expect(response.status).toBe(200);
    expect(emails(response)).toEqual(['alice@example.test']);
    expect(response.body).toMatchObject({ total: 1, page: 1, pageSize: 100 });
  });

  it('finds a user by first name or last name, ignoring case', async () => {
    expect(emails((await search('gRACE')).response)).toEqual(['plain@example.test']);
    expect(emails((await search('hopp')).response)).toEqual(['plain@example.test']);
  });

  it('trims the text, and treats a blank search as no search', async () => {
    expect(emails((await search('   alice  ')).response)).toEqual(['alice@example.test']);
    const { response, admin } = await search('    ');
    expect(response.body.total).toBe(9);
    expect(admin.state.calls.find((c) => c.op === 'select').or).toBeNull();
  });

  it('reports the total of the matches, not of the directory', async () => {
    const { response } = await search('example.test');
    expect(response.body.total).toBe(9);
    const none = (await search('nobody-by-this-name')).response;
    expect(none.body).toEqual({ ok: true, users: [], page: 1, pageSize: 100, total: 0 });
  });

  it('pages the matches of a search', async () => {
    const rows = [...profileRows(), ...moreProfiles(240, { prefix: 'team' })];
    const { deps, admin } = setup({}, rows);
    const second = await invoke(request('GET', '/api/users?page=3&q=team'), deps);
    expect(second.body).toMatchObject({ page: 3, total: 240 });
    expect(second.body.users).toHaveLength(40);
    expect(second.body.users.every((u) => u.email.startsWith('team'))).toBe(true);
    expect(admin.walletReads()[0].ids).toHaveLength(40);
  });

  it('refuses a search longer than 100 characters with 400, and accepts exactly 100', async () => {
    const long = await search('a'.repeat(101));
    expect(long.response.status).toBe(400);
    expect(long.admin.state.calls).toEqual([]);
    expect((await search('a'.repeat(100))).response.status).toBe(200);
    // The limit is on the trimmed text.
    expect((await search(`  ${'a'.repeat(100)}  `)).response.status).toBe(200);
  });

  it('matches a % literally, so it is not a wildcard', async () => {
    expect(emails((await search('%')).response)).toEqual(['pct%sign@example.test']);
    expect(emails((await search('a%')).response)).toEqual([]);
  });

  it('matches an underscore literally, so it is not a one-character wildcard', async () => {
    expect(emails((await search('a_b')).response)).toEqual(['a_b@example.test']);
    expect(emails((await search('_')).response)).toEqual(['a_b@example.test']);
  });

  it('matches a backslash literally', async () => {
    expect(emails((await search('\\')).response)).toEqual(['back\\slash@example.test']);
    expect(emails((await search('back\\s')).response)).toEqual(['back\\slash@example.test']);
  });

  it('matches a double quote, a comma and a parenthesis literally', async () => {
    expect(emails((await search('"')).response)).toEqual(['quote"mark@example.test']);
    expect(emails((await search('Quo,te')).response)).toEqual(['quote"mark@example.test']);
    expect(emails((await search('O)Brien')).response)).toEqual(['quote"mark@example.test']);
    expect(emails((await search(')')).response)).toEqual(['quote"mark@example.test']);
  });

  it('does not treat a * as a wildcard of its own; it is left out of the text', async () => {
    // A bare * leaves nothing to search for, so it lists everyone, like an empty box.
    expect((await search('*')).response.body.total).toBe(9);
    expect(emails((await search('gra*')).response)).toEqual(['plain@example.test']);
    expect(emails((await search('*g*r*a*c*e*')).response)).toEqual(['plain@example.test']);
    expect(emails((await search('zzz*')).response)).toEqual([]);
    // Not a wildcard in the middle either: al*ce is "alce", which no one has.
    const middle = await search('al*ce');
    expect(emails(middle.response)).toEqual([]);
    expect(parseOrFilter(middle.admin.state.calls.find((c) => c.op === 'select').or)[0].value).toBe('*alce*');
  });

  it.each([
    'x,role.eq.owner',
    'x),(role.eq.owner',
    'x,email.ilike.*',
    'x,or(role.eq.admin,status.eq.active)',
    '"),email.ilike.*,("',
    'a.b:c',
    '\\",email.ilike.*,\\"',
    'x%,email.ilike.%',
    'name;drop table user_profiles',
  ])('keeps %j inside one value: no extra clause, no extra row', async (q) => {
    const { response, admin } = await search(q);
    expect(response.status).toBe(200);
    expect(response.body.users).toEqual([]);
    expect(response.body.total).toBe(0);
    const sent = admin.state.calls.find((c) => c.op === 'select').or;
    // Always the same three clauses (email, first name, last name), each one quoted whole.
    const clauses = parseOrFilter(sent);
    expect(clauses.map((c) => c.column)).toEqual(['email', 'first_name', 'last_name']);
    expect(new Set(clauses.map((c) => c.value)).size).toBe(1);
    expect(sent.startsWith('email.ilike."*')).toBe(true);
  });

  it('sends the search only as the or() filter, never in another filter or on a write', async () => {
    const { admin } = await search('x,role.eq.owner');
    expect(admin.state.calls.filter((c) => c.op === 'select' && c.filters.length)).toEqual([]);
    expect(admin.writes()).toEqual([]);
  });

  it('uses the text of the first q when it is repeated', async () => {
    const ctx = setup({}, SEARCHABLE());
    const response = await invoke(request('GET', '/api/users?q=alice&q=grace'), ctx.deps);
    expect(emails(response)).toEqual(['alice@example.test']);
  });

  it('counts the matches exactly, with the same filter, when the page asked for is past them', async () => {
    const { deps } = setup({}, SEARCHABLE());
    const response = await invoke(request('GET', '/api/users?page=5&q=example.test'), deps);
    expect(response.body).toMatchObject({ users: [], page: 5, total: 9 });
  });
});

describe('POST /api/users/:userId/credits', () => {
  const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
  const good = (over = {}) => ({ credits: 500, kind: 'adjustment', reason: 'Goodwill after the outage', requestId: REQUEST_ID, ...over });
  const post = (userId, body, caller, authorization) => {
    const ctx = setup(caller);
    return invoke(request('POST', `/api/users/${userId}/credits`, body, authorization), ctx.deps).then((response) => ({ ...ctx, response }));
  };

  it('adds credits through admin_adjust_credits as the verified caller, and returns the new balance', async () => {
    const { admin, response } = await post(ALICE_ID, good());
    expect(response.status).toBe(200);
    expect(admin.adjustments()).toEqual([{ op: 'rpc', name: 'admin_adjust_credits', args: {
      p_user: ALICE_ID, p_credits: 500, p_kind: 'adjustment', p_reason: 'Goodwill after the outage', p_admin: ADMIN_ID, p_request_id: REQUEST_ID,
    } }]);
    expect(response.body).toEqual({ ok: true, repeated: false, kind: 'adjustment', credits: 500, expiresAt: '2027-10-14T00:00:00Z', balance: 1250.5 });
    expect(admin.writes()).toEqual([]);
  });

  it('removes credits as a negative adjustment', async () => {
    const { admin, response } = await post(ALICE_ID, good({ credits: -120.25 }));
    expect(response.status).toBe(200);
    expect(admin.adjustments()[0].args).toMatchObject({ p_credits: -120.25, p_kind: 'adjustment' });
  });

  it('grants a top-up', async () => {
    const { admin, response } = await post(ALICE_ID, good({ kind: 'topup', credits: 2000 }));
    expect(response.status).toBe(200);
    expect(admin.adjustments()[0].args).toMatchObject({ p_credits: 2000, p_kind: 'topup' });
  });

  it('trims the reason, accepts four decimals and reports a repeated request as repeated', async () => {
    const ctx = setup();
    ctx.admin.state.adjust = { ok: true, repeated: true, request_id: REQUEST_ID, kind: 'adjustment', credits: 0.0001, lot_id: 'lot-1', expires_at: null, balance: 7 };
    const response = await invoke(request('POST', `/api/users/${ALICE_ID}/credits`, good({ credits: 0.0001, reason: '  retry after timeout  ', requestId: REQUEST_ID.toUpperCase() })), ctx.deps);
    expect(response.status).toBe(200);
    expect(ctx.admin.adjustments()[0].args).toMatchObject({ p_credits: 0.0001, p_reason: 'retry after timeout', p_request_id: REQUEST_ID });
    expect(response.body).toMatchObject({ ok: true, repeated: true, balance: 7, expiresAt: null });
  });

  it('lets an admin adjust an admin account, and the ledger names the admin', async () => {
    const { admin, response } = await post(ADMIN_ID, good());
    expect(response.status).toBe(200);
    expect(admin.adjustments()[0].args).toMatchObject({ p_user: ADMIN_ID, p_admin: ADMIN_ID });
  });

  it('answers 401 without a session and does nothing', async () => {
    const { admin, deps, response } = await post(ALICE_ID, good(), {}, null);
    expect(response.status).toBe(401);
    expect(admin.adjustments()).toEqual([]);
    expect(deps.adminClient).not.toHaveBeenCalled();
  });

  it('answers 403 to anyone who is not an internal admin, before the body or the directory', async () => {
    for (const caller of [{ role: 'user', admin: false }, { role: 'user' }, { role: 'owner' }, { admin: false }]) {
      const { admin, deps, response } = await post(ALICE_ID, good(), caller);
      expect(response.status).toBe(403);
      expect(admin.adjustments()).toEqual([]);
      expect(deps.adminClient).not.toHaveBeenCalled();
    }
  });

  it('refuses an owner account with 403', async () => {
    const { admin, response } = await post(OWNER_ID, good());
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Owner accounts cannot be changed here');
    expect(admin.adjustments()).toEqual([]);
  });

  it('answers 404 for an unknown user, and for an id that is not a uuid', async () => {
    for (const id of [UNKNOWN_ID, 'not-a-uuid']) {
      const { admin, response } = await post(id, good());
      expect(response.status).toBe(404);
      expect(admin.adjustments()).toEqual([]);
    }
  });

  it.each([
    ['a missing reason', { reason: undefined }, 'reason'],
    ['an empty reason', { reason: '' }, 'reason'],
    ['a blank reason', { reason: '   ' }, 'reason'],
    ['a non-string reason', { reason: 5 }, 'reason'],
    ['a reason over 500 characters', { reason: 'x'.repeat(501) }, 'reason'],
    ['zero credits', { credits: 0 }, 'credits'],
    ['a missing amount', { credits: undefined }, 'credits'],
    ['a string amount', { credits: '500' }, 'credits'],
    ['a null amount', { credits: null }, 'credits'],
    ['a boolean amount', { credits: true }, 'credits'],
    ['more than four decimals', { credits: 1.00001 }, 'credits'],
    ['an amount beyond the limit', { credits: 1000001 }, 'credits'],
    ['a negative top-up', { kind: 'topup', credits: -10 }, 'top-up'],
    ['an unknown kind', { kind: 'grant' }, 'kind'],
    ['a missing kind', { kind: undefined }, 'kind'],
    ['a missing request id', { requestId: undefined }, 'request id'],
    ['a request id that is not a uuid', { requestId: 'abc' }, 'request id'],
    ['an extra field', { userId: ALICE_ID }, 'only'],
    ['a different admin named in the body', { admin: OWNER_ID }, 'only'],
  ])('rejects %s with 400 and a plain message, adjusting nothing', async (_label, over, hint) => {
    const { admin, response } = await post(ALICE_ID, good(over));
    expect(response.status).toBe(400);
    expect(typeof response.body.error).toBe('string');
    expect(response.body.error.toLowerCase()).toContain(hint);
    expect(admin.adjustments()).toEqual([]);
  });

  it('rejects a body that is not an object, or not JSON, with 400', async () => {
    for (const body of ['not json', '[]', '5', 'null']) {
      const { admin, response } = await post(ALICE_ID, body);
      expect(response.status).toBe(400);
      expect(admin.adjustments()).toEqual([]);
    }
  });

  it('passes the database refusal of an argument back as 400', async () => {
    const ctx = setup();
    ctx.admin.state.rpcError = { code: '22023', message: 'This request id was already used for a different adjustment' };
    const response = await invoke(request('POST', `/api/users/${ALICE_ID}/credits`, good()), ctx.deps);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('This request id was already used for a different adjustment');
  });

  it('answers 503 without provider detail for any other database error', async () => {
    const ctx = setup();
    ctx.admin.state.fail = 'rpc';
    const response = await invoke(request('POST', `/api/users/${ALICE_ID}/credits`, good()), ctx.deps);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('private-provider-detail');
  });

  it('answers 503 when the secret-key client is not configured', async () => {
    const ctx = setup();
    ctx.deps.adminClient.mockImplementation(() => { throw new Error('SUPABASE_SECRET_KEY private detail'); });
    const response = await invoke(request('POST', `/api/users/${ALICE_ID}/credits`, good()), ctx.deps);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('private detail');
  });

  it('answers 405 to other methods on the credits path, and 404 to deeper paths', async () => {
    for (const method of ['GET', 'PATCH', 'PUT', 'DELETE']) {
      const { admin, deps } = setup();
      const response = await invoke(request(method, `/api/users/${ALICE_ID}/credits`, good()), deps);
      expect(response.status).toBe(405);
      expect(admin.adjustments()).toEqual([]);
      expect(deps.adminClient).not.toHaveBeenCalled();
    }
    const { deps } = setup();
    expect((await invoke(request('POST', `/api/users/${ALICE_ID}/credits/extra`, good()), deps)).status).toBe(404);
    expect((await invoke(request('POST', `/api/users/${ALICE_ID}/password`, good()), deps)).status).toBe(404);
  });

  it('is routed through api/router.js', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://auth.example.test');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-public-key');
    supabaseJs.client = callerClient();
    const admin = profilesAdmin();
    adminHolder.client = admin.client;
    const res = { statusCode: 200, body: undefined, setHeader: vi.fn(), end: vi.fn((raw) => { if (raw !== undefined) res.body = JSON.parse(raw); return res; }) };
    await routerHandler({ method: 'POST', url: '/api/router', query: { __route: `users/${ALICE_ID}/credits` }, headers: { host: 'localhost', authorization: 'Bearer verified-token' }, body: good() }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, balance: 1250.5 });
    expect(admin.adjustments()[0].args).toMatchObject({ p_admin: ADMIN_ID });
  });
});

describe('the directory reads the effective plan', () => {
  it('shows a lapsed period as free, with the lapse flagged', async () => {
    const rows = profileRows();
    Object.assign(rows[2], { plan_status: 'active', plan_period_end: '2020-01-01T00:00:00Z', plan_source: 'payment' });
    const { deps } = setup({}, rows);
    const response = await invoke(request('GET', '/api/users'), deps);
    expect(response.body.users.find((u) => u.id === ALICE_ID)).toMatchObject({ plan: 'free', planStatus: 'free', planLapsed: true, planEnd: '2020-01-01T00:00:00Z' });
  });
});

describe('api/router.js /api/users', () => {
  function vercelResponse() {
    const res = {
      statusCode: 200,
      body: undefined,
      setHeader: vi.fn(),
      status: vi.fn((code) => { res.statusCode = code; return res; }),
      json: vi.fn((body) => { res.body = body; return res; }),
      end: vi.fn((raw) => { if (raw !== undefined) res.body = JSON.parse(raw); return res; }),
    };
    return res;
  }
  function vercelRequest(method, route, body, headers = {}) {
    return { method, url: `/api/router?__route=${encodeURIComponent(route)}`, query: { __route: route }, headers: { host: 'localhost', ...headers }, body };
  }

  it('routes PATCH /api/users/:userId to the handler, which rejects a missing bearer', async () => {
    const admin = profilesAdmin();
    adminHolder.client = admin.client;
    const res = vercelResponse();
    await routerHandler(vercelRequest('PATCH', `users/${ALICE_ID}`, { active: true }), res);
    expect(res.statusCode).toBe(401);
    expect(admin.writes()).toEqual([]);
  });

  it('applies an authorized PATCH with a host-parsed body end to end', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://auth.example.test');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-public-key');
    supabaseJs.client = callerClient();
    const admin = profilesAdmin();
    adminHolder.client = admin.client;
    const res = vercelResponse();
    await routerHandler(vercelRequest('PATCH', `users/${ALICE_ID}`, { active: true }, { authorization: 'Bearer verified-token' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, user: { id: ALICE_ID, active: true } });
    expect(admin.writes()[0].patch).toEqual({ status: 'active' });
  });

  // The router rewrites req.url to the bare path, so the page and the search arrive on req.query (what Vercel parsed).
  it('passes the page and the search of GET /api/users through the router', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://auth.example.test');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-public-key');
    supabaseJs.client = callerClient();
    const admin = profilesAdmin([...profileRows(), ...moreProfiles(240, { prefix: 'team' })]);
    adminHolder.client = admin.client;
    const res = vercelResponse();
    const req = {
      ...vercelRequest('GET', 'users', undefined, { authorization: 'Bearer verified-token' }),
      url: '/api/router?__route=users&page=3&q=team',
      query: { __route: 'users', page: '3', q: 'team' },
    };
    await routerHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, page: 3, pageSize: 100, total: 240 });
    expect(res.body.users).toHaveLength(40);
    expect(res.body.users.every((u) => u.email.startsWith('team'))).toBe(true);
  });

  it('refuses a bad page through the router with 400 after the admin check', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://auth.example.test');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-public-key');
    supabaseJs.client = callerClient();
    adminHolder.client = profilesAdmin().client;
    const res = vercelResponse();
    await routerHandler({ ...vercelRequest('GET', 'users', undefined, { authorization: 'Bearer verified-token' }), query: { __route: 'users', page: 'abc' } }, res);
    expect(res.statusCode).toBe(400);
    supabaseJs.client = callerClient({ role: 'user', admin: false });
    const refused = vercelResponse();
    await routerHandler({ ...vercelRequest('GET', 'users', undefined, { authorization: 'Bearer verified-token' }), query: { __route: 'users', page: 'abc' } }, refused);
    expect(refused.statusCode).toBe(403);
  });

  it('answers 405 to PUT /api/users through the router', async () => {
    const admin = profilesAdmin();
    adminHolder.client = admin.client;
    const res = vercelResponse();
    await routerHandler(vercelRequest('PUT', 'users', { users: [] }, { authorization: 'Bearer verified-token' }), res);
    expect(res.statusCode).toBe(405);
    expect(admin.writes()).toEqual([]);
  });
});
