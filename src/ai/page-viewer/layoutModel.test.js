import { describe, expect, it } from 'vitest';
import {
  MAX_LIVE_PAGES, PAGE_GAP, currentPage, pageAspects, renderWindow, scrollTopFor, slotLayout,
} from './layoutModel.js';

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
