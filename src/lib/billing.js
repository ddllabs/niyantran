/**
 * Checkout / payment helpers: Razorpay Orders for the INR monthly plans
 * (Plus, Pro, Max; open-work F109). No GST is charged: the seller is not
 * GST-registered. Server holds RAZORPAY_KEY_SECRET; browser only gets key id
 * + order id.
 * Every order, verify and invoice call carries the Supabase bearer; the
 * server takes the buyer's identity from it (T5). The browser never grants a
 * plan (F2): /api/billing/verify records the paid period on the server, and
 * the browser then re-reads it. Without Razorpay keys, checkout is off.
 */
import { supabase } from './supabaseClient.js';
import { PUBLIC_PLANS } from './publicPlans.js';
import { normalizePlanId, planOf } from './planEntitlements.js';
import { refreshCredits } from './creditsStore.js';
import { refreshEntitlement } from './entitlementStore.js';
import { sessionUser } from './userStore.js';
import { trackProductEvent } from './productAnalytics.js';

const RAZORPAY_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

async function authHeaders() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

let checkoutScript;
function loadRazorpay() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (checkoutScript) return checkoutScript;
  checkoutScript = new Promise((resolve, reject) => {
    let script = document.querySelector(`script[src="${RAZORPAY_SRC}"]`);
    const fresh = !script;
    script ||= document.createElement('script');
    const timer = setTimeout(() => fail(), 15000);
    const fail = () => { clearTimeout(timer); script.remove(); checkoutScript = null; reject(new Error('Checkout could not load. Check purchase status before retrying.')); };
    script.addEventListener('load', () => { clearTimeout(timer); if (window.Razorpay) resolve(window.Razorpay); else fail(); }, { once: true });
    script.addEventListener('error', fail, { once: true });
    if (fresh) { script.src = RAZORPAY_SRC; script.async = true; document.head.appendChild(script); }
  });
  return checkoutScript;
}

export async function fetchPurchases() {
  try {
    const response = await fetch('/api/billing/purchases', { headers: await authHeaders() });
    const body = await response.json();
    if (!response.ok || !body.ok || !Array.isArray(body.purchases)) throw new Error('Purchase history unavailable.');
    return body.purchases;
  } catch { throw new Error('Purchase history unavailable.'); }
}

export async function fetchPlanPeriods() {
  try {
    const response = await fetch('/api/billing/plan-periods', { headers: await authHeaders() });
    const body = await response.json();
    if (!response.ok || !body.ok || !Array.isArray(body.periods)) throw new Error('Plan periods unavailable.');
    return body.periods;
  } catch { throw new Error('Plan periods unavailable.'); }
}

export async function fetchBillingConfig() {
  try {
    const res = await fetch('/api/billing/config');
    if (!res.ok) return { enabled: false, demoFallback: true, provider: 'razorpay' };
    return await res.json();
  } catch {
    return { enabled: false, demoFallback: true, provider: 'razorpay' };
  }
}

export async function fetchQuote(planId) {
  const q = new URLSearchParams({ planId: String(planId || '') });
  const res = await fetch(`/api/billing/quote?${q}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) return { ok: false, reason: body.reason || 'Could not quote.' };
  return body;
}

/** The signed-in user's invoices, newest first. Failed reads reject, never imply an empty account. */
export async function fetchInvoices() {
  try {
    const res = await fetch('/api/billing/invoices', { headers: await authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok || !Array.isArray(body.invoices)) throw new Error('Invoices unavailable.');
    return body.invoices;
  } catch {
    throw new Error('Invoices unavailable.');
  }
}

export function invoiceUrl(invoiceId) {
  if (!invoiceId) return '';
  return `/api/billing/invoice/${encodeURIComponent(invoiceId)}`;
}

/** Authenticated invoice content for the in-page Preview viewer. */
export async function fetchInvoiceHtml(invoiceId) {
  const url = invoiceUrl(invoiceId);
  if (!url) throw new Error('No invoice.');
  const res = await fetch(url, { headers: await authHeaders() });
  if (!res.ok) throw new Error(res.status === 404 ? 'Invoice not found.' : 'Invoice unavailable.');
  return res.text();
}

/**
 * Opens an invoice in a new tab. The route needs the bearer, which a plain
 * link cannot send, so the HTML is fetched and shown from a blob URL.
 */
export async function openInvoice(invoiceId) {
  const url = invoiceUrl(invoiceId);
  if (!url) return { ok: false, reason: 'No invoice.' };
  try {
    const res = await fetch(url, { headers: await authHeaders() });
    if (!res.ok) return { ok: false, reason: res.status === 404 ? 'Invoice not found.' : 'Invoice unavailable.' };
    const blob = new Blob([await res.text()], { type: 'text/html' });
    const href = URL.createObjectURL(blob);
    window.open(href, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Invoice unavailable.' };
  }
}

function buyerPayload(seat, billing = {}) {
  return { email: seat.email || '', name: billing.buyerName || seat.name || '' };
}

async function openRazorpayCheckout({ keyId, orderId, purchaseId, amount, currency, plan, seat, meta, billing, quote }) {
  const Razorpay = await loadRazorpay();
  const buyer = buyerPayload(seat, billing);
  return new Promise((resolve) => {
    const rzp = new Razorpay({
      key: keyId,
      amount,
      currency: currency || 'INR',
      name: 'Niyantran Terminal',
      description: quote?.label || `${meta?.name || plan} plan · one month`,
      order_id: orderId,
      prefill: {
        name: buyer.name || '',
        email: String(buyer.email || '').includes('@') ? buyer.email : '',
      },
      notes: { plan, userId: seat.id || '' },
      theme: { color: '#012ea1' },
      handler: async (response) => {
        try {
          const verify = await fetch('/api/billing/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
            body: JSON.stringify({
              purchaseId,
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
              planId: plan,
              name: buyer.name,
            }),
          });
          const body = await verify.json().catch(() => ({}));
          if (!verify.ok || !body.ok) {
            resolve({ ok: false, pending: Boolean(body.pending) || verify.status >= 500, purchaseId, reason: body.reason || 'Payment confirmation is pending. Check your purchases before paying again.', mode: 'razorpay' });
            return;
          }
          // The server recorded the paid period; read it back rather than
          // trusting this response.
          await Promise.all([refreshEntitlement(), refreshCredits()]);
          trackProductEvent('plan_upgraded', {
            planId: plan,
            provider: 'razorpay',
            invoiceId: body.invoice?.id || null,
          });
          resolve({
            ok: true,
            user: seat,
            mode: 'razorpay',
            paymentId: response.razorpay_payment_id,
            invoice: body.invoice || null,
            quote: body.quote || quote || null,
          });
        } catch (err) {
          resolve({ ok: false, pending: true, purchaseId, reason: 'Payment confirmation is pending. Check your purchases before paying again.', mode: 'razorpay' });
        }
      },
      modal: {
        ondismiss() {
          resolve({ ok: false, reason: 'Payment cancelled.', mode: 'razorpay' });
        },
      },
    });
    rzp.on('payment.failed', (resp) => {
      const reason = resp?.error?.description || 'Payment failed. Try again or contact support.';
      resolve({ ok: false, reason, mode: 'razorpay' });
    });
    rzp.open();
  });
}

/**
 * Buy one month of a paid plan for the signed-in user.
 * @param {{ planId: string, user?: object, billing?: { buyerName? } }} opts
 */
export async function completeCheckout({ planId, productId, requestId, quoteId, user, billing = {} } = {}) {
  const plan = normalizePlanId(planId);
  if (!productId && plan === 'free') {
    return { ok: false, reason: 'Free is the free plan; there is nothing to buy.', mode: 'free' };
  }
  const seat = user || sessionUser();
  if (!seat?.email) return { ok: false, reason: 'Sign in before upgrading.' };

  const meta = planOf(plan);
  const config = await fetchBillingConfig();
  if (!config.enabled) {
    return {
      ok: false,
      mode: 'disabled',
      reason: 'Online payments open soon. To upgrade now, write to niyantranai@gmail.com.',
    };
  }
  const buyer = buyerPayload(seat, billing);
  const product = productId || `plan-${plan}`;
  const intentKey = `billing-intent:${seat.id}:${product}${quoteId ? `:${quoteId}` : ''}`;
  let stableId = requestId;
  try { stableId ||= sessionStorage.getItem(intentKey); } catch { /* restricted storage */ }
  stableId ||= globalThis.crypto.randomUUID();
  try { sessionStorage.setItem(intentKey, stableId); } catch { /* server remains authoritative */ }
  try {
    const orderRes = await fetch('/api/billing/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ planId: productId ? undefined : plan, productId: product, requestId: stableId, quoteId, name: buyer.name }),
    });
    const order = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !order.ok) {
      return { ok: false, reason: order.reason || 'Could not start Razorpay checkout.', mode: 'razorpay' };
    }
    if (order.requiresReview) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(order.nextRequestId || '')) {
        return { ok: false, pending: true, reason: 'Plan checkout could not be refreshed. Check purchases before retrying.' };
      }
      try { sessionStorage.setItem(intentKey, order.nextRequestId); } catch { /* explicit retry remains server-safe */ }
      await Promise.all([refreshEntitlement(), refreshCredits()]);
      return { ok: false, requiresReview: true, reason: order.reason || 'Your plan changed. Review the updated plan before confirming again.' };
    }
    if (order.status === 'fulfilled') {
      try { sessionStorage.removeItem(intentKey); } catch { /* restricted storage */ }
      await Promise.all([refreshEntitlement(), refreshCredits()]);
      return { ok: true, recovered: true };
    }
    if (!order.orderId) return { ok: false, pending: !order.retryable, retryable: Boolean(order.retryable), purchaseId: order.purchaseId, reason: order.retryable ? (order.reason || 'Checkout did not start. You can retry this purchase.') : 'Purchase confirmation is pending. Check your purchases before paying again.' };
    const outcome = await openRazorpayCheckout({
      keyId: order.keyId || config.keyId,
      orderId: order.orderId,
      purchaseId: order.purchaseId,
      amount: order.amount,
      currency: order.currency,
      plan,
      seat,
      meta,
      billing,
      quote: order.quote,
    });
    if (outcome.ok) { try { sessionStorage.removeItem(intentKey); } catch { /* restricted storage */ } }
    return outcome;
  } catch (err) {
    return { ok: false, reason: err.message || 'Could not open payment gateway.', mode: 'razorpay' };
  }
}

export function checkoutPlans() {
  return PUBLIC_PLANS.filter((p) => p.monthly > 0);
}

export function refreshSessionFromStore() {
  return sessionUser();
}

export function formatInr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number(n || 0) % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

async function paymentOperation(path, body) {
  try {
    const response = await fetch(`/api/billing/${path}`, { method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(await authHeaders()) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    return response.ok ? value : { ok: false, reason: value.reason || 'Payment operation unavailable.' };
  } catch { return { ok: false, reason: 'Payment operation could not be confirmed. Check its status before retrying.' }; }
}
export async function fetchBillingReviews() {
  const result = await paymentOperation('adjustments');
  if (!result.ok || !Array.isArray(result.adjustments)) throw new Error('Payment operations could not be loaded.');
  return result.adjustments;
}
export async function reviewBillingAdjustment(body) { return paymentOperation('adjustments/review', body); }
export async function runBillingRecovery() { return paymentOperation('recover', {}); }

export async function fetchPlanQuote(planId, intent) {
  const query = new URLSearchParams({ planId, ...(intent ? { intent } : {}) });
  return paymentOperation(`plan-quote?${query}`);
}
export async function fetchPlanState() { return paymentOperation('plan-state'); }
export async function scheduleNextPlan(planId) { return paymentOperation('plan-schedule', { planId }); }
export async function cancelNextPlan() { return paymentOperation('plan-cancel', {}); }
