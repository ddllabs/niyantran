import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PageBar from './PageBar.jsx';
import PageViewer, { DocumentNotice, StateNotices, ViewerControls } from './PageViewer.jsx';
import { PdfOverlay } from './PdfPage.jsx';
import TextPage from './TextPage.jsx';
import { NOTICES } from './viewerModel.js';
import { PDF_NOTICES } from './pdfController.js';

/** React escapes an apostrophe in text; compare notices as they appear in markup. */
const escaped = text => text.replace(/'/g, '&#x27;');

const CITATION = {
  id: 1, kind: 'text', chunk_id: 'c1', document_id: 'd1', title: 'Anti-Doping Bill', file_name: 'bill.pdf',
  char_from: 1010, char_to: 1020, text_hash: 'h', source_kind: 'pdf_page', page_number: 3, extract_hash: 'x1',
};

describe('PageBar', () => {
  it('labels the page, the cited page, and its controls', () => {
    const html = renderToStaticMarkup(<PageBar page={4} total={12} cited={3} onPage={() => {}} />);
    expect(html).toContain('Page 4 of 12 · cited on page 3');
    expect(html).toMatch(/<button[^>]*>[^<]*Previous/);
    expect(html).toMatch(/<button[^>]*>Next/);
    expect(html).toMatch(/<button[^>]*>Back to citation<\/button>/);
    expect(html).toMatch(/aria-live="polite"[^>]*>Page 4 of 12</);
  });

  it('disables what cannot move', () => {
    const first = renderToStaticMarkup(<PageBar page={1} total={1} cited={1} onPage={() => {}} />);
    expect(first.match(/disabled=""/g)).toHaveLength(3);
  });

  it('shows the section heading and note when present', () => {
    const html = renderToStaticMarkup(<PageBar page={3} total={12} cited={3} section={{ heading: 'Chapter II', note: 'Definitions' }} onPage={() => {}} />);
    expect(html).toContain('Chapter II › Definitions');
    expect(renderToStaticMarkup(<PageBar page={3} total={12} cited={3} onPage={() => {}} />)).not.toContain('pv-section');
  });

  it('escapes the section like any text', () => {
    const html = renderToStaticMarkup(<PageBar page={3} total={12} cited={3} section={{ heading: '<img src=x onerror=alert(1)>' }} onPage={() => {}} />);
    expect(html).not.toContain('<img');
  });
});

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

describe('ViewerControls', () => {
  const base = { view: 'pdf', onView: () => {}, zoom: 1, onZoom: () => {}, onStoredCopy: () => {} };

  it('offers the PDF | Text switch only when the PDF exists, with the current view pressed', () => {
    const html = renderToStaticMarkup(<ViewerControls {...base} available storedLabel="Open stored copy" />);
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>PDF<\/button>/);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Text<\/button>/);
    const none = renderToStaticMarkup(<ViewerControls {...base} view="text" available={false} storedLabel={null} />);
    expect(none).not.toContain('>PDF<');
  });

  it('shows zoom out and in around fit-width in the PDF view only', () => {
    const html = renderToStaticMarkup(<ViewerControls {...base} available storedLabel={null} />);
    expect(html).toContain('aria-label="Zoom out"');
    expect(html).toContain('aria-label="Zoom in"');
    expect(renderToStaticMarkup(<ViewerControls {...base} view="text" available storedLabel={null} />)).not.toContain('Zoom');
    const max = renderToStaticMarkup(<ViewerControls {...base} zoom={2} available storedLabel={null} />);
    expect(max).toMatch(/disabled=""[^>]*aria-label="Zoom in"|aria-label="Zoom in"[^>]*disabled=""/);
  });

  it('shows Open stored copy with its part label only when given one', () => {
    const html = renderToStaticMarkup(<ViewerControls {...base} available storedLabel="Open stored copy (part 2 of 3)" />);
    expect(html).toMatch(/<button[^>]*>Open stored copy \(part 2 of 3\)<\/button>/);
    expect(renderToStaticMarkup(<ViewerControls {...base} available storedLabel={null} />)).not.toContain('stored copy');
  });
});

describe('PageViewer', () => {
  it('first renders the citation title and a loading state, with no URL anywhere', () => {
    const never = { from: () => ({ select: () => ({ eq: () => ({ abortSignal: () => ({ maybeSingle: () => new Promise(() => {}) }) }) }) }) };
    const html = renderToStaticMarkup(<PageViewer citation={CITATION} client={never} documentFile={{ partFor: () => new Promise(() => {}), invalidate() {} }} />);
    expect(html).toContain('Anti-Doping Bill');
    expect(html).toContain('Loading…');
    expect(html).not.toMatch(/https?:/);
  });
});
