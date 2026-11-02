import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ingestOne, validateDocument } from '../../supabase/functions/ingest-documents/handler.ts';
import { composeDocument } from '../../supabase/functions/_shared/pageText.ts';
import {
  GLYPH_TABLE,
  IDENTITY_THRESHOLDS,
  buildRollbackPayload,
  identityVerdict,
  oldTextContainment,
  assertNoControlCodes,
  assertRepairable,
  buildRepairPayload,
  codePointLength,
  countControlCodes,
  chooseTitle,
  decodeShiftedText,
  extractPrintedTitle,
  identityProblems,
  printedBillNo,
  ocrChecks,
  ocrPagesToDocument,
  ocrPagesToText,
  sha256Hex,
  stripLeadingForeignCover,
  titleCase,
  titleRefs,
  titlesAgree,
} from './documentRepair.js';

// ---------------------------------------------------------------------------------------------
// Shifted text. In the two broken Bills (fb64d5ac, 1f1ce52a) the PDF's own text layer is the
// glyph-ID numbering of an embedded font with no ToUnicode map: glyph ID = ASCII code - 29, so a
// space is 0x03 and "T" is "7". The report's literal example is below; `shift` makes more.
// ---------------------------------------------------------------------------------------------
const REPORT_STORED = '7+(\x037$;$7,21\x03/$:6'; // "THE TAXATION LAWS", as stored
const shift = (s) => [...s].map((c) => String.fromCharCode(c.charCodeAt(0) - 29)).join('');

const item = (str, fontName, y, extra = {}) => ({ str, fontName, x: 0, y, ...extra });

describe('decodeShiftedText', () => {
  it('decodes the report example', () => {
    expect(shift('THE TAXATION LAWS')).toBe(REPORT_STORED);
    const r = decodeShiftedText([[item(REPORT_STORED, 'g_d0_f4', 700)]]);
    expect(r.text).toBe('THE TAXATION LAWS');
  });

  it('leaves a plain font alone and joins items that share a line', () => {
    const pages = [[
      item('Bill No. 105', 'plain', 700),
      item(shift('-F '), 'shifted', 700),
      item('of 2025', 'plain', 700),
      item(REPORT_STORED, 'shifted', 700),
    ]];
    expect(decodeShiftedText(pages).text).toBe('Bill No. 105-F of 2025THE TAXATION LAWS');
  });

  it('decodes the codes a text extractor turns into spaces: 0x0b and 0x0c are the brackets, 0x20 is "="', () => {
    // pdf.js getTextContent loses these (it replaces whitespace-like codes); the operator list keeps them.
    const run = shift('(a) after clause (12A), x = y & z');
    expect(run).toContain('\x0b');
    expect(run).toContain('\x0c');
    expect(run).toContain(' ');
    expect(decodeShiftedText([[item(run, 'shifted', 700)]]).text).toBe('(a) after clause (12A), x = y & z');
  });

  it('maps the dash and quote glyphs of the Times New Roman subset', () => {
    // Measured on the two PDFs by glyph advance width and by the rendered page (docs/research/2026-11-01-f281-broken-documents.md, section 4).
    expect(GLYPH_TABLE).toEqual({
      '±': '–', // 500 wide: en dash (two of them close "namely:")
      '²': '—', // 1000 wide: em dash
      '³': '“', // 444 wide: opening double quote
      '´': '”', // 444 wide: closing double quote
      'µ': '‘', // 333 wide: opening single quote
      'μ': '‘', // pdf.js reports U+00B5 as Greek mu
      '¶': '’', // 333 wide: closing single quote
      'ʊ': '—', // 1000 wide: second em dash glyph in the Manipur Bill
    });
    const glyphs = '²±³´µμ¶ʊ';
    const r = decodeShiftedText([[item(`${shift('namely:')}${glyphs}`, 'shifted', 700), item(REPORT_STORED, 'shifted', 700)]]);
    expect(r.text).toBe('namely:—–“”‘‘’—THE TAXATION LAWS');
    expect(r.unmapped).toEqual({});
  });

  it('replaces a code it cannot map with U+FFFD and reports it; zero-width codes vanish', () => {
    const r = decodeShiftedText([[item(`${shift('AB')}é\x01\x02${shift('CD')}`, 'shifted', 700), item(REPORT_STORED, 'shifted', 690)]]);
    expect(r.text).toBe('AB\ufffdCD\nTHE TAXATION LAWS');
    expect(r.unmapped).toEqual({ 'é': 1 });
  });

  describe('which fonts are shifted', () => {
    it('a font whose text is full of control codes is shifted; a clean one is not', () => {
      const r = decodeShiftedText([[item('Hello world', 'plain', 700), item(REPORT_STORED, 'shifted', 690)]]);
      const by = Object.fromEntries(r.fonts.map((f) => [f.font, f]));
      expect(by.plain.verdict).toBe('plain');
      expect(by.shifted.verdict).toBe('shifted');
      expect(by.shifted.reason).toBe('control_codes');
      expect(r.text).toBe('Hello world\nTHE TAXATION LAWS');
    });

    it('one stray control code in a long plain run does not turn the font shifted', () => {
      const r = decodeShiftedText([[item(`${'abcdefghij'.repeat(10)}\x07`, 'plain', 700)]]);
      expect(r.fonts[0].verdict).toBe('plain');
    });

    it('a tiny composite font with no control code is shifted when its sibling fonts are (the "F" of 105-F)', () => {
      const pages = [[item(REPORT_STORED, 'big', 700), item(')', 'tiny', 690)]];
      const without = decodeShiftedText(pages);
      expect(without.text).toBe('THE TAXATION LAWS\n)');
      const withHints = decodeShiftedText(pages, { fonts: { big: { composite: true }, tiny: { composite: true } } });
      expect(withHints.text).toBe('THE TAXATION LAWS\nF');
      expect(withHints.fonts.find((f) => f.font === 'tiny').reason).toBe('composite_sibling');
    });

    it('a composite font in a document with no shifted font is left alone', () => {
      const r = decodeShiftedText([[item('Hello', 'a', 700)]], { fonts: { a: { composite: true } } });
      expect(r.text).toBe('Hello');
    });
  });

  describe('layout', () => {
    it('starts a line when y changes, separates paragraphs by a larger gap, and pages by a blank line', () => {
      const page1 = [item('one', 'plain', 700), item('two', 'plain', 686), item('three', 'plain', 640)];
      const page2 = [item('four', 'plain', 700)];
      expect(decodeShiftedText([page1, page2]).text).toBe('one\ntwo\n\nthree\n\nfour');
    });

    it('starts a new line for a run that begins far to the right of the previous one (a margin note)', () => {
      const body = { ...item('Short title text', 'plain', 700), x: 40, endX: 300 };
      const note = { ...item('Amendment of section 10.', 'plain', 700), x: 480, endX: 560 };
      const next = { ...item('more body', 'plain', 700), x: 305, endX: 360 };
      expect(decodeShiftedText([[body, note]]).text).toBe('Short title text\nAmendment of section 10.');
      expect(decodeShiftedText([[body, next]]).text).toBe('Short title textmore body');
    });

    it('reads a gap between runs of one line as a word space, and no gap as none', () => {
      // Word writes the space between words as a TJ adjustment, not as a glyph; the loader cuts the run there.
      const a = { ...item('Bill', 'plain', 700), x: 40, endX: 60, size: 10 };
      const gapped = { ...item('No.', 'plain', 700), x: 63, endX: 80, size: 10 };
      const glued = { ...item('s', 'plain', 700), x: 60.4, endX: 66, size: 10 };
      expect(decodeShiftedText([[a, gapped]]).text).toBe('Bill No.');
      expect(decodeShiftedText([[a, glued]]).text).toBe('Bills');
      expect(decodeShiftedText([[a, { ...gapped, size: undefined }]]).text).toBe('BillNo.');
    });

    it('collapses runs of spaces and trims line ends', () => {
      expect(decodeShiftedText([[item('a   b  ', 'plain', 700), item('c  d', 'plain', 700)]]).text).toBe('a b c d');
    });
  });

  describe('assertNoControlCodes', () => {
    it('fails on the stored shifted text, with a count', () => {
      expect(countControlCodes(REPORT_STORED)).toBe(2);
      expect(() => assertNoControlCodes(REPORT_STORED)).toThrow(/2 control code/);
      expect(() => assertNoControlCodes('Bill No. 105\u0010)\u0003of 2025')).toThrow(/control code/);
    });

    it('fails on the raw extraction of the same page and passes on its decoding', () => {
      const pages = [[item('Bill No. 105', 'plain', 700), item(shift('-F '), 'shifted', 700), item(REPORT_STORED, 'shifted', 690)]];
      const raw = pages[0].map((i) => i.str).join('');
      expect(() => assertNoControlCodes(raw)).toThrow(/control code/);
      expect(() => assertNoControlCodes(decodeShiftedText(pages).text)).not.toThrow();
    });

    it('allows tab, newline and carriage return, and refuses form feed, NUL and DEL', () => {
      expect(() => assertNoControlCodes('a\tb\nc\r\nd')).not.toThrow();
      expect(() => assertNoControlCodes('a\fb')).toThrow(/control code/);
      expect(() => assertNoControlCodes('a\x00b')).toThrow(/control code/);
      expect(() => assertNoControlCodes('a\x7fb')).toThrow(/control code/);
    });

    it('names where the first ones are without echoing the text', () => {
      let message = '';
      try {
        assertNoControlCodes(`ordinary words here ${REPORT_STORED}`);
      } catch (e) {
        message = e.message;
      }
      expect(message).toContain('offset 23');
      expect(message).not.toContain('TAXATION');
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('stripLeadingForeignCover', () => {
  const cover = 'RAJYA SABHA\nA\nBILL\nto amend the Other Act, 1993.\n\n';
  const body = 'AS INIRODUCED IN THE RAJYA SABHA\nBill No. LI of 2000\nTHE PASSPORT BILL';

  it('removes everything before the marker and keeps the marker', () => {
    const r = stripLeadingForeignCover(cover + body, 'AS INIRODUCED IN THE RAJYA SABHA');
    expect(r.text).toBe(body);
    expect(r.removed).toBe(cover);
  });

  it('refuses when the marker is missing', () => {
    expect(() => stripLeadingForeignCover(cover + body, 'AS INTRODUCED')).toThrow(/not found/);
  });

  it('refuses when the marker appears more than once', () => {
    expect(() => stripLeadingForeignCover(`${cover}${body}\n${body}`, 'AS INIRODUCED IN THE RAJYA SABHA')).toThrow(/2 times/);
  });

  it('refuses an empty marker and a marker at the very start (nothing to strip)', () => {
    expect(() => stripLeadingForeignCover(body, '')).toThrow(/marker/);
    expect(() => stripLeadingForeignCover(body, 'AS INIRODUCED')).toThrow(/nothing to strip/);
  });

  it('refuses to cut more than maxRemoved characters, so a wrong marker cannot eat the document', () => {
    const long = `${'x '.repeat(600)}${body}`;
    expect(() => stripLeadingForeignCover(long, 'AS INIRODUCED IN THE RAJYA SABHA')).toThrow(/maxRemoved/);
    expect(stripLeadingForeignCover(long, 'AS INIRODUCED IN THE RAJYA SABHA', { maxRemoved: 2000 }).text).toBe(body);
  });
});

// ---------------------------------------------------------------------------------------------
describe('ocrPagesToText', () => {
  const page = (index, markdown, extra = {}) => ({ index, markdown, images: [], tables: [], header: null, footer: null, ...extra });

  it('joins pages in index order with a blank line, whatever order they arrive in', () => {
    expect(ocrPagesToText([page(1, 'two'), page(0, 'one'), page(2, 'three')])).toBe('one\n\ntwo\n\nthree');
  });

  it('inlines a table in place of its placeholder', () => {
    const tables = [{ id: 'tbl-0.md', content: '| a | b |\n|---|---|\n| 1 | 2 |' }];
    expect(ocrPagesToText([page(0, 'Rates:\n\n[tbl-0.md](tbl-0.md)\n\nEnd', { tables })])).toBe('Rates:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nEnd');
  });

  it('puts a header and a footer that are not running lines back around the page body', () => {
    expect(ocrPagesToText([page(0, 'body', { header: 'AS INTRODUCED', footer: 'Printed in 2026' })])).toBe('AS INTRODUCED\n\nbody\n\nPrinted in 2026');
  });

  it('drops a running header that repeats across the document', () => {
    const pages = [0, 1, 2, 3].map((i) => page(i, `body ${i}`, { header: `Page ${i}\nCOMPETITION COMMISSION` }));
    const text = ocrPagesToText(pages);
    expect(text).not.toContain('COMPETITION COMMISSION');
    expect(text).toContain('body 3');
  });

  it('removes image placeholders (the legacy documents have no image store) and tidies the gap', () => {
    const md = 'Before\n\n![img-0.jpeg](img-0.jpeg)\n\nAfter';
    expect(ocrPagesToText([page(0, md, { images: [{ id: 'img-0.jpeg' }] })])).toBe('Before\n\nAfter');
    expect(ocrPagesToText([page(0, md, { images: [{ id: 'img-0.jpeg' }] })], { keepImages: true })).toContain('![img:1-0](img:1-0)');
  });

  it('keeps an empty page as an empty page and lists it', () => {
    const d = ocrPagesToDocument([page(0, 'one'), page(1, ''), page(2, 'three')]);
    expect(d.text).toBe('one\n\n\n\nthree');
    expect(d.emptyPages).toEqual([2]);
  });

  it('refuses an incomplete response: a missing, duplicated or unexpected page index', () => {
    expect(() => ocrPagesToText([page(0, 'a'), page(2, 'c')])).toThrow(/contiguous/);
    expect(() => ocrPagesToText([page(0, 'a'), page(0, 'b')])).toThrow(/duplicate/);
    expect(() => ocrPagesToText([page(0, 'a'), page(1, 'b')], { expectedPages: 3 })).toThrow(/expected 3 pages/);
    expect(() => ocrPagesToText([])).toThrow(/no pages/);
  });

  it('reports a table placeholder that has no table behind it, and refuses it unless allowed', () => {
    const pages = [page(0, 'see [tbl-9.md](tbl-9.md)')];
    expect(ocrPagesToDocument(pages).unresolvedTables).toEqual([{ page_number: 1, id: 'tbl-9.md' }]);
    expect(() => ocrPagesToText(pages)).toThrow(/unresolved table/);
    expect(ocrPagesToText(pages, { allowUnresolvedTables: true })).toBe('see [tbl-9.md](tbl-9.md)');
  });

  it('is the worker\'s own composition for a real Mistral response (supabase/functions/_shared/pageText.ts)', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../supabase/functions/_shared/__fixtures__/mistral-bill-12p.json', import.meta.url), 'utf8'));
    expect(fixture.pages.some((p) => p.images.length)).toBe(false);
    expect(ocrPagesToText(fixture.pages, { expectedPages: 12 })).toBe(composeDocument(fixture.pages).ocrText);
  });
});

// ---------------------------------------------------------------------------------------------
describe('ocrChecks', () => {
  it('reports characters per page and flags a thin document', () => {
    const r = ocrChecks('x'.repeat(1200), 'any', { pages: 3 });
    expect(r.chars).toBe(1200);
    expect(r.charsPerPage).toBe(400);
    expect(r.lowDensity).toBe(true);
    expect(ocrChecks('x'.repeat(9000), 'any', { pages: 3 }).lowDensity).toBe(false);
    expect(ocrChecks('abc', 'any').charsPerPage).toBeNull();
  });

  describe('cci-order', () => {
    const order = ['1. This order arises from information filed.', '1.1 The informant is a company.', '2. Facts of the case', '2.1 The opposite party is a firm.', '3. Issues', '4. Analysis', '5.5.15 In view of the above', '6. Findings', '7. Order', '8.15 So ordered.'].join('\n\n');

    it('gives the first and last numbered paragraphs and says the numbering runs on', () => {
      const p = ocrChecks(order, 'cci-order', { pages: 4 }).paragraphs;
      expect(p.first).toBe('1');
      expect(p.last).toBe('8.15');
      expect(p.startsAtOne).toBe(true);
      expect(p.contiguous).toBe(true);
      expect(p.largeGaps).toEqual([]);
      expect(p.count).toBe(10);
    });

    it('reads paragraph numbers through markdown markers and ignores years and counts inside a line', () => {
      const text = ['## 1. Background', '**2.** Facts', 'In 2009 the filing was made', '30 days later', '3. Law'].join('\n');
      const p = ocrChecks(text, 'cci-order').paragraphs;
      expect(p.numbers).toEqual(['1', '2', '3']);
    });

    it('shows a stored fragment that starts mid-order', () => {
      const p = ocrChecks('7.2.2 The Commission notes\n\n7.3 Further\n\n8.9 Held', 'cci-order').paragraphs;
      expect(p.first).toBe('7.2.2');
      expect(p.startsAtOne).toBe(false);
    });

    it('finds a large gap in the numbering', () => {
      const p = ocrChecks('1. A\n\n2. B\n\n3. C\n\n9. D\n\n10. E', 'cci-order').paragraphs;
      expect(p.contiguous).toBe(false);
      expect(p.largeGaps).toEqual([[3, 9]]);
    });

    it('a one-number hole is not a large gap', () => {
      expect(ocrChecks('1. A\n\n2. B\n\n4. D', 'cci-order').paragraphs.contiguous).toBe(true);
    });

    it('a document with no numbered paragraph says so', () => {
      const p = ocrChecks('just words', 'cci-order').paragraphs;
      expect(p.count).toBe(0);
      expect(p.first).toBeNull();
      expect(p.contiguous).toBe(false);
    });
  });

  describe('bilingual-gazette', () => {
    const english = 'Telecommunication Consumers Education and Protection Fund Amendment Regulations were published by the Authority in the Gazette';
    const hindi = 'दूरसंचार उपभोक्ता शिक्षा एवं संरक्षण निधि संशोधन विनियम प्राधिकरण द्वारा प्रकाशित';
    const noise = 'Rea sTT fqRT ufcT HTtfiT Qkfg cpqtrs bcdfgh fRRTT ZzZz xxyzzq';

    it('counts Devanagari against Latin letters', () => {
      const s = ocrChecks(`${english}\n${hindi}`, 'bilingual-gazette').scripts;
      expect(s.devanagariShare).toBeGreaterThan(0.3);
      expect(s.devanagariShare).toBeLessThan(0.7);
      expect(s.latinNoiseShare).toBeLessThan(0.1);
    });

    it('a Hindi column read as Latin gibberish shows no Devanagari and a high noise share', () => {
      const s = ocrChecks(`${english}\n${noise}\n${noise}`, 'bilingual-gazette').scripts;
      expect(s.devanagariShare).toBe(0);
      expect(s.latinNoiseShare).toBeGreaterThan(0.4);
    });

    it('plain English has no Devanagari and little noise', () => {
      const s = ocrChecks(`${english} ${english}`, 'bilingual-gazette').scripts;
      expect(s.devanagariShare).toBe(0);
      expect(s.latinNoiseShare).toBeLessThan(0.1);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The payload. Shaped like documents.metadata of e4a7d7d2 and fb64d5ac on NTER (synthetic values).
// ---------------------------------------------------------------------------------------------
const OLD_TEXT = 'THE CLIMATE CHANGE BILL old text';
const rekeyRow = () => ({
  id: 'e4a7d7d2-0000-4000-8000-000000000000',
  source_key: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  title: 'The Climate Change Bill, 2012.',
  file_name: '1748LS.pdf',
  file_url: 'https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/1748LS.pdf?source=legislation',
  desk_tier: 'national',
  desk_feature: 'Bill Passage Probability Index',
  content_sha256: 'old',
  chunker_version: 1,
  indexed_at: '2026-09-21T07:08:49.589+00:00',
  storage_path: null,
  extract_hash: null,
  ocr_text: OLD_TEXT,
  metadata: {
    as_of: '2026-09-09', house: 'Lok Sabha', status: 'Lapsed', n_chars: OLD_TEXT.length, n_pages: 6, doc_type: 'bill', ocr_lang: 'paddleocr-vl',
    bill_year: '2012', integrity: 'ok', file_mtime: '2026-09-08T19:05:36Z', title_stem: '1748LS', bill_number: '74', source_host: 'sansad.in',
    source_path: 'x/1748LS.pdf', text_sha256: 'old', document_key: 'bill:2012:74', document_role: 'as_introduced', licence_class: 'gazette_s52_1_q_i_unconfirmed',
    file_url_source: 'corpus bill_record record', document_role_source: 'sansad_url_folder',
  },
});
const decodeRow = () => ({
  id: 'fb64d5ac-0000-4000-8000-000000000000',
  source_key: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  title: 'THE TAXATION LAWS (AMENDMENT) BILL, 2025',
  file_name: 'Tax828202552938PM.pdf',
  file_url: 'https://sansad.in/getFile/BillsTexts/LSBillTexts/PassedBothHouses/Tax828202552938PM.pdf?source=legislation',
  desk_tier: 'national',
  desk_feature: 'Bill Passage Probability Index',
  content_sha256: 'old',
  chunker_version: 2,
  storage_path: null,
  extract_hash: null,
  ocr_text: REPORT_STORED,
  metadata: {
    role: 'as_passed_both_houses', house: 'Lok Sabha', status: 'Assented', bill_year: '2025', bill_number: '105', n_chars: REPORT_STORED.length, text_sha256: 'old',
    document_key: 'bill:2025:105', document_role: 'as_passed_both_houses', file_url_ambiguous: false,
    file_url_source: 'citation pack; current listing download URL and actual PDF identity checked',
    links: [{ role: 'as_passed_both_houses', house: 'Lok Sabha', status: 'Assented', row_key: null, bill_name: 'THE TAXATION LAWS (AMENDMENT) BILL, 2025', document_key: 'bill:2025:105' }],
  },
});

/** The Edge Function's own ingestOne against a stub database holding `existing`: what would be written. */
async function serverWrite(existing, payload) {
  const written = {};
  const deps = {
    secretKey: 'x',
    embed: async (inputs) => ({ vectors: inputs.map(() => [0]), promptTokens: inputs.length, costUsd: 0, model: 'stub', requests: 1 }),
    db: {
      findDocument: async () => ({ id: existing.id, content_sha256: existing.content_sha256, chunker_version: existing.chunker_version, metadata: existing.metadata, extract_hash: existing.extract_hash ?? null, storage_path: existing.storage_path ?? null }),
      upsertDocument: async (row) => ((written.row = row), { id: existing.id }),
      updateDocumentMeta: async (id, fields) => (written.meta = fields),
      existingHashes: async () => new Set(),
      chunkCommit: async (_id, rows) => ({ inserted: rows.length, kept: 0, deleted: 0 }),
      markIndexed: async () => {},
      logCall: async () => {},
    },
  };
  const result = await ingestOne(deps, validateDocument(payload), false);
  return { result, written: written.row ?? written.meta };
}

describe('buildRepairPayload', () => {
  const TEXT = 'THE TAXATION LAWS (AMENDMENT) BILL, 2025\n\nBE it enacted by Parliament.';

  it('has exactly the fields scripts/ingest-national-desk.mjs sends, and the server accepts it', async () => {
    const payload = await buildRepairPayload(decodeRow(), { text: TEXT, action: 'decode' });
    expect(Object.keys(payload).sort()).toEqual(['desk_feature', 'desk_tier', 'file_name', 'file_url', 'metadata', 'ocr_text', 'source_key', 'title']);
    expect(() => validateDocument(payload)).not.toThrow();
    expect(payload.ocr_text).toBe(TEXT);
  });

  it('round-trips every field that is not being repaired', async () => {
    const existing = decodeRow();
    const payload = await buildRepairPayload(existing, { text: TEXT, action: 'decode' });
    for (const key of ['source_key', 'title', 'file_name', 'file_url', 'desk_tier', 'desk_feature']) expect(payload[key]).toBe(existing[key]);
    const { n_chars, text_sha256, text_repair, ...rest } = payload.metadata;
    const { n_chars: _n, text_sha256: _t, ...before } = existing.metadata;
    expect(rest).toEqual(before);
    expect(n_chars).toBe(codePointLength(TEXT));
    expect(text_sha256).toBe(await sha256Hex(TEXT));
    expect(text_repair).toMatchObject({ ticket: 'F281', action: 'decode' });
  });

  it('does not mutate the row it was given', async () => {
    const existing = decodeRow();
    const copy = JSON.parse(JSON.stringify(existing));
    await buildRepairPayload(existing, { text: TEXT, action: 'decode' });
    expect(existing).toEqual(copy);
  });

  it('a decode repair, run through the real ingestOne, changes the text claims and nothing else', async () => {
    const existing = decodeRow();
    const payload = await buildRepairPayload(existing, { text: TEXT, action: 'decode' });
    const { result, written } = await serverWrite(existing, payload);
    expect(result.status).toBe('indexed');
    expect(written.title).toBe(existing.title);
    expect(written.content_sha256).toBe(await sha256Hex(TEXT));
    const { n_chars, text_sha256, text_repair, ...after } = written.metadata;
    const { n_chars: _n, text_sha256: _t, ...before } = existing.metadata;
    expect(after).toEqual(before);
    expect(n_chars).toBe(codePointLength(TEXT));
    expect(text_sha256).toBe(await sha256Hex(TEXT));
  });

  it('why the text claims are refreshed: the stored n_chars and text_sha256 would be refused by the server', async () => {
    const existing = decodeRow();
    const naive = { source_key: existing.source_key, title: existing.title, ocr_text: TEXT, metadata: existing.metadata };
    const { result } = await serverWrite(existing, naive).then((r) => r, (e) => ({ result: { status: 'threw', error: e.message } }));
    expect(result.status).toBe('threw');
    expect(result.error).toMatch(/n_chars mismatch/);
  });

  describe('re-key', () => {
    const rekey = { document_key: 'bill:2005:96', title: 'The National Child Welfare Board Bill, 2005' };

    it('applies a new title and key, and moves the number and year with the key', async () => {
      const payload = await buildRepairPayload(rekeyRow(), { text: OLD_TEXT, action: 'rekey', rekey });
      expect(payload.title).toBe('The National Child Welfare Board Bill, 2005');
      expect(payload.metadata.document_key).toBe('bill:2005:96');
      expect(payload.metadata.bill_number).toBe('96');
      expect(payload.metadata.bill_year).toBe('2005');
    });

    it('keeps source_key, the file and every other metadata field', async () => {
      const existing = rekeyRow();
      const payload = await buildRepairPayload(existing, { text: OLD_TEXT, action: 'rekey', rekey });
      for (const key of ['source_key', 'file_name', 'file_url', 'desk_tier', 'desk_feature']) expect(payload[key]).toBe(existing[key]);
      const { document_key, bill_number, bill_year, text_repair, n_chars, text_sha256, ...rest } = payload.metadata;
      const { document_key: _d, bill_number: _b, bill_year: _y, n_chars: _n, text_sha256: _t, ...before } = existing.metadata;
      expect(rest).toEqual(before);
      expect(n_chars).toBe(existing.metadata.n_chars);
    });

    it('through the real ingestOne the old key fields are replaced, not left beside the new ones', async () => {
      const existing = rekeyRow();
      const payload = await buildRepairPayload(existing, { text: OLD_TEXT, action: 'rekey', rekey });
      const { result, written } = await serverWrite(existing, payload);
      expect(result.status).toBe('indexed'); // chunker_version 1 against version 2: a full re-chunk, as the report says
      expect(written.title).toBe('The National Child Welfare Board Bill, 2005');
      expect(written.metadata).toMatchObject({ document_key: 'bill:2005:96', bill_number: '96', bill_year: '2005', house: 'Lok Sabha', status: 'Lapsed', file_url_source: 'corpus bill_record record' });
      expect(written.metadata.file_url_ambiguous).toBeUndefined();
    });

    it('without the number and year following the key, the server would keep the old ones (the trap this avoids)', async () => {
      const existing = rekeyRow();
      const trap = { source_key: existing.source_key, title: rekey.title, ocr_text: OLD_TEXT, metadata: { document_key: rekey.document_key } };
      const { written } = await serverWrite(existing, trap);
      // mergeDocumentMetadata deletes the old identity fields and writes only those supplied.
      expect(written.metadata.document_key).toBe('bill:2005:96');
      expect(written.metadata.bill_number).toBeUndefined();
    });

    it('lets the caller override house and status from the listing', async () => {
      const payload = await buildRepairPayload(rekeyRow(), { text: OLD_TEXT, action: 'rekey', rekey: { ...rekey, house: 'Rajya Sabha', status: 'Pending' } });
      expect(payload.metadata).toMatchObject({ house: 'Rajya Sabha', status: 'Pending' });
    });

    it('refuses a malformed key, a missing title, and a record that carries links to the old key', async () => {
      await expect(buildRepairPayload(rekeyRow(), { text: OLD_TEXT, action: 'rekey', rekey: { ...rekey, document_key: '2005:96' } })).rejects.toThrow(/document_key/);
      await expect(buildRepairPayload(rekeyRow(), { text: OLD_TEXT, action: 'rekey', rekey: { document_key: 'bill:2005:96' } })).rejects.toThrow(/title/);
      const linked = rekeyRow();
      linked.metadata.links = [{ document_key: 'bill:2012:74' }];
      await expect(buildRepairPayload(linked, { text: OLD_TEXT, action: 'rekey', rekey })).rejects.toThrow(/links/);
    });

    it('refuses a re-key to the key the document already has', async () => {
      await expect(buildRepairPayload(rekeyRow(), { text: OLD_TEXT, action: 'rekey', rekey: { document_key: 'bill:2012:74', title: 'x' } })).rejects.toThrow(/already/);
    });
  });

  it('refuses a repair that is not a repair: empty text, or a rekey object on a text action', async () => {
    await expect(buildRepairPayload(decodeRow(), { text: '   ', action: 'decode' })).rejects.toThrow(/text/);
    await expect(buildRepairPayload(decodeRow(), { text: TEXT, action: 'decode', rekey: { document_key: 'bill:2025:106', title: 'x' } })).rejects.toThrow(/rekey/);
  });
});

describe('assertRepairable', () => {
  it('accepts a legacy document and refuses the kinds ingest-documents refuses or the repair must not touch', () => {
    expect(() => assertRepairable(rekeyRow())).not.toThrow();
    expect(() => assertRepairable({ ...rekeyRow(), storage_path: 'files/x.pdf' })).toThrow(/storage_path/);
    expect(() => assertRepairable({ ...rekeyRow(), extract_hash: 'abc' })).toThrow(/extract_hash/);
    expect(() => assertRepairable({ ...rekeyRow(), metadata: { ...rekeyRow().metadata, origin: 'supplied-text' } })).toThrow(/supplied-text/);
    expect(() => assertRepairable({ ...rekeyRow(), chunker_version: 4 })).toThrow(/section-context/);
    expect(() => assertRepairable({ ...rekeyRow(), metadata: { ...rekeyRow().metadata, file_url_ambiguous: true } })).toThrow(/ambiguous/);
    expect(() => assertRepairable({ ...rekeyRow(), source_key: null })).toThrow(/source_key/);
    expect(() => assertRepairable({ ...rekeyRow(), source_key: 'upload:abc' })).toThrow(/upload/);
  });
});

// ---------------------------------------------------------------------------------------------
// Titles: the printed title of a text, and which title a re-keyed document gets.
// ---------------------------------------------------------------------------------------------
describe('titleCase', () => {
  it('turns an all-capitals title into the listing form and leaves a mixed-case one alone', () => {
    expect(titleCase('THE CONTRACT LABOUR (REGULATION AND ABOLITION) (AMENDMENT) BILL, 2005')).toBe('The Contract Labour (Regulation and Abolition) (Amendment) Bill, 2005');
    expect(titleCase('THE LAYOUT-DESIGN BILL, 2000')).toBe('The Layout-Design Bill, 2000');
    expect(titleCase('THE APPROPRIATION (RAILWAYS) NO. 2 ACT, 2003')).toBe('The Appropriation (Railways) No. 2 Act, 2003');
    expect(titleCase('The Buy Indian Bill, 2004')).toBe('The Buy Indian Bill, 2004');
  });
});

describe('extractPrintedTitle', () => {
  it('reads a heading line, with markdown markers', () => {
    expect(extractPrintedTitle('# THE NATIONAL CHILD WELFARE BOARD BILL, 2005\n\nA\n\n## BILL\n\nto provide for')).toBe('The National Child Welfare Board Bill, 2005');
  });

  it('skips the lines above it: a header, a Bill No., a foreign cover that only mentions another Act', () => {
    const text = 'RAJYA SABHA\nA\nBILL\nto amend the Multimodal Transportation of Goods Act, 1993.\n\nAS INIRODUCED IN THE RAJYA SABHA\n|\nBill No. LI of 2000\n\nTHE PASSPORT (ENTRY INTO INDIA) AMENDMENT BILL, 2000\n* A * BILL';
    expect(extractPrintedTitle(text)).toBe('The Passport (Entry into India) Amendment Bill, 2000');
  });

  it('joins a title wrapped over two lines, in either place the year can fall', () => {
    expect(extractPrintedTitle('Bill No. 3\n\nTHE REPRESENTATION OF THE PEOPLE (AMENDMENT)\nBILL, 2000\nA\nBILL')).toBe('The Representation of the People (Amendment) Bill, 2000');
    expect(extractPrintedTitle('THE PROTECTION OF INTERESTS IN AIRCRAFT\n   OBJECTS BILL, 2025\n')).toBe('The Protection of Interests in Aircraft Objects Bill, 2025');
  });

  it('reads an Act title (a synopsis or a gazette)', () => {
    expect(extractPrintedTitle('SYNOPSIS\n\nTHE CHIT FUNDS (AMENDMENT) ACT, 2001\n\nThe Act amends')).toBe('The Chit Funds (Amendment) Act, 2001');
  });

  it('ends the title at the year: an asterisk, a footnote mark or an Act number after it is not part of it', () => {
    expect(extractPrintedTitle('# THE CHIT FUNDS (AMENDMENT) ACT, 2001 $ ^{*} $\n\n(ACT 10 OF 2001) AN ACT TO AMEND THE CHIT FUNDS ACT, 1982')).toBe('The Chit Funds (Amendment) Act, 2001');
    expect(extractPrintedTitle('# THE APPROPRIATION (RAILWAYS) NO. 2 ACT, 2003*\n\n(Act No. 23 of 2003)')).toBe('The Appropriation (Railways) No. 2 Act, 2003');
    expect(extractPrintedTitle('# THE CONSTITUTION (AMENDMENT) BILL, 2005 By\n\nA MEMBER')).toBe('The Constitution (Amendment) Bill, 2005');
  });

  it('gives up rather than guess: no title-like line, or only the end of the text', () => {
    expect(extractPrintedTitle('Telecommunication regulations of the Authority, in words only')).toBeNull();
    expect(extractPrintedTitle(`${'x\n'.repeat(900)}THE LATE BILL, 2000`)).toBeNull();
    expect(extractPrintedTitle('')).toBeNull();
  });
});

describe('titlesAgree', () => {
  it('ignores case, punctuation, spacing and a leading "The"; accepts a subtitle on one side', () => {
    expect(titlesAgree('The Domestic Workers  (Conditions of Service) Bill, 2000', 'DOMESTIC WORKERS (CONDITIONS OF SERVICE) BILL 2000')).toBe(true);
    expect(titlesAgree('The Constitution (Amendment) Bill, 2006', 'The Constitution (Amendment) Bill, 2006 (Amendment of article 85)')).toBe(true);
    expect(titlesAgree('The Buy Indian Bill, 2004', 'The Climate Change Bill, 2012')).toBe(false);
  });
});

describe('chooseTitle', () => {
  it('takes the desk record name when exactly one is known, then the manifest title, then the printed one', () => {
    expect(chooseTitle({ desk: ['The Buy Indian Bill, 2004'], manifest: 'Buy Indian Bill 2004', printed: 'x' })).toMatchObject({ title: 'The Buy Indian Bill, 2004', source: 'desk_rows' });
    expect(chooseTitle({ desk: [], manifest: 'The Buy Indian Bill, 2004', printed: 'x' })).toMatchObject({ title: 'The Buy Indian Bill, 2004', source: 'manifest' });
    expect(chooseTitle({ desk: undefined, manifest: null, printed: 'The Buy Indian Bill, 2004' })).toMatchObject({ title: 'The Buy Indian Bill, 2004', source: 'printed in the text' });
    expect(chooseTitle({ desk: [], manifest: null, printed: null })).toBeNull();
  });

  it('does not choose between two different desk names: it falls back and says so', () => {
    const c = chooseTitle({ desk: ['The A Bill, 2000', 'The B Bill, 2000'], manifest: 'The A Bill, 2000', printed: null });
    expect(c).toMatchObject({ source: 'manifest', deskAmbiguous: true });
  });

  it('collapses runs of spaces in a title and reports every candidate and whether the printed one agrees', () => {
    const c = chooseTitle({ desk: ['The Domestic Workers  (Conditions of Service) Bill, 2000'], manifest: null, printed: 'The Domestic Workers (Conditions of Service) Bill, 2000' });
    expect(c.title).toBe('The Domestic Workers (Conditions of Service) Bill, 2000');
    expect(c.candidates).toEqual({ desk: ['The Domestic Workers (Conditions of Service) Bill, 2000'], manifest: null, printed: 'The Domestic Workers (Conditions of Service) Bill, 2000' });
    expect(c.agreesWithPrinted).toBe(true);
    expect(chooseTitle({ desk: [], manifest: 'The A Bill, 2000', printed: 'The B Bill, 2000' }).agreesWithPrinted).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// retitle_unlink: a new title, and the document leaves the desk. The server clears the link unit
// (document_key, bill_number, bill_year, house, status, file_url_source) when file_url_ambiguous is true.
// ---------------------------------------------------------------------------------------------
describe('buildRepairPayload: retitle_unlink', () => {
  const retitle = { title: 'The Code of Criminal Procedure (Amendment) Bill, 2000' };

  it('sets file_url_ambiguous, drops the key fields from the payload, and records what was undone', async () => {
    const payload = await buildRepairPayload(rekeyRow(), { text: OLD_TEXT, action: 'retitle_unlink', retitle });
    expect(payload.title).toBe(retitle.title);
    expect(payload.metadata.file_url_ambiguous).toBe(true);
    for (const f of ['document_key', 'bill_number', 'bill_year', 'house', 'status', 'file_url_source']) expect(payload.metadata[f]).toBeUndefined();
    expect(payload.metadata.text_repair).toMatchObject({ action: 'retitle_unlink', previous_document_key: 'bill:2012:74', previous_title: 'The Climate Change Bill, 2012.' });
    expect(payload.ocr_text).toBe(OLD_TEXT);
  });

  it('through the real ingestOne (version 1: re-chunked) the stored key fields are removed, the rest kept', async () => {
    const existing = rekeyRow();
    const payload = await buildRepairPayload(existing, { text: OLD_TEXT, action: 'retitle_unlink', retitle });
    const { result, written } = await serverWrite(existing, payload);
    expect(result.status).toBe('indexed');
    expect(written.title).toBe(retitle.title);
    for (const f of ['document_key', 'bill_number', 'bill_year', 'house', 'status', 'file_url_source']) expect(written.metadata).not.toHaveProperty(f);
    expect(written.metadata.file_url_ambiguous).toBe(true);
    expect(written.metadata).toMatchObject({ document_role: 'as_introduced', source_host: 'sansad.in', doc_type: 'bill', title_stem: '1748LS', n_pages: 6 });
  });

  it('through the real ingestOne at the current chunker version it is the metadata-only shortcut: no re-chunk, no embedding', async () => {
    const existing = { ...rekeyRow(), chunker_version: 2, content_sha256: await sha256Hex(OLD_TEXT) };
    const payload = await buildRepairPayload(existing, { text: OLD_TEXT, action: 'retitle_unlink', retitle });
    const { result, written } = await serverWrite(existing, payload);
    expect(result).toMatchObject({ status: 'unchanged', inserted: 0, embedded_tokens: 0 });
    expect(written.title).toBe(retitle.title);
    expect(written.metadata).not.toHaveProperty('document_key');
    expect(written.metadata.file_url_ambiguous).toBe(true);
  });

  it('a re-key at the current chunker version is the same shortcut', async () => {
    const existing = { ...rekeyRow(), chunker_version: 2, content_sha256: await sha256Hex(OLD_TEXT) };
    const payload = await buildRepairPayload(existing, { text: OLD_TEXT, action: 'rekey', rekey: { document_key: 'bill:2005:96', title: 'The National Child Welfare Board Bill, 2005' } });
    const { result, written } = await serverWrite(existing, payload);
    expect(result.status).toBe('unchanged');
    expect(written.metadata).toMatchObject({ document_key: 'bill:2005:96', bill_number: '96', bill_year: '2005' });
  });

  it('refuses without a title, with links, with no key to remove, and on a rekey object', async () => {
    await expect(buildRepairPayload(rekeyRow(), { text: OLD_TEXT, action: 'retitle_unlink' })).rejects.toThrow(/retitle/);
    await expect(buildRepairPayload(rekeyRow(), { text: OLD_TEXT, action: 'retitle_unlink', retitle: { title: ' ' } })).rejects.toThrow(/title/);
    const linked = rekeyRow();
    linked.metadata.links = [{ document_key: 'bill:2012:74' }];
    await expect(buildRepairPayload(linked, { text: OLD_TEXT, action: 'retitle_unlink', retitle })).rejects.toThrow(/links/);
    const keyless = rekeyRow();
    delete keyless.metadata.document_key;
    await expect(buildRepairPayload(keyless, { text: OLD_TEXT, action: 'retitle_unlink', retitle })).rejects.toThrow(/no document_key/);
    await expect(buildRepairPayload(rekeyRow(), { text: OLD_TEXT, action: 'retitle_unlink', retitle, rekey: { document_key: 'bill:2005:96', title: 'x' } })).rejects.toThrow(/rekey/);
  });

  it('a retitle object is only for retitle_unlink', async () => {
    await expect(buildRepairPayload(rekeyRow(), { text: OLD_TEXT, action: 'decode', retitle })).rejects.toThrow(/retitle/);
  });
});

// ---------------------------------------------------------------------------------------------
// Same-family bills (independent review, finding 4)
// ---------------------------------------------------------------------------------------------
describe('printedBillNo', () => {
  it('reads Arabic and Roman numbers, a passed bill\'s -F, and OCR slips; nothing deeper than the opening', () => {
    expect(printedBillNo('Bill No. 47 of 2001\nTHE CONSTITUTION')).toEqual({ number: '47', year: 2001 });
    expect(printedBillNo('Bill No. 105-F of 2025')).toEqual({ number: '105', year: 2025 });
    expect(printedBillNo('Bitt No. XXIV oF 2000')).toEqual({ number: 'XXIV', year: 2000 });
    expect(printedBillNo('AS INTRODUCED IN THE RAJYA SABHA\nBill No. LXXII of 2000')).toEqual({ number: 'LXXII', year: 2000 });
    expect(printedBillNo('no number here')).toBeNull();
    expect(printedBillNo(`${'x '.repeat(900)}Bill No. 3 of 2000`)).toBeNull();
  });
});

describe('titleRefs', () => {
  it('lists the articles and sections a title names, letters attached, and none for a plain title', () => {
    expect(titleRefs('The Constitution (Amendment) Bill, 2000 (Insertion of new article 16A)')).toEqual([{ kind: 'article', id: '16A' }]);
    expect(titleRefs('The Representation of the People (Amendment) Bill, 2000 (Amendment of section 29A, etc.)')).toEqual([{ kind: 'section', id: '29A' }]);
    expect(titleRefs('The Constitution (Amendment) Bill, 2005 (Substitution of new article for article 253,etc.)')).toEqual([{ kind: 'article', id: '253' }]);
    expect(titleRefs('The Constitution (Amendment) Bill, 2000 (art. 198)')).toEqual([{ kind: 'article', id: '198' }]);
    expect(titleRefs('The Buy Indian Bill, 2004')).toEqual([]);
  });
});

describe('identityProblems', () => {
  const key = 'bill:2001:47';
  it('passes a text that prints the key\'s number and holds the title\'s article', () => {
    const r = identityProblems({ title: 'The Constitution (Amendment) Bill, 2001 (Insertion of new article 21A)', key, text: 'Bill No. 47 of 2001\nTHE CONSTITUTION (AMENDMENT) BILL, 2001\nAfter article 21 ... 21A. Right to education' });
    expect(r).toEqual({ problems: [], notes: [] });
  });

  it('fails a different printed number, and a Roman number that is not the key\'s; a Roman and an Arabic form of one number agree', () => {
    expect(identityProblems({ title: 'T', key, text: 'Bill No. 49 of 2001' }).problems[0]).toMatch(/No\. 49 of 2001, but the bill is No\. 47/);
    expect(identityProblems({ title: 'T', key: 'bill:2000:LXXII', text: 'Bill No. LXXI of 2000' }).problems).toHaveLength(1);
    expect(identityProblems({ title: 'T', key: 'bill:2000:LXXII', text: 'Bill No. LXXII of 2000' }).problems).toEqual([]);
    expect(identityProblems({ title: 'T', key: 'bill:2000:LXXII', text: 'Bill No. 72 of 2000' }).problems).toEqual([]);
  });

  it('fails a different printed year, unless the title prints the key\'s year: then it is a note (an OCR slip)', () => {
    expect(identityProblems({ title: 'T', key: 'bill:2000:130', text: 'Bill No. 130 of 1998' }).problems).toHaveLength(1);
    const slip = identityProblems({ title: 'T', key: 'bill:2000:130', text: 'Bill No. 130 of 2006\nTHE REPRESENTATION OF THE PEOPLE (AMENDMENT) BILL, 2000' });
    expect(slip.problems).toEqual([]);
    expect(slip.notes[0]).toMatch(/OCR slip/);
  });

  it('notes, and does not fail, a text that prints no Bill No.', () => {
    expect(identityProblems({ title: 'The Buy Indian Bill, 2004', key: 'bill:2004:88', text: 'THE BUY INDIAN BILL, 2004' })).toEqual({ problems: [], notes: ['the opening prints no Bill No.'] });
  });

  it('uses billNo when a document has no key; none and no key checks nothing but the references', () => {
    expect(identityProblems({ title: 'T', billNo: { number: 'XXIV', year: 2000 }, text: 'Bitt No. XXIV oF 2000' }).problems).toEqual([]);
    expect(identityProblems({ title: 'T', billNo: { number: 'XXIV', year: 2000 }, text: 'Bill No. XXV of 2000' }).problems).toHaveLength(1);
    expect(identityProblems({ title: 'T', text: 'Bill No. 3 of 2000' })).toEqual({ problems: [], notes: [] });
  });

  it('a bare section number must follow its keyword; a lettered one may stand alone as a clause heading', () => {
    expect(identityProblems({ title: 'X Bill (Amendment of section 8)', text: 'In section 8 of the Act' }).problems).toEqual([]);
    expect(identityProblems({ title: 'X Bill (Amendment of section 8)', text: '8. Short title. In section 29A of the Act, and 8 members' }).problems).toHaveLength(1);
    expect(identityProblems({ title: 'X Bill (Insertion of new article 21A)', text: "After article 21, insert '21A. Right'" }).problems).toEqual([]);
    expect(identityProblems({ title: 'X Bill (Insertion of new article 21A)', text: 'In article 21 of the Constitution' }).problems).toHaveLength(1);
    expect(identityProblems({ title: 'X Bill (Insertion of new article 16A)', text: 'article\n16 A shall be inserted' }).problems).toEqual([]);
  });

  describe('the eight Constitution (Amendment) Bills of the batch: each fails on the other seven', () => {
    // Openings shaped like the stored texts (short, synthetic). Where the file prints a Bill No. it is here; where it
    // does not, only the article tells the bills apart.
    const BILLS = {
      eb58009f: { title: 'The Constitution (Amendment) Bill, 2001 (Insertion of new article 21A)', key: 'bill:2001:47', head: 'THE CONSTITUTION (AMENDMENT) BILL, 2001\nAfter article 21 of the Constitution, insert: 21A. Right to education' },
      '335d3607': { title: 'The Constitution (Amendment) Bill, 2006 (Amendment of article 85)', key: 'bill:2006:83', head: 'THE CONSTITUTION (AMENDMENT) BILL, 2006\nIn article 85 of the Constitution, in clause (2)' },
      '390311bf': { title: 'The Constitution (Amendment) Bill, 2005 (Substitution of new article for article 253,etc.)', key: 'bill:2005:79', head: 'THE CONSTITUTION (AMENDMENT) BILL, 2005\nFor article 253 of the Constitution the following shall be substituted' },
      '94fe0078': { title: 'The Constitution (Amendment) Bill, 1998 (Insertion of new article 51B)', key: 'bill:1998:32', head: 'THE CONSTITUTION (AMENDMENT) BILL, 1998\nAfter article 51A insert: 51B. Duty of the State' },
      '99250d51': { title: 'The Constitution (Amendment) Bill, 1998 (Amendment of article 327)', key: 'bill:1998:49', head: 'Bill No. 49 of 1998\nTHE CONSTITUTION (AMENDMENT) BILL, 1998\nIn article 327 of the Constitution' },
      a8403f6d: { title: 'The Constitution (Amendment) Bill, 1998 (Amendment of article 80)', key: 'bill:1998:67', head: 'Bill No. 67 of 1998\nTHE CONSTITUTION (AMENDMENT) BILL, 1998\nIn article 80 of the Constitution' },
      f5ddf657: { title: 'The Constitution (Amendment) Bill, 2000 (Insertion of new article 16A)', key: 'bill:2000:75', head: 'Bill No. 75 of 2000.\nTHE CONSTITUTION (AMENDMENT) BILL, 2000\nAfter article 16 insert: 16A. Special provision' },
      afd4f0e8: { title: 'The Constitution (Amendment) Bill, 2000 (art. 198)', key: null, billNo: { number: 'XXIV', year: 2000 }, head: 'Bitt No. XXIV oF 2000\nTHE CONSTITUTION (AMENDMENT) BILL, 2000\nIn article 198 of the Constitution' },
    };
    const ids = Object.keys(BILLS);
    for (const a of ids) {
      it(`${a} passes on its own text and fails on every other`, () => {
        const check = (head) => identityProblems({ title: BILLS[a].title, key: BILLS[a].key, billNo: BILLS[a].billNo, text: head }).problems;
        expect(check(BILLS[a].head)).toEqual([]);
        for (const b of ids.filter((x) => x !== a)) expect(check(BILLS[b].head), `${a} on ${b}`).not.toEqual([]);
      });
    }
  });

  describe('6393d754 and c4472f57 (the same title, different sections)', () => {
    const A = { title: 'The Representation of the People (Amendment) Bill, 2000 (Amendment of section 29A, etc.)', key: 'bill:2000:62', head: 'THE REPRESENTATION OF THE PEOPLE (AMENDMENT) BILL, 2000\n2. In section 29A of the Representation of the People Act, 1951' };
    const B = { title: 'The Representation of the People (Amendment) Bill, 2000 (Amendment of section 8)', key: 'bill:2000:130', head: 'Bill No. 130 of 2006\nTHE REPRESENTATION OF THE PEOPLE (AMENDMENT) BILL, 2000\n2. In section 8 of the Representation of the People Act, 1951' };
    it('each passes on its own text and fails on the other\'s', () => {
      expect(identityProblems({ ...A, text: A.head }).problems).toEqual([]);
      expect(identityProblems({ ...B, text: B.head }).problems).toEqual([]);
      expect(identityProblems({ ...A, text: B.head }).problems).not.toEqual([]);
      expect(identityProblems({ ...B, text: A.head }).problems).not.toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Regulatory identity (finding 6): the old text is a tail or debris of the same document, so the old text's
// four-word sequences should be found in the new text (containment of old in new, not the reverse).
// ---------------------------------------------------------------------------------------------
describe('oldTextContainment', () => {
  it('counts the old text\'s four-word sequences that occur in the new text, case and punctuation aside', () => {
    expect(oldTextContainment('a b c d e f g h', 'x A, B c d e f y')).toEqual({ shingles: 5, contained: 3, share: 0.6 });
  });

  it('is not symmetric: a short tail inside a long new text is contained, the long text is not in the tail', () => {
    const tail = 'one two three four five six';
    const whole = `intro words here ${tail} and the rest of a long order continues`;
    expect(oldTextContainment(tail, whole).share).toBe(1);
    expect(oldTextContainment(whole, tail).share).toBeLessThan(0.5);
  });

  it('has nothing to measure for a text under four words', () => {
    expect(oldTextContainment('one two', 'one two three')).toEqual({ shingles: 0, contained: 0, share: null });
  });
});

describe('identityVerdict', () => {
  it('fails an old text that is not in the new one, asks a person to look at a low or unmeasurable overlap, passes a high one', () => {
    expect(IDENTITY_THRESHOLDS).toEqual({ minShingles: 100, fail: 0.05, look: 0.5 });
    expect(identityVerdict({ share: 0.01, shingles: 1500, garbage: false }).level).toBe('fail');
    expect(identityVerdict({ share: 0.09, shingles: 1481, garbage: false }).level).toBe('look');
    expect(identityVerdict({ share: 0.49, shingles: 400, garbage: false }).level).toBe('look');
    expect(identityVerdict({ share: 0.5, shingles: 400, garbage: false }).level).toBe('ok');
    expect(identityVerdict({ share: 0.9, shingles: 3000, garbage: false }).level).toBe('ok');
  });

  it('cannot measure a garbage old text or a tiny one: a person must look, whatever the share', () => {
    const g = identityVerdict({ share: 0.0, shingles: 1500, garbage: true });
    expect(g.level).toBe('look');
    expect(g.reason).toMatch(/cannot be measured/);
    expect(identityVerdict({ share: 0.0, shingles: 7, garbage: false }).level).toBe('look');
    expect(identityVerdict({ share: null, shingles: 0, garbage: false }).level).toBe('look');
  });
});

// ---------------------------------------------------------------------------------------------
// Provenance of a text repair: the fields that described the old source now describe the new one
// ---------------------------------------------------------------------------------------------
describe('buildRepairPayload: metadataUpdates', () => {
  const row = () => ({ ...decodeRow(), metadata: { ...decodeRow().metadata, ocr_lang: 'eng', file_mtime: '2026-09-08T21:35:58Z' } });

  it('applies the updates and keeps the old values, and the old text claims, under text_repair.previous', async () => {
    const payload = await buildRepairPayload(row(), { text: 'new text here', action: 'ocr', metadataUpdates: { ocr_lang: 'mistral-ocr-4-1' } });
    expect(payload.metadata.ocr_lang).toBe('mistral-ocr-4-1');
    expect(payload.metadata.text_repair.previous).toEqual({ ocr_lang: 'eng', n_chars: REPORT_STORED.length, text_sha256: 'old' });
  });

  it('records previous text claims for any action that changes the text, and not for a title or key repair', async () => {
    const strip = await buildRepairPayload(row(), { text: 'shorter', action: 'strip_cover' });
    expect(strip.metadata.text_repair.previous).toEqual({ n_chars: REPORT_STORED.length, text_sha256: 'old' });
    const rekey = await buildRepairPayload(rekeyRow(), { text: OLD_TEXT, action: 'rekey', rekey: { document_key: 'bill:2005:96', title: 'T' } });
    expect(rekey.metadata.text_repair.previous).toBeUndefined();
  });

  it('does not write a field the document did not have as a "previous" of undefined', async () => {
    const payload = await buildRepairPayload(decodeRow(), { text: 'x text', action: 'ocr', metadataUpdates: { ocr_lang: 'mistral-ocr-4-1' } });
    expect(payload.metadata.text_repair.previous).not.toHaveProperty('ocr_lang');
  });

  it('survives the real ingestOne merge: the update wins, text_repair.previous is kept', async () => {
    const existing = row();
    const payload = await buildRepairPayload(existing, { text: 'new text here', action: 'ocr', metadataUpdates: { ocr_lang: 'mistral-ocr-4-1' } });
    const { written } = await serverWrite(existing, payload);
    expect(written.metadata.ocr_lang).toBe('mistral-ocr-4-1');
    expect(written.metadata.text_repair.previous.ocr_lang).toBe('eng');
  });
});

describe('chooseTitle: a desk title that replaces the manifest title is flagged', () => {
  it('replacesManifest is true only when the desk name is used and differs from the manifest title', () => {
    expect(chooseTitle({ desk: ['The Medical Profession (Regulation) Bill, 1998'], manifest: 'The Medical Professin (Regulation) Bill, 1998' }).replacesManifest).toBe(true);
    expect(chooseTitle({ desk: ['The A Bill, 2000'], manifest: 'The A  Bill, 2000' }).replacesManifest).toBe(false);
    expect(chooseTitle({ desk: [], manifest: 'The A Bill, 2000' }).replacesManifest).toBe(false);
    expect(chooseTitle({ desk: ['The A Bill, 2000'], manifest: null }).replacesManifest).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Rollback (finding 7): a payload that puts a document back as the pre-write snapshot had it
// ---------------------------------------------------------------------------------------------
describe('buildRollbackPayload', () => {
  const without = (o, ...keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
  /** The row the server holds after it applied a write of `existing`. */
  const after = (existing, written) => ({ ...existing, title: written.title, metadata: written.metadata, content_sha256: written.content_sha256 ?? existing.content_sha256, chunker_version: 2, ocr_text: written.ocr_text ?? existing.ocr_text });

  it('restores a re-keyed document: title, key, number, year and every other field', async () => {
    const original = rekeyRow();
    const repaired = await buildRepairPayload(original, { text: OLD_TEXT, action: 'rekey', rekey: { document_key: 'bill:2005:96', title: 'The National Child Welfare Board Bill, 2005', house: 'Rajya Sabha', status: 'Assented' } });
    const { written } = await serverWrite(original, repaired);
    const now = after(original, written);
    const rollback = await buildRollbackPayload(original, { action: 'rekey' });
    const { written: back } = await serverWrite(now, rollback);
    expect(back.title).toBe(original.title);
    // (the fixture's text_sha256 is a placeholder; a rollback recomputes it for the text it restores)
    expect(without(back.metadata, 'text_repair', 'text_sha256')).toEqual(without(original.metadata, 'text_sha256'));
    expect(back.metadata.text_sha256).toBe(await sha256Hex(OLD_TEXT));
    expect(back.metadata.text_repair).toMatchObject({ action: 'rollback', rolled_back_action: 'rekey' });
  });

  it('restores an unlinked document: the key fields come back and file_url_ambiguous is false', async () => {
    const original = rekeyRow();
    const repaired = await buildRepairPayload(original, { text: OLD_TEXT, action: 'retitle_unlink', retitle: { title: 'The Code of Criminal Procedure (Amendment) Bill, 2000' } });
    const { written } = await serverWrite(original, repaired);
    const now = after(original, written);
    expect(now.metadata).not.toHaveProperty('document_key');
    expect(now.metadata.file_url_ambiguous).toBe(true);
    const rollback = await buildRollbackPayload(original, { action: 'retitle_unlink' });
    expect(rollback.metadata.file_url_ambiguous).toBe(false);
    const { written: back } = await serverWrite(now, rollback);
    expect(back.title).toBe(original.title);
    expect(without(back.metadata, 'text_repair', 'file_url_ambiguous', 'text_sha256')).toEqual(without(original.metadata, 'text_sha256'));
    expect(back.metadata.file_url_ambiguous).toBe(false);
  });

  it('restores the text of a decoded or OCR\'d document, with claims that match it', async () => {
    const original = { ...decodeRow(), metadata: { ...decodeRow().metadata, ocr_lang: 'eng' } };
    const repaired = await buildRepairPayload(original, { text: 'the repaired text', action: 'ocr', metadataUpdates: { ocr_lang: 'mistral-ocr-4-1' } });
    const { written } = await serverWrite(original, repaired);
    const now = after(original, written);
    const rollback = await buildRollbackPayload(original, { action: 'ocr' });
    expect(rollback.ocr_text).toBe(REPORT_STORED);
    expect(rollback.metadata.n_chars).toBe(codePointLength(REPORT_STORED));
    expect(rollback.metadata.text_sha256).toBe(await sha256Hex(REPORT_STORED));
    const { written: back } = await serverWrite(now, rollback);
    expect(back.ocr_text).toBe(REPORT_STORED);
    expect(back.metadata.ocr_lang).toBe('eng');
  });

  it('is the snapshot and nothing else: same source_key and file, and it refuses a snapshot with no text', async () => {
    const original = rekeyRow();
    const rollback = await buildRollbackPayload(original, { action: 'rekey' });
    for (const k of ['source_key', 'file_name', 'file_url', 'desk_tier', 'desk_feature']) expect(rollback[k]).toBe(original[k]);
    await expect(buildRollbackPayload({ ...original, ocr_text: '' }, { action: 'rekey' })).rejects.toThrow(/text/);
    await expect(buildRollbackPayload({ ...original, source_key: null }, { action: 'rekey' })).rejects.toThrow(/source_key/);
  });
});
