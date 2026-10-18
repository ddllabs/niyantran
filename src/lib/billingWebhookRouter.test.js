import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough, Readable } from 'node:stream';
import crypto from 'node:crypto';
const state=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../../server/authEmailProvider.mjs',async importOriginal=>({...(await importOriginal()),getSupabaseAdminClient:()=>({rpc:state.rpc})}));
import router from '../../api/router.js';
beforeEach(()=>{
 vi.stubEnv('RAZORPAY_KEY_ID','rzp_test_fixture');vi.stubEnv('RAZORPAY_KEY_SECRET','fixture-secret');vi.stubEnv('RAZORPAY_WEBHOOK_SECRET','fixture-webhook');vi.stubEnv('RAZORPAY_ACCOUNT_ID','acc_fixture');
 vi.stubGlobal('fetch',vi.fn(()=>Promise.reject(Error('external network forbidden'))));
 state.rpc.mockReset();state.rpc.mockResolvedValue({data:{id:'fixture',state:'done',claimed:false}});
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function invoke(raw,signature,parsed=false,lazy=false){
 const req=Readable.from([raw]);req.url='/api/router?__route=billing/webhook';req.method='POST';
 req.headers={host:'localhost','x-razorpay-event-id':'evt_fixture','x-razorpay-signature':signature};if(parsed)req.body=JSON.parse(raw);
 if(lazy==='restored'){
  const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const replay=new PassThrough(),originalOn=req.on.bind(req);
  req.read=replay.read.bind(replay);
  req.on=req.addListener=(event,listener)=>['data','end'].includes(event)?replay.on(event,listener):originalOn(event,listener);
  replay.end(Buffer.concat(chunks));
 }
 const bodyGetter=vi.fn(()=>{const value=JSON.parse(raw);Object.defineProperty(req,'body',{value,configurable:true,writable:true});return value;});
 if(lazy)Object.defineProperty(req,'body',{get:bodyGetter,configurable:true});
 let status=200,body;const headers={};const res={get statusCode(){return status;},set statusCode(v){status=v;},setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];},end(value){body=JSON.parse(value);},status(v){status=v;return this;},json(value){body=value;}};
 await router(req,res);return{status,body,...(lazy?{bodyGetterReads:bodyGetter.mock.calls.length}:{})};
}
describe('webhook transport through the actual Vercel router',()=>{
 it('validates the original streamed bytes including whitespace',async()=>{
  const raw=' { "account_id": "acc_fixture", "event": "payment.captured", "payload": {} }\n';
  const signature=crypto.createHmac('sha256','fixture-webhook').update(raw).digest('hex');
  expect(await invoke(raw,signature)).toEqual({status:200,body:{ok:true,received:true}});
  expect(state.rpc.mock.calls[0][1].p.hash).toBe(crypto.createHash('sha256').update(raw).digest('hex'));
  expect(fetch).not.toHaveBeenCalled();
 });
 it('preserves original bytes without invoking the Vercel lazy JSON body getter',async()=>{
  const raw=' { "account_id": "acc_fixture", "event": "payment.captured", "payload": {}, "label": "₹ नीति" }\n';
  const signature=crypto.createHmac('sha256','fixture-webhook').update(raw).digest('hex');
  expect(await invoke(raw,signature,false,true)).toEqual({status:200,body:{ok:true,received:true},bodyGetterReads:0});
  expect(state.rpc.mock.calls[0][1].p.hash).toBe(crypto.createHash('sha256').update(raw).digest('hex'));
  expect(fetch).not.toHaveBeenCalled();
 });
 it('validates signed JSON after Vercel consumes and restores the request stream',async()=>{
  const raw=' { "account_id": "acc_fixture", "event": "payment.captured", "payload": {}, "label": "₹ नीति" }\n';
  const signature=crypto.createHmac('sha256','fixture-webhook').update(raw).digest('hex');
  expect(await invoke(raw,signature,false,'restored')).toEqual({status:200,body:{ok:true,received:true},bodyGetterReads:0});
  expect(state.rpc.mock.calls[0][1].p.hash).toBe(crypto.createHash('sha256').update(raw).digest('hex'));
  expect(fetch).not.toHaveBeenCalled();
 });
 it('checks signatures against the original stream rather than lazy parsed JSON',async()=>{
  const raw=' { "account_id": "acc_fixture", "event": "payment.captured", "payload": {} }\n';
  const signature=crypto.createHmac('sha256','fixture-webhook').update(JSON.stringify(JSON.parse(raw))).digest('hex');
  expect(await invoke(raw,signature,false,true)).toEqual({status:400,body:{ok:false,reason:'Invalid webhook signature.'},bodyGetterReads:0});
  expect(state.rpc).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 });
 it('refuses a signature computed after JSON reserialization',async()=>{
  const raw=' { "account_id": "acc_fixture", "event": "payment.captured", "payload": {} }\n';
  const signature=crypto.createHmac('sha256','fixture-webhook').update(JSON.stringify(JSON.parse(raw))).digest('hex');
  expect((await invoke(raw,signature)).status).toBe(400);expect(state.rpc).not.toHaveBeenCalled();
 });
 it('fails closed if a host parser has already destroyed original bytes',async()=>{
  const raw='{"account_id":"acc_fixture","event":"payment.captured","payload":{}}';
  const signature=crypto.createHmac('sha256','fixture-webhook').update(raw).digest('hex');
  expect((await invoke(raw,signature,true)).status).toBe(400);expect(state.rpc).not.toHaveBeenCalled();
 });
});
