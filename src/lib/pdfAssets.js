/**
 * F178 / F183: a PDF whose fonts are CID-keyed (much Indian-government text) needs pdf.js's character
 * maps, and one that names a standard font without embedding it needs the standard font files, or its
 * text comes out wrong or empty. They are served from /pdfjs/ (vite.config.js copies them from
 * pdfjs-dist, so they match the installed version). Only in a browser: in Node pdf.js reads its own
 * files.
 *
 * This module has no imports on purpose: every pdf.js reader (chat uploads, the admin uploader, the
 * page viewer) spreads `pdfAssetOptions()` into `getDocument`, and none of them may pull pdf.js or
 * anything else into the entry chunk through it.
 */
export function pdfAssetOptions() {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return {};
  const base = import.meta.env?.BASE_URL || '/';
  return { cMapUrl: `${base}pdfjs/cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}pdfjs/standard_fonts/` };
}
