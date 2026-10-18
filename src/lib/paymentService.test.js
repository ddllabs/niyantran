import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { paymentProduct, TOPUP_PACKS } from '../../server/paymentCatalog.mjs';
import { signatureMatches, verifyPurchase, createPurchase, receivePaymentWebhook, paymentConfig, recoverPayments } from '../../server/paymentService.mjs';

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
    if (name === 'billing_capture') return { data: { ok: true, status: 'fulfilled', invoice: { id: 'inv_a' } } };
    if (name === 'billing_event' && args.p_action === 'receive') return { data: { id, ...args.p, event_type: args.p.type, state: 'pending' } };
    if (name === 'billing_event' && args.p_action === 'pending') return { data: [] };
    return { data: { ok: true } };
  });
  return { config: { account: 'acc_test', mode: 'test', keyId: 'rzp_test_fixture', keySecret: 'test-only-secret', webhookSecret: 'test-only-hook', ready: true, open: true, testBuyerIds: [user.id] },
    client: { rpc }, fetch: vi.fn(async path => path.startsWith('/payments/') ? payment : { id: 'order_A1', amount: 49900, currency: 'INR', receipt: id }) };
}
const signature = secret => crypto.createHmac('sha256', secret).update('order_A1|pay_A1').digest('hex');
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
    const ctx=context();ctx.config.mode='live';ctx.config.testBuyerIds=[];
    expect(await createPurchase({productId:'topup-20000',requestId:id},user,ctx)).toMatchObject({ok:true});
  });
  it('keeps existing purchase verification and recovery available after a Test buyer is removed', async () => {
    const ctx=context();ctx.config.testBuyerIds=[];ctx.config.open=false;
    expect(await verifyPurchase({orderId:'order_A1',paymentId:'pay_A1',signature:signature(ctx.config.keySecret)},user,ctx)).toMatchObject({ok:true});
    expect(await recoverPayments(ctx)).toMatchObject({ok:true});
  });
  it('parses server Test buyer UUIDs without exposing them through browser input', () => {
    const configured=paymentConfig({BILLING_TEST_BUYER_IDS:` ${user.id.toUpperCase()},\n${id} `});
    expect(configured.testBuyerIds).toEqual([user.id,id]);
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
