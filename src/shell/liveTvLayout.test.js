// F359/F366/F402: the page layout is CSS, so these read the stylesheets (node has no layout engine; the measured
// sizes are checked in a browser). From 1081px the channel bar is a full-width row, the video column is under it
// on the left and the fact-check panel column on the right; .ltv-main is the one scroll container. Below 1081px
// everything stacks.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('./liveTv.css', import.meta.url), 'utf8');
const panelCss = readFileSync(new URL('./factcheck/factCheck.css', import.meta.url), 'utf8');

// The body of the first rule that starts with `selector {` inside `source`.
const rule = (source, selector) => {
  const at = source.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf('}', at));
};
// The text of an @media block (up to its matching close).
const media = (source, query) => {
  const at = source.indexOf(`@media (${query}) {`);
  expect(at, query).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && (depth -= 1) === 0) return source.slice(at, i + 1);
  }
  return '';
};

const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '');
// The text of the block that opens at `marker` (up to its matching close).
const block = (source, marker) => {
  const at = source.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && (depth -= 1) === 0) return source.slice(at, i + 1);
  }
  return '';
};

describe('wide Live TV layout (from 1081px)', () => {
  const wide = media(page, 'min-width: 1081px');
  const supported = block(wide, '@supports (container-type: size)');
  const grid = rule(supported, '.ltv-grid.has-panel');
  it('has a full-width bar row of one fixed height, --ltv-bar-h, set on the page', () => {
    expect(rule(page, '\n.ltv-page')).toMatch(/--ltv-bar-h:\s*60px/);
    expect(rule(wide, '.ltv-barwrap')).toMatch(/height:\s*var\(--ltv-bar-h\)/);
    expect(rule(supported, '.ltv-grid.has-panel > .ltv-barwrap')).toMatch(/grid-column:\s*1 \/ -1;\s*grid-row:\s*1/);
    expect(grid).toMatch(/grid-template-rows:\s*var\(--ltv-bar-h\) auto auto auto/);
    // The bar's overlay opens over the panel: the row paints above the absolutely positioned panel.
    expect(rule(wide, '.ltv-barwrap')).toMatch(/position:\s*relative;\s*z-index:\s*6/);
  });
  it('is a grid with the panel: the body, split and video column dissolve into it, the video column left, the panel right', () => {
    expect(grid).toMatch(/display:\s*grid/);
    expect(rule(supported, '.ltv-grid.has-panel .ltv-body,\n    .ltv-grid.has-panel .ltv-split,\n    .ltv-grid.has-panel .ltv-videocol')).toMatch(/display:\s*contents/);
    expect(rule(supported, '.ltv-grid.has-panel .ltv-player-stage')).toMatch(/grid-column:\s*1;\s*grid-row:\s*2/);
    expect(rule(supported, '.ltv-grid.has-panel .ltv-nowplaying')).toMatch(/grid-column:\s*1;\s*grid-row:\s*3/);
    expect(rule(supported, '.ltv-grid.has-panel .ltv-lower')).toMatch(/grid-column:\s*1;\s*grid-row:\s*4/);
    expect(rule(supported, '.ltv-grid.has-panel .ltv-panelcol')).toMatch(/grid-column:\s*2;\s*grid-row:\s*2/);
    // The panel adds nothing to the rows: the column is 0 tall and the panel hangs from it.
    expect(rule(supported, '.ltv-grid.has-panel .ltv-panelcol')).toMatch(/height:\s*0/);
  });
  it('caps the left column so the video and the now-playing row fit in the window; the rest goes to the panel', () => {
    expect(grid).toMatch(/grid-template-columns:\s*minmax\(0, min\(calc\(100cqw - var\(--ltv-gap-x\) - var\(--ltv-panel-min\)\), var\(--ltv-video-max-w\)\)\) minmax\(0, 1fr\)/);
    expect(grid).toMatch(/--ltv-panel-min:\s*clamp\(440px, 40cqw, 640px\)/);
    const base = rule(supported, '.ltv-grid');
    expect(base).toMatch(/--ltv-video-h:\s*calc\(100cqh - var\(--ltv-bar-h\) - 2 \* var\(--ltv-gap-y\) - var\(--ltv-np-h\)\)/);
    expect(base).toMatch(/--ltv-video-max-w:\s*max\(360px, calc\(var\(--ltv-video-h\) \* 16 \/ 9\)\)/);
  });
  it('makes the panel as tall as the window from its top (the window, not the page), fixed, and not sticky', () => {
    expect(grid).toMatch(/--ltv-panel-h:\s*max\(320px, calc\(100cqh \+ 28px - var\(--ltv-bar-h\) - var\(--ltv-gap-y\)\)\)/);
    const r = rule(media(panelCss, 'min-width: 1081px'), '.ltv-panelcol > .fc-panel');
    expect(r).toMatch(/position:\s*absolute/);
    expect(r).toMatch(/height:\s*var\(--ltv-panel-h\)/);
    // The panel clips; the one scroll area is its .fc-body, between the fixed head and foot (F366 fix round).
    expect(r).toMatch(/overflow:\s*hidden/);
    expect(rule(page, '.ltv-panelcol')).toMatch(/position:\s*relative/);
  });
  it('is 16:9 and as wide as its column: the video fills the stage, which has no background or height of its own', () => {
    const video = rule(page, '.ltv-video-container');
    expect(video).toMatch(/width:\s*100%/);
    expect(video).toMatch(/aspect-ratio:\s*16 \/ 9/);
    expect(code(wide)).not.toMatch(/ltv-video-container/);
    // The stage is placed in the grid and nothing more: no background, size or aspect ratio.
    expect(rule(supported, '.ltv-grid.has-panel .ltv-player-stage')).not.toMatch(/background|width|height|aspect-ratio/);
    expect(rule(page, '.ltv-player-stage')).not.toMatch(/background|\bheight|aspect-ratio/);
    expect(code(page)).not.toMatch(/#05070d/);
  });
  it('scrolls only as a page: nothing in the wide block clips, scrolls or sticks, and the lower area has its natural height', () => {
    expect(rule(page, '.ltv-main')).toMatch(/overflow-y:\s*auto/);
    expect(code(wide)).not.toMatch(/overflow-y|overflow:\s*(auto|scroll|clip)|position:\s*sticky|max-height|\.ltv-lower\s*\{[^}]*(height|flex:)/);
    expect(code(wide)).not.toMatch(/\.ltv-lower \.ltv-deck-tabs/);
  });
  it('centres one 16:9 column of the same height cap without the panel, over the page background', () => {
    const r = rule(supported, '.ltv-split:not(.has-panel) .ltv-videocol');
    expect(r).toMatch(/width:\s*min\(100%, var\(--ltv-video-max-w\)\)/);
    expect(r).toMatch(/margin-inline:\s*auto/);
    // The link row and .ltv-main's 16px gaps sit above the video there (measured: without this the now-playing row
    // ended 12px below a 1590 x 840 window).
    expect(rule(supported, '.ltv-grid:not(.has-panel)')).toMatch(/--ltv-video-h:\s*calc\(100cqh - var\(--ltv-bar-h\) - 34px - 2 \* 16px/);
  });
});

describe('narrow Live TV layout (below 1081px)', () => {
  it('stacks: the grid exists only in the wide block, and the panel has its natural height', () => {
    const outside = code(page.replace(media(page, 'min-width: 1081px'), ''));
    expect(outside).not.toMatch(/--ltv-panel-min|--ltv-video-max-w|--ltv-panel-h|container:|cq[wh]/);
    expect(rule(page, '.ltv-grid')).toMatch(/display:\s*contents/);
    expect(rule(page, '.ltv-split')).toMatch(/flex-direction:\s*column/);
    expect(rule(panelCss, '.ltv-panelcol > .fc-panel')).toMatch(/max-height:\s*none/);
    expect(panelCss).toContain('@media (max-width: 1080px)');
  });
  it('has no leftover rule for the old 1100px breakpoint, the pinned layout or the short-window layout', () => {
    expect(code(page + panelCss)).not.toMatch(/1099px|1100px|\.ltv-main:has|ltvbody|@container|ltvmain \(|--ltv-above-split/);
    // The one size container from 1081px: .ltv-main. It measures the window for the video cap and the panel height.
    expect(code(page).match(/[{;]\s*container:/g)).toHaveLength(1);
  });
});

describe('the page sheet', () => {
  it('has no header strip left: no rule for it, its Back button, title or tagline', () => {
    expect(page + readFileSync(new URL('./liveTv/pasteLink.css', import.meta.url), 'utf8')).not.toMatch(/ltv-header|ltv-back-btn|ltv-titleblock|\.ltv-title|ltv-tagline/);
  });
  it('scrolls the page body as one at every width, the horizontal axis clipped', () => {
    expect(rule(page, '.ltv-main')).toMatch(/overflow-y:\s*auto/);
    expect(page).toMatch(/\.ltv-main\s*\{\s*overflow-x:\s*hidden/);
  });
  it('uses theme tokens for the page surfaces and defines no font family', () => {
    expect(rule(page, '.ltv-channelcard')).toMatch(/background:\s*var\(--panel\)/);
    expect(rule(page, '.ltv-main')).toMatch(/background:\s*var\(--bg\)/);
    expect(page + panelCss).not.toMatch(/fonts\.googleapis|@font-face/);
  });
});
