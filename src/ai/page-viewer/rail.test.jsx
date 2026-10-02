// The page rail's markup and layout (docs/specs/2026-10-02-viewer-continuous.md, section 5): the
// Pages and Results tabs, each thumbnail's name and markers, the virtualised list, and the toggle.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PageControls from './PageControls.jsx';
import PageRail, { RailTabs, Thumb, railLayout, thumbLabel } from './PageRail.jsx';
import { THUMB_WIDTH } from './thumbnailCache.js';

const noop = () => {};

describe('railLayout', () => {
  it(`stacks the thumbnails ${THUMB_WIDTH} px wide from the page shapes, each with room for its number`, () => {
    const layout = railLayout([1.5, 1.5, 0.75]);
    expect(layout.heights).toEqual([180, 180, 90]);
    expect(layout.tops[1] - layout.tops[0]).toBeGreaterThan(180);
    expect(layout.total).toBe(layout.tops[2] + 90);
  });
});

describe('thumbLabel', () => {
  it('names the page, and says when it is current, cited, or holds matches', () => {
    expect(thumbLabel({ page: 4 })).toBe('Page 4');
    expect(thumbLabel({ page: 4, cited: true, hits: 2 })).toBe('Page 4, cited, 2 matches');
    expect(thumbLabel({ page: 9, hits: 1 })).toBe('Page 9, 1 match');
  });
});

describe('Thumb', () => {
  it('is a button to its page, current marked, with the cited dot and the match badge hidden from assistive technology', () => {
    const html = renderToStaticMarkup(<Thumb page={4} top={0} height={180} url="blob:t1" current cited hits={2} onPick={noop} />);
    expect(html).toMatch(/<button[^>]*aria-label="Page 4, cited, 2 matches"[^>]*aria-current="page"[^>]*tabindex="0"/);
    expect(html).toContain('src="blob:t1"');
    expect(html).toMatch(/class="pv-thumb-cited" aria-hidden="true"/);
    expect(html).toMatch(/class="pv-thumb-hits" aria-hidden="true">2</);
  });

  it('shows a placeholder until drawn, and only the current page is in the tab order', () => {
    const html = renderToStaticMarkup(<Thumb page={5} top={190} height={180} url={null} onPick={noop} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toContain('aria-current');
  });
});

describe('RailTabs', () => {
  it('Pages and Results as tabs, the chosen one selected, Results counting the matched pages', () => {
    const html = renderToStaticMarkup(<RailTabs id="r" tab="results" onTab={noop} resultCount={3} />);
    expect(html).toMatch(/role="tablist"/);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*>Pages</);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Results <span[^>]*>3</);
  });
});

describe('PageRail', () => {
  const props = { variant: 'drawer', tab: 'pages', onTab: noop, aspects: [1.4, 1.4], total: 2, current: 1, cited: 1, counts: new Map(), onPick: noop, thumbs: null, results: null, onClose: noop };

  it('a closed drawer is inert and hidden from assistive technology', () => {
    const html = renderToStaticMarkup(<PageRail {...props} open={false} />);
    expect(html).toMatch(/<aside[^>]*class="pv-rail pv-rail-drawer"[^>]*inert=""/);
  });

  it('the Results tab without a search says how to fill it', () => {
    const html = renderToStaticMarkup(<PageRail {...props} open tab="results" />);
    expect(html).toContain('Search the document to list its matches here.');
  });
});

describe('PageControls rail toggle', () => {
  it('the thumbnails control comes first, and says whether the rail is open', () => {
    const html = renderToStaticMarkup(<PageControls variant="toolbar" page={4} total={22} cited={4} onPage={noop} zoom={null} onSearch={noop} onRail={noop} railOpen />);
    expect([...html.matchAll(/aria-label="([^"]+)"/g)].map(m => m[1]).slice(0, 3)).toEqual(['Pages', 'Thumbnails', 'Search in document']);
    expect(html).toMatch(/aria-label="Thumbnails"[^>]*aria-expanded="true"/);
  });
});
