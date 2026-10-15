// F203 (owner 2026-10-16): module pages that could not scroll, were cut off at the bottom, the top or
// the right, and category menus that switched under the pointer. Measured on all 120 desk modules
// (docs/specs/2026-10-16-module-scroll.md).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { menuSwitchDelay, SWITCH_DELAY_MS } from './DeskNav.jsx';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const nav = readFileSync(new URL('./DeskNav.jsx', import.meta.url), 'utf8');

describe('the module area', () => {
  it('cannot be scrolled, even by focus, so nothing is ever shifted out of reach', () => {
    expect(css).toMatch(/\n\.main-col \{ overflow: clip; background: var\(--panel\); \}/);
  });

  it('fits a National panel to the area, padding included, so its bottom is reachable', () => {
    expect(css).toMatch(/\.nat-panel \{\s*box-sizing: border-box;\s*padding: 12px 16px 24px;\s*min-height: 0;\s*height: 100%;\s*overflow: auto;/);
  });

  it('makes a hand-built page\'s wrapper its scroller', () => {
    expect(css).toMatch(/\.desk > \.alliances-wrap \{ height: 100%; min-height: 0; box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; \}/);
  });

  it('lays the Alliances desk out by its own width, so the feed bar and tools fit beside the map', () => {
    expect(css).toMatch(/\.alw-desk \{[^}]*container-type: inline-size;/);
    const narrow = css.slice(css.indexOf('@container (max-width: 720px)'));
    expect(narrow).toMatch(/^@container \(max-width: 720px\) \{\s*\.alw-feedbar, \.alw-feedtools \{ grid-template-columns: minmax\(0, 1fr\); \}\s*\.alw-feedstats \{ flex-wrap: wrap; \}/);
  });
});

describe('the category menus', () => {
  it('open at once from nothing, and switch to another tab only after the pointer rests there', () => {
    expect(menuSwitchDelay(null, 'Electoral Data & Analytics')).toBe(0);
    expect(menuSwitchDelay('Electoral Data & Analytics', 'Electoral Data & Analytics')).toBe(0);
    expect(menuSwitchDelay('Electoral Data & Analytics', 'Representative & Media Intelligence')).toBe(SWITCH_DELAY_MS);
    expect(SWITCH_DELAY_MS).toBe(160);
  });

  it('cancel a pending switch when the pointer leaves that tab, and follow the tab when the row scrolls', () => {
    expect(nav).toMatch(/onMouseEnter=\{\(\) => enterMenu\(b\.label\)\}/);
    expect(nav).toMatch(/function enterMenu\(label\) \{\s*clearTimeout\(switchTimer\.current\);\s*const wait = menuSwitchDelay\(open, label\);/);
    expect(nav).toMatch(/onMouseLeave=\{\(\) => \{ clearTimeout\(switchTimer\.current\); hideMenuSoon\(\); \}\}/);
    expect(nav).toMatch(/window\.addEventListener\('resize', place\);\s*anchor\.closest\('\.desktabs'\)\?\.addEventListener\('scroll', place, \{ passive: true \}\);/);
  });
});
