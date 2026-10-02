/**
 * What every resizable edge shares (side-panel spec point 2): the clamp, the keyboard steps and the
 * per-browser memory. The side panel's docked width (sidePanelModel.js) and the citation overlay's
 * width and split (ai/citationOverlayModel.js) are built on these.
 */

/** Shift multiplies a key step. */
export const SHIFT_FACTOR = 4;

/** A positive finite number, or 0 for anything else (an unknown size). */
export const size = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

export const within = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * A key's new value, or null for a key the handle does not take. The handles sit on an element's
 * left edge, so ArrowLeft grows it; Home and End go to the bounds.
 */
export function keyStep(value, key, shift, step, min, max) {
  const delta = step * (shift ? SHIFT_FACTOR : 1);
  if (key === 'ArrowLeft') return value + delta;
  if (key === 'ArrowRight') return value - delta;
  if (key === 'Home') return min;
  if (key === 'End') return max;
  return null;
}

/** A stored positive number, or null for nothing, junk, no storage or a storage that throws. */
export function readStoredNumber(storage, key) {
  try {
    const raw = storage.getItem(key); // a missing storage throws here too
    const value = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
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
