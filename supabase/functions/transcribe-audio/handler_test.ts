import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { handleTranscription, type ModelCallRow } from './handler.ts';
function request(file = new Blob(['speech'], { type: 'audio/webm' })) {
  const body = new FormData(); body.append('file', file, 'speech.webm');
  return new Request('http://localhost/transcribe-audio', { method: 'POST', headers: { authorization: 'Bearer a.b.c', origin: 'http://localhost:5173' }, body });
}
function deps(overrides = {}) {
  return { verify: async () => ({ id: 'u' }), active: async () => true, apiKey: 'test-provider-key',
    logModelCall: async (_row: ModelCallRow) => {},
    fetch: async (_url: unknown, init: RequestInit) => {
      const form = init.body as FormData;
      assertEquals(form.get('model'), 'openai/whisper-large-v3-turbo');
      assertEquals(form.get('response_format'), 'json');
      return new Response(JSON.stringify({ text: 'Hello world' }));
    }, origins: ['http://localhost:5173'], ...overrides };
}
Deno.test('transcription verifies identity and forwards only admitted audio to fixed OpenRouter Whisper endpoint', async () => {
  let url = '';
  const real = deps();
  const res = await handleTranscription(request(), deps({ fetch: (target: string, init: RequestInit) => { url = target; return real.fetch(target, init); } }));
  assertEquals(res.status, 200); assertEquals(await res.json(), { text: 'Hello world' });
  assertEquals(url, 'https://openrouter.ai/api/v1/audio/transcriptions');
});
Deno.test('missing bearer and suspended accounts cannot call the provider', async () => {
  const req = request(); req.headers.delete('authorization');
  assertEquals((await handleTranscription(req, deps())).status, 401);
  assertEquals((await handleTranscription(request(), deps({ active: async () => false }))).status, 403);
});
Deno.test('invalid files and oversized streaming bodies are refused', async () => {
  assertEquals((await handleTranscription(request(new Blob(['no'], { type: 'text/plain' })), deps())).status, 400);
  const req = new Request('http://localhost/transcribe-audio', { method: 'POST', headers: { authorization: 'Bearer a.b.c', 'content-type': 'multipart/form-data; boundary=a' }, body: new Uint8Array(8 * 1024 * 1024 + 16385) });
  assertEquals((await handleTranscription(req, deps())).status, 413);
});
Deno.test('missing configuration and provider failures are safe, actionable responses', async () => {
  assertEquals((await handleTranscription(request(), deps({ apiKey: '' }))).status, 503);
  const res = await handleTranscription(request(), deps({ fetch: async () => new Response('secret-error', { status: 500 }) }));
  assertEquals(res.status, 502); assertStringIncludes(await res.text(), 'Transcription failed');
});
Deno.test('rejections never invoke the provider, and untrusted provider errors never leak', async () => {
  let calls = 0;
  const forbiddenFetch = async () => { calls++; throw new Error('provider-secret'); };
  const req = request(); req.headers.delete('authorization');
  assertEquals((await handleTranscription(req, deps({ fetch: forbiddenFetch }))).status, 401);
  assertEquals((await handleTranscription(request(), deps({ active: async () => false, fetch: forbiddenFetch }))).status, 403);
  const origin = request(); origin.headers.set('origin', 'https://foreign.example');
  assertEquals((await handleTranscription(origin, deps({ fetch: forbiddenFetch }))).status, 403);
  assertEquals(calls, 0);
  const response = await handleTranscription(request(), deps({ fetch: forbiddenFetch }));
  assertEquals(response.status, 502); assertEquals((await response.text()).includes('provider-secret'), false);
});

Deno.test('function entry uses existing server-side OpenRouter credential', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  assertStringIncludes(source, "Deno.env.get('OPENROUTER_API_KEY')");
  assertEquals(source.includes('OPENAI_API_KEY'), false);
});

// ---- model_call_logs (F111 task 3) ----------------------------------------
// Dictation is free (owner decision 2026-10-14, spec section 6): these rows make
// its cost visible and are never charged.

function recorder() {
  const rows: ModelCallRow[] = [];
  return { rows, logModelCall: async (row: ModelCallRow) => { rows.push(row); } };
}
const provider = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
let clock = 1_000;
const tick = () => (clock += 250);

Deno.test('a success writes exactly one row with the call columns and the reported cost', async () => {
  const log = recorder();
  clock = 1_000;
  const usage = { cost: 0.000508, input_tokens: 83, output_tokens: 30, total_tokens: 113, seconds: 9.2 };
  const res = await handleTranscription(request(), deps({ ...log, now: tick, fetch: provider({ text: ' Hello ', usage }) }));
  assertEquals(res.status, 200); assertEquals(await res.json(), { text: 'Hello' });
  assertEquals(log.rows, [{
    user_id: 'u', conversation_id: null, message_id: null, caller: 'transcribe-audio', purpose: 'transcription',
    model_requested: 'openai/whisper-large-v3-turbo', model_served: null, provider: null, status: 'success', error_message: null,
    latency_ms: 250, prompt_tokens: 83, completion_tokens: 30, total_tokens: 113, cached_prompt_tokens: null, reasoning_tokens: null,
    cost_usd: 0.000508, openrouter_generation_id: null, raw_usage: { ...usage, cost_source: 'provider' },
  }]);
});

Deno.test('a duration-priced response keeps its seconds, leaves tokens null and uses the reported cost', async () => {
  const log = recorder();
  await handleTranscription(request(), deps({ ...log, fetch: provider({ text: 'hi', usage: { seconds: 20, cost: 0.005333 } }) }));
  assertEquals(log.rows.length, 1);
  const row = log.rows[0];
  assertEquals([row.prompt_tokens, row.completion_tokens, row.total_tokens, row.cost_usd], [null, null, null, 0.005333]);
  assertEquals(row.raw_usage, { seconds: 20, cost: 0.005333, cost_source: 'provider' });
});

Deno.test('no reported cost is never estimated: cost_usd stays null', async () => {
  for (const body of [{ text: 'hi' }, { text: 'hi', usage: { seconds: 5 } }, { text: 'hi', usage: { cost: 'cheap' } }, { text: 'hi', usage: { cost: -1 } }]) {
    const log = recorder();
    assertEquals((await handleTranscription(request(), deps({ ...log, fetch: provider(body) }))).status, 200);
    assertEquals(log.rows.length, 1); assertEquals(log.rows[0].status, 'success'); assertEquals(log.rows[0].cost_usd, null);
  }
});

Deno.test('a provider error writes one error row with server-authored text only', async () => {
  const log = recorder();
  const res = await handleTranscription(request(), deps({ ...log, fetch: provider({ error: 'provider-secret' }, 500) }));
  assertEquals(res.status, 502);
  assertEquals(log.rows.length, 1);
  const row = log.rows[0];
  assertEquals([row.status, row.caller, row.cost_usd, row.user_id, row.message_id], ['error', 'transcribe-audio', null, 'u', null]);
  assertEquals(row.error_message!.includes('provider-secret'), false);
});

Deno.test('a network failure and an unusable 200 each write one error row', async () => {
  for (const fetch of [async () => { throw new Error('provider-secret'); }, async () => new Response('not json'), provider({ nothing: true }), provider({ text: 7 })]) {
    const log = recorder();
    assertEquals((await handleTranscription(request(), deps({ ...log, fetch }))).status, 502);
    assertEquals(log.rows.length, 1); assertEquals(log.rows[0].status, 'error');
    assertEquals(String(log.rows[0].error_message).includes('provider-secret'), false);
  }
});

Deno.test('a caller who disconnects mid-call writes one aborted row', async () => {
  const log = recorder();
  const controller = new AbortController();
  const base = request();
  const req = new Request(base, { signal: controller.signal });
  const fetch = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    controller.abort();
  });
  assertEquals((await handleTranscription(req, deps({ ...log, fetch }))).status, 502);
  assertEquals(log.rows.length, 1); assertEquals(log.rows[0].status, 'aborted');
});

Deno.test('a log write that throws changes neither the success nor the error response', async () => {
  const logModelCall = async () => { throw new Error('db down'); };
  const ok = await handleTranscription(request(), deps({ logModelCall }));
  assertEquals(ok.status, 200); assertEquals(await ok.json(), { text: 'Hello world' });
  const bad = await handleTranscription(request(), deps({ logModelCall, fetch: provider({}, 500) }));
  assertEquals(bad.status, 502); assertStringIncludes(await bad.text(), 'Transcription failed');
});

Deno.test('a log write that hangs cannot delay the response past the bound', async () => {
  const logModelCall = () => new Promise<void>(() => {});
  const started = performance.now();
  const res = await handleTranscription(request(), deps({ logModelCall, telemetryTimeoutMs: 40 }));
  const elapsed = performance.now() - started;
  assertEquals(res.status, 200); assertEquals(await res.json(), { text: 'Hello world' });
  assertEquals(elapsed < 1_000, true, `took ${elapsed}ms`);
});

Deno.test('requests rejected before the provider call write no row', async () => {
  const log = recorder();
  const d = (o = {}) => deps({ ...log, ...o });
  const noAuth = request(); noAuth.headers.delete('authorization');
  const foreign = request(); foreign.headers.set('origin', 'https://foreign.example');
  const get = new Request('http://localhost/transcribe-audio', { method: 'GET', headers: { origin: 'http://localhost:5173' } });
  const oversized = new Request('http://localhost/transcribe-audio', { method: 'POST', headers: { authorization: 'Bearer a.b.c', 'content-type': 'multipart/form-data; boundary=a' }, body: new Uint8Array(8 * 1024 * 1024 + 16385) });
  assertEquals((await handleTranscription(noAuth, d())).status, 401);
  assertEquals((await handleTranscription(request(), d({ active: async () => false }))).status, 403);
  assertEquals((await handleTranscription(foreign, d())).status, 403);
  assertEquals((await handleTranscription(get, d())).status, 405);
  assertEquals((await handleTranscription(request(), d({ apiKey: '' }))).status, 503);
  assertEquals((await handleTranscription(request(new Blob(['no'], { type: 'text/plain' })), d())).status, 400);
  assertEquals((await handleTranscription(oversized, d())).status, 413);
  assertEquals(log.rows.length, 0);
});

Deno.test('function entry writes rows with the service client, to model_call_logs only', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  assertStringIncludes(source, 'serviceClient()');
  assertStringIncludes(source, ".from('model_call_logs').insert(row)");
});
