import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { fromCorpusRow, fromExportRecord, readCorpus, parseArgs } from '../../scripts/ingest-national-desk.mjs';

const text = 'A 😀 passage\r\n';
const hash = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const row = (extra = {}) => ({ id: 'source-1', document_name: 'bill.pdf', title: 'Bill',
  source_path: 'Section/Feature/bill.pdf', doc_type: 'bill', ocr_lang: 'eng',
  n_chars: String([...text].length), text_sha256: hash(text), n_pages: '1',
  markdown_path: 'doc.md', metadata_path: 'doc.json', in_current_corpus: 'True',
  retrieval_excluded: '', integrity: '', ...extra });

async function fixture(rows, sidecar, run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ingest-corpus-'));
  try {
    await mkdir(path.join(dir, '04_indexes'));
    const keys = Object.keys(rows[0]);
    const csv = [keys, ...rows.map((r) => keys.map((key) => r[key] ?? ''))]
      .map((cells) => cells.map((cell) => JSON.stringify(String(cell))).join(',')).join('\n');
    await writeFile(path.join(dir, '04_indexes/OCR_FILES.csv'), '\ufeff' + csv);
    await writeFile(path.join(dir, 'doc.md'), text);
    await writeFile(path.join(dir, 'doc.json'), JSON.stringify(sidecar));
    await writeFile(path.join(dir, 'links.json'), JSON.stringify({ links: {} }));
    await run(dir, path.join(dir, 'links.json'));
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe('source provenance and validation', () => {
  it('loads sidecar provenance while the index owns source identity and text claims', async () => {
    await fixture([row()], { id: 'source-1', source_host: 'sansad.in', licence_class: 'unconfirmed',
      ocr_quality: 0, as_of: '2026-09-09', extraction: 'ocr', custom_provenance: { source: 'owner' } }, async (dir, links) => {
      const result = await readCorpus(dir, 'Feature', links, 2_000_000, 0);
      expect(result.docs[0].metadata).toMatchObject({ source_host: 'sansad.in', licence_class: 'unconfirmed',
        ocr_quality: 0, as_of: '2026-09-09', extraction: 'ocr', custom_provenance: { source: 'owner' },
        n_chars: [...text].length, text_sha256: hash(text), metadata_path: 'doc.json' });
      expect(result.docs[0].ocr_text).toBe(text);
      expect(result.failed).toEqual([]);
    });
  });
  it('accepts Python codepoint counts and exact UTF-8 hashes without folding whitespace', () => {
    expect(fromCorpusRow(row(), null, text).ocr_text).toBe(text);
    expect(() => fromCorpusRow(row({ n_chars: String(text.length) }), null, text)).toThrow(/n_chars/);
    expect(() => fromCorpusRow(row({ text_sha256: hash(text.replace(/\s+/g, ' ').trim()) }), null, text)).toThrow(/text_sha256/);
  });
  it('rejects missing or malformed required corpus text claims', () => {
    for (const change of [{ n_chars: '' }, { n_chars: '-1' }, { n_chars: 'NaN' }, { text_sha256: '' }, { text_sha256: 'bad' }]) {
      expect(() => fromCorpusRow(row(change), null, text)).toThrow(/n_chars|text_sha256/);
    }
  });
  it('retains explicit exclusion and unknown integrity without inventing quality', () => {
    const doc = fromCorpusRow(row({ retrieval_excluded: 'False' }), null, text);
    expect(doc.metadata.retrieval_excluded).toBe(false);
    expect(doc.metadata.integrity ?? null).toBeNull();
    expect(doc.metadata).not.toHaveProperty('ocr_quality');
  });
  it('reports ambiguous links without selecting a URL or bill key', () => {
    const doc = fromCorpusRow(row(), { ambiguous: true, urls: ['https://one.test/bill.pdf', 'https://two.test/bill.pdf'] }, text);
    expect(doc.file_url).toBeNull();
    expect(doc.metadata).not.toHaveProperty('document_key');
    expect(doc.metadata.file_url_ambiguous).toBe(true);
  });
  it('replaces sidecar link metadata as one unit on authoritative resolution or ambiguity', () => {
    const stale = { source_host: 'owner.test', licence_class: 'unconfirmed', document_key: 'bill:2026:1',
      bill_number: '1', bill_year: '2026', house: 'Lok Sabha', status: 'Introduced', file_url_source: 'old map' };
    for (const link of [
      { ambiguous: true, urls: ['https://one.test/bill.pdf', 'https://two.test/bill.pdf'] },
      { url: 'https://new.test/bill.pdf', doc_type: 'bill_record', bill_number: '2', bill_year: '2025' },
      { url: 'https://new.test/rule.pdf', doc_type: 'rule_record' },
    ]) {
      const doc = fromCorpusRow(row(), link, text, stale);
      expect(doc.metadata).toMatchObject({ source_host: 'owner.test', licence_class: 'unconfirmed' });
      expect(doc.metadata).not.toHaveProperty('house');
      expect(doc.metadata).not.toHaveProperty('status');
      if (link.bill_number) {
        expect(doc.metadata).toMatchObject({ document_key: 'bill:2025:2', bill_number: '2', bill_year: '2025' });
      } else {
        for (const key of ['document_key', 'bill_number', 'bill_year']) expect(doc.metadata).not.toHaveProperty(key);
      }
      if (link.ambiguous) expect(doc.metadata).not.toHaveProperty('file_url_source');
    }
  });
  it('preserves export metadata beyond the old allowlist and validates supplied claims', () => {
    const entry = { id: 'source-1', filename: 'bill.pdf', rank: 1 };
    const metadata = { n_chars: [...text].length, text_sha256: hash(text), retrieval_excluded: false, integrity: 'unknown', extra: { issuer: 'owner' } };
    expect(fromExportRecord(entry, metadata, text).metadata).toMatchObject(metadata);
    expect(() => fromExportRecord(entry, { ...metadata, n_chars: 1 }, text)).toThrow(/n_chars/);
  });
  it('records per-source validation failure and continues valid source records', async () => {
    await fixture([row({ id: 'bad', text_sha256: '0'.repeat(64) }), row()], {}, async (dir, links) => {
      const result = await readCorpus(dir, 'Feature', links, 2_000_000, 0);
      expect(result.docs.map((d) => d.source_key)).toEqual(['source-1']);
      expect(result.failed).toEqual([expect.objectContaining({ source_key: 'bad', error: expect.stringContaining('text_sha256') })]);
    });
  });
  it('checks actual UTF-16 request size even when the declared codepoint count is below the cap', async () => {
    await fixture([row()], {}, async (dir, links) => {
      const result = await readCorpus(dir, 'Feature', links, [...text].length, 0);
      expect(result.docs).toEqual([]);
      expect(result.skipped).toEqual([expect.objectContaining({ id: 'source-1', reason: 'too_large', utf16_chars: text.length })]);
    });
  });
  it('reports oversized declarations and explicit exclusions without dispatching them', async () => {
    await fixture([row({ id: 'large', n_chars: '2000001' }), row({ id: 'excluded', retrieval_excluded: 'True' })], {}, async (dir, links) => {
      const result = await readCorpus(dir, 'Feature', links, 2_000_000, 0);
      expect(result.docs).toEqual([]);
      expect(result.skipped.map((r) => r.reason)).toEqual(['too_large', 'retrieval_excluded']);
    });
  });
  it('rejects every duplicate current source identity instead of picking an arbitrary revision', async () => {
    await fixture([row(), row()], {}, async (dir, links) => {
      const result = await readCorpus(dir, 'Feature', links, 2_000_000, 0);
      expect(result.docs).toEqual([]);
      expect(result.failed).toHaveLength(2);
      expect(result.failed.every((f) => /duplicate/.test(f.error))).toBe(true);
    });
  });
  it('uses nonblank index values over conflicting sidecar fields and reports their names', async () => {
    await fixture([row({ source_host: 'index.test' })], { source_host: 'sidecar.test', licence_class: 'unconfirmed' }, async (dir, links) => {
      const result = await readCorpus(dir, 'Feature', links, 2_000_000, 0);
      expect(result.docs[0].metadata.source_host).toBe('index.test');
      expect(result.docs[0].metadata.licence_class).toBe('unconfirmed');
      expect(result.warnings).toEqual([{ source_key: 'source-1', fields: ['source_host'] }]);
    });
  });
  it('rejects a misassociated sidecar and invalid UTF-8 instead of dispatching altered text', async () => {
    await fixture([row()], { id: 'another-source' }, async (dir, links) => {
      const first = await readCorpus(dir, 'Feature', links, 2_000_000, 0);
      expect(first.failed[0].error).toMatch(/sidecar id/);
      await writeFile(path.join(dir, 'doc.md'), Buffer.from([0xff]));
      const second = await readCorpus(dir, 'Feature', links, 2_000_000, 0);
      expect(second.docs).toEqual([]);
      expect(second.failed).toHaveLength(1);
    });
  });
  it('CLI signals incomplete input after continuing valid records through a fake transport', async () => {
    await fixture([row({ id: 'bad', text_sha256: '0'.repeat(64) }), row()], {}, async (dir, links) => {
      const preload = path.join(dir, 'fake-fetch.mjs');
      await writeFile(preload, `globalThis.fetch = async (_url, init) => {
        const docs = JSON.parse(init.body).documents;
        if (docs.length !== 1 || docs[0].source_key !== 'source-1') throw Error('unexpected dispatched records');
        return new Response(JSON.stringify({results: docs.map(d => ({source_key:d.source_key,status:'indexed',chunks:1,inserted:1,kept:0,deleted:0,embedded_tokens:0,cost_usd:0})), totals:{documents:1,indexed:1,unchanged:0,errors:0,embedded_tokens:0,cost_usd:0}}));
      };`);
      const result = await promisify(execFile)(process.execPath, ['--import', pathToFileURL(preload).href,
        path.resolve('scripts/ingest-national-desk.mjs'), '--corpus', dir, '--feature', 'Feature', '--links', links],
      { cwd: dir, env: { SUPABASE_URL: 'https://unused.invalid', SUPABASE_SECRET_KEY: 'sb_secret_fixture' } })
        .then(() => ({ code: 0, stdout: '' }), (error) => error);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('text_sha256 mismatch');
      expect(result.stdout).toContain('indexed: 1');
      expect(result.stdout).toContain('errors: 1');
    });
  });
});

/** Builds a corpus fixture with one row per entry, each pointing at its own
 * markdown/metadata files. A row whose `write` is false gets no files on disk,
 * so any attempt to read it surfaces as an ENOENT-flavoured failure instead of
 * succeeding — that is how "never read from disk" is proven, not asserted. */
async function multiFixture(entries, run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ingest-corpus-multi-'));
  try {
    await mkdir(path.join(dir, '04_indexes'));
    const rows = entries.map((e, i) => row({
      id: e.id, document_name: e.id + '.pdf',
      source_path: `Section/${e.feature ?? 'Feature'}/${e.id}.pdf`,
      markdown_path: `doc-${i}.md`, metadata_path: `doc-${i}.json`,
      n_chars: String([...(e.text ?? text)].length), text_sha256: hash(e.text ?? text),
      ...e.rowExtra,
    }));
    const keys = Object.keys(rows[0]);
    const csv = [keys, ...rows.map((r) => keys.map((key) => r[key] ?? ''))]
      .map((cells) => cells.map((cell) => JSON.stringify(String(cell))).join(',')).join('\n');
    await writeFile(path.join(dir, '04_indexes/OCR_FILES.csv'), '﻿' + csv);
    for (const [i, e] of entries.entries()) {
      if (e.write === false) continue;
      await writeFile(path.join(dir, `doc-${i}.md`), e.text ?? text);
      await writeFile(path.join(dir, `doc-${i}.json`), JSON.stringify({ id: e.id }));
    }
    await writeFile(path.join(dir, 'links.json'), JSON.stringify({ links: {} }));
    await run(dir, path.join(dir, 'links.json'));
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe('--only bounded selector', () => {
  it('parseArgs collects a single --only into a one-element list', () => {
    const args = parseArgs(['--corpus', 'x', '--feature', 'F', '--only', 'source-1']);
    expect(args.only).toEqual(['source-1']);
  });

  it('parseArgs collects repeated --only flags into the exact set requested', () => {
    const args = parseArgs(['--corpus', 'x', '--feature', 'F', '--only', 'a', '--only', 'b']);
    expect(args.only).toEqual(['a', 'b']);
  });

  it('parseArgs rejects --only combined with --shard', () => {
    expect(() => parseArgs(['--corpus', 'x', '--feature', 'F', '--only', 'a', '--shard', '1/2']))
      .toThrow(/--only.*--shard|--shard.*--only/);
  });

  it('parseArgs rejects --only combined with --limit', () => {
    expect(() => parseArgs(['--corpus', 'x', '--feature', 'F', '--only', 'a', '--limit', '5']))
      .toThrow(/--only.*--limit|--limit.*--only/);
  });

  it('selects exactly the one requested source key out of several eligible rows', async () => {
    await multiFixture([{ id: 'source-1' }, { id: 'source-2' }, { id: 'source-3' }], async (dir, links) => {
      const result = await readCorpus(dir, 'Feature', links, 2_000_000, 0, null, new Set(['source-2']));
      expect(result.docs.map((d) => d.source_key)).toEqual(['source-2']);
    });
  });

  it('repeated --only (a set of two) selects exactly those two and never reads the third from disk', async () => {
    await multiFixture([
      { id: 'source-1' },
      { id: 'source-2' },
      { id: 'source-3', write: false }, // its files do not exist; reading it would fail loudly
    ], async (dir, links) => {
      const result = await readCorpus(dir, 'Feature', links, 2_000_000, 0, null, new Set(['source-1', 'source-2']));
      expect(result.docs.map((d) => d.source_key).sort()).toEqual(['source-1', 'source-2']);
      expect(result.failed).toEqual([]);
    });
  });

  it('fails loudly, naming every requested key that matched no eligible row', async () => {
    await multiFixture([{ id: 'source-1' }, { id: 'source-2' }], async (dir, links) => {
      await expect(readCorpus(dir, 'Feature', links, 2_000_000, 0, null, new Set(['source-1', 'missing-a', 'missing-b'])))
        .rejects.toThrow(/missing-a/);
      await expect(readCorpus(dir, 'Feature', links, 2_000_000, 0, null, new Set(['missing-a'])))
        .rejects.toThrow(/missing-b|missing-a/);
    });
  });

  it('the CLI exits non-zero and names the key when --only matches nothing, without dispatching anything', async () => {
    await multiFixture([{ id: 'source-1' }], async (dir, links) => {
      const preload = path.join(dir, 'fake-fetch.mjs');
      await writeFile(preload, `globalThis.fetch = async () => { throw new Error('must not be called'); };`);
      const result = await promisify(execFile)(process.execPath, ['--import', pathToFileURL(preload).href,
        path.resolve('scripts/ingest-national-desk.mjs'), '--corpus', dir, '--feature', 'Feature', '--links', links,
        '--only', 'nonexistent-key'],
      { cwd: dir, env: { SUPABASE_URL: 'https://unused.invalid', SUPABASE_SECRET_KEY: 'sb_secret_fixture' } })
        .then(() => ({ code: 0, stderr: '' }), (error) => error);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('nonexistent-key');
    });
  });

  it('a source key that belongs to a different feature is reported as not found, not silently skipped', async () => {
    await multiFixture([{ id: 'source-1', feature: 'Feature' }, { id: 'source-2', feature: 'Other' }], async (dir, links) => {
      await expect(readCorpus(dir, 'Feature', links, 2_000_000, 0, null, new Set(['source-2'])))
        .rejects.toThrow(/source-2/);
    });
  });

  it('an oversized selected document is still skipped under --max-chars, not dispatched', async () => {
    const big = 'x'.repeat(50);
    await multiFixture([{ id: 'source-1', text: big }], async (dir, links) => {
      const result = await readCorpus(dir, 'Feature', links, 10, 0, null, new Set(['source-1']));
      expect(result.docs).toEqual([]);
      expect(result.skipped).toEqual([expect.objectContaining({ id: 'source-1', reason: 'too_large' })]);
    });
  });

  it('CLI rejects --only paired with --manifest instead of silently ignoring the selector', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ingest-manifest-'));
    try {
      await writeFile(path.join(dir, 'doc.md'), text);
      await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
        documents: [{ source_key: 'm-1', title: 'M', ocr_file: 'doc.md',
          metadata: { n_chars: [...text].length, text_sha256: hash(text) } }],
      }));
      const preload = path.join(dir, 'fake-fetch.mjs');
      await writeFile(preload, `globalThis.fetch = async () => { throw new Error('must not be called'); };`);
      const result = await promisify(execFile)(process.execPath, ['--import', pathToFileURL(preload).href,
        path.resolve('scripts/ingest-national-desk.mjs'), '--manifest', path.join(dir, 'manifest.json'), '--only', 'm-1'],
      { cwd: dir, env: { SUPABASE_URL: 'https://unused.invalid', SUPABASE_SECRET_KEY: 'sb_secret_fixture' } })
        .then(() => ({ code: 0, stderr: '' }), (error) => error);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/--only/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
