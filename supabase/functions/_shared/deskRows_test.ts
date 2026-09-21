import { renderDeskRows } from './tools/searchDeskRows.ts';
import { assert, assertEquals, assertMatch, assertNotEquals } from 'jsr:@std/assert@1';
import { billDocumentKey, deskRecordText, deskRowKey, flattenRow, fnv1a64, rowPinKey, slimDeskRow, toDeskRow } from './deskRows.ts';

interface Case {
  feature: string;
  raw: Record<string, unknown>;
  row_key: string;
  record_text: string;
  document_key: string | null;
}

const fixture = JSON.parse(await Deno.readTextFile(new URL('../../../src/lib/__fixtures__/deskRows.json', import.meta.url))) as Case[];

Deno.test('reproduces every fixture row: key, record text, document key', () => {
  assert(fixture.length >= 12);
  for (const c of fixture) {
    assertEquals(deskRowKey(c.raw), c.row_key, `${c.feature}: row_key`);
    assertEquals(deskRecordText(c.raw), c.record_text, `${c.feature}: record_text`);
    assertEquals(billDocumentKey(c.raw), c.document_key, `${c.feature}: document_key`);
  }
});

Deno.test('keeps the frontend key wherever the frontend has one; hashes the rest', () => {
  let hashed = 0;
  for (const c of fixture) {
    const front = rowPinKey(flattenRow(c.raw));
    if (front) assertEquals(c.row_key, front);
    else (assertMatch(c.row_key, /^h:[0-9a-f]{16}$/), hashed++);
  }
  assert(hashed > 0, 'the fixture covers a module without identity columns');
});

Deno.test('flattenRow is idempotent; a row without identity gets a stable content hash', () => {
  const raw = { case_title: 'A v B', pdf_url: 'https://x.org/a.pdf', datetime: '2026-07-03' };
  const once = flattenRow(raw);
  assertEquals(once.title, 'A v B');
  assertEquals(flattenRow(once), once);
  const a = { 0: 'Brent crude', 1: '$90.4', as_of: '2026-07' };
  assertEquals(rowPinKey(flattenRow(a)), '');
  assertMatch(deskRowKey(a), /^h:[0-9a-f]{16}$/);
  assertEquals(deskRowKey(a), deskRowKey({ ...a, 1: ' $90.4 ' }));
  assertNotEquals(deskRowKey(a), deskRowKey({ ...a, 0: 'WTI crude' }));
});

Deno.test('billDocumentKey and fnv1a64 vectors', () => {
  assertEquals(billDocumentKey({ bill_number: 'LXXII', bill_name: 'The Y Bill, 2025', date_introduced: '2026-03-12 19:00:00' }), 'bill:2025:LXXII');
  assertEquals(billDocumentKey({ bill_number: '108', bill_name: 'THE DELIMITATION BILL, 2026.', date_introduced: '2026-04-15' }), 'bill:2026:108');
  assertEquals(billDocumentKey({ bill_number: '9', bill_name: 'THE Z BILL', date_introduced: '2019-02-01' }), 'bill:2019:9');
  assertEquals(billDocumentKey({ bill_name: 'THE Z BILL, 2019' }), null);
  assertEquals(fnv1a64(''), 'cbf29ce484222325');
  assertEquals(fnv1a64('foobar'), '85944171f73967e8');
});

Deno.test('toDeskRow builds the insert row with string-only columns', () => {
  const c = fixture[0];
  const r = toDeskRow({ tier: 'national', feature: c.feature, raw: c.raw, snapshotAt: '2026-09-07T18:02:04.432Z' });
  assertEquals(r.row_key, c.row_key);
  assertEquals(r.record_text, c.record_text);
  assertEquals(r.document_key, c.document_key);
  assertEquals(r.snapshot_at, '2026-09-07T18:02:04.432Z');
  for (const v of Object.values(r.row)) assertEquals(typeof v, 'string');
  assertEquals(slimDeskRow({ a: 1, b: '', c: null, d: { x: 1 } }), { a: '1' });
});

// Mirrors src/lib/deskRows.test.js. The record is what the model reads: a
// labelled `id:` line in it is indistinguishable from a citable token, and the
// model imitates it instead of citing the issued ref: handle. A real production
// turn printed `[open-fronts:russia-ukraine-war:0]` and persisted zero sources
// because of exactly this.
Deno.test('deskRecordText never emits an identifier field', () => {
  const row = {
    id: 'open-fronts:russia-ukraine-war:0',
    record_id: 'rec-42',
    row_key: 'open-fronts:russia-ukraine-war:0',
    uuid: '7b1c2d3e-0000-4000-8000-000000000000',
    conflict_name: 'Russia-Ukraine War',
    region: 'Eastern Europe',
    intensity: 'Critical',
  };
  const text = deskRecordText(row);
  for (const field of ['id', 'record_id', 'row_key', 'uuid']) {
    assert(!new RegExp(`(^|\\n)${field}: `).test(text), `record text leaks ${field}:`);
  }
  assert(!text.includes('open-fronts:russia-ukraine-war:0'), 'record text leaks the row key');
  assert(!text.includes('rec-42'), 'record text leaks record_id');
  // The substance must survive the exclusion.
  assert(text.includes('Russia-Ukraine War'), 'record text lost its content');
  assert(text.includes('Eastern Europe') && text.includes('Critical'), 'record text lost fields');
});

Deno.test('renderDeskRows shows the handle but never the row key', () => {
  const result = {
    rows: [{
      tier: 'global',
      feature: 'Open Fronts',
      row_key: 'open-fronts:russia-ukraine-war:0',
      record_text: 'Record: Russia-Ukraine War\nregion: Eastern Europe',
      snapshot_at: '2026-09-07T16:55:06.648Z',
      document_key: null,
      row: {},
    }],
    total: 1,
    snapshot_at: '2026-09-07T16:55:06.648Z',
  };
  const text = renderDeskRows(result as never, ['ref:a7k2m9-1']);
  assert(text.includes('ref:a7k2m9-1'), 'the handle must be shown');
  assert(text.includes('Open Fronts'), 'the feature must be shown');
  assert(!text.includes('open-fronts:russia-ukraine-war:0'), 'the row key must not be shown');
});
