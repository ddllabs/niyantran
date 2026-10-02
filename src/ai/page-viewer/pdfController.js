/**
 * The PDF view's shared pieces (docs/specs/2026-10-01-rag-v2-citations-pdf.md, "PDF view"), used
 * by the part pool (pdfPool.js), which replaced the single-part controller that lived here
 * (docs/specs/2026-10-02-viewer-continuous.md, section 2):
 * - **Failures:** `pdfFailureNotice` turns an error into a fixed sentence by its class. pdf.js and
 *   fetch error text can embed the signed URL, so it is never rendered, logged or sent anywhere.
 * - **Canvases:** `canvasSize` keeps a page's backing store under the iOS cap.
 * - **Parts:** `createPartTransport` answers pdf.js's byte-range requests through the range reader.
 * - No annotation layer, forms, XFA or scripting: the pool opens parts with
 *   `isEvalSupported: false` and `enableXfa: false`, and draws annotations into the canvas only.
 */
import { DOCUMENT_FILE_FAILED } from '../../lib/documentFile.js';
import { PDF_FETCH_FAILED, PDF_RANGE_MISMATCH } from './rangeTransport.js';

/** 4096 × 4096: the largest canvas iOS Safari reliably allocates. */
export const MAX_CANVAS_PIXELS = 16_777_216;

export const PDF_LOADER_FAILED = 'pdf_loader_failed';

export const PDF_NOTICES = Object.freeze({
  loader: 'The PDF viewer could not be loaded. The page text is shown instead.',
  notFound: 'The stored PDF is not available for this document. The page text is shown instead.',
  unauthorized: 'Sign in again to view the stored PDF. The page text is shown instead.',
  unavailable: 'The stored PDF could not be reached. The page text is shown instead.',
  download: 'The stored PDF could not be downloaded. The page text is shown instead.',
  invalid: 'This PDF could not be read. The page text is shown instead.',
  generic: 'This PDF page could not be displayed. The page text is shown instead.',
});

const DOWNLOAD_CODES = new Set([PDF_FETCH_FAILED, PDF_RANGE_MISMATCH]);
const DOWNLOAD_NAMES = new Set(['UnexpectedResponseException', 'MissingPDFException', 'ResponseException']);
const INVALID_NAMES = new Set(['InvalidPDFException', 'PasswordException', 'FormatError']);

/**
 * The fixed notice for a PDF failure, chosen by the error's class (`code` or `name`). The
 * message is compared only with the file client's own constant; it is never returned.
 */
export function pdfFailureNotice(error) {
  if (!error || typeof error !== 'object') return PDF_NOTICES.generic;
  const { code, name } = error;
  if (code === PDF_LOADER_FAILED) return PDF_NOTICES.loader;
  if (DOWNLOAD_CODES.has(code) || DOWNLOAD_NAMES.has(name)) return PDF_NOTICES.download;
  if (error.message === DOCUMENT_FILE_FAILED) {
    if (code === 'not_found' || code === 'bad_page') return PDF_NOTICES.notFound;
    if (code === 'unauthorized') return PDF_NOTICES.unauthorized;
    return PDF_NOTICES.unavailable;
  }
  if (INVALID_NAMES.has(name)) return PDF_NOTICES.invalid;
  return PDF_NOTICES.generic;
}

/**
 * Backing-store size for a page drawn `cssWidth` × `cssHeight` CSS pixels at `dpr`, with the
 * scale lowered so the area stays under `max`.
 */
export function canvasSize(cssWidth, cssHeight, dpr, max = MAX_CANVAS_PIXELS) {
  const css = { w: Math.max(1, Math.floor(cssWidth)), h: Math.max(1, Math.floor(cssHeight)) };
  let scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  if (css.w * css.h * scale * scale > max) scale = Math.sqrt(max / (css.w * css.h));
  return {
    width: Math.max(1, Math.floor(css.w * scale)),
    height: Math.max(1, Math.floor(css.h * scale)),
    cssWidth: css.w,
    cssHeight: css.h,
    scale,
  };
}

/**
 * A pdf.js range transport for one part: each `requestDataRange(begin, end)` (end exclusive) is
 * read through `read` and handed back with `onDataRange`. A failed read goes to `onFailure`,
 * because pdf.js itself would wait for the bytes forever. Nothing is delivered once the part is
 * closed.
 */
export function createPartTransport({ pdfjs, length, read, onFailure, isClosed = () => false }) {
  const transport = new pdfjs.PDFDataRangeTransport(length, null);
  transport.requestDataRange = (begin, end) => {
    read(begin, end).then(
      (buffer) => { if (!isClosed()) transport.onDataRange(begin, buffer); },
      (error) => { if (!isClosed()) onFailure(error); },
    );
  };
  return transport;
}
