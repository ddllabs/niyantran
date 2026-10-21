import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { paymentProduct, TOPUP_PACKS } from '../../server/paymentCatalog.mjs';
import { signatureMatches, verifyPurchase, createPurchase, receivePaymentWebhook, paymentConfig, providerFetch, recoverPayments, readRawPaymentBody } from '../../server/paymentService.mjs';

const id = 'd0000000-0000-4000-8000-000000000001';
const user = { id: 'd0000000-0000-4000-8000-000000000002', email: 'buyer@example.test' };
const order = { id, user_id: user.id, provider_order_id: 'order_A1', state: 'ready', amount_paise: 49900, currency: 'INR', snapshot: paymentProduct('topup-20000') };
const payment = { id: 'pay_A1', order_id: 'order_A1', amount: 49900, currency: 'INR', status: 'captured', amount_refunded: 0 };
function context() {
  const rpc = vi.fn(async (name, args) => {
    if (name === 'billing_order') {
      if (args.p_action === 'get') return { data: order };
      if (args.p_action === 'claim') return { data: { ...order, fresh: true } };
      if (args.p_action === 'bind') return { data: order };
      if (args.p_action === 'recovery') return { data: [] };
      return { data: { ok: true } };
    }
    if (name === 'billing_creation_retry' && args.p_action === 'claim') return { data: { canCreate: false, order: { ...order, provider_order_id: null, state: 'reconciling' } } };
    if (name === 'billing_creation_retry' && args.p_action === 'reject') return { data: { ...order, provider_order_id: null, state: 'reconciling', creation_retryable: true } };
    if (name === 'billing_capture') return { data: { ok: true, status: 'fulfilled', invoice: { id: 'inv_a' } } };
    if (name === 'billing_checkout_preflight') return { data: { stale: false, version: '0', observedPayment: false } };
    if (name === 'billing_event' && args.p_action === 'receive') return { data: { id, ...args.p, event_type: args.p.type, state: 'pending' } };
    if (name === 'billing_event' && args.p_action === 'pending') return { data: [] };
    return { data: { ok: true } };
  });
  return { config: { account: 'acc_test', mode: 'test', keyId: 'rzp_test_fixture', keySecret: 'test-only-secret', webhookSecret: 'test-only-hook', ready: true, open: true, testBuyerIds: [user.id] },
    client: { rpc }, fetch: vi.fn(async path => path.startsWith('/payments/') ? payment : { id: 'order_A1', amount: 49900, currency: 'INR', receipt: id }) };
}
const signature = secret => crypto.createHmac('sha256', secret).update('order_A1|pay_A1').digest('hex');

describe('stale plan checkout', () => {
  function staleContext() {
    const ctx = context(); const original = ctx.client.rpc.getMockImplementation();
    ctx.client.rpc.mockImplementation(async (name, args) => {
      if (name === 'billing_order' && args.p_action === 'claim') return { data: { ...order, fresh: false, amount_paise: 39900, snapshot: { ...paymentProduct('plus'), grantVersion: 0 } } };
      if (name === 'billing_checkout_preflight') return { data: { stale: true, version: '3', observedPayment: false } };
      return original(name, args);
    });
    ctx.fetch.mockImplementation(async path => path.endsWith('/payments') ? { count: 0, items: [] } : { id: 'order_A1', status: 'created', amount: 39900, amount_paid: 0, amount_due: 39900, attempts: 0, currency: 'INR', receipt: id });
    return ctx;
  }
  it('does not reopen an unused stale order and offers a stable new review without a POST', async () => {
    const ctx = staleContext();
    const first = await createPurchase({ planId: 'plus', requestId: id }, user, ctx);
    const second = await createPurchase({ planId: 'plus', requestId: id }, user, ctx);
    expect(first).toMatchObject({ ok: true, requiresReview: true, status: 'plan_changed' });
    expect(first.orderId).toBeUndefined();
    expect(first.nextRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.nextRequestId).toBe(second.nextRequestId);
    expect(ctx.fetch.mock.calls.every(c => !c[1]?.method || c[1].method === 'GET')).toBe(true);
    expect(ctx.client.rpc.mock.calls.some(c => c[0] === 'billing_capture')).toBe(false);
  });
  it.each(['authorized','captured','created'])('does not replace a stale order with a %s payment', async status => {
    const ctx = staleContext();
    ctx.fetch.mockResolvedValue({ count: 1, items: [{ ...payment, amount: 39900, status }] });
    const result = await createPurchase({ planId: 'plus', requestId: id }, user, ctx);
    expect(result).toMatchObject({ pending: true });
    expect(result.nextRequestId).toBeUndefined(); expect(result.orderId).toBeUndefined();
  });
  it.each(['timeout','wrong-order','missing-count','observed'])('fails closed for %s facts', async kind => {
    const ctx = staleContext();
    if (kind === 'timeout') ctx.fetch.mockRejectedValue(new Error('timeout'));
    if (kind === 'wrong-order') ctx.fetch.mockResolvedValue({ id: 'order_foreign', count: 0, items: [] });
    if (kind === 'missing-count') ctx.fetch.mockResolvedValue({ items: [] });
    if (kind === 'observed') {
      const original = ctx.client.rpc.getMockImplementation();
      ctx.client.rpc.mockImplementation(async (name,args) => name === 'billing_checkout_preflight'
        ? { data: { stale: true, version: '3', observedPayment: true } } : original(name,args));
    }
    const result = await createPurchase({ planId: 'plus', requestId: id }, user, ctx);
    expect(result.pending).toBe(true); expect(result.nextRequestId).toBeUndefined(); expect(result.orderId).toBeUndefined();
  });
});
describe('payment purchase boundaries', () => {
  it('locks approved pack prices/current units and rejects unknown products', () => {
    expect(TOPUP_PACKS.map(p => [p.credits, p.amountPaise])).toEqual([[20000,49900],[50000,119900],[100000,229900],[200000,439900],[500000,1049900]]);
    expect(paymentProduct('free')).toBeNull();
    expect(paymentProduct('pro')).toMatchObject({ amountPaise:99900, credits:65000, creditUnit:'credit-paise-v2' });
  });
  it('fails closed without real server-only configured mode and merchant', () => {
    expect(paymentConfig({ VITE_RAZORPAY_KEY_ID:'rzp_live_bad', RAZORPAY_KEY_SECRET:'fixture' }).ready).toBe(false);
    expect(paymentConfig({ RAZORPAY_KEY_ID:'rzp_live_fixture',RAZORPAY_KEY_SECRET:'fixture',RAZORPAY_ACCOUNT_ID:'acc_fixture' })).toMatchObject({ mode:'live',ready:true,open:false });
  });
  it.each([undefined, [], ['*'], [user.email], [user.id, 'bad-id']].map(ids => [ids]))('refuses unconfigured or malformed Test buyer lists %j before any order write', async ids => {
    const ctx = context(); ctx.config.testBuyerIds = ids;
    await expect(createPurchase({productId:'topup-20000',requestId:id},user,ctx)).rejects.toMatchObject({status:403});
    expect(ctx.client.rpc).not.toHaveBeenCalled(); expect(ctx.fetch).not.toHaveBeenCalled();
  });
  it('derives the allowed Test buyer from verified identity, never browser input', async () => {
    const ctx=context();ctx.config.testBuyerIds=['d0000000-0000-4000-8000-000000000003'];
    await expect(createPurchase({productId:'topup-20000',requestId:id,userId:ctx.config.testBuyerIds[0]},user,ctx)).rejects.toMatchObject({status:403});
    expect(ctx.client.rpc).not.toHaveBeenCalled();
  });
  it('does not restrict Live buyers with a Test allowlist', async () => {
    const ctx=context();ctx.config.mode='live';ctx.config.testBuyerIds=[];ctx.config.liveBuyerIds=[user.id];
    expect(await createPurchase({productId:'topup-20000',requestId:id},user,ctx)).toMatchObject({ok:true});
  });
  it('keeps existing purchase verification and recovery available after a Test buyer is removed', async () => {
    const ctx=context();ctx.config.testBuyerIds=[];ctx.config.open=false;
    expect(await verifyPurchase({orderId:'order_A1',paymentId:'pay_A1',signature:signature(ctx.config.keySecret)},user,ctx)).toMatchObject({ok:true});
    expect(await recoverPayments(ctx)).toMatchObject({ok:true});
  });
  it('parses independent server Test and Live buyer UUIDs', () => {
    const configured=paymentConfig({BILLING_TEST_BUYER_IDS:` ${user.id.toUpperCase()},\n${id} `, BILLING_LIVE_BUYER_IDS:` ${id.toUpperCase()} `});
    expect(configured.testBuyerIds).toEqual([user.id,id]);
    expect(configured.liveBuyerIds).toEqual([id]);
  });
  it('rejects a signed webhook from a different merchant before persistence', async () => {
    const ctx=context();const raw=Buffer.from(JSON.stringify({account_id:'acc_other',event:'payment.captured',payload:{payment:{entity:payment}}}));
    const signature=crypto.createHmac('sha256',ctx.config.webhookSecret).update(raw).digest('hex');
    await expect(receivePaymentWebhook({body:raw,headers:{'x-razorpay-signature':signature,'x-razorpay-event-id':'evt_foreign'}},ctx)).rejects.toMatchObject({status:400});
    expect(ctx.client.rpc).not.toHaveBeenCalled();expect(ctx.fetch).not.toHaveBeenCalled();
  });
  it('leaves a purchase unfulfilled when provider verification times out', async () => {
    const ctx=context();ctx.fetch.mockRejectedValue(new Error('provider timeout'));
    await expect(verifyPurchase({orderId:'order_A1',paymentId:'pay_A1',signature:signature(ctx.config.keySecret)},user,ctx)).rejects.toThrow('provider timeout');
    expect(ctx.client.rpc.mock.calls.some(c=>c[0]==='billing_capture')).toBe(false);
  });
  it('recovers capture without a browser callback while Checkout is closed', async () => {
    const ctx=context();ctx.config.open=false;ctx.config.testBuyerIds=[];
    const original=ctx.client.rpc.getMockImplementation();
    ctx.client.rpc.mockImplementation(async(name,args)=>name==='billing_order'&&args.p_action==='recovery'?{data:[order]}:original(name,args));
    ctx.fetch.mockImplementation(async path=>path.endsWith('/payments')?{items:[payment]}:payment);
    expect(await recoverPayments(ctx)).toMatchObject({ok:true,ordersChecked:1});
    expect(ctx.client.rpc.mock.calls.filter(c=>c[0]==='billing_capture')).toHaveLength(1);
    expect(ctx.fetch.mock.calls.every(c=>!c[1]?.method||c[1].method==='GET')).toBe(true);
  });
  it('verifies exact raw byte signatures and refuses invalid length', () => {
    const sign = signature('test-only-secret');
    expect(signatureMatches('order_A1|pay_A1',sign,'test-only-secret')).toBe(true);
    expect(signatureMatches(' order_A1|pay_A1',sign,'test-only-secret')).toBe(false);
    expect(signatureMatches('order_A1|pay_A1','x','test-only-secret')).toBe(false);
  });
  it('uses stored purchase and records payment before atomic fulfilment', async () => {
    const ctx = context();
    expect(await verifyPurchase({ orderId:'order_A1',paymentId:'pay_A1',signature:signature(ctx.config.keySecret),planId:'max' },user,ctx)).toMatchObject({ok:true,status:'fulfilled'});
    expect(ctx.client.rpc.mock.calls.map(c => c[0]+':'+(c[1].p_action || ''))).toEqual(['billing_order:get','billing_order:payment','billing_capture:']);
  });
  it.each([{status:'authorized'}, {status:undefined}, {amount:1}, {currency:'USD'}, {order_id:'order_other'}, {id:'pay_other'}])('does not fulfil mismatched/unconfirmed payment %j', async patch => {
    const ctx=context();ctx.fetch.mockResolvedValue({...payment,...patch});
    try { const r=await verifyPurchase({orderId:'order_A1',paymentId:'pay_A1',signature:signature(ctx.config.keySecret)},user,ctx);expect(r.ok).toBe(false); } catch(e){expect(e.status).toBe(400);}
    expect(ctx.client.rpc.mock.calls.some(c=>c[0]==='billing_capture')).toBe(false);
  });
  it('rejects a foreign owned order before querying provider', async () => {
    const ctx=context();ctx.client.rpc.mockResolvedValueOnce({data:null});
    await expect(verifyPurchase({orderId:'order_A1',paymentId:'pay_A1',signature:signature(ctx.config.keySecret)},user,ctx)).rejects.toMatchObject({status:404});
    expect(ctx.fetch).not.toHaveBeenCalled();
  });
  it('does not repeat provider POST for an existing or uncertain purchase', async () => {
    const ctx=context();ctx.client.rpc.mockResolvedValueOnce({data:{...order,fresh:false,state:'creating',provider_order_id:null}});
    await createPurchase({productId:'topup-20000',requestId:id},user,ctx);
    expect(ctx.fetch).not.toHaveBeenCalled();
    const other=context();other.fetch.mockRejectedValue(new Error('timeout'));
    expect(await createPurchase({productId:'topup-20000',requestId:id},user,other)).toMatchObject({status:'reconciling',pending:true});
    expect(other.fetch).toHaveBeenCalledTimes(1);
  });
  it('ignores browser amount/credits and snapshots server catalogue', async () => {
    const ctx=context();await createPurchase({productId:'topup-20000',requestId:id,amountPaise:1,credits:999999},user,ctx);
    expect(ctx.client.rpc.mock.calls[0][1].p.snapshot).toMatchObject({amountPaise:49900,credits:20000,buyerEmail:user.email});
  });
  it('requires a stable request ID before order creation', async () => {
    const ctx=context();await expect(createPurchase({productId:'topup-20000'},user,ctx)).rejects.toMatchObject({status:400});expect(ctx.fetch).not.toHaveBeenCalled();
  });
  it('accepts verified raw webhook into durable inbox even when processing fails',async()=>{
    const ctx=context();ctx.fetch.mockRejectedValue(new Error('offline'));
    const raw=Buffer.from(JSON.stringify({account_id:'acc_test',event:'payment.captured',payload:{payment:{entity:{...payment,card:{secret:'must-not-persist'}}}}}));
    const sign=crypto.createHmac('sha256',ctx.config.webhookSecret).update(raw).digest('hex');
    expect(await receivePaymentWebhook({body:raw,headers:{'x-razorpay-signature':sign,'x-razorpay-event-id':'evt_fixture'}},ctx)).toEqual({ok:true,received:true});
    const saved=ctx.client.rpc.mock.calls.find(c=>c[1].p_action==='receive')[1].p;
    expect(JSON.stringify(saved)).not.toContain('must-not-persist');
    expect(ctx.client.rpc.mock.calls.some(c=>c[1].p_action==='error')).toBe(true);
  });
  it('rejects parsed or badly signed webhook bodies without persistence',async()=>{
    const ctx=context();await expect(receivePaymentWebhook({body:{},headers:{}},ctx)).rejects.toMatchObject({status:400});
    await expect(receivePaymentWebhook({body:Buffer.from('{}'),headers:{}},ctx)).rejects.toMatchObject({status:400});expect(ctx.client.rpc).not.toHaveBeenCalled();
  });
  it('continues recovery while new checkout is closed',async()=>{
    const ctx=context();ctx.config.open=false;expect(await recoverPayments(ctx)).toMatchObject({ok:true});
    expect(ctx.client.rpc).toHaveBeenCalledWith('billing_order',expect.objectContaining({p_action:'recovery'}));
  });
});


describe('payment raw body boundaries', () => {
  it.each(['buffer', 'string', 'stream'])('retains exact UTF-8 bytes and byte limits for %s bodies', async kind => {
    const raw = Buffer.from(' { "label": "₹ नीति" }\n');
    const request = () => kind === 'stream' ? Readable.from([raw.subarray(0, 5), raw.subarray(5)]) : { body: kind === 'buffer' ? raw : raw.toString() };
    expect(await readRawPaymentBody(request(), raw.length)).toEqual(raw);
    await expect(readRawPaymentBody(request(), raw.length - 1)).rejects.toMatchObject({ status: 413 });
  });
  it('rejects interrupted bodies instead of returning partial signed bytes', async () => {
    const req = new PassThrough();
    const result = readRawPaymentBody(req);
    req.write('partial');req.emit('aborted');req.end();
    await expect(result).rejects.toMatchObject({ status: 400, message: 'Incomplete request body.' });
  });
  it('propagates stream errors instead of accepting a truncated body', async () => {
    const req = new PassThrough();
    const result = readRawPaymentBody(req);
    const error = Error('fixture stream failure');
    req.destroy(error);
    await expect(result).rejects.toBe(error);
  });
  it('enforces stream limits without evaluating a lazy JSON parser', async () => {
    const req = Readable.from([Buffer.alloc(65)]);
    const getter = vi.fn(() => { throw Error('body parser must not run'); });
    Object.defineProperty(req, 'body', { get: getter });
    await expect(readRawPaymentBody(req, 64)).rejects.toMatchObject({ status: 413 });
    expect(getter).not.toHaveBeenCalled();
  });
});


describe('safe purchase failure diagnostics', () => {
  it.each([401, 400, 429, 503])('retains provider HTTP %i without reading a sensitive body', async status => {
    const json = vi.fn(() => { throw new Error('secret-response'); });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status, json })));
    try {
      await expect(providerFetch('/orders', { method: 'POST', body: {} }, context().config))
        .rejects.toMatchObject({ status: 503, providerStatus: status, paymentFailure: 'http' });
      expect(json).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it.each(['TimeoutError', 'TypeError'])('sanitizes %s transport errors', async name => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw Object.assign(new Error('key-secret-private'), { name }); }));
    try {
      await expect(providerFetch('/orders', {}, context().config)).rejects.toMatchObject({
        status: 503, paymentFailure: name === 'TimeoutError' ? 'timeout' : 'transport',
        message: 'Payment provider unavailable. Check purchase status before retrying.',
      });
    } finally { vi.unstubAllGlobals(); }
  });
  it.each(['provider_create', 'order_bind'])('logs only bounded diagnostic fields for %s and defers without retry', async stage => {
    const ctx = context();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    if (stage === 'provider_create') ctx.fetch.mockRejectedValue(Object.assign(new Error('secret-private-body'), { providerStatus: 401, paymentFailure: 'http' }));
    else {
      const original = ctx.client.rpc.getMockImplementation();
      ctx.client.rpc.mockImplementation(async (name, args) => args.p_action === 'bind'
        ? { error: { code: '22023', message: 'secret-private-body' } } : original(name, args));
    }
    try {
      const result = await createPurchase({ productId: 'topup-20000', requestId: id }, user, ctx);
      expect(result).toMatchObject(stage === 'provider_create' ? { pending: false, retryable: true, status: 'creation_failed' } : { pending: true, status: 'reconciling' });
      expect(ctx.fetch).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledExactlyOnceWith('billing_order_creation_failed', {
        stage, category: stage === 'provider_create' ? 'http' : 'binding',
        providerStatus: stage === 'provider_create' ? 401 : null,
      });
      expect(JSON.stringify([warn.mock.calls, result])).not.toContain('secret-private-body');
      expect(ctx.client.rpc.mock.calls.some(c => c[1].p_action === (stage === 'provider_create' ? 'reject' : 'defer'))).toBe(true);
    } finally { warn.mockRestore(); }
  });
});

describe('same-intent rejected creation recovery', () => {
  const pending = { ...order, provider_order_id: null, state: 'reconciling' };
  function retryContext(canCreate = true) {
    const ctx = context(); const original = ctx.client.rpc.getMockImplementation();
    ctx.client.rpc.mockImplementation(async (name, args) => {
      if (name === 'billing_order' && args.p_action === 'claim') return { data: { ...pending, fresh: false } };
      if (name === 'billing_creation_retry' && args.p_action === 'claim') return { data: { canCreate, order: { ...pending, lease_token: id } } };
      if (name === 'billing_creation_retry' && args.p_action === 'reject') return { data: { ...pending, creation_retryable: true } };
      return original(name, args);
    });
    return ctx;
  }
  it('retries a rejected intent only after an atomic database claim, using stored price', async () => {
    const ctx = retryContext();
    expect(await createPurchase({ productId: 'topup-20000', requestId: id }, user, ctx)).toMatchObject({ ok: true, orderId: 'order_A1' });
    expect(ctx.client.rpc.mock.calls.map(c => c[0]+':'+c[1].p_action)).toEqual(['billing_order:claim','billing_creation_retry:claim','billing_order:bind']);
    expect(ctx.fetch).toHaveBeenCalledExactlyOnceWith('/orders', { method: 'POST', body: { amount: 49900, currency: 'INR', receipt: id, notes: { purchaseId: id } } });
  });
  it('does not repeat POST for an uncertain or already-claimed intent', async () => {
    const ctx = retryContext(false);
    expect(await createPurchase({ productId: 'topup-20000', requestId: id }, user, ctx)).toMatchObject({ pending: true });
    expect(ctx.fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403])('records definitive provider rejection %i as retryable, without retrying automatically', async providerStatus => {
    const ctx = retryContext();
    ctx.fetch.mockRejectedValue(Object.assign(new Error('private'), { paymentFailure: 'http', providerStatus }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await createPurchase({ productId: 'topup-20000', requestId: id }, user, ctx)).toMatchObject({ pending: false, retryable: true, status: 'creation_failed' });
      expect(ctx.client.rpc).toHaveBeenCalledWith('billing_creation_retry', expect.objectContaining({ p_action: 'reject', p: expect.objectContaining({ purchaseId: id, leaseToken: id, providerStatus }) }));
      expect(ctx.fetch).toHaveBeenCalledTimes(1);
    } finally { warn.mockRestore(); }
  });
  it.each([{paymentFailure:'timeout'}, {paymentFailure:'http',providerStatus:500}, {paymentFailure:'invalid_response'}])('does not make an uncertain retry retryable: %j', async failure => {
    const ctx = retryContext();ctx.fetch.mockRejectedValue(Object.assign(new Error('private'), failure));
    const warn = vi.spyOn(console,'warn').mockImplementation(()=>{});
    try {
      expect(await createPurchase({ productId:'topup-20000',requestId:id },user,ctx)).toMatchObject({pending:true,status:'reconciling'});
      expect(ctx.client.rpc.mock.calls.some(c=>c[0]==='billing_creation_retry'&&c[1].p_action==='reject')).toBe(false);
      expect(ctx.client.rpc).toHaveBeenCalledWith('billing_order',expect.objectContaining({p_action:'defer',p:expect.objectContaining({leaseToken:id})}));
    } finally { warn.mockRestore(); }
  });
  it('fails closed before provider POST when atomic retry permission is unavailable', async()=>{
    const ctx=retryContext();const original=ctx.client.rpc.getMockImplementation();
    ctx.client.rpc.mockImplementation(async(name,args)=>name==='billing_creation_retry'?{error:{code:'42883'}}:original(name,args));
    await expect(createPurchase({productId:'topup-20000',requestId:id},user,ctx)).rejects.toMatchObject({status:503});
    expect(ctx.fetch).not.toHaveBeenCalled();
  });
});


it.each([['plus',39900,20000],['pro',99900,65000],['max',999900,750000]])('keeps %s price separate from its one-paisa allowance', (plan, price, credits) => {
  expect(paymentProduct(plan)).toMatchObject({ amountPaise: price, credits, creditUnit: 'credit-paise-v2' });
});
it.each(['free','plus','pro','max'])('keeps every topup fixed on %s and ignores browser conversion claims', async plan => {
  for (const pack of TOPUP_PACKS) {
    const ctx = context();
    await createPurchase({ requestId: id, productId: pack.productId, planId: plan, credits: 99999999, amountPaise: 1, inrPerCredit: 99 }, user, ctx);
    const claim = ctx.client.rpc.mock.calls.find(([name, args]) => name === 'billing_order' && args.p_action === 'claim')[1];
    expect(claim.p.snapshot).toMatchObject({ kind: 'topup', credits: pack.credits, amountPaise: pack.amountPaise, creditUnit: 'credit-paise-v2' });
  }
});
