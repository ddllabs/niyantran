import { assertEquals } from 'jsr:@std/assert@1';
import { handleFactcheck } from './handler.ts';
import { harness, jsonRequest, SESSION, USER } from './testkit.ts';

const body = (o: Record<string, unknown> = {}) => ({
  action: 'start',
  video_id: 'RJfqzUWZ0Bw',
  channel_id: 'aaj-tak',
  video_kind: 'live',
  start_position_s: null,
  minutes: 10,
  ...o,
});

Deno.test('start passes validated values and the verified user to factcheck_start and returns the session', async () => {
  const h = harness();
  const res = await handleFactcheck(jsonRequest(body({ video_kind: 'recorded', start_position_s: 125.5 })), h.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    session_id: SESSION,
    credits_per_minute: 500,
    credits_held: 2500,
    ends_at: '2026-11-16T10:05:00Z',
  });
  assertEquals(h.rpcCalls, [{
    name: 'factcheck_start',
    args: {
      p_user: USER,
      p_video_id: 'RJfqzUWZ0Bw',
      p_channel_id: 'aaj-tak',
      p_video_kind: 'recorded',
      p_start_position_s: 125.5,
      p_minutes: 10,
      p_is_admin: true,
      p_expected_cpm: null,
    },
  }]);
  assertEquals(h.fetches.length, 0);
});

Deno.test('p_is_admin is computed on the server with the caller token, whatever the body says', async () => {
  for (const value of [true, false]) {
    const h = harness();
    h.admin.value = value;
    await handleFactcheck(jsonRequest(body({ is_admin: !value, p_is_admin: !value })), h.deps);
    assertEquals(h.rpcCalls[0].args.p_is_admin, value);
    assertEquals(h.admin.tokens, ['hdr.payload-SECRET-TOKEN.sig']);
    assertEquals(h.events.indexOf('isAdmin') < h.events.indexOf('rpc:factcheck_start'), true);
  }
});

Deno.test('an admin check that throws is a 503 and factcheck_start is not called', async () => {
  const h = harness({ isAdmin: () => Promise.reject(new Error('rpc down')) });
  assertEquals((await handleFactcheck(jsonRequest(body()), h.deps)).status, 503);
  assertEquals(h.rpcCalls, []);
});

Deno.test('each refusal reason maps to its status and body', async () => {
  const cases: [Record<string, unknown>, number, Record<string, unknown>][] = [
    [{ ok: false, reason: 'off' }, 403, { reason: 'off' }],
    [{ ok: false, reason: 'not_allowed' }, 403, { reason: 'not_allowed' }],
    [{ ok: false, reason: 'bad_minutes' }, 400, { reason: 'bad_minutes' }],
    [{ ok: false, reason: 'already_active', session_id: SESSION }, 409, {
      reason: 'already_active',
      session_id: SESSION,
    }],
    [{ ok: false, reason: 'price_changed', credits_per_minute: 600 }, 409, {
      reason: 'price_changed',
      credits_per_minute: 600,
    }],
    [{ ok: false, reason: 'insufficient', needed: 2500, available: 1200.5 }, 402, {
      reason: 'insufficient',
      needed: 2500,
      available: 1200.5,
    }],
  ];
  for (const [data, status, expected] of cases) {
    const h = harness();
    h.rpcResult.factcheck_start = { data, error: null };
    const res = await handleFactcheck(jsonRequest(body()), h.deps);
    assertEquals(res.status, status);
    const got = await res.json();
    for (const [k, v] of Object.entries(expected)) assertEquals(got[k], v);
  }
});

Deno.test('an unknown refusal or a malformed answer is a 500', async () => {
  for (const data of [{ ok: false, reason: 'surprise' }, null, 'x', { ok: true }]) {
    const h = harness();
    h.rpcResult.factcheck_start = { data, error: null };
    assertEquals((await handleFactcheck(jsonRequest(body()), h.deps)).status, 500);
  }
});

Deno.test('expected_credits_per_minute is passed through as p_expected_cpm, and absent means null', async () => {
  const h = harness();
  assertEquals((await handleFactcheck(jsonRequest(body({ expected_credits_per_minute: 500 })), h.deps)).status, 200);
  assertEquals(h.rpcCalls[0].args.p_expected_cpm, 500);
  const h2 = harness();
  await handleFactcheck(jsonRequest(body()), h2.deps);
  assertEquals(h2.rpcCalls[0].args.p_expected_cpm, null);
  const h3 = harness();
  await handleFactcheck(jsonRequest(body({ expected_credits_per_minute: null })), h3.deps);
  assertEquals(h3.rpcCalls[0].args.p_expected_cpm, null);
});

Deno.test('a bad expected_credits_per_minute is a 400', async () => {
  for (const v of ['500', 0, -1, 5001, [5], {}, true]) {
    const h = harness();
    assertEquals(
      (await handleFactcheck(jsonRequest(body({ expected_credits_per_minute: v })), h.deps)).status,
      400,
      String(v),
    );
    assertEquals(h.rpcCalls, []);
  }
});

Deno.test('an already_active answer without a session id is still a 409, and a price_changed without a price is a 500', async () => {
  const h = harness();
  h.rpcResult.factcheck_start = { data: { ok: false, reason: 'already_active' }, error: null };
  assertEquals((await handleFactcheck(jsonRequest(body()), h.deps)).status, 409);
  h.rpcResult.factcheck_start = { data: { ok: false, reason: 'price_changed' }, error: null };
  assertEquals((await handleFactcheck(jsonRequest(body()), h.deps)).status, 500);
});

Deno.test('invalid start input is a 400 and never reaches the database', async () => {
  const bad: Record<string, unknown>[] = [
    { video_id: '' },
    { video_id: 'x'.repeat(33) },
    { video_id: 'has space' },
    { video_id: 5 },
    { video_id: null },
    { channel_id: '' },
    { channel_id: 'c'.repeat(65) },
    { channel_id: ['a'] },
    { video_kind: 'both' },
    { video_kind: 'LIVE' },
    { video_kind: undefined },
    { start_position_s: '12' },
    { start_position_s: -1 },
    { start_position_s: 1e9 },
    { start_position_s: [3] },
    { minutes: 7 },
    { minutes: '5' },
    { minutes: 5.5 },
    { minutes: 0 },
    { minutes: undefined },
  ];
  for (const o of bad) {
    const h = harness();
    const res = await handleFactcheck(jsonRequest(body(o)), h.deps);
    assertEquals(res.status, 400, JSON.stringify(o));
    assertEquals(h.rpcCalls, [], JSON.stringify(o));
  }
});

Deno.test('start_position_s may be null or absent, and every block size is accepted', async () => {
  for (const minutes of [5, 10, 15]) {
    const h = harness();
    assertEquals((await handleFactcheck(jsonRequest(body({ minutes })), h.deps)).status, 200);
  }
  const h = harness();
  const { start_position_s: _omit, ...without } = body();
  assertEquals((await handleFactcheck(jsonRequest(without), h.deps)).status, 200);
  assertEquals(h.rpcCalls[0].args.p_start_position_s, null);
});
