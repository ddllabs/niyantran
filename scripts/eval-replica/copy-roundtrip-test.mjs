/**
 * Proof against PostgreSQL that the replica loader's COPY encoding round-trips byte for byte, and
 * that the encoding it replaced does not (replica load of 2026-11-01, "unterminated CSV quoted
 * field ... line 414").
 *
 *   node scripts/eval-replica/copy-roundtrip-test.mjs
 *
 * Creates the throwaway database niyantran_replica_copy_test in niyantran-corpus-test-db, copies
 * synthetic rows through the loader's own copyInto, reads them back and compares the bytes, then
 * drops the database. It never touches the replica, NTER or the network. Needs Docker; run
 * outside the Claude Code sandbox. Exit 0 when every check holds.
 */
import { Buffer } from 'node:buffer';
import { ReplicaCopyError } from '../../src/lib/replicaCopy.js';
import { COPY_TEST_DATABASE, makeCopier } from './copy.mjs';

const copier = makeCopier({ database: COPY_TEST_DATABASE });

/** The encoding load.mjs used on 2026-11-01: every value quoted CSV, null as an empty field. */
function legacyCsvRows(rows, columns) {
  const field = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  return rows.map((r) => columns.map((c) => field(r[c])).join(',')).join('\n') + '\n';
}

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COLUMNS = [
  'id',
  'content',
  { name: 'metadata', kind: 'json' },
  { name: 'embedding', kind: 'vector' },
  { name: 'block_ids', kind: 'array' },
  'page_number',
  'note',
];

/** Named cases of content, each one a way a chunk of a document can break a COPY stream. */
const CASES = {
  plain: 'Ministry of Finance, 2025-26.',
  empty_string: '',
  end_of_data_line: 'Order of the Tribunal.\n\\.\nSigned.',
  end_of_data_only: '\\.',
  end_of_data_crlf: 'page one\r\n\\.\r\npage two',
  end_of_data_first_line: '\\.\nrest of the chunk',
  end_of_data_last_line: 'start of the chunk\n\\.',
  backslashes: 'C:\\Users\\x \\n is not a newline, \\t is not a tab, \\N is not null, \\\\ twice',
  quotes: 'He said "stop", then \'left\'; "" is two quotes',
  newlines_and_cr: 'line1\nline2\r\nline3\rline4\n\n\nend',
  tabs: 'col1\tcol2\t\tcol4\t',
  csv_lookalike: 'a,"b,c",\n"d""e",f',
  literal_null_marker: '\\N',
  unicode: 'नियंत्रण — résumé — 😀 — \u2028 \u2029 — \u0008 \u000c',
  long: `${'The quick brown fox jumps over the lazy dog.\n'.repeat(2000)}\\.\n${'tail '.repeat(2000)}`,
};

function syntheticRows() {
  const rows = [];
  let n = 1;
  for (const [name, content] of Object.entries(CASES)) {
    rows.push({
      id: uuid(n),
      content,
      metadata: { case: name, text: content, nested: { list: [content, 1, null, true], empty: {} } },
      embedding: '[0.25,-0.5,1]',
      block_ids: n % 2 ? [uuid(900 + n), uuid(800 + n)] : null,
      page_number: n,
      note: n % 3 === 0 ? null : content.slice(0, 20),
    });
    n++;
  }
  // Null versus empty, in text, json and array columns.
  rows.push({ id: uuid(n++), content: 'null text', metadata: {}, embedding: null, block_ids: [], page_number: null, note: null });
  rows.push({ id: uuid(n++), content: 'empty text', metadata: {}, embedding: '[0,0,0]', block_ids: null, page_number: 0, note: '' });
  // Volume: a thousand ordinary rows with the troublesome chunk at row 414.
  for (let i = 0; i < 1000; i++) {
    rows.push({
      id: uuid(1000 + i),
      content: i === 413 ? CASES.end_of_data_line : `ordinary chunk ${i}\nsecond line`,
      metadata: { i },
      embedding: '[0.5,0.5,0.5]',
      block_ids: null,
      page_number: i,
      note: 'bulk',
    });
  }
  return rows;
}

const SCHEMA = `
  create schema if not exists extensions;
  create extension if not exists vector with schema extensions;
  create table public.chunk_copy (
    id uuid primary key, content text, metadata jsonb, embedding extensions.vector(3),
    block_ids uuid[], page_number int, note text
  );
`;

const hex = (s) => (s === null || s === undefined ? null : Buffer.from(s, 'utf8').toString('hex'));

/** What PostgreSQL stored, as bytes (hex), so the comparison is byte for byte. */
function readBack() {
  const out = copier.psql(`select coalesce(json_agg(t order by t.id), '[]'::json) from (
      select id, encode(convert_to(content, 'UTF8'), 'hex') as content_hex, content is null as content_null,
             metadata, embedding::text as embedding, block_ids::text as block_ids, page_number,
             encode(convert_to(note, 'UTF8'), 'hex') as note_hex, note is null as note_null
        from public.chunk_copy) t`);
  return JSON.parse(out);
}

const arrayText = (ids) => (ids === null ? null : `{${ids.join(',')}}`);
const canonVector = (v) => (v === null ? null : `[${v.slice(1, -1).split(',').map(Number).join(',')}]`);

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

async function main() {
  console.log(`creating throwaway database ${COPY_TEST_DATABASE}`);
  copier.dropDatabase();
  copier.createDatabase();
  try {
    copier.psql(null, { input: SCHEMA });
    const rows = syntheticRows();

    // 1. The old encoding, one case at a time: which contents break it?
    console.log('\n-- OLD encoding (quoted CSV), each case alone in a fresh table');
    const legacyColumns = ['id', 'content'];
    const legacyOk = {};
    for (const [name, content] of Object.entries(CASES)) {
      copier.psql('truncate public.chunk_copy');
      let failed = null;
      try {
        copier.copyRaw('chunk_copy', legacyColumns, legacyCsvRows([{ id: uuid(1), content }], legacyColumns), 'format csv');
      } catch (e) {
        failed = e.message;
      }
      const stored = copier.psql('select encode(convert_to(content, \'UTF8\'), \'hex\') from public.chunk_copy');
      const same = failed === null && stored === hex(content);
      console.log(`   ${same ? 'ok    ' : 'BROKEN'} ${name}${failed ? `: ${failed}` : same ? '' : ': loaded but changed'}`);
      legacyOk[name] = same;
    }
    // The 1,002-row volume case through the old path: a thousand good rows around the bad one.
    copier.psql('truncate public.chunk_copy');
    let legacyVolume = null;
    try {
      copier.copyRaw('chunk_copy', legacyColumns, legacyCsvRows(rows.map((r) => ({ id: r.id, content: r.content })), legacyColumns), 'format csv');
    } catch (e) {
      legacyVolume = e.message;
    }
    check('OLD encoding fails on the end-of-data line', legacyOk.end_of_data_line === false && legacyVolume !== null, legacyVolume ?? 'it loaded');

    // 2. The new encoding through the real copyInto, in batches of 250 as the loader does.
    console.log('\n-- NEW encoding (COPY text) through copyInto');
    copier.psql('truncate public.chunk_copy');
    for (let i = 0; i < rows.length; i += 250) await copier.copyInto('chunk_copy', COLUMNS, rows.slice(i, i + 250));
    const back = readBack();
    check('row count', back.length === rows.length, `${back.length} of ${rows.length}`);
    const byId = new Map(back.map((r) => [r.id, r]));
    let bad = 0;
    for (const r of rows) {
      const g = byId.get(r.id);
      const sameContent = g && g.content_hex === hex(r.content);
      const sameNote = g && (r.note === null ? g.note_null : g.note_hex === hex(r.note));
      const sameMeta = g && JSON.stringify(g.metadata) === JSON.stringify(JSON.parse(JSON.stringify(r.metadata)));
      const sameVector = g && g.embedding === canonVector(r.embedding);
      const sameIds = g && g.block_ids === arrayText(r.block_ids);
      const samePage = g && g.page_number === r.page_number;
      if (!(sameContent && sameNote && sameMeta && sameVector && sameIds && samePage)) {
        bad++;
        console.log(`   differs: ${r.id} content=${sameContent} note=${sameNote} metadata=${sameMeta} embedding=${sameVector} block_ids=${sameIds} page=${samePage}`);
      }
    }
    check('every column of every row is byte-identical', bad === 0, `${bad} rows differ`);
    const nullRow = byId.get(uuid(Object.keys(CASES).length + 1));
    const emptyRow = byId.get(uuid(Object.keys(CASES).length + 2));
    check('null text, null vector and null page read back as NULL', nullRow.note_null && nullRow.embedding === null && nullRow.page_number === null);
    check('empty-string note reads back as empty, not NULL', emptyRow.note_null === false && emptyRow.note_hex === '');
    check('row 414 (the old failure point) is intact', byId.get(uuid(1000 + 413)).content_hex === hex(CASES.end_of_data_line));

    // 3. Failure reporting: a NUL stops the batch before anything is sent, naming the row.
    console.log('\n-- failure reporting');
    copier.psql('truncate public.chunk_copy');
    const nulRows = [{ id: uuid(1), content: 'fine' }, { id: uuid(2), content: 'has \u0000 nul' }];
    let nulError = null;
    try { await copier.copyInto('chunk_copy', ['id', 'content'], nulRows); } catch (e) { nulError = e; }
    check('a NUL fails loudly with the row id and no content', nulError instanceof ReplicaCopyError && nulError.rowId === uuid(2) && !nulError.message.includes('has') && copier.psql('select count(*) from public.chunk_copy') === '0', nulError?.message);

    // 4. A row PostgreSQL itself rejects (a 2-dimension vector in a 3-dimension column) is found
    //    by bisecting a batch of 250, reported by id, and the rows before it are kept.
    copier.psql('truncate public.chunk_copy');
    const batch = Array.from({ length: 250 }, (_, i) => ({ id: uuid(i + 1), content: `c${i}`, embedding: i === 137 ? '[1,2]' : '[1,2,3]' }));
    let rowError = null;
    try { await copier.copyInto('chunk_copy', ['id', 'content', { name: 'embedding', kind: 'vector' }], batch); } catch (e) { rowError = e; }
    const kept = Number(copier.psql('select count(*) from public.chunk_copy'));
    check('a row PostgreSQL rejects is named by id', rowError instanceof ReplicaCopyError && rowError.rowId === uuid(138), rowError?.message);
    check('the error text holds no row content', rowError !== null && !/c137|\[1,2\]/.test(rowError.message), rowError?.message);
    check('the rows before the bad one were kept', kept === 137, `${kept} rows kept`);
  } finally {
    copier.dropDatabase();
    console.log(`\ndropped ${COPY_TEST_DATABASE}`);
  }
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message ?? e);
  try { copier.dropDatabase(); } catch { /* best effort */ }
  process.exit(1);
});
