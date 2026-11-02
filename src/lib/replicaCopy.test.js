import { describe, expect, it } from 'vitest';
import {
  ReplicaCopyError,
  copyWithBisect,
  encodeRow,
  encodeRows,
  encodeValue,
  psqlErrorSummary,
  psqlErrorHint,
  isRowError,
  compareCounts,
  countReportLines,
} from './replicaCopy.js';

/**
 * A reference decoder for PostgreSQL COPY text format, written from the documented rules
 * (https://www.postgresql.org/docs/current/sql-copy.html, "Text Format"): fields are split on
 * an unescaped tab, a lone `\N` is NULL, and `\\`, `\n`, `\r`, `\t` are the backslash escapes.
 * It also stops at an end-of-data line (`\.`), as the server does.
 */
function decodeCopyText(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    if (line === '\\.') break;
    rows.push(line.split('\t').map((field) => {
      if (field === '\\N') return null;
      let out = '';
      for (let i = 0; i < field.length; i++) {
        if (field[i] !== '\\') { out += field[i]; continue; }
        const next = field[++i];
        if (next === '\\') out += '\\';
        else if (next === 'n') out += '\n';
        else if (next === 'r') out += '\r';
        else if (next === 't') out += '\t';
        else throw new Error(`unexpected escape \\${next}`);
      }
      return out;
    }));
  }
  return rows;
}

const roundTrip = (value, kind) => decodeCopyText(`${encodeValue(value, kind)}\n`)[0][0];

describe('encodeValue: text', () => {
  it('leaves plain text unchanged', () => {
    expect(encodeValue('Ministry of Finance, 2025')).toBe('Ministry of Finance, 2025');
  });

  it('distinguishes null (\\N) from the empty string (nothing)', () => {
    expect(encodeValue(null)).toBe('\\N');
    expect(encodeValue(undefined)).toBe('\\N');
    expect(encodeValue('')).toBe('');
  });

  it('escapes backslash, newline, carriage return and tab', () => {
    expect(encodeValue('a\\b')).toBe('a\\\\b');
    expect(encodeValue('a\nb')).toBe('a\\nb');
    expect(encodeValue('a\rb')).toBe('a\\rb');
    expect(encodeValue('a\r\nb')).toBe('a\\r\\nb');
    expect(encodeValue('a\tb')).toBe('a\\tb');
  });

  it('keeps a text value that is the two characters \\N from reading as null', () => {
    expect(encodeValue('\\N')).toBe('\\\\N');
    expect(roundTrip('\\N')).toBe('\\N');
  });

  it('never produces a line that is exactly the end-of-data marker', () => {
    // The 2026-11-01 load stopped at chunk 34,500: a chunk containing a line of exactly `\.`.
    const text = 'before\n\\.\nafter';
    const encoded = encodeValue(text);
    expect(encoded).toBe('before\\n\\\\.\\nafter');
    expect(encoded.split('\n')).not.toContain('\\.');
    expect(roundTrip(text)).toBe(text);
    // Also when the marker is the whole value, and at the start and end of the value.
    for (const v of ['\\.', '\\.\n', '\n\\.', '\\.\r\n\\.\r\n']) {
      const line = encodeRows([{ id: 'x', c: v }], ['id', 'c']);
      expect(line.split('\n')).not.toContain('\\.');
      expect(decodeCopyText(line)[0][1]).toBe(v);
    }
  });

  it('keeps quotes, commas and non-ASCII text verbatim', () => {
    const v = 'He said "stop", then left — नियंत्रण 😀';
    expect(encodeValue(v)).toBe(v);
    expect(roundTrip(v)).toBe(v);
  });

  it('writes numbers and booleans as Postgres reads them', () => {
    expect(encodeValue(0)).toBe('0');
    expect(encodeValue(-12.5)).toBe('-12.5');
    expect(encodeValue(true)).toBe('true');
    expect(encodeValue(false)).toBe('false');
  });

  it('refuses an object where a text column is expected (it must be declared json)', () => {
    expect(() => encodeValue({ a: 1 })).toThrow(/json/);
  });

  it('refuses text that Postgres cannot hold: a NUL character', () => {
    expect(() => encodeValue('ab\u0000cd')).toThrow(ReplicaCopyError);
  });

  it('refuses a lone surrogate, which would be written as U+FFFD', () => {
    expect(() => encodeValue('ab\ud800cd')).toThrow(ReplicaCopyError);
  });
});

describe('encodeValue: json', () => {
  it('writes an object as JSON text with the COPY escapes applied on top', () => {
    const v = { a: 'line1\nline2', b: ['\\.', 'tab\t'], c: null, d: 3 };
    const encoded = encodeValue(v, 'json');
    expect(encoded).not.toMatch(/[\n\r\t]/);
    expect(JSON.parse(roundTrip(v, 'json'))).toEqual(v);
  });

  it('writes an empty object, an array and a string as JSON, not as a Postgres array', () => {
    expect(encodeValue({}, 'json')).toBe('{}');
    expect(encodeValue([1, 'a'], 'json')).toBe('[1,"a"]');
    expect(encodeValue('abc', 'json')).toBe('"abc"');
  });

  it('writes null as \\N', () => {
    expect(encodeValue(null, 'json')).toBe('\\N');
  });

  it('refuses a NUL anywhere inside, including in a key, but not a literal backslash-u0000', () => {
    expect(() => encodeValue({ a: ['x\u0000y'] }, 'json')).toThrow(ReplicaCopyError);
    expect(() => encodeValue({ 'k\u0000': 1 }, 'json')).toThrow(ReplicaCopyError);
    expect(() => encodeValue({ a: 'text \\u0000 as characters' }, 'json')).not.toThrow();
  });
});

describe('encodeValue: array (Postgres array literal)', () => {
  it('writes uuid[] as {a,b}', () => {
    const a = '11111111-1111-1111-1111-111111111111';
    const b = '22222222-2222-2222-2222-222222222222';
    expect(roundTrip([a, b], 'array')).toBe(`{"${a}","${b}"}`);
  });

  it('writes an empty array as {} and null as \\N', () => {
    expect(encodeValue([], 'array')).toBe('{}');
    expect(encodeValue(null, 'array')).toBe('\\N');
  });

  it('quotes and escapes elements that contain braces, commas, quotes or backslashes', () => {
    expect(roundTrip(['a,b', 'c"d', 'e\\f', '{g}'], 'array')).toBe('{"a,b","c\\"d","e\\\\f","{g}"}');
  });

  it('writes a null element as NULL', () => {
    expect(roundTrip(['a', null], 'array')).toBe('{"a",NULL}');
  });

  it('refuses a non-array value', () => {
    expect(() => encodeValue('{a}', 'array')).toThrow(/array/);
  });
});

describe('encodeValue: vector', () => {
  it('passes the text form PostgREST returns through unchanged', () => {
    const v = '[0.0123,-0.5,1e-05,0]';
    expect(encodeValue(v, 'vector')).toBe(v);
  });

  it('writes an array of numbers in the same text form', () => {
    expect(encodeValue([0.5, -1, 2e-7], 'vector')).toBe('[0.5,-1,2e-7]');
  });

  it('writes null as \\N', () => {
    expect(encodeValue(null, 'vector')).toBe('\\N');
  });

  it('refuses text that is not bracketed', () => {
    expect(() => encodeValue('0.1,0.2', 'vector')).toThrow(/vector/);
  });

  it('refuses a tab, newline or space inside the brackets (it would split the COPY field)', () => {
    expect(() => encodeValue('[1,2\t,3]', 'vector')).toThrow(/vector/);
    expect(() => encodeValue('[1,2\n,3]', 'vector')).toThrow(/vector/);
    expect(() => encodeValue('[1, 2,3]', 'vector')).toThrow(/vector/);
    expect(() => encodeValue('[1,2,x]', 'vector')).toThrow(/vector/);
  });

  it('accepts signs, exponents and decimals', () => {
    expect(encodeValue('[-1.5e-05,+2,3E4]', 'vector')).toBe('[-1.5e-05,+2,3E4]');
  });

  it('refuses a non-finite number', () => {
    expect(() => encodeValue([1, Number.NaN], 'vector')).toThrow(/vector/);
  });
});

describe('encodeRow and encodeRows', () => {
  const columns = ['id', 'content', { name: 'metadata', kind: 'json' }, { name: 'embedding', kind: 'vector' }, { name: 'block_ids', kind: 'array' }];

  it('joins the fields with tabs, in the column order, and ends every row with a newline', () => {
    const out = encodeRows(
      [{ id: 'a', content: 'x', metadata: { k: 1 }, embedding: '[1,2]', block_ids: null }, { id: 'b', content: '', metadata: {}, embedding: null, block_ids: [] }],
      columns,
    );
    expect(out).toBe('a\tx\t{"k":1}\t[1,2]\t\\N\nb\t\t{}\t\\N\t{}\n');
  });

  it('writes a missing column as null', () => {
    expect(encodeRow({ id: 'a' }, ['id', 'content'])).toBe('a\t\\N');
  });

  it('keeps the field count constant whatever the content', () => {
    const rows = [
      { id: '1', content: 'tab\tinside', metadata: { t: '\t' }, embedding: '[1]', block_ids: null },
      { id: '2', content: 'nl\ninside\r\n', metadata: { t: '\n' }, embedding: '[1]', block_ids: ['x'] },
      { id: '3', content: '\\.', metadata: {}, embedding: null, block_ids: null },
    ];
    const out = encodeRows(rows, columns);
    const lines = out.split('\n');
    expect(lines.pop()).toBe('');
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l.split('\t')).toHaveLength(columns.length);
    expect(lines).not.toContain('\\.');
  });

  it('round-trips tricky text through the reference decoder (seeded fuzz)', () => {
    let seed = 20261101;
    const rand = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n; };
    const pieces = ['\\', '\\.', '\\N', '\n', '\r', '\r\n', '\t', '"', "'", ',', ' ', 'a', 'Z', '0', '.', 'é', '😀', '\u2028', '\u0008', '\u000c'];
    for (let n = 0; n < 500; n++) {
      const parts = Array.from({ length: 1 + rand(12) }, () => pieces[rand(pieces.length)]);
      const text = parts.join('');
      const out = encodeRows([{ id: `r${n}`, c: text }], ['id', 'c']);
      expect(out.split('\n')).not.toContain('\\.');
      expect(decodeCopyText(out)).toEqual([[`r${n}`, text]]);
    }
  });

  it('fails loudly naming the row id and column, never the content, on a NUL', () => {
    const rows = [
      { id: 'ok-1', content: 'fine' },
      { id: 'bad-row-id', content: 'secret passage \u0000 more secret text' },
    ];
    let error;
    try { encodeRows(rows, ['id', 'content']); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ReplicaCopyError);
    expect(error.rowId).toBe('bad-row-id');
    expect(error.column).toBe('content');
    expect(error.message).toContain('bad-row-id');
    expect(error.message).toContain('content');
    expect(error.message).not.toContain('secret');
  });

  it('names the row by another column when the id column is absent', () => {
    expect(() => encodeRows([{ document_id: 'd-9', c: 'x\u0000' }], ['document_id', 'c'], { idColumn: 'document_id' })).toThrow(/d-9/);
  });
});

describe('psqlErrorSummary and isRowError', () => {
  const stderr = [
    'ERROR:  unterminated CSV quoted field',
    'CONTEXT:  COPY document_chunks, line 414: "…the secret chunk text…"',
  ].join('\n');

  it('keeps only the ERROR line, so row content in CONTEXT never reaches a log', () => {
    expect(psqlErrorSummary(stderr)).toBe('ERROR:  unterminated CSV quoted field');
  });

  it('redacts quoted values in the ERROR line itself', () => {
    expect(psqlErrorSummary('ERROR:  invalid input syntax for type vector: "[secret text"\nCONTEXT:  COPY t, line 2, column embedding: "[secret text"'))
      .toBe('ERROR:  invalid input syntax for type vector: "…"');
  });

  it('truncates a very long line', () => {
    expect(psqlErrorSummary(`ERROR:  ${'x'.repeat(1000)}`).length).toBeLessThanOrEqual(200);
  });

  it('falls back to the first line when there is no ERROR line', () => {
    expect(psqlErrorSummary('Error response from daemon: No such container: niyantran')).toBe('Error response from daemon: No such container: niyantran');
  });

  it('treats an error with a COPY context as specific to the data, and anything else as not', () => {
    expect(isRowError(stderr)).toBe(true);
    expect(isRowError('psql: error: connection to server on socket failed')).toBe(false);
    expect(isRowError('Error response from daemon: No such container')).toBe(false);
  });
});

describe('copyWithBisect', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
  const rowError = () => Object.assign(new Error('ERROR:  bad'), { rowError: true });

  /** A fake COPY: atomic per call, fails when the batch holds a poisoned id. */
  function fakeCopy(poison, log = []) {
    const stored = [];
    return {
      stored,
      log,
      async copy(batch) {
        log.push(batch.map((r) => r.id));
        if (batch.some((r) => poison.has(r.id))) throw rowError();
        stored.push(...batch);
      },
    };
  }

  it('copies a clean batch in one call', async () => {
    const f = fakeCopy(new Set());
    await copyWithBisect(rows(8), f.copy);
    expect(f.log).toHaveLength(1);
    expect(f.stored).toHaveLength(8);
  });

  it('finds the one bad row, keeps every good row before it, and throws its id', async () => {
    const f = fakeCopy(new Set(['r5']));
    let error;
    try { await copyWithBisect(rows(8), f.copy); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ReplicaCopyError);
    expect(error.rowId).toBe('r5');
    expect(error.message).toContain('r5');
    // r0..r3 and r4 are stored; nothing after the bad row is attempted past the failing half.
    expect(f.stored.map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });

  it('takes about log2(n) extra calls, not n', async () => {
    const f = fakeCopy(new Set(['r200']));
    await expect(copyWithBisect(rows(250), f.copy)).rejects.toThrow(/r200/);
    expect(f.log.length).toBeLessThan(25);
  });

  it('does not bisect an error that is not specific to the data (the container is gone)', async () => {
    const calls = [];
    const copy = async (batch) => { calls.push(batch.length); throw new Error('Error response from daemon: No such container'); };
    await expect(copyWithBisect(rows(250), copy)).rejects.toThrow(/No such container/);
    expect(calls).toEqual([250]);
  });

  it('does nothing for an empty batch', async () => {
    const f = fakeCopy(new Set());
    await copyWithBisect([], f.copy);
    expect(f.log).toHaveLength(0);
  });
});

describe('foreign-key failures', () => {
  const fk = [
    'ERROR:  insert or update on table "document_chunks" violates foreign key constraint "document_chunks_document_id_fkey"',
    'DETAIL:  Key (document_id)=(11111111-1111-1111-1111-111111111111) is not present in table "documents".',
  ].join('\n');

  it('is a row error even though PostgreSQL gives it no COPY context', () => {
    expect(isRowError(fk)).toBe(true);
  });

  it('has a hint that points at --resume and a document indexed during the load', () => {
    expect(psqlErrorHint(fk)).toMatch(/--resume/);
    expect(psqlErrorHint(fk)).toMatch(/indexed|ingested/);
  });

  it('has no hint for other errors', () => {
    expect(psqlErrorHint('ERROR:  unterminated CSV quoted field\nCONTEXT:  COPY t, line 2')).toBeNull();
  });

  it('is traced to the row by bisection, and the error carries the hint', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}` }));
    const copy = async (batch) => {
      if (batch.some((r) => r.id === 'r6')) throw Object.assign(new Error('ERROR:  insert or update on table "…" violates foreign key constraint "…"'), { rowError: isRowError(fk), hint: psqlErrorHint(fk) });
    };
    let error;
    try { await copyWithBisect(rows, copy); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ReplicaCopyError);
    expect(error.rowId).toBe('r6');
    expect(error.message).toMatch(/r6/);
    expect(error.message).toMatch(/--resume/);
  });
});

describe('compareCounts and countReportLines', () => {
  const same = { documents: 17609, document_chunks: 394000, law_records: 5, law_document_links: 3, law_listing_settings: 1 };

  it('matches when every count is equal', () => {
    const c = compareCounts(same, { ...same });
    expect(c.match).toBe(true);
    expect(c.tables.every((t) => t.status === 'equal')).toBe(true);
    expect(countReportLines(c, { mode: 'full' }).join('\n')).not.toMatch(/WARNING/);
  });

  it('reports both counts for every table, matching or not', () => {
    const lines = countReportLines(compareCounts(same, { ...same }), { mode: 'full' });
    expect(lines.some((l) => l.includes('document_chunks') && l.includes('394,000'))).toBe(true);
    expect(lines).toHaveLength(Object.keys(same).length);
  });

  it('warns, naming the table and how far apart, when the replica is short', () => {
    const c = compareCounts(same, { ...same, document_chunks: 34500 });
    expect(c.match).toBe(false);
    expect(c.tables.find((t) => t.table === 'document_chunks')).toMatchObject({ status: 'replica_short', source: 394000, replica: 34500 });
    const text = countReportLines(c, { mode: 'full' }).join('\n');
    expect(text).toMatch(/WARNING/);
    expect(text).toMatch(/document_chunks/);
    expect(text).toMatch(/359,500/);
  });

  it('warns when the replica holds more than NTER', () => {
    const c = compareCounts(same, { ...same, documents: 17700 });
    expect(c.tables.find((t) => t.table === 'documents').status).toBe('replica_extra');
    expect(c.match).toBe(false);
  });

  it('cannot confirm a match when NTER could not be counted', () => {
    const c = compareCounts({ ...same, documents: null }, { ...same });
    expect(c.match).toBe(false);
    expect(c.tables.find((t) => t.table === 'documents').status).toBe('unknown');
    expect(countReportLines(c, { mode: 'full' }).join('\n')).toMatch(/WARNING.*documents.*could not be counted/s);
  });

  it('a resumed load that differs says what a resume can miss', () => {
    const text = countReportLines(compareCounts(same, { ...same, document_chunks: 1 }), { mode: 'resumed' }).join('\n');
    expect(text).toMatch(/resumed/);
    expect(text).toMatch(/full load/);
  });

  it('a resumed load that matches still says it was resumed', () => {
    const text = countReportLines(compareCounts(same, { ...same }), { mode: 'resumed' }).join('\n');
    expect(text).toMatch(/resumed/);
    expect(text).not.toMatch(/WARNING/);
  });
});
