// The viewer chrome's markup (docs/specs/2026-10-02-viewer-toolbar.md, "Acceptance evidence"):
// the order and names of the controls in both layouts, the cited chip's two states, the More
// menu's items, and that every icon-only control is named.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DocumentRow, FullHeader, MoreMenu, ViewSwitch, moreItems } from './DocumentChrome.jsx';
import PageControls, { CitedChip, PageField } from './PageControls.jsx';

const noop = () => {};
const ZOOM = { fit: 'text', manual: false, readout: '62%', canZoomIn: true, canZoomOut: true, onZoomStep: noop, onFit: noop };
const labels = html => [...html.matchAll(/aria-label="([^"]+)"/g)].map(m => m[1]);

/** Every element that is a button or link with no text of its own must carry an aria-label. */
function unnamedIconControls(html) {
  return [...html.matchAll(/<(button|a)\b([^>]*)>(.*?)<\/\1>/g)]
    .filter(([, , attrs, inner]) => !/aria-label="/.test(attrs) && !inner.replace(/<span class="pv-tip"[^]*?<\/span>|<svg[^]*?<\/svg>|<[^>]+>/g, '').trim());
}

describe('PageControls', () => {
  it('the side pane toolbar: previous, page box, next, cited chip, zoom, full view, in that order', () => {
    const html = renderToStaticMarkup(<PageControls variant="toolbar" page={4} total={22} cited={4} onPage={noop} zoom={ZOOM} onExpand={noop} />);
    expect(labels(html)).toEqual(['Pages', 'Previous page', 'Page, 1 to 22', 'Next page', 'Back to cited passage on page 4', 'Zoom', 'Zoom out', 'Zoom 62%, choose a fit', 'Zoom in', 'Full view']);
    expect(html).toContain('Cited p. 4');
    expect(html).toMatch(/aria-live="polite"[^>]*>Page 4 of 22</);
    expect(unnamedIconControls(html)).toEqual([]);
  });

  it('keeps the paging keys on the controls that page', () => {
    const html = renderToStaticMarkup(<PageControls variant="toolbar" page={4} total={22} cited={4} onPage={noop} zoom={ZOOM} />);
    expect(html).toMatch(/aria-label="Previous page" aria-keyshortcuts="ArrowLeft \["/);
    expect(html).toMatch(/aria-label="Next page" aria-keyshortcuts="ArrowRight \]"/);
  });

  it('Full view opens a dialog', () => {
    const html = renderToStaticMarkup(<PageControls variant="toolbar" page={4} total={22} cited={4} onPage={noop} zoom={ZOOM} onExpand={noop} />);
    expect(html).toMatch(/aria-label="Full view"[^>]*aria-haspopup="dialog"/);
  });

  it('the full view pill: tooltips above, no full view control', () => {
    const html = renderToStaticMarkup(<PageControls variant="pill" page={4} total={22} cited={4} onPage={noop} zoom={ZOOM} />);
    expect(html).toContain('class="pv-pages pv-pages-pill"');
    expect(html).not.toContain('Full view');
    expect(html).not.toContain('data-tip-side="below"');
  });

  it('without zoom (Text view, compact) shows paging only', () => {
    const html = renderToStaticMarkup(<PageControls variant="toolbar" page={4} total={22} cited={4} onPage={noop} zoom={null} />);
    expect(html).not.toContain('Zoom');
    expect(html).not.toContain('pv-pages-end');
  });

  it('marks previous and next unavailable only at the ends, and the zoom steps only at their limits, keeping them focusable', () => {
    const first = renderToStaticMarkup(<PageControls variant="toolbar" page={1} total={22} cited={4} onPage={noop} zoom={{ ...ZOOM, canZoomIn: false }} />);
    expect(first).toMatch(/aria-label="Previous page"[^>]*aria-disabled="true"/);
    expect(first).not.toMatch(/aria-label="Next page"[^>]*aria-disabled="true"/);
    expect(first).toMatch(/aria-label="Zoom in"[^>]*aria-disabled="true"/);
    expect(first).not.toMatch(/aria-label="Zoom out"[^>]*aria-disabled="true"/);
    expect(first).not.toContain('disabled=""');
  });

  it('the fit readout is a closed menu button', () => {
    const html = renderToStaticMarkup(<PageControls variant="toolbar" page={4} total={22} cited={4} onPage={noop} zoom={ZOOM} />);
    expect(html).toMatch(/class="pv-readout" aria-label="Zoom 62%, choose a fit" aria-haspopup="menu" aria-expanded="false"/);
  });
});

describe('CitedChip', () => {
  it('is actionable on the cited page, with no disabled control', () => {
    const html = renderToStaticMarkup(<CitedChip page={4} cited={4} onPage={noop} />);
    expect(html).toMatch(/^<button/);
    expect(html).toContain('Back to cited passage on page 4');
    expect(html).toContain('Cited p. 4');
    expect(html).toContain('<button');
  });

  it('elsewhere is the button back to the cited page, on Home', () => {
    const html = renderToStaticMarkup(<CitedChip page={9} cited={4} onPage={noop} />);
    expect(html).toMatch(/^<button type="button" class="pv-cite pv-cite-back" aria-keyshortcuts="Home" aria-label="Back to cited passage on page 4"><svg/);
    expect(html).toContain('Back to p. 4');
  });
});

describe('PageField', () => {
  it('shows the current page in a numeric box sized to the page count', () => {
    const html = renderToStaticMarkup(<PageField page={4} total={122} onPage={noop} />);
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('size="3"');
    expect(html).toContain('value="4"');
    expect(html).toContain('<span class="pv-page-total" aria-hidden="true">/ 122</span>');
  });
});

describe('moreItems', () => {
  const base = { zoom: null, storedLabel: 'Open stored copy', onStoredCopy: noop, fileName: 'bill.pdf', copyState: 'idle', onCopy: noop };

  it('without zoom: the stored copy, then Copy file name, which keeps the menu open and is described by the file name', () => {
    const items = moreItems({ ...base, fileId: 'f1' });
    expect(items.map(i => i.label)).toEqual(['Open stored copy', 'Copy file name']);
    expect(items[1].keepOpen).toBe(true);
    expect(items[1].describedBy).toBe('f1');
  });

  it('compact: zoom steps and fits first, the current fit checked, then a separator', () => {
    const items = moreItems({ ...base, zoom: ZOOM });
    expect(items.map(i => i.label ?? '—')).toEqual(['Zoom in', 'Zoom out', 'Fit text', 'Fit width', 'Fit page', '—', 'Open stored copy', 'Copy file name']);
    expect(items.filter(i => i.checked).map(i => i.label)).toEqual(['Fit text']);
  });

  it('leaves out a zoom step that cannot move, rather than disabling it', () => {
    const items = moreItems({ ...base, zoom: { ...ZOOM, canZoomIn: false } });
    expect(items.map(i => i.label)).not.toContain('Zoom in');
  });

  it('says whether the copy worked', () => {
    expect(moreItems({ ...base, copyState: 'ok' })[1].label).toBe('File name copied');
    expect(moreItems({ ...base, copyState: 'fail' })[1].label).toBe("Couldn't copy the file name");
  });

  it('is empty with nothing to offer, and then no menu is drawn', () => {
    expect(moreItems({ ...base, storedLabel: null, fileName: '' })).toEqual([]);
    expect(renderToStaticMarkup(<MoreMenu />)).toBe('');
  });
});

describe('DocumentRow (side pane)', () => {
  const row = props => renderToStaticMarkup(
    <DocumentRow section={{ head: '', note: 'Amendment of section 10.', label: 'Amendment of section 10.' }} viewSwitch={<ViewSwitch view="pdf" onView={noop} />} fileUrl="https://sansad.in/a.pdf" more={<MoreMenu storedLabel="Open stored copy" fileName="bill.pdf" />} {...props} />,
  );

  it('shows the section, the view switch, the original file and More; no title, close or file name', () => {
    const html = row();
    expect(html).toContain('<p class="pv-section" title="Amendment of section 10."><span class="pv-section-note">Amendment of section 10.</span></p>');
    expect(html).toMatch(/aria-pressed="true">PDF</);
    expect(html).toContain('aria-label="Open original file (opens in a new tab)"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toMatch(/aria-label="More"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
    expect(html).not.toContain('bill.pdf');
    expect(html).not.toContain('Close');
    expect(unnamedIconControls(html)).toEqual([]);
  });

  it('leaves out the file link without a public URL, and escapes the section', () => {
    const html = row({ fileUrl: '', section: { head: '<b>x</b>', note: '<img src=x onerror=alert(1)>', label: '<img>' } });
    expect(html).not.toContain('Open original file');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
  });

  it('keeps the note in its own span after the heading, so the heading gives way first', () => {
    const html = row({ section: { head: 'Chapter II', note: 'Definitions', label: 'Chapter II › Definitions' } });
    expect(html).toContain('title="Chapter II › Definitions"><span class="pv-section-head">Chapter II</span><span class="pv-section-sep" aria-hidden="true">›</span><span class="pv-section-note">Definitions</span>');
  });
});

describe('FullHeader', () => {
  it('carries the title the dialog is labelled by, the section, and Exit full view', () => {
    const html = renderToStaticMarkup(
      <FullHeader title="Anti-Doping Bill" titleId="t1" section={{ head: '', note: 'Amendment of section 10.', label: 'Amendment of section 10.' }} viewSwitch={null} fileUrl="" more={null} onExit={vi.fn()} />,
    );
    expect(html).toContain('<strong id="t1">Anti-Doping Bill</strong>');
    expect(html).toContain('<span class="pv-head-section"> › Amendment of section 10.</span>');
    expect(html).toMatch(/aria-label="Exit full view" aria-keyshortcuts="Escape"/);
    expect(html).toContain('<kbd>Esc</kbd>');
  });
});
