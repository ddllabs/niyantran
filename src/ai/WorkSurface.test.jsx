import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WorkSurface, { AskAboutDocument, currentDocumentState, resolveViewer } from './WorkSurface.jsx';

const handedProps = vi.hoisted(() => []);
// The real viewer loads data in effects; this stand-in shows exactly what WorkSurface hands it.
vi.mock('./page-viewer/PageViewer.jsx', () => ({
  default: (props) => {
    handedProps.push(props);
    return <div className="viewer-probe" data-citation={JSON.stringify(props.citation)} />;
  },
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
    const viewer = { kind: 'text', source: PDF_PAGE };
    const loaded = renderToStaticMarkup(<WorkSurface viewer={viewer} />);
    expect(handedProps.at(-1).revealRequest).toBe(viewer);
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

// Revision 5 point 2: "← Back" and the close control ("Close citation") close the citation only.
describe('WorkSurface closing controls', () => {
  const closeTag = html => html.match(/<button[^>]*aria-label="Close citation"[^>]*>[^<]*<\/button>/g) || [];

  it('has "← Back" and one visible ✕ named and titled "Close citation", for every reader', () => {
    for (const viewer of [{ kind: 'text', source: LEGACY }, { kind: 'row', source: ROW }, { kind: 'list' }]) {
      const html = renderToStaticMarkup(<WorkSurface viewer={viewer} onClose={() => {}} />);
      expect(html).toContain('← Back');
      expect(html).toContain('aria-label="Back to the answer"');
      const tags = closeTag(html);
      expect(tags).toHaveLength(1);
      expect(tags[0]).toContain('title="Close citation"');
      expect(tags[0]).toContain('>✕</button>');
    }
  });

  it('the text reader no longer draws a second close control of its own', () => {
    const html = renderToStaticMarkup(<WorkSurface viewer={{ kind: 'text', source: LEGACY }} onClose={() => {}} />);
    expect(html).not.toContain('Close reader');
  });

  it('the page viewer gets onDocumentState and no close control of its own', async () => {
    renderToStaticMarkup(<WorkSurface viewer={{ kind: 'text', source: PDF_PAGE }} onClose={() => {}} />);
    await settle();
    handedProps.length = 0;
    renderToStaticMarkup(<WorkSurface viewer={{ kind: 'text', source: PDF_PAGE }} onClose={() => {}} />);
    expect(handedProps).toHaveLength(1);
    expect(typeof handedProps[0].onDocumentState).toBe('function');
    expect(handedProps[0].onClose).toBeUndefined();
  });
});

// Revision 5 point 4 (F45): Ask is disabled, with the reason as its tooltip, for a gone or not-live document.
describe('AskAboutDocument and the document state', () => {
  const ask = (props) => renderToStaticMarkup(<AskAboutDocument citation={LEGACY} locked={false} onAsk={() => {}} {...props} />);
  const disabled = html => /<button[^>]*disabled=""/.test(html);
  const title = html => /title="([^"]*)"/.exec(html)?.[1];

  it('is disabled with "no longer available" when the document is gone', () => {
    const html = ask({ documentState: 'gone' });
    expect(disabled(html)).toBe(true);
    expect(title(html)).toBe('This document is no longer available');
  });

  it('is disabled with "still processing" when the document is not live', () => {
    const html = ask({ documentState: 'not_live' });
    expect(disabled(html)).toBe(true);
    expect(title(html)).toBe('This document is still processing');
  });

  it('the document reason wins over a running answer', () => {
    expect(title(ask({ documentState: 'gone', locked: true }))).toBe('This document is no longer available');
  });

  it('stays enabled for ok, unknown and the soft states', () => {
    for (const documentState of [undefined, null, 'ok', 'stale', 'text_only', 'unknown_freshness', 'no_page_text']) {
      const html = ask({ documentState });
      expect(disabled(html)).toBe(false);
      expect(title(html)).toBe('Attach this document so the next questions search only it');
    }
  });

  it('keeps today\'s reason while an answer runs', () => {
    const html = ask({ locked: true });
    expect(disabled(html)).toBe(true);
    expect(title(html)).toBe('Available when the current answer has finished');
  });

  it('the reported state belongs to one source and resets when the source changes', () => {
    const record = { key: 'd3:c3', state: 'gone' };
    expect(currentDocumentState(record, 'd3:c3')).toBe('gone');
    expect(currentDocumentState(record, 'd1:c1')).toBeNull();
    expect(currentDocumentState(null, 'd3:c3')).toBeNull();
  });
});
