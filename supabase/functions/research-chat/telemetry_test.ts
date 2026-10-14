import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import type { Usage } from '../_shared/openrouterStream.ts';
import {
  costOf,
  createAttemptRecorder,
  LATE_COST_JOB_MS,
  LATE_COST_POLLS_MS,
  modelCallRow,
  recoverLateCosts,
  turnTraceRows,
  type TurnTraceRow,
} from './telemetry.ts';

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
  assertEquals(none.summary()?.web_searches, 0);

  const some = make();
  await run(some, usage({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.02, upstream_inference_cost: 0.013, web_search_requests: 1 }));
  await run(some, usage({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.03, web_search_requests: 2 }));
  await run(some, null);
  assertEquals(some.summary()?.web_searches, 3);
  assertEquals(costKeys(some.summary()), [], 'the saved summary carries no dollars (AI credits spec §7)');
});

/** Every cost key at any depth: what AI credits spec §7 keeps out of chat_messages.usage. */
function costKeys(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [
    ...(['cost_usd', 'web_search_cost_usd', 'cost_usd_from'].includes(key) ? [`${path}${key}`] : []),
    ...costKeys(item, `${path}${key}.`),
  ]);
}

function recorderWith(options: Partial<Parameters<typeof createAttemptRecorder>[0]> = {}) {
  const rows: ReturnType<typeof modelCallRow>[] = [];
  const recorder = createAttemptRecorder({
    userId: 'u',
    conversationId: 'c',
    messageId: 'm',
    pricing: () => Promise.resolve(null),
    db: {
      logModelCall: (row) => {
        rows.push(row);
        return Promise.resolve(`id-${rows.length}`);
      },
      logTurnTraces: () => Promise.resolve(),
    },
    ...options,
  });
  return { recorder, rows };
}

/** A call that streams, has its generation id, and is cut off by `stop` before the provider reports usage. */
async function cutOff(recorder: ReturnType<typeof createAttemptRecorder>, generationId: string | null) {
  const stop = new AbortController();
  const wrapped = recorder.wrap(async function* (req) {
    req.onAttemptMetadata?.({ served: 'google/gemini-3.5-flash-lite', generationId, usage: null });
    yield { type: 'text', text: 'Partly' };
    stop.abort();
    yield { type: 'text', text: ' written' };
  }, 'chat_answer');
  try {
    for await (const _e of wrapped({ model: 'm', messages: [], signal: stop.signal })) { /* consume */ }
  } catch { /* aborted */ }
}

async function logged<T>(run: () => Promise<T>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines;
}

Deno.test('credits: the saved summary carries no dollars at any depth, complete or partial', async () => {
  const { recorder } = recorderWith();
  const run = async (u: Usage | null) => {
    const wrapped = recorder.wrap(async function* () {
      yield { type: 'finish', reason: 'stop', served: 'x', generationId: null, usage: u };
    }, 'chat_answer');
    for await (const _e of wrapped({ model: 'm', messages: [] })) { /* consume */ }
  };
  await run(usage({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, cost: 0.02, web_search_requests: 1 }));
  assertEquals(costKeys(recorder.summary()), []);
  assertEquals(recorder.summary()?.prompt_tokens, 3, 'the token totals stay');
  // A partial turn, whose `observed` block used to carry cost_usd and cost_usd_from.
  await run(usage({ prompt_tokens: 1, completion_tokens: null, total_tokens: 1, cost: 0.01 }));
  await run(null);
  const summary = recorder.summary() as Record<string, unknown>;
  assertEquals(costKeys(summary), []);
  assertEquals((summary.observed as Record<string, number>).attempts_silent, 1, 'the observed block stays');
});

/** A fake clock and sleep: each sleep advances the clock at once, and is recorded. */
function fakeTime(start = 100_000) {
  let clock = start;
  const slept: number[] = [];
  return {
    now: () => clock,
    sleep: (ms: number, signal: AbortSignal) => {
      signal.throwIfAborted();
      slept.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    slept,
  };
}

Deno.test('credits: the flush never looks a cost up; the cut-off round is left for the background job', async () => {
  const { recorder, rows } = recorderWith();
  await cutOff(recorder, 'gen-cut');
  const lines = await logged(() => recorder.flush());
  assertEquals(rows[0].status, 'aborted');
  assertEquals(rows[0].cost_usd, null);
  const late = recorder.lateCosts();
  assertEquals(late.map((l) => [l.id, l.generationId, l.rawUsage]), [['id-1', 'gen-cut', null]]);
  assert(Number.isFinite(late[0].abortedAt));
  assertEquals(lines.some((l) => l.includes('aborted_cost_unknown')), false, 'not unknown yet: the job may still find it');
});

Deno.test('credits: only an aborted round with a generation id, a saved row and no cost is left for the job', async () => {
  const { recorder, rows } = recorderWith();
  const wrapped = recorder.wrap(async function* () {
    yield { type: 'finish', reason: 'stop', served: 'x', generationId: 'gen-done', usage: usage({ cost: 0.01 }) };
  }, 'chat_answer');
  for await (const _e of wrapped({ model: 'm', messages: [] })) { /* consume */ }
  await cutOff(recorder, null);
  const lines = await logged(() => recorder.flush());
  assertEquals(rows.map((r) => [r.status, r.cost_usd]), [['success', 0.01], ['aborted', null]]);
  assertEquals(recorder.lateCosts(), []);
  assertEquals(lines.filter((l) => l.includes('research_chat.aborted_cost_unknown')).length, 1, 'no id: unknown at once');

  // A row whose insert failed has no id to update.
  const failed = createAttemptRecorder({
    userId: 'u',
    conversationId: 'c',
    messageId: 'm',
    pricing: () => Promise.resolve(null),
    db: { logModelCall: () => Promise.resolve(null), logTurnTraces: () => Promise.resolve() },
  });
  await cutOff(failed, 'gen-x');
  await logged(() => failed.flush());
  assertEquals(failed.lateCosts(), []);
});

Deno.test('credits: a success row with no cost is logged as a warning, with no ids or amounts', async () => {
  const { recorder } = recorderWith();
  for (const u of [usage({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }), usage({ cost: 0.01 })]) {
    const wrapped = recorder.wrap(async function* () {
      yield { type: 'finish', reason: 'stop', served: 'x', generationId: 'gen', usage: u };
    }, 'chat_answer');
    for await (const _e of wrapped({ model: 'm', messages: [] })) { /* consume */ }
  }
  const lines = (await logged(() => recorder.flush())).filter((l) => l.includes('research_chat.success_without_cost'));
  assertEquals(lines.length, 1);
  assertEquals(Object.keys(JSON.parse(lines[0])).sort(), ['event', 't']);
});

Deno.test('credits: the background job polls 8-25 s after the abort and saves the cost from the 3rd poll', async () => {
  const time = fakeTime();
  const asked: string[] = [];
  const answers: (number | null)[] = [null, null, 0.0004];
  const saved: unknown[][] = [];
  await recoverLateCosts([{ id: 'row-1', generationId: 'gen-cut', abortedAt: time.now() - 2_000, rawUsage: { prompt_tokens: 3 } }], {
    lookup: (id) => {
      asked.push(id);
      return Promise.resolve(answers.shift() ?? null);
    },
    save: (...args) => {
      saved.push(args);
      return Promise.resolve();
    },
    now: time.now,
    sleep: time.sleep,
  });
  assertEquals(asked, ['gen-cut', 'gen-cut', 'gen-cut']);
  assertEquals(time.slept, [6_000, 4_000, 4_000], 'at 8, 12 and 16 s after the abort');
  assertEquals(saved, [['row-1', 0.0004, { prompt_tokens: 3, cost_source: 'generation' }]]);
  assertEquals(LATE_COST_POLLS_MS, [8_000, 12_000, 16_000, 20_000, 25_000]);
});

Deno.test('credits: a cost that never comes is logged unknown once per row, and the job never throws', async () => {
  for (const lookup of [() => Promise.resolve(null), () => Promise.reject(new Error('down')), () => Promise.resolve(-1)]) {
    const time = fakeTime();
    let asked = 0;
    const lines = await logged(() =>
      recoverLateCosts([{ id: 'row-1', generationId: 'gen', abortedAt: time.now(), rawUsage: null }], {
        lookup: () => {
          asked++;
          return lookup();
        },
        save: () => Promise.reject(new Error('never called')),
        now: time.now,
        sleep: time.sleep,
      })
    );
    assertEquals(asked, 5, 'every poll is tried');
    assertEquals(lines.filter((l) => l.includes('research_chat.aborted_cost_unknown')).length, 1);
  }
  // A save that fails is logged, never thrown.
  const time = fakeTime();
  const lines = await logged(() =>
    recoverLateCosts([{ id: 'row-1', generationId: 'gen', abortedAt: time.now(), rawUsage: null }], {
      lookup: () => Promise.resolve(0.001),
      save: () => Promise.reject(new Error('update failed')),
      now: time.now,
      sleep: time.sleep,
    })
  );
  assert(lines.some((l) => l.includes('late_cost')));
});

Deno.test('credits: the whole job stops at its deadline, however the lookups behave', async () => {
  const started = Date.now();
  const lines = await logged(() =>
    recoverLateCosts([{ id: 'row-1', generationId: 'gen', abortedAt: Date.now(), rawUsage: null }], {
      lookup: () => new Promise(() => {}),
      save: () => Promise.resolve(),
      polls: [1, 2],
      budgetMs: 40,
    })
  );
  assert(Date.now() - started < 500);
  assertEquals(lines.filter((l) => l.includes('research_chat.aborted_cost_unknown')).length, 1);
  assertEquals(LATE_COST_JOB_MS, 30_000);
});

// ---- P3: the turn's requested reasoning effort on every row ----

Deno.test('a model call row carries the requested reasoning effort, null when none is given', () => {
  assertEquals(modelCallRow({ ...baseAttempt, reasoningEffort: 'high' }).reasoning_effort, 'high');
  assertEquals(modelCallRow({ ...baseAttempt }).reasoning_effort, null);
});

Deno.test('the recorder writes the turn\'s reasoning effort on answer and embedding rows alike', async () => {
  const rows: ReturnType<typeof modelCallRow>[] = [];
  const recorder = createAttemptRecorder({
    userId: 'u',
    conversationId: 'c',
    messageId: 'm',
    reasoningEffort: 'medium',
    pricing: () => Promise.resolve(null),
    db: {
      logModelCall: (row) => {
        rows.push(row);
        return Promise.resolve('id');
      },
      logTurnTraces: () => Promise.resolve(),
    },
  });
  for await (
    const _event of recorder.wrap(async function* () {
      yield { type: 'finish', reason: 'stop', served: 'm', generationId: null, usage: null };
    }, 'chat_answer')({ model: 'm', messages: [] })
  ) { /* consume */ }
  recorder.beginEmbeddingAttempt('e').finish('success');
  await recorder.flush();
  assert(rows.length >= 2);
  assertEquals(rows.map((r) => r.reasoning_effort), rows.map(() => 'medium'));
});
