/**
 * Razorpay billing API + GST tax invoices (CR-17).
 *
 *   GET  /api/billing/config
 *   GET  /api/billing/quote?planId=&yearly=&buyerGstin=&buyerStateCode=
 *   POST /api/billing/create-order   { planId, yearly, userId, email, name, buyerGstin?, buyerStateCode?, buyerAddress? }
 *   POST /api/billing/verify        { orderId, paymentId, signature, planId, yearly, userId, email, name, buyer* }
 *   POST /api/billing/invoice       { planId, yearly, email, name, …, provider?, paymentId?, orderId? }  // demo/record
 *   GET  /api/billing/invoices
 *   GET  /api/billing/invoice/:id   HTML tax invoice
 *
 * A verified payment grants its paid period through grant_paid_plan() (F2,
 * docs/specs/2026-09-29-f2-entitlements.md); nothing else here grants a plan.
 *
 * Invoices live in Supabase public.invoices (T5, ADR 0005). Every route but
 * config and quote needs a verified bearer, and the buyer's identity comes
 * from it, never from the body. Reads run as the caller, so RLS decides what
 * they may see; writes go through issue_invoice() with the server key, which
 * numbers the invoice gaplessly per financial year.
 */
import crypto from 'crypto';
import { loadEnv } from './loadEnv.mjs';
import { getSupabaseAdminClient } from './authEmailProvider.mjs';
import { authorizeLocalUser, localClientForToken } from './usersApi.mjs';
import { isServerlessHost } from './writableRoot.mjs';
import {
  computeGstQuote,
  newInvoiceId,
  renderInvoiceHtml,
  sellerFromEnv,
  STATE_CODES,
} from './gstBilling.mjs';

loadEnv();

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function html(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') {
    try {
      return Promise.resolve(req.body ? JSON.parse(req.body) : {});
    } catch (err) {
      return Promise.reject(err);
    }
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function keys() {
  const keyId = String(process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || '').trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
  return { keyId, keySecret, enabled: Boolean(keyId && keySecret) };
}

async function razorpayFetch(path, { method = 'GET', body } = {}) {
  const { keyId, keySecret } = keys();
  if (!keyId || !keySecret) throw new Error('Razorpay keys are not configured.');
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.description || data?.error?.reason || `Razorpay ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function verifySignature(orderId, paymentId, signature) {
  const { keySecret } = keys();
  const expected = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature || '')));
  } catch {
    return false;
  }
}

function quoteFromBody(body) {
  return computeGstQuote({
    planId: body.planId,
    yearly: body.yearly,
    buyerGstin: body.buyerGstin || body.gstin,
    buyerStateCode: body.buyerStateCode || body.stateCode,
  });
}

function num(v) {
  return v == null ? v : Number(v);
}

function rowToInvoice(r) {
  const payload = r.payload && typeof r.payload === 'object' ? r.payload : {};
  return {
    id: r.id,
    invoiceNo: r.invoice_no,
    email: r.user_email,
    userId: r.user_id,
    planId: r.plan_id,
    yearly: Boolean(r.yearly),
    currency: r.currency,
    taxable: num(r.taxable),
    cgst: num(r.cgst),
    sgst: num(r.sgst),
    igst: num(r.igst),
    total: num(r.total),
    taxSplit: r.tax_split,
    usdList: num(r.usd_list),
    usdToInr: num(r.usd_to_inr),
    buyerName: r.buyer_name,
    buyerGstin: r.buyer_gstin,
    buyerStateCode: r.buyer_state_code,
    buyerAddress: r.buyer_address,
    paymentId: r.payment_id,
    orderId: r.order_id,
    provider: r.provider,
    issuedAt: r.issued_at,
    ...payload,
  };
}

function bearerToken(req) {
  const match = /^Bearer ([^\s,]+)$/i.exec(String(req.headers?.authorization || ''));
  return match ? match[1] : '';
}

/** Issues one invoice for a verified buyer. The database assigns the number. */
async function persistInvoice({ quote, buyer, payment }, deps) {
  const seller = sellerFromEnv();
  const buyerStateCode = quote.buyerStateCode || '';
  const { data, error } = await deps.adminClient().rpc('issue_invoice', {
    p: {
      id: newInvoiceId(),
      user_id: buyer.userId,
      user_email: buyer.email,
      plan_id: quote.planId,
      yearly: Boolean(quote.yearly),
      taxable: quote.taxable,
      cgst: quote.cgst,
      sgst: quote.sgst,
      igst: quote.igst,
      total: quote.total,
      tax_split: quote.taxSplit,
      usd_list: quote.usdList,
      usd_to_inr: quote.usdToInr,
      buyer_name: buyer.name || '',
      buyer_gstin: buyer.gstin || '',
      buyer_state_code: buyerStateCode,
      buyer_address: buyer.address || '',
      payment_id: payment?.paymentId || '',
      order_id: payment?.orderId || '',
      provider: payment?.provider || 'razorpay',
      payload: {
        planLabel: quote.planLabel,
        period: quote.period,
        sac: quote.sac,
        sacDesc: quote.sacDesc,
        buyerEmail: buyer.email,
        buyerStateName: STATE_CODES[buyerStateCode] || '',
        sellerGstin: seller.gstin,
      },
    },
  });
  if (error) {
    const err = new Error(error.code === '23505' ? 'An invoice already exists for this payment.' : 'Could not record the invoice.');
    err.status = error.code === '23505' ? 409 : 503;
    throw err;
  }
  return rowToInvoice(data);
}

/** Records the paid period on the profile (service role only). Returns my_entitlement's shape. */
async function grantPaidPlan({ userId, quote, paymentId }, deps) {
  const { data, error } = await deps.adminClient().rpc('grant_paid_plan', {
    p_user: userId,
    p_plan: quote.planId,
    p_period: quote.yearly ? 'year' : 'month',
    p_payment_id: paymentId,
  });
  if (error) {
    const err = new Error('The payment was verified but the plan could not be recorded. Try again, or contact support with the payment id.');
    err.status = 503;
    throw err;
  }
  return data;
}

function buyerFrom(body, caller) {
  return {
    email: caller.email,
    userId: caller.id,
    name: body.name,
    gstin: body.buyerGstin || body.gstin,
    address: body.buyerAddress,
  };
}

/** The Razorpay order must be the caller's, for this plan and period, at the quoted amount. */
function orderMatches(order, quote, caller) {
  const notes = order?.notes || {};
  return (
    String(notes.userId || '') === caller.id &&
    String(notes.planId || '') === quote.planId &&
    String(notes.yearly ?? '') === String(Boolean(quote.yearly)) &&
    Number(order?.amount) === quote.amountPaise
  );
}

function resolveDeps(deps = {}) {
  return {
    adminClient: deps.adminClient || getSupabaseAdminClient,
    clientForToken: deps.clientForToken || localClientForToken,
    razorpayFetch: deps.razorpayFetch || razorpayFetch,
    verifySignature: deps.verifySignature || verifySignature,
    serverless: deps.serverless ?? isServerlessHost(),
    razorpayEnabled: deps.razorpayEnabled ?? keys().enabled,
  };
}

export async function handleBillingApi(req, res, url, deps = {}) {
  if (!url.pathname.startsWith('/api/billing')) return false;
  const d = resolveDeps(deps);
  const caller = () => authorizeLocalUser(req, res, { clientForToken: d.clientForToken });

  if (url.pathname === '/api/billing/config' && req.method === 'GET') {
    const { keyId, enabled } = keys();
    const seller = sellerFromEnv();
    json(res, {
      provider: 'razorpay',
      enabled,
      keyId: enabled ? keyId : '',
      currency: 'INR',
      usdToInr: Number(process.env.BILLING_USD_INR || 83),
      gstRate: 0.18,
      sac: seller.sac,
      sellerStateCode: seller.stateCode,
      sellerGstinConfigured: Boolean(seller.gstin),
      demoFallback: !enabled,
      states: Object.entries(STATE_CODES).map(([code, name]) => ({ code, name })),
    });
    return true;
  }

  if (url.pathname === '/api/billing/quote' && req.method === 'GET') {
    const quote = computeGstQuote({
      planId: url.searchParams.get('planId'),
      yearly: url.searchParams.get('yearly') === '1' || url.searchParams.get('yearly') === 'true',
      buyerGstin: url.searchParams.get('buyerGstin') || '',
      buyerStateCode: url.searchParams.get('buyerStateCode') || '',
    });
    if (!quote) {
      json(res, { ok: false, reason: 'Unknown plan.' }, 400);
      return true;
    }
    json(res, { ok: true, quote, seller: sellerFromEnv() });
    return true;
  }

  if (url.pathname === '/api/billing/create-order' && req.method === 'POST') {
    const who = await caller();
    if (!who) return true;
    try {
      const body = await readBody(req);
      const quote = quoteFromBody(body);
      if (!quote) {
        json(res, { ok: false, reason: 'Unknown plan.' }, 400);
        return true;
      }
      if (!d.razorpayEnabled) {
        json(res, { ok: false, reason: 'Razorpay is not configured on this server.', demoFallback: true, quote }, 503);
        return true;
      }
      const receipt = `niy_${quote.planId}_${Date.now()}`.slice(0, 40);
      const order = await d.razorpayFetch('/orders', {
        method: 'POST',
        body: {
          amount: quote.amountPaise,
          currency: 'INR',
          receipt,
          notes: {
            planId: quote.planId,
            yearly: String(quote.yearly),
            userId: who.id,
            email: who.email,
            taxable: String(quote.taxable),
            gst: String(quote.gstAmount),
            taxSplit: quote.taxSplit,
          },
        },
      });
      json(res, {
        ok: true,
        keyId: keys().keyId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency || 'INR',
        planId: quote.planId,
        yearly: quote.yearly,
        quote,
      });
    } catch (err) {
      json(res, { ok: false, reason: err.message || 'Could not create order.' }, err.status || 500);
    }
    return true;
  }

  if (url.pathname === '/api/billing/verify' && req.method === 'POST') {
    const who = await caller();
    if (!who) return true;
    try {
      const body = await readBody(req);
      const orderId = String(body.orderId || '');
      const paymentId = String(body.paymentId || '');
      const signature = String(body.signature || '');
      if (!orderId || !paymentId || !signature) {
        json(res, { ok: false, reason: 'Missing payment fields.' }, 400);
        return true;
      }
      if (!d.verifySignature(orderId, paymentId, signature)) {
        json(res, { ok: false, reason: 'Payment signature mismatch.' }, 400);
        return true;
      }
      const quote = quoteFromBody(body);
      if (!quote) {
        json(res, { ok: false, reason: 'Unknown plan.' }, 400);
        return true;
      }
      // The signature proves the payment belongs to this order; the order
      // proves who it was for, which plan, and how much was paid.
      const order = await d.razorpayFetch(`/orders/${encodeURIComponent(orderId)}`);
      if (!orderMatches(order, quote, who)) {
        json(res, { ok: false, reason: 'Payment does not match the order.' }, 400);
        return true;
      }
      const payment = await d.razorpayFetch(`/payments/${encodeURIComponent(paymentId)}`);
      if (payment?.status && payment.status !== 'captured' && payment.status !== 'authorized') {
        json(res, { ok: false, reason: `Payment status is ${payment.status}.` }, 400);
        return true;
      }
      // Grant first (F2): the grant is idempotent per payment id, and the
      // invoice is refused for a payment it has already covered, so a retry
      // after either step fails completes both and never extends twice.
      const entitlement = await grantPaidPlan({ userId: who.id, quote, paymentId }, d);
      let invoice = null;
      try {
        invoice = await persistInvoice({
          quote,
          buyer: buyerFrom(body, who),
          payment: { paymentId, orderId, provider: 'razorpay' },
        }, d);
      } catch (err) {
        if (err.status !== 409) throw err;
      }
      json(res, { ok: true, planId: quote.planId, yearly: quote.yearly, orderId, paymentId, invoice, quote, entitlement });
    } catch (err) {
      json(res, { ok: false, reason: err.message || 'Verification failed.' }, err.status || 500);
    }
    return true;
  }

  // Demo record, for local development without Razorpay keys. A serverless
  // host (production or a preview, both on the live database) refuses it.
  if (url.pathname === '/api/billing/invoice' && req.method === 'POST') {
    const who = await caller();
    if (!who) return true;
    if (d.serverless) {
      json(res, { ok: false, reason: 'Online payments are not enabled on this deployment yet.', paymentsDisabled: true }, 403);
      return true;
    }
    try {
      const body = await readBody(req);
      const quote = quoteFromBody(body);
      if (!quote) {
        json(res, { ok: false, reason: 'Unknown plan.' }, 400);
        return true;
      }
      const invoice = await persistInvoice({ quote, buyer: buyerFrom(body, who), payment: { provider: 'demo' } }, d);
      json(res, { ok: true, invoice, quote });
    } catch (err) {
      json(res, { ok: false, reason: err.message || 'Could not create invoice.' }, err.status || 500);
    }
    return true;
  }

  if (url.pathname === '/api/billing/invoices' && req.method === 'GET') {
    const who = await caller();
    if (!who) return true;
    // The caller's own invoices. An `email` parameter is ignored, and the
    // explicit user filter keeps an admin's list to their own.
    const { data, error } = await d
      .clientForToken(bearerToken(req))
      .from('invoices')
      .select('*')
      .eq('user_id', who.id)
      .order('issued_at', { ascending: false })
      .limit(50);
    if (error) {
      json(res, { ok: false, reason: 'Invoices unavailable.' }, 503);
      return true;
    }
    json(res, { ok: true, invoices: (data || []).map(rowToInvoice) });
    return true;
  }

  const invMatch = url.pathname.match(/^\/api\/billing\/invoice\/([^/]+)$/);
  if (invMatch && req.method === 'GET') {
    const who = await caller();
    if (!who) return true;
    const ref = decodeURIComponent(invMatch[1]);
    const column = /^inv_[a-z0-9_]{1,60}$/.test(ref) ? 'id' : /^NIY\/\d{4}\/\d{5}$/.test(ref) ? 'invoice_no' : '';
    // Read as the caller: RLS returns the row only to its owner or an admin.
    const found = column
      ? await d.clientForToken(bearerToken(req)).from('invoices').select('*').eq(column, ref).maybeSingle()
      : { data: null, error: null };
    if (found.error) {
      html(res, '<p>Invoice unavailable.</p>', 503);
      return true;
    }
    if (!found.data) {
      html(res, '<p>Invoice not found.</p>', 404);
      return true;
    }
    html(res, renderInvoiceHtml(rowToInvoice(found.data), sellerFromEnv()));
    return true;
  }

  json(res, { ok: false, reason: 'Not found.' }, 404);
  return true;
}

export function billingApiPlugin() {
  return {
    name: 'niyantran-billing-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const host = req.headers.host || 'localhost';
          const url = new URL(req.url || '/', `http://${host}`);
          if (!(await handleBillingApi(req, res, url))) next();
        } catch (err) {
          next(err);
        }
      });
    },
  };
}
