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
  assertEquals(Object.keys(json).sort(), ['balance', 'charge_pending', 'claim', 'credits_charged']);
  assertEquals(Object.keys(json.claim).sort(), [
    'checked_at',
    'fail_reason',
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

/** A fetch fake that honours its abort signal, and aborts the request once the call starts. */
const abortingFetch = (h: Harness, controller: AbortController) => {
  const inner = h.deps.fetch;
  h.deps.fetch = (url, init) =>
    new Promise<Response>((resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      controller.abort();
      setTimeout(() => inner(url, init).then(resolve, reject), 5);
    });
};

Deno.test('a re-check finishes, saves and charges even when the client disconnects mid-call', async () => {
  const h = setup();
  const controller = new AbortController();
  abortingFetch(h, controller);
  const res = await handleFactcheck(new Request(req(), { signal: controller.signal }), h.deps);
  assertEquals(res.status, 200);
  assertEquals(newRow(h).status, 'checked');
  assertEquals(calls(h, 'factcheck_recheck_charge').length, 1);
  assertEquals(h.logRows.length, 1);
  assertEquals(h.logRows[0].status, 'success');
});

Deno.test('the re-check work is handed to waitUntil and the response waits for it', async () => {
  const h = setup();
  const jobs: Promise<unknown>[] = [];
  h.deps.waitUntil = (p) => void jobs.push(p);
  const res = await handleFactcheck(req(), h.deps);
  assertEquals(res.status, 200);
  assertEquals(jobs.length, 2, 'the model-call log and the re-check work');
  await Promise.all(jobs);
  assertEquals(calls(h, 'factcheck_recheck_charge').length, 1);
});

Deno.test('check keeps its abort behaviour: the provider call is tied to the request signal', async () => {
  const h = setup();
  const controller = new AbortController();
  abortingFetch(h, controller);
  const res = await handleFactcheck(
    new Request(jsonRequest({ action: 'check', session_id: SESSION, claim_id: NEW_CLAIM }), {
      signal: controller.signal,
    }),
    h.deps,
  );
  assertEquals(res.status, 502);
  assertEquals(h.logRows[0].status, 'aborted');
});

Deno.test('when the verdict update committed but its response failed, the row is re-read and the charge goes ahead', async () => {
  const h = setup();
  const inner = h.deps.store.finishCheck.bind(h.deps.store);
  h.deps.store.finishCheck = async (...a) => {
    await inner(...a);
    throw new Error('connection reset');
  };
  const res = await handleFactcheck(req(), h.deps);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals([json.claim.status, json.claim.verdict, json.credits_charged, json.charge_pending], [
    'checked',
    'supported',
    100,
    false,
  ]);
  assertEquals(calls(h, 'factcheck_recheck_charge').length, 1);
});

Deno.test('when the update really did not happen, the row is marked error and the failure is reported', async () => {
  const h = setup();
  const inner = h.deps.store.finishCheck.bind(h.deps.store);
  let first = true;
  h.deps.store.finishCheck = (...a) => {
    if (first) {
      first = false;
      return Promise.reject(new Error('down'));
    }
    return inner(...a);
  };
  assertEquals((await handleFactcheck(req(), h.deps)).status, 500);
  assertEquals(newRow(h).status, 'error');
  assertEquals(calls(h, 'factcheck_recheck_charge'), []);
});

Deno.test('a failure in the reads after begin marks the new row error instead of leaving it pending', async () => {
  const h = setup();
  h.deps.store.session = () => Promise.reject(new Error('down'));
  assertEquals((await handleFactcheck(req(), h.deps)).status, 500);
  assertEquals(newRow(h).status, 'error');
  assertEquals(h.fetches.length, 0);
});

Deno.test('too_many_failures is a 429 without Retry-After', async () => {
  const h = setup();
  h.rpcResult.factcheck_recheck_begin = { data: { ok: false, reason: 'too_many_failures' }, error: null };
  const res = await handleFactcheck(req(), h.deps);
  assertEquals(res.status, 429);
  assertEquals(res.headers.get('retry-after'), null);
  assertEquals((await res.json()).reason, 'too_many_failures');
  assertEquals(h.fetches.length, 0);
});

Deno.test('not_recheckable with newer_claim_id returns that result in a claim; without it there is no claim', async () => {
  const NEWER = '66666666-6666-4666-8666-666666666666';
  const h = setup();
  h.store.add({
    id: NEWER,
    status: 'checked',
    verdict: 'contradicted',
    reason: 'r',
    supersedes: OLD,
    checked_at: '2026-11-16T09:30:00.000Z',
    sources: [{ url: 'https://example.org/x', title: 'X' }],
  });
  h.rpcResult.factcheck_recheck_begin = {
    data: { ok: false, reason: 'not_recheckable', newer_claim_id: NEWER },
    error: null,
  };
  const res = await handleFactcheck(req(), h.deps);
  assertEquals(res.status, 409);
  const json = await res.json();
  assertEquals(json.reason, 'not_recheckable');
  assertEquals(json.claim, {
    id: NEWER,
    supersedes: OLD,
    status: 'checked',
    verdict: 'contradicted',
    reason: 'r',
    sources: [{ url: 'https://example.org/x', title: 'X' }],
    checked_at: '2026-11-16T09:30:00.000Z',
    fail_reason: null,
  });
  assertEquals(
    h.store.scopes.filter((s) => s.op === 'claimById').every((s) => s.userId === USER && s.claimId === NEWER),
    true,
  );
  for (
    const data of [{ ok: false, reason: 'not_recheckable' }, {
      ok: false,
      reason: 'not_recheckable',
      newer_claim_id: '44444444-4444-4444-8444-444444444444',
    }, { ok: false, reason: 'not_recheckable', newer_claim_id: 'junk' }]
  ) {
    const hh = setup();
    hh.rpcResult.factcheck_recheck_begin = { data, error: null };
    const r = await handleFactcheck(req(), hh.deps);
    assertEquals(r.status, 409);
    assertEquals('claim' in (await r.json()), false);
  }
});

Deno.test('charge_pending is false on success and on error, true only when a saved verdict could not be charged', async () => {
  const ok = await (await handleFactcheck(req(), setup().deps)).json();
  assertEquals([ok.credits_charged, ok.charge_pending], [100, false]);
  const e = setup();
  e.models.check = () => checkReply('Mostly true', 'x', { citations: ['https://example.org/a'] });
  const err = await (await handleFactcheck(req(), e.deps)).json();
  assertEquals([err.claim.status, err.credits_charged, err.balance, err.charge_pending], ['error', 0, null, false]);
  const p = setup();
  p.rpcResult.factcheck_recheck_charge = { data: null, error: { code: 'XX000' } };
  const pending = await (await handleFactcheck(req(), p.deps)).json();
  assertEquals([pending.claim.status, pending.credits_charged, pending.balance, pending.charge_pending], [
    'checked',
    null,
    null,
    true,
  ]);
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

Deno.test('a re-check that ends in error carries its own reason code, is free, and is logged as unusable', async () => {
  const cases: [string, () => unknown, string][] = [
    ['no_label', () => chatPayload('plain prose', { citations: ['https://example.org/a'] }), 'no_label'],
    ['bad_label', () => checkReply('Mostly true', 'x', { citations: ['https://example.org/a'] }), 'bad_label'],
    [
      'label_conflict',
      () => chatPayload('LABEL: Supported\nLABEL: Opinion', { citations: ['https://example.org/a'] }),
      'label_conflict',
    ],
    ['no_sources', () => checkReply('Supported', 'x', {}), 'no_sources'],
  ];
  for (const [why, model, code] of cases) {
    const h = setup();
    h.models.check = model;
    const { result, lines } = await captureLogs(() => handleFactcheck(req(), h.deps));
    const json = await result.json();
    assertEquals([json.claim.status, json.claim.fail_reason, json.credits_charged], ['error', code, 0], why);
    assertEquals(newRow(h).fail_reason, code, why);
    assertEquals(calls(h, 'factcheck_recheck_charge'), [], why);
    assertEquals([h.logRows[0].status, h.logRows[0].error_message], ['error', `unusable: ${code}`], why);
    assertEquals(h.logRows[0].purpose, 'claim_recheck');
    const line = JSON.parse(lines.find((l) => l.includes('"factcheck.recheck"'))!);
    assertEquals([line.status, line.fail_reason, line.citations], ['error', code, code === 'no_sources' ? 0 : 1], why);
  }
});

Deno.test('a checked re-check has fail_reason null, and a provider failure marks the row error with no reason', async () => {
  const h = setup();
  assertEquals((await (await handleFactcheck(req(), h.deps)).json()).claim.fail_reason, null);
  const f = setup();
  f.models.check = () => new Response('x', { status: 500 });
  assertEquals((await handleFactcheck(req(), f.deps)).status, 502);
  assertEquals([newRow(f).status, newRow(f).fail_reason ?? null], ['error', null]);
});
