// F184: how the credits page is reached - the profile menu's Credits item, the header pill, the
// chat's Credits link (niy-open-usage) and Upgrade (niy-open-billing), a plan chosen on the pricing
// page - and that it is a page of the themed terminal, not a dialog.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import CreditBalance from '../../ai/CreditBalance.jsx';
import { OPEN_USAGE_EVENT, openCreditsUsage } from '../../lib/creditsStore.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const shell = read('../TerminalShell.jsx');

it('renders the page for #/account/<section> inside the themed terminal root, over a desk kept mounted and hidden', () => {
  expect(shell).toContain("import CreditsPage from './credits/CreditsPage.jsx'");
  expect(shell).toContain('const [account, setAccount] = useState(() => parseAccountHash());');
  expect(shell).toContain('{account ? <CreditsPage section={account} user={user} ent={ent} /> : null}');
  expect(shell.indexOf('<CreditsPage')).toBeGreaterThan(shell.indexOf('theme-${theme}'));
  // Review (2026-10-15): the desk, and the AI panel in it, stay mounted so a draft or a running answer
  // survives a visit to the credits page; the workspace is hidden, not removed.
  expect(shell).toMatch(/<div className=\{`workspace[^\n]*hidden=\{account \? true : undefined\}>/);
  expect(shell).toContain('{moduleNavigation && !account && <DeskNav');
  expect(shell).not.toMatch(/\{account \? \(\s*<CreditsPage[^]*?\) : \(/);
  expect(read('./creditsPage.css')).toContain('.with-credits-page > .workspace[hidden] { display: none; }');
  expect(read('./CreditsPage.jsx')).not.toMatch(/createPortal|role="dialog"|aria-modal/);
  expect(shell).not.toMatch(/<CreditsUsage|<PlanBilling|setUsageOpen|setBilling/);
});

it('follows the address both ways: back and forward set the section, and a desk action leaves the page', () => {
  expect(shell).toContain("window.addEventListener('hashchange', sync);");
  expect(shell).toContain("window.addEventListener('popstate', sync);");
  // Desks write their address with pushState, which fires no hashchange: each desk action closes the page itself.
  for (const fn of ['function onDesk(id) {', 'function onFeature(name) {', 'function onOpen({ tab: nextTab, feature }) {']) {
    const at = shell.indexOf(fn);
    expect(at, fn).toBeGreaterThan(-1);
    expect(shell.slice(at, at + 80), fn).toContain('setAccount(null);');
  }
  // Loading the terminal on a credits address keeps it, rather than rewriting it to a desk; back and
  // forward on a credits address leave the desk underneath as it was (deskRouteFor, tested in accountRoute).
  expect(shell).toMatch(/if \(parseAccountHash\(hash\)\) return;\s*if \(r\.tab === 'home' && emptyHash/);
  expect(shell).toMatch(/function onPop\(\) \{[^}]*const r = deskRouteFor\(\);\s*if \(!r\) return;/);
});

it('opens from the profile menu, the chat and the pricing page, and puts the pill in the header', () => {
  const menu = shell.slice(shell.indexOf('profile-pop-actions'), shell.indexOf('Log out', shell.indexOf('profile-pop-actions')));
  expect(menu).toContain("goAccount('credits');");
  expect(menu).not.toMatch(/Credits usage|Plan &amp; billing/);
  expect(shell).toContain("const onOpenUsage = () => goAccount('credits');");
  expect(shell).toContain("const onOpenBilling = (event) => goAccount('billing', { plan: event.detail?.plan ?? null });");
  expect(shell.indexOf('<BalancePill user={user} />')).toBeLessThan(shell.indexOf('<div className="profile-wrap" ref={profileRef}>'));
});

it('leaves the page for the desk when an answer asks to open its chat', () => {
  const at = shell.indexOf('const onOpenConversation = () => {');
  expect(shell.slice(at, at + 260)).toMatch(/if \(parseAccountHash\(\)\) \{\s*setAccount\(null\);\s*location\.hash = deskHash\(tab, featureName\);\s*\}\s*openAi\(\{ type: 'ai-open' \}\);/);
});

it('announces niy-open-usage', () => {
  const target = new EventTarget();
  vi.stubGlobal('window', target);
  try {
    const seen = vi.fn();
    target.addEventListener(OPEN_USAGE_EVENT, seen);
    openCreditsUsage();
    expect(OPEN_USAGE_EVENT).toBe('niy-open-usage');
    expect(seen).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});

it('puts the ring and a Credits link on the chat balance that opens the page', () => {
  const credits = { userId: 'u1', balance: 1520, held: 0, available: 1520, debt: 0, plan: 'plus', allowance: 2000, usedThisCycle: 480, lots: [{ kind: 'monthly', remaining: 1520 }], recent: [] };
  const html = renderToStaticMarkup(<CreditBalance credits={credits} />);
  expect(html).toContain('<button type="button" class="ai-credit-usage">Credits</button>');
  expect(html).toMatch(/<svg class="cp-ring cp-ring-ok" width="16" height="16"/);
  const onOpenUsage = vi.fn();
  const find = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'button' && node.props.className === 'ai-credit-usage') return node;
    for (const child of [node.props?.children].flat()) { const hit = find(child); if (hit) return hit; }
    return null;
  };
  find(CreditBalance({ credits, onOpenUsage })).props.onClick();
  expect(onOpenUsage).toHaveBeenCalledOnce();
});

it('keeps the page and its parts free of dollars', () => {
  for (const file of ['./CreditsPage.jsx', './OverviewSection.jsx', './ActivitySection.jsx', './CreditsVisuals.jsx', './BalancePill.jsx',
    '../usage/UsageAnalytics.jsx', '../usage/UsageChart.jsx', '../usage/UsageLegend.jsx', '../usage/ActivityTable.jsx', '../usage/usageParts.jsx',
    '../../lib/creditUsage.js', '../../lib/creditsVisual.js', '../../lib/usageChart.js', '../../lib/usageCsv.js']) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, file).not.toMatch(/usd|dollar|\$\d/i);
  }
});
