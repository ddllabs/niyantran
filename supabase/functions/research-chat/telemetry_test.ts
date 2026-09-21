import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import type { Usage } from '../_shared/openrouterStream.ts';
import { costOf, createAttemptRecorder, modelCallRow } from './telemetry.ts';

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

