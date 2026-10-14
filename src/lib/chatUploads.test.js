// F172 (F171 B2) and F62 (B4). Files uploaded into AI chat never reached the AI: requestAttachments
// sends an attachment's top-level `text`, and an uploaded file kept its contents under `files[]`
// (text, or the whole file as base64), so every upload was dropped without a word. Uploads are now
// read in the browser, page by page for PDFs, and their text travels with the turn; a file that
// cannot be read says so on its chip; oversized files are refused before they are read; and file
// contents are never kept in browser storage.
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { filesFromDrop } from './aiDrop.js';
import { requestAttachments } from '../ai/AiPanel.jsx';

const require = createRequire(import.meta.url);
const drop = (...files) => filesFromDrop({ dataTransfer: { files } });

async function pdfWith(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([400, 400]);
    if (text) page.drawText(text, { x: 20, y: 350, size: 12, font });
  }
  return new File([await doc.save()], 'bill.pdf', { type: 'application/pdf' });
}

describe('uploaded files reach the AI (F172)', () => {
  it('a text file is sent with its text', async () => {
    const [chip] = await drop(new File(['The Data Bill, 2026 sets up a board.'], 'notes.txt', { type: 'text/plain' }));
    const [sent] = requestAttachments([chip]);
    expect(sent).toMatchObject({ kind: 'file', title: 'notes.txt', text: 'The Data Bill, 2026 sets up a board.' });
  });

  it('a PDF is read page by page; pages without text are named, not silently lost', async () => {
    const [chip] = await drop(await pdfWith(['Clause 1. The Board shall consist of a Chairperson.', '']));
    expect(chip.text).toContain('Clause 1. The Board shall consist of a Chairperson.');
    expect(chip.text).toContain('[Page 1]');
    expect(chip.note).toMatch(/page 2/i);
    expect(requestAttachments([chip])[0].text).toContain('Clause 1.');
  });

  it('a PDF with no readable text is not sent and says why', async () => {
    const [chip] = await drop(await pdfWith(['', '']));
    expect(chip.text || '').toBe('');
    expect(chip.error).toMatch(/no readable text/i);
    expect(requestAttachments([chip])).toEqual([]);
  });

  it('a spreadsheet is sent as text', async () => {
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['bill', 'year'], ['Data Bill', 2026]]), 'Bills');
    const file = new File([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })], 'bills.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const [chip] = await drop(file);
    expect(requestAttachments([chip])[0].text).toContain('Data Bill,2026');
  });

  it('an image is not sent and says so', async () => {
    const [chip] = await drop(new File([new Uint8Array([137, 80, 78, 71])], 'chart.png', { type: 'image/png' }));
    expect(chip.error).toMatch(/image/i);
    expect(requestAttachments([chip])).toEqual([]);
  });

  it('text longer than the AI reads is cut to that and says so', async () => {
    const [chip] = await drop(new File(['x'.repeat(50_000)], 'long.txt', { type: 'text/plain' }));
    expect(chip.text).toHaveLength(12_000);
    expect(chip.note).toBe('The AI reads the first 12,000 characters.');
  });

  it('the limit is what the research chat prompt keeps (review)', async () => {
    const { readFileSync } = await import('node:fs');
    const prompt = readFileSync(new URL('../../supabase/functions/research-chat/prompt.ts', import.meta.url), 'utf8');
    const { SENT_TEXT_LIMIT } = await import('./fileText.js');
    expect(Number(/MAX_ATTACHMENT_CHARS = ([\d_]+)/.exec(prompt)?.[1].replace(/_/g, ''))).toBe(SENT_TEXT_LIMIT);
  });

  it('a short title page counts as text (review)', async () => {
    const [chip] = await drop(await pdfWith(['THE DATA BILL, 2026', 'Clause 1. Short title.']));
    expect(chip.error).toBeUndefined();
    expect(chip.note).toBeUndefined();
    expect(chip.text).toContain('THE DATA BILL, 2026');
  });

  it('Word files and other binary files are not sent as text (review)', async () => {
    const [doc] = await drop(new File([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 1, 2])], 'bill.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    expect(doc.error).toMatch(/Word files/);
    const [bin] = await drop(new File([new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 3])], 'tool.bin', { type: '' }));
    expect(bin.error).toMatch(/not text/);
    expect(requestAttachments([doc, bin])).toEqual([]);
  });
});

describe('file size and storage (F62)', () => {
  it('a file over 25 MB is refused before it is read', async () => {
    const file = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 26_000_000 });
    const read = vi.spyOn(file, 'arrayBuffer');
    const [chip] = await drop(file);
    expect(read).not.toHaveBeenCalled();
    expect(chip.error).toMatch(/25 MB/);
  });

  it('files past 50 MB in one drop are refused before they are read', async () => {
    const mk = (n) => { const f = new File(['x'], `f${n}.txt`, { type: 'text/plain' }); Object.defineProperty(f, 'size', { value: 20_000_000 }); return f; };
    const files = [mk(1), mk(2), mk(3)];
    const reads = files.map((f) => vi.spyOn(f, 'arrayBuffer'));
    const chips = await drop(...files);
    expect(reads[2]).not.toHaveBeenCalled();
    expect(chips[2].error).toMatch(/50 MB/);
  });

  it('a chip keeps no file contents (no base64), only what is sent', async () => {
    const [chip] = await drop(await pdfWith(['Clause 1.']));
    expect(JSON.stringify(chip)).not.toMatch(/base64/);
  });
});

describe('file text is not kept in browser storage (F62 review)', () => {
  it('a stored file chip keeps no text and asks for the file again', async () => {
    const { storablePins } = await import('./aiConversations.js');
    const [chip] = await drop(new File(['The Data Bill, 2026 sets up a board.'], 'notes.txt', { type: 'text/plain' }));
    const stored = storablePins({ c1: [{ ...chip, id: 'a1' }, { id: 'r1', kind: 'row', title: 'Row', text: 'row text' }] });
    expect(stored.c1[0].text).toBeUndefined();
    expect(stored.c1[0].error).toMatch(/Attach this file again/);
    expect(stored.c1[1].text).toBe('row text');
    expect(requestAttachments(stored.c1).map((a) => a.title)).toEqual(['Row']);
  });
});

// F178 (F171 review): upload follow-ups. The messages a chip shows are plain text in Hindi too, and
// PDFs with CID-keyed fonts are read with the character maps and standard fonts pdf.js needs.
describe('messages a file chip shows, in Hindi too (F178)', () => {
  const DEVANAGARI = /[ऀ-ॿ]/;
  const fakePdf = (seen, items = [{ str: 'Clause 1. The Board shall consist of a Chairperson.' }]) => async () => ({
    getDocument: (options) => {
      seen.push(options);
      const page = { getTextContent: async () => ({ items }), cleanup() {} };
      return { promise: Promise.resolve({ numPages: 1, getPage: async () => page }), destroy: async () => {} };
    },
  });

  it('every fixed message and note the upload code produces has a Hindi text; English and unknown text pass through', async () => {
    const { fileText, fileMessage } = await import('./fileText.js');
    const { storablePins } = await import('./aiConversations.js');
    const failing = (name) => async () => ({ getDocument: () => ({ promise: Promise.reject(Object.assign(new Error('x'), { name })), destroy: async () => {} }) });
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const sheets = { read: () => ({ SheetNames: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], Sheets: {} }), utils: { sheet_to_csv: () => 'x,y' } };
    const produced = [
      (await fileText('image', bytes)).error,
      (await fileText('doc', bytes)).error,
      (await fileText('pdf', bytes, { loadPdf: failing('PasswordException') })).error,
      (await fileText('pdf', bytes, { loadPdf: failing('InvalidPDFException') })).error,
      (await fileText('pdf', bytes, { loadPdf: fakePdf([], [{ str: '' }]) })).error,
      (await fileText('sheet', bytes, { loadXlsx: async () => { throw new Error('bad'); } })).error,
      (await fileText('sheet', bytes, { loadXlsx: async () => sheets })).note,
      (await fileText('text', new Uint8Array([0x7f, 0, 1, 2]).buffer)).error,
      (await fileText('text', new Uint8Array([0xff, 0xfe, 0x41]).buffer)).error,
      (await fileText('text', new TextEncoder().encode('   ').buffer)).error,
      (await fileText('text', new TextEncoder().encode('x'.repeat(50_000)).buffer)).note,
      (await drop(await pdfWith(['Clause 1. Short title.', '', '']))).at(0).note,
      (await drop(await pdfWith(['Clause 1. Short title.', '']))).at(0).note,
      ...(await (async () => {
        const big = (n, size) => { const f = new File(['x'], n, { type: 'text/plain' }); Object.defineProperty(f, 'size', { value: size }); return f; };
        const unreadable = new File(['x'], 'u.txt', { type: 'text/plain' });
        unreadable.arrayBuffer = async () => { throw new Error('gone'); };
        return (await drop(big('a.txt', 26_000_000), big('b.txt', 20_000_000), big('c.txt', 20_000_000), big('d.txt', 20_000_000), unreadable)).map((c) => c.error);
      })()),
      storablePins({ c: [{ kind: 'file', text: 'x' }] }).c[0].error,
    ].filter(Boolean);
    expect(produced.length).toBeGreaterThanOrEqual(17);
    for (const english of produced) {
      expect(fileMessage(english, 'en')).toBe(english);
      const hindi = fileMessage(english, 'hi');
      expect(hindi, english).not.toBe(english);
      expect(hindi, english).toMatch(DEVANAGARI);
    }
    expect(fileMessage('Something else entirely.', 'hi')).toBe('Something else entirely.');
    expect(fileMessage(undefined, 'hi')).toBe('');
  });

  it('numbers and page lists in the Hindi text are the same as in the English', async () => {
    const { fileMessage } = await import('./fileText.js');
    expect(fileMessage('Pages 2, 3 and 5 have no readable text (scanned) and were not read.', 'hi')).toMatch(/2, 3 और 5/);
    expect(fileMessage('Only the first 6 of 9 sheets are read.', 'hi')).toMatch(/9.*6/);
    expect(fileMessage('The AI reads the first 12,000 characters.', 'hi')).toContain('12,000');
    expect(fileMessage('Larger than 25 MB, so it was not read.', 'hi')).toContain('25 MB');
  });
});

describe('PDFs are read with pdf.js character maps and standard fonts (F178)', () => {
  const seen = [];
  const loadPdf = async () => ({
    getDocument: (options) => {
      seen.push(options);
      const page = { getTextContent: async () => ({ items: [{ str: 'Clause 1. The Board.' }] }), cleanup() {} };
      return { promise: Promise.resolve({ numPages: 1, getPage: async () => page }), destroy: async () => {} };
    },
  });

  it('in the browser, getDocument gets the packed cmaps and the standard fonts that Vite serves', async () => {
    const { fileText } = await import('./fileText.js');
    vi.stubGlobal('window', {});
    vi.stubGlobal('Worker', class {});
    try {
      seen.length = 0;
      await fileText('pdf', new Uint8Array([1]).buffer, { loadPdf });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(seen[0]).toMatchObject({ cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/' });
  });

  it('outside a browser (Node, tests) no asset URLs are passed, so pdf.js reads its own files', async () => {
    const { fileText } = await import('./fileText.js');
    seen.length = 0;
    await fileText('pdf', new Uint8Array([1]).buffer, { loadPdf });
    expect(seen[0]).not.toHaveProperty('cMapUrl');
    expect(seen[0]).not.toHaveProperty('standardFontDataUrl');
    expect(seen[0]).toMatchObject({ isEvalSupported: false });
  });
});
