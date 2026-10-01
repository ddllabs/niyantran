import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const auth=vi.hoisted(()=>({id:'owner-a',callback:null,expired:false,blocked:false}));
vi.mock('./supabaseClient.js',()=>({functionsUrl:()=> 'https://fake.invalid/research-chat',accessToken:async()=> 'retained-sdk-token',supabase:{
 auth:{onAuthStateChange:fn=>{auth.callback=fn;return {data:{subscription:{unsubscribe(){}}}};},getSession:async()=>({data:{session:{access_token:`token-${auth.id}`,user:{id:auth.id},expires_at:Date.now()/1000+(auth.expired?-1:3600)}}}),getUser:async()=>({data:{user:{id:auth.id,email:`${auth.id}@example.invalid`}}})},
 rpc:async()=>({data:{user_id:auth.id,status:auth.blocked?'suspended':'active'}}),
}}));
import { sendResearchTurn } from './aiClient.js';
import { invalidateLocalSession,resumeLocalIdentityAfterSignIn } from './userStore.js';
const body={message:'Exact request',turn_key:'same-key',attachments:[{text:'private'}]};
beforeEach(async()=>{
 vi.stubGlobal('window',new EventTarget());vi.stubGlobal('sessionStorage',{getItem:()=>null,setItem(){},removeItem(){}});
 auth.id='owner-a';auth.expired=false;auth.blocked=false;auth.callback?.('SIGNED_IN',{user:{id:auth.id}});
 await resumeLocalIdentityAfterSignIn({access_token:'token-owner-a',user:{id:'owner-a'},expires_at:Date.now()/1000+3600});
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}')));
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('stream fetch requires B4 verified identity and cannot use a caller token to bypass logout',async()=>{
 invalidateLocalSession();await expect(sendResearchTurn({body,token:'caller-token'})).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
});
it.each(['expired','blocked'])('%s identity cannot reach protected streaming fetch',async field=>{
 auth[field]=true;await expect(sendResearchTurn({body})).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
});
it('successful streaming request uses the verified bearer and preserves the whole body',async()=>{
 await sendResearchTurn({body,token:'untrusted-override'});expect(fetch).toHaveBeenCalledOnce();
 const [url,request]=fetch.mock.calls[0];expect(url).toBe('https://fake.invalid/research-chat');expect(request.headers.authorization).toBe('Bearer token-owner-a');expect(JSON.parse(request.body)).toEqual(body);
});
it('response resolving after an account change cannot escape the client boundary',async()=>{
 let resolve;const started=new Promise(r=>{fetch.mockImplementation(()=>{r();return new Promise(done=>resolve=done);});});
 const pending=sendResearchTurn({body});await started;auth.id='owner-b';auth.callback('SIGNED_IN',{user:{id:'owner-b'}});resolve(new Response('private A response'));
 await expect(pending).rejects.toThrow();
});
// F43: supabase-js re-announces the same account as SIGNED_IN on every tab refocus.
it('a same-account refocus SIGNED_IN while the request is in flight neither aborts nor refuses it',async()=>{
 let resolve;const started=new Promise(r=>{fetch.mockImplementation((_url,init)=>{r(init.signal);return new Promise(done=>resolve=done);});});
 const pending=sendResearchTurn({body});const signal=await started;
 auth.callback('SIGNED_IN',{access_token:'token-owner-a',user:{id:'owner-a'}});
 expect(signal.aborted).toBe(false);
 const response=new Response('own answer');resolve(response);
 await expect(pending).resolves.toBe(response);
});
it('a caller identity superseded by a same-account refocus still sends under the re-verified one',async()=>{
 const { verifiedLocalIdentity } = await import('./userStore.js');
 const identity=await verifiedLocalIdentity();
 auth.callback('SIGNED_IN',{access_token:'token-owner-a',user:{id:'owner-a'}});
 await sendResearchTurn({body,identity});expect(fetch).toHaveBeenCalledOnce();
});
it('a caller identity for another account is still refused',async()=>{
 const { verifiedLocalIdentity } = await import('./userStore.js');
 const identity=await verifiedLocalIdentity();
 auth.id='owner-b';auth.callback('SIGNED_IN',{access_token:'token-owner-b',user:{id:'owner-b'}});
 await expect(sendResearchTurn({body,identity})).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
});
it('another account while the request is in flight aborts it',async()=>{
 let resolve;const started=new Promise(r=>{fetch.mockImplementation((_url,init)=>{r(init.signal);return new Promise(done=>resolve=done);});});
 const pending=sendResearchTurn({body});const signal=await started;
 auth.id='owner-b';auth.callback('SIGNED_IN',{access_token:'token-owner-b',user:{id:'owner-b'}});
 expect(signal.aborted).toBe(true);
 resolve(new Response('private A response'));await expect(pending).rejects.toThrow();
});
