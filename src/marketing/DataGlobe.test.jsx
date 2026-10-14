import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DataGlobe, { attachGlobe, globeSelectHandler } from './DataGlobe.jsx';

// F141 (owner 2026-10-14): one globe across the marketing site, behind one wrapper.
describe('DataGlobe', () => {
  it('renders the client globe inside its scene, with a pause control (WCAG 2.2.2)', () => {
    expect(renderToStaticMarkup(<DataGlobe />)).toBe(
      '<div class="nter-globe-scene"><nter-data-globe></nter-data-globe>'
      + '<button type="button" class="data-globe-pause" aria-label="Pause globe" aria-pressed="false" title="Pause globe">'
      + '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor"><path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z"></path></svg>'
      + '</button></div>',
    );
  });

  // Review (2026-10-14): the wiring the component runs on mount, which a static render never reaches.
  it('loads the globe module and listens for label picks until unmounted', () => {
    const calls = [];
    const el = {
      addEventListener: (type, fn) => calls.push(['add', type, fn]),
      removeEventListener: (type, fn) => calls.push(['remove', type, fn]),
    };
    let loaded = 0;
    const onSelect = () => {};
    const detach = attachGlobe(el, { onSelect, importGlobe: async () => { loaded += 1; } });
    expect(loaded).toBe(1);
    expect(calls).toEqual([['add', 'data-select', onSelect]]);
    detach();
    expect(calls).toEqual([['add', 'data-select', onSelect], ['remove', 'data-select', onSelect]]);
  });

  it('sends a label to its destination: signed out, it remembers it and asks to sign in', () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    let signIn = 0;
    const onSelect = globeSelectHandler({ storage, signedIn: () => false, onLogin: () => { signIn += 1; } });
    onSelect({ detail: { key: 'bills' } });
    expect(Object.fromEntries(store)).toEqual({ niyantranLand: 'national', niyantranFeature: 'Bill Passage Probability Index' });
    expect(signIn).toBe(1);
  });

  it('opens the page directly for a signed-in session, through the hash', () => {
    const go = [];
    const onSelect = globeSelectHandler({ storage: null, signedIn: () => true, onLogin: () => {}, setHash: (h) => go.push(h) });
    onSelect({ detail: { key: 'law' } });
    expect(go).toEqual(['#/law']);
  });

  it('is the only globe the homepage, sign-in, sign-up and pricing pages render', () => {
    for (const page of ['HomePage.jsx', 'LoginPage.jsx', 'SignupPage.jsx', 'PricingPage.jsx']) {
      const source = readFileSync(new URL(`./${page}`, import.meta.url), 'utf8');
      expect(source, page).toMatch(/<DataGlobe\b/);
      expect(source, page).not.toMatch(/AuthEarth|<nter-data-globe/);
    }
  });
});

// Browser check (2026-10-14): a slot rule that outranked Pricing's "hidden to 1024px", and sign-up's
// grid collapsing the square to 0px.
describe('globe slot styles', () => {
  const css = readFileSync(new URL('./marketing.css', import.meta.url), 'utf8');
  it('lets each page keep its own display rule, and gives sign-up a flex box', () => {
    expect(css).toMatch(/:where\(\.mkt-globe-slot\)\{display:flex/);
    expect(css).not.toMatch(/(^|\n)\.mkt-globe-slot\{display:/);
    expect(css).toContain('.mkt-signup-illustration.mkt-globe-slot{display:flex}');
    expect(css).toContain("@media (max-width: 1024px) {\n  .mkt-pr-earth { display: none; }");
  });
});

// F177 (owner 2026-10-14): Pricing's globe 10% larger and clear of the right edge; the homepage globe 5% larger;
// sign-in 10% and sign-up 5% smaller. "The globe" is the whole box: Earth, orbits, labels, pause control.
describe('globe position and sizes', () => {
  const css = readFileSync(new URL('./marketing.css', import.meta.url), 'utf8');
  const home = readFileSync(new URL('./homeHero.css', import.meta.url), 'utf8');
  const block = (source, start) => {
    const at = source.indexOf(start);
    return at < 0 ? '' : source.slice(at, source.indexOf('}', at) + 1);
  };

  it('makes the Pricing globe 10% larger and keeps it clear of the right edge where it shows', () => {
    const hero = block(css, '@media (min-width: 1025px) {\n  .mkt-pr-hero {');
    expect(hero).toContain('grid-template-columns: minmax(0, 1fr) calc(min(400px, 34vw) * 1.1);');
    expect(hero).toContain('box-sizing: border-box;\n    padding-inline-end: clamp(32px, 5vw, 96px);');
  });

  it('makes the homepage globe 5% larger at every width, centred on its column', () => {
    const column = block(home, '\n.nd-globe-column {');
    expect(column).toContain('width: 105%;');
    expect(column).toContain('max-width: calc(min(756px, 100svh - 144px) * 1.05);');
    expect(column).toContain('justify-self: center;');
    expect(column).not.toContain('margin-inline: auto');
    expect(home).toMatch(/@media \(max-width: 650px\) \{[^@]*\n {2}\.nd-globe-column \{ max-width: none; \}/);
  });

  it('makes the sign-in globe 10% and the sign-up globe 5% smaller in every layout, and leaves Pricing unscaled', () => {
    expect(css).toContain('.mkt-login-earth-visual{--globe-scale:.9}\n.mkt-signup-illustration{--globe-scale:.95}');
    expect(css).toContain('.mkt-globe-slot>.nter-globe-scene{flex:none;width:calc(93.75% * var(--globe-scale, 1));');
    expect(css).toContain('@container (max-width:439px){.mkt-globe-slot>.nter-globe-scene{width:calc(100% * var(--globe-scale, 1))}}');
    expect(css).toContain('.mkt-login-earth-visual.mkt-globe-slot>.nter-globe-scene{width:calc(min(156.25%, 100vw - 24px) * var(--globe-scale, 1))}');
    expect(css).toContain('.mkt-signup-illustration.mkt-globe-slot>.nter-globe-scene{width:calc(min(156.25%, 100vw - 24px) * var(--globe-scale, 1))}');
    expect(css).toContain('.mkt-pr-earth.mkt-globe-slot>.nter-globe-scene{width:100%}');
    expect(css.match(/--globe-scale:/g)).toHaveLength(2);
  });
});
