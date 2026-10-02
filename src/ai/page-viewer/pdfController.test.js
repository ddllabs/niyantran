import { describe, expect, it, vi } from 'vitest';
import { DOCUMENT_FILE_FAILED } from '../../lib/documentFile.js';
import { PDF_FETCH_FAILED, PDF_RANGE_MISMATCH } from './rangeTransport.js';
import { MAX_CANVAS_PIXELS, PDF_NOTICES, canvasSize, createPartTransport, pdfFailureNotice } from './pdfController.js';

const SIGNED = 'https://nter.supabase.co/storage/v1/object/sign/corpus/files/abc.pdf?token=SECRET';



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


const flush = () => new Promise(r => setTimeout(r, 0));



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
