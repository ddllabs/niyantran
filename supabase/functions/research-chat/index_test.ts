import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
// Dynamic import makes absence/import side effects an executable regression.
const module = await import(new URL('./index.ts', import.meta.url).href);
const { createDependencies, createResearchHandler } = module;
const request = () =>
  new Request('https://fake.invalid', {
    method: 'POST',
    headers: { authorization: 'Bearer fake.user.jwt' },
    body: JSON.stringify({ message: 'Question', turn_key: 'stable-key', focus: 'broad' }),
  });
function fixture() {
  const calls: {
    side: string;
    table: string;
    filters: unknown[][];
    op: string;
    value?: unknown;
    signal?: AbortSignal;
  }[] = [];
  let reply = (side: string, table: string, _op: string, _value?: unknown): unknown => {
    if (table === 'lookup_research_turn') return { data: { kind: 'missing' }, error: null };
    if (table === 'claim_research_turn') return { data: { kind: 'forbidden' }, error: null };
    if (table === 'ai_models') {
      return { data: [{ model_id: 'test/model', efforts: [], is_default: true, tier: 1 }], error: null };
    }
    if (table === 'user_profiles') return { data: { persona: 'analyst' }, error: null };
    return { data: [], error: null };
  };
  const client = (side: string) =>
    ({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'verified-owner' } }, error: null }) },
      from(table: string) {
        return query(side, table);
      },
      rpc(table: string, args: unknown) {
        return query(side, table, args);
      },
    }) as unknown as SupabaseClient;
  function query(side: string, table: string, value?: unknown) {
    const entry = {
      side,
      table,
      filters: [] as unknown[][],
      op: 'read',
      value,
      signal: undefined as AbortSignal | undefined,
    };
    const q = {
      select(_s?: string) {
        return q;
      },
      eq(...v: unknown[]) {
        entry.filters.push(['eq', ...v]);
        return q;
      },
      neq(...v: unknown[]) {
        entry.filters.push(['neq', ...v]);
        return q;
      },
      in(...v: unknown[]) {
        entry.filters.push(['in', ...v]);
        return q;
      },
      order(...v: unknown[]) {
        entry.filters.push(['order', ...v]);
        return q;
      },
      limit(_n: number) {
        return q;
      },
      maybeSingle() {
        return q;
      },
      single() {
        return q;
      },
      insert(v: unknown) {
        entry.op = 'insert';
        entry.value = v;
        return q;
      },
      delete() {
        entry.op = 'delete';
        return q;
      },
      abortSignal(s: AbortSignal) {
        entry.signal = s;
        return q;
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        calls.push(entry);
        return Promise.resolve(reply(side, table, entry.op, entry.value)).then(resolve, reject);
      },
    };
    return q;
  }
  const caller = client('caller'), service = client('service');
  const sent: RequestInit[] = [];
  const runtime = {
    userClient: (_token: string) => caller,
    serviceClient: () => service,
    env: (_key: string) => 'fake-config',
    fetch: async (_url: unknown, init: RequestInit) => {
      sent.push(init);
      return new Response('{}');
    },
    readPersona: () => Promise.resolve('Persona'),
    timeoutMs: 15,
    sleep: () => Promise.resolve(),
  };
  return {
    calls,
    caller,
    service,
    runtime,
    sent,
    setReply: (fn: typeof reply) => {
      reply = fn;
    },
  };
}
Deno.test('D6: missing/invalid bearer is rejected before service or provider access', async () => {
  const f = fixture();
  const handle = createResearchHandler(f.runtime);
  const response = await handle(new Request('https://fake.invalid', { method: 'POST', body: '{}' }));
  assertEquals(response.status, 401);
  assertEquals(f.calls.length, 0);
  assertEquals(f.sent.length, 0);
});
Deno.test('D6: service claim receives only verified owner and inactive rejection prevents paid work', async () => {
  const f = fixture();
  const response = await createResearchHandler(f.runtime)(request());
  assertEquals(response.status, 403);
  assertEquals(f.sent.length, 0);
  const claim = f.calls.find((c) => c.table === 'claim_research_turn');
  assert(claim);
  assertEquals(claim.side, 'service');
  assertEquals((claim.value as Record<string, unknown>).p_user_id, 'verified-owner');
});
Deno.test('D6: history excludes both reserved IDs using caller RLS and cancellation cleanup matches observed timestamp', async () => {
  const f = fixture();
  f.setReply((_side, table, op) => ({
    data: table === 'chat_cancellations' && op === 'read' ? { cancel_requested_at: '2026-09-21T12:00:01Z' } : [],
    error: null,
  }));
  const d = createDependencies(request(), f.runtime);
  await d.requireUser(request());
  await d.db.recentMessages('conversation', ['reserved-user', 'reserved-assistant']);
  const history = f.calls.find((c) => c.table === 'chat_messages');
  assert(history);
  assertEquals(history.side, 'caller');
  assert(history.filters.some((x) => x[0] === 'neq' && x[2] === 'reserved-user'));
  assert(history.filters.some((x) => x[0] === 'neq' && x[2] === 'reserved-assistant'));
  assertEquals(await d.db.cancelRequestedSince('conversation', '2026-09-21T12:00:00Z'), true);
  await d.db.clearCancellation('conversation');
  const deletion = f.calls.find((c) => c.op === 'delete');
  assert(deletion);
  assertEquals(deletion.side, 'caller');
  assert(
    deletion.filters.some((x) => x[0] === 'eq' && x[1] === 'cancel_requested_at' && x[2] === '2026-09-21T12:00:01Z'),
  );
});
Deno.test('D6: RPC timeouts are bounded, aborted, and never retried with a new key', async () => {
  for (const stage of ['lookup_research_turn', 'claim_research_turn', 'finalize_research_turn']) {
    const f = fixture();
    f.setReply((_side, table) => table === stage ? new Promise(() => {}) : { data: { kind: 'missing' }, error: null });
    const d = createDependencies(request(), f.runtime);
    await d.requireUser(request());
    const identity = { ownerId: 'verified-owner', turnKey: 'unchanged', requestHash: 'a'.repeat(64) };
    const call = stage === 'lookup_research_turn'
      ? () => d.persistence.lookup(identity)
      : stage === 'claim_research_turn'
      ? () => d.persistence.claim({ ...identity, message: 'Q', model: 'test', effort: null })
      : () => d.persistence.finalize('verified-owner', 'unchanged', 'token', {});
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const rejected = await Promise.race([
        call().then(() => false, () => true),
        new Promise<boolean>((resolve) => {
          watchdog = setTimeout(() => resolve(false), 150);
        }),
      ]);
      assert(rejected, 'RPC must reject within its configured bound');
    } finally {
      clearTimeout(watchdog);
    }
    assertEquals(f.calls.filter((c) => c.table === stage).length, 1);
    assert(f.calls.find((c) => c.table === stage)!.signal!.aborted);
  }
});
Deno.test('D6: Auth and model/setup reads time out; foreign explicit owners never reach service RPC', async () => {
  const f = fixture();
  const d = createDependencies(request(), f.runtime);
  await d.requireUser(request());
  await assertRejects(() => d.persistence.lookup({ ownerId: 'foreign', turnKey: 'key', requestHash: 'a'.repeat(64) }));
  assertEquals(f.calls.length, 0);
  f.setReply(() => new Promise(() => {}));
  await assertRejects(() => d.models());
  await assertRejects(() => d.persona('verified-owner'));
  const stalled = fixture();
  stalled.caller.auth.getUser = () => new Promise(() => {});
  const response = await createResearchHandler(stalled.runtime)(request());
  assertEquals(response.status, 503);
  assertEquals(stalled.sent.length, 0);
});
Deno.test('D6: cancellation read/delete failures propagate and a newer Stop is not deleted', async () => {
  const f = fixture();
  let latest = '2026-09-21T12:00:01.123456Z';
  f.setReply((_side, table, op) => ({
    data: table === 'chat_cancellations' && op === 'read' ? { cancel_requested_at: latest } : null,
    error: null,
  }));
  const d = createDependencies(request(), f.runtime);
  await d.requireUser(request());
  await d.db.cancelRequestedSince('c', '2026-09-21T12:00:00Z');
  latest = '2026-09-21T12:00:02Z';
  await d.db.clearCancellation('c');
  const deleted = f.calls.find((c) => c.op === 'delete')!;
  assert(deleted.filters.some((x) => x[1] === 'cancel_requested_at' && x[2] !== latest));
  f.setReply(() => ({ data: null, error: { message: 'PRIVATE DB failure' } }));
  await assertRejects(() => d.db.cancelRequestedSince('c', '2026-09-21T12:00:00Z'));
});
Deno.test('D6: pricing preserves null/invalid values and real zero', async () => {
  const f = fixture();
  const d = createDependencies(request(), f.runtime);
  await d.requireUser(request());
  for (const value of [null, undefined, '', false, -1, 'bad', Infinity]) {
    f.setReply(() => ({ data: { prompt_usd: value, completion_usd: value }, error: null }));
    assertEquals(await d.pricing('model'), { prompt_usd: null, completion_usd: null });
  }
  f.setReply(() => ({ data: { prompt_usd: '0.00001', completion_usd: 0 }, error: null }));
  assertEquals(await d.pricing('model'), { prompt_usd: 0.00001, completion_usd: 0 });
});
function embeddingContext() {
  const controller = new AbortController();
  const attempts: { model: string; observed: unknown[]; status: string[] }[] = [];
  return {
    controller,
    attempts,
    context: {
      signal: controller.signal,
      beginEmbeddingAttempt: (model: string) => {
        const record = { model, observed: [] as unknown[], status: [] as string[] };
        attempts.push(record);
        return {
          observe: (m: unknown) => record.observed.push(m),
          finish: (status: string) => record.status.push(status),
        };
      },
    },
  };
}
const vector = () => ({ model: 'text-embedding-3-small', data: [{ index: 0, embedding: Array(1536).fill(0.1) }] });
Deno.test('D6: every embedding retry is observed and missing usage never uses helper estimates', async () => {
  const f = fixture(), c = embeddingContext();
  let n = 0;
  f.runtime.fetch = async (_url, init) => {
    assert(init.signal);
    return new Response(
      JSON.stringify(
        n++ === 0
          ? { error: { message: 'PRIVATE quota' }, id: 'retry-gen', usage: { prompt_tokens: 3, cost: 0.1 } }
          : vector(),
      ),
      { status: n === 1 ? 429 : 200 },
    );
  };
  const d = createDependencies(request(), f.runtime);
  await d.requireUser(request());
  await d.searchDocuments({ query: 'Question' }, [], c.context);
  assertEquals(c.attempts.length, 2);
  assertEquals(c.attempts.map((a) => a.status), [['error'], ['success']]);
  assertEquals((c.attempts[0].observed.at(-1) as { usage: { cost: number } }).usage.cost, 0.1);
  assertEquals((c.attempts[1].observed.at(-1) as { usage: unknown }).usage, null);
  assertEquals(f.calls.find((x) => x.table === 'match_documents')?.side, 'caller');
});
Deno.test('D6: abort during embedding retry prevents another paid fetch', async () => {
  const f = fixture(), c = embeddingContext();
  let calls = 0;
  f.runtime.fetch = async () => {
    calls++;
    return new Response('{}', { status: 429 });
  };
  f.runtime.sleep = () => {
    c.controller.abort();
    return Promise.resolve();
  };
  const d = createDependencies(request(), f.runtime);
  await d.requireUser(request());
  await assertRejects(() => d.searchDocuments({ query: 'Question' }, [], c.context));
  assertEquals(calls, 1);
  assertEquals(c.attempts.length, 1);
  assertEquals(c.attempts[0].status, ['error']);
});
Deno.test('D6: invalid vectors fail accounting and never reach retrieval RPC', async () => {
  for (
    const bad of [{ ...vector(), data: [{ index: 0, embedding: [1] }] }, {
      ...vector(),
      data: [{ index: 0, embedding: Array(1536).fill('bad') }],
    }, { ...vector(), model: 'wrong-model' }]
  ) {
    const f = fixture(), c = embeddingContext();
    f.runtime.fetch = async () => new Response(JSON.stringify(bad));
    const d = createDependencies(request(), f.runtime);
    await d.requireUser(request());
    await assertRejects(() => d.searchDocuments({ query: 'Question' }, [], c.context));
    assertEquals(c.attempts[0].status, ['error']);
    assertEquals(f.calls.some((x) => x.table === 'match_documents'), false);
  }
});
Deno.test('D6: aborted uncooperative embedding fetch settles and late metadata cannot cause a retry', async () => {
  const f = fixture(), c = embeddingContext();
  let resolve!: (r: Response) => void;
  let started!: () => void;
  const ready = new Promise<void>((r) => started = r);
  let seen: AbortSignal | undefined;
  f.runtime.fetch = async (_u, init) => {
    seen = init.signal as AbortSignal;
    started();
    return await new Promise<Response>((r) => resolve = r);
  };
  const d = createDependencies(request(), f.runtime);
  await d.requireUser(request());
  const pending = d.searchDocuments({ query: 'Question' }, [], c.context);
  await ready;
  c.controller.abort();
  await assertRejects(() => pending);
  assert(seen?.aborted);
  assertEquals(c.attempts[0].status, ['aborted']);
  resolve(new Response(JSON.stringify(vector())));
  await new Promise((r) => setTimeout(r, 5));
  assertEquals(c.attempts[0].status, ['aborted']);
  assertEquals(c.attempts.length, 1);
});
Deno.test('D6: embedding usage strings and invalid counters remain unknown', async () => {
  const f = fixture(), c = embeddingContext();
  f.runtime.fetch = async () =>
    new Response(JSON.stringify({ ...vector(), usage: { prompt_tokens: '10', total_tokens: -1, cost: '0.001' } }));
  const d = createDependencies(request(), f.runtime);
  await d.requireUser(request());
  await d.searchDocuments({ query: 'Q' }, [], c.context);
  assertEquals((c.attempts[0].observed.at(-1) as { usage: unknown }).usage, {
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
  });
});
Deno.test('D6: embedding generation header survives a hung response body', async () => {
  const f = fixture(), c = embeddingContext();
  f.runtime.fetch = async () =>
    new Response(new ReadableStream(), { headers: { 'x-generation-id': 'observed-header' } });
  const d = createDependencies(request(), f.runtime);
  await d.requireUser(request());
  await assertRejects(() => d.searchDocuments({ query: 'Q' }, [], c.context));
  assertEquals((c.attempts[0].observed[0] as { generationId: string }).generationId, 'observed-header');
  assertEquals(c.attempts[0].status, ['error']);
});
Deno.test('D6: already aborted retrieval cannot begin any paid attempt or RPC', async () => {
  const f = fixture(), c = embeddingContext();
  c.controller.abort();
  const d = createDependencies(request(), f.runtime);
  await d.requireUser(request());
  await assertRejects(() => d.searchDocuments({ query: 'Q' }, [], c.context));
  await assertRejects(() => d.searchDeskRows({ tier: 'national' }, c.context));
  assertEquals(c.attempts.length, 0);
  assertEquals(f.sent.length, 0);
  assertEquals(f.calls.length, 0);
});
Deno.test('D6: pending search RPCs receive the turn signal and cannot hold cancellation', async () => {
  const f = fixture(), c = embeddingContext();
  f.runtime.fetch = async () => new Response(JSON.stringify(vector()));
  f.setReply(() => new Promise(() => {}));
  const d = createDependencies(request(), f.runtime);
  await d.requireUser(request());
  const pending = d.searchDocuments({ query: 'Q' }, [], c.context);
  while (!f.calls.length) await new Promise((r) => setTimeout(r, 1));
  c.controller.abort();
  await assertRejects(() => pending);
  assert(f.calls[0].signal?.aborted);
  assertEquals(c.attempts[0].status, ['success']);
});
Deno.test('D6: real wiring finalizes through service RPC before server-only attempt logs', async () => {
  const f = fixture();
  let finalized = false;
  let modelCalls = 0;
  const snapshot = {
    conversation: { id: 'owned-c', title: 'Owned' },
    user_message_id: 'reserved-u',
    server_now: new Date().toISOString(),
    assistant: {
      id: 'reserved-a',
      status: 'running',
      execution_expires_at: new Date(Date.now() + 120000).toISOString(),
      content: '',
      sources: [],
      follow_ups: [],
      activity: [],
      model_served: null,
      error_message: null,
      usage: null,
      timing: null,
    },
  };
  f.setReply((side, table, op, value) => {
    if (table === 'lookup_research_turn') return { data: { kind: 'missing' }, error: null };
    if (table === 'claim_research_turn') {
      return { data: { ...snapshot, kind: 'claimed', execution_token: 'private-execution-token' }, error: null };
    }
    if (table === 'finalize_research_turn') {
      assertEquals(side, 'service');
      assertEquals((value as Record<string, unknown>).p_user_id, 'verified-owner');
      finalized = true;
      return {
        data: {
          ...snapshot,
          kind: 'terminal',
          assistant: { ...snapshot.assistant, ...(value as { p_result: object }).p_result },
        },
        error: null,
      };
    }
    if (table === 'model_call_logs') {
      assert(finalized);
      assertEquals(side, 'service');
      assertEquals(op, 'insert');
      return { data: { id: 'log' }, error: null };
    }
    return {
      data: table === 'ai_models'
        ? [{ model_id: 'test/model', efforts: [], is_default: true, tier: 1 }]
        : table === 'user_profiles'
        ? { persona: 'analyst' }
        : [],
      error: null,
    };
  });
  f.runtime.fetch = async () => {
    assert(f.calls.some((c) => c.table === 'claim_research_turn'));
    const data = modelCalls++ === 0 ? { choices: [{ delta: {}, finish_reason: 'stop' }] } : {
      model: 'test/model',
      choices: [{
        delta: { content: JSON.stringify({ answer: 'Verified saved answer', sources: [], follow_up_questions: [] }) },
        finish_reason: 'stop',
      }],
    };
    return new Response(`data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n`);
  };
  const response = await createResearchHandler(f.runtime)(request());
  const body = await response.text();
  assert(finalized);
  assertEquals(modelCalls, 2);
  assert(body.includes('reserved-a'));
  assert(!body.includes('private-execution-token'));
  assertEquals(f.calls.filter((c) => c.table === 'model_call_logs').length, 2);
  assertEquals(f.calls.some((c) => c.table === 'chat_messages' && c.op === 'insert'), false);
});
Deno.test('D6: import performs no env/network/serve work and modern keys use the intended client boundaries', async () => {
  const get = Deno.env.get, serve = Deno.serve, fetch = globalThis.fetch;
  const seen: { url: string; key: string | null; authorization: string | null }[] = [];
  try {
    Deno.env.get = () => {
      throw new Error('import read env');
    };
    Deno.serve = (() => {
      throw new Error('import started server');
    }) as typeof Deno.serve;
    globalThis.fetch = () => {
      throw new Error('import accessed network');
    };
    const imported = await import(new URL('./index.ts?import-purity', import.meta.url).href);
    Deno.env.get = (name: string) =>
      ({
        SUPABASE_URL: 'https://fake.invalid',
        SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_fake_test"}',
        SUPABASE_SECRET_KEYS: '{"default":"sb_secret_fake_test"}',
      } as Record<string, string>)[name];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      seen.push({ url, key: headers.get('apikey'), authorization: headers.get('authorization') });
      const payload = url.includes('/auth/')
        ? { id: 'verified-owner' }
        : url.includes('lookup_research_turn')
        ? { kind: 'missing' }
        : url.includes('claim_research_turn')
        ? { kind: 'forbidden' }
        : [{ model_id: 'test/model', efforts: [], is_default: true, tier: 1 }];
      return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
    };
    const response = await imported.createResearchHandler()(request());
    assertEquals(response.status, 403);
    const claim = seen.find((x) => x.url.includes('claim_research_turn'));
    assertEquals(claim?.key, 'sb_secret_fake_test');
    const model = seen.find((x) => x.url.includes('ai_models'));
    assertEquals(model?.key, 'sb_publishable_fake_test');
    assertEquals(model?.authorization, 'Bearer fake.user.jwt');
    assertEquals(seen.filter((x) => x.url.includes('/auth/')).length, 1);
  } finally {
    Deno.env.get = get;
    Deno.serve = serve;
    globalThis.fetch = fetch;
  }
});
Deno.test('D6: Auth transport exceptions never expose private provider details', async () => {
  const f = fixture();
  f.caller.auth.getUser = () => Promise.reject(new Error('PRIVATE auth transport detail'));
  const response = await createResearchHandler(f.runtime)(request());
  assertEquals(response.status, 503);
  assertEquals((await response.text()).includes('PRIVATE'), false);
  assertEquals(f.calls.length, 0);
});
Deno.test('D6: cancellation before embedding fetch actually starts records no planned attempt', async () => {
  const f = fixture(), c = embeddingContext();
  const d = createDependencies(request(), f.runtime);
  await d.requireUser(request());
  const pending = d.searchDocuments({ query: 'Q' }, [], c.context);
  c.controller.abort();
  await assertRejects(() => pending);
  assertEquals(f.sent.length, 0);
  assertEquals(c.attempts.length, 0);
});
Deno.test('D6: failed cancellation cleanup retains the exact timestamp for a safe explicit retry', async () => {
  const f = fixture(), d = createDependencies(request(), f.runtime);
  await d.requireUser(request());
  f.setReply(() => ({ data: { cancel_requested_at: '2026-09-21T12:00:01Z' }, error: null }));
  await d.db.cancelRequestedSince('c', '2026-09-21T12:00:00Z');
  f.setReply(() => ({ data: null, error: { message: 'PRIVATE delete error' } }));
  await assertRejects(() => d.db.clearCancellation('c'));
  f.setReply(() => ({ data: null, error: null }));
  await d.db.clearCancellation('c');
  assertEquals(f.calls.filter((c) => c.op === 'delete').length, 2);
});
Deno.test('D6: model timeout cannot reserve a claim or reach the provider', async () => {
  const f = fixture();
  f.setReply((_side, table) =>
    table === 'lookup_research_turn' ? { data: { kind: 'missing' }, error: null } : new Promise(() => {})
  );
  const response = await createResearchHandler(f.runtime)(request());
  assertEquals(response.status, 503);
  assertEquals(f.calls.some((c) => c.table === 'claim_research_turn'), false);
  assertEquals(f.sent.length, 0);
});
