// F366 slice C: tablet and phone are CSS too, so these read the stylesheets. The measured widths and heights
// (375px: no sideways scroll, targets of 40px) are checked in a browser.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('./liveTv.css', import.meta.url), 'utf8');
const panelCss = readFileSync(new URL('./factcheck/factCheck.css', import.meta.url), 'utf8');

// The text of the @media block whose query is exactly `query` (up to its matching close).
const media = (source, query) => {
  const at = source.indexOf(`@media ${query} {`);
  expect(at, query).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && (depth -= 1) === 0) return source.slice(at, i + 1);
  }
  return '';
};
const rule = (source, selector) => {
  const at = source.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf('}', at));
};

describe('phone layout (up to 600px)', () => {
  const phone = media(page, '(max-width: 600px)');
  it('keeps the video at the top of the screen while the panel scrolls under it', () => {
    expect(rule(phone, '.ltv-player-stage')).toMatch(/position:\s*sticky/);
    expect(rule(phone, '.ltv-player-stage')).toMatch(/top:\s*0/);
    expect(rule(phone, '.ltv-player-stage')).toMatch(/background:\s*var\(--bg\)/);
    // The stage shares a parent with the panel only when the video column dissolves into the split.
    expect(rule(phone, '.ltv-videocol')).toMatch(/display:\s*contents/);
  });
  it('keeps a focused control from hiding under the sticky video', () => {
    expect(rule(phone, '.ltv-main')).toMatch(/scroll-padding-top:\s*calc\(\(100vw - 24px\) \* 9 \/ 16/);
  });
  it('hides the channel strip arrows: the strip scrolls by touch', () => {
    expect(rule(phone, '.ltv-strip-arrows')).toMatch(/display:\s*none/);
  });
  it('is sticky nowhere else on the page: the video stays put on a phone only (F402 removed the sticky lower tabs and panel)', () => {
    expect(page.replace(phone, '').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/position:\s*sticky/);
    expect(rule(media(panelCss, '(min-width: 1081px)'), '.ltv-panelcol > .fc-panel')).not.toMatch(/sticky/);
  });
  it('lets the now-playing buttons wrap evenly under the title', () => {
    expect(rule(phone, '.ltv-nowplaying .ltv-player-controls')).toMatch(/flex:\s*1 0 100%/);
    expect(rule(phone, '.ltv-nowplaying .ltv-action-btn')).toMatch(/flex:\s*1 1 calc\(50% - 8px\)/);
  });
  it('puts the overlay strip above the player controls on the small video too', () => {
    const bottom = (css) => Number(rule(css, '.ltv-claimstrip-live').match(/bottom:\s*(\d+)px/)[1]);
    expect(bottom(page.replace(phone, ''))).toBeGreaterThanOrEqual(56);
    expect(bottom(phone)).toBeGreaterThanOrEqual(48);
  });
});

describe('nothing scrolls sideways', () => {
  it('clips the page body horizontally and lets every column shrink', () => {
    expect(page).toMatch(/\.ltv-main\s*\{\s*overflow-x:\s*hidden/);
    expect(page).toMatch(/\.ltv-main, \.ltv-body, \.ltv-split, \.ltv-videocol, \.ltv-panelcol, \.ltv-nowplaying, \.ltv-channelcard\s*\{\s*min-width:\s*0/);
  });
  it('wraps long titles, claims and reasons (Hindi has no spaces to break at in some runs)', () => {
    expect(page).toMatch(/\.ltv-np-line[^{]*\{\s*overflow-wrap:\s*anywhere/);
    expect(rule(panelCss, '.fc-card')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule(panelCss, '.fc-sources--pills a, .fc-sources--pills span')).toMatch(/overflow-wrap:\s*anywhere/);
  });
  it('lets the panel tabs and the deck tabs scroll inside themselves', () => {
    expect(rule(panelCss, '.fc-tabs')).toMatch(/overflow-x:\s*auto/);
    expect(rule(page, '\n.ltv-deck-tabs')).toMatch(/overflow-x:\s*auto/);
  });
});

describe('the video and the panel are sized by the window from 1081px (F387, F402)', () => {
  const wide = media(page, '(min-width: 1081px)');
  const supported = wide.slice(wide.indexOf('@supports (container-type: size)'));
  const bare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  it('measures nothing by script: no variable fed back from a measured height', () => {
    expect(page).not.toMatch(/--ltv-above-split|--ltv-video-w|--ltv-lower-min/);
    expect(page).toMatch(/--ltv-np-h:\s*72px/); // a fixed reserve for the now-playing row, not a measurement
  });
  it('uses container units only in the wide block, behind @supports, on one size container: .ltv-main', () => {
    expect(supported).toMatch(/\.ltv-main\s*\{\s*container:\s*ltvmain \/ size/);
    expect(bare(page.replace(wide, ''))).not.toMatch(/cq[wh]|container-type/);
    expect(bare(panelCss.replace(media(panelCss, '(min-width: 1081px)'), ''))).not.toMatch(/cq[wh]|--ltv-panel-h/);
    expect(media(panelCss, '(min-width: 1081px)')).toMatch(/@supports \(container-type: size\)/);
  });
  it('keeps the grid gaps in variables the column cap and the panel height both use', () => {
    const grid = rule(supported, '.ltv-grid');
    expect(grid).toMatch(/--ltv-gap-x:\s*16px/);
    expect(grid).toMatch(/--ltv-gap-y:\s*12px/);
    expect(rule(supported, '.ltv-grid.has-panel')).toMatch(/gap:\s*var\(--ltv-gap-y\) var\(--ltv-gap-x\)/);
  });
  it('floors the video column at 360px so a very short window scrolls the page instead of shrinking the video away', () => {
    expect(rule(supported, '.ltv-grid')).toMatch(/--ltv-video-max-w:\s*max\(360px,/);
    expect(rule(supported, '.ltv-grid.has-panel')).toMatch(/--ltv-panel-h:\s*max\(320px,/);
  });
  it('gives the now-playing row its natural height: no min-height: 0, so wrapped controls are never covered (F396)', () => {
    expect(bare(wide)).not.toMatch(/\.ltv-nowplaying\s*\{[^}]*min-height/);
    expect(rule(supported, '.ltv-nowplaying .ltv-program-info')).toMatch(/flex-basis:\s*120px/);
    expect(rule(supported, '.ltv-nowplaying .ltv-program-info h3')).toMatch(/-webkit-line-clamp:\s*2/);
    expect(rule(supported, '.ltv-nowplaying .ltv-player-controls')).toMatch(/margin-left:\s*auto/);
  });
  it('touches nothing at 1080px and below', () => {
    expect(bare(page.replace(wide, ''))).not.toMatch(/ltvmain|container-type|cqh|--ltv-video-h|--ltv-panel-h/);
    expect(rule(page.replace(wide, ''), '.ltv-lower')).toMatch(/gap:\s*16px/);
    expect(rule(page.replace(wide, ''), '.ltv-grid')).toMatch(/display:\s*contents/);
  });
});

describe('the channel name at the player', () => {
  it('shows no focus box: it takes focus from code for keyboard and screen-reader users but is not a control', () => {
    expect(page).toMatch(/\.ltv-program-info h3:focus,\s*\.ltv-program-info h3:focus-visible\s*\{[^}]*outline:\s*none[^}]*box-shadow:\s*none/);
  });
});

describe('touch targets', () => {
  const touch = media(page, '(max-width: 1080px), (pointer: coarse)');
  it('are 40px high on every control the page and the panel draw', () => {
    const first = touch.slice(0, touch.indexOf('}'));
    for (const sel of ['.ltv-action-btn', '.ltv-category-pill', '.ltv-tab-btn', '.ltv-channel-chip', '.fc-btn', '.fc-tab', '.fc-option', '.fc-tiles-clear', '.ltv-claimstrip-btn', '.pst-toggle']) {
      expect(first, sel).toContain(sel);
    }
    expect(first).toMatch(/min-height:\s*40px/);
  });
  it('the verdict tiles and the strip button are tall enough by themselves', () => {
    expect(Number(rule(panelCss, '.fc-tile').match(/min-height:\s*(\d+)px/)[1])).toBeGreaterThanOrEqual(40);
  });
});

describe('verdict tiles', () => {
  it('never break a word in the middle, and wrap 3 + 2 when five do not fit', () => {
    expect(rule(panelCss, '.fc-tile-label')).toMatch(/overflow-wrap:\s*normal/);
    expect(rule(panelCss, '.fc-tile-label')).not.toMatch(/anywhere|break-all|break-word/);
    expect(rule(panelCss, '.fc-tiles')).toMatch(/minmax\((9\d|1\d\d)px, 1fr\)/);
    expect(media(panelCss, '(max-width: 600px)')).not.toMatch(/\.fc-tiles/);
  });
});

describe('the panel scrolls in one place', () => {
  it('wide: the panel clips, the body between the fixed head and foot is the one scroller', () => {
    const wide = media(panelCss, '(min-width: 1081px)');
    expect(rule(wide, '.ltv-panelcol > .fc-panel')).toMatch(/overflow:\s*hidden/);
    expect(rule(panelCss, '.fc-body')).toMatch(/overflow-y:\s*auto/);
    expect(rule(panelCss, '.fc-body')).toMatch(/min-height:\s*0/);
    expect(rule(panelCss, '.fc-head')).toMatch(/flex:\s*none/);
    expect(rule(panelCss, '.fc-foot')).toMatch(/flex:\s*none/);
  });
  it('nothing inside the body scrolls on its own, apart from the live transcript box', () => {
    expect(rule(panelCss, '.fc-work')).toMatch(/overflow:\s*visible/);
    expect(rule(panelCss, '.fc-work')).not.toMatch(/overflow-y:\s*auto/);
    expect(rule(panelCss, '.fc-choose, .fc-waiting')).toMatch(/overflow:\s*visible/);
    expect(rule(panelCss, '.fc-transcript')).toMatch(/max-height:\s*min\(/);
  });
  it('stacked: no height limit and no inner scrolling, the page scrolls', () => {
    const stacked = media(panelCss, '(max-width: 1080px)');
    expect(rule(stacked, '.ltv-panelcol > .fc-panel')).toMatch(/max-height:\s*none/);
    expect(rule(stacked, '.ltv-panelcol > .fc-panel')).toMatch(/overflow:\s*visible/);
    expect(rule(stacked, '.fc-body')).toMatch(/overflow:\s*visible/);
  });
});

describe('colours and motion', () => {
  it('take the verdict colours from variables that have a dark value, in the panel', () => {
    expect(panelCss).toMatch(/\.theme-dark \.fc-panel\s*\{[^}]*--fc-bad[^}]*--fc-amber/);
    for (const k of ['supported', 'contradicted', 'partly_true', 'no_evidence', 'opinion']) {
      expect(rule(panelCss, `.fc-tile--${k}`), k).toMatch(/--v:\s*var\(--/);
    }
  });
  it('stop the new animations for readers who ask', () => {
    expect(media(panelCss, '(prefers-reduced-motion: reduce)')).toMatch(/\.fc-status--on \.fc-dot/);
    expect(media(page, '(prefers-reduced-motion: reduce)')).toMatch(/\.ltv-fcpill-dot/);
  });
});

describe('the channel bar keeps the panel\'s foot in the window (B6 review)', () => {
  const bar = readFileSync(new URL('./liveTv/channelBar.css', import.meta.url), 'utf8');
  const paste = readFileSync(new URL('./liveTv/pasteLink.css', import.meta.url), 'utf8');
  const outsideMedia = (css) => css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
  it('keeps the Segments button and the search box on one row that does not wrap', () => {
    expect(bar).toMatch(/\.ltv-channelbar \.ltv-seg-row\s*\{[^}]*flex-wrap:\s*nowrap/);
    // F402: the segment pills moved into the overlay; the bar has one Segments button (see channelBar.layout.test.js).
  });
  it('shows the "Paste a link" and "Channels" buttons on phones only, with a selector that beats liveTv.css', () => {
    expect(outsideMedia(paste)).toMatch(/\.ltv-paste \.ltv-paste-toggle\s*\{\s*display:\s*none/);
    expect(outsideMedia(bar)).toMatch(/\.ltv-channelbar \.ltv-sheet-open\s*\{\s*display:\s*none/);
    expect(paste).toMatch(/@media \(max-width: 600px\)[\s\S]*\.ltv-paste \.ltv-paste-toggle\s*\{\s*display:\s*inline-flex/);
    expect(bar).toMatch(/@media \(max-width: 600px\)[\s\S]*\.ltv-channelbar \.ltv-sheet-open\s*\{\s*display:\s*inline-flex/);
  });
  it('puts the paste form in the panel (or its own row), wide enough to fill it', () => {
    expect(paste).toMatch(/\.ltv-paste-input\s*\{[^}]*flex:\s*1 1 0/);
    expect(paste).not.toMatch(/ltv-header|margin-left:\s*auto/);
    expect(readFileSync(new URL('./factcheck/factCheck.css', import.meta.url), 'utf8')).toMatch(/\.fc-linkslot\s*\{[^}]*flex:\s*none/);
  });
});
