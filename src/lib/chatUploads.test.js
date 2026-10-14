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
