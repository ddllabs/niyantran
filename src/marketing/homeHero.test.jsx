import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/marketingIntroVideo.js', () => ({ emptyIntroVideo: () => ({ enabled: false }), fetchIntroVideo: async () => ({}), videoPlayback: () => ({ kind: 'none' }) }));
vi.mock('./SegmentCarousel.jsx', () => ({ default: () => <section id="coverage" /> }));
vi.mock('./NterLatestRail.jsx', () => ({ default: () => null }));
vi.mock('./BillAiDropDemo.jsx', () => ({ default: () => null }));

// F140 (client design, owner 2026-10-13): the design's hero, our figures, the globe with seven data
// labels, and the "Curated for" strip of our six personas.
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

  it('shows our measured figures, not the design placeholders', async () => {
    const { SITE_FIGURES } = await import('../lib/siteFigures.js');
    expect(hero).toContain('<strong>9,817</strong><span>Bills on record</span>');
    expect(hero).toContain(`<strong>${SITE_FIGURES.modules}</strong><span>Research modules</span>`);
    expect(hero).toContain(`<strong>${SITE_FIGURES.endpoints}</strong><span>Source endpoints</span>`);
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

  it('lists the six personas in the Curated for strip, each opening the personas section', () => {
    const strip = html.slice(html.indexOf('nd-curated'), html.indexOf('mkt-ai-demo'));
    const names = [...strip.matchAll(/<a href="#personas">.*?<\/span><span>(.*?)<\/span><\/a>/g)].map((m) => m[1].replace(/<br\/>/g, ' '));
    expect(names).toEqual(['Policy Analysts', 'Journalists', 'UPSC Aspirants', 'Corporate Affairs', 'Legal Researchers', 'Academics']);
    expect(html).toMatch(/<section class="mkt-personas" id="personas"/);
  });
});
