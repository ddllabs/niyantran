import { assertEquals } from 'jsr:@std/assert@1';
import { handleHealth, type HealthDeps } from './handler.ts';

const ORIGINS = ['http://localhost:5173'];
const ROW = { vector: true, pricing_rows: 3, models_enabled: 1, uid: 'user-1' };

function deps(over: Partial<HealthDeps> = {}): HealthDeps {
  return {
    verify: () => Promise.resolve({ id: 'user-1' }),
    probe: () => Promise.resolve(ROW),
    version: 'test',
    origins: ORIGINS,
    ...over,
  };
}

const get = (auth?: string) => new Request('https://f/health', { method: 'GET', headers: auth ? { authorization: auth, origin: ORIGINS[0] } : { origin: ORIGINS[0] } });

Deno.test('401 without a token, and the probe is never run', async () => {
  let probed = 0;
  const res = await handleHealth(get(), deps({ probe: () => (probed++, Promise.resolve(ROW)) }));
  assertEquals(res.status, 401);
  assertEquals(probed, 0);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), ORIGINS[0]);
});

Deno.test('200 with the documented shape for an accepted token', async () => {
  const res = await handleHealth(get('Bearer a.b.c'), deps());
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, version: 'test', vector: true, pricing_rows: 3, models_enabled: 1, user_id: 'user-1' });
});

Deno.test('500 when the database uid disagrees with the token subject', async () => {
  const res = await handleHealth(get('Bearer a.b.c'), deps({ probe: () => Promise.resolve({ ...ROW, uid: 'someone-else' }) }));
  assertEquals(res.status, 500);
});

Deno.test('405 for POST and 204 for preflight', async () => {
  const post = await handleHealth(new Request('https://f/health', { method: 'POST', headers: { authorization: 'Bearer a.b.c' } }), deps());
  assertEquals(post.status, 405);
  const opt = await handleHealth(new Request('https://f/health', { method: 'OPTIONS', headers: { origin: ORIGINS[0] } }), deps());
  assertEquals(opt.status, 204);
});
