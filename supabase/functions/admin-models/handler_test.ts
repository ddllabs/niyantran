import { assertEquals } from 'jsr:@std/assert@1';
import { type AdminDeps, handleAdminModels, pickRow } from './handler.ts';

const READ = { models: [{ model_id: 'v/a', enabled: true }], roles: [], catalogue: [{ model_id: 'v/a' }] };

function deps(over: Partial<AdminDeps> = {}): AdminDeps {
  return {
    verify: () => Promise.resolve({ id: 'user-1' }),
    isAdmin: () => Promise.resolve(true),
    read: () => Promise.resolve(READ),
    write: (_kind, row) => Promise.resolve({ row }),
    origins: ['http://localhost:5173'],
    ...over,
  };
}

const get = (auth = 'Bearer a.b.c') => new Request('https://f/admin-models', { method: 'GET', headers: { authorization: auth } });
const put = (body: unknown, auth = 'Bearer a.b.c') =>
  new Request('https://f/admin-models', { method: 'PUT', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });

Deno.test('401 without a token', async () => {
  const res = await handleAdminModels(new Request('https://f/admin-models'), deps());
  assertEquals(res.status, 401);
});

Deno.test('403 for a signed-in non-admin, and nothing is read or written', async () => {
  let touched = 0;
  const d = deps({ isAdmin: () => Promise.resolve(false), read: () => (touched++, Promise.resolve(READ)), write: (_k, row) => (touched++, Promise.resolve({ row })) });
  assertEquals((await handleAdminModels(get(), d)).status, 403);
  assertEquals((await handleAdminModels(put({ kind: 'model', row: { model_id: 'v/a', enabled: true } }), d)).status, 403);
  assertEquals(touched, 0);
});

Deno.test('GET returns models, roles and the tool-capable catalogue', async () => {
  const res = await handleAdminModels(get(), deps());
  assertEquals(res.status, 200);
  assertEquals(await res.json(), READ);
});

Deno.test('PUT validates kind and row shape before writing', async () => {
  let written = 0;
  const d = deps({ write: (_k, row) => (written++, Promise.resolve({ row })) });
  assertEquals((await handleAdminModels(put({ kind: 'thing', row: {} }), d)).status, 400);
  assertEquals((await handleAdminModels(put({ kind: 'model', row: { label: 'no id' } }), d)).status, 400);
  assertEquals((await handleAdminModels(put({ kind: 'model', row: { model_id: 'v/a', enabled: 'yes' } }), d)).status, 400);
  assertEquals((await handleAdminModels(new Request('https://f/admin-models', { method: 'PUT', headers: { authorization: 'Bearer a.b.c' }, body: '{oops' }), d)).status, 400);
  assertEquals(written, 0);
});

Deno.test('PUT strips unknown keys and returns the saved row', async () => {
  let got: Record<string, unknown> = {};
  const d = deps({ write: (_k, row) => ((got = row), Promise.resolve({ row: { ...row, vendor: 'v' } })) });
  const res = await handleAdminModels(put({ kind: 'model', row: { model_id: 'v/a', enabled: true, evil: 'drop table' } }), d);
  assertEquals(res.status, 200);
  assertEquals(got, { model_id: 'v/a', enabled: true });
  assertEquals((await res.json()).row.vendor, 'v');
});

Deno.test('a guard refusal from the database comes back as 400 with its message', async () => {
  const d = deps({ write: () => Promise.resolve({ error: 'model openai/gpt-6-astra is not in the OpenRouter catalogue with tool support' }) });
  const res = await handleAdminModels(put({ kind: 'model', row: { model_id: 'openai/gpt-6-astra', enabled: true } }), d);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.includes('not in the OpenRouter catalogue'), true);
});

Deno.test('pickRow keeps role fields and drops model fields for a role', () => {
  assertEquals(pickRow('role', { role_id: 'DEFAULT_ANALYST', model_id: 'v/a', enabled: true, hint: 'h' }), { role_id: 'DEFAULT_ANALYST', model_id: 'v/a', hint: 'h' });
});
