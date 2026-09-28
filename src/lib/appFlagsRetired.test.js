// The testing-phase flag was retired on 2026-09-28 (plan task C6). The
// production entry (api/router.js) no longer serves /api/app-flags, so no
// request to it can read or write public.app_flags.
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
