// The continuous Text view's markup (docs/specs/2026-10-02-viewer-continuous.md, section 6): every
// page under its heading, a page not yet read held open, a failed batch with Retry, the cited
// passage marked on each page it touches, and the changed notice.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TextDocument from './TextDocument.jsx';
import { NOTICES } from './viewerModel.js';

const noop = () => {};
const base = { total: 4, title: 'Bill', onNeed: noop, onRetry: noop, openAt: 2, cited: 2, scrollRequest: null, onPage: noop, search: null, onSearchCount: noop };
const escaped = s => s.replaceAll("'", '&#x27;');

describe('TextDocument', () => {
  it('lays out every page under its heading, in a focusable region; unread pages hold their place', () => {
    const texts = new Map([[2, { status: 'ok', row: { page_number: 2, text: 'Clause 4. The Agency shall test athletes.' } }]]);
    const html = renderToStaticMarkup(<TextDocument {...base} texts={texts} pieces={null} />);
    expect(html).toMatch(/class="pv-textdoc" tabindex="0" role="region" aria-label="Text of Bill"/);
    expect([...html.matchAll(/<h3[^>]*>Page (\d+)<\/h3>/g)].map(m => m[1])).toEqual(['1', '2', '3', '4']);
    expect(html.match(/class="pv-textpage-wait"/g)).toHaveLength(3);
    expect(html).toContain('The Agency shall test athletes.');
  });

  it('marks the cited passage on each page it touches', () => {
    const texts = new Map([
      [2, { status: 'ok', row: { page_number: 2, text: 'Clause 4. The Agency shall test' } }],
      [3, { status: 'ok', row: { page_number: 3, text: 'athletes in competition. Clause 5.' } }],
    ]);
    const pieces = new Map([[2, { from: 10, to: 31 }], [3, { from: 0, to: 24 }]]);
    const html = renderToStaticMarkup(<TextDocument {...base} texts={texts} pieces={pieces} />);
    expect(html.match(/<mark/g)).toHaveLength(2);
  });

  it('says when the cited passage has changed, on the cited page', () => {
    const texts = new Map([[2, { status: 'ok', row: { page_number: 2, text: 'Clause 4.' } }]]);
    const html = renderToStaticMarkup(<TextDocument {...base} texts={texts} pieces={null} spanChanged />);
    expect(html).toContain(escaped(NOTICES.spanChanged));
  });

  it('a page that could not be read says so, with Retry; a page without text says so', () => {
    const texts = new Map([[1, { status: 'error', row: null }], [2, { status: 'ok', row: null }]]);
    const html = renderToStaticMarkup(<TextDocument {...base} texts={texts} pieces={null} />);
    expect(html).toContain(escaped(NOTICES.pageFailed));
    expect(html).toContain('>Retry</button>');
    expect(html).toContain(escaped(NOTICES.noPageText));
  });
});
