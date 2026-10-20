import { expect, it, vi } from 'vitest';
import { createPurchase, reconcilePayment, planCycleOperation } from '../../server/paymentService.mjs';
const uid='d0000000-0000-4000-8000-000000000001';
const quoteId='d0000000-0000-4000-8000-000000000002';
const user={id:uid,email:'fixture@example.test'};
function context() {
 const order={id:uid,provider_order_id:'order_A1',state:'ready',fresh:true,amount_paise:30000,currency:'INR',snapshot:{kind:'plan',contract:'cycle-v1',planId:'pro',quoteId,expiresAt:new Date(Date.now()+60000).toISOString()}};
 const rpc=vi.fn(async(name,args)=>({data:name==='billing_cycle_daily' ? args.p_action==='claim'?order:{ok:true,quoteId}:name==='billing_order'?order:{ok:true}}));
 return {config:{open:true,ready:true,mode:'test',cycleChanges:true,testBuyerIds:[uid],account:'acc_fixture'},client:{rpc},fetch:vi.fn(async path=>path.startsWith('/payments')?{id:'pay_A1',order_id:'order_A1',amount:30000,currency:'INR',status:'captured'}:{id:'order_A1'}),order};
}
it('requires a server quote before creating a new Test plan order',async()=>{
 const ctx=context();await expect(createPurchase({planId:'pro',requestId:uid},user,ctx)).rejects.toMatchObject({status:400});expect(ctx.fetch).not.toHaveBeenCalled();
});
it('claims the owned quote and ignores client amount/credit fields',async()=>{
 const ctx=context();await createPurchase({planId:'pro',quoteId,requestId:uid,amount:1,credits:750000},user,ctx);
 expect(ctx.client.rpc).toHaveBeenCalledWith('billing_cycle_daily',expect.objectContaining({p_action:'claim',p:expect.objectContaining({userId:uid,quoteId,planId:'pro'})}));
 expect(ctx.fetch).toHaveBeenCalledWith('/orders',expect.objectContaining({body:expect.objectContaining({amount:30000})}));
});
it('scheduling never calls the payment provider and uses authenticated identity',async()=>{
 const ctx=context();await planCycleOperation('schedule',{planId:'plus',userId:'foreign'},user,ctx);
 expect(ctx.fetch).not.toHaveBeenCalled();expect(ctx.client.rpc).toHaveBeenCalledWith('billing_cycle_daily',{p_action:'schedule',p:{userId:uid,account:'acc_fixture',mode:'test',planId:'plus',intent:undefined}});
});
it('does not reopen an expired bound order',async()=>{
 const ctx=context();ctx.order.snapshot.expiresAt=new Date(Date.now()-1000).toISOString();
 await expect(createPurchase({planId:'pro',quoteId,requestId:uid},user,ctx)).rejects.toMatchObject({status:409});expect(ctx.fetch).not.toHaveBeenCalled();
});
it('dispatches captured versioned orders to cycle capture while preserving provider verification',async()=>{
 const ctx=context();await reconcilePayment(ctx.order,'pay_A1',ctx);expect(ctx.client.rpc).toHaveBeenCalledWith('billing_cycle_capture',{p_order_id:uid,p_payment:expect.objectContaining({amount:30000})});
});
it('cannot activate the cycle contract with Live configuration',async()=>{
 const ctx=context();ctx.config.mode='live';await expect(planCycleOperation('schedule',{planId:'plus'},user,ctx)).rejects.toMatchObject({status:403});expect(ctx.client.rpc).not.toHaveBeenCalled();
});

it('keeps free schedule cancellation available when new payments close',async()=>{const ctx=context();ctx.config.open=false;expect(await planCycleOperation('cancel',{},user,ctx)).toMatchObject({ok:true});expect(ctx.fetch).not.toHaveBeenCalled();});
