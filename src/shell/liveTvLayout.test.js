// F359/F366: the page layout is CSS, so these read the stylesheets (node has no layout engine; the measured
// heights are checked in a browser). From 1081px the video column is on the left and the fact-check panel
// column on the right, 440px wide and exactly as tall as the video column (the panel fills it and scrolls
// inside, so it never makes the page taller); below 1081px everything stacks.
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

describe('wide Live TV layout (from 1081px)', () => {
  const wide = media(page, 'min-width: 1081px');
  it('puts the video column left and a 440px panel column right, equal height', () => {
    const r = rule(wide, '.ltv-split.has-panel');
    expect(r).toMatch(/display:\s*grid/);
    expect(r).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 440px/);
    expect(r).toMatch(/align-items:\s*stretch/);
  });
  it('gives the panel column no height of its own: the panel fills it, so the video column sets the height', () => {
    expect(rule(page, '.ltv-panelcol')).toMatch(/position:\s*relative/);
    const r = rule(media(panelCss, 'min-width: 1081px'), '.ltv-panelcol > .fc-panel');
    expect(r).toMatch(/position:\s*absolute/);
    expect(r).toMatch(/inset:\s*0/);
    // The panel clips; the one scroll area is its .fc-body, between the fixed head and foot (F366 fix round).
    expect(r).toMatch(/overflow:\s*hidden/);
    expect(r).not.toMatch(/\bheight:/);
    expect(r).not.toMatch(/min-height:\s*[1-9]/);
  });
});

describe('narrow Live TV layout (below 1081px)', () => {
  it('stacks: the grid exists only in the wide block, and the panel has its natural height', () => {
    const outside = page.replace(media(page, 'min-width: 1081px'), '');
    expect(outside).not.toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 440px/);
    expect(rule(page, '.ltv-split')).toMatch(/flex-direction:\s*column/);
    expect(rule(panelCss, '.ltv-panelcol > .fc-panel')).toMatch(/max-height:\s*none/);
    expect(panelCss).toContain('@media (max-width: 1080px)');
  });
  it('has no leftover rule for the old 1100px breakpoint or the old page body scroller', () => {
    expect(page + panelCss).not.toMatch(/1099px|1100px|\.ltv-main:has/);
    // The size containers from 1081px (F387): .ltv-main (the height gate) and, when pinned, .ltv-body. Nothing else.
    expect(page.match(/[{;]\s*container:/g)).toHaveLength(2);
  });
});

describe('the page sheet', () => {
  it('has no header strip left: no rule for it, its Back button, title or tagline', () => {
    expect(page + readFileSync(new URL('./liveTv/pasteLink.css', import.meta.url), 'utf8')).not.toMatch(/ltv-header|ltv-back-btn|ltv-titleblock|\.ltv-title|ltv-tagline/);
  });
  it('scrolls the page body as one below 1081px; from 1081px only the lower area scrolls (the pinned layout)', () => {
    expect(rule(page, '.ltv-main')).toMatch(/overflow-y:\s*auto/);
    const wide = media(page, 'min-width: 1081px');
    expect(rule(wide.slice(wide.indexOf('@supports')), '.ltv-body')).toMatch(/overflow:\s*clip/);
    expect(rule(wide.slice(wide.indexOf('@container ltvmain (min-height: 520px)')), '.ltv-lower')).toMatch(/overflow-y:\s*auto/);
  });
  it('uses theme tokens for the page surfaces and defines no font family', () => {
    expect(rule(page, '.ltv-channelcard')).toMatch(/background:\s*var\(--panel\)/);
    expect(rule(page, '.ltv-main')).toMatch(/background:\s*var\(--bg\)/);
    expect(page + panelCss).not.toMatch(/fonts\.googleapis|@font-face/);
  });
});
