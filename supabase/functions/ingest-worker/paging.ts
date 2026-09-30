// Paged reads (spec: "Reads are paged with PostgREST range, 1,000 rows at a time, everywhere").
// PostgREST truncates a response at db-max-rows without an error, so a list is read in ranges
// until a short page comes back.

import { INGEST } from './types.ts';

export async function readAll<T>(
  page: (from: number, to: number) => Promise<T[]>,
  size: number = INGEST.readPage,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0;; from += size) {
    const rows = await page(from, from + size - 1);
    out.push(...rows);
    if (rows.length < size) return out;
  }
}
