// F183: every pdf.js reader hands pdf.js its character maps and standard fonts in a browser.
// The admin uploader's inspectPdf is exercised here with a stand-in loader; the chat reader and the
// page viewer have the same check in chatUploads.test.js and pdfPool.test.js.
import { afterEach, describe, expect, it, vi } from 'vitest';

const seen = [];
vi.mock('./pdfjs.js', () => ({
  loadPdfjs: async () => ({
    getDocument(options) {
      seen.push(options);
      return {
        promise: Promise.resolve({ numPages: 2, getMetadata: async () => ({ info: {} }) }),
        destroy: async () => {},
      };
    },
  }),
}));
vi.mock('./supabaseClient.js', () => ({ supabase: {}, accessToken: vi.fn(), functionsUrl: (n) => n }));

import { pdfAssetOptions } from './pdfAssets.js';
import { inspectPdf } from './corpusUpload.js';
import { pdfAssetOptions as reExported } from './fileText.js';

afterEach(() => {
  vi.unstubAllGlobals();
  seen.length = 0;
});

describe('pdfAssetOptions', () => {
  it('is empty outside a browser, so pdf.js reads its own files', () => {
    expect(pdfAssetOptions()).toEqual({});
  });

  it('names the packed cmaps and the standard fonts in a browser', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('Worker', class {});
    expect(pdfAssetOptions()).toEqual({ cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/' });
  });

  it('is still exported from fileText.js', () => {
    expect(reExported).toBe(pdfAssetOptions);
  });
});

describe('the admin uploader (inspectPdf)', () => {
  it('in the browser, opens the PDF with the cmaps and standard fonts', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('Worker', class {});
    await inspectPdf(new Uint8Array([1, 2, 3]));
    expect(seen[0]).toMatchObject({ cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/' });
  });

  it('outside a browser, passes no asset URLs', async () => {
    await inspectPdf(new Uint8Array([1, 2, 3]));
    expect(seen[0]).not.toHaveProperty('cMapUrl');
  });
});
