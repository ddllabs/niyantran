/**
 * The continuous view's PDF loader (docs/specs/2026-10-02-viewer-continuous.md, section 2): a small
 * pool of open stored parts and a prioritised render queue, serving the pages and the thumbnails.
 * pdf.js, the file client, fetch and the canvases are injected, so all of it runs against fakes.
 *
 * - **Parts.** A page's part is opened through a `PDFDataRangeTransport` of the part's
 *   `byte_size`, as the single-page controller did. At most MAX_OPEN_PARTS stay open; opening
 *   another closes the least recently used part no render is using.
 * - **Queue.** At most MAX_RENDERS renders run at once. Pages go before thumbnails, then the lower
 *   `priority` (the render window's distance rank), then the earlier request. A queued job can be
 *   reprioritised as the reader scrolls; a cancelled one is dropped, and a running one is stopped.
 * - **Failures** reach `onError` as the original error object, for classification only
 *   (`pdfFailureNotice`). A part that failed is closed, so the next request opens it afresh.
 */
import { PDF_LOADER_FAILED, canvasSize, createPartTransport } from './pdfController.js';
import { PDF_FETCH_FAILED, createRangeReader } from './rangeTransport.js';

export const MAX_OPEN_PARTS = 3;
export const MAX_RENDERS = 2;

const CANCELLED_NAMES = new Set(['RenderingCancelledException', 'AbortException']);
const covers = (info, page) => info.pageOffset < page && page <= info.pageOffset + info.pageCount;
const NO_HANDLE = Object.freeze({ cancel() {}, setPriority() {} });

function coded(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/**
 * @param {object} deps
 * @param {string} deps.documentId
 * @param {{partFor(id: string, page: number, options?: object): Promise<{url: string, partIndex: number,
 *   pageOffset: number, pageCount: number, byteSize: number}>, invalidate(id: string, partIndex: number): void}} deps.documentFile
 * @param {object[]} [deps.parts] the document's `document_files` rows, passed on to `partFor` (F45)
 * @param {() => Promise<object>} deps.loadPdfjs
 * @param {typeof fetch} deps.fetch
 */
export function createPdfPool({ documentId, documentFile, parts, loadPdfjs, fetch, maxParts = MAX_OPEN_PARTS, maxRenders = MAX_RENDERS }) {
  let pdfjs = null;
  let loading = null;
  let destroyed = false;
  let clock = 0;
  let seq = 0;
  const open = new Map();
  const queue = [];
  const running = new Set();

  function ensurePdfjs() {
    if (pdfjs) return Promise.resolve(pdfjs);
    loading ??= Promise.resolve()
      .then(() => loadPdfjs())
      .then((module) => { pdfjs = module; return module; }, () => { loading = null; throw coded(PDF_LOADER_FAILED); });
    return loading;
  }

  function closePart(part) {
    if (part.closed) return;
    part.closed = true;
    part.abort.abort();
    Promise.resolve(part.task.destroy()).catch(() => {});
    if (open.get(part.info.partIndex) === part) open.delete(part.info.partIndex);
  }

  function openPart(info) {
    let failNow;
    const failure = new Promise((_, reject) => { failNow = reject; });
    failure.catch(() => {});
    const part = { info, closed: false, failure, task: null, abort: new AbortController(), busy: 0, lastUsed: ++clock };
    const reader = createRangeReader({
      async getUrl() {
        const signed = await documentFile.partFor(documentId, info.pageOffset + 1, { parts });
        if (signed.partIndex !== info.partIndex) throw coded(PDF_FETCH_FAILED);
        return signed.url;
      },
      invalidate: () => documentFile.invalidate(documentId, info.partIndex),
      fetch,
      signal: part.abort.signal,
    });
    const range = createPartTransport({ pdfjs, length: info.byteSize, read: reader.read, isClosed: () => part.closed, onFailure: failNow });
    part.task = pdfjs.getDocument({ range, length: info.byteSize, disableAutoFetch: true, disableStream: true, isEvalSupported: false, enableXfa: false });
    Promise.resolve(part.task.promise).catch(() => {});
    return part;
  }

  /** Close least recently used idle parts until there is room for one more. */
  function makeRoom() {
    while (open.size >= maxParts) {
      const idle = [...open.values()].filter(p => p.busy === 0).sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!idle) return;
      closePart(idle);
    }
  }

  /**
   * The open part holding `job`'s page, opening it if need be; never for a cancelled job. The part
   * is claimed (busy, most recently used) the moment it is chosen: another job making room in
   * the meantime must not close it.
   */
  async function partFor(job) {
    const { page } = job;
    const claim = (part) => {
      part.busy += 1;
      part.lastUsed = ++clock;
      return part;
    };
    for (const part of open.values()) if (covers(part.info, page)) return claim(part);
    const info = await documentFile.partFor(documentId, page, { parts });
    if (destroyed || job.cancelled) throw coded('cancelled');
    await ensurePdfjs();
    if (destroyed || job.cancelled) throw coded('cancelled');
    const existing = open.get(info.partIndex);
    if (existing) return claim(existing);
    makeRoom();
    const part = openPart(info);
    open.set(info.partIndex, part);
    return claim(part);
  }

  async function run(job) {
    try {
      const part = await partFor(job);
      // Released in finally, even when the job was cancelled while its part was being found.
      job.part = part;
      if (job.cancelled) return;
      const race = promise => Promise.race([promise, part.failure]);
      const doc = await race(part.task.promise);
      if (job.cancelled) return;
      const pdfPage = await race(doc.getPage(job.page - part.info.pageOffset));
      if (job.cancelled) return;

      const base = pdfPage.getViewport({ scale: 1 });
      const scale = job.scaleFor ? job.scaleFor({ width: base.width, height: base.height }) : job.scale;
      const viewport = pdfPage.getViewport({ scale });
      const size = canvasSize(viewport.width, viewport.height, job.dpr);
      job.canvas.width = size.width;
      job.canvas.height = size.height;
      job.canvas.style.width = `${size.cssWidth}px`;
      job.canvas.style.height = `${size.cssHeight}px`;
      job.renderTask = pdfPage.render({
        canvasContext: job.canvas.getContext('2d'),
        viewport,
        transform: size.scale !== 1 ? [size.scale, 0, 0, size.scale, 0, 0] : undefined,
        annotationMode: pdfjs.AnnotationMode?.ENABLE,
      });
      await race(job.renderTask.promise);
      if (job.cancelled) return;

      if (job.textLayer) {
        job.textLayer.replaceChildren();
        job.textLayer.style.setProperty('--scale-factor', String(scale));
        job.textTask = new pdfjs.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: job.textLayer, viewport });
        await race(job.textTask.render());
        if (job.cancelled) return;
      }
      job.onDone?.({ status: 'done', viewport: { width: base.width, height: base.height }, scale, cssWidth: size.cssWidth, cssHeight: size.cssHeight });
    } catch (error) {
      if (job.cancelled || destroyed || CANCELLED_NAMES.has(error?.name)) return;
      if (job.part) closePart(job.part);
      job.onError?.(error);
    } finally {
      if (job.part) job.part.busy -= 1;
      running.delete(job);
      pump();
    }
  }

  const order = (a, b) => (a.kind === 'thumb') - (b.kind === 'thumb') || a.priority - b.priority || a.seq - b.seq;

  function pump() {
    while (!destroyed && running.size < maxRenders && queue.length) {
      queue.sort(order);
      const job = queue.shift();
      running.add(job);
      run(job);
    }
  }

  function stop(job) {
    job.cancelled = true;
    try { job.renderTask?.cancel(); } catch { /* already settled */ }
    try { job.textTask?.cancel(); } catch { /* already settled */ }
  }

  return {
    /**
     * Queue a render of 1-based `page` into `canvas` (and its text into `textLayer`), at
     * `scaleFor(base)` (from the page's unscaled size) or `scale`. `onDone` gets
     * `{status: 'done', viewport, scale, cssWidth, cssHeight}`; `onError` the failure.
     * @returns {{cancel(): void, setPriority(priority: number): void}}
     */
    request({ page, canvas, textLayer = null, scale = 1, scaleFor = null, dpr = 1, kind = 'page', priority = 0, onDone, onError }) {
      if (destroyed) return NO_HANDLE;
      const job = { page, canvas, textLayer, scale, scaleFor, dpr, kind, priority, seq: ++seq, onDone, onError, cancelled: false };
      queue.push(job);
      pump();
      return {
        cancel() {
          const at = queue.indexOf(job);
          if (at >= 0) queue.splice(at, 1);
          stop(job);
        },
        setPriority(next) { job.priority = next; },
      };
    },
    /** Cancel everything and close every part. The pool is unusable afterwards. */
    destroy() {
      destroyed = true;
      queue.length = 0;
      for (const job of running) stop(job);
      for (const part of [...open.values()]) closePart(part);
    },
  };
}
