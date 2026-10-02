/**
 * Fit modes and zoom for the PDF view (docs/specs/2026-10-01-rag-v2-citations-pdf.md, amendment
 * revision 4, point 2). Pure functions: data in, data out, no React and no pdf.js.
 *
 * Units:
 * - page sizes are pdf.js viewport sizes at scale 1, in PDF points (1 pt = 1/72 in);
 * - `scale` is the pdf.js viewport scale, CSS px per point;
 * - a zoom (and the readout) is relative to the natural size at 96 CSS px per inch, so
 *   zoom 1 = 100% = scale 96/72;
 * - block and citation boxes are fractions of the page (0..1, top-left origin).
 *
 * The zoom state is `{fit, zoom}`: `fit` is 'text', 'width' or 'page'; `zoom` is null while the
 * fit decides the scale, or a manual zoom. A manual zoom keeps its fit's crop.
 *
 * The page is always whole (docs/specs/2026-10-02-viewer-whole-page.md): Fit width is the default,
 * and Fit text only scales to the text column. It never crops the page's height, and its column
 * counts every block, headers and footers too, so only blank side margins can fall outside the
 * pane, where they scroll. Cropping to the body once hid a bill's "As introduced in Lok Sabha"
 * and the top two thirds of its first page.
 */

export const CSS_PX_PER_PT = 96 / 72;
export const ZOOM_STEPS = Object.freeze([0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3]);
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
export const FITS = Object.freeze(['text', 'width', 'page']);
export const DEFAULT_ZOOM = Object.freeze({ fit: 'width', zoom: null });
/**
 * localStorage key for the chosen fit or zoom. V2: every viewer used to save Fit text on mount,
 * chosen or not, so the old key is left behind and everyone starts once from Fit width.
 */
export const ZOOM_KEY = 'niyantranCitationZoomV2';

/** Padding beside the text column, as a fraction of the page on each side. */
const PADDING = 0.02;
const STEP_EPSILON = 0.005;

const isFraction = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const isBox = b => Boolean(b) && [b.x0, b.y0, b.x1, b.y1].every(isFraction) && b.x1 > b.x0 && b.y1 > b.y0;
const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);
const isPositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * The page's text column: from the leftmost to the rightmost edge of all its blocks, headers,
 * footers and margin notes included, and of `extra` boxes (the citation's own, so a highlight is
 * never outside it), padded by 2% and clamped to the page, over the page's full height. Null when
 * no block has a usable box.
 */
export function textColumn(blocks, extra = []) {
  const boxes = [...(Array.isArray(blocks) ? blocks : []), ...(Array.isArray(extra) ? extra : [])].filter(isBox);
  if (!boxes.length) return null;
  return {
    x0: clamp(Math.min(...boxes.map(b => b.x0)) - PADDING, 0, 1),
    y0: 0,
    x1: clamp(Math.max(...boxes.map(b => b.x1)) + PADDING, 0, 1),
    y1: 1,
  };
}

/** The next zoom step above (`direction` 1) or below (-1) the effective zoom, or null at the end. */
export function nextZoomStep(current, direction) {
  if (!isPositive(current)) return null;
  if (direction > 0) return ZOOM_STEPS.find(step => step > current + STEP_EPSILON) ?? null;
  return [...ZOOM_STEPS].reverse().find(step => step < current - STEP_EPSILON) ?? null;
}

/** The % readout of an effective zoom. */
export function zoomReadout(zoom) {
  return isPositive(zoom) ? `${Math.round(zoom * 100)}%` : '—';
}

/** `zoom` multiplied by `factor`, kept within 50-300%. */
export function zoomBy(zoom, factor) {
  return clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
}

/** Pixels per line for a wheel event in line mode. */
const LINE_PX = 16;
const WHEEL_LIMIT_PX = 25;
const WHEEL_RATE = 0.01;

/**
 * The zoom factor of a ⌘/Ctrl + wheel event (trackpad pinch arrives as ctrl + wheel), or null for
 * a plain wheel, which scrolls. One event moves at most about 28%, however large its delta.
 */
export function wheelZoomFactor(event) {
  if (!event || !(event.ctrlKey || event.metaKey)) return null;
  const delta = (Number(event.deltaY) || 0) * (event.deltaMode === 1 ? LINE_PX : 1);
  if (!delta) return null;
  return Math.exp(-clamp(delta, -WHEEL_LIMIT_PX, WHEEL_LIMIT_PX) * WHEEL_RATE);
}

const defaultStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/** The remembered fit or zoom, or Fit width. Never throws: storage can be blocked or absent. */
export function readZoomState(storage = defaultStorage()) {
  try {
    const parsed = JSON.parse(storage?.getItem(ZOOM_KEY) ?? 'null');
    if (!parsed || !FITS.includes(parsed.fit)) return DEFAULT_ZOOM;
    if (parsed.zoom === null || parsed.zoom === undefined) return { fit: parsed.fit, zoom: null };
    if (typeof parsed.zoom === 'number' && parsed.zoom >= MIN_ZOOM && parsed.zoom <= MAX_ZOOM) return { fit: parsed.fit, zoom: parsed.zoom };
    return DEFAULT_ZOOM;
  } catch {
    return DEFAULT_ZOOM;
  }
}

/** Remember the fit or zoom. A storage failure only means it is not remembered. */
export function writeZoomState(state, storage = defaultStorage()) {
  try {
    storage?.setItem(ZOOM_KEY, JSON.stringify({ fit: state.fit, zoom: state.zoom ?? null }));
  } catch {
    // Private mode, quota or a blocked origin: the choice lasts for this viewer only.
  }
}
