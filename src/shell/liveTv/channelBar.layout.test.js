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
  it('makes the strip tiles 40px tall with a 28px tag, in the bar\'s own stylesheet and not in the overlay', () => {
    expect(rule(css, '.ltv-channelbar .ltv-strip .ltv-channel-chip')).toMatch(/min-height:\s*40px/);
    expect(rule(css, '.ltv-channelbar .ltv-strip .ltv-chip-tag')).toMatch(/width:\s*28px;\s*height:\s*28px/);
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
