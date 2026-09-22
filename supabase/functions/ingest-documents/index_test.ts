import { assert, assertEquals } from 'jsr:@std/assert@1';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { supabaseDb } from './index.ts';

/**
 * A stand-in for PostgREST's row cap. The real server silently returns at most
 * db-max-rows (1000 on NTER) however wide a range you ask for, and reports the
 * true total only in Content-Range - which supabase-js does not surface unless
 * you ask for a count. A reader that takes the short array at face value is
 * wrong, and wrong quietly.
 */
function cappedClient(total: number, cap = 1000) {
  const ranges: [number, number][] = [];
  const rows = Array.from({ length: total }, (_, i) => ({ chunk_hash: `hash-${String(i).padStart(6, '0')}` }));
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            range: (from: number, to: number) => {
              ranges.push([from, to]);
              return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + cap)), error: null });
            },
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, ranges, rows };
}

Deno.test('existingHashes returns every chunk of a document past the PostgREST row cap', async () => {
  // 2,240 is "The Customs Tariff ... Bill, 2003": the first document large enough
  // to cross the cap, and the one whose re-run reported 1,240 chunks still to
  // embed when all 2,240 were already committed.
  const { client, ranges } = cappedClient(2240);
  const hashes = await supabaseDb(client).existingHashes('doc-1');

  assertEquals(hashes.size, 2240);
  assert(hashes.has('hash-000000') && hashes.has('hash-002239'), 'first and last chunk must both be present');
  // Three reads: 1000, 1000, 240. The short final page is what ends the loop.
  assertEquals(ranges.length, 3);
  assertEquals(ranges[0], [0, 999]);
  assertEquals(ranges[2], [2000, 2999]);
});

Deno.test('existingHashes stops after one read when the document fits under the cap', async () => {
  const { client, ranges } = cappedClient(915);
  const hashes = await supabaseDb(client).existingHashes('doc-2');
  assertEquals(hashes.size, 915);
  assertEquals(ranges.length, 1);
});

Deno.test('existingHashes returns an empty set for a document with no chunks', async () => {
  const { client, ranges } = cappedClient(0);
  assertEquals((await supabaseDb(client).existingHashes('doc-3')).size, 0);
  assertEquals(ranges.length, 1);
});

Deno.test('existingHashes reads exactly twice when the count is an exact multiple of the cap', async () => {
  // The boundary that an `if (data.length === 0) break` would get wrong: the
  // second page is full, so the loop must take a third read to see the end.
  const { client, ranges } = cappedClient(2000);
  assertEquals((await supabaseDb(client).existingHashes('doc-4')).size, 2000);
  assertEquals(ranges.length, 3);
});
