/**
 * The citation overlay's pure rules (docs/specs/2026-10-01-rag-v2-citations-pdf.md, decision 7 and
 * Design > Layout, and revision 4 point 1). CitationOverlay.jsx applies them; citation-overlay.css
 * states the default width in CSS, `min(100vw, max(50vw, 960px))`, as the fallback for the
 * --cov-width that CitationOverlay sets from these rules. The clamp, key steps and storage are the
 * side panel's too (shell/resizeModel.js).
 */
import { SHIFT_FACTOR, keyStep, readStoredNumber, size, within, writeStored } from '../shell/resizeModel.js';

export { SHIFT_FACTOR, writeStored };

/** The app's breakpoint at which the dock stacks under the desk (index.css, `max-width: 900px`). */
export const NARROW_QUERY = '(max-width: 900px)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** The owner-confirmed minimum: each half at least 480 px where the screen allows. */
export const OVERLAY_MIN_PX = 960;


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

export function stepWidth(width, key, { shift = false, viewportWidth } = {}) {
  const { min, max } = widthBounds(viewportWidth);
  const next = keyStep(width, key, shift, WIDTH_KEY_STEP_PX, min, max);
  return next === null ? null : clampWidth(next, viewportWidth);
}

export function stepSplit(split, key, { shift = false } = {}) {
  const next = keyStep(split, key, shift, SPLIT_KEY_STEP_PCT, SPLIT_MIN, SPLIT_MAX);
  return next === null ? null : clampSplit(next);
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

/* Revision 5, point 1: click outside. While a citation is open in the overlay (desktop only), a
   completed click outside the chat and the viewer closes both the citation and the chat. */

/** Marks an element portalled out of the overlay by the chat or the viewer (a menu, a picker). */
export const KEEP_ATTRIBUTE = 'data-cov-keep';
/**
 * The page viewer's full-view root, backdrop included (src/ai/page-viewer/viewerDom.js,
 * VIEWER_ATTRIBUTE). Its backdrop click closes only the full view and does not stop propagation,
 * so this marker is what keeps that click from also closing the overlay. Spelled out rather than
 * imported, so the overlay does not pull the page viewer's lazy chunk into the main bundle.
 */
export const CITATION_VIEWER_ATTRIBUTE = 'data-citation-viewer';
/** An open modal (the page viewer's full view, the upgrade dialog) owns every click, backdrop included. */
const MODAL_SELECTOR = '[aria-modal="true"]';
const KEEP_SELECTOR = `[${KEEP_ATTRIBUTE}], [${CITATION_VIEWER_ATTRIBUTE}], ${MODAL_SELECTOR}`;

/**
 * Whether one event target lies outside the keep zone: the overlay root (chat, viewer, handles),
 * anything under a [data-cov-keep] or [data-citation-viewer] mark, or inside a modal dialog. While
 * a modal is open nothing is outside, so a click on its backdrop closes only the modal. A target
 * that cannot be judged (missing, removed from the page by the press itself, not an element) is
 * never outside: when in doubt, close nothing.
 */
export function isOutsideTarget(target, { keepZones = [], modalOpen = false } = {}) {
  if (modalOpen || !target || target.isConnected !== true || typeof target.closest !== 'function') return false;
  if (keepZones.some(zone => zone && typeof zone.contains === 'function' && zone.contains(target))) return false;
  return !target.closest(KEEP_SELECTOR);
}

/**
 * A completed click outside: the pointerdown, the pointerup and the click all land outside the
 * keep zone. A drag into the chat, a resize drag released outside (it starts on a handle) and a
 * click with no pointerdown (keyboard activation) all close nothing.
 */
export function isOutsideClick({ downTarget, upTarget, clickTarget, keepZones = [], modalOpen = false }) {
  const ctx = { keepZones, modalOpen };
  return [downTarget, upTarget, clickTarget].every(target => isOutsideTarget(target, ctx));
}

/** The listener runs only with a citation open, on a desktop, and with something to call. */
export function outsideCloseActive({ open, narrow, onOutside }) {
  return Boolean(open) && !narrow && typeof onOutside === 'function';
}

/**
 * Listens on `doc` in the capture phase, so a handler that stops propagation cannot hide a click.
 * The pointerdown and the pointerup are judged when they happen (against the zones and any modal
 * as they are then), and the click calls `onOutside` only when both were outside and it is too.
 * Only the main button counts. Returns the detach function; with no document it attaches nothing.
 */
export function attachOutsideClose(doc, { zones, onOutside }) {
  if (!doc || typeof doc.addEventListener !== 'function') return () => {};
  let down = false;
  let up = false;
  const judge = (target) => {
    const modalOpen = Boolean(doc.querySelector?.(MODAL_SELECTOR));
    return isOutsideTarget(target, { keepZones: zones(), modalOpen });
  };
  const onPointerDown = (e) => {
    down = !e.button && judge(e.target);
    up = false;
  };
  const onPointerUp = (e) => {
    up = down && !e.button && judge(e.target);
  };
  const onClick = (e) => {
    const outside = down && up && !e.button && judge(e.target);
    down = false;
    up = false;
    if (outside) onOutside();
  };
  const options = { capture: true };
  doc.addEventListener('pointerdown', onPointerDown, options);
  doc.addEventListener('pointerup', onPointerUp, options);
  doc.addEventListener('click', onClick, options);
  return () => {
    doc.removeEventListener('pointerdown', onPointerDown, options);
    doc.removeEventListener('pointerup', onPointerUp, options);
    doc.removeEventListener('click', onClick, options);
  };
}
