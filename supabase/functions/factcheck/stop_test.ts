import { assertEquals } from 'jsr:@std/assert@1';
import { handleFactcheck } from './handler.ts';
import { captureLogs, harness, jsonRequest, SESSION, USER } from './testkit.ts';

const stop = (o: Record<string, unknown> = {}) => jsonRequest({ action: 'stop', session_id: SESSION, ...o });

Deno.test('stop settles the session for the verified user and returns the charge', async () => {
  const h = harness();
  const res = await handleFactcheck(stop(), h.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { minutes_used: 2, credits_charged: 1000, balance: 4000 });
  assertEquals(h.rpcCalls, [{ name: 'factcheck_settle', args: { p_user: USER, p_session: SESSION } }]);
  assertEquals(h.fetches.length, 0);
});

Deno.test('stop is idempotent: the repeated settlement answers the same 200 with the same figures', async () => {
  const h = harness();
  const first = await (await handleFactcheck(stop(), h.deps)).json();
  h.rpcResult.factcheck_settle = {
    data: { ok: true, repeated: true, minutes_used: 2, credits_charged: 1000, balance: 4000 },
    error: null,
  };
  const res = await handleFactcheck(stop(), h.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), first);
});

Deno.test("stop on a session that is not the caller's is a 404 not_found", async () => {
  const h = harness();
  h.rpcResult.factcheck_settle = { data: { ok: false, reason: 'not_found' }, error: null };
  const res = await handleFactcheck(stop(), h.deps);
  assertEquals(res.status, 404);
  assertEquals((await res.json()).reason, 'not_found');
});

Deno.test('stop with a missing or malformed session id is a 400 and never reaches the database', async () => {
  for (const session_id of [undefined, '', 'not-a-uuid', 7, '22222222-2222-4222-8222-22222222222']) {
    const h = harness();
    assertEquals((await handleFactcheck(stop({ session_id }), h.deps)).status, 400);
    assertEquals(h.rpcCalls, []);
  }
});

Deno.test('an unusable settlement answer is a 500', async () => {
  for (
    const data of [null, { ok: true }, { ok: true, minutes_used: 'two', credits_charged: 1, balance: 1 }, {
      ok: false,
      reason: 'weird',
    }]
  ) {
    const h = harness();
    h.rpcResult.factcheck_settle = { data, error: null };
    assertEquals((await handleFactcheck(stop(), h.deps)).status, 500);
  }
});

const stopLine = (lines: string[]) => JSON.parse(lines.find((l) => l.includes('"factcheck.stop"'))!);

Deno.test('stop logs a valid end_reason, and ignores an unknown or malformed one without a 400', async () => {
  for (
    const r of [
      'user_stop',
      'modal_close',
      'channel_change',
      'sharing_stopped',
      'time_up',
      'silence',
      'server',
      'error',
      'other',
    ]
  ) {
    const h = harness();
    const { result, lines } = await captureLogs(() => handleFactcheck(stop({ end_reason: r }), h.deps));
    assertEquals(result.status, 200);
    assertEquals(await result.json(), { minutes_used: 2, credits_charged: 1000, balance: 4000 });
    assertEquals(stopLine(lines).end_reason, r);
  }
  for (
    const r of ['USER_STOP', 'user stop', 'drop table', '', 7, null, true, ['user_stop'], { a: 1 }, 'x'.repeat(5000)]
  ) {
    const h = harness();
    const { result, lines } = await captureLogs(() => handleFactcheck(stop({ end_reason: r }), h.deps));
    assertEquals(result.status, 200, String(r));
    assertEquals(stopLine(lines).end_reason, null, String(r));
    assertEquals(h.rpcCalls.length, 1);
  }
  const none = harness();
  const { lines } = await captureLogs(() => handleFactcheck(stop(), none.deps));
  assertEquals(stopLine(lines).end_reason, null);
});

Deno.test('end_reason is only logged: the settlement call carries nothing but the user and session', async () => {
  const h = harness();
  await handleFactcheck(stop({ end_reason: 'time_up' }), h.deps);
  assertEquals(h.rpcCalls, [{ name: 'factcheck_settle', args: { p_user: USER, p_session: SESSION } }]);
});
