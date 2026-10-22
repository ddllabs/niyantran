import { FakeTime } from 'jsr:@std/testing@1.0.21/time';
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import {
  type ClaimedTurn,
  executeClaimedTurn,
  fingerprintRequest,
  rpcTurnStore,
  type TerminalResult,
  type TurnStore,
} from './persistence.ts';

const request = { message: 'Question', turn_key: 'one', focus: 'broad' as const, attachments: [] };
const result: TerminalResult = {
  content: 'Answer',
  status: 'complete',
  sources: [],
  follow_ups: [],
  activity: [],
  model_served: 'model',
  error_message: null,
  usage: null,
  timing: null,
};
const claim = (): ClaimedTurn => ({
  kind: 'claimed',
  conversation: { id: 'conversation', title: 'Question' },
  user_message_id: 'user-message',
  execution_token: 'private-token',
  server_now: '2026-01-01T00:00:00.000Z',
  assistant: { ...result, id: 'assistant', status: 'running', execution_expires_at: '2026-01-01T00:02:00.000Z' },
});

Deno.test('fingerprint is canonical, includes intent, and omits resolved defaults and transport identities', async () => {
  const hash = await fingerprintRequest(request);
  assertEquals(hash, await fingerprintRequest({ ...request, turn_key: 'another', conversation_id: 'different' }));
  assertEquals(
    hash,
    await fingerprintRequest({ attachments: [], focus: 'broad', turn_key: 'one', message: 'Question' }),
  );
  for (
    const extra of [
      { message: 'changed' },
      { model: 'explicit' },
      { reasoning: 'high' as const },
      { focus: 'desk' as const },
      { attachments: [{ kind: 'file' as const, title: 'a', text: 'text' }] },
      { desk_context: { tier: 'national' } },
      { selection: { tier: 'national', feature: 'Bills', row: { title: 'A' } } },
    ]
  ) {
    assert(hash !== await fingerprintRequest({ ...request, ...extra }));
  }
});

Deno.test('RPC store uses verified owner and never hides transport failures as missing claims', async () => {
  const seen: unknown[] = [];
  const store = rpcTurnStore({
    rpc: (name, args) => {
      seen.push([name, args]);
      return Promise.resolve({ data: { kind: 'missing' }, error: null });
    },
  });
  await store.lookup({ ownerId: 'verified', turnKey: 'one', requestHash: 'hash' });
  assertEquals(seen, [['lookup_research_turn', {
    p_user_id: 'verified',
    p_turn_key: 'one',
    p_request_hash: 'hash',
    p_conversation_id: null,
  }]]);
  const unavailable = rpcTurnStore({
    rpc: () => Promise.resolve({ error: { code: 'XX000', message: 'sensitive database detail' } }),
  });
  await assertRejects(
    () => unavailable.lookup({ ownerId: 'verified', turnKey: 'one', requestHash: 'hash' }),
    Error,
    'Turn persistence unavailable',
  );
});

Deno.test('execution persists errors and partial checkpoints, then returns the database result', async () => {
  const saved: TerminalResult[] = [];
  const store = {
    finalize: (_owner, _key, _token, value) => {
      saved.push(value);
      return Promise.resolve({ ...claim(), kind: 'terminal', assistant: { ...claim().assistant, ...value } });
    },
  } satisfies Pick<TurnStore, 'finalize'>;
  const terminal = await executeClaimedTurn({
    store,
    ownerId: 'owner',
    turnKey: 'one',
    claim: claim(),
    execute: async ({ checkpoint }) => {
      checkpoint({ content: 'Visible partial' });
      throw new Error('secret provider details');
    },
  });
  assertEquals(saved.length, 1);
  assertEquals(saved[0].status, 'error');
  assertEquals(saved[0].content, 'Visible partial');
  assertEquals(saved[0].error_message, 'The turn failed. Please try a new turn.');
  assertEquals(terminal.kind, 'terminal');
});

Deno.test('deadline aborts an uncooperative executor and a late result cannot finalize twice', async () => {
  const c = claim();
  c.assistant.execution_expires_at = '2026-01-01T00:00:05.010Z';
  let finish!: (value: TerminalResult) => void;
  let signal: AbortSignal | undefined;
  const writes: TerminalResult[] = [];
  const store = {
    finalize: (_owner, _key, _token, value) => {
      writes.push(value);
      return Promise.resolve({ ...claim(), kind: 'terminal', assistant: { ...claim().assistant, ...value } });
    },
  } satisfies Pick<TurnStore, 'finalize'>;
  const pending = executeClaimedTurn({
    store,
    ownerId: 'owner',
    turnKey: 'one',
    claim: c,
    execute: (ctx) => {
      signal = ctx.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  await pending;
  assertEquals(writes[0].status, 'interrupted');
  assert(signal?.aborted);
  finish(result);
  await Promise.resolve();
  assertEquals(writes.length, 1);
});

Deno.test('expired claim never starts its executor, even before its local timer fires', async () => {
  const c = claim();
  c.assistant.execution_expires_at = c.server_now;
  let calls = 0;
  const values: TerminalResult[] = [];
  await executeClaimedTurn({
    claim: c,
    ownerId: 'owner',
    turnKey: 'one',
    store: {
      finalize: (_owner, _key, _token, value) => {
        values.push(value);
        return Promise.resolve({ kind: 'deleted' });
      },
    },
    execute: () => {
      calls++;
      return Promise.resolve(result);
    },
  });
  assertEquals(calls, 0);
  assertEquals(values[0].status, 'interrupted');
});
Deno.test('executor success is not treated as durable success when finalization fails', async () => {
  await assertRejects(
    () =>
      executeClaimedTurn({
        claim: claim(),
        ownerId: 'owner',
        turnKey: 'one',
        store: { finalize: () => Promise.reject(new Error('write failed')) },
        execute: () => Promise.resolve(result),
      }),
    Error,
    'write failed',
  );
});
Deno.test('changed nested inputs conflict but object key ordering is immaterial', async () => {
  const a = { ...request, selection: { tier: 'national', feature: 'Bills', row: { z: 'z', a: 'a' } } };
  const b = { ...request, selection: { row: { a: 'a', z: 'z' }, feature: 'Bills', tier: 'national' } };
  assertEquals(await fingerprintRequest(a), await fingerprintRequest(b));
  assert(
    await fingerprintRequest(a) !==
      await fingerprintRequest({ ...b, selection: { ...b.selection, row: { a: 'changed', z: 'z' } } }),
  );
});

Deno.test('RPC latency cannot give a delayed claim a fresh execution lifetime', async () => {
  const c = claim();
  c.remaining_ms = -1;
  let executed = false;
  await executeClaimedTurn({
    claim: c,
    ownerId: 'owner',
    turnKey: 'one',
    store: { finalize: () => Promise.resolve({ kind: 'deleted' }) },
    execute: () => {
      executed = true;
      return Promise.resolve(result);
    },
  });
  assertEquals(executed, false);
});

Deno.test('canonical fingerprint orders Unicode-distinct keys independently of insertion order', async () => {
  const first = {
    ...request,
    selection: { tier: 'national', feature: 'Bills', row: { '\u00e9': 'first', 'e\u0301': 'second' } },
  };
  const reordered = {
    ...request,
    selection: { tier: 'national', feature: 'Bills', row: { 'e\u0301': 'second', '\u00e9': 'first' } },
  };
  assertEquals(await fingerprintRequest(first), await fingerprintRequest(reordered));
});

Deno.test('F242: a new lease allows a streamed answer to complete after the old cutoff', async () => {
  using time = new FakeTime(0);
  const c = claim();
  c.assistant.execution_expires_at = '2026-01-01T00:05:00.000Z';
  const writes: TerminalResult[] = [];
  const pending = executeClaimedTurn({
    claim: c, ownerId: 'owner', turnKey: 'long-answer',
    store: { finalize: (_owner, _key, _token, value) => {
      writes.push(value);
      return Promise.resolve({ kind: 'deleted' });
    } },
    execute: async ({ checkpoint }) => {
      checkpoint({ content: 'Beginning', model_served: 'deepseek' });
      await new Promise((resolve) => setTimeout(resolve, 130_000));
      return { ...result, content: 'Beginning and complete answer', model_served: 'deepseek' };
    },
  });
  await time.tickAsync(130_000);
  await pending;
  assertEquals(writes.length, 1);
  assertEquals(writes[0].status, 'complete');
  assertEquals(writes[0].content, 'Beginning and complete answer');
});

for (const [leaseSeconds, cutoffSeconds] of [[120, 115], [300, 295], [600, 295]]) {
  Deno.test(`F242: lease ${leaseSeconds}s stops at ${cutoffSeconds}s and finalizes partial output once`, async () => {
    using time = new FakeTime(0);
    const c = claim();
    c.assistant.execution_expires_at = new Date(Date.parse(c.server_now) + leaseSeconds * 1000).toISOString();
    const writes: TerminalResult[] = [];
    let finish!: (value: TerminalResult) => void;
    let signal!: AbortSignal;
    const pending = executeClaimedTurn({
      claim: c, ownerId: 'owner', turnKey: 'bounded',
      store: { finalize: (_owner, _key, _token, value) => {
        writes.push(value);
        return Promise.resolve({ kind: 'deleted' });
      } },
      execute: (context) => {
        signal = context.signal;
        context.checkpoint({ content: 'Visible partial', model_served: 'deepseek' });
        return new Promise((resolve) => { finish = resolve; });
      },
    });
    await time.tickAsync(cutoffSeconds * 1000 - 1);
    assertEquals(writes.length, 0);
    assertEquals(signal.aborted, false);
    await time.tickAsync(1);
    await pending;
    assertEquals(signal.aborted, true);
    assertEquals(writes.length, 1);
    assertEquals(writes[0].status, 'interrupted');
    assertEquals(writes[0].content, 'Visible partial');
    assertEquals(writes[0].model_served, 'deepseek');
    finish(result);
    await time.runMicrotasks();
    assertEquals(writes.length, 1);
  });
}
