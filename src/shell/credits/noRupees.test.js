import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// F184 (owner 2026-10-15): "The user is only buying credits and spending credits." No credit amount
// is converted to rupees anywhere in the credits UI, the chat's balance or the CSV export. Plan
// prices and invoice totals stay in rupees; they come from publicPlans.js and the invoice API.
const dir = (rel) => readdirSync(new URL(rel, import.meta.url))
  .filter((f) => /\.(jsx?|css)$/.test(f) && !f.includes('.test.'))
  .map((f) => `${rel}${f}`);
const FILES = [
  ...dir('./'),
  ...dir('../usage/'),
  '../PlanBilling.jsx',
  '../../ai/CreditBalance.jsx',
  '../../lib/creditsStore.js',
  '../../lib/creditUsage.js',
  '../../lib/usageCsv.js',
];

describe('credits are never shown in rupees', () => {
  it.each(FILES)('%s has no rupee conversion', (rel) => {
    const source = readFileSync(new URL(rel, import.meta.url), 'utf8');
    // F225 validates the server's denomination metadata; it never converts a
    // displayed credit balance into money. Permit that single read only.
    const displaySource = rel === '../../lib/creditsStore.js'
      ? source.replace('const rate = num(data?.inr_per_credit);', '') : source;
    expect(displaySource).not.toMatch(/rupeeHint|inrPerCredit|inr_per_credit|₹|Rupees/);
  });
});
