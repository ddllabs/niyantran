import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/marketingIntroVideo.js', () => ({ emptyIntroVideo: () => ({ enabled: false }), fetchIntroVideo: async () => ({}), videoPlayback: () => ({ kind: 'none' }) }));
vi.mock('./SegmentCarousel.jsx', () => ({ default: () => <section id="coverage" /> }));
vi.mock('./NterLatestRail.jsx', () => ({ default: () => null }));
vi.mock('./BillAiDropDemo.jsx', () => ({ default: () => null }));

// F140 (client design, owner 2026-10-13): the design's hero, our figures and the globe with seven data
// labels. F212 (owner 2026-10-16): the persona column and the coverage box from the reference v5.
describe('homepage hero', () => {
  let html = '';
  let hero = '';
  beforeAll(async () => {
    const { default: HomePage } = await import('./HomePage.jsx');
    html = renderToStaticMarkup(<HomePage onLogin={() => {}} onCoverage={() => {}} onPricing={() => {}} />);
    hero = html.slice(html.indexOf('nd-hero-shell'), html.indexOf('mkt-ai-demo'));
  });

  it('shows the design copy, with the headline coloured as the design', () => {
    expect(hero).toContain('THE RESEARCH TERMINAL');
    expect(hero).toMatch(/The intelligence<br\/> layer for <span class="nd-blue">Government,<\/span><br\/><span class="nd-purple">Policy<\/span> &amp;<br\/>Global Affairs<span class="nd-red">\.<\/span>/);
    expect(hero).toContain('See what a record touches —<br/>before you argue about it.');
    expect(hero).toMatch(/Open the terminal <span aria-hidden="true">↗<\/span>/);
    expect(hero).toContain('See plans');
    expect(hero).toContain('View data coverage');
  });

  // F212 (client reference top section v5, owner 2026-10-16): the three figures under the copy became the
  // coverage box under the hero: seven figures, every one from our own sources, and no date line.
  it('shows the seven coverage figures from our own sources, in the reference order', async () => {
    const { SITE_FIGURES } = await import('../lib/siteFigures.js');
    const PREVIEW = (await import('../data/preview-figures.json')).default;
    const box = hero.slice(hero.indexOf('nd-coverage-box'));
    expect(box).toContain('THE RECORD, AT A GLANCE');
    const cells = [...box.matchAll(/<div><strong>(.*?)<\/strong><span>(.*?)<\/span><\/div>/g)].map((m) => [m[1], m[2]]);
    expect(cells).toEqual([
      ['9,817', 'Bills on record'],
      [String(SITE_FIGURES.modules), 'Research modules'],
      [String(SITE_FIGURES.endpoints), 'Source endpoints'],
      [String(SITE_FIGURES.desks), 'Intelligence desks'],
      [String(SITE_FIGURES.ministries), 'Ministries'],
      [String(PREVIEW.bills.houses), 'Houses covered'],
      [String(PREVIEW.bills.seriesStart), 'Coverage since'],
    ]);
    expect(box).not.toMatch(/snapshot ·|14 Oct 2026/i);
    expect(hero).not.toContain('nd-metrics');
    expect(hero).not.toContain('200+');
  });

  it('renders the orbiting globe, and no longer the persona chips or the old scene', () => {
    expect(hero).toMatch(/<div class="nter-globe-scene"><nter-data-globe/);
    expect(html).not.toContain('mkt-pchip');
    expect(html).not.toContain('mkt-hero-scene');
    expect(html).not.toContain('SYS/READY');
  });

  it('has no mouse-follow effect', () => {
    const source = readFileSync(new URL('./HomePage.jsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/onMouseMove|onHeroMove|--px|--mx/);
  });

  // F212: the "Curated for" strip moved into the hero as its third column; its explore links still open
  // the personas section.
  it('puts the persona column in the hero after the globe, and drops the strip below it', () => {
    const grid = hero.slice(hero.indexOf('nd-hero nd-container'));
    expect(grid.indexOf('nd-globe-column')).toBeGreaterThan(-1);
    expect(grid.indexOf('nd-persona-column')).toBeGreaterThan(grid.indexOf('nd-globe-column'));
    expect(grid.indexOf('nd-coverage-box')).toBeGreaterThan(grid.indexOf('nd-persona-column'));
    expect(html).not.toContain('nd-curated');
    expect(html.match(/data-persona="/g)).toHaveLength(6);
    expect(html).toMatch(/<section class="mkt-personas" id="personas"/);
  });

  // F212: the persona cards take focus inside the hero shell, whose globe glow reaches past its edge. With
  // overflow: hidden a focused card scrolled the shell sideways on a phone (measured 20 px at 375 px);
  // clip hides the glow the same way but cannot be scrolled.
  it('clips the hero shell so a focused persona card cannot scroll it sideways', () => {
    const css = readFileSync(new URL('./homeHero.css', import.meta.url), 'utf8');
    const shell = [...css.matchAll(/^\.nd-hero-shell \{([^}]*)\}/gm)].map((m) => m[1]).join('');
    // hidden first only for browsers without clip (Safari before 16); the last declaration wins.
    expect(shell.match(/overflow: (\w+);/g).at(-1)).toBe('overflow: clip;');
  });

  // F145: the walkthrough backdrop was a 34 MB animated GIF loaded with the page; it is now a small
  // still that loads when scrolled near, keeping the slow CSS spin.
  it('backs the walkthrough with a small lazy still, not the 34 MB GIF', async () => {
    const { statSync } = await import('node:fs');
    expect(html).not.toContain('globe.gif');
    const bg = html.match(/<span class="mkt-walk-video-bg"[^>]*>(.*?)<\/span>/)[1];
    expect(bg).toMatch(/<img src="\/brand\/walkthrough-globe\.webp" alt="" loading="lazy" decoding="async"\/>/);
    expect(statSync(new URL('../../public/brand/walkthrough-globe.webp', import.meta.url)).size).toBeLessThan(40 * 1024);
  });
});

