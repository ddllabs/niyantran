import { describe, expect, it, vi } from 'vitest';
import { PDF_LOADER_FAILED } from './pdfController.js';
import { MAX_OPEN_PARTS, MAX_RENDERS, createPdfPool } from './pdfPool.js';

const SIGNED = 'https://nter.supabase.co/storage/v1/object/sign/corpus/files/abc.pdf?token=SECRET';

/** Four parts: pages 1-5, 6-10, 11-15 and 16-20. */
const PARTS = [0, 1, 2, 3].map(i => ({ partIndex: i, pageOffset: i * 5, pageCount: 5, byteSize: 1000 + i }));

function fakeDocumentFile() {
  return {
    partFor: vi.fn(async (_id, page) => {
      const part = PARTS.find(p => p.pageOffset < page && page <= p.pageOffset + p.pageCount);
      return { ...part, url: `${SIGNED}&part=${part.partIndex}` };
    }),
    invalidate: vi.fn(),
  };
}

const cancelledError = () => Object.assign(new Error('Rendering cancelled'), { name: 'RenderingCancelledException' });

/** A fake pdf.js whose renders stay pending until the test settles them. */
function fakePdfjs({ failRange = false } = {}) {
  const log = { tasks: [], renders: [], textLayers: [] };
  class PDFDataRangeTransport {
    constructor(length) { this.length = length; }
    onDataRange() {}
  }
  const page = (task, n) => ({
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale, scale }),
    streamTextContent: () => ({ stream: n }),
    render(params) {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      const entry = { part: task.partIndex, page: n, params, finish: () => resolve(), cancel: vi.fn(() => reject(cancelledError())) };
      log.renders.push(entry);
      return { promise, cancel: entry.cancel };
    },
  });
  const pdfjs = {
    PDFDataRangeTransport,
    AnnotationMode: { ENABLE: 1 },
    getDocument(options) {
      const task = { options, partIndex: PARTS.findIndex(p => p.byteSize === options.length), destroy: vi.fn(async () => {}) };
      task.promise = failRange
        ? new Promise(() => { options.range.requestDataRange(0, 10); })
        : Promise.resolve({ getPage: async n => page(task, n) });
      log.tasks.push(task);
      return task;
    },
    TextLayer: class {
      constructor(options) { this.options = options; this.cancel = vi.fn(); log.textLayers.push(this); }
      render() { return Promise.resolve(); }
    },
  };
  return { pdfjs, log };
}

const canvas = () => ({ width: 0, height: 0, style: {}, getContext: () => ({}) });
const textLayer = () => ({ replaceChildren: vi.fn(), style: { setProperty: vi.fn() } });
const flush = async (n = 6) => { for (let i = 0; i < n; i += 1) await new Promise(r => setTimeout(r, 0)); };

function setup(options) {
  const { pdfjs, log } = fakePdfjs(options);
  const documentFile = fakeDocumentFile();
  const fetch = vi.fn(async () => { throw new Error(`fetch failed for ${SIGNED}`); });
  const pool = createPdfPool({ documentId: 'd1', documentFile, loadPdfjs: async () => pdfjs, fetch });
  return { pool, log, documentFile, fetch };
}

function request(pool, page, extra = {}) {
  const calls = { done: [], error: [] };
  const handle = pool.request({
    page, canvas: canvas(), scale: 1, dpr: 1, priority: 0,
    onDone: result => calls.done.push(result), onError: error => calls.error.push(error),
    ...extra,
  });
  return { handle, calls };
}

describe('createPdfPool', () => {
  it('renders a page from its part, opened by range with safe options, and reports its sizes', async () => {
    const { pool, log } = setup();
    const { calls } = request(pool, 7, { scaleFor: base => 300 / base.width, dpr: 2, textLayer: textLayer() });
    await flush();
    expect(log.tasks).toHaveLength(1);
    expect(log.tasks[0].options).toMatchObject({ length: 1001, disableAutoFetch: true, disableStream: true, isEvalSupported: false, enableXfa: false });
    expect(log.tasks[0].options).not.toHaveProperty('url');
    expect(log.renders[0]).toMatchObject({ part: 1, page: 2 });
    log.renders[0].finish();
    await flush();
    expect(calls.done).toEqual([{ status: 'done', viewport: { width: 600, height: 800 }, scale: 0.5, cssWidth: 300, cssHeight: 400 }]);
    expect(log.textLayers).toHaveLength(1);
  });

  it(`runs at most ${MAX_RENDERS} renders at once, starting the next as one finishes`, async () => {
    const { pool, log } = setup();
    for (const page of [1, 2, 3]) request(pool, page);
    await flush();
    expect(log.renders.map(r => r.page)).toEqual([1, 2]);
    log.renders[0].finish();
    await flush();
    expect(log.renders.map(r => r.page)).toEqual([1, 2, 3]);
  });

  it('starts queued pages by priority, and thumbnails only after every page', async () => {
    const { pool, log } = setup();
    request(pool, 1, { priority: 0 });
    request(pool, 2, { priority: 0 });
    request(pool, 3, { kind: 'thumb', priority: 0 });
    request(pool, 4, { priority: 5 });
    request(pool, 5, { priority: 1 });
    await flush();
    log.renders[0].finish();
    log.renders[1].finish();
    await flush();
    log.renders[2].finish();
    log.renders[3].finish();
    await flush();
    expect(log.renders.map(r => r.page)).toEqual([1, 2, 5, 4, 3]);
  });

  it('a queued job can be reprioritised before it starts', async () => {
    const { pool, log } = setup();
    request(pool, 1);
    request(pool, 2);
    const late = request(pool, 3, { priority: 9 });
    request(pool, 4, { priority: 1 });
    late.handle.setPriority(0);
    await flush();
    log.renders[0].finish();
    await flush();
    expect(log.renders.map(r => r.page)).toEqual([1, 2, 3]);
  });

  it('a cancelled queued job never renders, and a cancelled running one is stopped and reports nothing', async () => {
    const { pool, log } = setup();
    const running = request(pool, 1);
    request(pool, 2);
    const queued = request(pool, 3);
    await flush();
    queued.handle.cancel();
    running.handle.cancel();
    await flush();
    expect(log.renders[0].cancel).toHaveBeenCalled();
    expect(running.calls).toEqual({ done: [], error: [] });
    log.renders[1].finish();
    await flush();
    expect(log.renders.map(r => r.page)).toEqual([1, 2]);
  });

  it('reuses an open part for its pages', async () => {
    const { pool, log } = setup();
    request(pool, 1);
    request(pool, 3);
    await flush();
    expect(log.tasks).toHaveLength(1);
  });

  it(`keeps at most ${MAX_OPEN_PARTS} parts open, closing the least recently used idle one`, async () => {
    const { pool, log } = setup();
    for (const page of [1, 6, 11]) {
      request(pool, page);
      await flush();
      log.renders.at(-1).finish();
      await flush();
    }
    request(pool, 2); // touches part 0 again, so part 1 is now the least recently used
    await flush();
    log.renders.at(-1).finish();
    await flush();
    request(pool, 16);
    await flush();
    expect(log.tasks).toHaveLength(4);
    expect(log.tasks[1].destroy).toHaveBeenCalled();
    expect(log.tasks.filter(t => t.destroy.mock.calls.length)).toHaveLength(1);
  });

  it('a part that cannot be read fails its jobs with an error that carries no URL, and is closed', async () => {
    const { pool, log } = setup({ failRange: true });
    const { calls } = request(pool, 1);
    await flush(12);
    expect(calls.error).toHaveLength(1);
    expect(String(calls.error[0]?.message)).not.toContain('SECRET');
    expect(log.tasks[0].destroy).toHaveBeenCalled();
  });

  it('a loader failure fails the job with the loader class', async () => {
    const documentFile = fakeDocumentFile();
    const pool = createPdfPool({ documentId: 'd1', documentFile, loadPdfjs: async () => { throw new Error('chunk load'); }, fetch: vi.fn() });
    const { calls } = request(pool, 1);
    await flush();
    expect(calls.error[0]?.code).toBe(PDF_LOADER_FAILED);
  });

  it('destroy cancels everything, closes every part, and ignores later requests', async () => {
    const { pool, log } = setup();
    request(pool, 1);
    request(pool, 6);
    request(pool, 11);
    await flush();
    pool.destroy();
    await flush();
    expect(log.renders.every(r => r.cancel.mock.calls.length === 1)).toBe(true);
    expect(log.tasks.every(t => t.destroy.mock.calls.length === 1)).toBe(true);
    const late = request(pool, 2);
    await flush();
    expect(late.calls).toEqual({ done: [], error: [] });
    expect(log.renders).toHaveLength(2);
  });
});
