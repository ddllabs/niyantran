// The search chrome's markup (docs/specs/2026-10-02-viewer-continuous.md, section 4): the bar's
// controls and names, the counter as a live status, the recognised-text note, and the Results list.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PageControls from './PageControls.jsx';
import SearchBar from './SearchBar.jsx';
import SearchResults from './SearchResults.jsx';

const noop = () => {};
const labels = html => [...html.matchAll(/aria-label="([^"]+)"/g)].map(m => m[1]);

describe('SearchBar', () => {
  it('the field, the counter, previous and next match, and close, in that order and named', () => {
    const html = renderToStaticMarkup(<SearchBar query="accused" label="3 of 9" total={9} onQuery={noop} onStep={noop} onClose={noop} />);
    expect(labels(html)).toEqual(['Search in document', 'Previous match', 'Next match', 'Close search']);
    expect(html).toMatch(/role="search"/);
    expect(html).toMatch(/role="status"[^>]*>3 of 9</);
    expect(html).toMatch(/aria-label="Previous match" aria-keyshortcuts="Shift\+Enter"/);
    expect(html).toMatch(/aria-label="Next match" aria-keyshortcuts="Enter"/);
    expect(html).toMatch(/aria-label="Close search" aria-keyshortcuts="Escape"/);
  });

  it('cannot step without matches', () => {
    const html = renderToStaticMarkup(<SearchBar query="zz" label="No matches" total={0} onQuery={noop} onStep={noop} onClose={noop} />);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
  });

  it('says when the current match is only in the recognised text, with the switch to the Text view', () => {
    const html = renderToStaticMarkup(<SearchBar query="accused" label="1 of 2" total={2} onQuery={noop} onStep={noop} onClose={noop} onTextView={noop} />);
    expect(html.replaceAll('&#x27;', "'")).toContain("This page's matches are in its recognised text");
    expect(html).toContain('>Show in Text view</button>');
  });
});

describe('SearchResults', () => {
  const pages = [
    { page: 4, hits: 2, snippets: ['the accused was found'] },
    { page: 9, hits: 1, snippets: [] },
  ];

  it('lists each page with its count and snippets, the matches marked, each a button to the page', () => {
    const html = renderToStaticMarkup(<SearchResults query="accused" pages={pages} onPick={noop} />);
    expect(html).toMatch(/<button[^>]*>.*Page 4.*2 matches.*<\/button>/s);
    expect(html).toContain('the <mark>accused</mark> was found');
    expect(html).toContain('1 match<');
  });

  it('says there is nothing to list', () => {
    expect(renderToStaticMarkup(<SearchResults query="zz" pages={[]} onPick={noop} />)).toContain('No matches');
  });
});

describe('PageControls search', () => {
  it('the search control comes first in the side pane toolbar, and says whether search is open', () => {
    const html = renderToStaticMarkup(<PageControls variant="toolbar" page={4} total={22} cited={4} onPage={noop} zoom={null} onSearch={noop} searchOpen />);
    expect(labels(html).slice(0, 2)).toEqual(['Pages', 'Search in document']);
    expect(html).toMatch(/aria-label="Search in document" aria-keyshortcuts="Control\+F Meta\+F"[^>]*aria-expanded="true"/);
  });

  it('has no search control without onSearch', () => {
    expect(renderToStaticMarkup(<PageControls variant="pill" page={4} total={22} cited={4} onPage={noop} zoom={null} />)).not.toContain('Search in document');
  });
});
