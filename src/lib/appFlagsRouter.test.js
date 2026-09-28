// The production entry (api/router.js) must route /api/app-flags through the
// authorized handler: a PUT without an internal-admin bearer never writes.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const adminClient = vi.hoisted(() => ({ from: null }));

vi.mock('../../server/authEmailProvider.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  getSupabaseAdminClient: vi.fn(() => adminClient),
}));

import handler from '../../api/router.js';

function vercelResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader: vi.fn((name, value) => { res.headers[name.toLowerCase()] = value; }),
    status: vi.fn((code) => { res.statusCode = code; return res; }),
    json: vi.fn((body) => { res.body = body; return res; }),
    end: vi.fn((raw) => { if (raw !== undefined) res.body = JSON.parse(raw); return res; }),
  };
  return res;
}

function vercelRequest(method, body, headers = {}) {
  return { method, url: '/api/router?__route=app-flags', query: { __route: 'app-flags' }, headers: { host: 'localhost', ...headers }, body };
}

describe('api/router.js /api/app-flags', () => {
  let upserts;
  beforeEach(() => {
    upserts = [];
    adminClient.from = vi.fn(() => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: { key: 'testing_phase', value: true, updated_at: '2026-09-28T09:00:00.000Z' }, error: null }),
        upsert: (row) => { upserts.push(row); return builder; },
        single: async () => ({ data: null, error: { message: 'unexpected write' } }),
      };
      return builder;
    });
  });

  it('serves GET publicly from Supabase', async () => {
    const res = vercelResponse();
    await handler(vercelRequest('GET'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, flags: { testingPhase: true, updatedAt: '2026-09-28T09:00:00.000Z' } });
  });

  it('rejects PUT without a bearer before any write', async () => {
    const res = vercelResponse();
    await handler(vercelRequest('PUT', { testingPhase: false }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(upserts).toEqual([]);
  });
});
