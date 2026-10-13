import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DEFAULT_PRIVACY } from './privacyStore.js';
import { DEFAULT_TERMS } from './termsStore.js';
import { COMPANY, REFUND_POLICY, DELIVERY_POLICY, ABOUT_PAGE, CONTACT_PAGE } from './legalPolicies.js';

const text = doc => doc.sections.map(s => `${s.title}\n${s.body}`).join('\n');
const docs = { privacy: DEFAULT_PRIVACY, terms: DEFAULT_TERMS, refunds: REFUND_POLICY, delivery: DELIVERY_POLICY, about: ABOUT_PAGE, contact: CONTACT_PAGE };

it('names the operating company, contact and grievance officer on every policy page', () => {
  for (const [name, doc] of Object.entries(docs)) {
    expect(doc.org, name).toBe(COMPANY.legalName);
    expect(doc.email, name).toBe('niyantranai@gmail.com');
    const body = text(doc);
    expect(body, name).toContain('Niyantran Strategy Consulting Private Limited');
    expect(body, name).toContain('Tamanesh Kauri');
    expect(body, name).toContain('+91 80134 25401');
  }
});

it('lists the processors the product actually sends personal data to', () => {
  const body = text(DEFAULT_PRIVACY);
  for (const processor of ['Supabase', 'OpenRouter', 'Razorpay', 'Vercel', 'Google']) expect(body).toContain(processor);
  expect(body).toContain('Grievance Officer');
  expect(body).not.toMatch(/we collect (your )?IP address/i);
});

// F130: web search sends a query to a search provider, so the policy names it and what it receives.
it('names OpenRouter and Exa for web search, what they receive, and that it may leave India', () => {
  const body = text(DEFAULT_PRIVACY);
  expect(body).toMatch(/OpenRouter[^\n]*web search[^\n]*Exa/);
  expect(body).toMatch(/Exa[^\n]*search query/);
  expect(body).toMatch(/not your name, email address or account/);
  expect(body).toMatch(/including AI model providers, web search and hosting/);
  // F131: site icons for web sources are fetched by our server, so DuckDuckGo never sees the reader.
  expect(body).toMatch(/Exa receives the query[^\n]*site icons[^\n]*our server[^\n]*DuckDuckGo[^\n]*domain names?, not your/);
  expect(DEFAULT_PRIVACY.lastUpdated).toBe('13 October 2026');
});

it('states the owner plans, monthly billing, no GST and Kolkata courts in the terms', () => {
  const body = text(DEFAULT_TERMS);
  for (const price of ['₹399', '₹999', '₹9,999']) expect(body).toContain(price);
  expect(body).toMatch(/monthly/i);
  expect(body).toMatch(/not registered under GST/i);
  expect(DEFAULT_TERMS.courts).toMatch(/Kolkata/);
});

it('keeps no-refund terms with the mandatory exceptions and delivery timing', () => {
  const refunds = text(REFUND_POLICY);
  expect(refunds).toMatch(/non-refundable/i);
  expect(refunds).toMatch(/duplicate/i);
  expect(refunds).toMatch(/7 working days/);
  expect(refunds).toMatch(/end of the current billing (month|period)/i);
  expect(text(DELIVERY_POLICY)).toMatch(/nothing (physical )?is shipped/i);
});

it('routes the new pages and links every policy from the footer', () => {
  const site = readFileSync(new URL('../marketing/MarketingSite.jsx', import.meta.url), 'utf8');
  const footer = site.slice(site.indexOf('<footer'), site.indexOf('</footer>'));
  for (const page of ['about', 'contact', 'refunds', 'delivery']) {
    expect(site).toContain(`page === '${page}'`);
    expect(footer).toContain(`go('${page}')`);
  }
  expect(footer).toMatch(/operated by/i);
});
