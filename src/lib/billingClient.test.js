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

import { completeCheckout, openInvoice } from './billing.js';

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
  ent.refresh = vi.fn(async () => ({ plan: 'professional', status: 'active' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('completeCheckout without Razorpay', () => {
  it('says payments are off, records no demo invoice and grants nothing', async () => {
    serve({
      '/api/billing/config': [200, { enabled: false, demoFallback: true }],
      '/api/billing/invoice': [200, { ok: true, invoice: { id: 'inv_1', invoiceNo: 'NIY/2627/00001' }, quote: {} }],
    });
    const result = await completeCheckout({ planId: 'pro' });
    expect(result).toMatchObject({ ok: false, mode: 'disabled' });
    expect(result.reason).toMatch(/not enabled/);
    expect(calls.map((c) => c.url)).toEqual(['/api/billing/config']);
    expect(state.setSessionUser).not.toHaveBeenCalled();
  });

  it('never marks the session user paid, whatever plan is asked for', async () => {
    serve({ '/api/billing/config': [200, { enabled: false }] });
    for (const planId of ['explorer', 'pro', 'enterprise', 'gov']) {
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
