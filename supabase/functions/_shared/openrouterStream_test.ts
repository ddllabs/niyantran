import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import {
  buildRequestBody,
  MIN_CACHEABLE_PREFIX_CHARS,
  type ModelEvent,
  parseSseStream,
  ProviderError,
  streamChat,
  type StreamDeps,
} from './openrouterStream.ts';

/** An SSE body from payload objects, delivered in awkward chunk boundaries. */
function sseBody(payloads: unknown[], chunkSize = 7): ReadableStream<Uint8Array> {
  const text = payloads.map((p) => `data: ${typeof p === 'string' ? p : JSON.stringify(p)}\n\n`).join('') + ': OPENROUTER PROCESSING\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(i, i + chunkSize));
      i += chunkSize;
    },
  });
}

function deps(payloads: unknown[], status = 200, calls: Record<string, unknown>[] = []): StreamDeps {
  return {
    apiKey: 'sk-test',
    fetch: ((_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      if (status !== 200) return Promise.resolve(new Response(JSON.stringify({ error: { message: 'nope' } }), { status }));
      return Promise.resolve(new Response(sseBody(payloads), { status: 200 }));
    }) as unknown as typeof fetch,
  };
}

async function collect(gen: AsyncGenerator<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const chunk = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: 'gen-1',
  model: 'google/gemini-3.5-flash-lite',
  choices: [{ index: 0, delta, finish_reason: null }],
  ...extra,
});

Deno.test('parseSseStream frames across chunk boundaries, skips comments, ends on [DONE]', async () => {
  const got: string[] = [];
  for await (const p of parseSseStream(sseBody([{ a: 1 }, 'plain text payload', { b: 2 }], 3))) got.push(p);
  assertEquals(got, ['{"a":1}', 'plain text payload', '{"b":2}']);
});

Deno.test('a text answer streams as text events and ends with usage, served model and generation id', async () => {
  const events = await collect(
    streamChat(deps([
      chunk({ role: 'assistant', content: '{"answer":"Hel' }),
      chunk({ content: 'lo"}' }),
      { ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.0001, prompt_tokens_details: { cached_tokens: 80 }, completion_tokens_details: { reasoning_tokens: 5 } } },
    ]), { model: 'google/gemini-3.5-flash-lite', messages: [] }),
  );
  assertEquals(events.map((e) => e.type), ['text', 'text', 'finish']);
  assertEquals((events[0] as { text: string }).text + (events[1] as { text: string }).text, '{"answer":"Hello"}');
  const fin = events[2] as Extract<ModelEvent, { type: 'finish' }>;
  assertEquals(fin.reason, 'stop');
  assertEquals(fin.served, 'google/gemini-3.5-flash-lite');
  assertEquals(fin.generationId, 'gen-1');
  assertEquals(fin.usage, { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cached_prompt_tokens: 80, reasoning_tokens: 5, cost: 0.0001 });
});

Deno.test('reasoning deltas, then two tool calls interleaved by index, arguments accumulated until complete', async () => {
  const events = await collect(
    streamChat(deps([
      chunk({ reasoning: 'Think' }),
      chunk({ reasoning: 'ing.' }),
      chunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'search_documents', arguments: '{"query":"comm' } }] }),
      chunk({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'search_desk_rows', arguments: '{"tier":' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'ittee stage"}' } }] }),
      chunk({ tool_calls: [{ index: 1, function: { arguments: '"national"}' } }] }),
      { ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]), { model: 'm', messages: [] }),
  );
  assertEquals(events.map((e) => e.type), ['reasoning', 'reasoning', 'tool-call', 'tool-call', 'finish']);
  assertEquals(events[2], { type: 'tool-call', id: 'call_a', name: 'search_documents', args: '{"query":"committee stage"}' });
  assertEquals(events[3], { type: 'tool-call', id: 'call_b', name: 'search_desk_rows', args: '{"tier":"national"}' });
  assertEquals((events[4] as { reason: string }).reason, 'tool_calls');
});

Deno.test('[DONE] without usage → usage null; finish defaults to stop', async () => {
  const events = await collect(streamChat(deps([chunk({ content: 'x' })]), { model: 'm', messages: [] }));
  const fin = events.at(-1) as Extract<ModelEvent, { type: 'finish' }>;
  assertEquals(fin.usage, null);
  assertEquals(fin.reason, 'stop');
});

Deno.test('a 503 throws a retryable ProviderError; a schema rejection is code "schema" and not retryable', async () => {
  const err = await assertRejects(() => collect(streamChat(deps([], 503), { model: 'm', messages: [] })), ProviderError);
  assertEquals(err.status, 503);
  assertEquals(err.retryable, true);
  assertEquals(err.code, 'provider');
  const schema = new ProviderError(400, '{"error":{"message":"response_format is not supported by this endpoint"}}');
  assertEquals(schema.code, 'schema');
  assertEquals(schema.retryable, false);
  const mid = deps([{ error: { code: 429, message: 'rate limited' } }]);
  const e2 = await assertRejects(() => collect(streamChat(mid, { model: 'm', messages: [] })), ProviderError);
  assertEquals(e2.status, 429);
  assertEquals(e2.retryable, true);
});

Deno.test('the request body carries stream, usage, tools, response_format with require_parameters, reasoning, and cache breakpoints only above the minimum', () => {
  const system = { role: 'system' as const, content: 'S'.repeat(MIN_CACHEABLE_PREFIX_CHARS) };
  const user = { role: 'user' as const, content: 'hi' };
  const body = buildRequestBody({
    model: 'm',
    messages: [system, user],
    tools: [{ type: 'function' }],
    response_format: { type: 'json_schema' },
    reasoning: { effort: 'low' },
    max_tokens: 4000,
    cache: true,
  });
  assertEquals(body.stream, true);
  assertEquals(body.usage, { include: true });
  assertEquals(body.tool_choice, 'auto');
  assertEquals(body.provider, { require_parameters: true });
  assertEquals(body.reasoning, { effort: 'low' });
  assertEquals(body.max_tokens, 4000);
  const msgs = body.messages as { content: unknown }[];
  assert(Array.isArray(msgs[0].content), 'system content became parts with a breakpoint');
  assert(Array.isArray(msgs[1].content), 'last user content became parts with a breakpoint');
  const small = buildRequestBody({ model: 'm', messages: [{ role: 'system', content: 'short' }, user], cache: true });
  assertEquals(typeof (small.messages as { content: unknown }[])[0].content, 'string', 'no breakpoint below the minimum');
  const plain = buildRequestBody({ model: 'm', messages: [user] });
  assertEquals('tools' in plain, false);
  assertEquals('response_format' in plain, false);
  assertEquals('provider' in plain, false);
});
