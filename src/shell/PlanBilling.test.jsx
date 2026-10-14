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
  fetchBillingConfig: vi.fn(), fetchInvoices: vi.fn(),
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
import PlanBilling from './PlanBilling.jsx';
import { OPEN_USAGE_EVENT } from '../lib/creditsStore.js';

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
// state order in PlanBilling: config, invoices, selected, busy, result, credits, creditsTried; then, once the
// credits section is expanded, the small usage version's reports (UsageMiniCard, F153) at index 7
function render(ent, { config = CLOSED, invoices = [], selected = null, busy = false, result = null, credits = null, tried = false, user = USER, onClose = vi.fn() } = {}) {
  fake.cursor = 0;
  if (!fake.states.length) fake.states = [config, invoices, selected, busy, result, credits, tried];
  return PlanBilling({ ent, user, onClose });
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

it('says payments open soon and never pays while checkout is closed', () => {
  const tree = render(FREE, { config: CLOSED, selected: 'pro' });
  expect(pay(tree).props.disabled).toBe(true);
  expect(text(tree)).toMatch(/Online payments open soon/);
  expect(text(tree)).toContain('niyantranai@gmail.com');
});

it('on an active Pro month: Plus is unavailable, Pro renews, Max upgrades now without refunding Pro', () => {
  let tree = render(PRO, { config: OPEN });
  const [plus, pro, max] = tiles(tree);
  expect(plus.props.disabled).toBe(true);
  expect(text(pro)).toMatch(/Current/);
  expect(max.props.disabled).toBeFalsy();
  max.props.onClick();
  tree = render(PRO, { config: OPEN });
  expect(text(tree)).toMatch(/Max month starts now/);
  expect(text(tree)).toMatch(/unused days of Pro are not refunded/i);
  expect(text(pay(tree))).toContain('₹9,999');
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
  userId: 'u1', balance: 2000, held: 0, available: 2000, debt: 0, plan: 'pro', inrPerCredit: 0.1,
  allowance: 2000, cycleEndsAt: '2026-11-12T12:00:00Z',
  lots: [lot('monthly', 2000, '2026-11-12T12:00:00Z')], recent: [], ...over,
});
const section = tree => all(tree, n => String(n.props?.className || '').split(' ').includes('plan-credits'))[0];
const rows = (tree, name) => all(tree, n => n.type === 'li' && String(n.props?.className || '').split(' ').includes(name));

it('shows the balance in credits with the rupee hint', () => {
  const t = text(section(render(PRO, { credits: credits() })));
  expect(t).toContain('AI credits');
  expect(t).toContain('2,000 credits');
  expect(t).toContain('≈ ₹200 of AI');
});

it('shows a negative balance as such and says it is taken from the next credits', () => {
  const t = text(section(render(PRO, { credits: credits({ balance: -50, available: -50, debt: 50, lots: [] }) })));
  expect(t).toContain('−50 credits');
  expect(t).toContain('taken from your next credits');
});

it('omits the rupee hint when the server did not publish a rate', () => {
  const t = text(section(render(PRO, { credits: credits({ inrPerCredit: null }) })));
  expect(t).toContain('2,000 credits');
  expect(t).not.toContain('₹');
});

it('shows this cycle as the allowance and the cycle end date', () => {
  const t = text(section(render(PRO, { credits: credits() })));
  expect(t).toMatch(/Monthly allowance/);
  expect(t).toContain('2,000 credits');
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
  const t = text(section(render(FREE, { credits: credits({ plan: 'free', balance: 700, available: 700, allowance: 1000, cycleEndsAt: '2026-11-13T12:00:00Z', lots: [lot('signup', 700, '2026-11-13T12:00:00Z')] }) })));
  expect(t).toMatch(/Sign-up credits/);
  expect(t).toContain('1,000 credits');
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
const closed = vi.fn();
const mini = tree => all(tree, n => String(n.props?.className || '').split(' ').includes('cu-mini'))[0];

it('shows the small usage version in place of the recent answers list', () => {
  const recent = [{ conversationId: 'c1', title: 'Rate cut', credits: 38, createdAt: '2026-10-13T12:00:00Z' }];
  const tree = render(PRO, { credits: credits({ recent }) });
  expect(rows(tree, 'plan-credits-answer')).toHaveLength(0);
  expect(text(section(tree))).not.toMatch(/Recent answers|No answers yet/);
  expect(text(section(tree))).toContain('Usage this period');
  expect(mini(tree)).toBeTruthy();
  expect(text(mini(tree))).toMatch(/Loading usage/);
});

it('fills the small version once its reports arrive: four figures, top models and a 30-day sparkline', () => {
  fake.states = [CLOSED, [], null, false, null, credits({ balance: 1500, allowance: 2000 }), true, {
    status: 'ready', points: [{ bucket: '2026-10-13', model: 'google/gemini-3.7-flash', credits: 30, calls: 2, tokens: 900 }],
    summary: { credits: 500, calls: 42, tokens: 2270000, byModel: [{ model: 'google/gemini-3.7-flash', provider: 'google', credits: 480, calls: 40, tokens: 2200000 }] },
  }];
  const t = text(mini(render(PRO)));
  expect(t).toMatch(/Credits used.*500.*Credits left.*1,500.*of 2,000 this period.*Model calls.*42.*Tokens.*2\.27M/);
  expect(t).toContain('gemini-3.7-flash');
  expect(t).toContain('40 calls · 480 credits');
  expect(t).toMatch(/See credits usage/);
});

it('opens the Credits usage page from the small version and closes Plan & billing', () => {
  const target = new EventTarget();
  vi.stubGlobal('window', target);
  try {
    closed.mockReset();
    const seen = vi.fn();
    target.addEventListener(OPEN_USAGE_EVENT, seen);
    const see = all(mini(render(PRO, { credits: credits(), onClose: closed })), n => n.type === 'button' && /See credits usage/.test(text(n)))[0];
    see.props.onClick();
    expect(closed).toHaveBeenCalledOnce();
    expect(seen).toHaveBeenCalledOnce();
    expect(OPEN_USAGE_EVENT).toBe('niy-open-usage');
  } finally { vi.unstubAllGlobals(); }
});

// F161 (owner approved 2026-10-14): top-ups are not on sale until O6, whatever the state of plan
// checkout, so the note and the address to write to always show.
it('says top-ups are coming soon and where to write for credits, whether checkout is open or not', () => {
  const note = config => { fake.states = []; return text(section(render(PRO, { config, credits: credits() }))); };
  for (const config of [CLOSED, OPEN, null]) {
    expect(note(config)).toMatch(/Top-ups coming soon\. Need more credits now\? Write to/);
    expect(note(config)).toContain('niyantranai@gmail.com');
  }
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

it('reads credits like the plan: subscribes, refreshes, and lets go on unmount', async () => {
  const off = vi.fn();
  fake.subscribeCredits.mockReturnValue(off);
  fake.serverCredits.mockReturnValue(credits());
  fake.refreshCredits.mockResolvedValue(credits());
  vi.mocked((await import('../lib/billing.js')).fetchBillingConfig).mockResolvedValue(CLOSED);
  vi.mocked((await import('../lib/billing.js')).fetchInvoices).mockResolvedValue([]);
  globalThis.window = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  try {
    render(PRO);
    const cleanups = fake.effects.map(effect => effect()).filter(Boolean);
    expect(fake.refreshCredits).toHaveBeenCalledTimes(1);
    expect(fake.subscribeCredits).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    cleanups.forEach(c => c());
    expect(off).toHaveBeenCalledTimes(1);
  } finally {
    delete globalThis.window;
  }
});

it('does not read credits when signed out', async () => {
  vi.mocked((await import('../lib/billing.js')).fetchBillingConfig).mockResolvedValue(CLOSED);
  vi.mocked((await import('../lib/billing.js')).fetchInvoices).mockResolvedValue([]);
  globalThis.window = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  try {
    render(FREE, { user: null });
    fake.effects.forEach(effect => effect());
    expect(fake.refreshCredits).not.toHaveBeenCalled();
    expect(fake.subscribeCredits).not.toHaveBeenCalled();
  } finally {
    delete globalThis.window;
  }
});
