/**
 * The citation overlay's pure rules (docs/specs/2026-10-01-rag-v2-citations-pdf.md, decision 7 and
 * Design > Layout). CitationOverlay.jsx applies them; citation-overlay.css states the same width in
 * CSS, `min(100vw, max(50vw, 960px))`, so the overlay follows the viewport without JavaScript.
 */

/** The app's breakpoint at which the dock stacks under the desk (index.css, `max-width: 900px`). */
export const NARROW_QUERY = '(max-width: 900px)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** The owner-confirmed minimum: each half at least 480 px where the screen allows. */
export const OVERLAY_MIN_PX = 960;

const size = value => (Number.isFinite(value) && value > 0 ? value : 0);

/** max(50vw, 960px), capped at the viewport width. */
export function overlayWidth(viewportWidth) {
  const vw = size(viewportWidth);
  return Math.min(vw, Math.max(vw / 2, OVERLAY_MIN_PX));
}

/**
 * How far right of its resting place the overlay starts (and ends, when closing): its left edge
 * then sits where the dock's left edge is, so the chat appears to move out from the dock.
 */
export function overlayShift(viewportWidth, dockWidth) {
  const dock = size(dockWidth);
  if (!dock) return 0;
  return Math.max(0, Math.round(overlayWidth(viewportWidth) - dock));
}

/**
 * closed → opening → open → closing → closed. `opening` is one frame at the start position before
 * the transition runs; `closing` keeps the overlay out while it slides back. `instant` (reduced
 * motion, or a phone, where the chat never moves) skips both.
 */
export function nextPhase(phase, open, { instant = false } = {}) {
  if (open) {
    if (phase === 'opening' || phase === 'open') return phase;
    if (phase === 'closing' || instant) return 'open';
    return 'opening';
  }
  if (phase === 'closed') return 'closed';
  return instant ? 'closed' : 'closing';
}
