/**
 * Server-owned Razorpay purchases: immutable order snapshots, captured-only
 * fulfilment, signed raw-byte webhooks and owned status/invoice reads.
 * Recovery and reviewed adjustments require a verified platform administrator.
 * New checkout is closed by default; disabling it never disables paid recovery.
 * Customer financial effects use atomic service-only billing RPCs. Demo writes
 * are disabled, including local previews which could share the live database.
 */
import { loadEnv } from './loadEnv.mjs';
import { getSupabaseAdminClient } from './authEmailProvider.mjs';
import { authorizeLocalUser, localClientForToken } from './usersApi.mjs';
import { computeQuote, renderInvoiceHtml, sellerFromEnv } from './inrBilling.mjs';
import { createPurchase, listPurchases, listPlanPeriods, verifyPurchase, purchaseStatus, receivePaymentWebhook, recoverPayments, paymentContext, paymentConfig, checkoutEnabled, billingRpc, readRawPaymentBody, TOPUP_PACKS, planCycleOperation } from './paymentService.mjs';

loadEnv();

// Fixed categories only: provider requests and arbitrary exception text are private.
const WEBHOOK_REJECTION_STAGE = new Map([
  ['Webhook raw body unavailable.', 'raw_body'], ['Incomplete request body.', 'raw_body'],
  ['Request too large.', 'body_size'], ['Invalid webhook signature.', 'signature'],
  ['Invalid webhook JSON.', 'json'], ['Webhook merchant mismatch.', 'merchant_payload'],
  ['Invalid event identity.', 'event_identity'], ['Webhook not configured.', 'configuration'],
]);

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
    currency: r.currency,
    total: num(r.total),
    buyerName: r.buyer_name,
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

function resolveDeps(deps = {}) {
  return {
    adminClient: deps.adminClient || getSupabaseAdminClient,
    clientForToken: deps.clientForToken || localClientForToken,
    razorpayFetch: deps.razorpayFetch,
    paymentConfig: deps.paymentConfig || paymentConfig(),
  };
}

export async function handleBillingApi(req, res, url, deps = {}) {
  if (!url.pathname.startsWith('/api/billing')) return false;
  const d = resolveDeps(deps);
  const caller = () => authorizeLocalUser(req, res, { clientForToken: d.clientForToken });

  if (url.pathname === '/api/billing/config' && req.method === 'GET') {
    const enabled = checkoutEnabled(d.paymentConfig);
    json(res, {
      provider: 'razorpay',
      enabled,
      checkoutOpen: d.paymentConfig.open,
      keyId: enabled ? d.paymentConfig.keyId : '',
      topups: TOPUP_PACKS,
      currency: 'INR',
      cycleChanges: Boolean(d.paymentConfig.cycleChanges && ['test', 'live'].includes(d.paymentConfig.mode)),
      gstRegistered: false,
      demoFallback: !enabled,
    });
    return true;
  }

  if (url.pathname === '/api/billing/quote' && req.method === 'GET') {
    const quote = computeQuote({ planId: url.searchParams.get('planId') });
    if (!quote) {
      json(res, { ok: false, reason: 'Unknown plan.' }, 400);
      return true;
    }
    json(res, { ok: true, quote, seller: sellerFromEnv() });
    return true;
  }

  const cycleRoute = url.pathname.match(/^\/api\/billing\/plan-(quote|state|schedule|cancel)$/);
  if (cycleRoute) {
    try {
      const action = cycleRoute[1];
      if (req.method !== (['quote', 'state'].includes(action) ? 'GET' : 'POST')) { json(res, { ok: false, reason: 'Method not allowed.' }, 405); return true; }
      const who = await caller(); if (!who) return true;
      const body = req.method === 'GET' ? Object.fromEntries(url.searchParams)
        : req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : JSON.parse((await readRawPaymentBody(req, 16384)).toString('utf8'));
      const result = await planCycleOperation(action, body, who, paymentContext(d));
      json(res, { ok: true, ...(action === 'quote' ? { quote: result } : result) });
    } catch (error) { json(res, { ok: false, reason: error.status ? error.message : 'Plan change could not be confirmed. Refresh before retrying.' }, error.status || 503); }
    return true;
  }

  const purchaseRoute = ['/api/billing/create-order', '/api/billing/verify', '/api/billing/order-status', '/api/billing/purchases', '/api/billing/plan-periods', '/api/billing/webhook', '/api/billing/recover', '/api/billing/adjustments', '/api/billing/adjustments/review'].includes(url.pathname);
  if (purchaseRoute) {
    try {
      const webhook = url.pathname === '/api/billing/webhook';
      if (req.method !== (url.pathname.endsWith('order-status') || url.pathname.endsWith('/purchases') || url.pathname.endsWith('/plan-periods') || url.pathname.endsWith('/adjustments') ? 'GET' : 'POST')) {
        json(res, { ok: false, reason: 'Method not allowed.' }, 405); return true;
      }
      const who = webhook ? null : await caller();
      if (!webhook && !who) return true;
      if (/\/(recover|adjustments)(\/review)?$/.test(url.pathname)) {
        const admin = await d.clientForToken(bearerToken(req)).rpc('is_platform_admin');
        if (admin.error || admin.data !== true) { json(res, { ok: false, reason: 'Administrator required.' }, 403); return true; }
      }
      const ctx = paymentContext(d);
      let result;
      if (webhook) result = await receivePaymentWebhook(req, ctx);
      else if (url.pathname.endsWith('/plan-periods')) result = { ok: true, periods: await listPlanPeriods(who, ctx) };
      else if (url.pathname.endsWith('/purchases')) result = { ok: true, purchases: await listPurchases(who, ctx) };
      else if (url.pathname.endsWith('/order-status')) result = await purchaseStatus(Object.fromEntries(url.searchParams), who, ctx);
      else if (url.pathname.endsWith('/recover')) result = await recoverPayments(ctx);
      else if (url.pathname.endsWith('/adjustments')) result = { ok: true, adjustments: await billingRpc(ctx.client, 'billing_event', { p_action: 'reviews', p: { account: ctx.config.account, mode: ctx.config.mode } }) };
      else {
        const body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : JSON.parse((await readRawPaymentBody(req, 16384)).toString('utf8'));
        if (Buffer.byteLength(JSON.stringify(body)) > 16384) { json(res, { ok: false, reason: 'Request too large.' }, 413); return true; }
        if (url.pathname.endsWith('/create-order')) result = await createPurchase(body, who, ctx);
        else if (url.pathname.endsWith('/review')) result = { ok: true, adjustment: await billingRpc(ctx.client, 'billing_review_adjustment_v2', { p: { ...body, actorId: who.id, account: ctx.config.account, mode: ctx.config.mode } }) };
        else result = await verifyPurchase(body, who, ctx);
      }
      if (result.invoice) result.invoice = rowToInvoice(result.invoice);
      json(res, result, result.pending ? 202 : 200);
    } catch (err) {
      if (url.pathname === '/api/billing/webhook' && d.paymentConfig.mode === 'test') {
        console.warn('billing_webhook_rejected', {
          stage: WEBHOOK_REJECTION_STAGE.get(err.message) || 'processing',
          status: Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 503,
        });
      }
      json(res, { ok: false, reason: err.status ? err.message : 'Purchase processing is pending. Check purchase status before retrying.' }, err.status || 503);
    }
    return true;
  }

  if (url.pathname === '/api/billing/invoice' && req.method === 'POST') {
    if (!(await caller())) return true;
    json(res, { ok: false, reason: 'Demo invoices are disabled.', paymentsDisabled: true }, 403);
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
    html(res, renderInvoiceHtml(rowToInvoice(found.data)));
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
