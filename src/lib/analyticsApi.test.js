import { beforeEach, describe, expect, it, vi } from 'vitest';

// The handler must never reach SQLite: on a serverless host that file lives in
// a per-instance /tmp directory and is lost on cold starts (ADR 0005).
vi.mock('../../server/db.mjs', () => ({
  getDb: vi.fn(async () => {
    throw new Error('analytics must not use SQLite');
  }),
  queryAll: vi.fn(() => {
    throw new Error('analytics must not use SQLite');
  }),
  run: vi.fn(() => {
    throw new Error('analytics must not use SQLite');
  }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => {
    throw new Error('tests must inject their clients');
  }),
}));

import { handleAnalyticsApi } from '../../server/analyticsApi.mjs';

const USER_ID = '00000000-0000-4000-8000-0000000000a1';

function request(method, url, { body, authorization, headers = {} } = {}) {
  return {
    method,
    url,
    headers: { host: 'localhost', ...headers, ...(authorization == null ? {} : { authorization }) },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

async function invoke(req, deps) {
  const res = { setHeader: vi.fn(), end: vi.fn() };
  const next = vi.fn();
  await handleAnalyticsApi(req, res, next, deps);
  const raw = res.end.mock.calls[0]?.[0];
  return { status: res.statusCode, body: raw ? JSON.parse(raw) : undefined, next };
}

function fakeAdmin({ insertError = null, rows = [], summary = { total: 0, byName: [] }, rate = { data: true, error: null } } = {}) {
  const inserts = [];
  const selects = [];
  const admin = {
    inserts,
    selects,
    from: vi.fn((table) => ({
      insert: vi.fn(async (row) => {
        inserts.push({ table, row });
        return { data: null, error: insertError };
      }),
      select: vi.fn((columns) => {
        const query = { table, columns };
        selects.push(query);
        const chain = {
          order: vi.fn((column, options) => {
            query.order = [column, options];
            return chain;
          }),
          limit: vi.fn(async (n) => {
            query.limit = n;
            return { data: rows, error: null };
          }),
        };
        return chain;
      }),
    })),
    rpc: vi.fn(async (name) => {
      if (name === 'analytics_rate_hit') {
        if (rate instanceof Error) throw rate;
        return rate;
      }
      return { data: summary, error: null };
    }),
  };
  return admin;
}

function fakeCaller({ userId = USER_ID, admin = false, valid = true } = {}) {
  return {
    auth: {
      getUser: vi.fn(async () =>
        valid
          ? { data: { user: { id: userId, email: 'caller@example.test' } }, error: null }
          : { data: { user: null }, error: { message: 'invalid JWT' } },
      ),
    },
    rpc: vi.fn(async (name) => ({
      data: name === 'is_platform_admin' ? admin : { user_id: userId, role: admin ? 'admin' : 'user', status: 'active' },
      error: null,
    })),
  };
}

function setup({ admin = fakeAdmin(), caller = fakeCaller() } = {}) {
  return {
    admin,
    caller,
    deps: { adminClient: vi.fn(() => admin), clientForToken: vi.fn(() => caller) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/analytics/event', () => {
  it('records an anonymous event with a null user and no email', async () => {
    const { admin, deps } = setup();
    const response = await invoke(
      request('POST', '/api/analytics/event', {
        body: { name: 'home_open', props: { deskId: 'home' }, sessionId: 's-abc-123', userEmail: 'Victim@Example.test' },
      }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, stored: true });
    expect(typeof response.body.at).toBe('string');
    expect(admin.inserts).toEqual([
      {
        table: 'analytics_events',
        row: { name: 'home_open', props: { deskId: 'home' }, session_id: 's-abc-123', user_id: null },
      },
    ]);
    expect(JSON.stringify(admin.inserts)).not.toMatch(/example\.test/i);
    expect(deps.clientForToken).not.toHaveBeenCalled();
  });

  it('records the verified user for a valid bearer', async () => {
    const { admin, caller, deps } = setup();
    const response = await invoke(
      request('POST', '/api/analytics/event', { body: { name: 'tour_done' }, authorization: 'Bearer good-token' }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(deps.clientForToken).toHaveBeenCalledWith('good-token');
    expect(caller.auth.getUser).toHaveBeenCalledWith('good-token');
    expect(admin.inserts[0].row).toEqual({ name: 'tour_done', props: {}, session_id: null, user_id: USER_ID });
  });

  it('still records an invalid bearer anonymously instead of failing the page', async () => {
    const { admin, deps } = setup({ caller: fakeCaller({ valid: false }) });
    const response = await invoke(
      request('POST', '/api/analytics/event', { body: { name: 'tour_done' }, authorization: 'Bearer expired' }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(admin.inserts[0].row.user_id).toBeNull();
  });

  it('accepts a body the host already parsed', async () => {
    const { admin, deps } = setup();
    const req = request('POST', '/api/analytics/event');
    req.body = { name: 'plan_selected', props: { plan: 'pro' } };
    const response = await invoke(req, deps);
    expect(response.status).toBe(200);
    expect(admin.inserts[0].row).toMatchObject({ name: 'plan_selected', props: { plan: 'pro' } });
  });

  it.each([
    ['a missing name', {}],
    ['an empty name', { name: '' }],
    ['a non-string name', { name: 42 }],
    ['an uppercase name', { name: 'Home_Open' }],
    ['a name with spaces', { name: 'home open' }],
    ['a name with markup', { name: '<script>' }],
    ['a name over 64 characters', { name: 'a'.repeat(65) }],
    ['array props', { name: 'home_open', props: ['x'] }],
    ['string props', { name: 'home_open', props: 'x' }],
    ['oversize props', { name: 'home_open', props: { blob: 'x'.repeat(4096) } }],
    ['a non-string session id', { name: 'home_open', sessionId: { id: 1 } }],
    ['a session id over 64 characters', { name: 'home_open', sessionId: 's'.repeat(65) }],
  ])('rejects %s with 400 and never writes', async (_label, body) => {
    const { admin, deps } = setup();
    const response = await invoke(request('POST', '/api/analytics/event', { body }), deps);
    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(admin.inserts).toEqual([]);
    expect(deps.adminClient).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{"name":'],
    ['a JSON array', '["home_open"]'],
    ['JSON null', 'null'],
  ])('rejects %s with 400 and never writes', async (_label, body) => {
    const { admin, deps } = setup();
    const response = await invoke(request('POST', '/api/analytics/event', { body }), deps);
    expect(response.status).toBe(400);
    expect(admin.inserts).toEqual([]);
  });

  it('rejects an oversize body with 413 and never writes', async () => {
    const { admin, deps } = setup();
    const body = JSON.stringify({ name: 'home_open', props: { blob: 'x'.repeat(64 * 1024) } });
    const response = await invoke(request('POST', '/api/analytics/event', { body }), deps);
    expect(response.status).toBe(413);
    expect(admin.inserts).toEqual([]);
  });

  it('maps a database bound violation to 400', async () => {
    const { deps } = setup({ admin: fakeAdmin({ insertError: { code: '23514', message: 'check violation detail' } }) });
    const response = await invoke(request('POST', '/api/analytics/event', { body: { name: 'home_open' } }), deps);
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain('check violation detail');
  });

  it('returns 503 without throwing when Supabase is not configured', async () => {
    const deps = {
      adminClient: vi.fn(() => {
        throw new Error('SUPABASE_SECRET_KEY is required');
      }),
      clientForToken: vi.fn(),
    };
    const response = await invoke(request('POST', '/api/analytics/event', { body: { name: 'home_open' } }), deps);
    expect(response.status).toBe(503);
    expect(response.body.ok).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain('SUPABASE_SECRET_KEY');
  });

  it('returns 503 when the insert fails', async () => {
    const { deps } = setup({ admin: fakeAdmin({ insertError: { code: 'PGRST000', message: 'connection refused' } }) });
    const response = await invoke(request('POST', '/api/analytics/event', { body: { name: 'home_open' } }), deps);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('connection refused');
  });
});

describe('graceful routes', () => {
  it('describes the event endpoint on GET without touching storage', async () => {
    const { deps } = setup();
    const response = await invoke(request('GET', '/api/analytics/event'), deps);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, endpoint: 'event', methods: ['POST'] });
    expect(deps.adminClient).not.toHaveBeenCalled();
  });

  it('answers OPTIONS with 204', async () => {
    const { deps } = setup();
    const res = { setHeader: vi.fn(), end: vi.fn() };
    await handleAnalyticsApi(request('OPTIONS', '/api/analytics/event'), res, vi.fn(), deps);
    expect(res.statusCode).toBe(204);
    expect(deps.adminClient).not.toHaveBeenCalled();
  });

  it('passes other paths to next', async () => {
    const { deps } = setup();
    const next = vi.fn();
    await handleAnalyticsApi(request('GET', '/api/other'), { setHeader: vi.fn(), end: vi.fn() }, next, deps);
    expect(next).toHaveBeenCalled();
  });
});

describe.each(['/api/analytics/events', '/api/analytics/summary'])('GET %s', (path) => {
  it('rejects a request without a bearer before reading', async () => {
    const { deps } = setup();
    const response = await invoke(request('GET', path), deps);
    expect(response.status).toBe(401);
    expect(deps.adminClient).not.toHaveBeenCalled();
  });

  it('rejects a signed-in non-admin before reading', async () => {
    const { deps } = setup({ caller: fakeCaller({ admin: false }) });
    const response = await invoke(request('GET', path, { authorization: 'Bearer user-token' }), deps);
    expect(response.status).toBe(403);
    expect(deps.adminClient).not.toHaveBeenCalled();
  });
});

describe('admin reads', () => {
  it('lists recent events for an internal admin', async () => {
    const admin = fakeAdmin({
      rows: [
        { id: 7, name: 'home_open', props: { a: 1 }, session_id: 's-1', user_id: USER_ID, created_at: '2026-09-28T00:00:00Z' },
      ],
    });
    const { caller, deps } = setup({ admin, caller: fakeCaller({ admin: true }) });
    const response = await invoke(request('GET', '/api/analytics/events?limit=5000', { authorization: 'Bearer admin-token' }), deps);
    expect(response.status).toBe(200);
    expect(caller.rpc.mock.calls).toEqual([['get_my_profile'], ['is_platform_admin']]);
    expect(admin.selects[0]).toMatchObject({ table: 'analytics_events', order: ['id', { ascending: false }], limit: 500 });
    expect(response.body.ok).toBe(true);
    expect(response.body.rows).toEqual([
      {
        id: 7,
        name: 'home_open',
        props: { a: 1 },
        sessionId: 's-1',
        userId: USER_ID,
        userEmail: null,
        createdAt: '2026-09-28T00:00:00Z',
      },
    ]);
  });

  it('summarises counts for an internal admin', async () => {
    const admin = fakeAdmin({ summary: { total: 3, byName: [{ name: 'home_open', n: 2 }, { name: 'tour_done', n: 1 }] } });
    const { deps } = setup({ admin, caller: fakeCaller({ admin: true }) });
    const response = await invoke(request('GET', '/api/analytics/summary', { authorization: 'Bearer admin-token' }), deps);
    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith('analytics_event_summary', { p_limit: 50 });
    expect(response.body).toMatchObject({
      ok: true,
      total: 3,
      byName: [
        { name: 'home_open', n: 2 },
        { name: 'tour_done', n: 1 },
      ],
    });
  });
});

// Wave-1 follow-up 6 (owner decision 2026-09-28): 60 events a minute per
// client, counted in Postgres so the limit holds across Vercel instances, and
// keyed by an HMAC of the IP so no raw address is stored.
describe('POST /api/analytics/event rate limit', () => {
  const event = { name: 'home_open', props: {}, sessionId: 's-1' };
  const rateCalls = (admin) => admin.rpc.mock.calls.filter(([name]) => name === 'analytics_rate_hit');

  it('counts each event against a hashed-IP bucket, 60 a minute', async () => {
    const { admin, deps } = setup();
    const response = await invoke(request('POST', '/api/analytics/event', { body: event, headers: { 'x-real-ip': '203.0.113.7' } }), deps);
    expect(response.status).toBe(200);
    const [[, args]] = rateCalls(admin);
    expect(args).toMatchObject({ p_limit: 60, p_window_seconds: 60 });
    expect(args.p_bucket).toMatch(/^ip:[0-9a-f]{64}$/);
    expect(args.p_bucket).not.toContain('203.0.113.7');
  });

  it('gives the same client the same bucket and another client another', async () => {
    const buckets = [];
    for (const ip of ['203.0.113.7', '203.0.113.7', '198.51.100.9']) {
      const { admin, deps } = setup();
      await invoke(request('POST', '/api/analytics/event', { body: event, headers: { 'x-real-ip': ip } }), deps);
      buckets.push(rateCalls(admin)[0][1].p_bucket);
    }
    expect(buckets[0]).toBe(buckets[1]);
    expect(buckets[2]).not.toBe(buckets[0]);
  });

  it('uses the first x-forwarded-for address when x-real-ip is absent', async () => {
    const a = setup();
    await invoke(request('POST', '/api/analytics/event', { body: event, headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } }), a.deps);
    const b = setup();
    await invoke(request('POST', '/api/analytics/event', { body: event, headers: { 'x-real-ip': '203.0.113.7' } }), b.deps);
    expect(rateCalls(a.admin)[0][1].p_bucket).toBe(rateCalls(b.admin)[0][1].p_bucket);
  });

  it('refuses an event over the limit with 429 and stores nothing', async () => {
    const { admin, deps } = setup({ admin: fakeAdmin({ rate: { data: false, error: null } }) });
    const response = await invoke(request('POST', '/api/analytics/event', { body: event, headers: { 'x-real-ip': '203.0.113.7' } }), deps);
    expect(response.status).toBe(429);
    expect(response.body).toEqual({ ok: false, error: 'Too many events' });
    expect(admin.inserts).toEqual([]);
  });

  it('still records the event when the limiter itself fails', async () => {
    for (const rate of [{ data: null, error: { message: 'down' } }, new Error('network')]) {
      const { admin, deps } = setup({ admin: fakeAdmin({ rate }) });
      const response = await invoke(request('POST', '/api/analytics/event', { body: event }), deps);
      expect(response.status).toBe(200);
      expect(admin.inserts).toHaveLength(1);
    }
  });

  it('checks the limit only for a well-formed event', async () => {
    const { admin, deps } = setup();
    const response = await invoke(request('POST', '/api/analytics/event', { body: { name: 'Bad Name!' } }), deps);
    expect(response.status).toBe(400);
    expect(rateCalls(admin)).toEqual([]);
  });
});
