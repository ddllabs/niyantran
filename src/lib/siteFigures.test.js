import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { SITE_FIGURES, figure } from './siteFigures.js';
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
