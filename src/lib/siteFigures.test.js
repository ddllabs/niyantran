import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { SITE_FIGURES, figure, registryEndpointCount } from './siteFigures.js';
import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';

it('starts from the build-time snapshot where it counts the same thing, and from nothing where it does not', () => {
  expect(SITE_FIGURES.bills).toBe(9817);
  expect(SITE_FIGURES.fronts).toBe(88);
  // No build-time source: shown as a dash until the live count arrives, never as an old number.
  expect(SITE_FIGURES.documents).toBeNull();
  expect(SITE_FIGURES.ministries).toBeNull();
  expect(SITE_FIGURES.modules).toBe(DESK_CATALOGUE.length);
  expect(figure(SITE_FIGURES.bills)).toBe('9,817');
  expect(figure(null)).toBe('\u2014');
  expect(figure(undefined)).toBe('\u2014');
});

// F212: the hero's "Intelligence desks" is the desk count pricing and the proof card already use (F30).
it('counts intelligence desks from the catalogue, one per desk tab', () => {
  expect(SITE_FIGURES.desks).toBe(new Set(DESK_CATALOGUE.map((m) => m.tab)).size);
  expect(SITE_FIGURES.desks).toBe(8);
});

it('leaves no hand-typed bill, endpoint or uptime figures on the homepage and pricing page', () => {
  for (const file of ['HomePage.jsx', 'PricingPage.jsx']) {
    const source = readFileSync(new URL(`../marketing/${file}`, import.meta.url), 'utf8');
    for (const stale of ['9,819', '4,576', '211+', '99.9%', 'UPTIME', 'Live API Endpoints', "'48'", '200+', 'Authoritative Sources']) expect(source, `${file}: ${stale}`).not.toContain(stale);
    // F142: the figures come through the live hook (measured first, then the database counts).
    expect(source, file).toContain('useSiteFigures()');
    expect(source, file).not.toMatch(/SITE_FIGURES\./);
  }
});

// F140 (owner 2026-10-13): the design's "200+ authoritative sources" shows the seed source count: the
// unique source endpoint URLs in the source registry. The constant keeps the 242 KB registry out of the
// homepage bundle; this recount fails the moment the two drift apart.
it('counts source endpoints from the source registry', () => {
  const registry = JSON.parse(readFileSync(new URL('../data/source-registry.json', import.meta.url), 'utf8'));
  // The published figure is the registry's own count, rebuilt into preview-figures.json
  // (scripts/build-preview-figures.mjs); it was a hand-kept 246 until the audit of 2026-11-21.
  expect(SITE_FIGURES.endpoints).toBe(registryEndpointCount(registry));
  expect(SITE_FIGURES.endpoints).not.toBe(246);
});

it('counts each endpoint URL once, across newline- or pipe-separated source lists', () => {
  expect(registryEndpointCount([
    { sourceUrls: 'https://a.example/rss | https://b.example/api' },
    { sourceUrls: 'https://b.example/api\nhttps://c.example/feed' },
    { sourceUrls: 'https://a.example/rss' },
    { sourceUrls: '' },
    {},
  ])).toBe(3);
});

it('public figures do not statically depend on terminal column schemas or the full feature map', () => {
  const seen = new Set();
  function visit(url) {
    if (seen.has(url.href) || !/\.(js|jsx|json)$/.test(url.pathname)) return;
    seen.add(url.href);
    const source = readFileSync(url, 'utf8');
    if (url.pathname.endsWith('.json')) return;
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) visit(new URL(match[1], url));
  }
  visit(new URL('../App.jsx', import.meta.url));
  expect([...seen].some(p=>p.endsWith('/columns.js'))).toBe(false);
  expect([...seen].some(p=>p.endsWith('/html-feature-map.json'))).toBe(false);
});
