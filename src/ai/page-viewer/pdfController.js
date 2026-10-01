/**
 * The PDF view's document, part and render lifecycle
 * (docs/specs/2026-10-01-rag-v2-citations-pdf.md, "PDF view"). pdf.js, the file client, fetch
 * and timers are injected, so all of it runs against fakes in node.
 *
 * - **Parts.** The page's part is opened through a `PDFDataRangeTransport` of the part's
 *   `byte_size`; pdf.js asks for byte ranges and the range reader fetches them from the part's
 *   signed URL, renewing it once when Storage refuses it. Paging past a part destroys the old
 *   document and opens the next part.
 * - **Rendering.** One render at a time: a new render, `cancel()` or `destroy()` cancels the
 *   in-flight `RenderTask` and text layer, and a superseded render resolves `{status:
 *   'cancelled'}`. `schedule` debounces held-down paging and resizes.
 * - **Failures** reject with the original error object for classification only.
 *   `pdfFailureNotice` turns it into a fixed sentence: pdf.js and fetch error text can embed the
 *   signed URL, so it is never rendered, logged or sent anywhere.
 * - No annotation layer, forms, XFA or scripting: `isEvalSupported: false`, `enableXfa: false`,
 *   and annotations are drawn into the canvas appearance only (`AnnotationMode.ENABLE`).
 */
import { DOCUMENT_FILE_FAILED } from '../../lib/documentFile.js';
import { PDF_FETCH_FAILED, PDF_RANGE_MISMATCH, createRangeReader } from './rangeTransport.js';

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

const CANCELLED = Object.freeze({ status: 'cancelled' });
const CANCELLED_NAMES = new Set(['RenderingCancelledException', 'AbortException']);
const covers = (info, page) => info.pageOffset < page && page <= info.pageOffset + info.pageCount;

function coded(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/**
 * @param {object} deps
 * @param {string} deps.documentId
 * @param {{partFor(id: string, page: number): Promise<{url: string, partIndex: number, pageOffset: number,
 *   pageCount: number, byteSize: number}>, invalidate(id: string, partIndex: number): void}} deps.documentFile
 * @param {() => Promise<object>} deps.loadPdfjs
 * @param {typeof fetch} deps.fetch
 * @param {{setTimeout: Function, clearTimeout: Function}} [deps.timers]
 */
export function createPdfController({ documentId, documentFile, loadPdfjs, fetch, timers = globalThis }) {
  let pdfjs = null;
  let part = null;
  let job = null;
  let timer = null;
  let destroyed = false;

  function closePart() {
    if (!part) return;
    part.closed = true;
    part.abort.abort();
    Promise.resolve(part.task.destroy()).catch(() => {});
    part = null;
  }

  function openPart(info) {
    let failNow;
    const failure = new Promise((_, reject) => { failNow = reject; });
    failure.catch(() => {});
    const opened = { info, closed: false, failure, task: null, abort: new AbortController() };
    const reader = createRangeReader({
      async getUrl() {
        const signed = await documentFile.partFor(documentId, info.pageOffset + 1);
        if (signed.partIndex !== info.partIndex) throw coded(PDF_FETCH_FAILED);
        return signed.url;
      },
      invalidate: () => documentFile.invalidate(documentId, info.partIndex),
      fetch,
      signal: opened.abort.signal,
    });
    const range = createPartTransport({
      pdfjs,
      length: info.byteSize,
      read: reader.read,
      isClosed: () => opened.closed,
      onFailure: failNow,
    });
    opened.task = pdfjs.getDocument({
      range,
      length: info.byteSize,
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
      enableXfa: false,
    });
    Promise.resolve(opened.task.promise).catch(() => {});
    return opened;
  }

  async function ensurePart(page) {
    if (part && covers(part.info, page)) return part;
    const info = await documentFile.partFor(documentId, page);
    if (destroyed) throw coded('cancelled');
    if (!pdfjs) {
      try {
        pdfjs = await loadPdfjs();
      } catch {
        throw coded(PDF_LOADER_FAILED);
      }
      if (destroyed) throw coded('cancelled');
    }
    if (part && part.info.partIndex === info.partIndex) return part;
    closePart();
    part = openPart(info);
    return part;
  }

  function cancel() {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
    if (!job) return;
    job.cancelled = true;
    try { job.renderTask?.cancel(); } catch { /* already settled */ }
    try { job.textLayer?.cancel(); } catch { /* already settled */ }
    job = null;
  }

  /**
   * Render 1-based `page` of the document into `canvas` (and its text into `textLayer`) at
   * `width` CSS pixels × `zoom`. Resolves `{status: 'done', viewport, cssWidth, cssHeight}`, where
   * `viewport` is the unscaled page size for the aspect guard, or `{status: 'cancelled'}`.
   */
  async function render({ page, canvas, textLayer = null, width, zoom = 1, dpr = 1 }) {
    cancel();
    const mine = { cancelled: false, renderTask: null, textLayer: null };
    job = mine;
    let current = null;
    try {
      current = await ensurePart(page);
      if (mine.cancelled) return CANCELLED;
      const race = promise => Promise.race([promise, current.failure]);
      const doc = await race(current.task.promise);
      if (mine.cancelled) return CANCELLED;
      const pdfPage = await race(doc.getPage(page - current.info.pageOffset));
      if (mine.cancelled) return CANCELLED;

      const base = pdfPage.getViewport({ scale: 1 });
      const scale = (width / base.width) * zoom;
      const viewport = pdfPage.getViewport({ scale });
      const size = canvasSize(viewport.width, viewport.height, dpr);
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.style.width = `${size.cssWidth}px`;
      canvas.style.height = `${size.cssHeight}px`;
      mine.renderTask = pdfPage.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: size.scale !== 1 ? [size.scale, 0, 0, size.scale, 0, 0] : undefined,
        annotationMode: pdfjs.AnnotationMode?.ENABLE,
      });
      await race(mine.renderTask.promise);
      if (mine.cancelled) return CANCELLED;

      if (textLayer) {
        textLayer.replaceChildren();
        textLayer.style.setProperty('--scale-factor', String(scale));
        mine.textLayer = new pdfjs.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: textLayer, viewport });
        await race(mine.textLayer.render());
        if (mine.cancelled) return CANCELLED;
      }
      return { status: 'done', viewport: { width: base.width, height: base.height }, cssWidth: size.cssWidth, cssHeight: size.cssHeight };
    } catch (error) {
      if (mine.cancelled || destroyed || CANCELLED_NAMES.has(error?.name)) return CANCELLED;
      // A failed part is not reused: Retry opens it afresh.
      if (current && part === current) closePart();
      throw error;
    } finally {
      if (job === mine) job = null;
    }
  }

  return {
    render,
    /** Render after `delay` ms of quiet; each call cancels the pending and in-flight render. */
    schedule(target, { delay = 0, onDone, onError } = {}) {
      cancel();
      if (destroyed) return;
      timer = timers.setTimeout(() => {
        timer = null;
        render(target).then(
          (result) => { if (result.status === 'done') onDone?.(result); },
          (error) => onError?.(error),
        );
      }, delay);
    },
    cancel,
    /** Cancel everything and destroy the open document. The controller is unusable afterwards. */
    destroy() {
      destroyed = true;
      cancel();
      closePart();
    },
  };
}
