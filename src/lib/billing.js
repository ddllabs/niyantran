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

function loadRazorpay() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${RAZORPAY_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Razorpay));
      existing.addEventListener('error', () => reject(new Error('Razorpay failed to load')));
      return;
    }
    const s = document.createElement('script');
    s.src = RAZORPAY_SRC;
    s.async = true;
    s.onload = () => resolve(window.Razorpay);
    s.onerror = () => reject(new Error('Razorpay failed to load'));
    document.head.appendChild(s);
  });
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

/** The signed-in user's invoices, newest first, or [] when unavailable. */
export async function fetchInvoices() {
  try {
    const res = await fetch('/api/billing/invoices', { headers: await authHeaders() });
    const body = await res.json().catch(() => ({}));
    return res.ok && body.ok && Array.isArray(body.invoices) ? body.invoices : [];
  } catch {
    return [];
  }
}

export function invoiceUrl(invoiceId) {
  if (!invoiceId) return '';
  return `/api/billing/invoice/${encodeURIComponent(invoiceId)}`;
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

async function openRazorpayCheckout({ keyId, orderId, amount, currency, plan, seat, meta, billing, quote }) {
  const Razorpay = await loadRazorpay();
  const buyer = buyerPayload(seat, billing);
  return new Promise((resolve) => {
    const rzp = new Razorpay({
      key: keyId,
      amount,
      currency: currency || 'INR',
      name: 'Niyantran Terminal',
      description: `${meta?.name || plan} plan · one month`,
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
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
              planId: plan,
              name: buyer.name,
            }),
          });
          const body = await verify.json().catch(() => ({}));
          if (!verify.ok || !body.ok) {
            resolve({ ok: false, reason: body.reason || 'Payment could not be verified.', mode: 'razorpay' });
            return;
          }
          // The server recorded the paid period; read it back rather than
          // trusting this response.
          await refreshEntitlement();
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
          resolve({ ok: false, reason: err.message || 'Verification failed.', mode: 'razorpay' });
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
export async function completeCheckout({ planId, user, billing = {} } = {}) {
  const plan = normalizePlanId(planId);
  if (plan === 'free') {
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
  try {
    const orderRes = await fetch('/api/billing/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ planId: plan, name: buyer.name }),
    });
    const order = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !order.ok) {
      return { ok: false, reason: order.reason || 'Could not start Razorpay checkout.', mode: 'razorpay' };
    }
    return openRazorpayCheckout({
      keyId: order.keyId || config.keyId,
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      plan,
      seat,
      meta,
      billing,
      quote: order.quote,
    });
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
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
