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

// Anthropic's cache prefix starts with the tool definitions, so an answer call
// that dropped them matched nothing: message 5221476f's answer call read 0 of
// 56,495 prompt tokens from cache while the call before it read 28,058.
Deno.test('tools offered with tool_choice none stay in an Anthropic body and leave every other body tools-free', () => {
  const tools = [{ type: 'function', function: { name: 'search_documents' } }];
  const messages = [{ role: 'user' as const, content: 'hi' }];
  const claude = buildRequestBody({ model: 'anthropic/claude-sonnet-5', messages, tools, tool_choice: 'none' });
  assertEquals(claude.tools, tools);
  assertEquals(claude.tool_choice, 'none');
  // Elsewhere nothing needs the definitions, and a tool_choice the provider
  // does not support would narrow require_parameters routing.
  for (const model of ['google/gemini-3.7-flash', 'deepseek/deepseek-v4-flash', 'openai/gpt-6-astra']) {
    const other = buildRequestBody({ model, messages, tools, tool_choice: 'none' });
    assertEquals('tools' in other, false, model);
    assertEquals('tool_choice' in other, false, model);
  }
  assertEquals(buildRequestBody({ model: 'google/gemini-3.7-flash', messages, tools }).tool_choice, 'auto');
});

// The explicit breakpoints sit on the system prompt and the question, so the
// search results a turn accumulates were re-billed in full on every research call.
Deno.test('an Anthropic body with a cacheable prompt also caches its moving tail; no other body does', () => {
  const messages = [
    { role: 'system' as const, content: 'S'.repeat(MIN_CACHEABLE_PREFIX_CHARS) },
    { role: 'user' as const, content: 'hi' },
    { role: 'tool' as const, tool_call_id: 'c1', content: 'evidence' },
  ];
  assertEquals(
    buildRequestBody({ model: 'anthropic/claude-sonnet-5', messages, cache: true }).cache_control,
    { type: 'ephemeral' },
  );
  const tool = buildRequestBody({ model: 'anthropic/claude-sonnet-5', messages, cache: true }).messages as {
    content: unknown;
  }[];
  assertEquals(tool[2].content, 'evidence', 'the tail is cached by the top-level field, not a marker in a tool reply');
  assertEquals('cache_control' in buildRequestBody({ model: 'google/gemini-3.7-flash', messages, cache: true }), false);
  assertEquals('cache_control' in buildRequestBody({ model: 'anthropic/claude-sonnet-5', messages }), false);
  const short = [{ role: 'system' as const, content: 'short' }, messages[1]];
  assertEquals(
    'cache_control' in buildRequestBody({ model: 'anthropic/claude-sonnet-5', messages: short, cache: true }),
    false,
    'no cache write below the minimum',
  );
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

Deno.test('partial and empty provider usage keeps missing token fields unknown', async () => {
  for (const usage of [{ prompt_tokens: 100 }, {}]) {
    const events = await collect(
      streamChat(rawDeps([{ ...finished('stop'), usage }]), { model: 'fake', messages: [] }),
    );
    const actual = (events.at(-1) as Extract<ModelEvent, { type: 'finish' }>).usage;
    assertEquals(actual?.prompt_tokens, 'prompt_tokens' in usage ? 100 : null);
    assertEquals(actual?.completion_tokens, null);
    assertEquals(actual?.total_tokens, null);
  }
});
Deno.test('invalid provider usage numbers remain unknown while explicit zero is retained', async () => {
  const events = await collect(
    streamChat(
      rawDeps([{ ...finished('stop'), usage: { prompt_tokens: -1, completion_tokens: 0, total_tokens: 0, cost: -1 } }]),
      { model: 'fake', messages: [] },
    ),
  );
  const actual = (events.at(-1) as Extract<ModelEvent, { type: 'finish' }>).usage;
  assertEquals(actual?.prompt_tokens, null);
  assertEquals(actual?.completion_tokens, 0);
  assertEquals(actual?.total_tokens, 0);
  assertEquals(actual?.cost ?? null, null);
});

Deno.test('private attempt metadata survives a provider error and is never serialized', async () => {
  const observations: unknown[] = [];
  const provider = deps([chunk({ content: 'Partial' }, { provider: 'Actual host' }), {
    id: 'gen-error',
    model: 'served/model',
    usage: { prompt_tokens: 12, cost: 0.1 },
    error: { code: 502, message: 'PRIVATE provider details' },
  }]);
  await assertRejects(
    () =>
      collect(streamChat(provider, {
        model: 'requested/model',
        messages: [],
        onAttemptMetadata: (metadata) => observations.push(metadata),
      })),
    ProviderError,
  );
  assertEquals(observations.at(-1), {
    served: 'served/model',
    generationId: 'gen-error',
    provider: 'Actual host',
    usage: { prompt_tokens: 12, completion_tokens: null, total_tokens: null, cost: 0.1 },
  });
  const body = buildRequestBody({
    model: 'm',
    messages: [],
    onAttemptMetadata: () => {
      throw new Error('not serializable');
    },
  });
  assertEquals('onAttemptMetadata' in body, false);
});
Deno.test('accounting observer errors cannot fail a valid provider response', async () => {
  const events = await collect(
    streamChat(rawDeps([finished('stop')]), {
      model: 'm',
      messages: [],
      onAttemptMetadata: () => {
        throw new Error('observer failed');
      },
    }),
  );
  assertEquals(events.at(-1)?.type, 'finish');
});

// answer-streaming spec §4: OpenRouter's sticky-routing key travels on every call of a turn.
Deno.test('session_id reaches the body, capped at 256 characters, and is absent when not given', () => {
  const base = { model: 'google/gemini-3.8-flash', messages: [{ role: 'user' as const, content: 'q' }] };
  assertEquals(buildRequestBody({ ...base, session_id: 'conv-1' }).session_id, 'conv-1');
  assertEquals((buildRequestBody({ ...base, session_id: 'x'.repeat(300) }).session_id as string).length, 256);
  assertEquals('session_id' in buildRequestBody(base), false);
});

// answer-streaming spec §4, measured 2026-10-02 against OpenRouter (Gemini 3.8 Flash, three rounds
// of a growing transcript, twice): with per-block breakpoints every call wrote a fresh billed
// explicit cache - 15% more cost ($0.0219 against $0.0191) and calls of 6.2-8.4 s against 2.7-3.3 s.
// Google bodies therefore carry no breakpoints and rely on Gemini's free implicit caching; Anthropic,
// where the same breakpoints read 53-68% of each later round from cache, keeps them.
Deno.test('Google bodies carry no cache breakpoints; Anthropic bodies keep them', () => {
  const system = { role: 'system' as const, content: 'S'.repeat(MIN_CACHEABLE_PREFIX_CHARS) };
  const user = { role: 'user' as const, content: 'hi' };
  const gemini = buildRequestBody({ model: 'google/gemini-3.8-flash', messages: [system, user], cache: true });
  assertEquals((gemini.messages as { content: unknown }[]).map((m) => typeof m.content), ['string', 'string']);
  assertEquals('cache_control' in gemini, false);
  const claude = buildRequestBody({ model: 'anthropic/claude-sonnet-5', messages: [system, user], cache: true });
  assert(Array.isArray((claude.messages as { content: unknown }[])[0].content));
  assertEquals(claude.cache_control, { type: 'ephemeral' });
});

// web-search spec §2: the server tool rides beside the function tools on a research call and is
// never sent on a tool_choice 'none' call - on any provider. Anthropic keeps its function tools
// there for cache identity; a server tool is not a definition the cache needs, and a paid search
// on the answer call would be a surprising bill.
Deno.test('serverTools join tools with tool_choice auto on a research call, and never reach a tool_choice none body', () => {
  const tools = [{ type: 'function', function: { name: 'search_documents' } }];
  const serverTools = [{ type: 'openrouter:web_search', parameters: { engine: 'exa', max_uses: 3 } }];
  const messages = [{ role: 'user' as const, content: 'hi' }];
  for (const model of ['anthropic/claude-sonnet-5', 'google/gemini-3.8-flash', 'deepseek/deepseek-v4-flash', 'openai/gpt-6-astra']) {
    const research = buildRequestBody({ model, messages, tools, serverTools });
    assertEquals(research.tools, [...tools, ...serverTools], model);
    assertEquals(research.tool_choice, 'auto', model);
    const answer = buildRequestBody({ model, messages, tools, serverTools, tool_choice: 'none' });
    assertEquals(JSON.stringify(answer).includes('web_search'), false, `${model}: no server tool on the answer call`);
  }
  // Anthropic's answer call keeps exactly its function tools, as before.
  const claude = buildRequestBody({ model: 'anthropic/claude-sonnet-5', messages, tools, serverTools, tool_choice: 'none' });
  assertEquals(claude.tools, tools);
  assertEquals(claude.tool_choice, 'none');
  // A server tool with no function tools still goes out; an empty list changes nothing.
  assertEquals(buildRequestBody({ model: 'google/gemini-3.8-flash', messages, serverTools }).tools, serverTools);
  assertEquals('tools' in buildRequestBody({ model: 'google/gemini-3.8-flash', messages, serverTools: [] }), false);
});

// ---- web-search spec §2: the stream carries the pages a server-side search returned.
// The fixtures are the 2026-10-13 probe responses (parsed fields; content and annotations arrived
// on `delta`, so the streams below put them there, and one test puts them on `message`).

type Probe = { annotations: unknown[]; usage: Record<string, unknown>; finish: string };
const probe = (name: string): Probe =>
  JSON.parse(Deno.readTextFileSync(new URL(`./__fixtures__/web-search/probe1-${name}.json`, import.meta.url)));
const webResults = (events: ModelEvent[]) => events.filter((e) => e.type === 'web-results') as Extract<ModelEvent, { type: 'web-results' }>[];
const finishOf = (events: ModelEvent[]) => events.at(-1) as Extract<ModelEvent, { type: 'finish' }>;

Deno.test('annotations on delta become one web-results event after the text and before finish, with the search count and the model cost in usage', async () => {
  const gemini = probe('gemini-3.8-flash');
  const events = await collect(streamChat(rawDeps([
    chunk({ content: 'Part ' }),
    chunk({ content: 'two', annotations: gemini.annotations.slice(0, 2) }),
    chunk({ annotations: gemini.annotations.slice(2) }),
    { ...finished(gemini.finish), usage: gemini.usage },
  ]), { model: 'google/gemini-3.8-flash', messages: [] }));
  assertEquals(events.map((e) => e.type), ['text', 'web-progress', 'text', 'web-progress', 'web-results', 'finish']);
  const pages = webResults(events)[0].pages;
  assertEquals(pages.length, 5);
  assertEquals(pages[0].url, 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=59692');
  assertEquals(pages[0].title, 'Press Releases - Reserve Bank of India');
  assert(pages[0].excerpt.startsWith('Date : Feb 07, 2025'));
  const usage = finishOf(events).usage!;
  assertEquals(usage.web_search_requests, 1);
  assertEquals(usage.upstream_inference_cost, 0.0086745);
  assertEquals(usage.cost, 0.0156745);
});

Deno.test('annotations on message are read too, and a page repeated within the call is kept once', async () => {
  const claude = probe('claude-sonnet-5');
  const events = await collect(streamChat(rawDeps([
    chunk({ content: 'Answer' }),
    { ...chunk({}), choices: [{ index: 0, delta: {}, message: { annotations: claude.annotations }, finish_reason: null }] },
    { ...chunk({}), choices: [{ index: 0, delta: {}, message: { annotations: claude.annotations.slice(0, 3) }, finish_reason: null }] },
    { ...finished('stop'), usage: claude.usage },
  ]), { model: 'anthropic/claude-sonnet-5', messages: [] }));
  // The repeat on the second message frame adds nothing new, so it yields no progress.
  assertEquals(events.map((e) => e.type), ['text', 'web-progress', 'web-results', 'finish']);
  const urls = webResults(events)[0].pages.map((p) => p.url);
  assertEquals(new Set(urls).size, urls.length, 'de-duplicated by URL within the call');
  assertEquals(urls.length, new Set(claude.annotations.map((a) => (a as { url_citation: { url: string } }).url_citation.url)).size);
  assertEquals(finishOf(events).usage!.web_search_requests, 2);
});

Deno.test('a searching call that ends in tool calls yields its pages before the tool calls', async () => {
  const deepseek = probe('deepseek-v4-flash');
  const events = await collect(streamChat(rawDeps([
    chunk({ annotations: deepseek.annotations }),
    tool(),
    { ...finished('tool_calls'), usage: deepseek.usage },
  ]), { model: 'deepseek/deepseek-v4-flash', messages: [] }));
  assertEquals(events.map((e) => e.type), ['web-progress', 'web-results', 'tool-call', 'finish']);
  assertEquals(webResults(events)[0].pages.length, 5);
  // DeepSeek's split put the whole cost on the model; the count is still what the provider said.
  assertEquals(finishOf(events).usage!.web_search_requests, 1);
  assertEquals(finishOf(events).usage!.upstream_inference_cost, 0.000111111);
});

Deno.test('annotations arriving with or after the finish frame are kept and are not contradictory data', async () => {
  const gpt = probe('gpt-6-astra');
  const events = await collect(streamChat(rawDeps([
    chunk({ content: 'Answer' }),
    { ...chunk({ annotations: gpt.annotations.slice(0, 5) }), choices: [{ index: 0, delta: { annotations: gpt.annotations.slice(0, 5) }, finish_reason: 'stop' }] },
    chunk({ annotations: gpt.annotations.slice(5) }),
    { ...finished('stop'), usage: gpt.usage },
  ]), { model: 'openai/gpt-6-astra', messages: [] }));
  assertEquals(events.map((e) => e.type), ['text', 'web-progress', 'web-progress', 'web-results', 'finish']);
  assertEquals(webResults(events)[0].pages.length, new Set(gpt.annotations.map((a) => (a as { url_citation: { url: string } }).url_citation.url)).size);
  assertEquals(finishOf(events).usage!.web_search_requests, 3);
});

Deno.test('a call without annotations yields no web-results event, and usage without a search count carries none', async () => {
  const events = await collect(streamChat(rawDeps([
    chunk({ content: 'Answer', annotations: [] }),
    { ...finished('stop'), usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.01, cost_details: { upstream_inference_cost: -1 } } },
  ]), { model: 'fake', messages: [] }));
  assertEquals(events.map((e) => e.type), ['text', 'finish']);
  const usage = finishOf(events).usage!;
  assertEquals('web_search_requests' in usage, false);
  assertEquals('upstream_inference_cost' in usage, false, 'a negative model cost is unknown, not a number');
});

Deno.test('annotations without a usable http(s) URL are dropped, and a call of only those yields nothing', async () => {
  const events = await collect(streamChat(rawDeps([
    chunk({ content: 'x', annotations: [{ type: 'url_citation', url_citation: { url: 'javascript:alert(1)', title: 'bad' } }, { type: 'file_citation' }] }),
    finished('stop'),
  ]), { model: 'fake', messages: [] }));
  assertEquals(events.map((e) => e.type), ['text', 'finish']);
});

// ---- web-search-streaming spec §2 (F131): pages are shown live, as each search's annotations
// arrive. The Probe 3 fixture keeps Gemini's real chunk order: three bursts of five
// annotations, one per chunk, with reasoning between them, then a tool call.

type Probe3 = {
  max_uses: number;
  chunks: { ms: number; delta: Record<string, unknown> }[];
  finish: { ms: number; reason: string };
  usage: Record<string, unknown>;
};
const probe3 = (): Probe3 =>
  JSON.parse(Deno.readTextFileSync(new URL('./__fixtures__/web-search/probe3-gemini-3.8-flash-bursts.json', import.meta.url)));
const probe3Payloads = (p: Probe3, withFinish = true): unknown[] => [
  ...p.chunks.map((c) => chunk(c.delta)),
  ...(withFinish ? [{ ...finished(p.finish.reason), usage: p.usage }] : []),
];
const progressOf = (events: ModelEvent[]) =>
  events.filter((e) => e.type === 'web-progress') as Extract<ModelEvent, { type: 'web-progress' }>[];
/** Contiguous runs of web-progress events, by the number of pages each run carried. */
const bursts = (events: ModelEvent[]): number[] => {
  const out: number[] = [];
  let run = 0;
  for (const e of events) {
    if (e.type === 'web-progress') run += e.pages.length;
    else if (run) { out.push(run); run = 0; }
  }
  if (run) out.push(run);
  return out;
};

Deno.test('Probe 3: each search burst yields its pages live, between the reasoning, long before the one web-results at the end', async () => {
  const p = probe3();
  const events = await collect(streamChat(rawDeps(probe3Payloads(p)), { model: 'google/gemini-3.8-flash', messages: [] }));
  assertEquals(bursts(events), [5, 5, 5], 'three bursts of five, as the probe timed them');
  const types = events.map((e) => e.type);
  // Each burst arrives before the reasoning that followed it in the probe, not at the end.
  const reasoningAt = types.flatMap((t, i) => (t === 'reasoning' ? [i] : []));
  const progressAt = types.flatMap((t, i) => (t === 'web-progress' ? [i] : []));
  assert(progressAt[4] < reasoningAt[1] && progressAt[9] < reasoningAt[2] && progressAt[14] < reasoningAt[3]);
  // web-results is unchanged: once, after the last progress, before the tool call and finish.
  assertEquals(types.filter((t) => t === 'web-results').length, 1);
  assertEquals(types.slice(-3), ['web-results', 'tool-call', 'finish']);
  const live = progressOf(events).flatMap((e) => e.pages);
  assertEquals(live, webResults(events)[0].pages, 'the live pages are exactly the final list, in order');
  assertEquals(live.length, 15);
  assertEquals(finishOf(events).usage!.web_search_requests, 4, 'the stream reports the provider count as given');
});

Deno.test('web-progress carries only pages new to the call, by normalised URL, from delta or message', async () => {
  const a = { type: 'url_citation', url_citation: { url: 'https://www.rbi.org.in/a', title: 'A', content: 'a' } };
  const aAgain = { type: 'url_citation', url_citation: { url: 'https://WWW.RBI.ORG.IN/a#top', title: 'A again', content: 'a' } };
  const b = { type: 'url_citation', url_citation: { url: 'https://pib.gov.in/b', title: 'B', content: 'b' } };
  const events = await collect(streamChat(rawDeps([
    chunk({ annotations: [a] }),
    chunk({ annotations: [aAgain] }),
    { ...chunk({}), choices: [{ index: 0, delta: {}, message: { annotations: [aAgain, b] }, finish_reason: null }] },
    finished('stop'),
  ]), { model: 'fake', messages: [] }));
  assertEquals(progressOf(events).map((e) => e.pages.map((p) => p.url)), [['https://www.rbi.org.in/a'], ['https://pib.gov.in/b']]);
  assertEquals(webResults(events)[0].pages.map((p) => p.url), ['https://www.rbi.org.in/a', 'https://pib.gov.in/b']);
});

for (const done of [false, true]) {
  Deno.test(`Probe 3 cut off before its finish (${done ? '[DONE]' : 'EOF'}): pages were shown live, but no web-results is yielded`, async () => {
    const events = await expectFailure(probe3Payloads(probe3(), false), done);
    assertEquals(bursts(events), [5, 5, 5]);
    assertEquals(events.some((e) => e.type === 'web-results'), false, 'a call that breaks off contributes nothing');
  });
}

// chat-turn-cost amendment 1: OpenRouter provider routing, measured before it is wired in.
Deno.test('providerSort sets provider.sort, alongside require_parameters; unset, the body has no sort', () => {
  const base = { model: 'google/gemini-3.8-flash', messages: [{ role: 'user' as const, content: 'q' }] };
  assertEquals(buildRequestBody({ ...base, providerSort: 'throughput' }).provider, { sort: 'throughput' });
  assertEquals(buildRequestBody({ ...base, providerSort: 'latency', response_format: { type: 'json_object' } }).provider, { require_parameters: true, sort: 'latency' });
  assertEquals(buildRequestBody(base).provider, undefined);
});

Deno.test('required server-tool selection survives the wire body without unrelated function tools', () => {
  const serverTools = [{ type: 'openrouter:web_search' }];
  const body = buildRequestBody({ model: 'google/gemini-2.5-flash-lite', messages: [], tools: [], serverTools, tool_choice: 'required' });
  assertEquals(body.tools, serverTools);
  assertEquals(body.tool_choice, 'required');
});
