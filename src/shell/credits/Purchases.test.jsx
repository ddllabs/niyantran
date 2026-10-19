import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Purchases from './Purchases.jsx';

const state = vi.hoisted(() => ({ order: null }));
vi.mock('react', async original => ({
  ...await original(),
  useState: initial => [Array.isArray(initial) ? [state.order] : initial, vi.fn()],
}));
vi.mock('../../lib/billing.js', () => ({
  completeCheckout: vi.fn(), fetchBillingConfig: vi.fn(), fetchPurchases: vi.fn(),
  formatInr: vi.fn(),
}));
beforeEach(() => { state.order = { id: 'original-purchase', snapshot: { label: '20,000 AI credits' } }; });

it.each([
  ['ready', false, 'Awaiting payment'],
  ['reconciling', false, 'Confirmation pending'],
  ['creating', false, 'Confirmation pending'],
  ['reconciling', true, 'Checkout not started — retry available'],
  ['fulfilled', false, 'Confirmed'],
  ['review', false, 'Support review required'],
  ['refunded', false, 'Refund recorded'],
])('renders %s (retryable=%s) accurately', (status, retryable, label) => {
  state.order = { ...state.order, state: status, creation_retryable: retryable };
  const html = renderToStaticMarkup(<Purchases user={{ id: 'buyer' }} />);
  expect(html).toContain('20,000 AI credits');
  expect(html).toContain(label);
  if (status === 'ready') expect(html).not.toContain('Confirmation pending');
});
