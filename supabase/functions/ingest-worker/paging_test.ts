import { assertEquals } from 'jsr:@std/assert@1';
import { readAll } from './paging.ts';

/** A fake PostgREST: returns at most `cap` rows per range, like db-max-rows. */
function capped(total: number, cap: number) {
  const calls: Array<[number, number]> = [];
  const rows = Array.from({ length: total }, (_, i) => i);
  const page = (from: number, to: number) => {
    calls.push([from, to]);
    return Promise.resolve(rows.slice(from, Math.min(to + 1, from + cap)));
  };
  return { page, calls };
}

Deno.test('readAll reads every row past the per-request cap', async () => {
  const { page } = capped(2500, 1000);
  const rows = await readAll(page, 1000);
  assertEquals(rows.length, 2500);
  assertEquals(rows[2499], 2499);
});

Deno.test('readAll stops after a short page, and asks once more on an exact multiple', async () => {
  const short = capped(10, 1000);
  await readAll(short.page, 1000);
  assertEquals(short.calls, [[0, 999]]);

  const exact = capped(2000, 1000);
  assertEquals((await readAll(exact.page, 1000)).length, 2000);
  assertEquals(exact.calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});
