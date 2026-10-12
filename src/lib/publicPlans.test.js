import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { PUBLIC_PLANS, PRICING_COMPARE, PRICING_NOTES, purchaseKind } from './publicPlans.js';

it('offers the owner plans in rupees per month', () => {
  expect(PUBLIC_PLANS.map(p => [p.name, p.monthly])).toEqual([['FREE', 0], ['PLUS', 399], ['PRO', 999], ['MAX', 9999]]);
  expect(PUBLIC_PLANS.every(p => p.unit === '/month')).toBe(true);
});

it('shows Niyantran AI as coming soon on Pro and Max only', () => {
  const soon = PUBLIC_PLANS.filter(p => p.items.includes('Niyantran AI is coming soon')).map(p => p.name);
  expect(soon).toEqual(['PRO', 'MAX']);
});

it('compares only what the product offers, and states no GST and undefined credits honestly', () => {
  const rows = PRICING_COMPARE.map(r => r[0]);
  for (const missing of ['API Access', 'Team Collaboration', 'Custom Dashboards', 'Deployment']) expect(rows).not.toContain(missing);
  expect(PRICING_COMPARE.find(r => r[0] === 'Price per month').slice(1)).toEqual(['₹0', '₹399', '₹999', '₹9,999']);
  const facts = PRICING_NOTES.map(n => `${n.title} ${n.text}`).join(' ');
  expect(PRICING_NOTES.every(n => n.title && n.text && n.tone && n.icon)).toBe(true);
  expect(facts).toMatch(/not registered under GST/i);
  expect(facts).toMatch(/monthly/i);
  expect(facts).toMatch(/credit/i);
});

it('renders rupee prices without dollars, yearly billing or the old government plan', () => {
  const page = readFileSync(new URL('../marketing/PricingPage.jsx', import.meta.url), 'utf8');
  expect(page).toContain('PUBLIC_PLANS');
  expect(page).not.toContain('`$${');
  expect(page).not.toContain('Pay Yearly');
  expect(page).not.toContain("goPlan('gov')");
  expect(page).not.toContain('GOVERNMENT');
});

it('shows the shared photographic globe in the pricing header, not the flat globe image', () => {
  const page = readFileSync(new URL('../marketing/PricingPage.jsx', import.meta.url), 'utf8');
  const hero = page.slice(page.indexOf('mkt-pr-hero'), page.indexOf('mkt-pr-facts'));
  expect(hero).toContain('<AuthEarth labels={false} />');
  expect(page).not.toContain('/brand/globe.png');
  expect(page).not.toContain('mkt-pr-globe-wrap');
});

it('presents the billing facts as styled chips, not a bordered paragraph box', () => {
  const page = readFileSync(new URL('../marketing/PricingPage.jsx', import.meta.url), 'utf8');
  expect(page).toContain('mkt-pr-facts');
  expect(page).not.toContain('mkt-pr-notes');
});

it('allows upgrades and renewals while a plan is active, never a lower plan (owner, F110)', () => {
  expect(purchaseKind({ plan: 'free', status: 'free' }, 'plus')).toBe('choose');
  expect(purchaseKind({ plan: 'pro', status: 'active' }, 'max')).toBe('upgrade');
  expect(purchaseKind({ plan: 'pro', status: 'active' }, 'pro')).toBe('renew');
  expect(purchaseKind({ plan: 'pro', status: 'active' }, 'plus')).toBe('blocked');
  expect(purchaseKind({ plan: 'max', status: 'free' }, 'plus')).toBe('choose');
  expect(purchaseKind({ plan: 'pro', status: 'active' }, 'free')).toBe('blocked');
  expect(purchaseKind(null, 'enterprise')).toBe('blocked');
});
