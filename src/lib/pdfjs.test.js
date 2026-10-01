// V3 of docs/plans/2026-10-01-rag-v2-citations-pdf.md: the shared, lazy pdf.js loader. Each test
// imports a fresh copy of the module (vi.resetModules) so the memo starts empty.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LEGACY = 'pdfjs-dist/legacy/build/pdf.mjs';

/** pdf.js's GlobalWorkerOptions is process-wide; every test puts workerSrc back as it found it. */
let legacyBuild;
let originalWorkerSrc;

beforeEach(async () => {
  vi.resetModules();
  legacyBuild = await import(LEGACY);
  originalWorkerSrc = legacyBuild.GlobalWorkerOptions.workerSrc;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock(LEGACY);
  legacyBuild.GlobalWorkerOptions.workerSrc = originalWorkerSrc;
});

const freshLoader = async () => (await import('./pdfjs.js')).loadPdfjs;

describe('loadPdfjs outside a browser (Vitest, Node scripts)', () => {
  it('resolves to the legacy build, which can open a document', async () => {
    const loadPdfjs = await freshLoader();
    const pdfjs = await loadPdfjs();
    expect(typeof pdfjs.getDocument).toBe('function');
    expect(pdfjs.GlobalWorkerOptions).toBe(legacyBuild.GlobalWorkerOptions);
  });

  it('leaves workerSrc to pdf.js (its in-process worker), as corpusUpload did', async () => {
    const loadPdfjs = await freshLoader();
    await loadPdfjs();
    expect(legacyBuild.GlobalWorkerOptions.workerSrc).toBe(originalWorkerSrc);
  });

  it('is memoised: every call shares one promise', async () => {
    const loadPdfjs = await freshLoader();
    const first = loadPdfjs();
    expect(loadPdfjs()).toBe(first);
    await first;
    expect(loadPdfjs()).toBe(first);
  });

  it('rejects when the import fails and clears the memo so a retry can succeed', async () => {
    vi.doMock(LEGACY, () => {
      throw new Error('chunk failed to load');
    });
    const loadPdfjs = await freshLoader();
    const failed = loadPdfjs();
    await expect(failed).rejects.toThrow();

    vi.doUnmock(LEGACY);
    const retry = loadPdfjs();
    expect(retry).not.toBe(failed);
    const pdfjs = await retry;
    expect(typeof pdfjs.getDocument).toBe('function');
  });
});

describe('loadPdfjs in a browser (window and Worker exist)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('Worker', class {});
  });

  it('loads the legacy build (Promise.withResolvers polyfilled) with its bundled legacy worker', async () => {
    const loadPdfjs = await freshLoader();
    const pdfjs = await loadPdfjs();
    expect(typeof pdfjs.getDocument).toBe('function');
    expect(pdfjs.GlobalWorkerOptions).toBe(legacyBuild.GlobalWorkerOptions);
    // A Vite asset URL for the legacy worker, never a CDN and never the modern build's worker.
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toMatch(/pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs$/);
    expect(pdfjs.GlobalWorkerOptions.workerSrc).not.toMatch(/^https?:/);
  });

  it('sets workerSrc once, however often it is called', async () => {
    const loadPdfjs = await freshLoader();
    const { GlobalWorkerOptions } = await loadPdfjs();
    const before = GlobalWorkerOptions.workerSrc;
    try {
      expect(before).toMatch(/pdf\.worker\.min\.mjs$/);
      GlobalWorkerOptions.workerSrc = 'sentinel';
      await loadPdfjs();
      await loadPdfjs();
      expect(GlobalWorkerOptions.workerSrc).toBe('sentinel');
    } finally {
      GlobalWorkerOptions.workerSrc = before;
    }
  });
});
