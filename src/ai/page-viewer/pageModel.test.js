import { describe, expect, it } from 'vitest';
import { aspectOk, boxStyle, pageBoxes, partForPage, viewerState } from './pageModel.js';

// A 3-part split: pages 1-10, 11-25, 26-30 (page_offset is 0-based, pages are 1-based).
const PARTS = [
  { part_index: 1, page_offset: 10, page_count: 15, byte_size: 2000 },
  { part_index: 0, page_offset: 0, page_count: 10, byte_size: 1000 },
  { part_index: 2, page_offset: 25, page_count: 5, byte_size: 500 },
];

describe('partForPage', () => {
  it('finds the part at each boundary of a split document', () => {
    expect(partForPage(PARTS, 1).part_index).toBe(0);
    expect(partForPage(PARTS, 10).part_index).toBe(0);
    expect(partForPage(PARTS, 11).part_index).toBe(1);
    expect(partForPage(PARTS, 25).part_index).toBe(1);
    expect(partForPage(PARTS, 26).part_index).toBe(2);
    expect(partForPage(PARTS, 30).part_index).toBe(2);
  });

  it('is null past the last page, at page 0, and for a non-integer page', () => {
    expect(partForPage(PARTS, 31)).toBeNull();
    expect(partForPage(PARTS, 0)).toBeNull();
    expect(partForPage(PARTS, 2.5)).toBeNull();
  });

  it('is null for a missing or empty parts list', () => {
    expect(partForPage(null, 1)).toBeNull();
    expect(partForPage([], 1)).toBeNull();
  });

  it('covers a single-part document', () => {
    const single = [{ part_index: 0, page_offset: 0, page_count: 3, byte_size: 10 }];
    expect(partForPage(single, 3)).toBe(single[0]);
    expect(partForPage(single, 4)).toBeNull();
  });
});

describe('viewerState', () => {
  const DOC = { storage_path: 'ab/cd.pdf', indexed_at: '2026-10-01T00:00:00Z', extract_hash: 'h1', page_count: 30 };
  const CITE = { source_kind: 'pdf_page', page_number: 4, extract_hash: 'h1' };
  const ROW = { page_number: 4, text: 'x', char_from: 0, char_to: 1 };

  it('ok: live document, matching hash, page row present', () => {
    expect(viewerState({ doc: DOC, citation: CITE, pageRow: ROW })).toBe('ok');
  });

  it('gone: the document no longer exists', () => {
    expect(viewerState({ doc: null, citation: CITE, pageRow: ROW })).toBe('gone');
  });

  it('not_live: indexed_at is null', () => {
    expect(viewerState({ doc: { ...DOC, indexed_at: null }, citation: CITE, pageRow: ROW })).toBe('not_live');
  });

  it('text_only: a pdf_page citation whose document has no storage_path', () => {
    expect(viewerState({ doc: { ...DOC, storage_path: null }, citation: CITE, pageRow: ROW })).toBe('text_only');
  });

  it('stale: the citation hash differs from the document hash', () => {
    expect(viewerState({ doc: DOC, citation: { ...CITE, extract_hash: 'h0' }, pageRow: ROW })).toBe('stale');
  });

  it('stale: the citation has a hash and the document has none', () => {
    expect(viewerState({ doc: { ...DOC, extract_hash: null }, citation: CITE, pageRow: ROW })).toBe('stale');
  });

  it('unknown_freshness: the citation carries no extract_hash', () => {
    const { extract_hash: _drop, ...noHash } = CITE;
    expect(viewerState({ doc: DOC, citation: noHash, pageRow: ROW })).toBe('unknown_freshness');
  });

  it('no_page_text: no document_pages row for the page', () => {
    expect(viewerState({ doc: DOC, citation: CITE, pageRow: null })).toBe('no_page_text');
  });

  describe('precedence (gone > not_live > text_only > stale > unknown_freshness > no_page_text > ok)', () => {
    it('gone wins over everything', () => {
      expect(viewerState({ doc: null, citation: { source_kind: 'pdf_page' }, pageRow: null })).toBe('gone');
    });

    it('not_live wins over text_only, stale and a missing page', () => {
      const doc = { ...DOC, indexed_at: null, storage_path: null, extract_hash: 'other' };
      expect(viewerState({ doc, citation: CITE, pageRow: null })).toBe('not_live');
    });

    it('text_only wins over stale and a missing page', () => {
      const doc = { ...DOC, storage_path: null, extract_hash: 'other' };
      expect(viewerState({ doc, citation: CITE, pageRow: null })).toBe('text_only');
    });

    it('stale wins over a missing page', () => {
      expect(viewerState({ doc: DOC, citation: { ...CITE, extract_hash: 'h0' }, pageRow: null })).toBe('stale');
    });

    it('unknown_freshness wins over a missing page', () => {
      expect(viewerState({ doc: DOC, citation: { source_kind: 'pdf_page', page_number: 4 }, pageRow: null }))
        .toBe('unknown_freshness');
    });
  });

  it('a blank citation hash counts as no hash', () => {
    expect(viewerState({ doc: DOC, citation: { ...CITE, extract_hash: '  ' }, pageRow: ROW })).toBe('unknown_freshness');
  });

  it('text_only applies only to pdf_page citations', () => {
    const doc = { ...DOC, storage_path: null };
    expect(viewerState({ doc, citation: { ...CITE, source_kind: 'document' }, pageRow: ROW })).toBe('ok');
  });
});

describe('pageBoxes', () => {
  const box = (page, x0, y0, x1, y1) => ({ page, x0, y0, x1, y1 });

  it('keeps only the boxes on the requested page', () => {
    const boxes = [box(3, 0.1, 0.1, 0.5, 0.2), box(4, 0.1, 0.3, 0.9, 0.4), box(4, 0.1, 0.5, 0.9, 0.6)];
    expect(pageBoxes({ boxes }, 4)).toEqual([boxes[1], boxes[2]]);
    expect(pageBoxes({ boxes }, 3)).toEqual([boxes[0]]);
    expect(pageBoxes({ boxes }, 5)).toEqual([]);
  });

  it('drops zero-width and zero-height boxes', () => {
    const boxes = [box(4, 0.2, 0.2, 0.2, 0.5), box(4, 0.1, 0.4, 0.9, 0.4), box(4, 0.1, 0.1, 0.2, 0.2)];
    expect(pageBoxes({ boxes }, 4)).toEqual([boxes[2]]);
  });

  it('is empty when the citation has no boxes', () => {
    expect(pageBoxes({}, 4)).toEqual([]);
    expect(pageBoxes(null, 4)).toEqual([]);
  });
});

describe('boxStyle', () => {
  it('positions the box as CSS percentages of the page', () => {
    expect(boxStyle({ page: 1, x0: 0.1, y0: 0.25, x1: 0.6, y1: 0.5 }))
      .toEqual({ left: '10%', top: '25%', width: '50%', height: '25%' });
  });

  it('rounds floating-point noise away', () => {
    // 0.3 - 0.1 is 0.19999999999999998 in IEEE doubles.
    expect(boxStyle({ page: 1, x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 }))
      .toEqual({ left: '10%', top: '10%', width: '20%', height: '20%' });
  });

  it('keeps sub-percent precision', () => {
    expect(boxStyle({ page: 1, x0: 0.12345, y0: 0, x1: 1, y1: 1 }).left).toBe('12.345%');
  });
});

describe('aspectOk', () => {
  const ROW = { width_px: 1000, height_px: 1414 };

  it('is true when the aspects match', () => {
    expect(aspectOk(ROW, { width: 500, height: 707 })).toBe(true);
  });

  it('is true just inside the 2% tolerance', () => {
    // Viewport aspect 0.5; stored 0.509 differs by 1.8%.
    expect(aspectOk({ width_px: 509, height_px: 1000 }, { width: 500, height: 1000 })).toBe(true);
  });

  it('is false just outside the 2% tolerance', () => {
    // Stored 0.511 differs by 2.2%.
    expect(aspectOk({ width_px: 511, height_px: 1000 }, { width: 500, height: 1000 })).toBe(false);
  });

  it('is false for a page rendered rotated (portrait stored, landscape viewport)', () => {
    expect(aspectOk(ROW, { width: 1414, height: 1000 })).toBe(false);
  });

  it('is false when any dimension is missing or zero', () => {
    expect(aspectOk(null, { width: 500, height: 707 })).toBe(false);
    expect(aspectOk(ROW, null)).toBe(false);
    expect(aspectOk({ width_px: 0, height_px: 1414 }, { width: 500, height: 707 })).toBe(false);
    expect(aspectOk({ width_px: 1000, height_px: null }, { width: 500, height: 707 })).toBe(false);
    expect(aspectOk(ROW, { width: 500, height: 0 })).toBe(false);
    expect(aspectOk(ROW, { width: Number.NaN, height: 707 })).toBe(false);
  });
});
