/**
 * F172 (F171 B2): the text of a file dropped into AI chat, read in the browser, because the chat
 * sends text only (research-chat accepts at most 40,000 characters per attachment). PDFs are read
 * page by page with the pdf.js the viewer already loads lazily; a page without readable text (a
 * scanned page) is named rather than silently lost. Spreadsheets use SheetJS, loaded lazily.
 * Images are not read.
 */
import { loadPdfjs } from './pdfjs.js';
import { pdfAssetOptions } from './pdfAssets.js';

/** F62 (F171 B4, owner decision 2026-10-14): refused before a byte is read. */
export const FILE_LIMIT_BYTES = 25_000_000;
export const DROP_LIMIT_BYTES = 50_000_000;
/**
 * What the AI reads of one file: research-chat's prompt keeps the first `MAX_ATTACHMENT_CHARS`
 * (12,000) of each attachment (supabase/functions/research-chat/prompt.ts; a test ties the two).
 */
export const SENT_TEXT_LIMIT = 12_000;
/** A page with fewer non-space characters than this has no readable text (a scanned page). */
const PAGE_TEXT_MIN = 3;
const SHEET_ROWS = 5000;

const nonSpace = (s) => String(s || '').replace(/\s/g, '').length;

// Re-exported so existing imports keep working; the function lives in its own import-free module.
export { pdfAssetOptions };

async function pdfPages(bytes, load) {
  const pdfjs = await load();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false, useSystemFonts: false, verbosity: 0, ...pdfAssetOptions() });
  try {
    const doc = await task.promise;
    const pages = [];
    let total = 0;
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = (content.items || []).map((it) => `${it.str || ''}${it.hasEOL ? '\n' : ''}`).join('').replace(/[ \t]+/g, ' ').trim();
      page.cleanup();
      pages.push(text);
      total += text.length;
      // Past what the AI reads, later pages are not read (they are reported as not read).
      if (total > SENT_TEXT_LIMIT) {
        for (let rest = n + 1; rest <= doc.numPages; rest += 1) pages.push(null);
        break;
      }
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
  if (kind === 'doc') return { error: 'Word files are not read yet, so this file was not sent. Save it as PDF or text.' };
  if (kind === 'pdf') {
    let pages;
    try {
      pages = await pdfPages(bytes, loadPdf);
    } catch (error) {
      return { error: error?.name === 'PasswordException' ? 'This PDF needs a password, so it was not sent.' : 'This PDF could not be read, so it was not sent.' };
    }
    const read = pages.filter((t) => t !== null);
    const empty = pages.map((t, i) => (t !== null && nonSpace(t) < PAGE_TEXT_MIN ? i + 1 : 0)).filter(Boolean);
    if (empty.length === read.length) return { error: 'No readable text (the PDF looks scanned), so it was not sent.' };
    text = pages.map((t, i) => (t === null || nonSpace(t) < PAGE_TEXT_MIN ? '' : `[Page ${i + 1}]\n${t}`)).filter(Boolean).join('\n\n');
    if (empty.length) notes.push(`${pageList(empty)} ${empty.length === 1 ? 'has' : 'have'} no readable text (scanned) and ${empty.length === 1 ? 'was' : 'were'} not read.`);
  } else if (kind === 'sheet') {
    try {
      const mod = await loadXlsx();
      const XLSX = mod.read ? mod : mod.default;
      const wb = XLSX.read(new Uint8Array(bytes), { type: 'array', cellDates: true, sheetRows: SHEET_ROWS, dense: true });
      const names = wb.SheetNames || [];
      text = names.slice(0, 6).map((name) => `# Sheet: ${name}\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`).join('\n\n');
      if (names.length > 6) notes.push(`Only the first 6 of ${names.length} sheets are read.`);
    } catch {
      return { error: 'This spreadsheet could not be read, so it was not sent.' };
    }
  } else {
    // Text files only: a binary file (NUL bytes, or bytes that are not UTF-8) is not sent as text.
    const head = new Uint8Array(bytes.slice(0, 8192));
    if (head.includes(0) && !(head[0] === 0xff && head[1] === 0xfe) && !(head[0] === 0xfe && head[1] === 0xff)) {
      return { error: 'This file is not text, so it was not sent.' };
    }
    try {
      const utf16 = head[0] === 0xff && head[1] === 0xfe ? 'utf-16le' : head[0] === 0xfe && head[1] === 0xff ? 'utf-16be' : 'utf-8';
      text = new TextDecoder(utf16, { fatal: true }).decode(bytes);
    } catch {
      return { error: 'This file is not text, so it was not sent.' };
    }
  }
  text = text.trim();
  if (!text) return { error: 'No readable text, so this file was not sent.' };
  if (text.length > SENT_TEXT_LIMIT) {
    text = text.slice(0, SENT_TEXT_LIMIT);
    notes.push(`The AI reads the first ${SENT_TEXT_LIMIT.toLocaleString('en-IN')} characters.`);
  }
  return notes.length ? { text, note: notes.join(' ') } : { text };
}

/**
 * F178: the fixed messages above and in aiDrop.js (and the one in aiConversations.js), in Hindi. A
 * message that has none, or any language but Hindi, is shown as given. The messages with numbers or
 * page lists are matched by pattern and keep those numbers.
 */
const HINDI = new Map([
  ['Images are not read yet, so this file was not sent.', 'छवियाँ अभी नहीं पढ़ी जातीं, इसलिए यह फ़ाइल नहीं भेजी गई।'],
  ['Word files are not read yet, so this file was not sent. Save it as PDF or text.', 'Word फ़ाइलें अभी नहीं पढ़ी जातीं, इसलिए यह फ़ाइल नहीं भेजी गई। इसे PDF या पाठ फ़ाइल के रूप में सहेजें।'],
  ['This PDF needs a password, so it was not sent.', 'इस PDF के लिए पासवर्ड चाहिए, इसलिए इसे नहीं भेजा गया।'],
  ['This PDF could not be read, so it was not sent.', 'यह PDF पढ़ी नहीं जा सकी, इसलिए इसे नहीं भेजा गया।'],
  ['No readable text (the PDF looks scanned), so it was not sent.', 'पढ़ने योग्य पाठ नहीं मिला (PDF स्कैन की हुई लगती है), इसलिए इसे नहीं भेजा गया।'],
  ['This spreadsheet could not be read, so it was not sent.', 'यह स्प्रेडशीट पढ़ी नहीं जा सकी, इसलिए इसे नहीं भेजा गया।'],
  ['This file is not text, so it was not sent.', 'यह फ़ाइल पाठ नहीं है, इसलिए इसे नहीं भेजा गया।'],
  ['No readable text, so this file was not sent.', 'पढ़ने योग्य पाठ नहीं मिला, इसलिए यह फ़ाइल नहीं भेजी गई।'],
  ['Could not read this file, so it was not sent.', 'यह फ़ाइल पढ़ी नहीं जा सकी, इसलिए इसे नहीं भेजा गया।'],
  ['Attach this file again to send it; file text is not kept after a reload.', 'इसे भेजने के लिए यह फ़ाइल फिर से जोड़ें; रीलोड के बाद फ़ाइल का पाठ सहेजा नहीं जाता।'],
]);
const HINDI_PATTERNS = [
  [/^(?:Page|Pages) (.+) (?:has|have) no readable text \(scanned\) and (?:was|were) not read\.$/, (m) => `पृष्ठ ${m[1].replace(' and ', ' और ')} में पढ़ने योग्य पाठ नहीं है (स्कैन किया हुआ), इसलिए ${/^Pages /.test(m[0]) ? 'इन्हें' : 'इसे'} नहीं पढ़ा गया।`],
  [/^Only the first (\d+) of (\d+) sheets are read\.$/, (m) => `कुल ${m[2]} शीट में से केवल पहली ${m[1]} पढ़ी गई हैं।`],
  [/^The AI reads the first ([\d,]+) characters\.$/, (m) => `AI पहले ${m[1]} अक्षर पढ़ता है।`],
  [/^Larger than (\d+) MB, so it was not read\.$/, (m) => `यह फ़ाइल ${m[1]} MB से बड़ी है, इसलिए इसे नहीं पढ़ा गया।`],
  [/^This drop is over (\d+) MB, so this file was not read\.$/, (m) => `यह ड्रॉप ${m[1]} MB से बड़ा है, इसलिए यह फ़ाइल नहीं पढ़ी गई।`],
];

/** @returns {string} a chip's error or note, in Hindi when `lang` is 'hi' and it has a Hindi text */
export function fileMessage(text, lang) {
  const message = String(text || '');
  if (lang !== 'hi') return message;
  // A whole message first (some fixed messages are two sentences); else a note joined from several by
  // fileText (a cut sheet and a cut text, say), each sentence translated on its own.
  const whole = hindiSentence(message);
  if (whole !== message) return whole;
  return message.split(/(?<=\.) (?=[A-Z])/).map(hindiSentence).join(' ');
}

function hindiSentence(message) {
  if (HINDI.has(message)) return HINDI.get(message);
  for (const [pattern, say] of HINDI_PATTERNS) {
    const found = pattern.exec(message);
    if (found) return say(found);
  }
  return message;
}
