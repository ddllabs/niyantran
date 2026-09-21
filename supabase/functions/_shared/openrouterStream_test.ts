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
function sseBody(payloads: unknown[], chunkSize = 7, done = true): ReadableStream<Uint8Array> {
  const text = payloads.map((p) => `data: ${typeof p === 'string' ? p : JSON.stringify(p)}\n\n`).join('') + ': OPENROUTER PROCESSING\n\n' + (done ? 'data: [DONE]\n\n' : '');
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

Deno.test('confirmed stop without usage preserves usage null', async () => {
  const events = await collect(streamChat(deps([chunk({ content: 'x' }), finished('stop')]), { model: 'm', messages: [] }));
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

const finished = (reason: string) => chunk({}, { choices: [{ index: 0, delta: {}, finish_reason: reason }] });
const tool = (args = '{"query":"x"}', id = 'call_a', name = 'search_documents') => chunk({
  tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: args } }],
});
function rawDeps(payloads: unknown[], done = true, chunkSize = 1): StreamDeps {
  return { apiKey: 'fake-key', fetch: (() => Promise.resolve(new Response(sseBody(payloads, chunkSize, done)))) as typeof fetch };
}
async function expectFailure(payloads: unknown[], done = true): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  const error = await assertRejects(async () => {
    for await (const event of streamChat(rawDeps(payloads, done), { model: 'fake', messages: [] })) events.push(event);
  }, ProviderError);
  assertEquals(error.status, 502);
  assertEquals(events.some((e) => e.type === 'finish' || e.type === 'tool-call'), false);
  return events;
}

for (const done of [false, true]) {
  Deno.test(`premature ${done ? '[DONE]' : 'EOF'} after text is a failure, never fabricated stop`, async () => {
    const events = await expectFailure([chunk({ content: 'Visible partial' })], done);
    assertEquals(events, [{ type: 'text', text: 'Visible partial' }]);
  });
  Deno.test(`premature ${done ? '[DONE]' : 'EOF'} with tool fragments never emits callable tools`, async () => {
    await expectFailure([tool('{"query":')], done);
  });
  Deno.test(`an empty ${done ? '[DONE]' : 'EOF'} stream is not a successful answer`, async () => {
    await expectFailure([], done);
  });
}

Deno.test('valid stop, length and content_filter retain their actual reason without usage or DONE', async () => {
  for (const reason of ['stop', 'length', 'content_filter']) {
    const events = await collect(streamChat(rawDeps([chunk({ content: 'é🙂' }), finished(reason)], false), { model: 'fake', messages: [] }));
    assertEquals(events, [
      { type: 'text', text: 'é🙂' },
      { type: 'finish', reason, usage: null, served: 'google/gemini-3.5-flash-lite', generationId: 'gen-1' },
    ]);
  }
});
Deno.test('repeated finish on the final usage frame remains one terminal event', async () => {
  const events = await collect(streamChat(rawDeps([
    chunk({ content: 'Answer' }), finished('stop'),
    { ...finished('stop'), usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } },
  ]), { model: 'fake', messages: [] }));
  assertEquals(events.filter((e) => e.type === 'finish').length, 1);
  assertEquals((events.at(-1) as Extract<ModelEvent, { type: 'finish' }>).usage?.total_tokens, 5);
});
Deno.test('length or content_filter never promotes unfinished tool arguments to a tool call', async () => {
  for (const reason of ['length', 'content_filter', 'stop']) {
    const events = await collect(streamChat(rawDeps([tool('{"query":'), finished(reason)]), { model: 'fake', messages: [] }));
    assertEquals(events.map((e) => e.type), ['finish']);
    assertEquals((events[0] as Extract<ModelEvent, { type: 'finish' }>).reason, reason);
  }
});
Deno.test('tool_calls finish requires every call to have identity, name and complete object arguments', async () => {
  for (const malformed of [tool('{'), tool('{}', ''), tool('{}', 'call', ''), tool('null'), tool('[]')]) {
    await expectFailure([tool(), chunk({ tool_calls: [{ ...(malformed.choices[0].delta.tool_calls as object[])[0], index: 1 }] }), finished('tool_calls')]);
  }
  await expectFailure([finished('tool_calls')]);
});
Deno.test('finish_reason error and choice-level errors cannot become successful finishes', async () => {
  await expectFailure([finished('error')]);
  await expectFailure([chunk({}, { choices: [{ delta: {}, finish_reason: 'stop', error: { code: 502, message: 'disconnected' } }] })]);
});
Deno.test('midstream errors after partial text preserve failure and emit no finish or tool calls', async () => {
  const events = await expectFailure([chunk({ content: 'Partial' }), tool(), { error: { code: 'server_error', message: 'Disconnected' }, ...finished('error') }]);
  assertEquals(events, [{ type: 'text', text: 'Partial' }]);
});
Deno.test('abort after a delivered text event cannot become completion even if fetch ignores abort', async () => {
  const abort = new AbortController();
  const stream = streamChat(rawDeps([chunk({ content: 'Partial' }), finished('stop')]), { model: 'fake', messages: [], signal: abort.signal });
  assertEquals((await stream.next()).value, { type: 'text', text: 'Partial' });
  abort.abort();
  const error = await assertRejects(() => stream.next(), DOMException);
  assertEquals(error.name, 'AbortError');
});
Deno.test('an already aborted request does not call fetch', async () => {
  const abort = new AbortController(); abort.abort(); let count = 0;
  const source = rawDeps([finished('stop')]); const fetch = source.fetch;
  source.fetch = (...args) => { count++; return fetch(...args); };
  await assertRejects(() => collect(streamChat(source, { model: 'fake', messages: [], signal: abort.signal })), DOMException);
  assertEquals(count, 0);
});

Deno.test('confirmed tool_calls at EOF needs neither DONE nor usage and keeps provider identity', async () => {
  const events = await collect(streamChat(rawDeps([tool(), finished('tool_calls')], false), { model: 'fake', messages: [] }));
  assertEquals(events[0], { type: 'tool-call', id: 'call_a', name: 'search_documents', args: '{"query":"x"}' });
  assertEquals(events[1], { type: 'finish', reason: 'tool_calls', usage: null, served: 'google/gemini-3.5-flash-lite', generationId: 'gen-1' });
});
Deno.test('a transport read failure propagates without finish or hidden fetch retries', async () => {
  let reads = 0; let fetches = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (reads++ === 0) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk({ content: 'Partial' }))}\n\n`));
    else controller.error(new TypeError('fake transport disconnected'));
  } });
  const source: StreamDeps = { apiKey: 'fake', fetch: (() => { fetches++; return Promise.resolve(new Response(body)); }) as typeof fetch };
  const events: ModelEvent[] = [];
  await assertRejects(async () => { for await (const e of streamChat(source, { model: 'fake', messages: [] })) events.push(e); }, TypeError, 'fake transport disconnected');
  assertEquals(events, [{ type: 'text', text: 'Partial' }]);
  assertEquals(fetches, 1);
});
Deno.test('request abort reaches fetch and rejects a pending stream read without completion', async () => {
  const abort = new AbortController();
  let fetches = 0;
  const source: StreamDeps = { apiKey: 'fake', fetch: ((_url: unknown, init: RequestInit) => {
    fetches++;
    assertEquals(init.signal, abort.signal);
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk({ content: 'Partial' }))}\n\n`));
      abort.signal.addEventListener('abort', () => controller.error(abort.signal.reason), { once: true });
    } });
    return Promise.resolve(new Response(body));
  }) as typeof fetch };
  const stream = streamChat(source, { model: 'fake', messages: [], signal: abort.signal });
  assertEquals((await stream.next()).value, { type: 'text', text: 'Partial' });
  const pending = stream.next();
  abort.abort();
  const error = await assertRejects(() => pending, DOMException);
  assertEquals(error.name, 'AbortError');
  assertEquals(fetches, 1);
});

Deno.test('output after a provider finish is rejected before yielding the late delta', async () => {
  for (const delta of [{ content: 'Late text' }, { reasoning: 'Late reasoning' }, { reasoning_content: 'Late reasoning' }]) {
    const events = await expectFailure([chunk({ content: 'Original' }), finished('stop'), chunk(delta)]);
    assertEquals(events, [{ type: 'text', text: 'Original' }]);
  }
});
Deno.test('tool fragments after tool_calls finish are rejected before emitting any callable tool', async () => {
  await expectFailure([tool(), finished('tool_calls'), chunk({ tool_calls: [{ index: 0, function: { arguments: ' ' } }] })]);
});
Deno.test('a contradictory repeated finish is an error rather than replacing the first reason', async () => {
  await expectFailure([finished('stop'), finished('length')]);
});
Deno.test('content with its first finish reason and identical empty terminal frames remains valid', async () => {
  const combined = chunk({ content: 'Complete answer' }, { choices: [{ index: 0, delta: { content: 'Complete answer' }, finish_reason: 'stop' }] });
  const accounting = { ...finished('stop'), choices: [{ index: 0, delta: { content: '', reasoning: '', reasoning_content: null, tool_calls: [] }, finish_reason: 'stop' }], usage: { total_tokens: 5 } };
  const events = await collect(streamChat(rawDeps([combined, finished('stop'), accounting]), { model: 'fake', messages: [] }));
  assertEquals(events.map((e) => e.type), ['text', 'finish']);
  assertEquals(events[0], { type: 'text', text: 'Complete answer' });
  assertEquals((events[1] as Extract<ModelEvent, { type: 'finish' }>).reason, 'stop');
  assertEquals((events[1] as Extract<ModelEvent, { type: 'finish' }>).usage?.total_tokens, 5);
});
