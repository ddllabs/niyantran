import { describe, expect, it } from 'vitest';
import { normalise, sha256Hex } from '../../lib/textNormalise.js';
import {
  NOTICES, VIEW_KEY, chooseView, overlayFor, pageTotal, pagingKey, pdfAvailable,
  readViewChoice, resolveCitedPieces, storedCopyLabel, writeViewChoice,
} from './viewerModel.js';

const DOC = { id: 'd1', title: 'Bill', storage_path: 'files/a.pdf', indexed_at: '2026-10-01', extract_hash: 'x1', page_count: 12 };
const PARTS = [
  { part_index: 0, page_offset: 0, page_count: 5, byte_size: 100 },
  { part_index: 1, page_offset: 5, page_count: 7, byte_size: 200 },
];

describe('pdfAvailable', () => {
  it('needs a live document with storage and at least one part', () => {
    expect(pdfAvailable({ doc: DOC, parts: PARTS, state: 'ok' })).toBe(true);
    expect(pdfAvailable({ doc: DOC, parts: [], state: 'ok' })).toBe(false);
    expect(pdfAvailable({ doc: { ...DOC, storage_path: null }, parts: PARTS, state: 'text_only' })).toBe(false);
    expect(pdfAvailable({ doc: { ...DOC, indexed_at: null }, parts: PARTS, state: 'not_live' })).toBe(false);
    expect(pdfAvailable({ doc: null, parts: PARTS, state: 'gone' })).toBe(false);
  });

  it('keeps the PDF for stale, unknown-freshness and missing page text', () => {
    for (const state of ['stale', 'unknown_freshness', 'no_page_text']) {
      expect(pdfAvailable({ doc: DOC, parts: PARTS, state })).toBe(true);
    }
  });
});

describe('chooseView', () => {
  it('defaults to PDF when it is available, honouring a remembered Text choice', () => {
    expect(chooseView({ available: true, stored: null, choice: null, failed: false })).toBe('pdf');
    expect(chooseView({ available: true, stored: 'text', choice: null, failed: false })).toBe('text');
    expect(chooseView({ available: true, stored: 'text', choice: 'pdf', failed: false })).toBe('pdf');
    expect(chooseView({ available: true, stored: 'garbage', choice: null, failed: false })).toBe('pdf');
  });

  it('is Text when the PDF is unavailable or failed, whatever was chosen', () => {
    expect(chooseView({ available: false, stored: 'pdf', choice: 'pdf', failed: false })).toBe('text');
    expect(chooseView({ available: true, stored: null, choice: 'pdf', failed: true })).toBe('text');
  });
});

describe('remembered view (localStorage)', () => {
  it('reads and writes the niyantranCitationView key', () => {
    const store = new Map();
    const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    writeViewChoice('text', storage);
    expect(store.get(VIEW_KEY)).toBe('text');
    expect(VIEW_KEY).toBe('niyantranCitationView');
    expect(readViewChoice(storage)).toBe('text');
  });

  it('survives storage that throws, or no storage at all', () => {
    const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
    expect(readViewChoice(throwing)).toBeNull();
    expect(() => writeViewChoice('pdf', throwing)).not.toThrow();
    expect(readViewChoice(undefined)).toBeNull();
    expect(() => writeViewChoice('pdf', undefined)).not.toThrow();
  });

  it('ignores values other than pdf and text', () => {
    expect(readViewChoice({ getItem: () => '<script>' })).toBeNull();
  });
});

describe('pageTotal', () => {
  it('uses page_count, else the end of the last part, else the cited page', () => {
    expect(pageTotal(DOC, PARTS, 3)).toBe(12);
    expect(pageTotal({ ...DOC, page_count: null }, PARTS, 3)).toBe(12);
    expect(pageTotal({ ...DOC, page_count: null }, [], 3)).toBe(3);
  });
});

describe('pagingKey', () => {
  const at = { page: 4, cited: 2, total: 12 };
  const key = (k, extra = {}) => pagingKey({ key: k, targetTag: 'BUTTON', ...extra }, at);

  it('pages with arrows and brackets, and Home returns to the cited page', () => {
    expect(key('ArrowLeft')).toBe(3);
    expect(key('[')).toBe(3);
    expect(key('ArrowRight')).toBe(5);
    expect(key(']')).toBe(5);
    expect(key('Home')).toBe(2);
  });

  it('stays inside the document', () => {
    expect(pagingKey({ key: 'ArrowLeft', targetTag: 'BUTTON' }, { page: 1, cited: 1, total: 3 })).toBeNull();
    expect(pagingKey({ key: 'ArrowRight', targetTag: 'BUTTON' }, { page: 3, cited: 1, total: 3 })).toBeNull();
    expect(pagingKey({ key: 'Home', targetTag: 'BUTTON' }, { page: 2, cited: 2, total: 3 })).toBeNull();
  });

  it('never fires in inputs, editable text, with modifiers, or over a text selection', () => {
    for (const targetTag of ['INPUT', 'TEXTAREA', 'SELECT']) expect(key('ArrowRight', { targetTag })).toBeNull();
    expect(key('ArrowRight', { editable: true })).toBeNull();
    expect(key('ArrowRight', { hasSelection: true })).toBeNull();
    for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) expect(key('ArrowRight', { [mod]: true })).toBeNull();
    expect(key('a')).toBeNull();
  });

  it('never fires inside an open menu, whose arrows move between its items (viewer-toolbar spec)', () => {
    expect(key('ArrowRight', { inMenu: true })).toBeNull();
    expect(key('Home', { inMenu: true })).toBeNull();
  });
});

describe('overlayFor', () => {
  const citation = { boxes: [{ page: 2, x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.3 }, { page: 3, x0: 0, y0: 0, x1: 1, y1: 1 }] };
  const row = { width_px: 1000, height_px: 1414 };
  const viewport = { width: 595, height: 841.5 };

  it('draws only the current page boxes when the aspect matches', () => {
    const out = overlayFor({ citation, page: 2, cited: 2, boxesAllowed: true, pageRow: row, viewport });
    expect(out.hint).toBe(false);
    expect(out.boxes).toEqual([{ left: '10%', top: '20%', width: '40%', height: '10%' }]);
  });

  it('shows the hint instead when the aspect guard trips or there are no boxes', () => {
    const wide = overlayFor({ citation, page: 2, cited: 2, boxesAllowed: true, pageRow: row, viewport: { width: 842, height: 595 } });
    expect(wide).toEqual({ boxes: [], hint: true });
    const none = overlayFor({ citation: {}, page: 2, cited: 2, boxesAllowed: true, pageRow: row, viewport });
    expect(none).toEqual({ boxes: [], hint: true });
    const noRow = overlayFor({ citation, page: 2, cited: 2, boxesAllowed: true, pageRow: null, viewport });
    expect(noRow).toEqual({ boxes: [], hint: true });
  });

  it('draws nothing and hints nothing off the cited page or when boxes are not allowed', () => {
    expect(overlayFor({ citation, page: 3, cited: 2, boxesAllowed: true, pageRow: row, viewport })).toEqual({ boxes: [], hint: false });
    expect(overlayFor({ citation, page: 2, cited: 2, boxesAllowed: false, pageRow: row, viewport })).toEqual({ boxes: [], hint: false });
  });

  it('has nothing to draw before the page has rendered', () => {
    expect(overlayFor({ citation, page: 2, cited: 2, boxesAllowed: true, pageRow: row, viewport: null })).toEqual({ boxes: [], hint: false });
  });
});

describe('resolveCitedPieces', () => {
  const page3 = 'Clause 4. The Agency shall test';
  const page4 = 'athletes in competition. Clause 5.';
  const rows = [
    { page_number: 3, text: page3, char_from: 1000, char_to: 1000 + page3.length },
    { page_number: 4, text: page4, char_from: 1000 + page3.length + 2, char_to: 1000 + page3.length + 2 + page4.length },
  ];

  it('marks a passage across a page break on each page, when the joined pieces match the hash', async () => {
    const from = 1000 + page3.indexOf('The Agency');
    const to = rows[1].char_from + 'athletes in competition.'.length;
    const citation = { char_from: from, char_to: to, text_hash: await sha256Hex(normalise('The Agency shall test athletes in competition.')) };
    expect(await resolveCitedPieces(citation, rows)).toEqual({
      status: 'exact',
      pieces: [{ page: 3, from: page3.indexOf('The Agency'), to: page3.length }, { page: 4, from: 0, to: 'athletes in competition.'.length }],
    });
  });

  it('marks a passage on one page in page-local offsets', async () => {
    const from = 1000 + page3.indexOf('The Agency');
    const citation = { char_from: from, char_to: from + 10, text_hash: await sha256Hex(normalise('The Agency')) };
    expect(await resolveCitedPieces(citation, rows.slice(0, 1))).toEqual({ status: 'exact', pieces: [{ page: 3, from: from - 1000, to: from - 1000 + 10 }] });
  });

  it('is changed on a wrong hash, or while a page the passage runs onto is not read', async () => {
    const from = 1000 + page3.indexOf('The Agency');
    const to = rows[1].char_from + 8;
    const hash = await sha256Hex(normalise('The Agency shall test athletes'));
    expect(await resolveCitedPieces({ char_from: from, char_to: to, text_hash: 'nope' }, rows)).toEqual({ status: 'changed' });
    expect(await resolveCitedPieces({ char_from: from, char_to: to, text_hash: hash }, rows.slice(0, 1))).toEqual({ status: 'changed' });
  });
});

describe('labels', () => {
  it('names the stored-copy part only for a split document', () => {
    expect(storedCopyLabel([PARTS[0]], 3)).toBe('Open stored copy');
    expect(storedCopyLabel(PARTS, 3)).toBe('Open stored copy (part 1 of 2)');
    expect(storedCopyLabel(PARTS, 6)).toBe('Open stored copy (part 2 of 2)');
  });

  it('has the spec notices', () => {
    expect(NOTICES.gone).toMatch(/no longer available/);
    expect(NOTICES.stale).toBe('The document was updated since this was cited.');
    expect(NOTICES.noPageText).toMatch(/This page's text is not available/);
    expect(NOTICES.hint).toBe('Cited on this page; passage location not available');
    expect(NOTICES.spanChanged).toMatch(/^The cited passage could not be located on this page/);
    expect(NOTICES.notLive).toMatch(/still (being )?process/);
  });
});
