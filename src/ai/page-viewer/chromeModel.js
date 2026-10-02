/**
 * The viewer chrome's decisions, as pure functions (docs/specs/2026-10-02-viewer-toolbar.md). The
 * chrome components only render what these return, so each rule is testable in node.
 */

/** Below this measured width (px) the page toolbar is compact: zoom moves into the More menu. */
export const COMPACT_BELOW = 420;

const WHOLE = /^\d+$/;

/**
 * The page a typed value names, or null when it is not a whole page within 1..total. Null means
 * "do not move": the page box then shows the current page again.
 */
export function parsePageInput(text, total) {
  if (typeof text !== 'string' || !Number.isSafeInteger(total) || total < 1) return null;
  const value = text.trim();
  if (!WHOLE.test(value)) return null;
  const page = Number(value);
  return page >= 1 && page <= total ? page : null;
}

/** The cited chip: a status on the cited page, otherwise the way back to it. */
export function citedChip({ page, cited }) {
  if (page === cited) return { kind: 'status', label: `Cited p. ${cited}` };
  return { kind: 'return', label: `Back to p. ${cited}`, target: cited };
}

/** 'compact' below COMPACT_BELOW; 'full' otherwise, including before the first measurement. */
export function toolbarLayout(width) {
  return Number.isFinite(width) && width > 0 && width < COMPACT_BELOW ? 'compact' : 'full';
}

const FITS = Object.freeze([['text', 'Fit text'], ['width', 'Fit width'], ['page', 'Fit page']]);

/** The fit menu's items, the current fit checked; none under a manual zoom. */
export function fitItems({ fit, manual }) {
  return FITS.map(([value, label]) => ({ value, label, checked: !manual && value === fit }));
}
