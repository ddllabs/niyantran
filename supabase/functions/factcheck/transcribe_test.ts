import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { handleFactcheck } from './handler.ts';
import { harness, KEY, ORIGIN, SESSION, TOKEN, tone, transcribeRequest, USER, wav } from './testkit.ts';

Deno.test('a valid piece is touched first, sent to the fixed OpenRouter endpoint with the model constant, and its text returned', async () => {
  const h = harness();
  const res = await handleFactcheck(transcribeRequest(wav({ seconds: 8 }), { seq: '12' }), h.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { seq: 12, text: 'नमस्ते दर्शकों', seconds_left: 240 });
  assertEquals(h.rpcCalls, [{
    name: 'factcheck_touch',
    args: { p_user: USER, p_session: SESSION, p_action: 'transcribe' },
  }]);
  assertEquals(h.events.indexOf('rpc:factcheck_touch') < h.events.indexOf('fetch:transcribe'), true);
  assertEquals(h.fetches.length, 1);
  assertEquals(h.fetches[0].url, 'https://openrouter.ai/api/v1/audio/transcriptions');
  assertEquals(h.fetches[0].model, 'elevenlabs/scribe-v2');
  const form = h.fetches[0].body as FormData;
  assertEquals(form.get('response_format'), 'json');
  assertEquals((form.get('file') as File).size, 44 + 8 * 16000 * 2);
});

Deno.test('the provider call carries the server key, aborts with the caller, and has a timeout', async () => {
  const h = harness();
  let seen: RequestInit | null = null;
  const inner = h.deps.fetch;
  h.deps.fetch = (url, init) => {
    seen = init;
    return inner(url, init);
  };
  const controller = new AbortController();
  const base = transcribeRequest();
  const req = new Request(base, { signal: controller.signal });
  await handleFactcheck(req, h.deps);
  assertEquals((seen!.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  assertEquals(seen!.signal!.aborted, false);
  controller.abort();
  assertEquals(seen!.signal!.aborted, true);
});

Deno.test('a silent piece is not sent to the provider, returns empty text, still counts as activity and writes no model row', async () => {
  const h = harness();
  const res = await handleFactcheck(transcribeRequest(wav({ samples: new Int16Array(32000) })), h.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { seq: 3, text: '', seconds_left: 240 });
  assertEquals(h.fetches.length, 0);
  assertEquals(h.logRows.length, 0);
  assertEquals(h.rpcCalls.length, 1);
  assertEquals(h.rpcCalls[0].args.p_action, 'transcribe');
});

Deno.test('every touch refusal on transcribe is answered before any provider call', async () => {
  const h = harness();
  h.rpcResult.factcheck_touch = { data: { ok: false, reason: 'settled' }, error: null };
  const res = await handleFactcheck(transcribeRequest(), h.deps);
  assertEquals(res.status, 409);
  assertEquals(h.fetches.length, 0);
});

Deno.test('input that is not a WAV the server can parse is a 400 with no touch and no provider call', async () => {
  const bad: [string, Uint8Array][] = [
    ['wrong magic', wav({ magic: 'RIFX' })],
    ['wrong rate', wav({ rate: 44100 })],
    ['stereo', wav({ channels: 2 })],
    ['8-bit', wav({ bits: 8 })],
    ['truncated header', wav().slice(0, 30)],
    ['over 15 s', wav({ seconds: 16 })],
    ['over 600 kB', new Uint8Array(600_001)],
    ['header lies about the data size', wav({ dataSize: 5_000_000 })],
    ['text', new TextEncoder().encode('hello, I am not audio, hello hello hello hello hello')],
  ];
  for (const [why, file] of bad) {
    const h = harness();
    const res = await handleFactcheck(transcribeRequest(file), h.deps);
    assertEquals(res.status, 400, why);
    assertEquals(h.rpcCalls, [], why);
    assertEquals(h.fetches.length, 0, why);
  }
});

Deno.test('the content type does not matter: only the parsed header does', async () => {
  const h = harness();
  const form = new FormData();
  form.append('action', 'transcribe');
  form.append('session_id', SESSION);
  form.append('seq', '1');
  form.append('file', new Blob([wav() as BlobPart], { type: 'text/plain' }), 'piece.txt');
  const req = new Request('http://localhost/factcheck', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
    body: form,
  });
  assertEquals((await handleFactcheck(req, h.deps)).status, 200);
});

Deno.test('a missing file, a file field that is text, a bad seq or a bad session id is a 400', async () => {
  const cases: [Request, string][] = [
    [transcribeRequest(null), 'no file'],
    [transcribeRequest(wav(), { file: 'just text' }), 'file is a string'],
    [transcribeRequest(wav(), { seq: '-1' }), 'negative seq'],
    [transcribeRequest(wav(), { seq: '1.5' }), 'fractional seq'],
    [transcribeRequest(wav(), { seq: 'abc' }), 'non-numeric seq'],
    [transcribeRequest(wav(), { seq: '' }), 'empty seq'],
    [transcribeRequest(wav(), { seq: '99999999999' }), 'huge seq'],
    [transcribeRequest(wav(), { session_id: 'nope' }), 'bad session'],
  ];
  for (const [req, why] of cases) {
    const h = harness();
    assertEquals((await handleFactcheck(req, h.deps)).status, 400, why);
    assertEquals(h.rpcCalls, [], why);
  }
});

Deno.test('an oversized multipart body is a 413 whether declared or streamed', async () => {
  const h = harness();
  const declared = new Request('http://localhost/factcheck', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      origin: ORIGIN,
      'content-type': 'multipart/form-data; boundary=a',
      'content-length': '5000000',
    },
    body: 'x',
  });
  assertEquals((await handleFactcheck(declared, h.deps)).status, 413);
  const streamed = new Request('http://localhost/factcheck', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN, 'content-type': 'multipart/form-data; boundary=a' },
    body: new Uint8Array(700_000),
  });
  assertEquals((await handleFactcheck(streamed, h.deps)).status, 413);
  assertEquals(h.rpcCalls, []);
});

Deno.test('a provider failure is a 502 with no provider text, and still logs one error row', async () => {
  for (
    const reply of [
      new Response('provider-secret', { status: 500 }),
      new Response('not json'),
      new Response(JSON.stringify({ nothing: 1 })),
      new Response(JSON.stringify({ text: 7 })),
    ]
  ) {
    const h = harness();
    h.models.transcribe = () => reply;
    const res = await handleFactcheck(transcribeRequest(), h.deps);
    assertEquals(res.status, 502);
    assertEquals((await res.text()).includes('provider-secret'), false);
    assertEquals(h.logRows.length, 1);
    assertEquals(h.logRows[0].status, 'error');
    assertEquals(String(h.logRows[0].error_message).includes('provider-secret'), false);
  }
  const h = harness({ fetch: () => Promise.reject(new Error('provider-secret')) });
  assertEquals((await handleFactcheck(transcribeRequest(), h.deps)).status, 502);
  assertEquals(h.logRows.length, 1);
});

Deno.test('a success writes one row: caller factcheck, purpose transcription, null message and conversation, the reported cost', async () => {
  const h = harness();
  h.models.transcribe = () => ({ text: 'hi', usage: { cost: 0.000508, seconds: 9.2 }, id: 'gen-1' });
  await handleFactcheck(transcribeRequest(), h.deps);
  assertEquals(h.logRows.length, 1);
  const row = h.logRows[0];
  assertEquals([row.caller, row.purpose, row.message_id, row.conversation_id, row.user_id], [
    'factcheck',
    'transcription',
    null,
    null,
    USER,
  ]);
  assertEquals([row.model_requested, row.status, row.cost_usd, row.error_message], [
    'elevenlabs/scribe-v2',
    'success',
    0.000508,
    null,
  ]);
  assertEquals(row.openrouter_generation_id, 'gen-1');
  assertEquals(row.raw_usage, { session_id: SESSION, seconds: 9.2, cost: 0.000508, cost_source: 'provider' });
});

Deno.test('a missing cost is never estimated', async () => {
  const h = harness();
  h.models.transcribe = () => ({ text: 'hi' });
  await handleFactcheck(transcribeRequest(), h.deps);
  assertEquals(h.logRows[0].cost_usd, null);
});

Deno.test('a failing log write changes neither the success nor the error response', async () => {
  const logModelCall = () => Promise.reject(new Error('db down'));
  const ok = await handleFactcheck(transcribeRequest(), harness({ logModelCall }).deps);
  assertEquals(ok.status, 200);
  const h = harness({ logModelCall });
  h.models.transcribe = () => new Response('', { status: 500 });
  assertEquals((await handleFactcheck(transcribeRequest(), h.deps)).status, 502);
});

Deno.test('a log write that hangs cannot delay the response past the bound', async () => {
  const started = performance.now();
  const res = await handleFactcheck(
    transcribeRequest(),
    harness({ logModelCall: () => new Promise<void>(() => {}), telemetryTimeoutMs: 40 }).deps,
  );
  assertEquals(res.status, 200);
  assertEquals(performance.now() - started < 1000, true);
});

Deno.test('with waitUntil the response does not wait on the log insert, which completes in the background', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const jobs: Promise<unknown>[] = [];
  const h = harness({
    logModelCall: async () => await gate,
    telemetryTimeoutMs: 5_000,
    waitUntil: (p) => void jobs.push(p),
  });
  const res = await handleFactcheck(transcribeRequest(), h.deps);
  assertEquals(res.status, 200);
  assertEquals(jobs.length, 1);
  release();
  await jobs[0];
});

Deno.test('the audio is never written anywhere: not to a table, a log row or the response', async () => {
  const h = harness();
  const loud = wav({ samples: tone(16000, 20000) });
  const res = await handleFactcheck(transcribeRequest(loud), h.deps);
  assertEquals(h.store.ops, []);
  assertEquals(JSON.stringify(h.logRows).includes('RIFF'), false);
  assertEquals((await res.text()).includes('RIFF'), false);
  assertStringIncludes(String(h.rpcCalls.length), '1');
});

Deno.test('seconds_left is reduced by the time spent since the touch', async () => {
  let t = 1_000_000;
  const h = harness({ now: () => t });
  const inner = h.deps.fetch;
  h.deps.fetch = (url, init) => {
    t += 4_200; // the provider call takes 4.2 s
    return inner(url, init);
  };
  const json = await (await handleFactcheck(transcribeRequest(), h.deps)).json();
  assertEquals(json.seconds_left, 236); // 240 - 4.2, rounded up to a whole second of margin
  const quiet = harness({ now: () => t });
  assertEquals(
    (await (await handleFactcheck(transcribeRequest(wav({ samples: new Int16Array(32000) })), quiet.deps)).json())
      .seconds_left,
    240,
  );
  const h2 = harness({ now: () => t });
  h2.rpcResult.factcheck_touch = { data: { ok: true, seconds_left: 2 }, error: null };
  h2.deps.fetch = (url, init) => {
    t += 9_000;
    return harness().deps.fetch(url, init);
  };
  assertEquals((await (await handleFactcheck(transcribeRequest(), h2.deps)).json()).seconds_left, 0);
});

Deno.test('the transcription log row carries the session id in raw_usage even when the provider reports no usage', async () => {
  const h = harness();
  h.models.transcribe = () => ({ text: 'hi' });
  await handleFactcheck(transcribeRequest(), h.deps);
  assertEquals(h.logRows[0].raw_usage, { session_id: SESSION });
});

Deno.test('a valid piece under half a second is treated as silent: touched, no provider call, empty text, 200', async () => {
  const h = harness();
  const res = await handleFactcheck(transcribeRequest(wav({ samples: tone(4800, 12000) })), h.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { seq: 3, text: '', seconds_left: 240 });
  assertEquals(h.rpcCalls.map((c) => c.args.p_action), ['transcribe']);
  assertEquals(h.fetches.length, 0);
  assertEquals(h.logRows.length, 0);
});

Deno.test('a malformed short piece is still a 400 with no touch', async () => {
  const h = harness();
  assertEquals((await handleFactcheck(transcribeRequest(wav({ seconds: 0.3, channels: 2 })), h.deps)).status, 400);
  assertEquals(h.rpcCalls, []);
});

Deno.test('real response shape: the scribe fixture gives its text and its reported cost', async () => {
  const fx = JSON.parse(await Deno.readTextFile(new URL('./__fixtures__/scribe_transcription.json', import.meta.url)));
  const h = harness();
  h.models.transcribe = () => fx;
  const json = await (await handleFactcheck(transcribeRequest(), h.deps)).json();
  assertEquals(json.text, fx.text.trim());
  assertEquals(h.logRows[0].cost_usd, fx.usage.cost);
});
