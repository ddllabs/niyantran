/**
 * pdfjs-dist, loaded once and lazily, for every caller in the app (the admin uploader in
 * corpusUpload.js and the citation page viewer; docs/specs/2026-10-01-rag-v2-citations-pdf.md).
 *
 * - Browser (`window` and `Worker` exist): pdf.js's **legacy build**, because the modern build
 *   calls `Promise.withResolvers` unpolyfilled and fails on Safari before 17.4. Its worker is the
 *   legacy worker, bundled by Vite as a `?url` asset (never a CDN), and `GlobalWorkerOptions.workerSrc`
 *   is set once, when the module first loads.
 * - Otherwise (Vitest's node environment, Node scripts): the same legacy build, which runs its
 *   worker in-process. The specifier is a variable with `@vite-ignore` so this branch adds nothing
 *   to the production bundle.
 *
 * Both branches are dynamic imports, so pdf.js stays out of the main entry chunk
 * (`npm run check:bundle` enforces it). If loading fails the promise rejects and the memo is
 * cleared, so a later call retries.
 */
let pdfjsLoading = null;

/** @returns {Promise<typeof import('pdfjs-dist')>} the legacy build, memoised */
export function loadPdfjs() {
  if (!pdfjsLoading) {
    const browser = typeof window !== 'undefined' && typeof Worker !== 'undefined';
    pdfjsLoading = (browser ? loadBrowserPdfjs() : loadNodePdfjs()).catch((error) => {
      pdfjsLoading = null;
      throw error;
    });
  }
  return pdfjsLoading;
}

async function loadBrowserPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

function loadNodePdfjs() {
  const legacy = 'pdfjs-dist/legacy/build/pdf.mjs';
  return import(/* @vite-ignore */ legacy);
}
