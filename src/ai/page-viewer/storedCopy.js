/**
 * "Open stored copy" (docs/specs/2026-10-01-rag-v2-citations-pdf.md, "Open stored copy").
 *
 * The blank tab is opened synchronously, inside the click, so pop-up blockers allow it; the
 * signed URL arrives afterwards and the tab is pointed at it. On any failure the tab is closed
 * and a fixed notice comes back. The URL is a bearer credential for 5 minutes: it is handed to
 * the new tab only, never returned, rendered or logged, and no error text is passed on.
 */

export const STORED_COPY_NOTICES = Object.freeze({
  blocked: 'Your browser blocked the new tab. Allow pop-ups for this site and try again.',
  failed: 'The stored copy could not be opened. Try again.',
});

/**
 * @param {object} deps
 * @param {(url: string, target: string) => Window | null} [deps.open]   window.open
 * @param {{partFor(documentId: string, page: number, options?: {parts?: object[]}): Promise<{url: string}>}} deps.documentFile
 * @param {string} deps.documentId
 * @param {number} deps.page   the viewer's current page; its part is the one opened
 * @param {object[]} [deps.parts]   the `document_files` rows, so the part's cached signature is shared
 * @returns {Promise<{ok: true} | {ok: false, notice: string}>}
 */
export function openStoredCopy({ open = (...args) => globalThis.window?.open(...args), documentFile, documentId, page, parts }) {
  // Synchronous up to here: this must run inside the click's user activation.
  let tab = null;
  try {
    tab = open('', '_blank');
  } catch {
    tab = null;
  }
  if (!tab) return Promise.resolve({ ok: false, notice: STORED_COPY_NOTICES.blocked });
  try {
    tab.opener = null;
  } catch {
    // A tab that refuses the assignment still gets the URL; it was opened blank by us.
  }
  return (async () => {
    try {
      const { url } = await documentFile.partFor(documentId, page, { parts });
      tab.location.href = url;
      return { ok: true };
    } catch {
      try {
        tab.close();
      } catch {
        // Already closed by the reader.
      }
      return { ok: false, notice: STORED_COPY_NOTICES.failed };
    }
  })();
}
