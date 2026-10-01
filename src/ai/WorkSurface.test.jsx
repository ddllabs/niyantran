import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WorkSurface, { resolveViewer } from './WorkSurface.jsx';

// The real viewer loads data in effects; this stand-in shows exactly what WorkSurface hands it.
vi.mock('./page-viewer/PageViewer.jsx', () => ({
  default: ({ citation }) => <div className="viewer-probe" data-citation={JSON.stringify(citation)} />,
}));

const PDF_PAGE = {
  id: 3, kind: 'text', chunk_id: 'c3', document_id: 'd3', title: 'The Anti-Doping Bill, 2025',
  char_from: 100, char_to: 180, text_hash: 'h3', source_kind: 'pdf_page', page_number: 4, extract_hash: 'x1',
  boxes: [
    { page: 4, x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.3 },
    { page: 4, x0: 0.1, y0: 0.2, x1: 1.4, y1: 0.3 },
    { page: 4, x0: 0.5, y0: 0.2, x1: 0.1, y1: 0.3, extra: '<script>' },
  ],
  section: { heading: 'Chapter II', note: 42, evil: '<img>' },
};
const LEGACY = {
  id: 1, kind: 'text', chunk_id: 'c1', document_id: 'd1', title: 'The Delimitation Bill, 2026',
  char_from: 0, char_to: 40, text_hash: 'h', source_kind: 'document',
};
const ROW = {
  id: 2, kind: 'row', tier: 'national', feature: 'Bill Passage Probability Index', row_key: 'k', title: 'THE DELIMITATION BILL, 2026.',
  row_snapshot: { bill_name: 'THE DELIMITATION BILL, 2026.' }, snapshot_at: '2026-09-07T18:02:04.432Z',
};

const settle = () => new Promise(r => setTimeout(r, 0));

describe('resolveViewer: the single sanitising point', () => {
  it('sanitises the open source: a box past the page edge or inverted is dropped, the section cleaned', () => {
    const { source, reader } = resolveViewer({ kind: 'text', source: PDF_PAGE }, []);
    expect(reader).toBe('page');
    expect(source.boxes).toEqual([{ page: 4, x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.3 }]);
    expect(source.section).toEqual({ heading: 'Chapter II' });
  });

  it('sanitises every entry of the source list the reader can open from', () => {
    const { sources } = resolveViewer({ kind: 'list' }, [PDF_PAGE, LEGACY, { kind: 'text', title: 'BAD' }]);
    expect(sources).toHaveLength(2);
    expect(sources[0].boxes).toHaveLength(1);
    expect(sources[0].section).toEqual({ heading: 'Chapter II' });
  });

  it('routes legacy text to the reader, rows to the record, and refuses an unreadable source', () => {
    expect(resolveViewer({ kind: 'text', source: LEGACY }, []).reader).toBe('text');
    expect(resolveViewer({ kind: 'row', source: ROW }, []).reader).toBe('row');
    const noPage = resolveViewer({ kind: 'text', source: { ...PDF_PAGE, page_number: undefined } }, []);
    expect(noPage).toMatchObject({ invalid: true, source: null, reader: null });
    expect(resolveViewer({ kind: 'list' }, []).reader).toBeNull();
  });
});

describe('WorkSurface branching', () => {
  it('opens a pdf_page citation in the lazy page viewer, which suspends behind a placeholder first', async () => {
    const first = renderToStaticMarkup(<WorkSurface viewer={{ kind: 'text', source: PDF_PAGE }} />);
    expect(first).toContain('Loading the page viewer…');
    expect(first).not.toContain('aria-label="Cited source"');
    expect(first).toContain('Ask about this document');

    await settle();
    const loaded = renderToStaticMarkup(<WorkSurface viewer={{ kind: 'text', source: PDF_PAGE }} />);
    const probe = /data-citation="([^"]*)"/.exec(loaded);
    expect(probe).not.toBeNull();
    const handed = JSON.parse(probe[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    expect(handed.boxes).toEqual([{ page: 4, x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.3 }]);
    expect(handed.section).toEqual({ heading: 'Chapter II' });
    expect(handed.page_number).toBe(4);
  });

  it('keeps legacy text citations on SourceReader, unchanged', () => {
    const html = renderToStaticMarkup(<WorkSurface viewer={{ kind: 'text', source: LEGACY }} />);
    expect(html).toContain('aria-label="Cited source"');
    expect(html).not.toContain('Loading the page viewer');
    expect(html).not.toContain('viewer-probe');
  });

  it('keeps row citations on RowSource', () => {
    const html = renderToStaticMarkup(<WorkSurface viewer={{ kind: 'row', source: ROW }} />);
    expect(html).toContain('as captured on 2026-09-07');
    expect(html).not.toContain('viewer-probe');
  });
});
