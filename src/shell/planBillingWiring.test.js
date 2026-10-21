import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

// F184: Plan & billing is the credits page's Plan and invoices section; the profile menu's one Credits
// item opens the page, and a plan chosen on the pricing page opens the section with it.
it('opens the credits page from the profile menu and Plan and invoices from a pricing hand-off', () => {
  const shell = read('./TerminalShell.jsx');
  expect(shell).not.toContain('Plan &amp; billing');
  expect(shell).toMatch(/goAccount\('credits'\);\s*\}\s*\}\s*>\s*Credits\s*<\/button>/);
  expect(shell).toContain('<CreditsPage section={account}');
  expect(shell).toContain("sessionStorage.getItem('niyOpenBilling')");
  expect(shell).toContain("goAccount('billing', { plan: plan || null });");
  expect(read('./credits/CreditsPage.jsx')).toContain('<PlanBilling key={userId + \':\' + (plan || \'none\')} ent={ent} user={user} initialPlan={plan} credits={credits} creditsTried={creditsTried} />');
});

it('opens Plan & billing live when the chat asks (Upgrade or Buy credits, F111)', () => {
  const shell = read('./TerminalShell.jsx');
  expect(shell).toContain("import { OPEN_BILLING_EVENT } from '../ai/CreditBalance.jsx'");
  expect(shell).toContain('window.addEventListener(OPEN_BILLING_EVENT, onOpenBilling)');
  expect(shell).toContain('window.removeEventListener(OPEN_BILLING_EVENT, onOpenBilling)');
});

it('shows the AI panel when Plan & billing asks to open a conversation (F149)', () => {
  const shell = read('./TerminalShell.jsx');
  expect(shell).toMatch(/import \{[^}]*\bOPEN_CONVERSATION_EVENT\b[^}]*\} from '\.\.\/lib\/creditsStore\.js'/);
  const at = shell.indexOf('window.addEventListener(OPEN_CONVERSATION_EVENT');
  expect(at).toBeGreaterThan(-1);
  expect(shell.slice(at - 400, at)).toContain("type: 'ai-open'");
  expect(shell).toContain('window.removeEventListener(OPEN_CONVERSATION_EVENT');
  // The shell only shows the panel; the research thread selects the chat.
  expect(shell).not.toContain('selectChat');
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
  for (const name of ['refreshCredits', 'creditsText']) expect(panel).toContain(name);
  for (const name of ['serverCredits', 'subscribeCredits']) expect(read('./credits/CreditsPage.jsx')).toContain(name);
  expect(panel).not.toContain('subscribeCredits');
  expect(panel).not.toMatch(/USD|dollar|\$\d/i);
});

it('prefixes every new credits style with plan-credits and adds no dollar', () => {
  const css = read('./upgrade.css');
  const start = css.indexOf('/* AI credits');
  expect(start).toBeGreaterThan(-1);
  // The dark-theme rules (F148) follow it and are checked by planBillingDark.test.js.
  const darkAt = css.indexOf('/* Dark theme (F148)');
  expect(darkAt).toBeGreaterThan(start);
  const block = css.slice(start, darkAt);
  expect(block).toContain('.plan-credits');
  const selectors = block.match(/\.[a-z][\w-]*/g) || [];
  expect(selectors.filter(s => !s.startsWith('.plan-credits') && !/^\.\d/.test(s))).toEqual([]);
  expect(block).not.toMatch(/USD|dollar|\$/i);
});

it('forgets the cached credits when the user signs out, so another account never sees them (review R)', () => {
  const shell = read('./TerminalShell.jsx');
  expect(shell).toMatch(/import \{[^}]*\bclearCredits\b[^}]*\} from '\.\.\/lib\/creditsStore\.js'/);
  const logout = shell.slice(shell.indexOf('function doLogout()'), shell.indexOf('return (', shell.indexOf('function doLogout()')));
  expect(logout).toContain('clearSessionUser()');
  expect(logout).toContain('clearCredits()');
});
