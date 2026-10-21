import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  states: [], cursor: 0, effects: [], checkout: vi.fn(), open: vi.fn(), refresh: vi.fn(),
  refreshCredits: vi.fn(), subscribeCredits: vi.fn(), serverCredits: vi.fn(),
}));
vi.mock('react', async original => ({ ...(await original()), useState: initial => {
  const index = fake.cursor++;
  if (!(index in fake.states)) fake.states[index] = typeof initial === 'function' ? initial() : initial;
  return [fake.states[index], value => { fake.states[index] = typeof value === 'function' ? value(fake.states[index]) : value; }];
}, useEffect: effect => { fake.effects.push(effect); }, useRef: () => ({ current: null }) }));
vi.mock('../lib/billing.js', () => ({
  fetchBillingConfig: vi.fn(), fetchInvoices: vi.fn().mockResolvedValue([]),
  formatInr: n => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  completeCheckout: (...args) => fake.checkout(...args), openInvoice: (...args) => fake.open(...args),
}));
vi.mock('../lib/entitlementStore.js', () => ({ refreshEntitlement: (...args) => fake.refresh(...args) }));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: {} }));
vi.mock('../lib/creditsStore.js', async original => ({
  ...(await original()),
  refreshCredits: (...args) => fake.refreshCredits(...args),
  subscribeCredits: (...args) => fake.subscribeCredits(...args),
  serverCredits: (...args) => fake.serverCredits(...args),
}));
vi.mock('./credits/PlanPeriods.jsx', () => ({ default: () => null }));
import PlanBilling from './PlanBilling.jsx';

const DAY = 86400000;
const FREE = { plan: 'free', status: 'free', loaded: true };
const PRO = { plan: 'pro', status: 'active', periodEnd: new Date(Date.now() + 20 * DAY).toISOString(), loaded: true };
const OPEN = { enabled: true, checkoutOpen: true };
const CLOSED = { enabled: false, checkoutOpen: false };

beforeEach(() => {
  fake.states = []; fake.effects = []; fake.checkout.mockReset(); fake.open.mockReset();
  fake.refreshCredits.mockReset(); fake.subscribeCredits.mockReset(); fake.serverCredits.mockReset();
});
afterEach(() => vi.clearAllMocks());

const USER = { id: 'u1', email: 'a@example.test', name: 'A' };
// Legacy checkout state follows config/invoices; credits are supplied by CreditsPage.
function render(ent, { config = CLOSED, invoices = [], selected = null, busy = false, result = null, credits = null, tried = false, user = USER, onClose = vi.fn() } = {}) {
  fake.cursor = 0;
  if (!fake.states.length) fake.states = [config, invoices, selected, busy, result];
  return PlanBilling({ ent, user, onClose, credits, creditsTried: tried });
}
// Hook-free function components (the credits section) are expanded in place.
const expand = node => {
  while (node && typeof node === 'object' && typeof node.type === 'function') node = node.type(node.props);
  return node;
};
function all(node, predicate, found = []) {
  node = expand(node);
  if (!node || typeof node !== 'object') return found;
  if (predicate(node)) found.push(node);
  for (const child of [node.props?.children].flat(Infinity)) all(child, predicate, found);
  return found;
}
const text = node => { node = expand(node); return [node?.props?.children].flat(Infinity).map(c => (typeof c === 'string' || typeof c === 'number' ? c : c && typeof c === 'object' ? text(c) : '')).join(''); };
const tiles = tree => all(tree, n => String(n.props?.className || '').includes('plan-up-plan'));
const pay = tree => all(tree, n => String(n.props?.className || '').includes('plan-up-pay'))[0];

it('offers Plus, Pro and Max in rupees to a free account', () => {
  const tree = render(FREE);
  expect(tiles(tree).map(t => text(t))).toEqual([expect.stringContaining('₹399'), expect.stringContaining('₹999'), expect.stringContaining('₹9,999')]);
  expect(tiles(tree).every(t => !t.props.disabled)).toBe(true);
  expect(text(tree)).toContain('Free');
});

it('shows the included monthly credits on every plan card before selection', () => {
  const cards = tiles(render(FREE));
  expect(cards.map(t => text(t))).toEqual([
    expect.stringContaining('20,000 AI credits every month'),
    expect.stringContaining('65,000 AI credits every month'),
    expect.stringContaining('750,000 AI credits every month'),
  ]);
});

it('says payments open soon and never pays while checkout is closed', () => {
  const tree = render(FREE, { config: CLOSED, selected: 'pro' });
  expect(pay(tree).props.disabled).toBe(true);
  expect(text(tree)).toMatch(/Online payments open soon/);
  expect(text(tree)).toContain('niyantranai@gmail.com');
});

it('on an active Pro month: Plus queues, Pro renews, Max upgrades now without refunding Pro', () => {
  let tree = render(PRO, { config: OPEN });
  const [plus, pro, max] = tiles(tree);
  expect(plus.props.disabled).toBe(false);
  expect(text(pro)).toMatch(/Current/);
  expect(pro.props.className).toContain('billing-current');
  expect(text(pro)).toContain('Current plan');
  expect(max.props.disabled).toBeFalsy();
  max.props.onClick();
  tree = render(PRO, { config: OPEN });
  expect(text(tree)).toMatch(/Max month starts now/);
  expect(text(tree)).toMatch(/unused days of Pro are not refunded/i);
  expect(text(pay(tree))).toBe('Pay online');
  expect(text(all(tree, n => n.props?.['aria-label'] === 'Review your purchase')[0])).toContain('₹9,999.00');
});

it('reminds the account to renew when its month ends within a week', () => {
  const tree = render({ ...PRO, periodEnd: new Date(Date.now() + 3 * DAY).toISOString() });
  expect(text(tree)).toMatch(/Renew/);
});

it('pays through checkout and shows only the server-verified result', async () => {
  fake.checkout.mockResolvedValue({ ok: true, invoice: { id: 'inv_x1', invoiceNo: 'NIY/2627/00001' } });
  let tree = render(FREE, { config: OPEN, selected: 'plus' });
  await pay(tree).props.onClick();
  expect(fake.checkout).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plus' }));
  tree = render(FREE, { config: OPEN });
  expect(text(tree)).toMatch(/Payment verified/);
});

it('reviews a plan with current access and no automatic renewal before paying', () => {
  const tree = render(PRO, { config: OPEN, selected: 'plus' });
  expect(text(tree)).toContain('Review your purchase');
  expect(text(tree)).toContain('Current planPro');
  expect(text(tree)).toContain('20,000 AI credits every month');
  expect(text(tree)).toContain('starts after the current paid period');
  expect(text(tree)).toContain('No automatic renewal');
  expect(fake.checkout).not.toHaveBeenCalled();
});

it('shows the reason when a payment fails or is cancelled', async () => {
  fake.checkout.mockResolvedValue({ ok: false, reason: 'Payment cancelled.' });
  let tree = render(FREE, { config: OPEN, selected: 'pro' });
  await pay(tree).props.onClick();
  tree = render(FREE, { config: OPEN });
  expect(text(tree)).toContain('Payment cancelled.');
  expect(text(tree)).not.toMatch(/Payment verified/);
});

it('lists invoices and opens one as the printable invoice', () => {
  const tree = render(PRO, { invoices: [{ id: 'inv_a1', invoiceNo: 'NIY/2627/00007', total: 999, issuedAt: '2026-10-12T10:00:00Z', planId: 'pro' }] });
  expect(text(tree)).toContain('NIY/2627/00007');
  all(tree, n => n.props?.className === 'plan-up-inv-link')[0].props.onClick();
  expect(fake.open).toHaveBeenCalledWith('inv_a1');
});

// ---- AI credits (F111 task 5) ----

const lot = (kind, remaining, expiresAt) => ({ kind, remaining, expiresAt });
const credits = (over = {}) => ({
  userId: 'u1', balance: 20000, held: 0, available: 20000, debt: 0, plan: 'pro',
  allowance: 20000, cycleEndsAt: '2026-11-12T12:00:00Z',
  lots: [lot('monthly', 20000, '2026-11-12T12:00:00Z')], recent: [], ...over,
});
const section = tree => all(tree, n => String(n.props?.className || '').split(' ').includes('plan-credits'))[0];
const rows = (tree, name) => all(tree, n => n.type === 'li' && String(n.props?.className || '').split(' ').includes(name));

it('shows the balance in credits only, never rupees (F184)', () => {
  const t = text(section(render(PRO, { credits: credits() })));
  expect(t).toContain('AI credits');
  expect(t).toContain('20,000 credits');
  expect(t).not.toContain('₹');
});

it('shows a negative balance as such and says it is taken from the next credits', () => {
  const t = text(section(render(PRO, { credits: credits({ balance: -50, available: -50, debt: 50, lots: [] }) })));
  expect(t).toContain('−50 credits');
  expect(t).toContain('taken from your next credits');
});

it('shows this cycle as the allowance and the cycle end date', () => {
  const t = text(section(render(PRO, { credits: credits() })));
  expect(t).toMatch(/Monthly allowance/);
  expect(t).toContain('20,000 credits');
  expect(t).toContain('12 Nov 2026');
});

it('shows the credits used this cycle as the server counted them (review R, I2)', () => {
  expect(text(section(render(PRO, { credits: credits({ usedThisCycle: 479.5433 }) })))).toContain('Used this cycle: 480 credits');
  fake.states = [];
  expect(text(section(render(PRO, { credits: credits({ usedThisCycle: 38.25 }) })))).toContain('Used this cycle: 38.3 credits');
  fake.states = [];
  expect(text(section(render(PRO, { credits: credits({ usedThisCycle: 0 }) })))).toContain('Used this cycle: 0 credits');
  fake.states = [];
  expect(text(section(render(PRO, { credits: credits({ usedThisCycle: 1.004 }) })))).toContain('Used this cycle: 1 credit');
  fake.states = [];
  expect(text(section(render(PRO, { credits: credits({ usedThisCycle: 1.004 }) })))).not.toContain('1 credits');
});

it('leaves the used line out when the server counted no cycle', () => {
  for (const usedThisCycle of [null, undefined]) {
    fake.states = [];
    expect(text(section(render(PRO, { credits: credits({ usedThisCycle }) })))).not.toMatch(/used this cycle/i);
  }
});

it('describes the Free allowance as the sign-up credits and when they end', () => {
  const t = text(section(render(FREE, { credits: credits({ plan: 'free', balance: 7000, available: 7000, allowance: 10000, cycleEndsAt: '2026-11-13T12:00:00Z', lots: [lot('signup', 7000, '2026-11-13T12:00:00Z')] }) })));
  expect(t).toMatch(/Sign-up credits/);
  expect(t).toContain('10,000 credits');
  expect(t).toContain('13 Nov 2026');
});

it('lists the lots in plain words, earliest expiry first, with remaining and expiry', () => {
  const lots = [
    lot('topup', 500, '2027-09-01T12:00:00Z'),
    lot('rollover', 120, '2026-12-12T12:00:00Z'),
    lot('monthly', 1800, '2026-11-12T12:00:00Z'),
    lot('signup', 40, '2026-11-02T12:00:00Z'),
    lot('adjustment', 25, '2027-03-05T12:00:00Z'),
  ];
  const items = rows(render(PRO, { credits: credits({ lots }) }), 'plan-credits-lot').map(text);
  expect(items).toHaveLength(5);
  expect(items[0]).toMatch(/Sign-up.*40 credits.*2 Nov 2026/);
  expect(items[1]).toMatch(/Monthly.*1,800 credits.*12 Nov 2026/);
  expect(items[2]).toMatch(/Rolled over.*120 credits.*12 Dec 2026/);
  expect(items[3]).toMatch(/Adjustment.*25 credits.*5 Mar 2027/);
  expect(items[4]).toMatch(/Top-up.*500 credits.*1 Sept? 2027/);
});

// F153: the 20-row "Recent answers" list moved to the Credits usage page's All AI activity; in its
// place is the small version of that page, which opens it.
// F184: on the credits page the plan card shows this period as one bar; the small usage version and
// its link to the usage dialog are gone (usage and activity have their own sections of the page).
it('shows this period as a bar in the plan card, with no small usage version or recent answers', () => {
  const recent = [{ conversationId: 'c1', title: 'Rate cut', credits: 38, createdAt: '2026-10-13T12:00:00Z' }];
  const tree = render(PRO, { credits: credits({ recent, usedThisCycle: 500, balance: 1500, lots: [{ kind: 'monthly', remaining: 1500, expiresAt: '2026-11-14T00:00:00Z' }] }) });
  expect(rows(tree, 'plan-credits-answer')).toHaveLength(0);
  expect(text(section(tree))).not.toMatch(/Recent answers|No answers yet|Usage this period|See credits usage/);
  expect(text(section(tree))).toContain('This period');
  const bars = all(tree, n => n.props?.className === 'cp-bar');
  expect(bars).toHaveLength(1);
  expect(bars[0].props['aria-label']).toBe('Used 500, Monthly left 1,500');
  expect(all(tree, n => String(n.props?.className || '').split(' ').includes('cu-mini'))).toHaveLength(0);
});

it('is a section of the credits page: no dialog, scrim or close button', () => {
  const tree = render(PRO, { credits: credits() });
  expect(tree.props.className).toBe('plan-billing-section');
  expect(all(tree, n => n.props?.role === 'dialog' || /plan-up-(scrim|x)\b/.test(String(n.props?.className || '')))).toHaveLength(0);
  expect(text(tree)).toMatch(/Your plan: Pro[\s\S]*Change plan[\s\S]*Invoices/);
});

// F161 (owner approved 2026-10-14): top-ups are not on sale until O6, whatever the state of plan
// checkout, so the note and the address to write to always show.
it('keeps the coming-soon note only while checkout is closed', () => {
  const note = config => { fake.states = []; return text(section(render(PRO, { config, credits: credits() }))); };
  expect(note(CLOSED)).toMatch(/Top-ups coming soon\. Need more credits now\? Write to/);
  expect(note(CLOSED)).toContain('niyantranai@gmail.com');
  expect(note(OPEN)).not.toMatch(/Top-ups coming soon/);
});

// F162: credits set aside for an answer still running are shown, in the muted style, not as debt.
it('shows credits held for a running answer under the balance', () => {
  fake.states = [];
  const t = text(section(render(PRO, { credits: credits({ held: 300 }) })));
  expect(t).toContain('300 credits held for a running answer');
  fake.states = [];
  expect(text(section(render(PRO, { credits: credits() })))).not.toContain('held for a running answer');
});

it('gives a Free account with no credit lots a plain empty state', () => {
  const t = text(section(render(FREE, { credits: credits({ plan: 'free', balance: 0, available: 0, allowance: null, cycleEndsAt: null, lots: [] }) })));
  expect(t).toContain('0 credits');
  expect(t).toMatch(/no credits right now/i);
  expect(t).not.toMatch(/Monthly allowance|Sign-up credits/);
  expect(rows(render(FREE, { credits: credits({ lots: [] }) }), 'plan-credits-lot')).toHaveLength(0);
});

it('renders nothing new when signed out', () => {
  const tree = render(FREE, { user: null, credits: credits() });
  expect(section(tree)).toBeUndefined();
  expect(text(tree)).not.toMatch(/Credits by expiry|Recent answers|Loading credits/);
});

it('says credits are loading, then that they could not be read', () => {
  expect(text(section(render(PRO)))).toMatch(/Loading credits/);
  fake.states = [];
  expect(text(section(render(PRO, { tried: true })))).toMatch(/could not be loaded/i);
});

it('never shows a dollar figure or a dollar word anywhere in the panel', () => {
  const recent = [{ conversationId: 'c1', title: 'Rate cut', credits: 38, createdAt: '2026-10-13T12:00:00Z' }];
  const t = text(render(PRO, { credits: credits({ recent, lots: [lot('topup', 500, '2027-09-01T12:00:00Z')] }) }));
  expect(t).not.toMatch(/\$|USD|dollar/i);
});

it.each([USER, null])('uses the page balance without a second subscription or initial refresh, user=%s', async user => {
  vi.mocked((await import('../lib/billing.js')).fetchBillingConfig).mockResolvedValue(CLOSED);
  fake.refresh.mockResolvedValue(null);
  render(PRO, { user, credits: credits() });
  fake.effects.forEach(effect => effect());
  await Promise.resolve();
  expect(fake.refreshCredits).not.toHaveBeenCalled();
  expect(fake.subscribeCredits).not.toHaveBeenCalled();
});

it('keeps the legacy flow unmounted while billing configuration is pending', () => {
  const tree = render(FREE, { config: null });
  expect(tree.type.name).toBe('BillingWorkspace');
  expect(tree.props.config).toBeNull();
  expect(tree.props.onRetryConfig).toBeTypeOf('function');
});

it('does not mistake unavailable configuration for disabled legacy checkout', () => {
  const tree = render(FREE, { config: { unavailable: true } });
  expect(tree.type.name).toBe('BillingWorkspace');
  expect(tree.props.config.unavailable).toBe(true);
  tree.props.onRetryConfig();
  expect(fake.states.at(-1)).toBe(1);
});

it('resolves deferred configuration without ever mounting legacy children', async () => {
  let resolve;
  vi.mocked((await import('../lib/billing.js')).fetchBillingConfig).mockReturnValue(new Promise(done => { resolve = done; }));
  fake.refresh.mockResolvedValue(null);
  const pending = render(FREE, { config: null });
  expect(pending.type.name).toBe('BillingWorkspace');
  const stop = fake.effects[0]();
  expect(fake.states[0]).toBeNull();
  resolve({enabled:true,cycleChanges:true});
  await Promise.resolve();
  const ready = render(FREE);
  expect(ready.type).toBe(pending.type);
  expect(ready.props.config.cycleChanges).toBe(true);
  stop();
});

it('never renders a supplied balance belonging to the previous account',()=>{
 const tree=render(PRO,{credits:credits({userId:'previous',balance:999999})});
 expect(text(section(tree))).toContain('Loading credits');
 expect(text(section(tree))).not.toContain('999,999');
});
