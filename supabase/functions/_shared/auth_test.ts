import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { requireUser } from './auth.ts';
import { HttpError } from './http.ts';

const GOOD = 'aaa.bbb.ccc';
const acceptAll = (_: string) => Promise.resolve({ id: 'user-1' });
const rejectAll = (_: string) => Promise.resolve(null);

function req(authorization?: string) {
  return new Request('https://f/x', { headers: authorization ? { authorization } : {} });
}

Deno.test('401 without a token, before any verification call', async () => {
  let called = 0;
  const spy = (t: string) => {
    called++;
    return acceptAll(t);
  };
  const err = await assertRejects(() => requireUser(req(), spy), HttpError);
  assertEquals(err.status, 401);
  assertEquals(called, 0);
});

Deno.test('401 for a non-Bearer scheme and for a malformed token, without verification', async () => {
  let called = 0;
  const spy = (t: string) => {
    called++;
    return acceptAll(t);
  };
  await assertRejects(() => requireUser(req('Basic abc'), spy), HttpError);
  await assertRejects(() => requireUser(req('Bearer not-a-jwt'), spy), HttpError);
  assertEquals(called, 0);
});

Deno.test('401 when the auth server rejects the token', async () => {
  const err = await assertRejects(() => requireUser(req(`Bearer ${GOOD}`), rejectAll), HttpError);
  assertEquals(err.status, 401);
});

Deno.test('returns the user id and the raw token when accepted', async () => {
  const caller = await requireUser(req(`bearer ${GOOD}`), acceptAll);
  assertEquals(caller, { userId: 'user-1', token: GOOD });
});
