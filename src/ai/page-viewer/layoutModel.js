/**
 * The continuous view's layout (docs/specs/2026-10-02-viewer-continuous.md, section 1), as pure
 * arithmetic: every page's slot from the stored page sizes before anything is drawn, the page under
 * the centre of the view, which pages to draw, and where to scroll. No DOM, no observers.
 */
import { CSS_PX_PER_PT, MAX_ZOOM } from './zoomModel.js';

/** A4's width in PDF points: the assumption for the cited page until pdf.js has measured it. */
const A4_PT = 595;

/** The gap between pages, in CSS px. */
export const PAGE_GAP = 12;
/** At most this many pages are drawn (each a canvas) at once. */
export const MAX_LIVE_PAGES = 8;

const usable = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Each page's height over its width, by page number (index 0 is page 1), from `document_pages`
 * rows; `fallback` for a page without a usable stored size.
 */
export function pageAspects(rows, count, fallback) {
  const aspects = new Array(Math.max(0, count)).fill(fallback);
  for (const row of Array.isArray(rows) ? rows : []) {
    const i = row?.page_number - 1;
    if (Number.isSafeInteger(i) && i >= 0 && i < aspects.length && usable(row.width_px) && usable(row.height_px)) {
      aspects[i] = row.height_px / row.width_px;
    }
  }
  return aspects;
}

/**
 * The pages stacked in one column: `widthOf(index)` gives each page's CSS width, its aspect its
 * height, and PAGE_GAP separates them.
 * @returns {{count: number, tops: number[], heights: number[], widths: number[], total: number}}
 */
export function slotLayout({ aspects, widthOf, gap = PAGE_GAP }) {
  const count = Array.isArray(aspects) ? aspects.length : 0;
  const tops = new Array(count);
  const heights = new Array(count);
  const widths = new Array(count);
  let y = 0;
  for (let i = 0; i < count; i += 1) {
    widths[i] = widthOf(i);
    heights[i] = widths[i] * aspects[i];
    tops[i] = y;
    y += heights[i] + (i < count - 1 ? gap : 0);
  }
  return { count, tops, heights, widths, total: count ? y : 0 };
}

/** The index of the last slot starting at or above `y` (0 when above the first). */
function slotAt(layout, y) {
  let lo = 0;
  let hi = layout.count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (layout.tops[mid] <= y) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** The page number under the centre line of the view; in a gap, the page above. */
export function currentPage(layout, scrollTop, viewport) {
  if (!layout.count) return 1;
  return slotAt(layout, scrollTop + viewport / 2) + 1;
}

/**
 * The page numbers to draw: every page that meets the view widened by `overscan` above and below,
 * nearest the view's centre first (on a tie, the page below, which the reader is heading to), at
 * most `max`.
 */
export function renderWindow(layout, scrollTop, viewport, { overscan = viewport, max = MAX_LIVE_PAGES } = {}) {
  if (!layout.count) return [];
  const from = scrollTop - overscan;
  const to = scrollTop + viewport + overscan;
  const centre = scrollTop + viewport / 2;
  const pages = [];
  for (let i = slotAt(layout, Math.max(0, from)); i < layout.count && layout.tops[i] < to; i += 1) {
    if (layout.tops[i] + layout.heights[i] > from) pages.push(i);
  }
  const distance = i => Math.abs(layout.tops[i] + layout.heights[i] / 2 - centre);
  return pages
    .sort((a, b) => distance(a) - distance(b) || b - a)
    .slice(0, max)
    .map(i => i + 1);
}

/**
 * Where to scroll: a page's top at the top of the view, or, with `box` (page fractions), the box's
 * centre at the centre of the area above `insetBottom` (the full view's pill). Kept within the
 * scroll range, which the inset extends: the page area carries it as bottom padding, so the last
 * page's foot can scroll clear of the pill.
 */
export function scrollTopFor(layout, { page, box = null, viewport, insetBottom = 0 }) {
  if (!layout.count) return 0;
  const i = Math.min(Math.max(1, Math.trunc(page) || 1), layout.count) - 1;
  const y = box
    ? layout.tops[i] + ((box.y0 + box.y1) / 2) * layout.heights[i] - (viewport - insetBottom) / 2
    : layout.tops[i];
  return Math.min(Math.max(0, y), Math.max(0, layout.total + insetBottom - viewport));
}

/**
 * Each page's width in PDF points before pdf.js has opened it: the stored pixel widths, scaled by
 * the cited page's width in points (`citedPt`, once measured; A4 until then). A page without a
 * stored width is taken to be as wide as the cited page.
 */
export function naturalWidths(rows, count, { cited, citedPt }) {
  const px = new Array(Math.max(0, count)).fill(null);
  for (const row of Array.isArray(rows) ? rows : []) {
    const i = row?.page_number - 1;
    if (Number.isSafeInteger(i) && i >= 0 && i < px.length && usable(row.width_px)) px[i] = row.width_px;
  }
  const anchorPt = usable(citedPt) ? citedPt : A4_PT;
  const anchorPx = px[cited - 1];
  return px.map(w => (w !== null && anchorPx !== null && anchorPx !== undefined ? (anchorPt * w) / anchorPx : anchorPt));
}

/**
 * One page's CSS width under the zoom state `{fit, zoom}`, in a pane `{width, height}`, for a page
 * `{aspect, naturalPt}`. Fit text uses the cited page's text column (`column`, page fractions) and
 * width (`citedPt`): every page is drawn at the scale that makes that column fill the pane. Never
 * above 300% of the page's natural size.
 */
export function pageWidth(state, pane, { aspect, naturalPt }, { column = null, citedPt = naturalPt } = {}) {
  const cap = MAX_ZOOM * CSS_PX_PER_PT * naturalPt;
  let width;
  if (typeof state?.zoom === 'number' && Number.isFinite(state.zoom)) width = state.zoom * CSS_PX_PER_PT * naturalPt;
  else if (state?.fit === 'page' && usable(pane.height)) width = Math.min(pane.width, pane.height / aspect);
  else if (state?.fit === 'text' && column && column.x1 > column.x0) width = (pane.width / (column.x1 - column.x0)) * (naturalPt / citedPt);
  else width = pane.width;
  return Math.min(width, cap);
}

/** The page (index) and fraction of its height at `offset` px down a view scrolled to `scrollTop`. */
export function anchorAt(layout, scrollTop, offset) {
  if (!layout.count) return { index: 0, fraction: 0 };
  const y = scrollTop + offset;
  const index = slotAt(layout, y);
  const fraction = Math.min(1, Math.max(0, (y - layout.tops[index]) / layout.heights[index]));
  return { index, fraction: Math.round(fraction * 1e6) / 1e6 };
}

/** The scroll position that puts an anchor (from `anchorAt`) back `offset` px down the view. */
export function scrollForAnchor(layout, { index, fraction }, offset) {
  if (!layout.count) return 0;
  const i = Math.min(Math.max(0, index), layout.count - 1);
  return Math.max(0, layout.tops[i] + fraction * layout.heights[i] - offset);
}
