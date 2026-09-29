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

const FREE = { planStatus: 'free', planEnd: null, planSource: null, planLapsed: false, trialUsed: false };
const ALICE_PLAN = { planStatus: 'trial', planEnd: '2099-01-01T00:00:00Z', planSource: 'trial', planLapsed: false, trialUsed: true };
const OWNER_PLAN = { planStatus: 'active', planEnd: null, planSource: 'manual', planLapsed: false, trialUsed: false };

function profileRows() {
  // Deliberately out of order, and carrying columns the directory must not
  // expose (a provider that ignores the column list must not leak them).
  return [
    { id: 'p-3', user_id: OWNER_ID, email: 'owner@example.test', first_name: 'Olu', last_name: 'Owner', persona: null, role: 'owner', plan: 'enterprise', plan_status: 'active', plan_period_end: null, plan_source: 'manual', trial_started_at: null, status: 'active', created_at: '2026-09-03T00:00:00Z', phone_number: '+91-private', password: 'must-not-leak' },
    { id: 'p-1', user_id: ADMIN_ID, email: 'admin@example.test', first_name: 'Ada', last_name: null, persona: 'corporate_affairs', role: 'admin', plan: 'explorer', plan_status: 'free', plan_period_end: null, plan_source: null, trial_started_at: null, status: 'active', created_at: '2026-09-01T00:00:00Z', phone_number: '+91-private', password: 'must-not-leak' },
    { id: 'p-2', user_id: ALICE_ID, email: 'alice@example.test', first_name: null, last_name: null, persona: 'upsc_aspirant', role: 'user', plan: 'professional', plan_status: 'trial', plan_period_end: '2099-01-01T00:00:00Z', plan_source: 'trial', trial_started_at: '2026-09-02T00:00:00Z', status: 'suspended', created_at: '2026-09-02T00:00:00Z', phone_number: '+91-private', password: 'must-not-leak' },
  ];
}

/** In-memory public.user_profiles behind a PostgREST-shaped builder. */
function profilesAdmin(rows = profileRows()) {
  const state = { rows, calls: [], fail: null };
  const matches = (row, filters) => filters.every(([kind, column, value]) => (kind === 'eq' ? row[column] === value : row[column] !== value));
  const client = {
    // grant_manual_plan, as the migration defines it (explorer revokes).
    rpc: vi.fn(async (name, args) => {
      state.calls.push({ op: 'rpc', name, args });
      if (state.fail === 'rpc' || state.fail === 'all') return { data: null, error: { message: 'private-provider-detail', code: 'XX000' } };
      if (state.rpcError) return { data: null, error: state.rpcError };
      expect(name).toBe('grant_manual_plan');
      const row = state.rows.find((r) => r.user_id === args.p_user);
      if (!row) return { data: null, error: { message: 'No profile for this user', code: 'P0002' } };
      const plan = args.p_plan === 'pro' ? 'professional' : args.p_plan;
      Object.assign(row, plan === 'explorer'
        ? { plan, plan_status: 'free', plan_source: 'manual', plan_period_end: null }
        : { plan, plan_status: 'active', plan_source: 'manual', plan_period_end: args.p_period_end });
      return { data: { plan, status: row.plan_status }, error: null };
    }),
    from: vi.fn((table) => {
      expect(table).toBe('user_profiles');
      const q = { op: 'select', patch: null, filters: [], order: null };
      const execute = () => {
        state.calls.push({ op: q.op, patch: q.patch, filters: q.filters, order: q.order });
        if (state.fail === q.op || state.fail === 'all') return { data: null, error: { message: 'private-provider-detail', code: 'XX000' } };
        const hits = state.rows.filter((row) => matches(row, q.filters));
        if (q.op === 'update') for (const row of hits) Object.assign(row, q.patch);
        const out = hits.map((row) => ({ ...row }));
        if (q.order) out.sort((a, b) => (q.order.ascending ? 1 : -1) * String(a[q.order.column]).localeCompare(String(b[q.order.column])));
        return { data: out, error: null };
      };
      const builder = {
        select: () => builder,
        update: (patch) => { q.op = 'update'; q.patch = patch; return builder; },
        eq: (column, value) => { q.filters.push(['eq', column, value]); return builder; },
        neq: (column, value) => { q.filters.push(['neq', column, value]); return builder; },
        order: (column, options = {}) => { q.order = { column, ascending: options.ascending !== false }; return builder; },
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
    grants: () => state.calls.filter((call) => call.op === 'rpc'),
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
      { id: ADMIN_ID, name: 'Ada', email: 'admin@example.test', type: 'analyst', personaId: 'analyst', plan: 'explorer', ...FREE, active: true, status: 'active', role: 'admin', createdAt: '2026-09-01T00:00:00Z' },
      { id: ALICE_ID, name: 'alice', email: 'alice@example.test', type: 'student', personaId: 'student', plan: 'pro', ...ALICE_PLAN, active: false, status: 'suspended', role: 'user', createdAt: '2026-09-02T00:00:00Z' },
      { id: OWNER_ID, name: 'Olu Owner', email: 'owner@example.test', type: null, personaId: null, plan: 'enterprise', ...OWNER_PLAN, active: true, status: 'active', role: 'owner', createdAt: '2026-09-03T00:00:00Z' },
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
    ['a plan change', { active: true, plan: 'enterprise' }],
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
    const response = await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { plan: 'enterprise', planEnd: '2099-12-31' }), deps);
    expect(response.status).toBe(200);
    expect(admin.grants()).toEqual([{ op: 'rpc', name: 'grant_manual_plan', args: { p_user: ALICE_ID, p_plan: 'enterprise', p_period_end: '2099-12-31T00:00:00.000Z', p_granted_by: ADMIN_ID } }]);
    expect(admin.writes()).toEqual([]);
    expect(response.body.user).toMatchObject({ id: ALICE_ID, plan: 'enterprise', planStatus: 'active', planSource: 'manual', planEnd: '2099-12-31T00:00:00.000Z' });
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

  it('revokes to explorer', async () => {
    const { admin, deps } = setup();
    const response = await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { plan: 'explorer' }), deps);
    expect(response.status).toBe(200);
    expect(admin.grants()[0].args).toMatchObject({ p_plan: 'explorer', p_period_end: null });
    expect(response.body.user).toMatchObject({ plan: 'explorer', planStatus: 'free' });
  });

  it.each([
    ['an unknown plan', { plan: 'gov' }],
    ['a database plan name', { plan: 'professional' }],
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
    expect((await invoke(request('PATCH', `/api/users/${OWNER_ID}`, { plan: 'explorer' }), deps)).status).toBe(403);
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
      expect((await invoke(request('PATCH', `/api/users/${ALICE_ID}`, { plan: 'enterprise' }), deps)).status).toBe(403);
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

describe('the directory reads the effective plan', () => {
  it('shows a lapsed period as explorer, with the lapse flagged', async () => {
    const rows = profileRows();
    Object.assign(rows[2], { plan_status: 'active', plan_period_end: '2020-01-01T00:00:00Z', plan_source: 'payment' });
    const { deps } = setup({}, rows);
    const response = await invoke(request('GET', '/api/users'), deps);
    expect(response.body.users.find((u) => u.id === ALICE_ID)).toMatchObject({ plan: 'explorer', planStatus: 'free', planLapsed: true, planEnd: '2020-01-01T00:00:00Z' });
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

  it('answers 405 to PUT /api/users through the router', async () => {
    const admin = profilesAdmin();
    adminHolder.client = admin.client;
    const res = vercelResponse();
    await routerHandler(vercelRequest('PUT', 'users', { users: [] }, { authorization: 'Bearer verified-token' }), res);
    expect(res.statusCode).toBe(405);
    expect(admin.writes()).toEqual([]);
  });
});
