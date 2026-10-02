import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PageViewer, { DocumentNotice, FullViewDialog, StateNotices } from './PageViewer.jsx';
import { PdfOverlay } from './PdfDocument.jsx';
import TextPage from './TextPage.jsx';
import { NOTICES } from './viewerModel.js';
import { PDF_NOTICES } from './pdfController.js';

/** React escapes an apostrophe in text; compare notices as they appear in markup. */
const escaped = text => text.replace(/'/g, '&#x27;');

const CITATION = {
  id: 1, kind: 'text', chunk_id: 'c1', document_id: 'd1', title: 'Anti-Doping Bill', file_name: 'bill.pdf',
  char_from: 1010, char_to: 1020, text_hash: 'h', source_kind: 'pdf_page', page_number: 3, extract_hash: 'x1',
};

// The page bar, the header controls and the inline header became the viewer chrome
// (docs/specs/2026-10-02-viewer-toolbar.md). Their behaviour is tested where it now lives:
// - labels, paging keys, disabled ends, the cited page and the live page announcement:
//   chrome.test.jsx, PageControls and CitedChip;
// - the section and its escaping, the file link, Close reader: chrome.test.jsx, DocumentRow;
// - the full view's title as the dialog label: chrome.test.jsx, FullHeader;
// - the PDF | Text switch only with a PDF, zoom only in the PDF view, Full view not on phones or
//   inside the full view: chromeModel.test.js, chromePlan;
// - the fits, the current fit and a manual zoom: chromeModel.test.js, fitItems, and
//   chrome.test.jsx, moreItems;
// - the zoom steps' limits: chrome.test.jsx, PageControls;
// - the stored copy's part label: viewerModel.test.js, storedCopyLabel, shown by MoreMenu.

describe('notices per state', () => {
  it('document-level states', () => {
    expect(renderToStaticMarkup(<DocumentNotice status="loading" />)).toContain('Loading…');
    expect(renderToStaticMarkup(<DocumentNotice status="gone" />)).toContain(NOTICES.gone);
    const failed = renderToStaticMarkup(<DocumentNotice status="error" onRetry={() => {}} />);
    expect(failed).toContain(NOTICES.loadFailed);
    expect(failed).toMatch(/<button[^>]*>Retry<\/button>/);
    expect(renderToStaticMarkup(<DocumentNotice status="ok" />)).toBe('');
  });

  it('not live, stale, and nothing for unknown freshness or ok', () => {
    expect(renderToStaticMarkup(<StateNotices state="not_live" />)).toContain(NOTICES.notLive);
    expect(renderToStaticMarkup(<StateNotices state="stale" />)).toContain(NOTICES.stale);
    for (const state of ['unknown_freshness', 'ok', 'text_only']) {
      expect(renderToStaticMarkup(<StateNotices state={state} />)).toBe('');
    }
  });

  it('a PDF failure shows its fixed notice with Retry', () => {
    const html = renderToStaticMarkup(<StateNotices state="ok" pdfError={PDF_NOTICES.download} onRetryPdf={() => {}} />);
    expect(html).toContain(PDF_NOTICES.download);
    expect(html).toMatch(/<button[^>]*>Retry<\/button>/);
  });

  it('a stored-copy failure shows its notice', () => {
    expect(renderToStaticMarkup(<StateNotices state="ok" copyNotice="The stored copy could not be opened. Try again." />))
      .toContain('The stored copy could not be opened.');
  });
});

describe('TextPage', () => {
  const pageText = 'Clause 4. The Agency shall test athletes.';
  const row = { page_number: 3, text: pageText, char_from: 1000, char_to: 1000 + pageText.length };

  it('marks the exact span', () => {
    const html = renderToStaticMarkup(<TextPage status="ok" pageRow={row} span={{ status: 'exact', from: 10, to: 20 }} />);
    expect(html).toContain('<mark class="ai-reader-mark">The Agency</mark>');
    expect(html).not.toContain(NOTICES.spanChanged);
  });

  it('shows the page with a notice when the span changed', () => {
    const html = renderToStaticMarkup(<TextPage status="ok" pageRow={row} span={{ status: 'changed' }} />);
    expect(html).toContain(NOTICES.spanChanged);
    expect(html).toContain('Clause 4.');
    expect(html).not.toContain('<mark');
  });

  it('says when the page text is missing, loading or failed', () => {
    expect(renderToStaticMarkup(<TextPage status="ok" pageRow={null} />)).toContain(escaped(NOTICES.noPageText));
    expect(renderToStaticMarkup(<TextPage status="loading" pageRow={null} />)).toContain('Loading…');
    const failed = renderToStaticMarkup(<TextPage status="error" pageRow={null} onRetry={() => {}} />);
    expect(failed).toContain(escaped(NOTICES.pageFailed));
    expect(failed).toMatch(/<button[^>]*>Retry<\/button>/);
  });

  it('renders stored markup through RichText, never as HTML', () => {
    const text = 'Intro\n\n<script>alert(1)</script> after';
    const html = renderToStaticMarkup(<TextPage status="ok" pageRow={{ ...row, text, char_to: 1000 + text.length }} />);
    expect(html).not.toContain('<script>');
  });
});

describe('PdfOverlay', () => {
  it('draws pointer-events-none boxes at their percentages', () => {
    const html = renderToStaticMarkup(<PdfOverlay overlay={{ boxes: [{ left: '10%', top: '20%', width: '40%', height: '10%' }], hint: false }} />);
    expect(html).toContain('class="pv-box"');
    expect(html).toContain('left:10%;top:20%;width:40%;height:10%');
    expect(html).not.toContain(NOTICES.hint);
  });

  it('shows the hint instead of boxes', () => {
    const html = renderToStaticMarkup(<PdfOverlay overlay={{ boxes: [], hint: true }} />);
    expect(html).toContain(NOTICES.hint);
    expect(html).not.toContain('pv-box"');
  });
});

describe('FullViewDialog', () => {
  it('is a modal dialog labelled by the document title, carrying the app theme', () => {
    const html = renderToStaticMarkup(
      <FullViewDialog titleId="pv-t1" themeClass="theme-dark"><strong id="pv-t1">Bill</strong></FullViewDialog>,
    );
    expect(html).toMatch(/role="dialog"/);
    expect(html).toMatch(/aria-modal="true"/);
    expect(html).toMatch(/aria-labelledby="pv-t1"/);
    expect(html).toMatch(/class="pv-full-root theme-dark"/);
    expect(html).toContain('<strong id="pv-t1">Bill</strong>');
  });

  it('marks its root as part of the citation viewer, so a click on the backdrop is not "outside"', () => {
    const html = renderToStaticMarkup(<FullViewDialog titleId="pv-t1"><strong id="pv-t1">Bill</strong></FullViewDialog>);
    expect(html).toMatch(/^<div class="pv-full-root" data-citation-viewer="full-view"><div class="pv-full" role="dialog"/);
  });
});

describe('PageViewer', () => {
  it('first renders a loading state, with no URL anywhere (WorkSurface\'s bar carries the title)', () => {
    const never = { from: () => ({ select: () => ({ eq: () => ({ abortSignal: () => ({ maybeSingle: () => new Promise(() => {}) }) }) }) }) };
    const html = renderToStaticMarkup(<PageViewer citation={CITATION} client={never} documentFile={{ partFor: () => new Promise(() => {}), invalidate() {} }} />);
    expect(html).toContain('Loading…');
    expect(html).not.toMatch(/https?:/);
  });
});
