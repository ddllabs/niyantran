// The OCR step and the identity checks of build, with Mistral stubbed: no network, no key, a synthetic three-page PDF.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../scripts/f281-repair/repair.mjs';
import { OCR_REQUEST_FLAGS } from '../../scripts/f281-repair/lib.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const PREFIX = 'aaaaaaaa';
const ID = `${PREFIX}-0000-4000-8000-000000000000`;
const WORDS = (seed, n) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ');

async function tinyPdf(pages = 3) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

describe('OCR with Mistral stubbed', () => {
  let dir;
  let work;
  let pdf;
  let calls;
  let respond;
  let out;
  let log;
  const oldText = `Order of the Commission. ${WORDS('w', 160)}`;
  const newPages = [`# ORDER OF THE COMMISSION\n\n${WORDS('w', 60)}`, WORDS('w', 60).replace(/w0\b/, 'w0') + ` ${WORDS('w', 160).split(' ').slice(60).join(' ')}`, 'Signed. The end of the order.'];

  const writeManifest = (extra = {}) => {
    const file = join(dir, 'manifest.json');
    writeFileSync(file, `${JSON.stringify({ ticket: 'F281', documents: [{ id: ID, prefix: PREFIX, label: 'test order', action: 'ocr', ocr_kind: 'any', pages: 3, source_url: 'https://www.cci.gov.in/images/antitrustorder/en/x.pdf', source_sha256: sha(pdf), ...extra }] })}\n`);
    return file;
  };
  const snapshot = (text) => {
    const row = { id: ID, title: 'CCI__x', file_name: 'x.pdf', file_url: null, desk_tier: 'national', desk_feature: 'Regulatory Body Watch (RBI SEBI TRAI CCI)', content_sha256: sha(text), indexed_at: '2026-09-21T06:00:00+00:00', chunker_version: 1, source_key: 'k'.repeat(40), storage_path: null, extract_hash: null, ocr_text: text, metadata: { n_chars: text.length, text_sha256: sha(text), ocr_lang: 'eng', n_pages: 3 } };
    const body = `${JSON.stringify({ read_at: 'x', chunk_count: 2, document: row }, null, 2)}\n`;
    mkdirSync(join(work, 'current'), { recursive: true });
    writeFileSync(join(work, 'current', `${PREFIX}.json`), body);
    writeFileSync(join(work, 'current', 'SHA256SUMS'), `${sha(body)}  ${PREFIX}.json\n`);
  };
  const mistral = (pages = newPages, indexes = [0, 1, 2]) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ model: 'mistral-ocr-stub', pages: pages.map((markdown, i) => ({ index: indexes[i], markdown, images: [], tables: [], header: null, footer: null })), usage_info: { pages_processed: 3 } })).buffer,
  });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'f281-ocr-'));
    work = join(dir, 'work');
    pdf = await tinyPdf();
    mkdirSync(join(work, 'pdf'), { recursive: true });
    writeFileSync(join(work, 'pdf', `${PREFIX}.pdf`), pdf);
    process.env.MISTRAL_API_KEY = 'stub-key';
    calls = [];
    respond = () => mistral();
    vi.stubGlobal('fetch', async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return respond();
    });
    out = [];
    log = vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
    process.exitCode = undefined;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    log.mockRestore();
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  const run = async (argv, manifest = writeManifest()) => {
    out.length = 0;
    let error = null;
    try {
      await main([...argv, '--manifest', manifest, '--work-dir', work, '--env', join(dir, 'no.env')], { sleep: async () => {} });
    } catch (e) {
      error = e;
    }
    return { out: out.join('\n'), error };
  };
  const partFile = () => join(work, 'ocr', PREFIX, 'part-0-2.json');

  it('without --go it prints the plan and spends nothing', async () => {
    const r = await run(['ocr']);
    expect(r.error).toBeNull();
    expect(r.out).toMatch(/3 pages, USD 0\.012/);
    expect(r.out).toMatch(/Plan only/);
    expect(calls).toEqual([]);
  });

  it('with --go it sends the verified bytes inline with the worker\'s request, and caches the part with its provenance', async () => {
    const r = await run(['ocr', '--go']);
    expect(r.error).toBeNull();
    expect(calls).toHaveLength(1);
    const body = calls[0].body;
    expect(calls[0].url).toBe('https://api.mistral.ai/v1/ocr');
    expect(body.model).toBe('mistral-ocr-4-1');
    expect(body.document.document_url).toBe(`data:application/pdf;base64,${pdf.toString('base64')}`);
    expect(body.pages).toEqual([0, 1, 2]);
    expect(body).toMatchObject(OCR_REQUEST_FLAGS);
    const part = JSON.parse(readFileSync(partFile(), 'utf8'));
    expect(part).toMatchObject({ valid: true, source_sha256: sha(pdf), model_requested: 'mistral-ocr-4-1', flags: OCR_REQUEST_FLAGS, requested: [0, 1, 2], cost_usd: 0.012 });
    // a rerun buys nothing
    calls.length = 0;
    expect((await run(['ocr', '--go'])).out).toMatch(/Nothing to buy/);
    expect(calls).toEqual([]);
  });

  it('refuses an unpinned PDF', async () => {
    const r = await run(['ocr', '--go'], writeManifest({ source_sha256: null }));
    expect(r.error?.message).toMatch(/not pinned/);
    expect(calls).toEqual([]);
  });

  it('saves a paid response that fails validation, counts it against the cap, and does not trust it', async () => {
    respond = () => mistral(newPages, [0, 1, 5]); // pages 0, 1 and 5: not the three that were asked for
    const r = await run(['ocr', '--go']);
    expect(r.error?.message).toMatch(/was paid for \(USD 0\.0120, kept and counted\) but did not validate/);
    const part = JSON.parse(readFileSync(partFile(), 'utf8'));
    expect(part.valid).toBe(false);
    expect(part.cost_usd).toBe(0.012);
    // the plan counts what was spent, and still has all three pages to buy
    const plan = await run(['ocr']);
    expect(plan.out).toMatch(/to buy {3}/);
    expect(plan.out).toMatch(/already spent on cached responses 0\.012/);
    // and the cap sees it: 0.012 spent + 0.012 more is above 0.02
    const capped = await run(['ocr', '--go', '--max-usd', '0.02']);
    expect(capped.error?.message).toMatch(/above --max-usd 0\.02/);
    expect(calls).toHaveLength(1);
  });

  describe('build from the cache', () => {
    beforeEach(async () => {
      snapshot(oldText);
      await run(['ocr', '--go']);
    });
    const build = async (extra) => {
      const r = await run(['build'], writeManifest(extra));
      const entry = JSON.parse(readFileSync(join(work, 'build', `${PREFIX}.review.json`), 'utf8'));
      return { r, entry };
    };

    it('builds the text, finds the old text in it, and describes the new source in the metadata (the old kept under previous)', async () => {
      const { r, entry } = await build();
      expect(r.error).toBeNull();
      expect(entry.checks.identity).toMatchObject({ level: 'ok', ok: true });
      expect(entry.checks.identity.share).toBeGreaterThan(0.5);
      const payload = JSON.parse(readFileSync(join(work, 'build', `${PREFIX}.payload.json`), 'utf8'));
      expect(payload.metadata.ocr_lang).toBe('mistral-ocr-4-1');
      expect(payload.metadata.text_repair).toMatchObject({ action: 'ocr', ocr_model: 'mistral-ocr-4-1', source_sha256: sha(pdf), previous: { ocr_lang: 'eng' } });
      expect(JSON.parse(readFileSync(join(work, 'build', 'review.json'), 'utf8')).documents[PREFIX].text_sha256).toBe(sha(readFileSync(join(work, 'build', `${PREFIX}.text.txt`))));
    });

    it('fails a new text that does not contain the old one (the OCR is of another document)', async () => {
      const part = JSON.parse(readFileSync(partFile(), 'utf8'));
      part.pages = part.pages.map((p) => ({ ...p, markdown: WORDS('zz', 80) }));
      writeFileSync(partFile(), JSON.stringify(part));
      const { r, entry } = await build();
      expect(r.error?.message).toMatch(/failed their checks/);
      expect(entry.failed).toContain('identity');
      expect(entry.checks.identity.level).toBe('fail');
    });

    it('asks for a look, and shows the first page, when the stored text is garbage and cannot be compared', async () => {
      const part = JSON.parse(readFileSync(partFile(), 'utf8'));
      part.pages = part.pages.map((p) => ({ ...p, markdown: p.index === 0 ? '# COMPETITION COMMISSION OF INDIA\nCase No. 11 of 2009\n' + WORDS('zz', 80) : WORDS('zz', 80) }));
      writeFileSync(partFile(), JSON.stringify(part));
      const { entry } = await build({ old_text_garbage: true });
      expect(entry.checks.identity).toMatchObject({ level: 'look', ok: true });
      expect(entry.notes.attention.join(' ')).toMatch(/cannot be measured; first page reads: COMPETITION COMMISSION OF INDIA/);
      expect(readFileSync(join(work, 'build', 'review.md'), 'utf8')).toMatch(/first page reads: COMPETITION COMMISSION OF INDIA/);
    });

    it('refuses a cached part made from another PDF, with another model or flags, or that never validated', async () => {
      const original = readFileSync(partFile(), 'utf8');
      for (const [patch, message] of [
        [{ source_sha256: 'f'.repeat(64) }, /source_sha256/],
        [{ model_requested: 'mistral-ocr-3' }, /model/],
        [{ flags: { ...OCR_REQUEST_FLAGS, table_format: 'html' } }, /request flags/],
        [{ valid: false }, /did not validate/],
      ]) {
        writeFileSync(partFile(), JSON.stringify({ ...JSON.parse(original), ...patch }));
        const { r, entry } = await build();
        expect(r.error?.message).toMatch(/failed their checks/);
        expect(entry.error).toMatch(message);
      }
    });

    it('lists empty OCR pages for a person to see', async () => {
      const part = JSON.parse(readFileSync(partFile(), 'utf8'));
      part.pages[2].markdown = '';
      writeFileSync(partFile(), JSON.stringify(part));
      const { entry } = await build();
      expect(entry.notes.empty_pages).toEqual([3]);
      expect(readFileSync(join(work, 'build', 'review.md'), 'utf8')).toMatch(/Empty OCR pages: 3/);
    });
  });
});
