// T5 client half: billing calls carry the Supabase bearer, and an invoice
// opens by fetching its HTML with the bearer (a plain link cannot carry one).
// F2: the browser never grants a plan. Without Razorpay, checkout says payments
// are off; after a verified payment it re-reads the plan from the server.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ token: 'access-1', setSessionUser: null }));
vi.mock('./supabaseClient.js', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: state.token ? { access_token: state.token } : null }, error: null }) } },
}));
vi.mock('./userStore.js', () => ({
  sessionUser: () => ({ id: 'u1', email: 'a@example.test', name: 'A' }),
  setSessionUser: (...args) => state.setSessionUser(...args),
}));
vi.mock('./productAnalytics.js', () => ({ trackProductEvent: () => {} }));
const ent = vi.hoisted(() => ({ refresh: null }));
vi.mock('./entitlementStore.js', () => ({ refreshEntitlement: (...args) => ent.refresh(...args) }));

import { formatInr, completeCheckout, openInvoice, fetchInvoiceHtml, fetchPurchases, fetchInvoices, fetchBillingReviews, fetchPlanPeriods, fetchBillingConfig } from './billing.js';

let calls;
function serve(routes) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    calls.push({ url, init });
    const [status, body, type = 'application/json'] = routes[url.split('?')[0]] || [404, {}];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });
  }));
}

beforeEach(() => {
  state.token = 'access-1';
  state.setSessionUser = vi.fn();
  ent.refresh = vi.fn(async () => ({ plan: 'pro', status: 'active' }));
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  ['/api/billing/purchases', fetchPurchases],
  ['/api/billing/invoices', fetchInvoices],
  ['/api/billing/adjustments', fetchBillingReviews],
])('does not disguise a failed %s read as an empty account', async (path, read) => {
  serve({ [path]: [503, { ok: false, reason: 'Unavailable' }] });
  await expect(read()).rejects.toThrow();
});

describe('completeCheckout without Razorpay', () => {
  it('says payments are off, records no demo invoice and grants nothing', async () => {
    serve({
      '/api/billing/config': [200, { enabled: false, demoFallback: true }],
      '/api/billing/invoice': [200, { ok: true, invoice: { id: 'inv_1', invoiceNo: 'NIY/2627/00001' }, quote: {} }],
    });
    const result = await completeCheckout({ planId: 'pro' });
    expect(result).toMatchObject({ ok: false, mode: 'disabled' });
    expect(result.reason).toMatch(/open soon/);
    expect(calls.map((c) => c.url)).toEqual(['/api/billing/config']);
    expect(state.setSessionUser).not.toHaveBeenCalled();
  });

  it('never marks the session user paid, whatever plan is asked for', async () => {
    serve({ '/api/billing/config': [200, { enabled: false }] });
    for (const planId of ['free', 'plus', 'pro', 'max', 'enterprise']) {
      expect((await completeCheckout({ planId })).ok).toBe(false);
    }
    expect(state.setSessionUser).not.toHaveBeenCalled();
  });
});

describe('openInvoice', () => {
  it('fetches the invoice with the bearer and opens it as a blob', async () => {
    serve({ '/api/billing/invoice/inv_1': [200, '<html>NIY/2627/00001</html>', 'text/html'] });
    const open = vi.fn(() => ({}));
    vi.stubGlobal('window', { open });
    const createObjectURL = vi.fn(() => 'blob:invoice');
    vi.stubGlobal('URL', Object.assign(function URL() {}, { createObjectURL, revokeObjectURL: vi.fn() }));
    const result = await openInvoice('inv_1');
    expect(result).toEqual({ ok: true });
    expect(calls[0].init.headers.Authorization).toBe('Bearer access-1');
    expect(open).toHaveBeenCalledWith('blob:invoice', '_blank', 'noopener');
  });

  it('reports an invoice it cannot open', async () => {
    serve({ '/api/billing/invoice/inv_9': [404, '<p>Invoice not found.</p>', 'text/html'] });
    vi.stubGlobal('window', { open: vi.fn() });
    expect(await openInvoice('inv_9')).toMatchObject({ ok: false });
  });
});


describe('rejected creation retry messaging', () => {
  it.each([true,false])('keeps the stable intent and requires a user click to retry; retryable=%s', async retryable => {
    const values=new Map();vi.stubGlobal('sessionStorage',{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)});
    serve({
      '/api/billing/config':[200,{enabled:true}],
      '/api/billing/create-order':[202,{ok:true,status:retryable?'creation_failed':'reconciling',retryable,purchaseId:'purchase_fixture'}],
    });
    const first=await completeCheckout({productId:'topup-20000'});
    expect(first).toMatchObject({ok:false,pending:!retryable,retryable});
    expect(first.reason).toMatch(retryable?/did not start/:/confirmation is pending/);
    expect(calls.filter(c=>c.url==='/api/billing/create-order')).toHaveLength(1);
    await completeCheckout({productId:'topup-20000'});
    const attempts=calls.filter(c=>c.url==='/api/billing/create-order');
    expect(attempts).toHaveLength(2);
    expect(JSON.parse(attempts[0].init.body).requestId).toBe(JSON.parse(attempts[1].init.body).requestId);
    expect(values.size).toBe(1);
  });
});

it('stores a server-reviewed next plan intent without automatically opening or posting again', async () => {
  const values = new Map();
  vi.stubGlobal('sessionStorage', { getItem: k => values.get(k), setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) });
  const next = 'e0000000-0000-4000-8000-000000000001';
  serve({ '/api/billing/config': [200,{ enabled: true }],
    '/api/billing/create-order': [200,{ ok: true, requiresReview: true, status: 'plan_changed', nextRequestId: next }] });
  const result = await completeCheckout({ planId: 'pro' });
  expect(result.requiresReview).toBe(true);
  expect(values.get('billing-intent:u1:plan-pro')).toBe(next);
  expect(calls.filter(c => c.url === '/api/billing/create-order')).toHaveLength(1);
  expect(ent.refresh).toHaveBeenCalledOnce();
  await completeCheckout({ planId: 'pro' }); // another explicit confirmation
  const posted = calls.filter(c => c.url === '/api/billing/create-order');
  expect(posted).toHaveLength(2);
  expect(JSON.parse(posted[1].init.body).requestId).toBe(next);
});


it('loads owned plan periods with authentication and reports failed reads', async () => {
  serve({ '/api/billing/plan-periods': [200, { ok: true, periods: [{ id: 'period-1', status: 'scheduled' }] }] });
  expect(await fetchPlanPeriods()).toEqual([{ id: 'period-1', status: 'scheduled' }]);
  expect(calls[0].init.headers.Authorization).toBe('Bearer access-1');
  serve({ '/api/billing/plan-periods': [503, { ok: false }] });
  await expect(fetchPlanPeriods()).rejects.toThrow('Plan periods unavailable.');
});

it('loads authenticated invoice HTML for an in-page viewer without opening a popup', async()=>{
 serve({'/api/billing/invoice/inv_inline':[200,'<html>Invoice fixture</html>','text/html']});
 const open=vi.fn();vi.stubGlobal('window',{open});
 expect(await fetchInvoiceHtml('inv_inline')).toBe('<html>Invoice fixture</html>');
 expect(calls[0].init.headers.Authorization).toBe('Bearer access-1');expect(open).not.toHaveBeenCalled();
});

it('removes only zero paise from display without rounding genuine charges to rupees', () => {
  expect(formatInr(999)).toBe('₹999');
  expect(formatInr(0)).toBe('₹0');
  expect(formatInr(599.74)).toBe('₹599.74');
  expect(formatInr(599.7)).toBe('₹599.70');
});

it('distinguishes a failed configuration read from known disabled payments',async()=>{
 serve({'/api/billing/config':[503,{}]});
 expect(await fetchBillingConfig()).toMatchObject({enabled:false,unavailable:true});
 serve({'/api/billing/config':[200,{enabled:false,cycleChanges:false}]});
 expect(await fetchBillingConfig()).toEqual({enabled:false,cycleChanges:false});
});

it.each([null,{}])('fails closed with an explicit error for malformed billing configuration %s',async body=>{
 serve({'/api/billing/config':[200,body]});
 expect(await fetchBillingConfig()).toMatchObject({enabled:false,unavailable:true});
 const result=await completeCheckout({planId:'pro'});
 expect(result.reason).toContain('could not be loaded');
 expect(calls.every(c=>c.url==='/api/billing/config')).toBe(true);
});
