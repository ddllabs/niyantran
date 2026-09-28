// Routes retired from the production entry (api/router.js) on 2026-09-28:
// /api/app-flags with the testing-phase flag (plan task C6), and /api/auth/*,
// which the app never called (it uses Supabase Auth directly).
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
  beforeEach(() => {
    adminClient.from = vi.fn(() => { throw new Error('app_flags must not be touched'); });
  });

  it.each(['GET', 'PUT'])('%s is no longer served and touches no table', async (method) => {
    const res = vercelResponse();
    await handler(vercelRequest(method, method === 'PUT' ? { testingPhase: true } : undefined, { authorization: 'Bearer x' }), res);
    expect(res.statusCode).toBe(404);
    expect(adminClient.from).not.toHaveBeenCalled();
  });
});

describe('api/router.js /api/auth/*', () => {
  beforeEach(() => {
    adminClient.from = vi.fn(() => { throw new Error('no table may be touched'); });
  });

  it.each([
    ['POST', 'auth/login', { email: 'a@example.test', password: 'x' }],
    ['POST', 'auth/signup', { email: 'a@example.test', password: 'long-enough-1' }],
    ['POST', 'auth/forgot-password', { email: 'a@example.test' }],
    ['POST', 'auth/reset-password', { password: 'long-enough-1' }],
    ['POST', 'auth/resend-verification', { email: 'a@example.test' }],
    ['GET', 'auth/provider', undefined],
    ['GET', 'auth/me', undefined],
  ])('%s /api/%s is not served', async (method, route, body) => {
    const res = vercelResponse();
    await handler({ method, url: `/api/router?__route=${route}`, query: { __route: route }, headers: { host: 'localhost', authorization: 'Bearer x' }, body }, res);
    expect(res.statusCode).toBe(404);
  });
});
