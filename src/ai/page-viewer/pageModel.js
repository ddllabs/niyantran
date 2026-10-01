/**
 * Pure functions behind the page-wise citation viewer
 * (docs/specs/2026-10-01-rag-v2-citations-pdf.md, "The flow" steps 4-6).
 * No React and no pdf.js: everything here is data in, data out.
 *
 * Inputs are the shapes the viewer reads:
 * - a citation already passed through `sanitizeCitation` (`boxes` are fractions of the page,
 *   top-left origin; `char_from`/`char_to` are global offsets into `documents.ocr_text`);
 * - `documents`: `{storage_path, indexed_at, extract_hash, page_count}`;
 * - `document_files`: `{part_index, page_offset, page_count, byte_size}`, `page_offset` 0-based;
 * - `document_pages`: `{page_number, text, char_from, char_to, width_px, height_px}`, where
 *   `ocr_text.slice(char_from, char_to) === text`.
 */

const isInt = value => Number.isSafeInteger(value);
const isPositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const nonblank = value => typeof value === 'string' && value.trim() !== '';

/** The part holding 1-based `page`: `page_offset < page <= page_offset + page_count`, or null. */
export function partForPage(parts, page) {
  if (!Array.isArray(parts) || !isInt(page) || page < 1) return null;
  return parts.find(p => p && isInt(p.page_offset) && isInt(p.page_count)
    && p.page_offset < page && page <= p.page_offset + p.page_count) ?? null;
}

/**
 * The citation's span in page-local offsets, or null when any part of it lies outside the page.
 * It is never clamped: a span that does not fit the page means the passage cannot be shown
 * there, which the Text view reports as `changed`.
 */
export function localSpan(citation, pageRow) {
  const from = citation?.char_from;
  const to = citation?.char_to;
  const start = pageRow?.char_from;
  const end = pageRow?.char_to;
  if (![from, to, start, end].every(isInt) || from > to) return null;
  if (from < start || to > end) return null;
  return { from: from - start, to: to - start };
}

/**
 * One row of the spec's state table. The first matching case wins:
 *
 * 1. `gone`              — the document no longer exists (`doc` null).
 * 2. `not_live`          — `indexed_at` is null: still processing, no PDF.
 * 3. `text_only`         — a `pdf_page` citation whose document has no `storage_path`.
 * 4. `stale`             — the citation's `extract_hash` differs from the document's:
 *                          page shown, no boxes, no span.
 * 5. `unknown_freshness` — the citation has no `extract_hash`: page shown, no boxes, no banner.
 * 6. `no_page_text`      — no `document_pages` row: Text says so, PDF still works.
 * 7. `ok`.
 *
 * Why this order: the first three decide which views exist at all, and each one hides the
 * later ones (nothing to show, or no PDF to draw on). Freshness (4, 5) comes before the page
 * row (6) because it decides whether boxes and the span may be trusted in either view.
 * The single state does not carry combinations: a `stale`, `unknown_freshness` or `text_only`
 * page can also lack its `document_pages` row, so the Text view still checks `pageRow` itself.
 */
export function viewerState({ doc, citation, pageRow }) {
  if (!doc) return 'gone';
  if (doc.indexed_at == null) return 'not_live';
  if (citation?.source_kind === 'pdf_page' && !nonblank(doc.storage_path)) return 'text_only';
  if (nonblank(citation?.extract_hash)) {
    if (citation.extract_hash !== doc.extract_hash) return 'stale';
  } else {
    return 'unknown_freshness';
  }
  if (!pageRow) return 'no_page_text';
  return 'ok';
}

/** The citation's boxes on `page`, without zero-width or zero-height ones. */
export function pageBoxes(citation, page) {
  const boxes = Array.isArray(citation?.boxes) ? citation.boxes : [];
  return boxes.filter(b => b && b.page === page && b.x1 > b.x0 && b.y1 > b.y0);
}

/** A fraction of the page as a CSS percentage, to a thousandth of a percent. */
const percent = fraction => `${Math.round(fraction * 100_000) / 1000}%`;

/** Absolute-position style for a box overlay sized to the page's CSS box. */
export function boxStyle(box) {
  return {
    left: percent(box.x0),
    top: percent(box.y0),
    width: percent(box.x1 - box.x0),
    height: percent(box.y1 - box.y0),
  };
}

/** Largest relative aspect difference for which stored boxes are trusted on the rendered page. */
const ASPECT_TOLERANCE = 0.02;

/**
 * True when the stored page aspect (`width_px / height_px`) is within 2% of the rendered
 * viewport's. False when any dimension is missing, zero or not a number, so boxes are only
 * drawn when alignment is known.
 */
export function aspectOk(pageRow, viewport) {
  const dims = [pageRow?.width_px, pageRow?.height_px, viewport?.width, viewport?.height];
  if (!dims.every(isPositive)) return false;
  const stored = pageRow.width_px / pageRow.height_px;
  const rendered = viewport.width / viewport.height;
  return Math.abs(stored - rendered) / rendered <= ASPECT_TOLERANCE;
}
