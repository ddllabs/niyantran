import { expect, it, vi } from 'vitest';
import { createPurchase, checkoutEnabled, paymentConfig, planCycleOperation, reconcilePayment } from '../../server/paymentService.mjs';

const buyer = { id: 'd0000000-0000-4000-8000-000000000001', email: 'fixture@example.test' };
const quoteId = 'd0000000-0000-4000-8000-000000000002';
function context(mode = 'live') {
  const order = { id: buyer.id, user_id: buyer.id, account: 'acc_fixture', mode,
    provider_order_id: 'order_A1', state: 'ready', fresh: true, amount_paise: 30000, currency: 'INR',
    snapshot: { kind: 'plan', contract: 'cycle-v2', planId: 'pro', quoteId, expiresAt: new Date(Date.now() + 60000).toISOString() } };
  return { order, config: { open: true, ready: true, mode, account: 'acc_fixture', cycleChanges: true, testBuyerIds: mode === 'test' ? [buyer.id] : [], liveBuyerIds: mode === 'live' ? [buyer.id] : [] },
    client: { rpc: vi.fn(async (name, args) => ({ data: ['billing_cycle_v3', 'billing_cycle_daily'].includes(name)
      ? args.p_action === 'claim' ? order : { ok: true, quoteId } : name === 'billing_order' ? order : { ok: true } })) },
    fetch: vi.fn(async path => path.startsWith('/payments')
      ? { id: 'pay_A1', order_id: 'order_A1', amount: 30000, currency: 'INR', status: 'captured' } : { id: 'order_A1' }) };
}
it('makes Live plan capability available without opening checkout or needing Test buyers', () => {
  expect(paymentConfig({ RAZORPAY_KEY_ID: 'rzp_live_fixture', RAZORPAY_KEY_SECRET: 'fixture', RAZORPAY_ACCOUNT_ID: 'acc_fixture' }))
    .toMatchObject({ mode: 'live', cycleChanges: true, open: false });
});
it.each(['test', 'live'])('%s uses the scoped v3 server quote and immutable amount', async mode => {
  const ctx = context(mode);
  await createPurchase({ planId: 'pro', quoteId, requestId: buyer.id, mode: 'foreign', account: 'foreign', amount: 1, credits: 1 }, buyer, ctx);
  expect(ctx.client.rpc).toHaveBeenCalledWith('billing_cycle_v3', expect.objectContaining({ p_action: 'claim', p: expect.objectContaining({ userId: buyer.id, mode, account: 'acc_fixture', quoteId }) }));
  expect(ctx.fetch).toHaveBeenCalledWith('/orders', expect.objectContaining({ body: expect.objectContaining({ amount: 30000 }) }));
});
it('requires a reviewed quote for Live plans before any order write', async () => {
  const ctx = context();
  await expect(createPurchase({ planId: 'pro', requestId: buyer.id }, buyer, ctx)).rejects.toMatchObject({ status: 400 });
  expect(ctx.client.rpc).not.toHaveBeenCalled(); expect(ctx.fetch).not.toHaveBeenCalled();
});
it.each(['test', 'live'])('%s schedules freely from authenticated identity without a payment', async mode => {
  const ctx = context(mode); ctx.config.open = false;
  await planCycleOperation('schedule', { planId: 'plus', userId: 'foreign', mode: 'foreign' }, buyer, ctx);
  expect(ctx.client.rpc).toHaveBeenCalledWith('billing_cycle_v3', { p_action: 'schedule', p: { userId: buyer.id, account: 'acc_fixture', mode, planId: 'plus', intent: undefined } });
  expect(ctx.fetch).not.toHaveBeenCalled();
});
it.each(['test', 'live'])('%s keeps new quotes and paid orders closed', async mode => {
  const ctx = context(mode); ctx.config.open = false;
  await expect(planCycleOperation('quote', { planId: 'plus' }, buyer, ctx)).rejects.toMatchObject({ status: 503 });
  await expect(createPurchase({ planId: 'pro', quoteId, requestId: buyer.id }, buyer, ctx)).rejects.toMatchObject({ status: 503 });
  expect(ctx.client.rpc).not.toHaveBeenCalled(); expect(ctx.fetch).not.toHaveBeenCalled();
});
it.each([[], ['d0000000-0000-4000-8000-000000000003']])('preserves Test buyer restrictions for every cycle operation', async ids => {
  const ctx = context('test'); ctx.config.testBuyerIds = ids;
  for (const action of ['quote', 'state', 'schedule', 'cancel']) await expect(planCycleOperation(action, { planId: 'plus' }, buyer, ctx)).rejects.toMatchObject({ status: 403 });
  expect(ctx.client.rpc).not.toHaveBeenCalled();
});
it.each(['test', 'live'])('%s captures v2 with authoritative merchant/mode even while checkout is closed', async mode => {
  const ctx = context(mode); ctx.config.open = false;
  await reconcilePayment(ctx.order, 'pay_A1', ctx);
  expect(ctx.client.rpc).toHaveBeenCalledWith('billing_cycle_capture_v2', { p_order_id: buyer.id, p_payment: expect.objectContaining({ amount: 30000 }), p_context: { account: 'acc_fixture', mode } });
});
it.each([{ mode: 'test' }, { account: 'acc_foreign' }])('rejects a foreign v2 purchase before fetching or recording payment', async mismatch => {
  const ctx = context(); Object.assign(ctx.order, mismatch);
  await expect(reconcilePayment(ctx.order, 'pay_A1', ctx)).rejects.toMatchObject({ status: 403 });
  expect(ctx.fetch).not.toHaveBeenCalled(); expect(ctx.client.rpc).not.toHaveBeenCalled();
});
it('retains the original capture path for previously issued Test cycle-v1 orders', async () => {
  const ctx = context('test'); ctx.order.snapshot.contract = 'cycle-v1';
  await reconcilePayment(ctx.order, 'pay_A1', ctx);
  expect(ctx.client.rpc).toHaveBeenCalledWith('billing_cycle_capture', expect.objectContaining({ p_order_id: buyer.id }));
});
it('refuses an unknown versioned financial contract instead of legacy fulfilment', async () => {
  const ctx = context(); ctx.order.snapshot.contract = 'cycle-future';
  await expect(reconcilePayment(ctx.order, 'pay_A1', ctx)).rejects.toMatchObject({ status: 409 });
  expect(ctx.fetch).not.toHaveBeenCalled(); expect(ctx.client.rpc).not.toHaveBeenCalled();
});

it.each(['test', 'live'])('%s dispatches new grace contracts without changing old capture routes', async mode => {
  const ctx = context(mode); ctx.order.snapshot.contract = 'cycle-v3';
  await reconcilePayment(ctx.order, 'pay_A1', ctx);
  expect(ctx.client.rpc).toHaveBeenCalledWith('billing_cycle_capture_v3', { p_order_id: buyer.id, p_payment: expect.objectContaining({ amount: 30000 }), p_context: { account: 'acc_fixture', mode } });
});

it.each([undefined, [], ['*'], [buyer.email], [buyer.id, 'invalid'], ['d0000000-0000-4000-8000-000000000003']].map(ids => [ids]))('denies Live pilot operations for missing, malformed or nonmatching buyers %j', async ids => {
  const ctx = context(); ctx.config.liveBuyerIds = ids;
  for (const action of ['quote', 'state', 'schedule', 'cancel']) {
    await expect(planCycleOperation(action, { planId: 'plus', userId: buyer.id }, buyer, ctx)).rejects.toMatchObject({ status: 403 });
  }
  for (const productId of ['pro', 'topup-20000']) {
    await expect(createPurchase({ productId, quoteId, requestId: buyer.id, userId: ids?.[0] }, buyer, ctx)).rejects.toMatchObject({ status: 403 });
  }
  expect(ctx.client.rpc).not.toHaveBeenCalled(); expect(ctx.fetch).not.toHaveBeenCalled();
});
it('keeps Live capture available when the pilot list is removed', async () => {
  const ctx = context(); ctx.config.liveBuyerIds = []; ctx.config.open = false;
  await reconcilePayment(ctx.order, 'pay_A1', ctx);
  expect(ctx.client.rpc).toHaveBeenCalledWith('billing_cycle_capture_v2', expect.anything());
});


it('opens public Live checkout only through the explicit server flag', async () => {
  const ctx = context(); ctx.config.liveBuyerIds = []; ctx.config.livePublic = true;
  expect(checkoutEnabled(ctx.config)).toBe(true);
  for (const action of ['quote', 'state', 'schedule', 'cancel']) {
    await planCycleOperation(action, { planId: 'plus', userId: 'foreign' }, buyer, ctx);
  }
  await createPurchase({ planId: 'pro', quoteId, requestId: buyer.id }, buyer, ctx);
  expect(ctx.fetch).toHaveBeenCalledWith('/orders', expect.objectContaining({ body: expect.objectContaining({ amount: 30000 }) }));
});
it.each([undefined, '', '0', 'true', '1'])('parses public Live flag strictly: %s', value => {
  expect(paymentConfig({ BILLING_LIVE_PUBLIC: value }).livePublic).toBe(value === '1');
});
it('public Live flag cannot open Test checkout', async () => {
  const ctx = context('test'); ctx.config.livePublic = true; ctx.config.testBuyerIds = [];
  expect(checkoutEnabled(ctx.config)).toBe(false);
  await expect(createPurchase({ planId: 'pro', quoteId, requestId: buyer.id }, buyer, ctx)).rejects.toMatchObject({ status: 403 });
  await expect(planCycleOperation('quote', { planId: 'plus' }, buyer, ctx)).rejects.toMatchObject({ status: 403 });
  expect(ctx.client.rpc).not.toHaveBeenCalled(); expect(ctx.fetch).not.toHaveBeenCalled();
});
it.each(['open', 'ready'])('public Live checkout still requires %s', async field => {
  const ctx = context(); ctx.config.livePublic = true; ctx.config.liveBuyerIds = []; ctx.config[field] = false;
  expect(checkoutEnabled(ctx.config)).toBe(false);
  await expect(createPurchase({ planId: 'pro', quoteId, requestId: buyer.id }, buyer, ctx)).rejects.toMatchObject({ status: 503 });
  expect(ctx.client.rpc).not.toHaveBeenCalled(); expect(ctx.fetch).not.toHaveBeenCalled();
});
