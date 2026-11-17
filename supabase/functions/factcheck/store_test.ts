import { assertEquals } from 'jsr:@std/assert@1';
import { postgrestStore } from './store.ts';

type Call = [string, ...unknown[]];

/** A chainable stand-in for the supabase query builder: records every call, resolves to `result`. */
function fakeDb(result: { data: unknown; error: { code?: string; message?: string } | null }) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  const record = (name: string) => (...args: unknown[]) => {
    calls.push([name, ...args]);
    return chain;
  };
  for (const name of ['select', 'insert', 'update', 'eq', 'or', 'order', 'limit', 'is', 'lt']) {
    chain[name] = record(name);
  }
  chain.maybeSingle = () => {
    calls.push(['maybeSingle']);
    return Promise.resolve(result);
  };
  chain.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
  return { db: { from: (t: string) => (calls.push(['from', t]), chain) }, calls };
}

const has = (calls: Call[], ...expect: unknown[]) =>
  calls.some((c) => expect.every((e, i) => JSON.stringify(c[i]) === JSON.stringify(e)));

Deno.test('every claim read and write is scoped by id AND session AND user', async () => {
  const f = fakeDb({ data: { id: 'c' }, error: null });
  const store = postgrestStore(() => f.db as never);
  await store.claim('U', 'S', 'C');
  assertEquals([
    has(f.calls, 'eq', 'id', 'C'),
    has(f.calls, 'eq', 'session_id', 'S'),
    has(f.calls, 'eq', 'user_id', 'U'),
  ], [true, true, true]);
  for (
    const run of [
      () =>
        store.updateHeld('U', 'S', 'C', {
          claim_en: 'x',
          claimant: null,
          reported_by: null,
          kind: 'claim',
          status: 'pending',
        }, false),
      () =>
        store.finishCheck('U', 'S', 'C', {
          status: 'checked',
          verdict: 'supported',
          reason: 'r',
          sources: [],
          checked_at: 't',
          fail_reason: null,
        }),
      () => store.releaseCheck('U', 'S', 'C'),
    ]
  ) {
    f.calls.length = 0;
    await run();
    assertEquals([
      has(f.calls, 'eq', 'id', 'C'),
      has(f.calls, 'eq', 'session_id', 'S'),
      has(f.calls, 'eq', 'user_id', 'U'),
    ], [true, true, true]);
  }
});

Deno.test('the check lock claims only a pending claim that is not already being checked', async () => {
  const f = fakeDb({ data: [{ id: 'C' }], error: null });
  const store = postgrestStore(() => f.db as never);
  assertEquals(await store.lockForCheck('U', 'S', 'C', '2026-11-16T10:00:00.000Z', '2026-11-16T09:58:30.000Z'), true);
  assertEquals(has(f.calls, 'eq', 'status', 'pending'), true);
  assertEquals(has(f.calls, 'update', { checked_at: '2026-11-16T10:00:00.000Z' }), true);
  const or = f.calls.find((c) => c[0] === 'or')![1] as string;
  assertEquals(or, 'checked_at.is.null,checked_at.lt.2026-11-16T09:58:30.000Z');
  const none = postgrestStore(() => fakeDb({ data: [], error: null }).db as never);
  assertEquals(await none.lockForCheck('U', 'S', 'C', 'a', 'b'), false);
});

Deno.test('results are saved and released only while the claim is pending', async () => {
  const f = fakeDb({ data: null, error: null });
  const store = postgrestStore(() => f.db as never);
  await store.finishCheck('U', 'S', 'C', {
    status: 'checked',
    verdict: 'supported',
    reason: 'r',
    sources: [],
    checked_at: 't',
    fail_reason: null,
  });
  assertEquals(has(f.calls, 'eq', 'status', 'pending'), true);
  f.calls.length = 0;
  await store.releaseCheck('U', 'S', 'C');
  assertEquals(has(f.calls, 'eq', 'status', 'pending'), true);
  assertEquals(has(f.calls, 'update', { checked_at: null }), true);
  f.calls.length = 0;
  await store.updateHeld('U', 'S', 'C', {
    claim_en: 'x',
    claimant: null,
    reported_by: null,
    kind: 'claim',
    status: 'pending',
  }, false);
  assertEquals(has(f.calls, 'eq', 'status', 'needs_context'), true);
  assertEquals(has(f.calls, 'eq', 'shared', false), true, 'a private claim is updated only while it is private');
  f.calls.length = 0;
  await store.updateHeld('U', 'S', 'C', {
    claim_en: 'x',
    claimant: null,
    reported_by: null,
    kind: 'claim',
    status: 'pending',
  }, true);
  assertEquals(has(f.calls, 'eq', 'shared', true), true, 'a shared claim is updated only while it is shared');
});

Deno.test('a database error is thrown with its code only', async () => {
  const f = fakeDb({ data: null, error: { code: '42501', message: 'row content here' } });
  const store = postgrestStore(() => f.db as never);
  try {
    await store.claim('U', 'S', 'C');
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals((e as Error).message, 'database error 42501');
  }
});

Deno.test('claims are listed newest first with a limit, and a missing row reads as null', async () => {
  const f = fakeDb({ data: [], error: null });
  const store = postgrestStore(() => f.db as never);
  await store.claims('U', 'S', 50);
  assertEquals(has(f.calls, 'limit', 50), true);
  assertEquals(
    f.calls.some((c) =>
      c[0] === 'order' && c[1] === 'spoken_at' && (c[2] as { ascending: boolean }).ascending === false
    ),
    true,
  );
  assertEquals(await postgrestStore(() => fakeDb({ data: null, error: null }).db as never).claim('U', 'S', 'C'), null);
});

Deno.test('claimById is scoped by id AND user', async () => {
  const f = fakeDb({ data: { id: 'c' }, error: null });
  await postgrestStore(() => f.db as never).claimById('U', 'C');
  assertEquals([has(f.calls, 'eq', 'id', 'C'), has(f.calls, 'eq', 'user_id', 'U')], [true, true]);
});

Deno.test('an error result is saved with its fail_reason, and every claim read selects the column', async () => {
  const f = fakeDb({ data: null, error: null });
  const store = postgrestStore(() => f.db as never);
  const result = {
    status: 'error' as const,
    verdict: null,
    reason: null,
    sources: [],
    checked_at: 't',
    fail_reason: 'no_sources' as const,
  };
  await store.finishCheck('U', 'S', 'C', result);
  assertEquals(has(f.calls, 'update', result), true);
  for (
    const run of [() => store.claim('U', 'S', 'C'), () => store.claimById('U', 'C'), () => store.claims('U', 'S', 5)]
  ) {
    f.calls.length = 0;
    await run();
    const cols = f.calls.find((c) => c[0] === 'select')![1] as string;
    assertEquals(cols.split(',').includes('fail_reason'), true);
  }
});
