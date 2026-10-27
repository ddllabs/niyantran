import { assertEquals } from 'jsr:@std/assert';
import { handleAdminPersonas } from './handler.ts';
const token = 'a.b.c';
function req(body?: unknown) { return new Request('https://test/admin-personas', { method: body ? 'POST' : 'GET', headers: {authorization:`Bearer ${token}`,'content-type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}) }); }
Deno.test('admin API rejects non-admin identities before touching prompt storage', async () => {
  let calls = 0;
  const res = await handleAdminPersonas(req(), {verify:()=>Promise.resolve({id:'other'}),access:()=>Promise.resolve(false),run:()=>{calls++;return Promise.resolve({});}});
  assertEquals(res.status,403); assertEquals(calls,0);
});
Deno.test('save preserves exact text and trusts verified actor, never body identity', async () => {
  let actor = ''; let text = '';
  const res = await handleAdminPersonas(req({action:'save',persona:'academic',expected:1,text:'  π\n ',actor:'attacker'}), {
    verify:()=>Promise.resolve({id:'owner'}),access:()=>Promise.resolve(true),run:(id,input)=>{actor=id;text=String(input.text);return Promise.resolve({});},
  });
  assertEquals(res.status,200); assertEquals(actor,'owner'); assertEquals(text,'  π\n ');
});
Deno.test('malformed persona changes are refused', async () => {
  for (const body of [{action:'save',persona:'academic',expected:1,text:' '},{action:'publish',persona:'hacker',expected:1},{action:'save',persona:'academic',text:'x'}]) {
    const res=await handleAdminPersonas(req(body),{verify:()=>Promise.resolve({id:'owner'}),access:()=>Promise.resolve(true),run:()=>{throw new Error('must not run');}});
    assertEquals(res.status,400);
  }
});
Deno.test('missing and expired authentication cannot inspect prompts', async () => {
  const deps = { verify:()=>Promise.resolve(null), access:()=>{throw new Error('must not check');},run:()=>Promise.resolve({}) };
  assertEquals((await handleAdminPersonas(new Request('https://test'),deps)).status,401);
  assertEquals((await handleAdminPersonas(req(),deps)).status,401);
});
Deno.test('oversized bodies are refused even before parsing prompt fields', async () => {
  const response=await handleAdminPersonas(req({action:'save',text:'x'.repeat(110001)}),{verify:()=>Promise.resolve({id:'owner'}),access:()=>Promise.resolve(true),run:()=>{throw new Error('must not run');}});
  assertEquals(response.status,413);
});
