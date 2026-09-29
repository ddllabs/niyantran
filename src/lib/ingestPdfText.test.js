// F23 (docs/plans/2026-09-29-corpus-ingestion.md): the pdf_text ingest path.
// It streams 01_original_corpus/documents.jsonl.gz, selects extraction
// pdf_text by doc_type (and bill year), resolves document_key through
// links.json exactly as the OCR path does, and carries the corpus fields the
// OCR sidecars never had. The corpus itself is never needed: the fixture is a
// small .jsonl.gz written here.
import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { fromPdfTextRecord, parseArgs, readPdfText } from '../../scripts/ingest-national-desk.mjs';

const FEATURE = 'Bill Passage Probability Index';
const rec = (id, extra = {}) => {
  const text = extra.text ?? `AS INTRODUCED IN LOK SABHA ${id}\nClause 1. Short title.`;
  return {
    id, text, extraction: 'pdf_text', doc_type: 'bill',
    source_path: `national/${FEATURE}/${id}.pdf`, feature: FEATURE, title: `${id} title`,
    source_host: 'sansad.in', licence_class: 'gov_open', section: 'national',
    n_pages: 3, n_chars: [...text].length, as_of: '2026-09-01', file_bytes: 1234,
    dataset_key: `ds-${id}`, row_ref: `row-${id}`, integrity: 'ok', licence_basis: 'gazette',
    prid: `prid-${id}`, posted_on: '2024-02-01', profile_ref: `profile-${id}`,
    ...extra,
  };
};

const RECORDS = [
  rec('bill_2024_a'),
  rec('bill_unkeyed'),
  rec('bill_2010_f'),
  rec('pq_1', { doc_type: 'parl_question', source_path: 'national/Parliamentary Question Database/pq_1.pdf', feature: 'Parliamentary Question Database' }),
  rec('bill_ocr', { extraction: 'ocr' }),
  rec('bill_record_stub', { extraction: 'dataset', doc_type: 'bill_record' }),
  rec('bill_2025_bad', { n_chars: 3 }),
  rec('bill_2025_big', { text: 'x'.repeat(5000) }),
];

const LINKS = {
  'bill_2024_a.pdf': { url: 'https://sansad.in/a.pdf', doc_type: 'bill_record', title: 'The A Bill, 2024', bill_number: '12', bill_year: '2024', house: 'Lok Sabha', status: 'Pending' },
  'bill_2010_f.pdf': { url: 'https://sansad.in/f.pdf', doc_type: 'bill_record', title: 'The F Bill, 2010', bill_number: '7', bill_year: '2010' },
  'bill_2025_bad.pdf': { url: 'https://sansad.in/bad.pdf', doc_type: 'bill_record', bill_number: '1', bill_year: '2025' },
  'bill_2025_big.pdf': { url: 'https://sansad.in/big.pdf', doc_type: 'bill_record', bill_number: '2', bill_year: '2025' },
  'pq_1.pdf': { ambiguous: true, urls: ['https://x/1.pdf', 'https://x/2.pdf'] },
};

async function corpus(run, records = RECORDS) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ingest-pdf-text-'));
  try {
    await mkdir(path.join(dir, '01_original_corpus'));
    // One malformed candidate line: a real archive this size may carry one, and it must not stop
    // the stream. (Lines without "pdf_text" are skipped before parsing, so only candidates count.)
    const lines = [...records.map((r) => JSON.stringify(r)), '{"extraction": "pdf_text", broken'].join('\n');
    await writeFile(path.join(dir, '01_original_corpus', 'documents.jsonl.gz'), gzipSync(lines));
    const links = path.join(dir, 'links.json');
    await writeFile(links, JSON.stringify({ links: LINKS }));
    await run(dir, links);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ids = (docs) => docs.map((d) => d.source_key).sort();

describe('readPdfText selection', () => {
  it('selects only pdf_text records of the doc type, in the bill-year range, with a key', async () => {
    await corpus(async (dir, links) => {
      const r = await readPdfText(dir, { docType: 'bill', links, fromYear: 2015, toYear: 2026, keyedOnly: true, maxChars: 4000 });
      expect(ids(r.docs)).toEqual(['bill_2024_a']);
      expect(r.failed.map((f) => f.source_key)).toEqual(['bill_2025_bad']);
      expect(r.skipped).toEqual([expect.objectContaining({ id: 'bill_2025_big', reason: 'too_large' })]);
      expect(r.malformed).toBe(1);
    });
  });

  it('without a year range takes every keyed bill; without --keyed-only, unkeyed ones too', async () => {
    await corpus(async (dir, links) => {
      expect(ids((await readPdfText(dir, { docType: 'bill', links, keyedOnly: true, maxChars: 4000 })).docs)).toEqual(['bill_2010_f', 'bill_2024_a']);
      expect(ids((await readPdfText(dir, { docType: 'bill', links, maxChars: 4000 })).docs)).toEqual(['bill_2010_f', 'bill_2024_a', 'bill_unkeyed']);
    });
  });

  it('never takes ocr or dataset records, and selects other doc types', async () => {
    await corpus(async (dir, links) => {
      const all = await readPdfText(dir, { docType: 'bill', links, maxChars: 10000 });
      expect(ids(all.docs)).not.toContain('bill_ocr');
      expect(ids(all.docs)).not.toContain('bill_record_stub');
      expect(ids((await readPdfText(dir, { docType: 'parl_question', links, maxChars: 4000 })).docs)).toEqual(['pq_1']);
    });
  });

  it('--only selects exact ids and names any that match nothing', async () => {
    await corpus(async (dir, links) => {
      const r = await readPdfText(dir, { docType: 'bill', links, maxChars: 4000, only: new Set(['bill_unkeyed']) });
      expect(ids(r.docs)).toEqual(['bill_unkeyed']);
      await expect(readPdfText(dir, { docType: 'bill', links, maxChars: 4000, only: new Set(['nope', 'bill_2024_a']) }))
        .rejects.toThrow(/nope/);
    });
  });

  it('--shard splits the selection and --limit caps it', async () => {
    await corpus(async (dir, links) => {
      const opts = { docType: 'bill', links, maxChars: 4000 };
      const a = await readPdfText(dir, { ...opts, shard: { index: 0, count: 2 } });
      const b = await readPdfText(dir, { ...opts, shard: { index: 1, count: 2 } });
      expect([...ids(a.docs), ...ids(b.docs)].sort()).toEqual(['bill_2010_f', 'bill_2024_a', 'bill_unkeyed']);
      expect(ids(a.docs).some((id) => ids(b.docs).includes(id))).toBe(false);
      expect((await readPdfText(dir, { ...opts, limit: 1 })).docs).toHaveLength(1);
    });
  });
});

describe('fromPdfTextRecord', () => {
  it('builds the ingest document with the key, the URL and the seven carried fields', () => {
    const doc = fromPdfTextRecord(rec('bill_2024_a'), LINKS['bill_2024_a.pdf']);
    expect(doc).toMatchObject({
      source_key: 'bill_2024_a',
      title: 'The A Bill, 2024',
      file_name: 'bill_2024_a.pdf',
      file_url: 'https://sansad.in/a.pdf',
      desk_tier: 'national',
      desk_feature: FEATURE,
    });
    expect(doc.ocr_text).toBe(rec('bill_2024_a').text);
    expect(doc.metadata).toMatchObject({
      document_key: 'bill:2024:12', bill_number: '12', bill_year: '2024', house: 'Lok Sabha', status: 'Pending',
      file_url_ambiguous: false, file_url_source: 'corpus bill_record record',
      extraction: 'pdf_text', doc_type: 'bill', source_path: `national/${FEATURE}/bill_2024_a.pdf`,
      dataset_key: 'ds-bill_2024_a', row_ref: 'row-bill_2024_a', integrity: 'ok', licence_basis: 'gazette',
      prid: 'prid-bill_2024_a', posted_on: '2024-02-01', profile_ref: 'profile-bill_2024_a',
    });
    expect(doc.metadata).not.toHaveProperty('text');
  });

  it('keeps an ambiguous link unresolved, and an unlinked record without a URL or key', () => {
    const amb = fromPdfTextRecord(rec('pq_1', { doc_type: 'parl_question' }), LINKS['pq_1.pdf']);
    expect(amb.file_url).toBe(null);
    expect(amb.metadata.file_url_ambiguous).toBe(true);
    expect(amb.metadata).not.toHaveProperty('document_key');
    const none = fromPdfTextRecord(rec('bill_unkeyed'), undefined);
    expect(none.file_url).toBe(null);
    expect(none.metadata).not.toHaveProperty('document_key');
    expect(none.title).toBe('bill_unkeyed title');
  });

  it('refuses a record whose declared length does not match its text', () => {
    expect(() => fromPdfTextRecord(rec('x', { n_chars: 3 }), undefined)).toThrow(/n_chars mismatch/);
    expect(() => fromPdfTextRecord(rec('x', { text: '' }), undefined)).toThrow(/text/);
  });
});

describe('the --pdf-text CLI', () => {
  it('parses its options', () => {
    expect(parseArgs(['--pdf-text', '/c', '--doc-type', 'bill', '--from-year', '2015', '--to-year', '2026', '--keyed-only', '--dry-run']))
      .toMatchObject({ pdfText: '/c', docType: 'bill', fromYear: 2015, toYear: 2026, keyedOnly: true, dryRun: true });
  });

  it('dispatches only the selected documents and reports the failures', async () => {
    await corpus(async (dir, links) => {
      const preload = path.join(dir, 'fake-fetch.mjs');
      await writeFile(preload, `globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(init.body);
        if (!body.dry_run) throw Error('expected a dry run');
        const docs = body.documents;
        if (docs.map(d => d.source_key).join() !== 'bill_2024_a') throw Error('unexpected dispatch ' + docs.map(d => d.source_key).join());
        return new Response(JSON.stringify({results: docs.map(d => ({source_key:d.source_key,status:'indexed',chunks:2,inserted:2,kept:0,deleted:0,embedded_tokens:0,cost_usd:0})), totals:{documents:1,indexed:1,unchanged:0,errors:0,embedded_tokens:0,cost_usd:0}}));
      };`);
      const result = await promisify(execFile)(process.execPath, ['--import', pathToFileURL(preload).href,
        path.resolve('scripts/ingest-national-desk.mjs'), '--pdf-text', dir, '--doc-type', 'bill', '--links', links,
        '--from-year', '2015', '--to-year', '2026', '--keyed-only', '--max-chars', '4000', '--dry-run'],
      { cwd: dir, env: { SUPABASE_URL: 'https://unused.invalid', SUPABASE_SECRET_KEY: 'sb_secret_fixture' } })
        .then((r) => ({ code: 0, stdout: r.stdout }), (error) => error);
      expect(result.stdout).toContain('with document_key 1');
      expect(result.stdout).toContain('n_chars mismatch');
      expect(result.code).toBe(1);
    });
  });
});
