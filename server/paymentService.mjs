import crypto from 'node:crypto';
import { paymentProduct, TOPUP_PACKS } from './paymentCatalog.mjs';
import { sellerFromEnv } from './inrBilling.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT = /^pay_[A-Za-z0-9]+$/;
const ORDER = /^order_[A-Za-z0-9]+$/;
export const digest = raw => crypto.createHash('sha256').update(raw).digest('hex');
export function paymentError(message, status = 400) { return Object.assign(new Error(message), { status }); }
export function signatureMatches(raw, signature, secret) {
  if (!secret || !/^[0-9a-f]{64}$/i.test(String(signature || ''))) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
// This controls new Test orders only. Existing paid orders must remain recoverable.
function validTestBuyers(config) {
  return Array.isArray(config.testBuyerIds) && config.testBuyerIds.length > 0
    && config.testBuyerIds.every(id => typeof id === 'string' && UUID.test(id));
}
export function checkoutEnabled(config) {
  return Boolean(config.ready && config.open && (config.mode === 'live' || (config.mode === 'test' && validTestBuyers(config))));
}
export function paymentConfig(env = process.env) {
  const keyId = String(env.RAZORPAY_KEY_ID || '');
  const mode = /^rzp_test_/.test(keyId) ? 'test' : /^rzp_live_/.test(keyId) ? 'live' : null;
  return { keyId, keySecret: env.RAZORPAY_KEY_SECRET || '', webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
    account: env.RAZORPAY_ACCOUNT_ID || '', mode, cycleChanges: mode === 'test',
    testBuyerIds: String(env.BILLING_TEST_BUYER_IDS || '').trim().split(/[,\s]+/).filter(Boolean).map(id => id.toLowerCase()),
    open: env.BILLING_CHECKOUT_OPEN === '1', ready: Boolean(mode && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_ACCOUNT_ID) };
}
export async function providerFetch(path, { method = 'GET', body } = {}, config = paymentConfig()) {
  if (!config.ready) throw paymentError('Payments are not configured.', 503);
  // This adapter deliberately does not retry POSTs: timeout may mean order created.
  const unavailable = () => paymentError('Payment provider unavailable. Check purchase status before retrying.', 503);
  let result;
  try {
    result = await fetch(`https://api.razorpay.com/v1${path}`, { method,
      signal: AbortSignal.timeout(10000), headers: { Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined });
  } catch (error) {
    throw Object.assign(unavailable(), { paymentFailure: ['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : 'transport' });
  }
  // Keep only bounded HTTP metadata. Provider bodies may contain sensitive data.
  if (!result.ok) throw Object.assign(unavailable(), { paymentFailure: 'http', providerStatus: result.status });
  let data;
  try { data = await result.json(); }
  catch { throw Object.assign(unavailable(), { paymentFailure: 'invalid_response' }); }
  if (!data || typeof data !== 'object') throw Object.assign(paymentError('Invalid provider response.', 502), { paymentFailure: 'invalid_response' });
  return data;
}
export async function billingRpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  const cycleReasons = new Set(['Quote expired or plan changed; review again', 'Choose a lower next plan', 'Next period is already paid; contact support', 'Contact support to change this plan', 'Too close to cycle end to upgrade; choose a plan after expiry', 'Manual renewal opens in the last seven days; upgrades apply now', 'Schedule the lower next plan before renewal']);
  if (error && name === 'billing_cycle' && cycleReasons.has(error.message)) throw paymentError(error.message, 409);
  if (error) throw paymentError(error.code === '23505' ? 'Request conflicts with an existing purchase.' : 'Purchase processing is pending. Check its status or contact support.', error.code === '23505' ? 409 : 503);
  return data;
}
export function paymentContext(deps) {
  const config = deps.paymentConfig || paymentConfig();
  return { config, client: deps.adminClient(), fetch: deps.razorpayFetch || ((path, init) => providerFetch(path, init, config)) };
}
const retryRpc = (ctx, action, p) => billingRpc(ctx.client, 'billing_creation_retry', { p_action: action, p: { account: ctx.config.account, mode: ctx.config.mode, ...p } });
const orderRpc = (ctx, action, p) => billingRpc(ctx.client, 'billing_order', { p_action: action, p: { account: ctx.config.account, mode: ctx.config.mode, ...p } });
export function publicPurchase(order) {
  const retryable = Boolean(order.creation_retryable && !order.provider_order_id && ['creating', 'reconciling'].includes(order.state));
  return { purchaseId: order.id, orderId: order.provider_order_id, status: retryable ? 'creation_failed' : order.state,
    retryable,
    pending: !retryable && !['fulfilled', 'refunded'].includes(order.state), quote: order.snapshot, amount: Number(order.amount_paise), currency: order.currency };
}

async function stalePlanReview(order, user, ctx) {
  const state = await billingRpc(ctx.client, 'billing_checkout_preflight', { p: {
    purchaseId: order.id, userId: user.id, account: ctx.config.account, mode: ctx.config.mode,
  } });
  if (typeof state?.stale !== 'boolean') throw paymentError('Plan checkout could not be checked. Please retry later.', 503);
  if (!state.stale) return null;
  const pending = { ok: true, pending: true, status: 'reconciling', purchaseId: order.id,
    reason: 'Your plan changed. This earlier checkout needs reconciliation before another payment. Refresh purchases or contact support.' };
  if (state.observedPayment !== false || !/^\d+$/.test(state.version || '') ||
    (order.lease_until && Date.parse(order.lease_until) > Date.now())) return pending;
  if (order.provider_order_id) {
    // A stale, unused provider order stays in the audit. Never reopen it or infer
    // that a timed-out/authorized/captured payment is safe to pay again.
    try {
      const path = `/orders/${encodeURIComponent(order.provider_order_id)}`;
      const [provider, payments] = await Promise.all([ctx.fetch(path), ctx.fetch(`${path}/payments`)]);
      if (provider.id !== order.provider_order_id || provider.receipt !== order.id || provider.status !== 'created' ||
        provider.currency !== order.currency || provider.amount !== Number(order.amount_paise) ||
        provider.amount_paid !== 0 || provider.amount_due !== Number(order.amount_paise) || provider.attempts !== 0 ||
        payments.count !== 0 || !Array.isArray(payments.items) || payments.items.length !== 0) return pending;
    } catch { return pending; }
  } else if (!order.fresh && !order.creation_retryable) return pending;
  // Same old intent + authoritative grant version always yields the same next
  // intent, including concurrent old tabs. It is a review handoff, never a POST.
  const hex = digest(`plan-review:${ctx.config.account}:${ctx.config.mode}:${order.id}:${state.version}`).slice(0, 32).split('');
  hex[12] = '4'; hex[16] = '8';
  const value = hex.join('');
  const nextRequestId = `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
  return { ok: true, requiresReview: true, status: 'plan_changed', purchaseId: order.id, nextRequestId,
    reason: 'Your plan changed since this checkout was created. Review the updated plan and confirm again. No new payment has been started.' };
}

export async function planCycleOperation(action, body, user, ctx) {
  if (!ctx.config.cycleChanges || ctx.config.mode !== 'test' || !ctx.config.ready || !validTestBuyers(ctx.config)
    || !ctx.config.testBuyerIds.some(id => id.toLowerCase() === user.id.toLowerCase())) {
    throw paymentError('Test plan changes are unavailable for this account.', 403);
  }
  if (action === 'quote' && !ctx.config.open) throw paymentError('Online payments open soon.', 503);
  if (!['quote', 'state', 'schedule', 'cancel'].includes(action)) throw paymentError('Unknown plan operation.');
  return billingRpc(ctx.client, 'billing_cycle', { p_action: action, p: {
    userId: user.id, account: ctx.config.account, mode: ctx.config.mode,
    planId: body.planId, intent: body.intent === 'renew' ? 'renew' : undefined,
  } });
}

export async function createPurchase(body, user, ctx) {
  if (!ctx.config.open || !ctx.config.ready) throw paymentError('Online payments open soon.', 503);
  if (ctx.config.mode !== 'live' && (!validTestBuyers(ctx.config) || !ctx.config.testBuyerIds.some(id => id.toLowerCase() === String(user.id).toLowerCase()))) {
    throw paymentError('Test checkout is restricted to designated test accounts.', 403);
  }
  if (!UUID.test(body.requestId || '')) throw paymentError('A stable purchase request ID is required. Reload and try again.');
  const product = paymentProduct(body.productId || body.planId);
  if (!product) throw paymentError('Unknown product.');
  const cycle = ctx.config.cycleChanges && ctx.config.mode === 'test' && product.kind === 'plan';
  if (cycle && !UUID.test(body.quoteId || '')) throw paymentError('Review a current plan quote before paying.');
  const requestHash = digest(JSON.stringify({ productId: product.productId, ...(cycle ? { quoteId: body.quoteId } : {}) }));
  const claim = { userId: user.id, requestId: body.requestId, requestHash,
    snapshot: { ...product, seller: sellerFromEnv(), buyerEmail: user.email, buyerName: String(body.name || '').slice(0, 200) } };
  let order = cycle
    ? await billingRpc(ctx.client, 'billing_cycle', { p_action: 'claim', p: { ...claim, quoteId: body.quoteId, planId: product.planId, account: ctx.config.account, mode: ctx.config.mode } })
    : await orderRpc(ctx, 'claim', claim);
  if (cycle && !['fulfilled', 'review', 'refunded'].includes(order.state) && Date.parse(order.snapshot?.expiresAt || '') <= Date.now()) {
    throw paymentError('This quote expired. Refresh the review before paying.', 409);
  }
  if (!cycle && order.snapshot?.kind === 'plan' && !['fulfilled', 'review', 'refunded'].includes(order.state)) {
    const review = await stalePlanReview(order, user, ctx);
    if (review) return review;
  }
  if (!order.fresh) {
    if (order.provider_order_id || ['fulfilled', 'review', 'refunded'].includes(order.state)) return { ok: true, ...publicPurchase(order), keyId: ctx.config.keyId };
    const retry = await retryRpc(ctx, 'claim', { purchaseId: order.id, userId: user.id });
    order = retry.order;
    if (!retry.canCreate) return { ok: true, ...publicPurchase(order), keyId: ctx.config.keyId };
  }
  let stage = 'provider_create';
  try {
    const provider = await ctx.fetch('/orders', { method: 'POST', body: { amount: Number(order.amount_paise), currency: order.currency,
      receipt: order.id, notes: { purchaseId: order.id } } });
    stage = 'order_bind';
    const saved = await orderRpc(ctx, 'bind', { purchaseId: order.id, order: provider });
    return { ok: true, ...publicPurchase(saved), keyId: ctx.config.keyId };
  } catch (error) {
    // Never log raw errors, provider bodies, buyer data or configuration.
    console.warn('billing_order_creation_failed', {
      stage,
      category: stage === 'order_bind' ? 'binding'
        : ['http', 'timeout', 'transport', 'invalid_response'].includes(error?.paymentFailure) ? error.paymentFailure : 'unknown',
      providerStatus: stage === 'provider_create' && Number.isInteger(error?.providerStatus)
        && error.providerStatus >= 100 && error.providerStatus <= 599 ? error.providerStatus : null,
    });
    if (stage === 'provider_create' && error?.paymentFailure === 'http' && [401, 403].includes(error.providerStatus)) {
      const rejected = await retryRpc(ctx, 'reject', { purchaseId: order.id, userId: user.id,
        leaseToken: order.lease_token, providerStatus: error.providerStatus });
      return { ok: true, ...publicPurchase(rejected), reason: 'Checkout could not start. No payment was initiated. You can retry after the payment configuration is corrected.' };
    }
    await orderRpc(ctx, 'defer', { purchaseId: order.id, leaseToken: order.lease_token });
    return { ok: true, ...publicPurchase(order), status: 'reconciling', pending: true };
  }
}
export async function listPlanPeriods(user, ctx) {
  const periods = await billingRpc(ctx.client, 'billing_plan_periods', { p: {
    userId: user.id, account: ctx.config.account, mode: ctx.config.mode,
  } });
  if (!Array.isArray(periods)) throw paymentError('Plan periods unavailable.', 503);
  return periods;
}
export async function listPurchases(user, ctx) {
  return retryRpc(ctx, 'list', { userId: user.id });
}
export async function ownedPurchase(body, user, ctx) {
  if ((!body.purchaseId || !UUID.test(body.purchaseId)) && (!body.orderId || !ORDER.test(body.orderId))) throw paymentError('Invalid purchase reference.');
  const order = await orderRpc(ctx, 'get', { userId: user.id, purchaseId: body.purchaseId || null, orderId: body.orderId || null });
  if (!order) throw paymentError('Purchase not found.', 404);
  return order;
}
export async function reconcilePayment(order, paymentId, ctx) {
  if (!PAYMENT.test(paymentId || '')) throw paymentError('Invalid payment reference.');
  const pay = await ctx.fetch(`/payments/${encodeURIComponent(paymentId)}`);
  if (pay.id !== paymentId || pay.order_id !== order.provider_order_id || pay.amount !== Number(order.amount_paise) || pay.currency !== 'INR' || typeof pay.status !== 'string') throw paymentError('Payment does not match this purchase.');
  await orderRpc(ctx, 'payment', { purchaseId: order.id, payment: pay });
  if (pay.status !== 'captured') return { ok: false, pending: ['authorized', 'created'].includes(pay.status), status: pay.status, purchaseId: order.id };
  const result = await billingRpc(ctx.client, order.snapshot?.contract === 'cycle-v1' ? 'billing_cycle_capture' : 'billing_capture', { p_order_id: order.id, p_payment: pay });
  return { ...result, purchaseId: order.id, quote: order.snapshot };
}
export async function verifyPurchase(body, user, ctx) {
  const order = await ownedPurchase(body, user, ctx);
  if (body.orderId && body.orderId !== order.provider_order_id) throw paymentError('Order binding mismatch.');
  if (!signatureMatches(`${order.provider_order_id}|${body.paymentId}`, body.signature, ctx.config.keySecret)) throw paymentError('Payment signature mismatch.');
  return reconcilePayment(order, body.paymentId, ctx);
}
export async function purchaseStatus(query, user, ctx) {
  const order = await ownedPurchase(query, user, ctx);
  if (order.state === 'fulfilled') return { ok: true, ...publicPurchase(order) };
  return { ok: true, ...publicPurchase(order) };
}
export async function readRawPaymentBody(req, limit = 131072) {
  // Vercel's lazy body getter parses JSON; its restored stream keeps the signed bytes.
  // Inspect only an already assigned value, never invoke that getter for a webhook.
  const body = Object.getOwnPropertyDescriptor(req, 'body')?.value;
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (raw.length > limit) throw paymentError('Request too large.', 413);
    return raw;
  }
  if (body && typeof body === 'object') throw paymentError('Webhook raw body unavailable.', 400);
  // Vercel replays consumed bodies through these events, not the original iterator.
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, finished = false;
    const finish = error => {
      if (finished) return;
      finished = true;
      if (error) { chunks.length = 0; reject(error); }
      else resolve(Buffer.concat(chunks));
    };
    req.on('data', chunk => {
      if (finished) return;
      size += Buffer.byteLength(chunk);
      if (size > limit) finish(paymentError('Request too large.', 413));
      else chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => finish());
    req.on('error', finish);
    req.on('aborted', () => finish(paymentError('Incomplete request body.', 400)));
  });
}
async function processEvent(event, ctx) {
  const payload = event.payload;
  const pay = payload?.payment?.entity;
  const adjustment = payload?.refund?.entity || payload?.dispute?.entity;
  const paymentId = pay?.id || adjustment?.payment_id;
  let providerPayment;
  if (paymentId && PAYMENT.test(paymentId)) providerPayment = await ctx.fetch(`/payments/${encodeURIComponent(paymentId)}`);
  const orderId = providerPayment?.order_id || payload?.order?.entity?.id;
  if (!ORDER.test(orderId || '')) throw paymentError('Unresolved event order.', 503);
  const order = await orderRpc(ctx, 'get', { orderId });
  if (!order) throw paymentError('Unresolved purchase.', 503);
  // Persist current authoritative facts before processing refunds or capture.
  if (providerPayment) await orderRpc(ctx, 'payment', { purchaseId: order.id, payment: providerPayment });
  if (adjustment) {
    await billingRpc(ctx.client, 'billing_event', { p_action: 'adjustment', p: { account: ctx.config.account, mode: ctx.config.mode,
      paymentId, adjustmentId: adjustment.id, kind: payload?.refund ? 'refund' : 'dispute',
      amountPaise: adjustment.amount, status: adjustment.status || event.event_type } });
  } else if (providerPayment) await reconcilePayment(order, paymentId, ctx);
  else if (payload?.order) {
    const list = await ctx.fetch(`/orders/${encodeURIComponent(orderId)}/payments`);
    if (!Array.isArray(list.items)) throw paymentError('Invalid payment collection.', 502);
    for (const p of list.items.slice(0, 20)) await reconcilePayment(order, p.id, ctx);
  }
}
export async function receivePaymentWebhook(req, ctx) {
  if (!ctx.config.ready || !ctx.config.webhookSecret) throw paymentError('Webhook not configured.', 503);
  const raw = await readRawPaymentBody(req);
  if (!signatureMatches(raw, req.headers['x-razorpay-signature'], ctx.config.webhookSecret)) throw paymentError('Invalid webhook signature.');
  let body; try { body = JSON.parse(raw.toString('utf8')); } catch { throw paymentError('Invalid webhook JSON.'); }
  if (body.account_id !== ctx.config.account || typeof body.event !== 'string' || !body.payload) throw paymentError('Webhook merchant mismatch.');
  const eventId = String(req.headers['x-razorpay-event-id'] || '');
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(eventId)) throw paymentError('Invalid event identity.');
  // Whitelist entity fields: do not persist card/customer/provider response objects.
  const minimal = {};
  for (const kind of ['payment', 'refund', 'dispute', 'order']) {
    const entity = body.payload[kind]?.entity;
    if (entity) minimal[kind] = { entity: Object.fromEntries(['id', 'payment_id', 'order_id', 'amount', 'currency', 'status'].filter(k => entity[k] !== undefined).map(k => [k, entity[k]])) };
  }
  const event = await billingRpc(ctx.client, 'billing_event', { p_action: 'receive', p: { account: ctx.config.account, mode: ctx.config.mode,
    eventId, type: body.event, hash: digest(raw), payload: minimal } });
  if (event.state !== 'done' && event.claimed !== false) {
    try { await processEvent(event, ctx); await billingRpc(ctx.client, 'billing_event', { p_action: 'done', p: { id: event.id, leaseToken: event.lease_token } }); }
    catch { await billingRpc(ctx.client, 'billing_event', { p_action: 'error', p: { id: event.id, leaseToken: event.lease_token, error: 'Provider reconciliation pending' } }); }
  }
  return { ok: true, received: true };
}
export async function recoverPayments(ctx) {
  const deadline = Date.now() + 20000;
  const originalFetch = ctx.fetch;
  ctx = { ...ctx, fetch: async (...args) => {
    if (Date.now() >= deadline) throw paymentError('Recovery work budget reached.', 503);
    return originalFetch(...args);
  } };
  const events = await billingRpc(ctx.client, 'billing_event', { p_action: 'pending', p: { account: ctx.config.account, mode: ctx.config.mode } });
  let completed = 0;
  for (const event of events || []) {
    if (Date.now() >= deadline) break;
    try { await processEvent(event, ctx); await billingRpc(ctx.client, 'billing_event', { p_action: 'done', p: { id: event.id, leaseToken: event.lease_token } }); completed++; }
    catch { await billingRpc(ctx.client, 'billing_event', { p_action: 'error', p: { id: event.id, leaseToken: event.lease_token, error: 'Provider reconciliation pending' } }); }
  }
  const orders = await orderRpc(ctx, 'recovery', { limit: 10 });
  for (const order of orders || []) {
    if (Date.now() >= deadline) break;
    try {
      if (!order.provider_order_id) {
        // Receipt lookup resolves an unknown POST result without repeating POST.
        const list = await ctx.fetch(`/orders?receipt=${encodeURIComponent(order.id)}&count=2`);
        if (!Array.isArray(list.items) || list.items.length !== 1) { await orderRpc(ctx, 'defer', { purchaseId: order.id, leaseToken: order.lease_token }); continue; }
        Object.assign(order, await orderRpc(ctx, 'bind', { purchaseId: order.id, order: list.items[0] }));
      }
      const list = await ctx.fetch(`/orders/${encodeURIComponent(order.provider_order_id)}/payments`);
      if (!Array.isArray(list.items)) throw paymentError('Invalid payment list.', 502);
      for (const pay of list.items.slice(0, 20)) await reconcilePayment(order, pay.id, ctx);
      await orderRpc(ctx, 'defer', { purchaseId: order.id, leaseToken: order.lease_token });
    } catch { await orderRpc(ctx, 'defer', { purchaseId: order.id, leaseToken: order.lease_token }); }
  }
  return { ok: true, eventsProcessed: completed, ordersChecked: orders?.length || 0 };
}
export { TOPUP_PACKS };
