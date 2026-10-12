import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ states: [], cursor: 0, checkout: vi.fn(), open: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async original => ({ ...(await original()), useState: initial => {
  const index = fake.cursor++;
  if (!(index in fake.states)) fake.states[index] = typeof initial === 'function' ? initial() : initial;
  return [fake.states[index], value => { fake.states[index] = typeof value === 'function' ? value(fake.states[index]) : value; }];
}, useEffect: () => {}, useRef: () => ({ current: null }) }));
vi.mock('../lib/billing.js', () => ({
  fetchBillingConfig: vi.fn(), fetchInvoices: vi.fn(),
  completeCheckout: (...args) => fake.checkout(...args), openInvoice: (...args) => fake.open(...args),
}));
vi.mock('../lib/entitlementStore.js', () => ({ refreshEntitlement: (...args) => fake.refresh(...args) }));
import PlanBilling from './PlanBilling.jsx';

const DAY = 86400000;
const FREE = { plan: 'free', status: 'free', loaded: true };
const PRO = { plan: 'pro', status: 'active', periodEnd: new Date(Date.now() + 20 * DAY).toISOString(), loaded: true };
const OPEN = { enabled: true, checkoutOpen: true };
const CLOSED = { enabled: false, checkoutOpen: false };

beforeEach(() => { fake.states = []; fake.checkout.mockReset(); fake.open.mockReset(); });
afterEach(() => vi.clearAllMocks());

// state order in PlanBilling: config, invoices, selected, busy, result
function render(ent, { config = CLOSED, invoices = [], selected = null, busy = false, result = null } = {}) {
  fake.cursor = 0;
  if (!fake.states.length) fake.states = [config, invoices, selected, busy, result];
  return PlanBilling({ ent, user: { id: 'u1', email: 'a@example.test', name: 'A' }, onClose: vi.fn() });
}
function all(node, predicate, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (predicate(node)) found.push(node);
  for (const child of [node.props?.children].flat(Infinity)) all(child, predicate, found);
  return found;
}
const text = node => [node?.props?.children].flat(Infinity).map(c => (typeof c === 'string' || typeof c === 'number' ? c : c && typeof c === 'object' ? text(c) : '')).join('');
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
