// F402 task A: from 1081px the channel bar is one row inside the page's 60px box. The stylesheet is read as text
// (the measured heights are checked in a browser), so these pin the rules that keep it from wrapping.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./channelBar.css', import.meta.url), 'utf8');
const media = (query) => {
  const at = css.indexOf(`@media ${query} {`);
  expect(at, query).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && (depth -= 1) === 0) return css.slice(at, i + 1);
  }
  return '';
};
const rule = (source, selector) => {
  const at = source.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf('}', at));
};

describe('the channel bar from 1081px', () => {
  const wide = media('(min-width: 1081px)');
  it('fills the page\'s 60px box, border included, with no vertical padding', () => {
    const bar = rule(wide, '.ltv-channelcard.ltv-channelbar');
    expect(bar).toMatch(/box-sizing:\s*border-box/);
    expect(bar).toMatch(/height:\s*var\(--ltv-bar-h,\s*60px\)/);
    // The card is a column by default; centring in a column kept the content at its full width (2,581px).
    expect(bar).toMatch(/flex-direction:\s*row/);
    expect(bar).toMatch(/padding:\s*0 12px/);
  });
  it('lays the two groups of controls in one row that never wraps', () => {
    const rows = rule(wide, '.ltv-channelbar .ltv-bar-rows');
    expect(rows).toMatch(/flex-direction:\s*row/);
    expect(rows).toMatch(/flex-wrap:\s*nowrap/);
    expect(rule(wide, '.ltv-channelbar .ltv-row')).toMatch(/flex-wrap:\s*nowrap/);
    expect(wide).not.toMatch(/flex-wrap:\s*wrap\b/);
  });
  it('drops the second row\'s divider and lets the strip give way', () => {
    expect(rule(wide, '.ltv-channelbar .ltv-seg-row')).toMatch(/border-top:\s*0/);
    expect(rule(wide, '.ltv-channelbar .ltv-strip-wrap')).toMatch(/flex:\s*1 1 0/);
  });
  it('makes the strip tiles 40px tall with a 28px tag, only from 1081px (phones and tablets keep the page\'s tiles)', () => {
    expect(rule(wide, '.ltv-channelbar .ltv-strip .ltv-channel-chip')).toMatch(/min-height:\s*40px/);
    expect(rule(wide, '.ltv-channelbar .ltv-strip .ltv-chip-tag')).toMatch(/width:\s*28px;\s*height:\s*28px/);
    expect(rule(wide, '.ltv-channelbar .ltv-strip .ltv-chip-name')).toMatch(/max-width:\s*120px/);
    // Outside the wide block there is no strip-tile rule at all: it would override the 480px and 360px name widths.
    expect(css.replace(wide, '').replace(media('(min-width: 1081px) and (pointer: fine)'), '')).not.toMatch(/\.ltv-strip \.ltv-(channel-chip|chip-)/);
  });
  it('keeps the compact Segments button and arrows (36px, 32px) to a wide window with a fine pointer', () => {
    const fine = media('(min-width: 1081px) and (pointer: fine)');
    expect(rule(fine, '.ltv-channelbar .ltv-seg-open')).toMatch(/min-height:\s*36px/);
    expect(rule(fine, '.ltv-channelbar .ltv-strip-arrows .ltv-arrow')).toMatch(/width:\s*32px;\s*height:\s*32px/);
    // Elsewhere the page's 40px touch rule applies: nothing outside the fine block sets these sizes.
    const rest = css.replace(fine, '');
    expect(rest).not.toMatch(/\.ltv-seg-open\s*\{[^}]*min-height:\s*3\d/);
    expect(rest).not.toMatch(/\.ltv-arrow\s*\{[^}]*(width|height):\s*3\d/);
    // 40px controls still fit the 60px bar: no vertical padding, content centred.
    expect(rule(wide, '.ltv-channelcard.ltv-channelbar')).toMatch(/padding:\s*0 12px/);
  });
  it('turns the Segments caret over while the overlay is open, with the motion only when allowed', () => {
    expect(rule(css, ".ltv-seg-open[aria-expanded='true'] .ltv-seg-caret")).toMatch(/rotate\(180deg\)/);
    expect(media('(prefers-reduced-motion: no-preference)')).toMatch(/\.ltv-seg-caret[^}]*transition/);
  });
});

describe('the channel bar below 1081px', () => {
  it('keeps the wrapping column layout outside the wide block', () => {
    expect(rule(css, '.ltv-bar-rows')).toMatch(/flex-direction:\s*column/);
    expect(rule(css, '.ltv-channelbar .ltv-row')).toMatch(/flex-wrap:\s*wrap/);
  });
  it('keeps the phone sheet\'s rules: the segment row is hidden up to 600px', () => {
    // Two classes: a lone .ltv-seg-row lost to .ltv-row { display: flex } (measured: the row showed on a 375px phone).
    expect(rule(media('(max-width: 600px)'), '.ltv-channelbar .ltv-seg-row')).toMatch(/display:\s*none/);
  });
});
