// F153: how the Credits usage page is opened - the profile menu, Plan & billing and the chat's credit
// chip (niy-open-usage) - and that it renders inside the themed terminal root.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import CreditBalance from '../../ai/CreditBalance.jsx';
import { OPEN_USAGE_EVENT, openCreditsUsage } from '../../lib/creditsStore.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

it('opens from the profile menu and on niy-open-usage, inside the themed terminal root', () => {
  const shell = read('../TerminalShell.jsx');
  expect(shell).toMatch(/import \{[^}]*\bOPEN_USAGE_EVENT\b[^}]*\} from '\.\.\/lib\/creditsStore\.js'/);
  expect(shell).toContain("import CreditsUsage from './usage/CreditsUsage.jsx'");
  expect(shell).toContain('window.addEventListener(OPEN_USAGE_EVENT, onOpenUsage)');
  expect(shell).toContain('window.removeEventListener(OPEN_USAGE_EVENT, onOpenUsage)');
  const menu = shell.slice(shell.indexOf('profile-pop-actions'), shell.indexOf('Log out', shell.indexOf('profile-pop-actions')));
  expect(menu).toContain('Credits usage');
  expect(menu).toContain('setUsageOpen(true)');
  expect(shell.indexOf('<CreditsUsage')).toBeGreaterThan(shell.indexOf('theme-${theme}'));
  expect(read('./CreditsUsage.jsx')).not.toContain('createPortal');
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

it('puts a Usage link on the chat credit chip that opens the page', () => {
  const credits = { userId: 'u1', balance: 1520, held: 0, available: 1520, debt: 0, plan: 'plus', inrPerCredit: 0.1, allowance: 2000, lots: [], recent: [] };
  expect(renderToStaticMarkup(<CreditBalance credits={credits} />)).toContain('<button type="button" class="ai-credit-usage">Usage</button>');
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
  for (const file of ['./CreditsUsage.jsx', './UsageActivityCard.jsx', './UsageAnalytics.jsx', './UsageChart.jsx', './UsageLegend.jsx',
    './ActivityDialog.jsx', './ActivityTable.jsx', './UsageMini.jsx', './usageParts.jsx', '../../lib/creditUsage.js', '../../lib/usageChart.js', '../../lib/usageCsv.js']) {
    // Code only: the comments say "never dollars".
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, file).not.toMatch(/usd|dollar|\$\d/i);
  }
});
