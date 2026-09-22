import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import type { Usage } from '../_shared/openrouterStream.ts';
import { costOf, createAttemptRecorder, modelCallRow, turnTraceRows, type TurnTraceRow } from './telemetry.ts';

const usage = (fields: Partial<Usage>): Usage => fields as Usage;
Deno.test('partial prices never imply free unpriced completion usage', () => {
  assertEquals(costOf(usage({ prompt_tokens: 100, completion_tokens: 50 }), { prompt_usd: 0.001 }), {
    cost: null,
    source: 'none',
  });
});
Deno.test('provider finite nonnegative cost takes priority including zero', () => {
  for (const cost of [0, 0.25]) {
    assertEquals(costOf(usage({ cost }), { prompt_usd: 10, completion_usd: 10 }), { cost, source: 'provider' });
  }
  for (const cost of [-1, NaN, Infinity]) assertEquals(costOf(usage({ cost })), { cost: null, source: 'none' });
});
Deno.test('estimates require known counts and every nonzero component price', () => {
  assertEquals(costOf(usage({ prompt_tokens: 100 }), { prompt_usd: 0.001, completion_usd: 0.002 }), {
    cost: null,
    source: 'none',
  });
  assertEquals(costOf(usage({ prompt_tokens: 100, completion_tokens: 0 }), { prompt_usd: 0.001 }), {
    cost: 0.1,
    source: 'pricing',
  });
  assertEquals(
    costOf(usage({ prompt_tokens: 100, completion_tokens: 50 }), { prompt_usd: 0.001, completion_usd: 0.002 }),
    { cost: 0.2, source: 'pricing' },
  );
  for (const price of [-1, NaN, Infinity]) {
    assertEquals(
      costOf(usage({ prompt_tokens: 1, completion_tokens: 1 }), { prompt_usd: price, completion_usd: 0.1 }),
      { cost: null, source: 'none' },
    );
  }
});
Deno.test('model rows preserve unknowns and never infer the actual served provider from requested model', () => {
  const row = modelCallRow({
    userId: 'u',
    conversationId: 'c',
    purpose: 'chat_answer',
    requested: 'vendor/model',
    status: 'error',
    error: 'PRIVATE PROMPT provider body',
    latencyMs: 5,
    usage: usage({ prompt_tokens: 100 }),
  });
  assertEquals(row.model_served, null);
  assertEquals(row.provider, null);
  assertEquals(row.completion_tokens, null);
  assertEquals(row.total_tokens, null);
  assertEquals(row.cost_usd, null);
  assertEquals(row.error_message?.includes('PRIVATE'), false);
});
Deno.test('invalid token accounting is unknown rather than negative or NaN', () => {
  const row = modelCallRow({
    userId: 'u',
    conversationId: 'c',
    purpose: 'chat_answer',
    requested: 'm',
    status: 'success',
    latencyMs: 1,
    usage: usage({ prompt_tokens: -1, completion_tokens: NaN, total_tokens: Infinity }),
  });
  assertEquals([row.prompt_tokens, row.completion_tokens, row.total_tokens], [null, null, null]);
});

Deno.test('planned or already-aborted streams create no provider attempt, and flush cannot duplicate a write', async () => {
  const rows: unknown[] = [];
  const recorder = createAttemptRecorder({
    userId: 'u',
    conversationId: 'c',
    messageId: 'm',
    pricing: () => Promise.resolve(null),
    db: {
      logModelCall: (row) => {
        rows.push(row);
        return Promise.resolve('id');
      },
      logTurnTraces: () => Promise.resolve(),
    },
  });
  let calls = 0;
  const wrapped = recorder.wrap(async function* () {
    calls++;
    yield { type: 'finish', reason: 'stop', served: null, generationId: null, usage: null };
  }, 'chat_answer');
  wrapped({ model: 'unused', messages: [] });
  const abort = new AbortController();
  abort.abort();
  await assertRejects(() => wrapped({ model: 'aborted', messages: [], signal: abort.signal }).next(), DOMException);
  for await (const _event of wrapped({ model: 'actual', messages: [] })) { /* consume */ }
  await Promise.all([recorder.flush(), recorder.flush()]);
  assertEquals(calls, 1);
  assertEquals(rows.length, 1);
  assertEquals(recorder.summary()?.attempts, 1);
});

Deno.test('D6: embedding attempts settle once on abort, preserve known cost and ignore late metadata', async () => {
  const rows: ReturnType<typeof modelCallRow>[] = [];
  const recorder = createAttemptRecorder({
    userId: 'u',
    conversationId: 'c',
    messageId: 'm',
    pricing: () => Promise.resolve(null),
    db: {
      logModelCall: (row) => {
        rows.push(row);
        return Promise.resolve('id');
      },
      logTurnTraces: () => Promise.resolve(),
    },
  });
  const signal = new AbortController();
  const attempt = recorder.beginEmbeddingAttempt('embedding/requested', signal.signal);
  attempt.observe({
    served: 'actual/embedding',
    generationId: 'observed',
    usage: { prompt_tokens: 10, completion_tokens: null, total_tokens: 10, cost: 0.01 },
  });
  signal.abort();
  attempt.finish('success');
  attempt.observe({ served: 'late/wrong', generationId: 'late', usage: null });
  await recorder.flush();
  await recorder.flush();
  assertEquals(rows.length, 1);
  assertEquals(rows[0].purpose, 'embedding');
  assertEquals(rows[0].status, 'aborted');
  assertEquals(rows[0].model_served, 'actual/embedding');
  assertEquals(rows[0].cost_usd, 0.01);
  assertEquals(rows[0].completion_tokens, null);
  assertEquals(recorder.summary()?.attempts, 1);
});


// chat_turn_traces.model_call_log_id had been null for every row since the
// column was added: turnTraceRows was handed a literal null, and flush wrote
// the two tables in one Promise.all, so the trace could not have carried an id
// that the model_call insert had not returned yet.
Deno.test('the answer trace links to the call that wrote the answer, not to a failed attempt', async () => {
  const traces: TurnTraceRow[][] = [];
  let next = 0;
  const recorder = createAttemptRecorder({
    userId: 'u',
    conversationId: 'c',
    messageId: 'm',
    pricing: () => Promise.resolve(null),
    db: {
      logModelCall: () => Promise.resolve(`call-${++next}`),
      logTurnTraces: (rows) => {
        traces.push(rows);
        return Promise.resolve();
      },
    },
  });
  // A failed answer attempt, then the one that succeeded - the ordinary shape
  // of a turn that failed over or was retried for its schema.
  const failing = recorder.wrap(async function* () {
    yield { type: 'finish', reason: 'error', served: null, generationId: null, usage: null };
    throw new Error('provider said no');
  }, 'chat_answer');
  await assertRejects(async () => {
    for await (const _e of failing({ model: 'first', messages: [] })) { /* consume */ }
  });
  const working = recorder.wrap(async function* () {
    yield { type: 'finish', reason: 'stop', served: 'x/y', generationId: null, usage: null };
  }, 'chat_answer');
  for await (const _e of working({ model: 'second', messages: [] })) { /* consume */ }

  recorder.addTraces(turnTraceRows({
    userId: 'u',
    conversationId: 'c',
    messageId: 'm',
    steps: [{ step: 1, name: 'search_documents', toolCallId: 't1', scoped: true, input: { query: 'q' }, resultCount: 3, latencyMs: 10, chunkIds: ['a'], rowKeys: [], status: 'ok' }],
    answer: { latencyMs: 20, aborted: false },
  }));
  await recorder.flush();

  const written = traces[0];
  const answer = written.find((r) => r.step_type === 'answer')!;
  const tool = written.find((r) => r.step_type === 'search_documents')!;
  assertEquals(answer.model_call_log_id, 'call-2');
  // A tool step is a database query and buys no provider call of its own.
  assertEquals(tool.model_call_log_id, null);
});
