import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
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
async function invoke(raw,signature,parsed=false){
 const req=Readable.from([raw]);req.url='/api/router?__route=billing/webhook';req.method='POST';
 req.headers={host:'localhost','x-razorpay-event-id':'evt_fixture','x-razorpay-signature':signature};if(parsed)req.body=JSON.parse(raw);
 let status=200,body;const headers={};const res={get statusCode(){return status;},set statusCode(v){status=v;},setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];},end(value){body=JSON.parse(value);},status(v){status=v;return this;},json(value){body=value;}};
 await router(req,res);return{status,body};
}
describe('webhook transport through the actual Vercel router',()=>{
 it('validates the original streamed bytes including whitespace',async()=>{
  const raw=' { "account_id": "acc_fixture", "event": "payment.captured", "payload": {} }\n';
  const signature=crypto.createHmac('sha256','fixture-webhook').update(raw).digest('hex');
  expect(await invoke(raw,signature)).toEqual({status:200,body:{ok:true,received:true}});
  expect(state.rpc.mock.calls[0][1].p.hash).toBe(crypto.createHash('sha256').update(raw).digest('hex'));
  expect(fetch).not.toHaveBeenCalled();
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
