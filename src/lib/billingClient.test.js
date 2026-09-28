// T5 client half: billing calls carry the Supabase bearer, a refused demo
// record never grants a paid plan in the browser, and an invoice opens by
// fetching its HTML with the bearer (a plain link cannot carry one).
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
});
afterEach(() => vi.unstubAllGlobals());

describe('completeCheckout without Razorpay', () => {
  it('reports that payments are off when the server refuses the demo record, and grants nothing', async () => {
    serve({
      '/api/billing/config': [200, { enabled: false, demoFallback: true }],
      '/api/billing/invoice': [403, { ok: false, paymentsDisabled: true, reason: 'Online payments are not enabled on this deployment yet.' }],
    });
    const result = await completeCheckout({ planId: 'pro' });
    expect(result).toMatchObject({ ok: false, mode: 'disabled' });
    expect(result.reason).toMatch(/not enabled/);
    expect(state.setSessionUser).not.toHaveBeenCalled();
  });

  it('sends the bearer with the demo record', async () => {
    serve({
      '/api/billing/config': [200, { enabled: false, demoFallback: true }],
      '/api/billing/invoice': [200, { ok: true, invoice: { id: 'inv_1', invoiceNo: 'NIY/2627/00001' }, quote: {} }],
    });
    const result = await completeCheckout({ planId: 'pro' });
    expect(result.ok).toBe(true);
    const post = calls.find((c) => c.url === '/api/billing/invoice');
    expect(post.init.headers.Authorization).toBe('Bearer access-1');
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
