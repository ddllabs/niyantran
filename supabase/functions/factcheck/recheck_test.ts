import { assertEquals } from 'jsr:@std/assert@1';
import { handleFactcheck } from './handler.ts';
import {
  captureLogs,
  chatPayload,
  checkReply,
  type Harness,
  harness,
  jsonRequest,
  KEY,
  NEW_CLAIM,
  SESSION,
  TOKEN,
  USER,
} from './testkit.ts';

const OLD = '33333333-3333-4333-8333-333333333333';
const req = (o: Record<string, unknown> = {}) =>
  jsonRequest({ action: 'recheck', claim_id: OLD, expected_recheck_credits: 100, ...o });
/** A harness holding the claim being re-checked and the pending row that `begin` created. */
const setup = (): Harness => {
  const h = harness();
  h.store.add({
    id: OLD,
    claim_en: 'Crime in India fell by 20 percent in 2025.',
    claimant: 'Amit Shah',
    status: 'checked',
    verdict: 'supported',
  });
  h.store.add({
    id: NEW_CLAIM,
    claim_en: 'Crime in India fell by 20 percent in 2025.',
    claimant: 'Amit Shah',
    status: 'pending',
    supersedes: OLD,
  });
  return h;
};
const calls = (h: Harness, name: string) => h.rpcCalls.filter((c) => c.name === name);
const newRow = (h: Harness) => h.store.rows.find((r) => r.id === NEW_CLAIM)!;

Deno.test('recheck: begin, one model call, the verdict saved on the new row, then one charge; the answer carries both', async () => {
  const h = setup();
  const res = await handleFactcheck(req(), h.deps);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(Object.keys(json).sort(), ['balance', 'claim', 'credits_charged']);
  assertEquals(Object.keys(json.claim).sort(), [
    'checked_at',
    'id',
    'reason',
    'sources',
    'status',
    'supersedes',
    'verdict',
  ]);
  assertEquals([json.claim.id, json.claim.supersedes, json.claim.status, json.claim.verdict], [
    NEW_CLAIM,
    OLD,
    'checked',
    'supported',
  ]);
  assertEquals([json.credits_charged, json.balance], [100, 3900]);
  assertEquals(calls(h, 'factcheck_recheck_begin'), [{
    name: 'factcheck_recheck_begin',
    args: { p_user: USER, p_claim: OLD, p_is_admin: true, p_expected_credits: 100 },
  }]);
  assertEquals(calls(h, 'factcheck_recheck_charge'), [{
    name: 'factcheck_recheck_charge',
    args: { p_user: USER, p_claim: NEW_CLAIM },
  }]);
  assertEquals(h.rpcCalls.some((c) => c.name === 'factcheck_touch'), false, 'a re-check is not part of a session');
  assertEquals(h.fetches.length, 1);
  assertEquals(newRow(h).status, 'checked');
  assertEquals(h.store.rows.find((r) => r.id === OLD)!.verdict, 'supported', 'the earlier result is untouched');
});

Deno.test('the order is gate, admin check, begin, model call, save, charge', async () => {
  const h = setup();
  await handleFactcheck(req(), h.deps);
  const e = h.events;
  const at = (x: string) => e.indexOf(x);
  assertEquals(e.slice(0, 2), ['verify', 'active']);
  assertEquals(at('isAdmin') < at('rpc:factcheck_recheck_begin'), true);
  assertEquals(at('rpc:factcheck_recheck_begin') < at('fetch:chat:perplexity/sonar'), true);
  assertEquals(at('fetch:chat:perplexity/sonar') < at('store:finishCheck'), true);
  assertEquals(at('store:finishCheck') < at('rpc:factcheck_recheck_charge'), true);
});

Deno.test('p_is_admin is computed with the caller token, whatever the body says', async () => {
  const h = setup();
  h.admin.value = false;
  await handleFactcheck(req({ is_admin: true, p_is_admin: true, user_id: 'x' }), h.deps);
  assertEquals(calls(h, 'factcheck_recheck_begin')[0].args.p_is_admin, false);
  assertEquals(calls(h, 'factcheck_recheck_begin')[0].args.p_user, USER);
  assertEquals(h.admin.tokens, [TOKEN]);
  const bad = setup();
  bad.deps.isAdmin = () => Promise.reject(new Error('down'));
  assertEquals((await handleFactcheck(req(), bad.deps)).status, 503);
  assertEquals(calls(bad, 'factcheck_recheck_begin'), []);
});

Deno.test('the gate comes first: a bad origin, no token and an inactive account reach nothing', async () => {
  for (
    const [r, status] of [
      [req(), 403],
      [jsonRequest({ action: 'recheck', claim_id: OLD, expected_recheck_credits: 100 }, { authorization: '' }), 401],
    ] as [Request, number][]
  ) {
    const h = setup();
    if (status === 403) h.deps.active = () => Promise.resolve(false);
    assertEquals((await handleFactcheck(r, h.deps)).status, status);
    assertEquals(h.rpcCalls, []);
    assertEquals(h.fetches.length, 0);
  }
  const foreign = setup();
  assertEquals((await handleFactcheck(req({}), { ...foreign.deps, origins: ['https://other.example'] })).status, 403);
  assertEquals(foreign.rpcCalls, []);
});

Deno.test('invalid input is a 400 and reaches neither the database nor a model', async () => {
  const bad: Record<string, unknown>[] = [
    { claim_id: 'x' },
    { claim_id: undefined },
    { claim_id: 5 },
    { expected_recheck_credits: undefined },
    { expected_recheck_credits: null },
    { expected_recheck_credits: '100' },
    { expected_recheck_credits: 0 },
    { expected_recheck_credits: -5 },
    { expected_recheck_credits: 1001 },
    { expected_recheck_credits: [100] },
    { expected_recheck_credits: true },
  ];
  for (const o of bad) {
    const h = setup();
    assertEquals((await handleFactcheck(req(o), h.deps)).status, 400, JSON.stringify(o));
    assertEquals(h.rpcCalls, []);
    assertEquals(h.fetches.length, 0);
  }
  const h = setup();
  assertEquals((await handleFactcheck(req({ expected_recheck_credits: 1000 }), h.deps)).status, 200);
});

Deno.test('every refusal from begin maps to its status and body, and no model call or charge follows', async () => {
  const cases: [Record<string, unknown>, number, Record<string, unknown>, string | null][] = [
    [{ ok: false, reason: 'off' }, 403, { reason: 'off' }, null],
    [{ ok: false, reason: 'not_allowed' }, 403, { reason: 'not_allowed' }, null],
    [{ ok: false, reason: 'not_found' }, 404, { reason: 'claim_not_found' }, null],
    [{ ok: false, reason: 'not_recheckable' }, 409, { reason: 'not_recheckable' }, null],
    [{ ok: false, reason: 'price_changed', recheck_credits: 150 }, 409, {
      reason: 'price_changed',
      recheck_credits: 150,
    }, null],
    [{ ok: false, reason: 'insufficient', needed: 100, available: 20.5 }, 402, {
      reason: 'insufficient',
      needed: 100,
      available: 20.5,
    }, null],
    [{ ok: false, reason: 'rate_limited' }, 429, { reason: 'rate_limited' }, '40'],
    [{ ok: false, reason: 'in_progress' }, 429, { reason: 'in_progress' }, '3'],
  ];
  for (const [data, status, expected, retry] of cases) {
    const h = setup();
    h.rpcResult.factcheck_recheck_begin = { data, error: null };
    const res = await handleFactcheck(req(), h.deps);
    assertEquals(res.status, status, String(data.reason));
    const got = await res.json();
    for (const [k, v] of Object.entries(expected)) assertEquals(got[k], v);
    assertEquals(res.headers.get('retry-after'), retry, String(data.reason));
    assertEquals(h.fetches.length, 0);
    assertEquals(h.logRows.length, 0);
    assertEquals(calls(h, 'factcheck_recheck_charge'), []);
  }
});

Deno.test('not_recheckable may carry the price; price_changed without a price, and unknown answers, are a 500', async () => {
  const h = setup();
  h.rpcResult.factcheck_recheck_begin = {
    data: { ok: false, reason: 'not_recheckable', recheck_credits: 100 },
    error: null,
  };
  const res = await handleFactcheck(req(), h.deps);
  assertEquals([res.status, (await res.json()).recheck_credits], [409, 100]);
  for (
    const data of [{ ok: false, reason: 'price_changed' }, { ok: false, reason: 'surprise' }, null, 'x', { ok: true }]
  ) {
    const hh = setup();
    hh.rpcResult.factcheck_recheck_begin = { data, error: null };
    assertEquals((await handleFactcheck(req(), hh.deps)).status, 500);
    assertEquals(hh.fetches.length, 0);
  }
});

Deno.test('SQLSTATE 22023 is 400, 55000 is 503, 23503 is 404 on begin and nothing else runs', async () => {
  for (const [code, status] of [['22023', 400], ['55000', 503], ['23503', 404]] as [string, number][]) {
    const h = setup();
    h.rpcResult.factcheck_recheck_begin = { data: null, error: { code, message: 'secret row content' } };
    const res = await handleFactcheck(req(), h.deps);
    assertEquals(res.status, status);
    assertEquals((await res.text()).includes('secret'), false);
    assertEquals(h.fetches.length, 0);
  }
});

Deno.test('a missing OPENROUTER_API_KEY is a 503 before begin, so no row is created and nothing is charged', async () => {
  const h = setup();
  h.deps.apiKey = '';
  assertEquals((await handleFactcheck(req(), h.deps)).status, 503);
  assertEquals(calls(h, 'factcheck_recheck_begin'), []);
});

Deno.test('the model is given the stored claim text of the new row; a body field with other text is ignored', async () => {
  const h = setup();
  await handleFactcheck(req({ claim_en: 'Sneaky text', text: 'sneaky', claim: 'sneaky', session_id: 'x' }), h.deps);
  const user = (h.fetches[0].body as { messages: { content: string }[] }).messages[1].content;
  assertEquals(user.includes('Crime in India fell by 20 percent in 2025.'), true);
  assertEquals(user.includes('sneaky') || user.includes('Sneaky'), false);
  assertEquals(
    h.store.scopes.filter((s) => s.op === 'claimById').every((s) => s.userId === USER && s.claimId === NEW_CLAIM),
    true,
  );
});

Deno.test("the row begin returned must exist and be the caller's; otherwise nothing is called", async () => {
  const h = setup();
  h.store.rows = h.store.rows.filter((r) => r.id !== NEW_CLAIM);
  assertEquals((await handleFactcheck(req(), h.deps)).status, 500);
  assertEquals(h.fetches.length, 0);
  assertEquals(calls(h, 'factcheck_recheck_charge'), []);
  const other = setup();
  other.store.rows.find((r) => r.id === NEW_CLAIM)!.user_id = '88888888-8888-4888-8888-888888888888';
  assertEquals((await handleFactcheck(req(), other.deps)).status, 500);
  assertEquals(other.fetches.length, 0);
});

Deno.test('the charge is made only after a saved checked verdict: not for a provider failure, an unusable reply or a sourceless label', async () => {
  const noSource = (label: string) => () => checkReply(label, 'ok', {});
  const cases: [string, () => unknown, number, string][] = [
    ['http 500', () => new Response('provider-secret', { status: 500 }), 502, 'error'],
    ['not json', () => new Response('<html>'), 502, 'error'],
    ['prose', () => chatPayload('no format', { citations: ['https://example.org/a'] }), 200, 'error'],
    ['out-of-enum label', () => checkReply('Mostly true', 'x', { citations: ['https://example.org/a'] }), 200, 'error'],
    ['supported without a source', noSource('Supported'), 200, 'error'],
  ];
  for (const [why, model, status, saved] of cases) {
    const h = setup();
    h.models.check = model;
    const res = await handleFactcheck(req(), h.deps);
    assertEquals(res.status, status, why);
    assertEquals(calls(h, 'factcheck_recheck_charge'), [], why);
    assertEquals(newRow(h).status, saved, `${why}: the new row is not left pending`);
    assertEquals(newRow(h).verdict, null);
    if (status === 200) {
      const json = await res.json();
      assertEquals([json.claim.status, json.claim.verdict, json.credits_charged], ['error', null, 0], why);
    } else assertEquals((await res.text()).includes('provider-secret'), false);
    assertEquals(h.logRows.length, 1, `${why}: the call is still logged`);
  }
});

Deno.test('No evidence found without a source is a saved verdict and is charged', async () => {
  const h = setup();
  h.models.check = () => checkReply('No evidence found', 'Nothing found.', {});
  const json = await (await handleFactcheck(req(), h.deps)).json();
  assertEquals([json.claim.status, json.claim.verdict, json.credits_charged], ['checked', 'no_evidence', 100]);
  assertEquals(calls(h, 'factcheck_recheck_charge').length, 1);
});

Deno.test('a client that disconnects mid-call leaves the new row as error, not pending, and charges nothing', async () => {
  const h = setup();
  const controller = new AbortController();
  h.deps.fetch = (_u, init) =>
    new Promise<Response>((_r, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      controller.abort();
    });
  await handleFactcheck(new Request(req(), { signal: controller.signal }), h.deps);
  assertEquals(newRow(h).status, 'error');
  assertEquals(calls(h, 'factcheck_recheck_charge'), []);
  assertEquals(h.logRows[0].status, 'aborted');
});

Deno.test('a failing charge after a saved verdict still returns the verdict, with credits_charged null, and logs the failure', async () => {
  for (
    const result of [
      { data: null, error: { code: 'XX000', message: 'secret details' } },
      { data: { ok: false, reason: 'not_found' }, error: null },
      { data: { ok: true, credits_charged: 'x' }, error: null },
    ]
  ) {
    const h = setup();
    h.rpcResult.factcheck_recheck_charge = result;
    const { result: res, lines } = await captureLogs(() => handleFactcheck(req(), h.deps));
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals([json.claim.status, json.claim.verdict, json.credits_charged, json.balance], [
      'checked',
      'supported',
      null,
      null,
    ]);
    assertEquals(lines.some((l) => l.includes('factcheck.recheck_charge_failed') && l.includes(NEW_CLAIM)), true);
    assertEquals(lines.join('\n').includes('secret details'), false);
  }
  const h = setup();
  const inner = h.deps.rpc;
  h.deps.rpc = (name, args) =>
    name === 'factcheck_recheck_charge' ? Promise.reject(new Error('net')) : inner(name, args);
  const res = await handleFactcheck(req(), h.deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).credits_charged, null);
});

Deno.test('a repeated charge (repeated: true) is returned as it is', async () => {
  const h = setup();
  h.rpcResult.factcheck_recheck_charge = {
    data: { ok: true, repeated: true, credits_charged: 100, balance: 3900 },
    error: null,
  };
  const json = await (await handleFactcheck(req(), h.deps)).json();
  assertEquals([json.credits_charged, json.balance], [100, 3900]);
});

Deno.test('one model_call_logs row, purpose claim_recheck, with the session in raw_usage and no claim text, token or key in any log', async () => {
  const h = setup();
  const { lines } = await captureLogs(() => handleFactcheck(req(), h.deps));
  assertEquals(h.logRows.length, 1);
  const row = h.logRows[0];
  assertEquals([row.caller, row.purpose, row.model_requested, row.message_id, row.user_id], [
    'factcheck',
    'claim_recheck',
    'perplexity/sonar',
    null,
    USER,
  ]);
  assertEquals((row.raw_usage as { session_id: string }).session_id, SESSION);
  const all = lines.join('\n') + JSON.stringify(h.logRows);
  for (const forbidden of ['Crime in India', TOKEN, 'payload-SECRET', KEY]) {
    assertEquals(all.includes(forbidden), false, forbidden);
  }
  const failing = setup();
  failing.deps.logModelCall = () => Promise.reject(new Error('db down'));
  assertEquals((await handleFactcheck(req(), failing.deps)).status, 200);
});

Deno.test('re-checking an error row works the same way', async () => {
  const h = setup();
  h.store.rows.find((r) => r.id === OLD)!.status = 'error';
  assertEquals((await handleFactcheck(req(), h.deps)).status, 200);
});
