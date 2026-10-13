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
    for (const stale of ['9,819', '4,576', '211+', '99.9%', 'UPTIME', 'Live API Endpoints']) expect(source, `${file}: ${stale}`).not.toContain(stale);
    expect(source, file).toContain('SITE_FIGURES');
  }
});

// F140 (owner 2026-10-13): the design's "200+ authoritative sources" shows the seed source count: the
// unique source endpoint URLs in the source registry. The constant keeps the 242 KB registry out of the
// homepage bundle; this recount fails the moment the two drift apart.
it('counts source endpoints from the source registry', () => {
  const registry = JSON.parse(readFileSync(new URL('../data/source-registry.json', import.meta.url), 'utf8'));
  expect(SITE_FIGURES.endpoints).toBe(registryEndpointCount(registry));
  expect(SITE_FIGURES.endpoints).toBeGreaterThan(200);
});

it('counts each endpoint URL once, across the pipe-separated source lists', () => {
  expect(registryEndpointCount([
    { sourceUrls: 'https://a.example/rss | https://b.example/api' },
    { sourceUrls: 'https://a.example/rss' },
    { sourceUrls: '' },
    {},
  ])).toBe(2);
});
