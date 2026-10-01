/**
 * The citation overlay's pure rules (docs/specs/2026-10-01-rag-v2-citations-pdf.md, decision 7 and
 * Design > Layout, and revision 4 point 1). CitationOverlay.jsx applies them; citation-overlay.css
 * states the default width in CSS, `min(100vw, max(50vw, 960px))`, as the fallback for the
 * --cov-width that CitationOverlay sets from these rules.
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
 * then sits where the dock's left edge is, so the chat appears to move out from the dock. `width`
 * is the overlay's current (possibly resized) width; it defaults to today's rule.
 */
export function overlayShift(viewportWidth, dockWidth, width = overlayWidth(viewportWidth)) {
  const dock = size(dockWidth);
  if (!dock) return 0;
  return Math.max(0, Math.round(size(width) - dock));
}

/* Revision 4, point 1: the resizable overlay. The outer edge sets the width; the middle divider
   sets the viewer's share. Both are remembered per browser and reset on double-click. */

export const WIDTH_STORAGE_KEY = 'niyantranCitationOverlayWidth';
export const SPLIT_STORAGE_KEY = 'niyantranCitationSplit';
/** The sliver of the desk that stays visible at the widest. */
export const DESK_SLIVER_PX = 120;
export const SPLIT_MIN = 30;
export const SPLIT_MAX = 75;
export const SPLIT_DEFAULT = 50;
export const WIDTH_KEY_STEP_PX = 16;
export const SPLIT_KEY_STEP_PCT = 2;
/** Shift multiplies a key step. */
export const SHIFT_FACTOR = 4;

const within = (value, min, max) => Math.min(max, Math.max(min, value));

/** 960 px (or the viewport, if narrower) to the viewport less 120 px; never max < min. */
export function widthBounds(viewportWidth) {
  const vw = size(viewportWidth);
  const min = Math.min(vw, OVERLAY_MIN_PX);
  return { min, max: Math.max(min, vw - DESK_SLIVER_PX) };
}

/** Today's rule, which always lies within the bounds. */
export const defaultWidth = overlayWidth;

/** A width clamped to the bounds in whole pixels; a non-number gives the default. */
export function clampWidth(value, viewportWidth) {
  if (!Number.isFinite(value)) return defaultWidth(viewportWidth);
  const { min, max } = widthBounds(viewportWidth);
  return Math.round(within(value, min, max));
}

/** The chosen width (null: none, so it tracks the viewport) clamped to the current viewport. */
export function resolveWidth(chosen, viewportWidth) {
  return chosen == null ? defaultWidth(viewportWidth) : clampWidth(chosen, viewportWidth);
}

/** The viewer's share in percent, clamped to 30–75 to a tenth; a non-number gives 50. */
export function clampSplit(value) {
  if (!Number.isFinite(value)) return SPLIT_DEFAULT;
  return Math.round(within(value, SPLIT_MIN, SPLIT_MAX) * 10) / 10;
}

export const resolveSplit = chosen => (chosen == null ? SPLIT_DEFAULT : clampSplit(chosen));

/** The outer edge is on the overlay's left, so moving the pointer left widens it. */
export const dragWidth = (startWidth, startX, x, viewportWidth) => clampWidth(startWidth + (startX - x), viewportWidth);

/** Moving the divider left grows the viewer, by the travel as a share of the overlay's width. */
export function dragSplit(startSplit, startX, x, overlayPx) {
  const width = size(overlayPx);
  return clampSplit(width ? startSplit + ((startX - x) / width) * 100 : startSplit);
}

/** A key's new value, or null for a key the handle does not take. Arrows move the handle. */
function keyStep(value, key, shift, step, min, max) {
  const delta = step * (shift ? SHIFT_FACTOR : 1);
  if (key === 'ArrowLeft') return value + delta;
  if (key === 'ArrowRight') return value - delta;
  if (key === 'Home') return min;
  if (key === 'End') return max;
  return null;
}

export function stepWidth(width, key, { shift = false, viewportWidth } = {}) {
  const { min, max } = widthBounds(viewportWidth);
  const next = keyStep(width, key, shift, WIDTH_KEY_STEP_PX, min, max);
  return next === null ? null : clampWidth(next, viewportWidth);
}

export function stepSplit(split, key, { shift = false } = {}) {
  const next = keyStep(split, key, shift, SPLIT_KEY_STEP_PCT, SPLIT_MIN, SPLIT_MAX);
  return next === null ? null : clampSplit(next);
}

/** A stored positive number, or null for nothing, junk, no storage or a storage that throws. */
function readStoredNumber(storage, key) {
  try {
    const raw = storage.getItem(key); // a missing storage throws here too
    const value = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** The stored width, re-clamped to the viewport when it is known. */
export function readStoredWidth(storage, viewportWidth) {
  const value = readStoredNumber(storage, WIDTH_STORAGE_KEY);
  if (value === null) return null;
  return size(viewportWidth) ? clampWidth(value, viewportWidth) : value;
}

export function readStoredSplit(storage) {
  const value = readStoredNumber(storage, SPLIT_STORAGE_KEY);
  return value === null ? null : clampSplit(value);
}

/** Stores a value, or removes the key for null (a reset). Never throws. */
export function writeStored(storage, key, value) {
  try {
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, String(value));
  } catch {
    // No storage, or blocked or full: the choice simply is not remembered.
  }
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
