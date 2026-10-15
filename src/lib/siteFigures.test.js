import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { SITE_FIGURES, figure, registryEndpointCount } from './siteFigures.js';
import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';

it('uses measured counts: bills and documents from the live query, modules from the catalogue', () => {
  expect(SITE_FIGURES.bills).toBe(9817);
  expect(SITE_FIGURES.documents).toBe(3431);
  expect(SITE_FIGURES.modules).toBe(DESK_CATALOGUE.length);
  expect(figure(SITE_FIGURES.bills)).toBe('9,817');
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
  // The registry counted 115 after F180, 120 after F196 batch 1 (three State news searches, three Manifold
  // searches for one Google News address) and 121 after batch 2 (the RBI handbook's listing; the RBI press
  // RSS moved from State Fiscal Deep-Dive to the SDL auctions); the published 246 is the owner's figure
  // until they decide.
  expect(registryEndpointCount(registry)).toBe(121);
  expect(SITE_FIGURES.endpoints).toBe(246);
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
