import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runLawListings } from './law-listing-reconcile.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const sha = 'a'.repeat(64);
const fingerprint = 'b'.repeat(64);
const digest = x => createHash('sha256').update(x).digest('hex');
async function setup(t) {
 const dir = await mkdtemp(join(tmpdir(),'law-listing-test-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const receipts=join(dir,'receipts.jsonl');
 await writeFile(receipts,JSON.stringify({document_id:id,text_sha256:sha,source_key:'law:trib:IBBI_NCLT:test'})+'\n');
 return {dir,receipts,report:join(dir,'report.jsonl'),target:'https://fixture.supabase.co',token:'admin-test',publishableKey:'public'};
}
const reply = v => new Response(JSON.stringify({ok:true,contract_version:1,document_id:id,...v}),{status:200});
test('plan is read-only and binds exact document hash and mapping fingerprint',async t=>{
 const o=await setup(t); const calls=[];
 const result=await runLawListings(o,async(url,opts)=>{calls.push(JSON.parse(opts.body));return reply({status:'ready',action:'create-listing',fingerprint,indexed:true,reasons:[]});});
 assert.deepEqual(calls.map(x=>x.action),['law-reconcile']);
 assert.equal(result.ready,1);
 const rows=(await readFile(o.report,'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(rows[1].expected_fingerprint,fingerprint); assert.equal(rows[1].text_sha256,sha);
});
test('publication needs exact plan approval and refuses held targets before network',async t=>{
 const o=await setup(t); const plan=join(o.dir,'plan.jsonl');
 const bytes=JSON.stringify({type:'manifest',target:'https://fixture.supabase.co'})+'\n'+JSON.stringify({type:'mapping',document_id:id,text_sha256:sha,expected_fingerprint:fingerprint,status:'held'})+'\n'; await writeFile(plan,bytes);
 const no=()=>{throw Error('unexpected network');};
 await assert.rejects(()=>runLawListings({...o,receipts:undefined,plan,publish:true,approval:'wrong',decisionId:'decision',approver:'Owner'},no),/approval/);
 await assert.rejects(()=>runLawListings({...o,receipts:undefined,plan,publish:true,approval:digest(bytes),decisionId:'decision',approver:'Owner'},no),/held/);
});
test('publish sends only metadata and exact decision, then verifies remote publication',async t=>{
 const o=await setup(t);const plan=join(o.dir,'plan.jsonl');
 const bytes=JSON.stringify({type:'manifest',target:'https://fixture.supabase.co'})+'\n'+JSON.stringify({type:'mapping',document_id:id,text_sha256:sha,expected_fingerprint:fingerprint,status:'ready'})+'\n'; await writeFile(plan,bytes);
 const calls=[];
 const result=await runLawListings({...o,receipts:undefined,plan,publish:true,approval:digest(bytes),decisionId:'owner-1',approver:'Owner'},async(url,opts)=>{
 const b=JSON.parse(opts.body); calls.push(b);
 assert.equal(b.record,undefined);assert.equal(b.text,undefined);
 return reply({status:'published',record_id:id,document_key:`law-record:${id}`,row_key:'legacy',fingerprint});});
 assert.deepEqual(calls.map(x=>x.action),['law-publish','law-status']);assert.equal(calls[0].evidence_sha256,digest(bytes));assert.equal(result.published,1);
});
test('pending publication is not reported as complete and lost acknowledgement is not replayed',async t=>{
 const o=await setup(t);const plan=join(o.dir,'plan.jsonl');
 const bytes=JSON.stringify({type:'manifest',target:'https://fixture.supabase.co'})+'\n'+JSON.stringify({type:'mapping',document_id:id,text_sha256:sha,expected_fingerprint:fingerprint,status:'ready'})+'\n';await writeFile(plan,bytes);
 let calls=0;
 const result=await runLawListings({...o,receipts:undefined,plan,publish:true,approval:digest(bytes),decisionId:'owner-1',approver:'Owner'},async()=>{calls++;throw Error('lost ack');});
 assert.equal(calls,1);assert.equal(result.uncertain,1);assert.equal(result.published,0);
 assert.match(await readFile(o.report,'utf8'),/publishing/);
});
test('duplicate conflicting receipts and service tokens refuse before network',async t=>{
 const o=await setup(t);await writeFile(o.receipts,[sha,'c'.repeat(64)].map(h=>JSON.stringify({document_id:id,text_sha256:h})).join('\n'));
 await assert.rejects(()=>runLawListings(o,()=>{throw Error('network');}),/conflicting/);
 await assert.rejects(()=>runLawListings({...o,token:'sb_secret_no'},()=>{}),/admin/);
});
test('saved plan cannot be replayed against another project',async t=>{
 const o=await setup(t);const plan=join(o.dir,'plan.jsonl');
 const bytes=JSON.stringify({type:'manifest',target:'https://other.supabase.co'})+'\n'+JSON.stringify({type:'mapping',document_id:id,text_sha256:sha,expected_fingerprint:fingerprint,status:'ready'})+'\n';await writeFile(plan,bytes);
 await assert.rejects(()=>runLawListings({...o,receipts:undefined,plan,publish:true,approval:digest(bytes),decisionId:'owner-1',approver:'Owner'},()=>{throw Error('no network');}),/target/);
});
test('pending receipt stays pending rather than claiming success',async t=>{
 const o=await setup(t);const plan=join(o.dir,'plan.jsonl');const bytes=JSON.stringify({type:'manifest',target:'https://fixture.supabase.co'})+'\n'+JSON.stringify({type:'mapping',document_id:id,text_sha256:sha,expected_fingerprint:fingerprint,status:'ready'})+'\n';await writeFile(plan,bytes);
 const result=await runLawListings({...o,receipts:undefined,plan,publish:true,approval:digest(bytes),decisionId:'owner-1',approver:'Owner'},()=>reply({status:'pending',fingerprint}));assert.equal(result.pending,1);assert.equal(result.published,0);
});

test('shared transport refuses service credentials in the publishable-key slot',async t=>{
 const o=await setup(t);
 const serviceJwt='header.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.signature';
 for(const publishableKey of ['sb_secret_no',serviceJwt]) await assert.rejects(()=>runLawListings({...o,publishableKey},()=>reply({status:'ready',fingerprint})),/publishable/);
});
