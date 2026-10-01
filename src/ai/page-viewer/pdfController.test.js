import { describe, expect, it, vi } from 'vitest';
import { DOCUMENT_FILE_FAILED } from '../../lib/documentFile.js';
import { PDF_FETCH_FAILED, PDF_RANGE_MISMATCH } from './rangeTransport.js';
import {
  MAX_CANVAS_PIXELS, PDF_NOTICES, canvasSize, createPartTransport, createPdfController, pdfFailureNotice,
} from './pdfController.js';

const SIGNED = 'https://nter.supabase.co/storage/v1/object/sign/corpus/files/abc.pdf?token=SECRET';

/** Two parts: pages 1-5 and 6-12. */
const PARTS = [
  { partIndex: 0, pageOffset: 0, pageCount: 5, byteSize: 1000 },
  { partIndex: 1, pageOffset: 5, pageCount: 7, byteSize: 2000 },
];

function fakeDocumentFile() {
  return {
    partFor: vi.fn(async (_id, page) => {
      const part = PARTS.find(p => p.pageOffset < page && page <= p.pageOffset + p.pageCount);
      return { ...part, url: `${SIGNED}&part=${part.partIndex}` };
    }),
    invalidate: vi.fn(),
  };
}

const cancelledError = () => Object.assign(new Error('Rendering cancelled, page 1'), { name: 'RenderingCancelledException' });

/**
 * A fake pdf.js. Renders stay pending until the test settles them (`log.renders[i].finish()`),
 * so a test can page while a render is in flight. `range: 'request'` makes getDocument ask its
 * transport for bytes and never resolve, as a real worker would while waiting.
 */
function fakePdfjs({ range = null } = {}) {
  const log = { tasks: [], renders: [], textLayers: [], getPage: [] };
  class PDFDataRangeTransport {
    constructor(length, initialData) {
      this.length = length;
      this.initialData = initialData;
      this.received = [];
    }
    onDataRange(begin, chunk) { this.received.push([begin, chunk]); }
  }
  const page = n => ({
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale, scale, rawDims: {} }),
    streamTextContent: () => ({ stream: n }),
    render(params) {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      const entry = { page: n, params, finish: () => resolve(), cancel: vi.fn(() => reject(cancelledError())) };
      log.renders.push(entry);
      return { promise, cancel: entry.cancel };
    },
  });
  const pdfjs = {
    PDFDataRangeTransport,
    AnnotationMode: { DISABLE: 0, ENABLE: 1, ENABLE_FORMS: 2 },
    getDocument(options) {
      const doc = { numPages: 5, getPage: vi.fn(async n => { log.getPage.push(n); return page(n); }) };
      let promise = Promise.resolve(doc);
      if (range === 'request') {
        promise = new Promise(() => {});
        options.range.requestDataRange(0, 1024);
      }
      const task = { options, promise, destroy: vi.fn(async () => {}) };
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

function fakeCanvas() {
  return { width: 0, height: 0, style: {}, getContext: vi.fn(() => ({ ctx: true })) };
}
function fakeTextLayer() {
  const props = {};
  return { props, replaceChildren: vi.fn(), style: { setProperty: (k, v) => { props[k] = v; } } };
}

const flush = () => new Promise(r => setTimeout(r, 0));

async function waitForRenders(log, count) {
  for (let i = 0; i < 20 && log.renders.length < count; i += 1) await flush();
  expect(log.renders).toHaveLength(count);
}

function setup(options) {
  const { pdfjs, log } = fakePdfjs(options);
  const documentFile = fakeDocumentFile();
  const fetch = vi.fn();
  const controller = createPdfController({ documentId: 'd1', documentFile, loadPdfjs: async () => pdfjs, fetch });
  return { controller, log, documentFile, fetch, pdfjs };
}

describe('createPdfController.render', () => {
  it('opens the part by range with safe options and renders the local page at container width', async () => {
    const { controller, log } = setup();
    const canvas = fakeCanvas();
    const textLayer = fakeTextLayer();
    const pending = controller.render({ page: 7, canvas, textLayer, width: 300, zoom: 1, dpr: 2 });
    await waitForRenders(log, 1);
    log.renders[0].finish();
    const result = await pending;

    expect(log.tasks).toHaveLength(1);
    const { options } = log.tasks[0];
    expect(options).toMatchObject({ length: 2000, disableAutoFetch: true, disableStream: true, isEvalSupported: false, enableXfa: false });
    expect(options.range.length).toBe(2000);
    expect(options.range.initialData).toBeNull();
    expect(options).not.toHaveProperty('url');
    expect(log.getPage).toEqual([2]);
    expect(log.renders[0].params.annotationMode).toBe(1);

    expect(canvas.style).toEqual({ width: '300px', height: '400px' });
    expect([canvas.width, canvas.height]).toEqual([600, 800]);
    expect(log.renders[0].params.transform).toEqual([2, 0, 0, 2, 0, 0]);
    expect(textLayer.props['--scale-factor']).toBe('0.5');
    expect(log.textLayers[0].options.container).toBe(textLayer);
    expect(result).toEqual({ status: 'done', viewport: { width: 600, height: 800 }, cssWidth: 300, cssHeight: 400 });
  });

  it('cancels the in-flight render when the reader pages again, and only the last one lands', async () => {
    const { controller, log } = setup();
    const canvas = fakeCanvas();
    const first = controller.render({ page: 1, canvas, width: 300 });
    await waitForRenders(log, 1);
    const second = controller.render({ page: 2, canvas, width: 300 });
    expect(log.renders[0].cancel).toHaveBeenCalledTimes(1);
    expect(await first).toEqual({ status: 'cancelled' });
    await waitForRenders(log, 2);
    log.renders[1].finish();
    expect((await second).status).toBe('done');
    expect(log.tasks).toHaveLength(1);
  });

  it('cancels a superseded text layer too', async () => {
    const { controller, log, pdfjs } = setup();
    let hold;
    pdfjs.TextLayer.prototype.render = function render() { return new Promise(r => { hold = r; }); };
    const first = controller.render({ page: 1, canvas: fakeCanvas(), textLayer: fakeTextLayer(), width: 300 });
    await waitForRenders(log, 1);
    log.renders[0].finish();
    for (let i = 0; i < 10 && !log.textLayers.length; i += 1) await flush();
    controller.cancel();
    expect(log.textLayers[0].cancel).toHaveBeenCalled();
    hold();
    expect(await first).toEqual({ status: 'cancelled' });
  });

  it('destroys the old document when paging into another part, and reuses a part within it', async () => {
    const { controller, log } = setup();
    const canvas = fakeCanvas();
    const go = async page => {
      const pending = controller.render({ page, canvas, width: 300 });
      await waitForRenders(log, log.renders.length + 1);
      log.renders.at(-1).finish();
      return pending;
    };
    await go(4);
    await go(5);
    expect(log.tasks).toHaveLength(1);
    await go(6);
    expect(log.tasks).toHaveLength(2);
    expect(log.tasks[0].destroy).toHaveBeenCalledTimes(1);
    expect(log.tasks[1].options.length).toBe(2000);
    expect(log.getPage).toEqual([4, 5, 1]);
  });

  it('on unmount mid-render it cancels the render and destroys the document', async () => {
    const { controller, log } = setup();
    const pending = controller.render({ page: 2, canvas: fakeCanvas(), width: 300 });
    await waitForRenders(log, 1);
    controller.destroy();
    expect(log.renders[0].cancel).toHaveBeenCalled();
    expect(log.tasks[0].destroy).toHaveBeenCalled();
    expect(await pending).toEqual({ status: 'cancelled' });
  });

  it('opens nothing when destroyed before the part arrives', async () => {
    const { controller, log } = setup();
    const pending = controller.render({ page: 2, canvas: fakeCanvas(), width: 300 });
    controller.destroy();
    expect(await pending).toEqual({ status: 'cancelled' });
    expect(log.tasks).toHaveLength(0);
  });

  it('caps the canvas area for iOS', async () => {
    const { controller, log } = setup();
    const canvas = fakeCanvas();
    const pending = controller.render({ page: 1, canvas, width: 6000, dpr: 3 });
    await waitForRenders(log, 1);
    log.renders[0].finish();
    await pending;
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(canvas.style.width).toBe('6000px');
  });

  it('fetches ranges through the signed URL and fails with a fixed error, never the URL', async () => {
    const { pdfjs } = fakePdfjs({ range: 'request' });
    const documentFile = fakeDocumentFile();
    const fetch = vi.fn(async () => ({ status: 500, arrayBuffer: async () => new ArrayBuffer(0) }));
    const controller = createPdfController({ documentId: 'd1', documentFile, loadPdfjs: async () => pdfjs, fetch });
    const error = await controller.render({ page: 1, canvas: fakeCanvas(), width: 300 }).catch(e => e);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('part=0'), expect.objectContaining({ headers: { Range: 'bytes=0-1023' } }));
    expect(error.code).toBe(PDF_FETCH_FAILED);
    expect(String(error.message)).not.toContain('http');
    expect(pdfFailureNotice(error)).toBe(PDF_NOTICES.download);
  });

  // Security review L3: closing the part (destroy, part switch) cancels its in-flight range reads.
  it('destroy aborts the part\'s in-flight range fetch', async () => {
    const { pdfjs } = fakePdfjs({ range: 'request' });
    const signals = [];
    const fetch = vi.fn((url, init) => new Promise(() => { signals.push(init.signal); }));
    const controller = createPdfController({ documentId: 'd1', documentFile: fakeDocumentFile(), loadPdfjs: async () => pdfjs, fetch });
    controller.render({ page: 1, canvas: fakeCanvas(), width: 300 }).catch(() => {});
    await flush();
    await flush();
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);
    controller.destroy();
    expect(signals[0].aborted).toBe(true);
  });

  it('renews the signature for its own part when Storage refuses it', async () => {
    const { pdfjs } = fakePdfjs({ range: 'request' });
    const documentFile = fakeDocumentFile();
    const fetch = vi.fn(async () => ({ status: 403, arrayBuffer: async () => new ArrayBuffer(0) }));
    const controller = createPdfController({ documentId: 'd1', documentFile, loadPdfjs: async () => pdfjs, fetch });
    await controller.render({ page: 7, canvas: fakeCanvas(), width: 300 }).catch(() => {});
    expect(documentFile.invalidate).toHaveBeenCalledWith('d1', 1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a loader failure is the loader class', async () => {
    const controller = createPdfController({
      documentId: 'd1', documentFile: fakeDocumentFile(), fetch: vi.fn(),
      loadPdfjs: async () => { throw new Error(`import of ${SIGNED} failed`); },
    });
    const error = await controller.render({ page: 1, canvas: fakeCanvas(), width: 300 }).catch(e => e);
    expect(pdfFailureNotice(error)).toBe(PDF_NOTICES.loader);
  });
});

describe('createPdfController.schedule', () => {
  function fakeTimers() {
    let next = 1;
    const pending = new Map();
    return {
      setTimeout: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
      clearTimeout: id => pending.delete(id),
      runAll() { const all = [...pending.values()]; pending.clear(); all.forEach(t => t.fn()); },
      pending,
    };
  }

  it('debounces held-down paging into one render of the last page', async () => {
    const { pdfjs, log } = fakePdfjs();
    const timers = fakeTimers();
    const controller = createPdfController({ documentId: 'd1', documentFile: fakeDocumentFile(), loadPdfjs: async () => pdfjs, fetch: vi.fn(), timers });
    const onDone = vi.fn();
    const canvas = fakeCanvas();
    for (const page of [1, 2, 3, 4]) controller.schedule({ page, canvas, width: 300 }, { delay: 120, onDone });
    expect(timers.pending.size).toBe(1);
    expect([...timers.pending.values()][0].ms).toBe(120);
    timers.runAll();
    await waitForRenders(log, 1);
    expect(log.getPage).toEqual([4]);
    log.renders[0].finish();
    for (let i = 0; i < 10 && !onDone.mock.calls.length; i += 1) await flush();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }));
  });

  it('reports a failure through onError and not a cancellation', async () => {
    const timers = fakeTimers();
    const controller = createPdfController({
      documentId: 'd1', documentFile: { partFor: async () => { throw Object.assign(new Error(DOCUMENT_FILE_FAILED), { code: 'not_found' }); }, invalidate() {} },
      loadPdfjs: async () => fakePdfjs().pdfjs, fetch: vi.fn(), timers,
    });
    const onError = vi.fn();
    controller.schedule({ page: 1, canvas: fakeCanvas(), width: 300 }, { onError });
    timers.runAll();
    for (let i = 0; i < 10 && !onError.mock.calls.length; i += 1) await flush();
    expect(pdfFailureNotice(onError.mock.calls[0][0])).toBe(PDF_NOTICES.notFound);
  });
});

describe('createPartTransport', () => {
  it('answers pdf.js range requests through the reader with onDataRange', async () => {
    const { pdfjs } = fakePdfjs();
    const buffer = new ArrayBuffer(10);
    const read = vi.fn(async () => buffer);
    const transport = createPartTransport({ pdfjs, length: 1000, read, onFailure: vi.fn() });
    expect(transport).toBeInstanceOf(pdfjs.PDFDataRangeTransport);
    expect(transport.length).toBe(1000);
    transport.requestDataRange(0, 10);
    await flush();
    expect(read).toHaveBeenCalledWith(0, 10);
    expect(transport.received).toEqual([[0, buffer]]);
  });

  it('reports a failed read and delivers nothing', async () => {
    const { pdfjs } = fakePdfjs();
    const failure = Object.assign(new Error(PDF_RANGE_MISMATCH), { code: PDF_RANGE_MISMATCH });
    const onFailure = vi.fn();
    const transport = createPartTransport({ pdfjs, length: 1000, read: async () => { throw failure; }, onFailure });
    transport.requestDataRange(10, 20);
    await flush();
    expect(onFailure).toHaveBeenCalledWith(failure);
    expect(transport.received).toEqual([]);
  });

  it('delivers nothing to a closed part', async () => {
    const { pdfjs } = fakePdfjs();
    const transport = createPartTransport({ pdfjs, length: 1000, read: async () => new ArrayBuffer(4), onFailure: vi.fn(), isClosed: () => true });
    transport.requestDataRange(0, 4);
    await flush();
    expect(transport.received).toEqual([]);
  });
});

describe('pdfFailureNotice', () => {
  const coded = (message, code, name) => Object.assign(new Error(message), { code, ...(name ? { name } : {}) });

  it('chooses a fixed notice by error class and never echoes the error text', () => {
    const cases = [
      [coded(`GET ${SIGNED} 500`, PDF_FETCH_FAILED), PDF_NOTICES.download],
      [coded(`range of ${SIGNED}`, PDF_RANGE_MISMATCH), PDF_NOTICES.download],
      [coded(DOCUMENT_FILE_FAILED, 'not_found'), PDF_NOTICES.notFound],
      [coded(DOCUMENT_FILE_FAILED, 'unauthorized'), PDF_NOTICES.unauthorized],
      [coded(DOCUMENT_FILE_FAILED, 'unavailable'), PDF_NOTICES.unavailable],
      [coded(DOCUMENT_FILE_FAILED, 'bad_response'), PDF_NOTICES.unavailable],
      [coded(`Invalid PDF structure at ${SIGNED}`, undefined, 'InvalidPDFException'), PDF_NOTICES.invalid],
      [coded(`Unexpected server response (403) while retrieving PDF "${SIGNED}".`, undefined, 'UnexpectedResponseException'), PDF_NOTICES.download],
      [new Error(`Something about ${SIGNED}`), PDF_NOTICES.generic],
      [null, PDF_NOTICES.generic],
      ['a string', PDF_NOTICES.generic],
    ];
    for (const [error, notice] of cases) {
      const text = pdfFailureNotice(error);
      expect(text).toBe(notice);
      expect(text).not.toMatch(/https?:|token|SECRET/);
    }
  });

  it('every notice is a fixed sentence without a URL', () => {
    for (const text of Object.values(PDF_NOTICES)) expect(text).not.toMatch(/https?:/);
  });
});

describe('canvasSize', () => {
  it('scales by devicePixelRatio below the cap', () => {
    expect(canvasSize(300, 400, 2)).toEqual({ width: 600, height: 800, cssWidth: 300, cssHeight: 400, scale: 2 });
    expect(canvasSize(300, 400, 0)).toMatchObject({ width: 300, scale: 1 });
  });

  it('lowers the scale to keep the area under the cap', () => {
    const size = canvasSize(5000, 7000, 3);
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(size.scale).toBeLessThan(1);
    expect(size.cssWidth).toBe(5000);
  });
});
