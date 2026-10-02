import { describe, expect, it } from 'vitest';
import {
  MAX_LIVE_PAGES, PAGE_GAP, anchorAt, currentPage, naturalWidths, scrollForAnchor, pageAspects, pageWidth, renderWindow, scrollTopFor, slotLayout,
} from './layoutModel.js';
import { CSS_PX_PER_PT } from './zoomModel.js';

/** Three pages: two A4 portraits and one landscape. */
const aspects = [842 / 595, 842 / 595, 595 / 842];

describe('pageAspects', () => {
  it('reads each page\'s height over width from the stored page sizes, by page number', () => {
    const rows = [{ page_number: 2, width_px: 1000, height_px: 500 }, { page_number: 1, width_px: 720, height_px: 1018 }];
    expect(pageAspects(rows, 3, 1.5)).toEqual([1018 / 720, 0.5, 1.5]);
  });

  it('falls back to the given aspect for a page without a usable size', () => {
    expect(pageAspects([{ page_number: 1, width_px: 0, height_px: 10 }, { page_number: 2, width_px: null, height_px: null }], 2, 1.4)).toEqual([1.4, 1.4]);
    expect(pageAspects(undefined, 2, 1.4)).toEqual([1.4, 1.4]);
  });
});

describe('slotLayout', () => {
  it('stacks the pages at their widths with a gap, and knows the total height', () => {
    const layout = slotLayout({ aspects, widthOf: () => 400 });
    expect(layout.count).toBe(3);
    expect(layout.widths).toEqual([400, 400, 400]);
    expect(layout.heights[0]).toBeCloseTo(400 * 842 / 595, 6);
    expect(layout.tops[0]).toBe(0);
    expect(layout.tops[1]).toBeCloseTo(layout.heights[0] + PAGE_GAP, 6);
    expect(layout.tops[2]).toBeCloseTo(layout.tops[1] + layout.heights[1] + PAGE_GAP, 6);
    expect(layout.total).toBeCloseTo(layout.tops[2] + layout.heights[2], 6);
  });

  it('takes a width per page, for Fit page and differing page sizes', () => {
    const layout = slotLayout({ aspects, widthOf: i => (i === 2 ? 600 : 300) });
    expect(layout.widths).toEqual([300, 300, 600]);
    expect(layout.heights[2]).toBeCloseTo(600 * 595 / 842, 6);
  });

  it('is empty for no pages', () => {
    expect(slotLayout({ aspects: [], widthOf: () => 400 })).toMatchObject({ count: 0, total: 0 });
  });
});

describe('currentPage', () => {
  const layout = slotLayout({ aspects: [1, 1, 1, 1], widthOf: () => 100 });
  // Slots: 0-100, 112-212, 224-324, 336-436.

  it('is the page under the centre line of the view, as a page number', () => {
    expect(currentPage(layout, 0, 100)).toBe(1);
    expect(currentPage(layout, 120, 100)).toBe(2);
    expect(currentPage(layout, 300, 100)).toBe(4);
  });

  it('counts a centre line in a gap as the page above', () => {
    expect(currentPage(layout, 55, 100)).toBe(1);
  });

  it('stays within the document', () => {
    expect(currentPage(layout, -50, 100)).toBe(1);
    expect(currentPage(layout, 10_000, 100)).toBe(4);
    expect(currentPage(slotLayout({ aspects: [], widthOf: () => 1 }), 0, 100)).toBe(1);
  });
});

describe('renderWindow', () => {
  const layout = slotLayout({ aspects: Array(20).fill(1), widthOf: () => 100 });

  it('draws the visible pages first, nearest the centre first, then a screen above and below', () => {
    // View 336-436 shows page 4 (336-436) whole; a screen either way reaches pages 3 and 5.
    expect(renderWindow(layout, 336, 100)).toEqual([4, 5, 3]);
  });

  it('includes pages partly in view', () => {
    const pages = renderWindow(layout, 380, 100, { overscan: 0 });
    expect(pages).toEqual([4, 5]);
  });

  it('never asks for more than the canvas cap', () => {
    const tall = slotLayout({ aspects: Array(50).fill(0.1), widthOf: () => 100 });
    expect(renderWindow(tall, 0, 2000).length).toBe(MAX_LIVE_PAGES);
  });

  it('is empty for no pages', () => {
    expect(renderWindow(slotLayout({ aspects: [], widthOf: () => 1 }), 0, 100)).toEqual([]);
  });
});

describe('scrollTopFor', () => {
  const layout = slotLayout({ aspects: [1, 1, 1], widthOf: () => 100 });

  it('puts a page\'s top at the top of the view', () => {
    expect(scrollTopFor(layout, { page: 2, viewport: 50 })).toBe(112);
  });

  it('centres a box on its page in the area above a bottom inset', () => {
    // Box centre at 50% of page 3 (224 + 50 = 274); a 100 px view with a 20 px inset centres at 40.
    expect(scrollTopFor(layout, { page: 3, box: { y0: 0.4, y1: 0.6 }, viewport: 100, insetBottom: 20 })).toBe(234);
  });

  it('never scrolls above the top or past the end', () => {
    expect(scrollTopFor(layout, { page: 1, box: { y0: 0, y1: 0.1 }, viewport: 100 })).toBe(0);
    expect(scrollTopFor(layout, { page: 3, box: { y0: 0.9, y1: 1 }, viewport: 100 })).toBe(layout.total - 100);
  });

  it('clamps an out-of-range page', () => {
    expect(scrollTopFor(layout, { page: 9, viewport: 50 })).toBe(224);
    expect(scrollTopFor(layout, { page: 0, viewport: 50 })).toBe(0);
  });
});

describe('naturalWidths: each page\'s width in PDF points before pdf.js has opened it', () => {
  const rows = [{ page_number: 1, width_px: 720 }, { page_number: 2, width_px: 1018 }, { page_number: 3, width_px: null }];

  it('scales the stored pixel widths by the cited page\'s measured width once it is known', () => {
    expect(naturalWidths(rows, 3, { cited: 1, citedPt: 595 })).toEqual([595, 595 * 1018 / 720, 595]);
  });

  it('before the cited page is measured, assumes an A4 width for it', () => {
    expect(naturalWidths(rows, 3, { cited: 2, citedPt: null })).toEqual([595 * 720 / 1018, 595, 595]);
  });

  it('without stored widths, every page is the cited page\'s width', () => {
    expect(naturalWidths([], 2, { cited: 1, citedPt: 612 })).toEqual([612, 612]);
  });
});

describe('pageWidth: one page\'s CSS width under the zoom state', () => {
  const pane = { width: 480, height: 600 };
  const a4 = { aspect: 842 / 595, naturalPt: 595 };

  it('Fit width fills the pane', () => {
    expect(pageWidth({ fit: 'width', zoom: null }, pane, a4)).toBe(480);
  });

  it('Fit page fits the pane\'s height too, and falls back to the width when the height is unknown', () => {
    expect(pageWidth({ fit: 'page', zoom: null }, pane, a4)).toBeCloseTo(600 / (842 / 595), 6);
    expect(pageWidth({ fit: 'page', zoom: null }, { width: 480, height: 0 }, a4)).toBe(480);
  });

  it('Fit text scales so the cited page\'s text column fills the pane, and other pages by their natural width', () => {
    const column = { x0: 0.2, x1: 0.8 };
    expect(pageWidth({ fit: 'text', zoom: null }, pane, a4, { column, citedPt: 595 })).toBeCloseTo(800, 6);
    expect(pageWidth({ fit: 'text', zoom: null }, pane, { aspect: 0.7, naturalPt: 842 }, { column, citedPt: 595 })).toBeCloseTo(800 * 842 / 595, 6);
    expect(pageWidth({ fit: 'text', zoom: null }, pane, a4, { column: null, citedPt: 595 })).toBe(480);
  });

  it('a manual zoom is that share of the natural size at 96 px per inch', () => {
    expect(pageWidth({ fit: 'width', zoom: 1.5 }, pane, a4)).toBeCloseTo(1.5 * CSS_PX_PER_PT * 595, 6);
  });

  it('never exceeds 300% of the natural size', () => {
    const column = { x0: 0.5, x1: 0.52 };
    expect(pageWidth({ fit: 'text', zoom: null }, { width: 1600, height: 900 }, a4, { column, citedPt: 595 })).toBeCloseTo(3 * CSS_PX_PER_PT * 595, 6);
  });
});

describe('zoom anchors: the point under the pointer stays put when the layout changes', () => {
  const before = slotLayout({ aspects: [1, 1, 1], widthOf: () => 100 });
  const after = slotLayout({ aspects: [1, 1, 1], widthOf: () => 200 });

  it('finds the page and the fraction of it at a point of the view', () => {
    // Scrolled to 150, a pointer 40 px down the view is at y 190: page 2 (112-212), 78% down.
    expect(anchorAt(before, 150, 40)).toEqual({ index: 1, fraction: 0.78 });
  });

  it('scrolls so the same point of the same page is under the pointer again', () => {
    // After: page 2 spans 212-412; 78% down is 368; under a pointer 40 px down the view → 328.
    expect(scrollForAnchor(after, { index: 1, fraction: 0.78 }, 40)).toBeCloseTo(328, 6);
  });

  it('keeps a point in a gap with the page above, and never scrolls above the top', () => {
    expect(anchorAt(before, 0, 105)).toEqual({ index: 0, fraction: 1 });
    expect(scrollForAnchor(after, { index: 0, fraction: 0 }, 300)).toBe(0);
  });
});
