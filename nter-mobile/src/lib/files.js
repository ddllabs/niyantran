// Turns a file from the phone into a research-chat `file` attachment (title + text). Text and office
// formats (DOCX, XLSX, CSV, PPTX, TXT) are extracted multi-format; PDFs are read page by page with pdf.js.
import { extractDocument, resolveDocumentFormat } from './extractors/index.js';

const MAX_TEXT = 40000;
const TEXT_TYPES = /\.(txt|md|csv|tsv|json|html?|xml)$/i;
const OFFICE_TYPES = /\.(docx|xlsx|xlsm|xls|pptx)$/i;

async function pdfText(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages && out.length < MAX_TEXT; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += `\n\n[Page ${i}]\n${content.items.map((it) => it.str).join(' ')}`;
  }
  await doc.destroy();
  return { text: out.trim(), pages: doc.numPages };
}

export async function fileToAttachment(file) {
  if (!file) throw new Error('No file chosen.');
  if (file.size > 30 * 1024 * 1024) throw new Error('Files up to 30 MB can be attached.');
  let text = '';
  let note = '';

  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const r = await pdfText(file);
    text = r.text;
    note = `${r.pages} page${r.pages === 1 ? '' : 's'}`;
    if (!text.replace(/\[Page \d+\]/g, '').trim()) throw new Error('This PDF has no readable text (it may be a scan).');
  } else if (OFFICE_TYPES.test(file.name) || TEXT_TYPES.test(file.name) || /^text\//.test(file.type)) {
    const format = resolveDocumentFormat(file);
    const extracted = await extractDocument(file, { fileName: file.name, mimeType: file.type });
    text = extracted.text || '';

    if (format === 'pptx' && extracted.metadata?.slideCount) {
      note = `${extracted.metadata.slideCount} slide${extracted.metadata.slideCount === 1 ? '' : 's'}`;
    } else if (format === 'xlsx' && extracted.metadata?.sheetCount) {
      note = `${extracted.metadata.sheetCount} worksheet${extracted.metadata.sheetCount === 1 ? '' : 's'}`;
    } else if (format === 'csv' && extracted.metadata?.totalRows !== undefined) {
      note = `${extracted.metadata.totalRows} row${extracted.metadata.totalRows === 1 ? '' : 's'}`;
    } else if (format === 'docx' && extracted.metadata?.headingCount) {
      note = `${extracted.metadata.headingCount} heading${extracted.metadata.headingCount === 1 ? '' : 's'}`;
    }
  } else {
    throw new Error('Attach a PDF, Office document (DOCX, XLSX, PPTX), or text file (TXT, CSV, MD).');
  }

  const cut = text.length > MAX_TEXT;
  return {
    kind: 'file',
    title: file.name.slice(0, 200),
    text: cut ? `${text.slice(0, MAX_TEXT - 40)}\n[… the rest of the file was cut]` : text,
    key: `file:${file.name}:${file.size}`,
    label: file.name,
    icon: 'file',
    note: [note, cut ? 'first part only' : ''].filter(Boolean).join(' · '),
  };
}
