import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const fake = vi.hoisted(() => ({ states: [], cursor: 0, checkout: vi.fn() }));
vi.mock('react', async original => ({ ...await original(),
  useEffect: () => {}, useRef: () => ({ current: false }),
  useState: initial => {
    const i = fake.cursor++;
    if (!(i in fake.states)) fake.states[i] = initial;
    return [fake.states[i], value => { fake.states[i] = value; }];
  },
}));
vi.mock('../../lib/billing.js', () => ({
  completeCheckout: (...args) => fake.checkout(...args),
  fetchBillingConfig: vi.fn(), fetchPurchases: vi.fn().mockResolvedValue([]),
  formatInr: n => `₹${n.toFixed(2)}`, openInvoice: vi.fn(),
}));
import Purchases from './Purchases.jsx';

const pack = { productId: 'topup-20000', credits: 20000, amountPaise: 49900 };
const user = { id: 'buyer', email: 'buyer@example.test' };
const tree = () => { fake.cursor = 0; return Purchases({ user }); };
const nodes = (node, predicate) => {
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(n => nodes(n, predicate))];
};
beforeEach(() => {
  fake.states = [{ enabled: true, topups: [pack] }, [], false, ''];
  fake.checkout.mockReset().mockResolvedValue({ ok: false, reason: 'Payment cancelled.' });
});

it('selecting a top-up reviews it without initiating payment', async () => {
  const card = nodes(tree(), n => n.type === 'button' && n.props.className?.includes('plan-up-plan'))[0];
  await card.props.onClick();
  expect(fake.checkout).not.toHaveBeenCalled();
  const html = renderToStaticMarkup(tree());
  expect(html).toContain('Review your purchase');
  expect(html).toContain('₹499.00');
  expect(html).toContain('Your plan and model access stay unchanged');
});

it('requires explicit confirmation and refreshes the parent after a verified purchase', async () => {
  const onUpdated = vi.fn();
  fake.checkout.mockResolvedValue({ ok: true });
  fake.states[4] = pack;
  fake.cursor = 0;
  const review = nodes(Purchases({ user, onUpdated }), n => n.props?.onConfirm)[0];
  await review.props.onConfirm();
  expect(fake.checkout).toHaveBeenCalledWith({ productId: pack.productId, user });
  expect(onUpdated).toHaveBeenCalledOnce();
  expect(fake.states[4]).toBe(null);
});

it('blocks repeated confirmation while the same Checkout is opening', async () => {
  let finish;
  fake.checkout.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  fake.states[4] = pack;
  const review = nodes(tree(), n => n.props?.onConfirm)[0];
  const first = review.props.onConfirm();
  await review.props.onConfirm();
  expect(fake.checkout).toHaveBeenCalledOnce();
  finish({ ok: false, reason: 'Payment cancelled.' });
  await first;
});

it('retains unpaid attempts behind a closed disclosure, with identifiable references', () => {
  fake.states[1] = [{ id: 'purchase-unpaid', state: 'ready', created_at: '2026-10-19T12:00:00Z', snapshot: { label: '20,000 AI credits', amountPaise: 49900 } }];
  const html = renderToStaticMarkup(tree());
  expect(html).toContain('<details');
  expect(html).toContain('Unconfirmed checkout attempts');
  expect(html).not.toMatch(/<details[^>]*\sopen/);
  expect(html).toContain('purchase-unpaid');
  expect(html).toContain('No completed purchases yet.');
  expect(html).not.toContain('Your recent purchases');
});

it('keeps uncertain payment confirmations outside the unpaid-attempt disclosure', () => {
  fake.states[1] = [{ id: 'unknown', state: 'reconciling', snapshot: { label: 'PLUS plan' } }];
  const html = renderToStaticMarkup(tree());
  expect(html).toContain('Needs confirmation');
  expect(html).toContain('Confirmation pending');
  expect(html).not.toContain('Unconfirmed checkout attempts');
});
