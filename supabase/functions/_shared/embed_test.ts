import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { EMBED_DIMS, EMBED_MODEL, EMBED_PRICE_USD_PER_TOKEN, EmbeddingError, EmbedNetworkError, embedOutageClass, embedTexts, markNetworkErrors, planBatches } from './embed.ts';

type Reply = { status: number; body: unknown };

/** A fetch that answers each call from a scripted queue and records the request bodies. */
function scripted(replies: Reply[]) {
  const bodies: { model: string; input: string[]; encoding_format: string }[] = [];
  const headers: Record<string, string>[] = [];
  const fetchFn = ((_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    headers.push(init.headers as Record<string, string>);
    const r = replies.shift() ?? { status: 500, body: { error: { message: 'script exhausted' } } };
    return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status }));
  }) as unknown as typeof fetch;
  return { fetchFn, bodies, headers };
}

function ok(inputs: string[], opts: { width?: number; model?: string; tokens?: number; shuffle?: boolean } = {}) {
  const width = opts.width ?? EMBED_DIMS;
  const data = inputs.map((_, index) => ({ index, embedding: Array.from({ length: width }, () => index + 0.5) }));
  if (opts.shuffle) data.reverse();
  return { status: 200, body: { data, model: opts.model ?? EMBED_MODEL, usage: { prompt_tokens: opts.tokens ?? 10, total_tokens: opts.tokens ?? 10 } } };
}

const noSleep = () => Promise.resolve();

Deno.test('planBatches bounds by count and by estimated tokens', () => {
  const many = Array.from({ length: 300 }, (_, i) => `t${i}`);
  assertEquals(planBatches(many).map((b) => b.length), [96, 96, 96, 12]);
  const huge = ['a'.repeat(800_000), 'b'.repeat(800_000)];
  assertEquals(planBatches(huge).map((b) => b.length), [1, 1]);
  assertEquals(planBatches([]), []);
});

Deno.test('a 1535-wide vector is refused by name before any vector is returned', async () => {
  const { fetchFn } = scripted([ok(['x'], { width: 1535 })]);
  const err = await assertRejects(() => embedTexts({ fetch: fetchFn, apiKey: 'k', sleep: noSleep }, ['x']), EmbeddingError);
  assert(err.message.includes('1535'), err.message);
});

Deno.test('a different served model is refused by name; the unprefixed echo of the same model is accepted', async () => {
  const { fetchFn } = scripted([ok(['x'], { model: 'openai/text-embedding-ada-002' })]);
  const err = await assertRejects(() => embedTexts({ fetch: fetchFn, apiKey: 'k', sleep: noSleep }, ['x']), EmbeddingError);
  assert(err.message.includes('text-embedding-ada-002'), err.message);

  const bare = scripted([ok(['x'], { model: 'text-embedding-3-small' })]);
  const r = await embedTexts({ fetch: bare.fetchFn, apiKey: 'k', sleep: noSleep }, ['x']);
  assertEquals(r.vectors.length, 1);
  assertEquals(r.model, EMBED_MODEL);

  const large = scripted([ok(['x'], { model: 'text-embedding-3-large' })]);
  await assertRejects(() => embedTexts({ fetch: large.fetchFn, apiKey: 'k', sleep: noSleep }, ['x']), EmbeddingError);
});

Deno.test('429 then 200 succeeds with two requests; a 400 is not retried', async () => {
  const s = scripted([{ status: 429, body: { error: { message: 'slow down' } } }, ok(['x'])]);
  const r = await embedTexts({ fetch: s.fetchFn, apiKey: 'k', sleep: noSleep }, ['x']);
  assertEquals(r.requests, 1);
  assertEquals(s.bodies.length, 2);
  assertEquals(s.bodies[0], { model: EMBED_MODEL, input: ['x'], encoding_format: 'float' });
  assertEquals(s.headers[0].authorization, 'Bearer k');

  const bad = scripted([{ status: 400, body: { error: { message: 'bad input' } } }, ok(['x'])]);
  const err = await assertRejects(() => embedTexts({ fetch: bad.fetchFn, apiKey: 'k', sleep: noSleep }, ['x']), EmbeddingError);
  assertEquals(err.status, 400);
  assertEquals(bad.bodies.length, 1);
});

Deno.test('cost follows reported prompt tokens; a later failure keeps the cost already spent', async () => {
  const one = scripted([ok(['x'], { tokens: 1234 })]);
  const r = await embedTexts({ fetch: one.fetchFn, apiKey: 'k', sleep: noSleep }, ['x']);
  assertEquals(r.promptTokens, 1234);
  assertEquals(r.costUsd, 1234 * EMBED_PRICE_USD_PER_TOKEN);

  const two = scripted([ok(['a'], { tokens: 100 }), { status: 500, body: {} }, { status: 500, body: {} }, { status: 500, body: {} }]);
  const err = await assertRejects(
    () => embedTexts({ fetch: two.fetchFn, apiKey: 'k', sleep: noSleep, batch: { maxCount: 1 } }, ['a', 'b']),
    EmbeddingError,
  );
  assertEquals(err.promptTokens, 100);
  assertEquals(err.costUsd, 100 * EMBED_PRICE_USD_PER_TOKEN);
  assertEquals(err.status, 500);
});

Deno.test('vectors are returned in input order even when the provider shuffles them', async () => {
  const inputs = ['a', 'b', 'c'];
  const { fetchFn } = scripted([ok(inputs, { shuffle: true })]);
  const r = await embedTexts({ fetch: fetchFn, apiKey: 'k', sleep: noSleep }, inputs);
  assertEquals(r.vectors.map((v) => v[0]), [0.5, 1.5, 2.5]);
  assertEquals(r.model, EMBED_MODEL);
});

Deno.test('a vector count that does not match the batch is refused; empty input makes no request', async () => {
  const short = scripted([ok(['a'])]);
  await assertRejects(() => embedTexts({ fetch: short.fetchFn, apiKey: 'k', sleep: noSleep }, ['a', 'b']), EmbeddingError);
  const none = scripted([]);
  const r = await embedTexts({ fetch: none.fetchFn, apiKey: 'k', sleep: noSleep }, []);
  assertEquals(r.requests, 0);
  assertEquals(none.bodies.length, 0);
});

Deno.test('embedOutageClass: 429, 5xx and a failed or timed-out request are an outage; anything else is not', () => {
  const spent = { costUsd: 0, promptTokens: 0 };
  const err = (status?: number) => new EmbeddingError('x', spent, status);
  assertEquals(embedOutageClass(err(429)), 'rate_limited');
  assertEquals(embedOutageClass(err(500)), 'server_error');
  assertEquals(embedOutageClass(err(503)), 'server_error');
  assertEquals(embedOutageClass(err(599)), 'server_error');
  assertEquals(embedOutageClass(err(408)), 'server_error', 'a request timeout is transient');
  assertEquals(embedOutageClass(err(409)), null);
  assertEquals(embedOutageClass(new EmbedNetworkError()), 'network');
  // A bare TypeError is a programming error, not a network outage; only a marked fetch rejection is.
  assertEquals(embedOutageClass(new TypeError('Cannot read properties of null')), null);
  assertEquals(embedOutageClass(new DOMException('aborted', 'AbortError')), 'network');
  assertEquals(embedOutageClass(new DOMException('timed out', 'TimeoutError')), 'network');
  // A content or request problem is not an outage, whatever the provider's wording.
  for (const status of [400, 401, 402, 403, 404, 413, 422]) assertEquals(embedOutageClass(err(status)), null, `HTTP ${status}`);
  // A malformed or mismatched 200 reply, and an error with no status, are not an outage either.
  assertEquals(embedOutageClass(err(200)), null);
  assertEquals(embedOutageClass(err()), null);
  assertEquals(embedOutageClass(new Error('boom')), null);
  assertEquals(embedOutageClass('a string'), null);
  assertEquals(embedOutageClass(undefined), null);
});

Deno.test('markNetworkErrors: a fetch that rejects is marked, without its URL; a TypeError while reading a 200 reply is not', async () => {
  const rejecting = (() => Promise.reject(new TypeError('error sending request for url (https://x.test/?key=secret)'))) as unknown as typeof fetch;
  const e = await assertRejects(() => embedTexts({ fetch: markNetworkErrors(rejecting), apiKey: 'k', sleep: noSleep }, ['a']), EmbedNetworkError);
  assertEquals(embedOutageClass(e), 'network');
  assert(!e.message.includes('secret') && !e.message.includes('x.test'));
  // A 200 whose data holds a null item makes the parsing throw a TypeError; the fetch itself did not reject.
  const bad = scripted([{ status: 200, body: { data: [null], model: EMBED_MODEL, usage: {} } }]);
  const t = await assertRejects(() => embedTexts({ fetch: markNetworkErrors(bad.fetchFn), apiKey: 'k', sleep: noSleep }, ['a']));
  assert(t instanceof TypeError, 'the parsing error is a TypeError');
  assertEquals(embedOutageClass(t), null);
});
