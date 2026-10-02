import { describe, expect, it, vi } from 'vitest';
import { createDocumentFileClient } from '../../lib/documentFile.js';
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
  const log = { tasks: [], renders: [], textLayers: [], cleanups: [] };
  class PDFDataRangeTransport {
    constructor(length) { this.length = length; }
    onDataRange() {}
  }
  const page = (task, n) => ({
    cleanup: vi.fn(() => log.cleanups.push({ part: task.partIndex, page: n })),
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale, scale }),
    streamTextContent: () => ({ stream: n }),
    render(params) {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      const entry = { part: task.partIndex, page: n, params, finish: () => resolve(), fail: error => reject(error), cancel: vi.fn(() => reject(cancelledError())) };
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

  it('a job cancelled while its part is being located opens no part', async () => {
    const { pool, log } = setup();
    const job = request(pool, 1);
    job.handle.cancel();
    await flush();
    expect(log.tasks).toHaveLength(0);
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

  // The race: a job takes an open idle part, and before it marks the part busy, another job that
  // must open a fourth part makes room by closing the least recently used idle part - that one.
  // Every interleaving of the two, a microtask at a time, must leave the part in use open.
  for (const ticks of [0, 1, 2, 3, 4, 5, 6]) {
    it(`a part chosen for a job is never closed to make room before the job uses it (${ticks} ticks apart)`, async () => {
      const { pool, log, documentFile } = setup();
      for (const page of [1, 6, 11]) {
        request(pool, page);
        await flush();
        log.renders.at(-1).finish();
        await flush();
      }
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const real = documentFile.partFor.getMockImplementation();
      documentFile.partFor.mockImplementationOnce(async (...args) => { await held; return real(...args); });
      request(pool, 16);
      await flush();
      release();
      for (let i = 0; i < ticks; i += 1) await Promise.resolve();
      request(pool, 2);
      await flush();
      // Page 2 is drawn from part 0's latest opening, which is still open. (Part 0 may have been
      // closed and opened again when room was made before page 2 was asked for; that is fine.)
      expect(log.renders.find(r => r.page === 2 && r.part === 0)).toBeTruthy();
      expect(log.tasks.filter(t => t.partIndex === 0).at(-1).destroy).not.toHaveBeenCalled();
    });
  }

  it('a page that fails alone (here a thumbnail) fails only its own job: its part stays open and pages on it draw on', async () => {
    const { pool, log } = setup();
    const pageJob = request(pool, 1);
    const thumbJob = request(pool, 2, { kind: 'thumb' });
    await flush();
    log.renders.find(r => r.page === 2).fail(new Error('bad page stream'));
    await flush();
    expect(thumbJob.calls.error).toHaveLength(1);
    expect(log.tasks[0].destroy).not.toHaveBeenCalled();
    log.renders.find(r => r.page === 1).finish();
    await flush();
    expect(pageJob.calls.done).toHaveLength(1);
    expect(pageJob.calls.error).toEqual([]);
  });

  it('releases each page\'s resources after it is drawn', async () => {
    const { pool, log } = setup();
    request(pool, 3);
    await flush();
    expect(log.cleanups).toEqual([]);
    log.renders[0].finish();
    await flush();
    expect(log.cleanups).toEqual([{ part: 0, page: 3 }]);
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

// Carried over from the single-page controller (F45): the part layout reaches every partFor, a
// refused signature is renewed for its own part, and pages of one part ask document-file once.
describe('createPdfPool part layout and signatures', () => {
  const LAYOUT = PARTS.map(p => ({ part_index: p.partIndex, page_offset: p.pageOffset, page_count: p.pageCount, byte_size: p.byteSize }));

  it('passes the layout on every partFor, opening a part and renewing its signature, and renews its own part', async () => {
    const { pdfjs } = fakePdfjs({ failRange: true });
    const documentFile = fakeDocumentFile();
    const fetch = vi.fn(async () => ({ status: 403, arrayBuffer: async () => new ArrayBuffer(0) }));
    const pool = createPdfPool({ documentId: 'd1', documentFile, parts: LAYOUT, loadPdfjs: async () => pdfjs, fetch });
    request(pool, 7);
    await flush(12);
    expect(documentFile.partFor.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of documentFile.partFor.mock.calls) expect(call[2]).toEqual({ parts: LAYOUT });
    expect(documentFile.invalidate).toHaveBeenCalledWith('d1', 1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('pages of one part ask document-file once, through the real client', async () => {
    const { pdfjs } = fakePdfjs();
    const bodies = [];
    const held = [];
    const ask = body => new Promise((resolve) => {
      bodies.push(body);
      held.push(() => resolve({ ok: true, signed_path: `object/sign/corpus/files/${'1'.repeat(64)}.pdf?token=t`, ...LAYOUT[1], expires_in: 300 }));
    });
    const documentFile = createDocumentFileClient({ request: ask, baseUrl: 'http://127.0.0.1:54321' });
    const pool = createPdfPool({ documentId: 'd1', documentFile, parts: LAYOUT, loadPdfjs: async () => pdfjs, fetch: vi.fn() });
    for (const page of [6, 7, 8]) request(pool, page);
    await flush();
    expect(bodies).toEqual([{ document_id: 'd1', page: 6 }]);
    held.forEach(go => go());
    await flush(12);
    pool.destroy();
    expect(bodies).toHaveLength(1);
  });
});
