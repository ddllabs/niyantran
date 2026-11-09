import { assertEquals } from 'jsr:@std/assert@1';
import {
  createHybridFlagCache,
  HYBRID_FLAG_FAILURE_TTL_MS,
  HYBRID_FLAG_KEY,
  HYBRID_FLAG_TTL_MS,
} from './hybridFlag.ts';

function rig(read: () => Promise<unknown>) {
  let t = 1_000_000;
  let reads = 0;
  const failures: string[] = [];
  const cache = createHybridFlagCache({ now: () => t, onFailure: (kind) => failures.push(kind) });
  const get = () =>
    cache.get(() => {
      reads++;
      return read();
    });
  return { get, advance: (ms: number) => (t += ms), reads: () => reads, failures };
}

Deno.test('F288: the flag key is hybrid_search', () => {
  assertEquals(HYBRID_FLAG_KEY, 'hybrid_search');
  assertEquals([HYBRID_FLAG_TTL_MS, HYBRID_FLAG_FAILURE_TTL_MS], [15_000, 5_000]);
});

Deno.test('F288: an absent row is off, with the default budgets', async () => {
  const r = rig(() => Promise.resolve(undefined));
  assertEquals(await r.get(), { enabled: false, hybridMs: 2_500, fallbackMs: 4_000 });
  assertEquals(r.failures, [], 'an absent row is not a read failure');
});

Deno.test('F288: a malformed value is off', async () => {
  for (const value of ['yes', 7, [true], { enabled: 'true' }, { enabled: 1 }, null]) {
    assertEquals((await rig(() => Promise.resolve(value)).get()).enabled, false, JSON.stringify(value));
  }
});

Deno.test('F288: the row is read once within 15 s and again after; a flip is seen once the cache expires', async () => {
  let value: unknown = { enabled: false };
  const r = rig(() => Promise.resolve(value));
  assertEquals((await r.get()).enabled, false);
  value = { enabled: true, hybrid_ms: 3_000 };
  r.advance(HYBRID_FLAG_TTL_MS - 1);
  const stale = await r.get();
  assertEquals(stale.enabled, false, 'still the cached answer');
  assertEquals(r.reads(), 1);
  r.advance(1);
  const fresh = await r.get();
  assertEquals([fresh.enabled, fresh.hybridMs], [true, 3_000]);
  assertEquals(r.reads(), 2);
});

Deno.test('F288: a failed read is off, never throws, is cached for 5 s only, and reports the kind but no message', async () => {
  let fail = true;
  const r = rig(() =>
    fail ? Promise.reject(new TypeError('secret detail about the project')) : Promise.resolve({ enabled: true })
  );
  assertEquals((await r.get()).enabled, false);
  assertEquals((await r.get()).enabled, false);
  assertEquals(r.reads(), 1, 'one wait per isolate per 5 s, not one per search');
  assertEquals(r.failures, ['TypeError']);
  fail = false;
  r.advance(HYBRID_FLAG_FAILURE_TTL_MS - 1);
  assertEquals((await r.get()).enabled, false);
  r.advance(1);
  assertEquals((await r.get()).enabled, true, 'a recovered read takes effect after the short window');
  assertEquals(r.reads(), 2);
});

Deno.test('F288: searches that arrive while the read is in flight share it', async () => {
  let release!: (v: unknown) => void;
  const r = rig(() => new Promise((resolve) => (release = resolve)));
  const all = Promise.all([r.get(), r.get(), r.get()]);
  release({ enabled: true });
  assertEquals((await all).map((c) => c.enabled), [true, true, true]);
  assertEquals(r.reads(), 1);
});

Deno.test('F288: a reader that throws synchronously is off for 5 s only, then read again (no settled promise left in flight)', async () => {
  let fail = true;
  const r = rig(() => {
    if (fail) throw new TypeError('thrown before any promise');
    return Promise.resolve({ enabled: true });
  });
  assertEquals((await r.get()).enabled, false);
  assertEquals(r.failures, ['TypeError']);
  fail = false;
  r.advance(HYBRID_FLAG_FAILURE_TTL_MS);
  assertEquals((await r.get()).enabled, true, 'the failure window ended, so the row is read again');
  assertEquals(r.reads(), 2);
});
