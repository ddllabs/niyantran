// T5 (docs/specs/2026-09-28-t5-invoices-to-supabase.md): invoices live in
// Supabase, every billing route but config and quote needs a verified bearer,
// identity comes from that bearer, and verify checks the Razorpay order.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db.mjs', () => {
  const refuse = () => { throw new Error('billing must not use SQLite'); };
  return { getDb: vi.fn(refuse), queryAll: vi.fn(refuse), run: vi.fn(refuse) };
});
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => { throw new Error('tests must inject their clients'); }),
}));

import { handleBillingApi } from '../../server/billingApi.mjs';

const A = { id: '00000000-0000-4000-8000-0000000000a1', email: 'a@example.test', token: 'token-a' };
const B = { id: '00000000-0000-4000-8000-0000000000b2', email: 'b@example.test', token: 'token-b' };
const ADMIN = { id: '00000000-0000-4000-8000-0000000000c3', email: 'admin@example.test', token: 'token-admin', admin: true };
const PEOPLE = [A, B, ADMIN];

function row(id, owner, n) {
  return {
    id, invoice_no: `NIY/2627/0000${n}`, financial_year: '2627', seq: n, user_id: owner.id, user_email: owner.email,
    plan_id: 'pro', yearly: false, currency: 'INR', taxable: 1000, cgst: 90, sgst: 90, igst: 0, total: 1180,
    tax_split: 'cgst_sgst', usd_list: 12, usd_to_inr: 83, buyer_name: 'Buyer', buyer_gstin: null, buyer_state_code: '29',
    buyer_address: null, payment_id: `pay_${n}`, order_id: `order_${n}`, provider: 'razorpay', payload: { planLabel: 'Pro' },
    issued_at: '2026-09-28T10:00:00Z',
  };
}

let invoices;
let issued;
let granted;
let grantError;

// A user-scoped client whose reads apply the same rule as the RLS policy.
function userClient(token) {
  const who = PEOPLE.find((p) => p.token === token);
  const visible = () => invoices.filter((r) => who && (r.user_id === who.id || who.admin));
  return {
    auth: { getUser: vi.fn(async () => (who ? { data: { user: { id: who.id, email: who.email } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } })) },
    rpc: vi.fn(async (name) => ({ data: name === 'is_platform_admin' ? Boolean(who?.admin) : { user_id: who?.id, role: who?.admin ? 'admin' : 'user', status: 'active' }, error: null })),
    from: vi.fn(() => {
      const filters = [];
      const chain = {
        select: () => chain,
        eq: (col, val) => { filters.push([col, val]); return chain; },
        order: () => chain,
        limit: async () => ({ data: visible().filter((r) => filters.every(([c, v]) => r[c] === v)), error: null }),
        maybeSingle: async () => ({ data: visible().find((r) => filters.every(([c, v]) => r[c] === v)) || null, error: null }),
      };
      return chain;
    }),
  };
}

function adminClient() {
  return {
    rpc: vi.fn(async (name, args) => {
      if (name === 'grant_paid_plan') {
        if (grantError) return { data: null, error: grantError };
        granted.push(args);
        return { data: { plan: 'professional', status: 'active', period_end: '2026-10-29T10:00:00Z', source: 'payment' }, error: null };
      }
      if (name !== 'issue_invoice') throw new Error(`unexpected rpc ${name}`);
      issued.push(args.p);
      const n = invoices.length + 1;
      const saved = { ...row(args.p.id, { id: args.p.user_id, email: args.p.user_email }, n), ...args.p, invoice_no: `NIY/2627/0000${n}` };
      invoices.push(saved);
      return { data: saved, error: null };
    }),
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) })),
  };
}

function razorpay({ order = {}, payment = { status: 'captured' } } = {}) {
  return vi.fn(async (path, init = {}) => {
    if (path === '/orders' && init.method === 'POST') return { id: 'order_new', amount: init.body.amount, currency: 'INR', notes: init.body.notes };
    if (path.startsWith('/orders/')) return { id: path.split('/')[2], ...order };
    if (path.startsWith('/payments/')) return payment;
    throw new Error(`unexpected razorpay ${path}`);
  });
}

function deps(extra = {}) {
  return { adminClient, clientForToken: userClient, razorpayFetch: razorpay(), serverless: false, razorpayEnabled: true, ...extra };
}

function request(method, path, { body, as } = {}) {
  return { method, url: path, headers: { host: 'localhost', ...(as ? { authorization: `Bearer ${as.token}` } : {}) }, body };
}

async function call(req, d = deps()) {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end: vi.fn() };
  const url = new URL(req.url, 'http://localhost');
  await handleBillingApi(req, res, url, d);
  const raw = res.end.mock.calls[0]?.[0] || '';
  const isJson = String(res.headers['content-type'] || '').includes('json');
  return { status: res.statusCode, body: isJson ? JSON.parse(raw) : raw };
}

beforeEach(() => {
  invoices = [row('inv_a_one', A, 1), row('inv_b_one', B, 2)];
  issued = [];
  granted = [];
  grantError = null;
});

describe('billing routes require a verified caller', () => {
  it.each([
    ['POST', '/api/billing/create-order', { planId: 'pro' }],
    ['POST', '/api/billing/verify', { orderId: 'o', paymentId: 'p', signature: 's', planId: 'pro' }],
    ['POST', '/api/billing/invoice', { planId: 'pro', email: 'x@example.test' }],
    ['GET', '/api/billing/invoices?email=a@example.test', undefined],
    ['GET', '/api/billing/invoice/inv_a_one', undefined],
  ])('%s %s answers 401 without a bearer', async (method, path, body) => {
    const response = await call(request(method, path, { body }));
    expect(response.status).toBe(401);
    expect(issued).toEqual([]);
  });

  it('keeps config and quote open', async () => {
    expect((await call(request('GET', '/api/billing/config'))).status).toBe(200);
    expect((await call(request('GET', '/api/billing/quote?planId=pro&yearly=0'))).status).toBe(200);
  });
});

describe('reading invoices', () => {
  it("lists the caller's invoices and ignores the email parameter", async () => {
    const response = await call(request('GET', `/api/billing/invoices?email=${B.email}`, { as: A }));
    expect(response.status).toBe(200);
    expect(response.body.invoices.map((i) => i.id)).toEqual(['inv_a_one']);
  });

  it("an admin's own list is their own, not everyone's", async () => {
    const response = await call(request('GET', '/api/billing/invoices', { as: ADMIN }));
    expect(response.body.invoices).toEqual([]);
  });

  it("renders the caller's invoice and hides another user's", async () => {
    const own = await call(request('GET', '/api/billing/invoice/inv_a_one', { as: A }));
    expect(own.status).toBe(200);
    expect(own.body).toContain('NIY/2627/00001');
    const other = await call(request('GET', '/api/billing/invoice/inv_b_one', { as: A }));
    expect(other.status).toBe(404);
    expect(other.body).not.toContain('NIY/2627/00002');
  });

  it('lets an admin render any invoice, by id or number', async () => {
    expect((await call(request('GET', '/api/billing/invoice/inv_b_one', { as: ADMIN }))).status).toBe(200);
    expect((await call(request('GET', `/api/billing/invoice/${encodeURIComponent('NIY/2627/00002')}`, { as: ADMIN }))).status).toBe(200);
  });
});

describe('the demo invoice record', () => {
  it('is refused on a serverless host (production and previews)', async () => {
    const response = await call(request('POST', '/api/billing/invoice', { as: A, body: { planId: 'pro' } }), deps({ serverless: true }));
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ ok: false, paymentsDisabled: true });
    expect(issued).toEqual([]);
  });

  it('locally, issues to the verified caller whatever the body says', async () => {
    const response = await call(request('POST', '/api/billing/invoice', { as: A, body: { planId: 'pro', email: B.email, userId: B.id } }));
    expect(response.status).toBe(200);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ user_id: A.id, user_email: A.email, provider: 'demo', plan_id: 'pro' });
  });

  it('never grants a plan (F2: only a verified payment does)', async () => {
    await call(request('POST', '/api/billing/invoice', { as: A, body: { planId: 'pro' } }));
    expect(granted).toEqual([]);
  });
});

describe('Razorpay orders and verification', () => {
  it('stamps the verified caller into the order notes', async () => {
    const rz = razorpay();
    const response = await call(request('POST', '/api/billing/create-order', { as: A, body: { planId: 'pro', userId: B.id, email: B.email } }), deps({ razorpayFetch: rz }));
    expect(response.status).toBe(200);
    const [, init] = rz.mock.calls.find(([path]) => path === '/orders');
    expect(init.body.notes).toMatchObject({ userId: A.id, email: A.email, planId: 'pro' });
  });

  async function verifyWith(order, body = {}) {
    const d = deps({ razorpayFetch: razorpay({ order }), verifySignature: () => true });
    return call(request('POST', '/api/billing/verify', {
      as: A,
      body: { orderId: 'order_9', paymentId: 'pay_9', signature: 'sig', planId: 'pro', yearly: false, email: B.email, userId: B.id, ...body },
    }), d);
  }

  async function goodOrder() {
    const q = await call(request('GET', '/api/billing/quote?planId=pro&yearly=0'));
    return { amount: q.body.quote.amountPaise, notes: { userId: A.id, planId: 'pro', yearly: 'false' } };
  }

  it('issues the invoice to the verified caller when the order matches', async () => {
    const response = await verifyWith(await goodOrder());
    expect(response.status).toBe(200);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ user_id: A.id, user_email: A.email, provider: 'razorpay', payment_id: 'pay_9', order_id: 'order_9', plan_id: 'pro' });
  });

  it('refuses an order whose amount differs from the quote', async () => {
    const order = await goodOrder();
    const response = await verifyWith({ ...order, amount: order.amount - 100 });
    expect(response.status).toBe(400);
    expect(issued).toEqual([]);
  });

  it('refuses an order made for another plan or period', async () => {
    const order = await goodOrder();
    expect((await verifyWith({ ...order, notes: { ...order.notes, planId: 'enterprise' } })).status).toBe(400);
    expect((await verifyWith({ ...order, notes: { ...order.notes, yearly: 'true' } })).status).toBe(400);
    expect(issued).toEqual([]);
  });

  it("refuses another user's order", async () => {
    const order = await goodOrder();
    const response = await verifyWith({ ...order, notes: { ...order.notes, userId: B.id } });
    expect(response.status).toBe(400);
    expect(issued).toEqual([]);
  });

  // F2: a verified payment is the only thing that grants a paid plan.
  it('grants the paid plan to the verified caller, for the paid period, after every check', async () => {
    const response = await verifyWith(await goodOrder());
    expect(response.status).toBe(200);
    expect(granted).toEqual([{ p_user: A.id, p_plan: 'pro', p_period: 'month', p_payment_id: 'pay_9' }]);
    expect(response.body.entitlement).toMatchObject({ plan: 'professional', status: 'active' });
  });

  it('grants a year for a yearly order', async () => {
    const q = await call(request('GET', '/api/billing/quote?planId=pro&yearly=1'));
    const order = { amount: q.body.quote.amountPaise, notes: { userId: A.id, planId: 'pro', yearly: 'true' } };
    const response = await verifyWith(order, { yearly: true });
    expect(response.status).toBe(200);
    expect(granted[0]).toMatchObject({ p_period: 'year' });
  });

  it('grants nothing when a check fails', async () => {
    const order = await goodOrder();
    await verifyWith({ ...order, amount: order.amount - 100 });
    await verifyWith({ ...order, notes: { ...order.notes, userId: B.id } });
    await verifyWith({ ...order, notes: { ...order.notes, planId: 'enterprise' } });
    const badSignature = deps({ razorpayFetch: razorpay({ order }), verifySignature: () => false });
    expect((await call(request('POST', '/api/billing/verify', { as: A, body: { orderId: 'order_9', paymentId: 'pay_9', signature: 'x', planId: 'pro' } }), badSignature)).status).toBe(400);
    const failed = deps({ razorpayFetch: razorpay({ order, payment: { status: 'failed' } }), verifySignature: () => true });
    expect((await call(request('POST', '/api/billing/verify', { as: A, body: { orderId: 'order_9', paymentId: 'pay_9', signature: 's', planId: 'pro' } }), failed)).status).toBe(400);
    expect(granted).toEqual([]);
    expect(issued).toEqual([]);
  });

  it('issues no invoice when the grant fails, so a retry can complete both', async () => {
    grantError = { code: 'XX000', message: 'down' };
    const response = await verifyWith(await goodOrder());
    expect(response.status).toBe(503);
    expect(response.body.ok).toBe(false);
    expect(issued).toEqual([]);
  });

  it('still answers ok when the invoice already exists for a granted payment (a retry)', async () => {
    const d = deps({ razorpayFetch: razorpay({ order: await goodOrder() }), verifySignature: () => true });
    const first = await call(request('POST', '/api/billing/verify', { as: A, body: { orderId: 'order_9', paymentId: 'pay_9', signature: 's', planId: 'pro', yearly: false } }), d);
    expect(first.status).toBe(200);
    const original = d.adminClient;
    d.adminClient = () => {
      const client = original();
      const rpc = client.rpc;
      client.rpc = vi.fn(async (name, args) => (name === 'issue_invoice' ? { data: null, error: { code: '23505' } } : rpc(name, args)));
      return client;
    };
    const retry = await call(request('POST', '/api/billing/verify', { as: A, body: { orderId: 'order_9', paymentId: 'pay_9', signature: 's', planId: 'pro', yearly: false } }), d);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, invoice: null });
    expect(granted).toHaveLength(2);
  });
});
