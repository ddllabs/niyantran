/**
 * F172 (F171 B2): the text of a file dropped into AI chat, read in the browser, because the chat
 * sends text only (research-chat accepts at most 40,000 characters per attachment). PDFs are read
 * page by page with the pdf.js the viewer already loads lazily; a page without readable text (a
 * scanned page) is named rather than silently lost. Spreadsheets use SheetJS, loaded lazily.
 * Images are not read.
 */
import { loadPdfjs } from './pdfjs.js';

/** F62 (F171 B4, owner decision 2026-10-14): refused before a byte is read. */
export const FILE_LIMIT_BYTES = 25_000_000;
export const DROP_LIMIT_BYTES = 50_000_000;
/** research-chat's `LIMITS.attachmentText`. */
export const SENT_TEXT_LIMIT = 40_000;
/** Fewer non-space characters than this and a page counts as having no readable text. */
const PAGE_TEXT_MIN = 40;
const SHEET_ROWS = 5000;

const nonSpace = (s) => String(s || '').replace(/\s/g, '').length;

async function pdfPages(bytes, load) {
  const pdfjs = await load();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push((content.items || []).map((it) => it.str || '').join(' ').replace(/[ \t]+/g, ' ').trim());
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

function pageList(numbers) {
  return numbers.length === 1 ? `Page ${numbers[0]}` : `Pages ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}

/**
 * @param {string} kind 'pdf' | 'sheet' | 'image' | 'csv' | 'text'
 * @param {ArrayBuffer} bytes
 * @returns {Promise<{text?: string, note?: string, error?: string}>}
 */
export async function fileText(kind, bytes, { loadPdf = loadPdfjs, loadXlsx = () => import('xlsx') } = {}) {
  let text = '';
  const notes = [];
  if (kind === 'image') return { error: 'Images are not read yet, so this file was not sent.' };
  if (kind === 'pdf') {
    let pages;
    try {
      pages = await pdfPages(bytes, loadPdf);
    } catch (error) {
      return { error: error?.name === 'PasswordException' ? 'This PDF needs a password, so it was not sent.' : 'This PDF could not be read, so it was not sent.' };
    }
    const empty = pages.map((t, i) => (nonSpace(t) < PAGE_TEXT_MIN ? i + 1 : 0)).filter(Boolean);
    if (empty.length === pages.length) return { error: 'No readable text (the PDF looks scanned), so it was not sent.' };
    text = pages.map((t, i) => (nonSpace(t) < PAGE_TEXT_MIN ? '' : `[Page ${i + 1}]\n${t}`)).filter(Boolean).join('\n\n');
    if (empty.length) notes.push(`${pageList(empty)} ${empty.length === 1 ? 'has' : 'have'} no readable text (scanned) and ${empty.length === 1 ? 'was' : 'were'} not read.`);
  } else if (kind === 'sheet') {
    try {
      const mod = await loadXlsx();
      const XLSX = mod.read ? mod : mod.default;
      const wb = XLSX.read(new Uint8Array(bytes), { type: 'array', cellDates: true, sheetRows: SHEET_ROWS, dense: true });
      text = (wb.SheetNames || []).slice(0, 6).map((name) => `# Sheet: ${name}\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`).join('\n\n');
    } catch {
      return { error: 'This spreadsheet could not be read, so it was not sent.' };
    }
  } else {
    text = new TextDecoder().decode(bytes);
  }
  text = text.trim();
  if (!text) return { error: 'No readable text, so this file was not sent.' };
  if (text.length > SENT_TEXT_LIMIT) {
    text = text.slice(0, SENT_TEXT_LIMIT);
    notes.push(`Only the first ${SENT_TEXT_LIMIT.toLocaleString('en-IN')} characters are sent.`);
  }
  return notes.length ? { text, note: notes.join(' ') } : { text };
}
