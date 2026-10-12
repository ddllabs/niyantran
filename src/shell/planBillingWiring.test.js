import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

it('opens Plan & billing from the profile menu and from a pricing hand-off', () => {
  const shell = read('./TerminalShell.jsx');
  expect(shell).toContain('Plan &amp; billing');
  expect(shell).toContain('<PlanBilling');
  expect(shell).toContain("sessionStorage.getItem('niyOpenBilling')");
});

it("sends a signed-in visitor's pricing choice to the panel instead of signup", () => {
  const site = read('../marketing/MarketingSite.jsx');
  expect(site).toContain("sessionStorage.setItem('niyOpenBilling'");
  const pricing = read('../marketing/PricingPage.jsx');
  expect(pricing).toContain('goPlan(p.id)');
});
