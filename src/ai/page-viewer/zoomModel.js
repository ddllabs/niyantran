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
 * fit decides the scale, or a manual zoom. A manual zoom keeps its fit's crop, so stepping in
 * from Fit text still hides the blank margins.
 */

export const CSS_PX_PER_PT = 96 / 72;
export const ZOOM_STEPS = Object.freeze([0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3]);
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
export const FITS = Object.freeze(['text', 'width', 'page']);
export const DEFAULT_ZOOM = Object.freeze({ fit: 'text', zoom: null });
/** localStorage key for the chosen fit or zoom. */
export const ZOOM_KEY = 'niyantranCitationZoom';

/** Padding around the body text, as a fraction of the page on each side. */
const PADDING = 0.02;
/** Blocks that are not body text: running heads and feet. Margin notes (`aside_text`) stay. */
const NOT_BODY = new Set(['header', 'footer']);
const FULL = Object.freeze({ x0: 0, y0: 0, x1: 1, y1: 1 });
const STEP_EPSILON = 0.005;

const isFraction = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const isBox = b => Boolean(b) && [b.x0, b.y0, b.x1, b.y1].every(isFraction) && b.x1 > b.x0 && b.y1 > b.y0;
const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);
const isPositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * The page's text area: the union of its body blocks (and of `extra` boxes, the citation's own,
 * so a highlight is never cropped away), padded by 2% and clamped to the page. Null when no
 * block has a usable box.
 */
export function contentBox(blocks, extra = []) {
  const boxes = [
    ...(Array.isArray(blocks) ? blocks : []).filter(b => b && !NOT_BODY.has(b.type)),
    ...(Array.isArray(extra) ? extra : []),
  ].filter(isBox);
  if (!boxes.length) return null;
  return {
    x0: clamp(Math.min(...boxes.map(b => b.x0)) - PADDING, 0, 1),
    y0: clamp(Math.min(...boxes.map(b => b.y0)) - PADDING, 0, 1),
    x1: clamp(Math.max(...boxes.map(b => b.x1)) + PADDING, 0, 1),
    y1: clamp(Math.max(...boxes.map(b => b.y1)) + PADDING, 0, 1),
  };
}

/**
 * How the page is drawn in a pane.
 *
 * @param {{
 *   state: {fit: string, zoom: number | null},
 *   page: {width: number, height: number} | null,   pdf.js viewport size at scale 1
 *   pane: {width: number, height: number},          CSS px; height 0 when unknown
 *   blocks?: object[], boxes?: object[],              the page's blocks; the citation's boxes on it
 * }} input
 * @returns {null | {
 *   fit: 'text' | 'width' | 'page' | null,  the fit in effect (null for a manual zoom)
 *   scale: number, zoom: number, percent: number,
 *   crop: {x0, y0, x1, y1},
 *   pageCss: {width, height}, cropCss: {width, height}, offset: {left, top},
 * }} The whole page is rendered at `scale` (`pageCss`), placed at `offset` inside a clip of
 *   `cropCss`, so the text layer and highlight boxes keep page coordinates.
 */
export function layoutPage({ state, page, pane, blocks = [], boxes = [] }) {
  if (!page || !isPositive(page.width) || !isPositive(page.height) || !isPositive(pane?.width)) return null;
  const fit = FITS.includes(state?.fit) ? state.fit : DEFAULT_ZOOM.fit;
  const manual = typeof state?.zoom === 'number' && Number.isFinite(state.zoom) ? clamp(state.zoom, MIN_ZOOM, MAX_ZOOM) : null;
  const text = fit === 'text' ? contentBox(blocks, boxes) : null;
  const crop = text ?? FULL;
  const maxScale = MAX_ZOOM * CSS_PX_PER_PT;

  let scale;
  let effective;
  if (manual !== null) {
    scale = manual * CSS_PX_PER_PT;
    effective = null;
  } else if (text) {
    scale = Math.min(pane.width / ((crop.x1 - crop.x0) * page.width), maxScale);
    effective = 'text';
  } else if (fit === 'page' && isPositive(pane.height)) {
    scale = Math.min(pane.width / page.width, pane.height / page.height, maxScale);
    effective = 'page';
  } else {
    scale = Math.min(pane.width / page.width, maxScale);
    effective = fit === 'page' ? 'page' : 'width';
  }

  const pageCss = { width: page.width * scale, height: page.height * scale };
  const zoom = scale / CSS_PX_PER_PT;
  return {
    fit: effective,
    scale,
    zoom,
    percent: Math.round(zoom * 100),
    crop,
    pageCss,
    cropCss: { width: (crop.x1 - crop.x0) * pageCss.width, height: (crop.y1 - crop.y0) * pageCss.height },
    offset: { left: -crop.x0 * pageCss.width, top: -crop.y0 * pageCss.height },
  };
}

/** A page-fraction box in CSS px relative to the crop's top-left corner. */
export function boxRect(box, layout) {
  const { pageCss, offset } = layout;
  return {
    left: offset.left + box.x0 * pageCss.width,
    top: offset.top + box.y0 * pageCss.height,
    width: (box.x1 - box.x0) * pageCss.width,
    height: (box.y1 - box.y0) * pageCss.height,
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

/** The remembered fit or zoom, or Fit text. Never throws: storage can be blocked or absent. */
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
