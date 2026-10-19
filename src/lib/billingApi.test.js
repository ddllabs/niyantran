// T5 (docs/specs/2026-09-28-t5-invoices-to-supabase.md): invoices live in
// Supabase, every billing route but config and quote needs a verified bearer,
// identity comes from that bearer, and verify checks the Razorpay order.
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    plan_id: 'pro', yearly: false, currency: 'INR', taxable: 999, cgst: 0, sgst: 0, igst: 0, total: 999,
    tax_split: null, usd_list: null, usd_to_inr: null, buyer_name: 'Buyer', buyer_gstin: null, buyer_state_code: null,
    buyer_address: null, payment_id: `pay_${n}`, order_id: `order_${n}`, provider: 'razorpay', payload: { planLabel: 'Pro' },
    issued_at: '2026-09-28T10:00:00Z',
  };
}

let invoices;
let entitlements;
let issued;
let granted;
let grantError;

// A user-scoped client whose reads apply the same rule as the RLS policy.
function userClient(token) {
  const who = PEOPLE.find((p) => p.token === token);
  const visible = () => invoices.filter((r) => who && (r.user_id === who.id || who.admin));
  return {
    auth: { getUser: vi.fn(async () => (who ? { data: { user: { id: who.id, email: who.email } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } })) },
    rpc: vi.fn(async (name) => {
      if (name === 'my_entitlement') return { data: entitlements[who?.id] || { plan: 'free', status: 'free' }, error: null };
      return { data: name === 'is_platform_admin' ? Boolean(who?.admin) : { user_id: who?.id, role: who?.admin ? 'admin' : 'user', status: 'active' }, error: null };
    }),
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
        return { data: { plan: args.p_plan, status: 'active', period_end: '2026-10-29T10:00:00Z', source: 'payment' }, error: null };
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
  return { adminClient, clientForToken: userClient, razorpayFetch: razorpay(), serverless: false, razorpayEnabled: true, checkoutOpen: true, ...extra };
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
  entitlements = {};
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
    expect((await call(request('GET', '/api/billing/quote?planId=pro'))).status).toBe(200);
  });
});

describe('INR plans, monthly, no GST (open-work F109)', () => {
  it.each([['plus', 39900], ['pro', 99900], ['max', 999900]])('quotes %s at its rupee price with nothing added', async (planId, paise) => {
    const { status, body } = await call(request('GET', `/api/billing/quote?planId=${planId}&yearly=1&buyerGstin=29ABCDE1234F1Z5`));
    expect(status).toBe(200);
    expect(body.quote).toMatchObject({ planId, currency: 'INR', period: 'monthly', amountPaise: paise, total: paise / 100 });
    expect(body.quote).not.toHaveProperty('gstRate');
    expect(body.quote).not.toHaveProperty('usdList');
    expect(body.quote).not.toHaveProperty('yearly');
  });

  it.each(['free', 'explorer', 'enterprise', 'gov', 'professional'])('refuses %s as a paid plan', async (planId) => {
    expect((await call(request('GET', `/api/billing/quote?planId=${planId}`))).status).toBe(400);
  });

  it('publishes no GST rate, exchange rate or GST state list in the config', async () => {
    const { body } = await call(request('GET', '/api/billing/config'));
    expect(body).toMatchObject({ currency: 'INR', gstRegistered: false });
    for (const key of ['gstRate', 'usdToInr', 'states', 'sac']) expect(body).not.toHaveProperty(key);
  });

  it('renders a plain invoice from the company, not a tax invoice', async () => {
    const { body } = await call(request('GET', '/api/billing/invoice/inv_a_one', { as: A }));
    expect(body).toContain('Niyantran Consulting Pvt. Ltd.');
    expect(body).toContain('Not registered under GST');
    expect(body).not.toMatch(/TAX INVOICE|CGST|SGST|IGST|USD/);
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

  it('also refuses local demo invoice writes', async () => {
    const response = await call(request('POST', '/api/billing/invoice', { as: A, body: { planId: 'pro', email: B.email, userId: B.id } }));
    expect(response.status).toBe(403);
    expect(issued).toHaveLength(0);
  });

  it('never grants a plan (F2: only a verified payment does)', async () => {
    await call(request('POST', '/api/billing/invoice', { as: A, body: { planId: 'pro' } }));
    expect(granted).toEqual([]);
  });
});


const PURCHASE = 'a0000000-0000-4000-8000-000000000009';
const REQUEST = 'a0000000-0000-4000-8000-000000000008';
const CONFIG = { ready:true, open:true, testBuyerIds:[A.id], mode:'test', account:'acc_fixture',keyId:'rzp_test_fixture',keySecret:'fixture-secret' };
const stored = () => ({ id:PURCHASE,user_id:A.id,amount_paise:99900,currency:'INR',provider_order_id:'order_9',state:'ready',snapshot:{productId:'plan-pro',kind:'plan',planId:'pro',credits:65000,amountPaise:99900,currency:'INR',creditUnit:'credit-paise-v2',buyerEmail:A.email} });
const signed = () => crypto.createHmac('sha256',CONFIG.keySecret).update('order_9|pay_9').digest('hex');
function purchaseDeps(extra={}) {
  const calls=[];
  const order = extra.order === null ? null : { ...stored(),...extra.order };
  const saved = row('inv_atomic',A,3);
  let fulfilled=false;
  const admin={rpc:vi.fn(async(name,args)=>{
    calls.push([name,args]);
    if(name==='billing_order') {
      if(args.p_action==='get') return {data:order?.user_id===args.p.userId?order:null};
      if(args.p_action==='claim') return {data:{...stored(),snapshot:args.p.snapshot,fresh:true}};
      if(args.p_action==='bind') return {data:stored()};
      return {data:{ok:true}};
    }
    if(name==='billing_checkout_preflight') return {data:{stale:false,version:'0',observedPayment:false}};
    if(name==='billing_capture') {
      if(extra.captureError)return {error:{code:'XX000'}};
      if(!fulfilled){granted.push(args);issued.push(saved);fulfilled=true;}
      return {data:{ok:true,invoice:saved,status:'fulfilled'}};
    }
    return {data:[]};
  })};
  const rz=vi.fn(async(path,init)=> path==='/orders'?{id:'order_9',receipt:PURCHASE,amount:init.body.amount,currency:'INR'}:{id:'pay_9',order_id:'order_9',amount:99900,currency:'INR',status:'captured',...extra.payment});
  return {...deps(),paymentConfig:{...CONFIG,...extra.config},adminClient:()=>admin,razorpayFetch:rz,calls};
}
const verifyRequest=()=>request('POST','/api/billing/verify',{as:A,body:{purchaseId:PURCHASE,orderId:'order_9',paymentId:'pay_9',signature:signed(),planId:'max',userId:B.id,email:B.email}});
describe('durable Razorpay order and verification routes',()=>{
  it('hides Test checkout availability when its buyer list is absent without leaking the list',async()=>{
    const d=purchaseDeps({config:{testBuyerIds:[]}});
    const out=await call(request('GET','/api/billing/config'),d);
    expect(out.body.enabled).toBe(false);expect(out.body.keyId).toBe('');
    expect(out.body).not.toHaveProperty('testBuyerIds');
  });
  it('rejects a non-allowlisted verified Test buyer before creating an order',async()=>{
    const d=purchaseDeps({config:{testBuyerIds:[B.id]}});
    const out=await call(request('POST','/api/billing/create-order',{as:A,body:{planId:'pro',requestId:REQUEST,userId:B.id}}),d);
    expect(out.status).toBe(403);expect(d.calls).toEqual([]);expect(d.razorpayFetch).not.toHaveBeenCalled();
  });
  it('takes buyer from verified bearer and product amount from server',async()=>{
    const d=purchaseDeps();const r=await call(request('POST','/api/billing/create-order',{as:A,body:{planId:'pro',requestId:REQUEST,userId:B.id,email:B.email,amount:1}}),d);
    expect(r.status).toBe(202); // ready order is pending fulfilment
    const p=d.calls.find(c=>c[1].p_action==='claim')[1].p;
    expect(p.userId).toBe(A.id);expect(p.snapshot).toMatchObject({buyerEmail:A.email,amountPaise:99900});
    expect(d.razorpayFetch.mock.calls[0][1].body.notes).toEqual({purchaseId:PURCHASE});
  });
  it('fulfils captured payments through one atomic RPC rather than separate grant/invoice',async()=>{
    const d=purchaseDeps();const r=await call(verifyRequest(),d);expect(r.status).toBe(200);expect(r.body).toMatchObject({ok:true,status:'fulfilled'});
    expect(d.calls.map(c=>c[0])).toEqual(['billing_order','billing_order','billing_capture']);
    expect(issued).toHaveLength(1);expect(granted).toHaveLength(1);
  });
  it.each([{amount:1},{currency:'USD'},{order_id:'order_wrong'},{id:'pay_wrong'},{status:undefined}])('rejects mismatched provider payment %j',async payment=>{
    const d=purchaseDeps({payment});expect((await call(verifyRequest(),d)).status).toBe(400);expect(issued).toHaveLength(0);expect(granted).toHaveLength(0);
  });
  it('leaves authorization pending without granting',async()=>{
    const d=purchaseDeps({payment:{status:'authorized'}});const r=await call(verifyRequest(),d);expect(r.status).toBe(202);expect(r.body.pending).toBe(true);expect(granted).toHaveLength(0);
  });
  it('rejects foreign/missing purchases before provider fetch',async()=>{
    const d=purchaseDeps({order:{user_id:B.id}});expect((await call(verifyRequest(),d)).status).toBe(404);expect(d.razorpayFetch).not.toHaveBeenCalled();
  });
  it('rejects a bad signature before provider fetch',async()=>{
    const d=purchaseDeps();const req=verifyRequest();req.body.signature='x';expect((await call(req,d)).status).toBe(400);expect(d.razorpayFetch).not.toHaveBeenCalled();
  });
  it('keeps verified payment evidence when atomic fulfilment is temporarily unavailable',async()=>{
    const d=purchaseDeps({captureError:true});expect((await call(verifyRequest(),d)).status).toBe(503);expect(d.calls.some(c=>c[1].p_action==='payment')).toBe(true);expect(issued).toHaveLength(0);
  });
  it('retries return the same invoice without an additional grant',async()=>{
    const d=purchaseDeps();const first=await call(verifyRequest(),d);const again=await call(verifyRequest(),d);
    expect(again.body.invoice.id).toBe(first.body.invoice.id);expect(issued).toHaveLength(1);expect(granted).toHaveLength(1);
  });
  it('keeps new checkout closed but continues verification/recovery',async()=>{
    const d=purchaseDeps({config:{open:false}});
    expect((await call(request('POST','/api/billing/create-order',{as:A,body:{planId:'pro',requestId:REQUEST}}),d)).status).toBe(503);
    expect((await call(verifyRequest(),d)).body.ok).toBe(true);
  });
  it('requires admin for recovery and reviewed adjustments',async()=>{
    const d=purchaseDeps();expect((await call(request('POST','/api/billing/recover',{as:A,body:{}}),d)).status).toBe(403);
    expect((await call(request('POST','/api/billing/adjustments/review',{as:A,body:{}}),d)).status).toBe(403);
  });
});
