import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DataGlobe, { globeSelectHandler } from './DataGlobe.jsx';

// F141 (owner 2026-10-14): one globe across the marketing site, behind one wrapper.
describe('DataGlobe', () => {
  it('renders the client globe inside its scene', () => {
    expect(renderToStaticMarkup(<DataGlobe />)).toBe('<div class="nter-globe-scene"><nter-data-globe></nter-data-globe></div>');
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
