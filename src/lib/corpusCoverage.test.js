import { beforeEach, expect, it, vi } from 'vitest';
import { coverageOf, indexedDocumentKeys, resetCoverageCache } from './corpusCoverage.js';

/** A Supabase query chain that answers with `rows`, recording what it was asked. */
function client(rows, { error = null, calls = [] } = {}) {
  return {
    calls,
    from() {
      const chain = {
        select: () => chain,
        in(_col, keys) { calls.push([...keys]); return chain; },
        not: () => Promise.resolve({ data: rows, error }),
      };
      return chain;
    },
  };
}

beforeEach(() => resetCoverageCache());

it('answers with the keys that have indexed text, and nothing for the rest', async () => {
  const db = client([{ document_key: 'bill:2021:116' }]);
  const found = await indexedDocumentKeys(['bill:2021:116', 'bill:2026:153'], db);
  expect([...found]).toEqual(['bill:2021:116']);
  expect(coverageOf({ document_key: 'bill:2021:116' }, found)).toBe('full');
  expect(coverageOf({ document_key: 'bill:2026:153' }, found)).toBe('row');
});

it('asks once per key: a second call queries only what it has not already answered', async () => {
  const calls = [];
  const db = client([{ document_key: 'a' }], { calls });
  await indexedDocumentKeys(['a', 'b'], db);
  await indexedDocumentKeys(['a', 'b'], db);
  expect(calls).toEqual([['a', 'b']]);
  const third = await indexedDocumentKeys(['a', 'b', 'c'], db);
  expect(calls[1]).toEqual(['c']);
  expect([...third]).toEqual(['a']);
});

// "No full text" is a claim about the corpus. A failed request is not evidence
// for it, and a chip that says "Record only" because the network blinked is
// worse than a chip that says nothing.
it('a failed lookup says nothing rather than saying no', async () => {
  const db = client(null, { error: { message: 'network' } });
  const found = await indexedDocumentKeys(['bill:2026:153'], db);
  expect(found.size).toBe(0);
  expect(coverageOf({ document_key: 'bill:2026:153' }, found)).toBe(null);
});

it('an attachment with no key, and an unresolved lookup, both show nothing', async () => {
  const found = await indexedDocumentKeys([], client([]));
  expect(coverageOf({ title: 'A dropped file' }, found)).toBe(null);
  expect(coverageOf({ document_key: 'bill:2026:153' }, null)).toBe(null);
});

it('blank and duplicate keys are never sent to the database', async () => {
  const calls = [];
  const db = client([], { calls });
  await indexedDocumentKeys(['a', 'a', '', '   ', null, undefined], db);
  expect(calls).toEqual([['a']]);
  const none = vi.fn();
  await indexedDocumentKeys([], { from: none });
  expect(none).not.toHaveBeenCalled();
});
