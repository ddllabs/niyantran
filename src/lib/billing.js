/**
 * Checkout / payment helpers — Razorpay Orders + GST tax invoices (CR-17).
 * Server holds RAZORPAY_KEY_SECRET; browser only gets key id + order id.
 * Every order, verify and invoice call carries the Supabase bearer; the
 * server takes the buyer's identity from it (T5). Without keys, a local dev
 * server records a demo invoice; production refuses and nothing is granted.
 */
import { supabase } from './supabaseClient.js';
import { loadPricing } from './pricingStore.js';
import { paidFields, normalizePlanId, planOf } from './planEntitlements.js';
import { sessionUser, setSessionUser } from './userStore.js';
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
    if (!res.ok) return { enabled: false, demoFallback: true, provider: 'razorpay', gstRate: 0.18, states: [] };
    return await res.json();
  } catch {
    return { enabled: false, demoFallback: true, provider: 'razorpay', gstRate: 0.18, states: [] };
  }
}

export async function fetchGstQuote({ planId, yearly = false, buyerGstin = '', buyerStateCode = '' } = {}) {
  const q = new URLSearchParams({
    planId: String(planId || ''),
    yearly: yearly ? '1' : '0',
    buyerGstin: buyerGstin || '',
    buyerStateCode: buyerStateCode || '',
  });
  const res = await fetch(`/api/billing/quote?${q}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) return { ok: false, reason: body.reason || 'Could not quote.' };
  return body;
}

export function invoiceUrl(invoiceId) {
  if (!invoiceId) return '';
  return `/api/billing/invoice/${encodeURIComponent(invoiceId)}`;
}

/**
 * Opens a GST invoice in a new tab. The route needs the bearer, which a plain
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

export function applyPaidPlan(user, planId, yearly = false, paymentMeta = {}) {
  const patch = {
    ...paidFields(planId, yearly),
    lastPaymentId: paymentMeta.paymentId || null,
    lastOrderId: paymentMeta.orderId || null,
    lastInvoiceId: paymentMeta.invoiceId || null,
  };
  const next = { ...user, ...patch };
  setSessionUser(next);
  trackProductEvent('plan_upgraded', {
    planId: patch.plan,
    yearly: Boolean(yearly),
    provider: paymentMeta.provider || 'unknown',
    invoiceId: paymentMeta.invoiceId || null,
  });
  return next;
}

function buyerPayload(seat, billing = {}) {
  return {
    userId: seat.id || '',
    email: seat.email || '',
    name: billing.buyerName || seat.name || '',
    buyerGstin: billing.buyerGstin || '',
    buyerStateCode: billing.buyerStateCode || '',
    buyerAddress: billing.buyerAddress || '',
  };
}

async function openRazorpayCheckout({ keyId, orderId, amount, currency, plan, yearly, seat, meta, billing, quote }) {
  const Razorpay = await loadRazorpay();
  const buyer = buyerPayload(seat, billing);
  return new Promise((resolve) => {
    const rzp = new Razorpay({
      key: keyId,
      amount,
      currency: currency || 'INR',
      name: 'Niyantran Terminal',
      description: `${meta?.name || plan} · ${yearly ? 'yearly' : 'monthly'} · incl. GST`,
      order_id: orderId,
      prefill: {
        name: buyer.name || '',
        email: String(buyer.email || '').includes('@') ? buyer.email : '',
      },
      notes: {
        plan,
        yearly: String(yearly),
        userId: seat.id || '',
        gst: quote ? String(quote.gstAmount) : '',
      },
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
              yearly,
              ...buyer,
            }),
          });
          const body = await verify.json().catch(() => ({}));
          if (!verify.ok || !body.ok) {
            resolve({ ok: false, reason: body.reason || 'Payment could not be verified.', mode: 'razorpay' });
            return;
          }
          const next = applyPaidPlan(seat, plan, yearly, {
            provider: 'razorpay',
            paymentId: response.razorpay_payment_id,
            orderId: response.razorpay_order_id,
            invoiceId: body.invoice?.id || null,
          });
          resolve({
            ok: true,
            user: next,
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
 * Complete a purchase for the signed-in user.
 * @param {{ planId: string, yearly?: boolean, user?: object, billing?: { buyerGstin?, buyerStateCode?, buyerAddress?, buyerName? } }} opts
 */
export async function completeCheckout({ planId, yearly = false, user, billing = {} } = {}) {
  const plan = normalizePlanId(planId);
  if (plan === 'explorer') {
    const patch = { plan: 'explorer', planStatus: 'free', trialEndsAt: null, billingYearly: false };
    const next = { ...(user || sessionUser()), ...patch };
    setSessionUser(next);
    return { ok: true, user: next, mode: 'free' };
  }
  if (plan === 'gov') {
    return { ok: false, reason: 'Government plans are issued by sales — use Contact Sales.', mode: 'sales' };
  }
  const seat = user || sessionUser();
  if (!seat?.email) return { ok: false, reason: 'Sign in before upgrading.' };

  const meta = planOf(plan);
  const config = await fetchBillingConfig();
  const buyer = buyerPayload(seat, billing);

  if (config.enabled) {
    try {
      const orderRes = await fetch('/api/billing/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          planId: plan,
          yearly,
          ...buyer,
        }),
      });
      const order = await orderRes.json().catch(() => ({}));
      if (!orderRes.ok || !order.ok) {
        if (order.demoFallback) {
          /* fall through to demo */
        } else {
          return { ok: false, reason: order.reason || 'Could not start Razorpay checkout.', mode: 'razorpay' };
        }
      } else {
        return openRazorpayCheckout({
          keyId: order.keyId || config.keyId,
          orderId: order.orderId,
          amount: order.amount,
          currency: order.currency,
          plan,
          yearly,
          seat,
          meta,
          billing,
          quote: order.quote,
        });
      }
    } catch (err) {
      return { ok: false, reason: err.message || 'Could not open payment gateway.', mode: 'razorpay' };
    }
  }

  // Demo gateway when keys are missing (local/dev) — still issue a GST invoice.
  // A deployed server refuses it, and then nothing is granted.
  let invoice = null;
  let quote = null;
  try {
    const invRes = await fetch('/api/billing/invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        planId: plan,
        yearly,
        provider: 'demo',
        ...buyer,
      }),
    });
    const invBody = await invRes.json().catch(() => ({}));
    if (invRes.status === 403 && invBody.paymentsDisabled) {
      return { ok: false, mode: 'disabled', reason: invBody.reason || 'Online payments are not enabled yet.' };
    }
    if (invRes.ok && invBody.ok) {
      invoice = invBody.invoice;
      quote = invBody.quote;
    }
  } catch {
    /* non-fatal */
  }

  const next = applyPaidPlan(seat, plan, yearly, {
    provider: 'demo',
    invoiceId: invoice?.id || null,
  });
  return {
    ok: true,
    user: next,
    mode: 'demo',
    invoice,
    quote,
    reason: 'Demo upgrade — GST invoice recorded locally. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env for live checkout.',
  };
}

export function checkoutPlans() {
  return loadPricing().filter((p) => p.id !== 'gov');
}

export function refreshSessionFromStore() {
  return sessionUser();
}

export function formatInr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
