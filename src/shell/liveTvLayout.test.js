// F359: the wide layout is CSS, so these read the stylesheet (node has no layout engine; the measured
// heights are checked in a browser). From 1100px the fact-check panel is exactly the VISIBLE height of
// the page body minus its margins, stays in view while the left column scrolls, and has the same height
// in every state; below 1100px the layout stacks as before.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./factcheck/factCheck.css', import.meta.url), 'utf8');
const wide = css.slice(css.indexOf('@media (min-width: 1100px)'), css.indexOf('.fc-head {'));
const rule = (selector) => {
  const at = wide.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return wide.slice(at, wide.indexOf('}', at));
};

describe('wide Live TV layout (from 1100px)', () => {
  const body = '.ltv-body:has(> .fc-panel)';
  const panel = '.ltv-body:has(> .fc-panel) > .fc-panel';

  it('makes the page body a size container, so the panel can follow its visible height', () => {
    expect(rule(body)).toMatch(/container-type:\s*size/);
  });
  it('sizes the panel to the container height minus its 16px margins, stuck to the top while the left column scrolls', () => {
    const r = rule(panel);
    expect(r).toMatch(/position:\s*sticky/);
    expect(r).toMatch(/top:\s*16px/);
    expect(r).toMatch(/align-self:\s*start/);
    expect(r).toMatch(/height:\s*calc\(100cqh - 32px\)/);
    expect(r).toMatch(/margin:\s*16px 18px 16px 12px/);
    expect(r).toMatch(/min-height:\s*0/);
    expect(r).toMatch(/overflow-y:\s*auto/);
  });
  it('lets no content, and no fixed minimum, set the panel height', () => {
    const r = rule(panel);
    expect(r).not.toMatch(/contain:\s*size/);
    expect(r).not.toMatch(/min-height:\s*[1-9]/);
    expect(r).not.toMatch(/\bmax-height:\s*(?!none)/);
  });
  it('keeps the player and the tabs in the left column and the panel in the right', () => {
    expect(wide).toMatch(/> \.ltv-player-stage \{ grid-column: 1; grid-row: 1; \}/);
    expect(wide).toMatch(/> \.ltv-tab-content \{ grid-column: 1; grid-row: 3; \}/);
    expect(rule(panel)).toMatch(/grid-column:\s*2;\s*grid-row:\s*1 \/ -1/);
  });
});

describe('narrow Live TV layout (below 1100px)', () => {
  it('stacks: the container type and the grid exist only in the wide block', () => {
    const narrow = css.slice(0, css.indexOf('@media (min-width: 1100px)'));
    expect(narrow).not.toContain('container-type');
    expect(narrow).not.toContain('display: grid');
    expect(narrow).toContain('@media (max-width: 1099px)');
  });
});

describe('the page sheet', () => {
  const page = readFileSync(new URL('./liveTv.css', import.meta.url), 'utf8');
  it('styles the heading, not a strong element', () => {
    expect(page).toMatch(/\.ltv-header-brand \.ltv-title\s*\{[^}]*margin:\s*0/);
    expect(page).not.toContain('.ltv-header-brand strong');
  });
});
