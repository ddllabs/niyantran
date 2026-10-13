import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WorkSurface, { AskAboutDocument, currentDocumentState, resolveViewer } from './WorkSurface.jsx';
import { isReadableCitation } from './CitationBubble.jsx';

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

  // F116: the reader's title says which version is open; an unknown role is dropped when sanitised.
  it('names the version beside the title, and drops an unknown role', () => {
    const html = renderToStaticMarkup(<WorkSurface viewer={{ kind: 'text', source: { ...LEGACY, document_role: 'as_passed_lok_sabha' } }} />);
    expect(html).toContain('<small class="ai-work-version">As passed by Lok Sabha</small>');
    expect(resolveViewer({ kind: 'text', source: { ...LEGACY, document_role: 'forged' } }).source).not.toHaveProperty('document_role');
    expect(renderToStaticMarkup(<WorkSurface viewer={{ kind: 'text', source: LEGACY }} />)).not.toContain('ai-work-version');
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

// F130 T4b: web sources are not citations. They open their own viewer and never reach the citation paths.
describe('web sources viewer', () => {
  const PAGES = [
    { url: 'https://www.rbi.org.in/press?id=1', title: 'RBI press release', domain: 'rbi.org.in', cited: true },
    { url: 'https://pib.gov.in/x', title: 'PIB note', domain: 'pib.gov.in', cited: false },
  ];
  const WEB = { kind: 'web', pages: PAGES, messageId: 'a1' };
  const viewer = { kind: 'web', source: WEB };

  it('resolveViewer recognises kind web before the citation check: reader web, never invalid, pages kept', () => {
    const r = resolveViewer(viewer, []);
    expect(r.reader).toBe('web');
    expect(r.invalid).toBe(false);
    expect(r.source).toBeNull();
    expect(r.pages).toEqual(PAGES);
  });

  it('drops malformed pages: a non-http(s) URL, a missing URL, a non-object', () => {
    const r = resolveViewer({ kind: 'web', source: { ...WEB, pages: [...PAGES, { url: 'javascript:alert(1)', title: 'x' }, { title: 'no url' }, null, { url: 'data:text/html,x', title: 'd' }] } }, []);
    expect(r.pages.map(p => p.url)).toEqual(PAGES.map(p => p.url));
    expect(r.reader).toBe('web');
    expect(r.invalid).toBe(false);
  });

  it('a web source with no usable pages is still the web viewer, with an empty list', () => {
    const r = resolveViewer({ kind: 'web', source: { kind: 'web', pages: undefined } }, []);
    expect(r).toMatchObject({ reader: 'web', invalid: false, pages: [] });
  });

  it('other viewers carry no pages', () => {
    expect(resolveViewer({ kind: 'row', source: ROW }, []).pages).toEqual([]);
    expect(resolveViewer({ kind: 'list' }, []).pages).toEqual([]);
  });

  it('renders the sources list inside the usual viewer chrome, with no Ask about this document and no citation reader', () => {
    const html = renderToStaticMarkup(<WorkSurface viewer={viewer} sources={[LEGACY]} onClose={() => {}} />);
    expect(html).toContain('Web sources searched');
    expect(html).toContain('RBI press release');
    expect(html).toContain('href="https://pib.gov.in/x"');
    expect(html).toContain('aria-label="Back to the answer"');
    // The web list is not a citation, so its close control says what it closes.
    expect(html.match(/<button[^>]*aria-label="Close web sources"[^>]*title="Close web sources"[^>]*>✕<\/button>/g)).toHaveLength(1);
    expect(html).not.toContain('Close citation');
    expect(html).not.toContain('Ask about this document');
    expect(html).not.toContain('This source is unavailable');
    expect(html).not.toContain('aria-label="Cited source"');
    expect(html).not.toContain('ai-work-sources');
    expect(html).not.toContain('This answer cites no sources yet');
  });

  it('never renders a link for a page that is not http(s), even when it reaches the viewer', () => {
    const html = renderToStaticMarkup(<WorkSurface viewer={{ kind: 'web', source: { ...WEB, pages: [{ url: 'javascript:alert(1)', title: 'Click me', domain: 'evil.example' }] } }} />);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('Click me');
  });

  it('a web source is not a citation: isReadableCitation refuses it and the citation list ignores it', () => {
    expect(isReadableCitation(WEB)).toBe(false);
    expect(resolveViewer({ kind: 'list' }, [WEB, LEGACY]).sources).toHaveLength(1);
  });
});
