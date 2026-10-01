import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PageBar from './PageBar.jsx';
import PageViewer, { DocumentNotice, FullViewDialog, StateNotices, ViewerControls, ViewerHeader } from './PageViewer.jsx';
import { PdfOverlay, cropStyles } from './PdfPage.jsx';
import { DEFAULT_ZOOM, layoutPage } from './zoomModel.js';
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
  const base = {
    view: 'pdf', onView: () => {}, fit: 'text', manual: false, onFit: () => {}, readout: '112%',
    canZoomOut: true, canZoomIn: true, onZoomStep: () => {}, onExpand: () => {}, onStoredCopy: () => {},
  };
  const disabled = label => new RegExp(`disabled=""[^>]*aria-label="${label}"|aria-label="${label}"[^>]*disabled=""`);

  it('offers the PDF | Text switch only when the PDF exists, with the current view pressed', () => {
    const html = renderToStaticMarkup(<ViewerControls {...base} available storedLabel="Open stored copy" />);
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>PDF<\/button>/);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Text<\/button>/);
    const none = renderToStaticMarkup(<ViewerControls {...base} view="text" available={false} storedLabel={null} />);
    expect(none).not.toContain('>PDF<');
  });

  it('groups the controls in order: view, fit, zoom out, readout, zoom in, Full view, stored copy', () => {
    const html = renderToStaticMarkup(<ViewerControls {...base} available storedLabel="Open stored copy" />);
    const order = ['>PDF<', 'aria-label="Fit"', 'aria-label="Zoom out"', '>112%<', 'aria-label="Zoom in"', 'aria-label="Full view"', '>Open stored copy<'];
    const at = order.map(token => html.indexOf(token));
    expect(at.every(i => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('offers Fit text, Fit width and Fit page, with the current fit selected', () => {
    const html = renderToStaticMarkup(<ViewerControls {...base} fit="page" available storedLabel={null} />);
    expect(html).toMatch(/<select[^>]*aria-label="Fit"/);
    expect(html).toContain('>Fit text</option>');
    expect(html).toContain('>Fit width</option>');
    expect(html).toMatch(/<option value="page" selected="">Fit page<\/option>/);
  });

  it('shows a manual zoom as a custom choice, so picking a fit returns to it', () => {
    const html = renderToStaticMarkup(<ViewerControls {...base} manual readout="150%" available storedLabel={null} />);
    expect(html).toMatch(/<option value="" disabled="" selected="">Custom zoom<\/option>/);
    expect(html).not.toMatch(/<option value="text" selected="">/);
    expect(renderToStaticMarkup(<ViewerControls {...base} available storedLabel={null} />)).not.toContain('Custom zoom');
  });

  it('shows the effective zoom readout between − and +, disabling a step past 50% or 300%', () => {
    const html = renderToStaticMarkup(<ViewerControls {...base} readout="300%" canZoomIn={false} available storedLabel={null} />);
    expect(html).toContain('>300%<');
    expect(html).toMatch(disabled('Zoom in'));
    expect(html).not.toMatch(disabled('Zoom out'));
    const min = renderToStaticMarkup(<ViewerControls {...base} readout="50%" canZoomOut={false} available storedLabel={null} />);
    expect(min).toMatch(disabled('Zoom out'));
  });

  it('hides fit and zoom in the Text view, but keeps Full view', () => {
    const html = renderToStaticMarkup(<ViewerControls {...base} view="text" available storedLabel={null} />);
    expect(html).not.toContain('Zoom');
    expect(html).not.toContain('aria-label="Fit"');
    expect(html).toContain('aria-label="Full view"');
  });

  it('shows Full view as a dialog opener only when it can open (not on phones, not inside the full view)', () => {
    const html = renderToStaticMarkup(<ViewerControls {...base} available storedLabel={null} />);
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*aria-label="Full view"|<button[^>]*aria-label="Full view"[^>]*aria-haspopup="dialog"/);
    expect(renderToStaticMarkup(<ViewerControls {...base} onExpand={null} available storedLabel={null} />)).not.toContain('Full view');
  });

  it('shows Open stored copy with its part label only when given one', () => {
    const html = renderToStaticMarkup(<ViewerControls {...base} available storedLabel="Open stored copy (part 2 of 3)" />);
    expect(html).toMatch(/<button[^>]*>Open stored copy \(part 2 of 3\)<\/button>/);
    expect(renderToStaticMarkup(<ViewerControls {...base} available storedLabel={null} />)).not.toContain('stored copy');
  });
});

describe('ViewerHeader', () => {
  it('inline: the title, the public file link and Close reader', () => {
    const html = renderToStaticMarkup(<ViewerHeader title="Anti-Doping Bill" fileName="bill.pdf" fileUrl="https://example.org/b.pdf" onClose={() => {}} />);
    expect(html).toContain('Anti-Doping Bill');
    expect(html).toContain('aria-label="Close reader"');
    expect(html).not.toContain('Close full view');
  });

  it('full view: the title carries the dialog label id, and the close control leaves the full view', () => {
    const html = renderToStaticMarkup(<ViewerHeader title="Anti-Doping Bill" titleId="pv-t1" onClose={() => {}} full />);
    expect(html).toMatch(/<strong id="pv-t1">Anti-Doping Bill<\/strong>/);
    expect(html).toContain('aria-label="Close full view"');
    expect(html).not.toContain('Close reader');
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

describe('cropStyles', () => {
  const blocks = [{ type: 'text', x0: 0.25, y0: 0.1, x1: 0.75, y1: 0.9 }];
  const layout = layoutPage({ state: DEFAULT_ZOOM, page: { width: 595, height: 842 }, pane: { width: 480, height: 600 }, blocks });

  it('clips to the content box and shifts the whole page so the text layer and boxes keep page coordinates', () => {
    const styles = cropStyles(layout);
    expect(styles.crop.width).toBe('480px');
    expect(parseFloat(styles.page.left)).toBeCloseTo(-0.23 * layout.pageCss.width, 2);
    expect(parseFloat(styles.page.width)).toBeCloseTo(595 * layout.scale, 2);
  });

  it('a box at the content edge lands on the crop edge', () => {
    const styles = cropStyles(layout);
    // A box's left is a percentage of the page; the page is shifted by styles.page.left.
    const boxLeftPx = parseFloat(styles.page.left) + layout.crop.x0 * parseFloat(styles.page.width);
    const boxRightPx = parseFloat(styles.page.left) + layout.crop.x1 * parseFloat(styles.page.width);
    expect(boxLeftPx).toBeCloseTo(0, 1);
    expect(boxRightPx).toBeCloseTo(parseFloat(styles.crop.width), 1);
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
