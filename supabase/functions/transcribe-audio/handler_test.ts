import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { handleTranscription } from './handler.ts';
function request(file = new Blob(['speech'], { type: 'audio/webm' })) {
  const body = new FormData(); body.append('file', file, 'speech.webm');
  return new Request('http://localhost/transcribe-audio', { method: 'POST', headers: { authorization: 'Bearer a.b.c', origin: 'http://localhost:5173' }, body });
}
function deps(overrides = {}) {
  return { verify: async () => ({ id: 'u' }), active: async () => true, apiKey: 'test-provider-key',
    fetch: async (_url: unknown, init: RequestInit) => {
      const form = init.body as FormData;
      assertEquals(form.get('model'), 'whisper-1');
      assertEquals(form.get('response_format'), 'json');
      return new Response(JSON.stringify({ text: 'Hello world' }));
    }, origins: ['http://localhost:5173'], ...overrides };
}
Deno.test('transcription verifies identity and forwards only admitted audio to fixed Whisper endpoint', async () => {
  let url = '';
  const real = deps();
  const res = await handleTranscription(request(), deps({ fetch: (target: string, init: RequestInit) => { url = target; return real.fetch(target, init); } }));
  assertEquals(res.status, 200); assertEquals(await res.json(), { text: 'Hello world' });
  assertEquals(url, 'https://api.openai.com/v1/audio/transcriptions');
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
Deno.test('rejections never invoke OpenAI, and untrusted provider errors never leak', async () => {
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
