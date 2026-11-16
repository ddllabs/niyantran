import { assertEquals, assertNotEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { handleFactcheck } from './handler.ts';
import { captureLogs, harness, jsonRequest, KEY, ORIGIN, SESSION, TOKEN, transcribeRequest, USER } from './testkit.ts';

const startBody = {
  action: 'start',
  video_id: 'RJfqzUWZ0Bw',
  channel_id: 'aaj-tak',
  video_kind: 'live',
  start_position_s: null,
  minutes: 5,
};
const stopBody = { action: 'stop', session_id: SESSION };
const extractBody = {
  action: 'extract',
  session_id: SESSION,
  turn: { text: 'hello there', spoken_at: '2026-11-16T10:00:00Z', position_s: null },
  recent: [],
  ledger: null,
  seed: { channel: 'Aaj Tak', title: 'News' },
};
const checkBody = { action: 'check', session_id: SESSION, claim_id: '33333333-3333-4333-8333-333333333333' };

// ---- the common gate ------------------------------------------------------------------------

Deno.test('a preflight is answered with CORS headers and does nothing else', async () => {
  const h = harness();
  const res = await handleFactcheck(
    new Request('http://localhost/factcheck', { method: 'OPTIONS', headers: { origin: ORIGIN } }),
    h.deps,
  );
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('access-control-allow-origin'), ORIGIN);
  assertEquals(h.events, []);
});

Deno.test('a foreign origin, a GET, a missing token and a bad token are refused before anything else happens', async () => {
  const cases: [Request, number][] = [
    [jsonRequest(stopBody, { origin: 'https://foreign.example' }), 403],
    [new Request('http://localhost/factcheck', { method: 'GET', headers: { origin: ORIGIN } }), 405],
    [jsonRequest(stopBody, { authorization: '' }), 401],
    [jsonRequest(stopBody, { authorization: 'Bearer not.a.token' }), 401],
  ];
  for (const [req, status] of cases) {
    const h = harness();
    const res = await handleFactcheck(req, h.deps);
    assertEquals(res.status, status);
    assertEquals(h.events.filter((e) => e !== 'verify'), [], `status ${status}: only the token check may have run`);
    assertEquals(res.headers.get('access-control-allow-origin') === ORIGIN || status === 403, true);
  }
});

Deno.test('the gate runs in order: verify, active account, then the action; nothing touches the database or a model before auth passes', async () => {
  const h = harness();
  const res = await handleFactcheck(jsonRequest(extractBody), h.deps);
  assertEquals(res.status, 200);
  assertEquals(h.events.slice(0, 3), ['verify', 'active', 'rpc:factcheck_touch']);
});

Deno.test('an inactive account stops after the account check: no touch, no model, no database write', async () => {
  for (const body of [startBody, stopBody, extractBody, checkBody]) {
    const h = harness({ active: () => Promise.resolve(false) });
    const res = await handleFactcheck(jsonRequest(body), h.deps);
    assertEquals(res.status, 403);
    assertEquals(h.events, ['verify']);
  }
  const h = harness({ active: () => Promise.resolve(false) });
  assertEquals((await handleFactcheck(transcribeRequest(), h.deps)).status, 403);
  assertEquals(h.events, ['verify']);
});

Deno.test('an account check that throws is a 503 and nothing else runs', async () => {
  const h = harness({ active: () => Promise.reject(new Error('profile down')) });
  const res = await handleFactcheck(jsonRequest(stopBody), h.deps);
  assertEquals(res.status, 503);
  assertEquals(h.rpcCalls, []);
});

Deno.test('an unknown or missing action is a 400, and a body that is not an object is a 400', async () => {
  for (const body of [{ action: 'nope' }, {}, { action: 7 }, [], 'null', '{bad json', { action: 'transcribe' }]) {
    const h = harness();
    const res = await handleFactcheck(jsonRequest(body), h.deps);
    assertEquals(res.status, 400, JSON.stringify(body));
    assertEquals(h.rpcCalls, []);
  }
});

Deno.test('a multipart body may only carry the transcribe action', async () => {
  const h = harness();
  const res = await handleFactcheck(transcribeRequest(undefined, { action: 'stop' }), h.deps);
  assertEquals(res.status, 400);
  assertEquals(h.rpcCalls, []);
});

Deno.test('an oversized JSON body is a 413 before it is parsed', async () => {
  const h = harness();
  const big = JSON.stringify({ ...extractBody, recent: ['x'.repeat(200_000)] });
  assertEquals((await handleFactcheck(jsonRequest(big), h.deps)).status, 413);
  const streamed = new Request('http://localhost/factcheck', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN, 'content-type': 'application/json' },
    body: new Uint8Array(200_000),
  });
  assertEquals((await handleFactcheck(streamed, h.deps)).status, 413);
  assertEquals(h.rpcCalls, []);
});

Deno.test('every response, including errors, is JSON with the CORS headers', async () => {
  const h = harness();
  for (
    const req of [jsonRequest(stopBody), jsonRequest({ action: 'x' }), jsonRequest(stopBody, { authorization: '' })]
  ) {
    const res = await handleFactcheck(req, h.deps);
    assertStringIncludes(res.headers.get('content-type') ?? '', 'application/json');
    assertEquals(res.headers.get('access-control-allow-origin'), ORIGIN);
    await res.json();
  }
});

// ---- error mapping ---------------------------------------------------------------------------

Deno.test('SQLSTATE 22023 is a 400, 55000 a 503 and 23503 a 404 with reason not_found, on every SQL-backed action', async () => {
  const map: [string, number][] = [['22023', 400], ['55000', 503], ['23503', 404]];
  const cases: [string, () => Request][] = [
    ['factcheck_start', () => jsonRequest(startBody)],
    ['factcheck_settle', () => jsonRequest(stopBody)],
    ['factcheck_touch', () => jsonRequest(extractBody)],
    ['factcheck_touch', () => transcribeRequest()],
  ];
  for (const [fn, make] of cases) {
    for (const [code, status] of map) {
      const h = harness();
      h.rpcResult[fn] = { data: null, error: { code, message: 'secret row content' } };
      const res = await handleFactcheck(make(), h.deps);
      assertEquals(res.status, status, `${fn} ${code}`);
      const text = await res.text();
      assertEquals(text.includes('secret row content'), false);
      if (code === '23503') assertEquals(JSON.parse(text).reason, 'not_found');
      assertEquals(h.fetches.length, 0);
    }
  }
});

Deno.test('any other SQL error is a 500 with no detail', async () => {
  const h = harness();
  h.rpcResult.factcheck_settle = { data: null, error: { code: 'XX000', message: 'boom with details' } };
  const res = await handleFactcheck(jsonRequest(stopBody), h.deps);
  assertEquals(res.status, 500);
  assertEquals((await res.text()).includes('boom'), false);
});

Deno.test('touch refusals: not_found is 404, settled and ended are 409, off (flag switched off mid-session) is 403, budget is 429, each with the reason, and no model is called', async () => {
  const cases: [string, number][] = [['not_found', 404], ['settled', 409], ['ended', 409], ['off', 403], [
    'budget',
    429,
  ]];
  for (const [reason, status] of cases) {
    for (const make of [() => jsonRequest(extractBody), () => jsonRequest(checkBody), () => transcribeRequest()]) {
      const h = harness();
      h.rpcResult.factcheck_touch = { data: { ok: false, reason }, error: null };
      const res = await handleFactcheck(make(), h.deps);
      assertEquals(res.status, status, reason);
      assertEquals((await res.json()).reason, reason);
      assertEquals(h.fetches.length, 0, 'no model call when touch refuses');
      assertEquals(h.logRows.length, 0);
      assertEquals(h.store.ops.filter((o) => o !== 'session'), [], 'no table access when touch refuses');
    }
  }
});

Deno.test('budget is a 429 WITHOUT Retry-After, because the browser must not retry it; rate_limited keeps it', async () => {
  const h = harness();
  h.rpcResult.factcheck_touch = { data: { ok: false, reason: 'budget' }, error: null };
  const res = await handleFactcheck(jsonRequest(extractBody), h.deps);
  assertEquals(res.status, 429);
  assertEquals(res.headers.get('retry-after'), null);
  assertEquals((await res.json()).reason, 'budget');
  assertEquals(h.fetches.length, 0);
});

Deno.test('rate_limited is a 429 with Retry-After equal to the seconds left in the current calendar minute', async () => {
  // NOW is 10:00:20, so 40 seconds remain.
  const h = harness();
  h.rpcResult.factcheck_touch = { data: { ok: false, reason: 'rate_limited' }, error: null };
  const res = await handleFactcheck(jsonRequest(extractBody), h.deps);
  assertEquals(res.status, 429);
  assertEquals(res.headers.get('retry-after'), '40');
  assertEquals((await res.json()).reason, 'rate_limited');
  assertEquals(h.fetches.length, 0);
  const at = (iso: string) => harness({ now: () => Date.parse(iso) });
  for (
    const [iso, left] of [['2026-11-16T10:00:00.000Z', '60'], ['2026-11-16T10:00:59.900Z', '1'], [
      '2026-11-16T10:00:59.000Z',
      '1',
    ]]
  ) {
    const h2 = at(iso);
    h2.rpcResult.factcheck_touch = { data: { ok: false, reason: 'rate_limited' }, error: null };
    assertEquals((await handleFactcheck(jsonRequest(extractBody), h2.deps)).headers.get('retry-after'), left, iso);
  }
});

Deno.test('a touch answer of an unknown shape is a 500 and calls no model', async () => {
  for (const data of [null, 'ok', { ok: false, reason: 'surprise' }, { ok: false }]) {
    const h = harness();
    h.rpcResult.factcheck_touch = { data, error: null };
    assertEquals((await handleFactcheck(jsonRequest(extractBody), h.deps)).status, 500);
    assertEquals(h.fetches.length, 0);
  }
});

Deno.test('a missing OPENROUTER_API_KEY is a 503 on the model actions, before touch, and start and stop do not need it', async () => {
  for (const make of [() => jsonRequest(extractBody), () => jsonRequest(checkBody), () => transcribeRequest()]) {
    const h = harness({ apiKey: '' });
    h.store.add({ id: checkBody.claim_id });
    const res = await handleFactcheck(make(), h.deps);
    assertEquals(res.status, 503);
    assertEquals(h.rpcCalls.filter((c) => c.name === 'factcheck_touch'), []);
  }
  const h = harness({ apiKey: '' });
  assertEquals((await handleFactcheck(jsonRequest(startBody), h.deps)).status, 200);
  assertEquals((await handleFactcheck(jsonRequest(stopBody), h.deps)).status, 200);
});

// ---- identity -------------------------------------------------------------------------------

Deno.test('identity comes only from the verified token: user_id and is_admin in a body are ignored', async () => {
  const h = harness();
  h.admin.value = false;
  const body = {
    ...startBody,
    user_id: '99999999-9999-4999-8999-999999999999',
    is_admin: true,
    p_is_admin: true,
    p_user: 'x',
  };
  assertEquals((await handleFactcheck(jsonRequest(body), h.deps)).status, 200);
  const call = h.rpcCalls.find((c) => c.name === 'factcheck_start')!;
  assertEquals(call.args.p_user, USER);
  assertEquals(call.args.p_is_admin, false);
  for (const b of [{ ...stopBody, user_id: 'someone-else' }, { ...extractBody, user_id: 'someone-else' }]) {
    const hh = harness();
    await handleFactcheck(jsonRequest(b), hh.deps);
    for (const c of hh.rpcCalls) assertEquals(c.args.p_user, USER);
  }
});

// ---- logs ------------------------------------------------------------------------------------

Deno.test('no log line holds the token, the key, audio bytes or any transcript text, on success or failure paths', async () => {
  const secretText = 'TRANSCRIPT-SECRET-वाक्य';
  const audio = new Uint8Array(wavBytes());
  const runs: Request[] = [
    transcribeRequest(audio),
    jsonRequest({ ...extractBody, turn: { ...extractBody.turn, text: secretText } }),
    jsonRequest(checkBody),
    jsonRequest(startBody),
    jsonRequest(stopBody),
    jsonRequest({ ...extractBody, turn: { text: '' } }),
  ];
  const { lines } = await captureLogs(async () => {
    for (const req of runs) {
      const h = harness({ logModelCall: () => Promise.reject(new Error('db down')) });
      h.store.add({ id: checkBody.claim_id, claim_en: secretText });
      h.models.transcribe = () => ({ text: secretText });
      h.models.extract = () => {
        throw new Error(`leak ${secretText} ${KEY} ${TOKEN}`);
      };
      await (await handleFactcheck(req, h.deps)).text();
    }
  });
  const all = lines.join('\n');
  assertNotEquals(lines.length, 0, 'the run logs something');
  for (const forbidden of [TOKEN, 'payload-SECRET', KEY, secretText, 'TRANSCRIPT-SECRET']) {
    assertEquals(all.includes(forbidden), false, forbidden);
  }
  assertEquals(all.includes('RIFF'), false);
});

function wavBytes() {
  const b = new Uint8Array(1000);
  b.set([0x52, 0x49, 0x46, 0x46]);
  return b;
}
