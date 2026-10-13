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

it('reads credits from the shared store and keeps the panel free of dollars', () => {
  const panel = read('./PlanBilling.jsx');
  expect(panel).toMatch(/from '\.\.\/lib\/creditsStore\.js'/);
  for (const name of ['refreshCredits', 'serverCredits', 'subscribeCredits', 'formatCredits', 'rupeeHint']) expect(panel).toContain(name);
  expect(panel).not.toMatch(/USD|dollar|\$\d/i);
});

it('prefixes every new credits style with plan-credits and adds no dollar', () => {
  const css = read('./upgrade.css');
  const start = css.indexOf('/* AI credits');
  expect(start).toBeGreaterThan(-1);
  const block = css.slice(start);
  expect(block).toContain('.plan-credits');
  const selectors = block.match(/\.[a-z][\w-]*/g) || [];
  expect(selectors.filter(s => !s.startsWith('.plan-credits') && !/^\.\d/.test(s))).toEqual([]);
  expect(block).not.toMatch(/USD|dollar|\$/i);
});
