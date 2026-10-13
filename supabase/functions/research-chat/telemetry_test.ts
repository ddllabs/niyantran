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
    steps: [{ step: 1, name: 'search_documents', toolCallId: 't1', scoped: true, input: { query: 'q' }, resultCount: 3, topSimilarity: 0.71, latencyMs: 10, chunkIds: ['a'], rowKeys: [], status: 'ok' }],
    answer: { latencyMs: 20, aborted: false },
  }));
  await recorder.flush();

  const written = traces[0];
  const answer = written.find((r) => r.step_type === 'answer')!;
  const tool = written.find((r) => r.step_type === 'search_documents')!;
  assertEquals(answer.model_call_log_id, 'call-2');
  // A tool step is a database query and buys no provider call of its own.
  assertEquals(tool.model_call_log_id, null);
  // …but its retrieval quality is carried: top_similarity was null on every row
  // ever written, because turnTraceRows hard-coded it while the search had the
  // number in hand.
  assertEquals(tool.top_similarity, 0.71);
  const cancelled = turnTraceRows({userId:'u',conversationId:'c',messageId:'m',steps:[{
    step:2,name:'search_documents',toolCallId:'t2',scoped:false,input:{query:'q'},
    resultCount:0,topSimilarity:null,latencyMs:10,chunkIds:[],rowKeys:[],status:'cancelled',
  }]});
  assertEquals(cancelled[0].aborted,true);
  assertEquals(cancelled[0].error_message,null);
});

// ---- web search (docs/specs/2026-10-13-web-search.md section 5) ----

const baseAttempt = { userId: 'u', conversationId: 'c', purpose: 'chat_answer', requested: 'm', status: 'success', latencyMs: 5 } as const;

Deno.test('a model call row records the searches and what they cost, and leaves cost_usd alone', () => {
  const row = modelCallRow({
    ...baseAttempt,
    usage: usage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0522, upstream_inference_cost: 0.0382, web_search_requests: 2 }),
  });
  assertEquals(row.web_search_count, 2);
  assertEquals(row.web_search_cost_usd, 0.014);
  assertEquals(row.cost_usd, 0.0522);
});

Deno.test('a search without a cost split is priced at the list price', () => {
  const row = modelCallRow({ ...baseAttempt, usage: usage({ cost: 0.0001, web_search_requests: 3 }) });
  assertEquals([row.web_search_count, row.web_search_cost_usd, row.cost_usd], [3, 0.021, 0.0001]);
});

Deno.test('a call that did not search has a zero count and no search cost', () => {
  for (const u of [null, usage({ cost: 0.01 }), usage({ cost: 0.01, web_search_requests: 0 })]) {
    const row = modelCallRow({ ...baseAttempt, usage: u });
    assertEquals([row.web_search_count, row.web_search_cost_usd], [0, null]);
  }
  assertEquals(modelCallRow({ ...baseAttempt, usage: usage({ cost: 0.01 }) }).cost_usd, 0.01);
});

Deno.test('a bad search count is no search: negative, NaN and infinite counts never reach the row', () => {
  for (const bad of [-1, NaN, Infinity]) {
    const row = modelCallRow({ ...baseAttempt, usage: usage({ web_search_requests: bad }) });
    assertEquals([row.web_search_count, row.web_search_cost_usd], [0, null]);
  }
});

const webStep = (over: Partial<{ attemptIndex: number; searches: number; pagesAdded: number; latencyMs: number }> = {}) => ({
  attemptIndex: 0,
  searches: 1,
  pagesAdded: 5,
  latencyMs: 1200,
  ...over,
});
const toolStep = (step: number) => ({
  step,
  name: 'search_documents' as const,
  toolCallId: `t${step}`,
  scoped: true,
  input: { query: 'q' },
  resultCount: 3,
  topSimilarity: 0.5,
  latencyMs: 10,
  chunkIds: ['a'],
  rowKeys: [],
  status: 'ok' as const,
});

Deno.test('turnTraceRows is unchanged when no web steps are given', () => {
  const args = { userId: 'u', conversationId: 'c', messageId: 'm', steps: [toolStep(1)], answer: { latencyMs: 20, aborted: false } };
  assertEquals(turnTraceRows(args), turnTraceRows({ ...args, web: [] }));
  assertEquals(turnTraceRows(args).map((r) => r.step_type), ['search_documents', 'answer']);
  assertEquals(turnTraceRows(args).some((r) => 'attempt_index' in r), false);
});

Deno.test('turnTraceRows writes one web_search row per web step, between the tool steps and the answer', () => {
  const rows = turnTraceRows({
    userId: 'u',
    conversationId: 'c',
    messageId: 'm',
    steps: [toolStep(1), toolStep(2)],
    web: [webStep({ attemptIndex: 0, pagesAdded: 5, latencyMs: 1200.4 }), webStep({ attemptIndex: 2, pagesAdded: 0, latencyMs: 800 })],
    answer: { latencyMs: 20, aborted: false },
  });
  assertEquals(rows.map((r) => [r.step_index, r.step_type]), [
    [1, 'search_documents'],
    [2, 'search_documents'],
    [3, 'web_search'],
    [4, 'web_search'],
    [5, 'answer'],
  ]);
  const [a, b] = rows.filter((r) => r.step_type === 'web_search');
  assertEquals([a.result_count, a.latency_ms, a.input, a.model_call_log_id, a.aborted, a.error_message], [5, 1200, null, null, false, null]);
  assertEquals([b.result_count, b.latency_ms], [0, 800]);
  assertEquals([a.user_id, a.conversation_id, a.message_id, a.top_similarity, a.chunk_ids, a.row_keys], ['u', 'c', 'm', null, null, null]);
});

Deno.test('web trace rows link to the model_call_logs row of their attempt, and the link never reaches the database', async () => {
  const written: TurnTraceRow[][] = [];
  const calls: ReturnType<typeof modelCallRow>[] = [];
  const recorder = createAttemptRecorder({
    userId: 'u',
    conversationId: 'c',
    messageId: 'm',
    pricing: () => Promise.resolve(null),
    db: {
      logModelCall: (row) => {
        calls.push(row);
        return Promise.resolve(`call-${calls.length}`);
      },
      logTurnTraces: (rows) => {
        written.push(rows);
        return Promise.resolve();
      },
    },
  });
  const run = async (model: string, u: Usage | null) => {
    const wrapped = recorder.wrap(async function* () {
      yield { type: 'finish', reason: 'stop', served: model, generationId: null, usage: u };
    }, 'chat_answer');
    for await (const _e of wrapped({ model, messages: [] })) { /* consume */ }
  };
  await run('research-1', usage({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.02, upstream_inference_cost: 0.013, web_search_requests: 1 }));
  await run('research-2', usage({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.03, upstream_inference_cost: 0.016, web_search_requests: 2 }));
  await run('answer', usage({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.01 }));

  recorder.addTraces(turnTraceRows({
    userId: 'u',
    conversationId: 'c',
    messageId: 'm',
    steps: [],
    web: [webStep({ attemptIndex: 0 }), webStep({ attemptIndex: 1, pagesAdded: 3 })],
    answer: { latencyMs: 20, aborted: false },
  }));
  await recorder.flush();

  assertEquals(calls.map((c) => [c.web_search_count, c.web_search_cost_usd, c.cost_usd]), [[1, 0.007, 0.02], [2, 0.014, 0.03], [0, null, 0.01]]);
  const web = written[0].filter((r) => r.step_type === 'web_search');
  assertEquals(web.map((r) => r.model_call_log_id), ['call-1', 'call-2']);
  assertEquals(written[0].find((r) => r.step_type === 'answer')!.model_call_log_id, 'call-3');
  assertEquals(written[0].some((r) => 'attempt_index' in r), false);
});

Deno.test('a web step whose attempt does not exist is written unlinked rather than mislinked', async () => {
  const written: TurnTraceRow[][] = [];
  const recorder = createAttemptRecorder({
    userId: 'u',
    conversationId: 'c',
    messageId: 'm',
    pricing: () => Promise.resolve(null),
    db: { logModelCall: () => Promise.resolve('call-1'), logTurnTraces: (rows) => (written.push(rows), Promise.resolve()) },
  });
  const wrapped = recorder.wrap(async function* () {
    yield { type: 'finish', reason: 'stop', served: 'x', generationId: null, usage: null };
  }, 'chat_answer');
  for await (const _e of wrapped({ model: 'm', messages: [] })) { /* consume */ }
  recorder.addTraces(turnTraceRows({ userId: 'u', conversationId: 'c', messageId: 'm', steps: [], web: [webStep({ attemptIndex: 7 }), webStep({ attemptIndex: -1 })] }));
  await recorder.flush();
  assertEquals(written[0].map((r) => r.model_call_log_id), [null, null]);
});

Deno.test('lastAttemptIndex names the most recent attempt of a purpose, for the caller to link a web step', async () => {
  const recorder = createAttemptRecorder({
    userId: 'u',
    conversationId: 'c',
    messageId: 'm',
    pricing: () => Promise.resolve(null),
    db: { logModelCall: () => Promise.resolve('id'), logTurnTraces: () => Promise.resolve() },
  });
  assertEquals(recorder.lastAttemptIndex('chat_answer'), -1);
  const wrapped = recorder.wrap(async function* () {
    yield { type: 'finish', reason: 'stop', served: 'x', generationId: null, usage: null };
  }, 'chat_answer');
  recorder.beginEmbeddingAttempt('embed');
  for await (const _e of wrapped({ model: 'a', messages: [] })) { /* consume */ }
  recorder.beginEmbeddingAttempt('embed');
  for await (const _e of wrapped({ model: 'b', messages: [] })) { /* consume */ }
  assertEquals(recorder.lastAttemptIndex('chat_answer'), 3);
  assertEquals(recorder.lastAttemptIndex('embedding'), 2);
  assertEquals(recorder.lastAttemptIndex('citation_repair'), -1);
});

Deno.test('the turn summary totals searches and their cost; a turn with none reports zero', async () => {
  const make = () =>
    createAttemptRecorder({
      userId: 'u',
      conversationId: 'c',
      messageId: 'm',
      pricing: () => Promise.resolve(null),
      db: { logModelCall: () => Promise.resolve('id'), logTurnTraces: () => Promise.resolve() },
    });
  const run = async (recorder: ReturnType<typeof make>, u: Usage | null) => {
    const wrapped = recorder.wrap(async function* () {
      yield { type: 'finish', reason: 'stop', served: 'x', generationId: null, usage: u };
    }, 'chat_answer');
    for await (const _e of wrapped({ model: 'm', messages: [] })) { /* consume */ }
  };
  const none = make();
  await run(none, usage({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.01 }));
  assertEquals([none.summary()?.web_searches, none.summary()?.web_search_cost_usd], [0, 0]);

  const some = make();
  await run(some, usage({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.02, upstream_inference_cost: 0.013, web_search_requests: 1 }));
  await run(some, usage({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.03, web_search_requests: 2 }));
  await run(some, null);
  assertEquals([some.summary()?.web_searches, some.summary()?.web_search_cost_usd], [3, 0.021]);
  assertEquals(some.summary()?.cost_usd, null, 'cost_usd keeps its all-or-nothing rule');
});

Deno.test('summary rounds the summed search cost to six places', async () => {
  const recorder = createAttemptRecorder({
    userId: 'u',
    conversationId: 'c',
    messageId: 'm',
    pricing: () => Promise.resolve(null),
    db: { logModelCall: () => Promise.resolve('id'), logTurnTraces: () => Promise.resolve() },
  });
  for (const n of [1, 1, 1]) {
    const wrapped = recorder.wrap(async function* () {
      yield { type: 'finish', reason: 'stop', served: 'x', generationId: null, usage: usage({ cost: 0.1, upstream_inference_cost: 0.0929999, web_search_requests: n }) };
    }, 'chat_answer');
    for await (const _e of wrapped({ model: 'm', messages: [] })) { /* consume */ }
  }
  const total = recorder.summary()!.web_search_cost_usd as number;
  assertEquals(total, Math.round(total * 1e6) / 1e6);
  assertEquals(total, 0.021);
});
