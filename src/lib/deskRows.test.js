import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/deskRows.json';
import { billDocumentKey, deskRecordText, deskRowKey, flattenRow, fnv1a64, slimDeskRow, toDeskRow } from './deskRows.js';
import { rowPinKey } from './sourceUrls.js';

describe('deskRows (client, mirrored in _shared/deskRows.ts)', () => {
  it('reproduces every fixture row: key, record text, document key', () => {
    expect(fixture.length).toBeGreaterThanOrEqual(12);
    for (const c of fixture) {
      expect(deskRowKey(c.raw), `${c.feature}: row_key`).toBe(c.row_key);
      expect(deskRecordText(c.raw), `${c.feature}: record_text`).toBe(c.record_text);
      expect(billDocumentKey(c.raw), `${c.feature}: document_key`).toBe(c.document_key);
    }
  });

  // The record is what the model reads. A labelled `id:` line in it is
  // indistinguishable from a citable token, and the model imitates it instead of
  // citing the issued ref: handle - the defect that made a real production turn
  // persist zero sources while printing `[open-fronts:russia-ukraine-war:0]`.
  it('never puts an identifier in the record the model reads', () => {
    const banned = ['id', 'record_id', 'row_key', 'uuid'];
    for (const c of fixture) {
      const text = deskRecordText(c.raw);
      for (const field of banned) {
        expect(text, `${c.feature}: leaks ${field}:`).not.toMatch(new RegExp(`(^|\\n)${field}: `));
      }
      // Also reject the row's own key appearing anywhere in the text, but only
      // when the key is distinctive. Some feeds use a bare ordinal like "1" as
      // the key, and every record contains that character somewhere; asserting
      // on those would fail on prose rather than on a leak.
      if (c.row_key.length >= 8) {
        expect(text, `${c.feature}: leaks its own row_key`).not.toContain(c.row_key);
      }
    }
  });

  it('excluding identifiers does not move any row key or document key', () => {
    for (const c of fixture) {
      expect(deskRowKey(c.raw), `${c.feature}: row_key moved`).toBe(c.row_key);
      expect(billDocumentKey(c.raw), `${c.feature}: document_key moved`).toBe(c.document_key);
    }
  });

  it('keeps the frontend key wherever the frontend has one', () => {
    for (const c of fixture) {
      const front = rowPinKey(flattenRow(c.raw));
      if (front) expect(c.row_key).toBe(front);
      else expect(c.row_key).toMatch(/^h:[0-9a-f]{16}$/);
    }
    expect(fixture.some((c) => c.row_key.startsWith('h:'))).toBe(true);
  });

  it('flattenRow is idempotent and fills date, title and source_url from the row', () => {
    const raw = { case_title: 'A v B', pdf_url: 'https://x.org/a.pdf', order_date: '03-Jul-2026', datetime: '2026-07-03' };
    const once = flattenRow(raw);
    expect(once.title).toBe('A v B');
    expect(once.source_url).toBe('https://x.org/a.pdf');
    expect(once.date).toBe('2026-07-03');
    expect(flattenRow(once)).toEqual(once);
    expect(deskRowKey(once)).toBe(deskRowKey(raw));
  });

  it('billDocumentKey: title year wins, date year fills in, roman numerals stay, nothing without a number', () => {
    expect(billDocumentKey({ bill_number: '156', bill_name: 'THE X BILL, 2026', date_introduced: '2026-08-09 19:00:00' })).toBe('bill:2026:156');
    expect(billDocumentKey({ bill_number: 'LXXII', bill_name: 'The Y (Amendment) Bill, 2025', date_introduced: '2026-03-12 19:00:00' })).toBe(
      'bill:2025:LXXII',
    );
    expect(billDocumentKey({ bill_number: '108', bill_name: 'THE DELIMITATION BILL, 2026.', date_introduced: '2026-04-15 19:00:00' })).toBe('bill:2026:108');
    expect(billDocumentKey({ bill_number: '9', bill_name: 'THE Z BILL', date_introduced: '2019-02-01' })).toBe('bill:2019:9');
    expect(billDocumentKey({ bill_number: '9', bill_name: 'THE Z BILL', date_introduced: '' })).toBeNull();
    expect(billDocumentKey({ bill_name: 'THE Z BILL, 2019' })).toBeNull();
    expect(billDocumentKey(null)).toBeNull();
  });

  it('rows without any identity column get a stable content hash, distinct per content', () => {
    const a = { 0: 'Brent crude', 1: '$90.4', as_of: '2026-07' };
    const b = { 0: 'WTI crude', 1: '$86.2', as_of: '2026-07' };
    expect(rowPinKey(flattenRow(a))).toBe('');
    expect(deskRowKey(a)).toMatch(/^h:[0-9a-f]{16}$/);
    expect(deskRowKey(a)).toBe(deskRowKey({ ...a }));
    expect(deskRowKey(a)).not.toBe(deskRowKey(b));
    expect(deskRowKey({ ...a, 1: ' $90.4 ' })).toBe(deskRowKey(a));
  });

  it('fnv1a64 matches the published test vectors', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar')).toBe('85944171f73967e8');
  });

  it('slimDeskRow stringifies scalars and drops empties and nested values', () => {
    expect(slimDeskRow({ a: 1, b: '', c: null, d: { x: 1 }, e: 'ok', f: 0 })).toEqual({ a: '1', e: 'ok', f: '0' });
  });

  it('toDeskRow builds the insert row', () => {
    const c = fixture[0];
    const r = toDeskRow({ tier: 'national', feature: c.feature, raw: c.raw, snapshotAt: '2026-09-07T18:02:04.432Z' });
    expect(r).toMatchObject({ tier: 'national', feature: c.feature, row_key: c.row_key, record_text: c.record_text, document_key: c.document_key });
    expect(r.snapshot_at).toBe('2026-09-07T18:02:04.432Z');
    for (const v of Object.values(r.row)) expect(typeof v).toBe('string');
  });
});
