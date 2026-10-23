import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { runImport } from './corpus-text-import.mjs';
import { input } from '../supabase/functions/_shared/suppliedText_fixture.ts';
const hash = (b) => createHash('sha256').update(b).digest('hex');
async function fixture(t, records) {
  const dir = await mkdtemp(join(tmpdir(), 'corpus-import-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const r = await input();
  const bytes = gzipSync((records ?? [r]).map((x) => JSON.stringify(x)).join('\n') + '\n');
  const file = join(dir, 'corpus.jsonl.gz');
  await writeFile(file, bytes);
  const decisions = join(dir, 'decisions.jsonl');
  const decision = {
    source_key: r.source_key,
    text_sha256: r.text_sha256,
    file_sha256: hash(bytes),
    desk_feature: r.desk_feature,
    review: r.review,
  };
  const manifest = JSON.stringify(decision) + '\n';
  await writeFile(decisions, manifest);
  return { files: [file], decisions, report: join(dir, 'report.jsonl'), approval: hash(manifest), dir };
}
test('dry run reads gzip and reports eligible documents without network', async (t) => {
  const f = await fixture(t);
  const out = await runImport(f, () => {
    throw Error('no network');
  });
  assert.equal(out.ready, 1);
  assert.equal(out.submitted, 0);
  assert.match(await readFile(f.report, 'utf8'), /ready/);
});
test('a duplicate source with changed metadata is held before any submission', async (t) => {
  const r = await input();
  const f = await fixture(t, [r, { ...r, title: 'Changed' }]);
  const out = await runImport(f, () => {
    throw Error('no network');
  });
  assert.equal(out.held, 1);
  assert.equal(out.ready, 0);
});
test('submission uses admin endpoint and never uploads chunks or calls OCR', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const out = await runImport({
    ...f,
    submit: true,
    target: 'https://fixture.supabase.co',
    token: 'admin-token',
    publishableKey: 'public',
  }, async (url, opts) => {
    calls++;
    assert.equal(url, 'https://fixture.supabase.co/functions/v1/admin-ingest?input=supplied-text');
    const body = JSON.parse(opts.body);
    assert.equal(body.action, 'register_text');
    assert.equal(body.expected, undefined);
    assert.equal(body.record.text, (await input()).text);
    return new Response(
      JSON.stringify({
        ok: true,
        status: 'queued',
        document_id: 'doc',
        job_id: 'job',
        payload_sha256: body.confirm_sha256,
      }),
      { status: 200 },
    );
  });
  assert.equal(calls, 1);
  assert.equal(out.submitted, 1);
});
test('changed approval and unbound corpus refuse before network', async (t) => {
  const f = await fixture(t);
  await assert.rejects(() => runImport({ ...f, submit: true, approval: 'bad' }), /approval/);
  const rows = (await readFile(f.decisions, 'utf8')).replace(
    /"file_sha256":"[a-f0-9]+"/,
    '"file_sha256":"' + 'b'.repeat(64) + '"',
  );
  await writeFile(f.decisions, rows);
  const out = await runImport({ ...f, report: join(f.dir, 'other.jsonl') });
  assert.equal(out.held, 1);
  assert.equal(out.ready, 0);
});
test('lost registration acknowledgement is reported as uncertain, without automatic replay', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const out = await runImport({
    ...f,
    submit: true,
    target: 'https://fixture.supabase.co',
    token: 'admin-token',
    publishableKey: 'public',
  }, async () => {
    calls++;
    throw Error('connection lost after write');
  });
  assert.equal(calls, 1);
  assert.equal(out.uncertain, 1);
  assert.match(await readFile(f.report, 'utf8'), /submitting/);
});
test('known incomplete text is held even with an eligible decision', async (t) => {
  const r = await input();
  const f = await fixture(t, [{ ...r, page_split: 'cut_at_250' }]);
  const out = await runImport(f);
  assert.equal(out.held, 1);
  assert.equal(out.ready, 0);
});
test('malformed and oversized lines fail before any network writes', async (t) => {
  const f = await fixture(t);
  await writeFile(f.files[0], gzipSync('x'.repeat(8_000_001)));
  let calls = 0;
  await assert.rejects(() =>
    runImport(f, async () => {
      calls++;
    }), /line limit/);
  assert.equal(calls, 0);
});
async function ncltFixture(t) {
 const r=await input();r.source_key='law:trib:IBBI_NCLT:test';r.review.source_key=r.source_key;r.desk_feature='NCLT / NCLAT (Insolvency)';
 r.doc_type='tribunal_order';r.file_url='https://ibbi.gov.in/uploads/order/test.pdf';r.citation={...r.citation,kind:'tribunal_order',forum:'NCLT',source:'IBBI_NCLT'};
 const f=await fixture(t,[r]);
 const d={source_key:r.source_key,text_sha256:r.text_sha256,file_sha256:hash(await readFile(f.files[0])),desk_feature:r.desk_feature,review:r.review};
 const bytes=JSON.stringify(d)+'\n';await writeFile(f.decisions,bytes);return {...f,approval:hash(bytes)};
}
const lawReply=v=>new Response(JSON.stringify({ok:true,contract_version:1,fingerprint:'b'.repeat(64),reasons:[],...v}),{status:200});
test('NCLT submission reconciles live state before registration and preserves publication status separately',async t=>{
 const f=await ncltFixture(t);const calls=[];
 const result=await runImport({...f,maxEstimatedCostUsd:1,submit:true,target:'https://fixture.supabase.co',token:'admin-token',publishableKey:'public'},async(url,opts)=>{
 const b=JSON.parse(opts.body);calls.push(b.action);
 if(b.action==='law-reconcile')return lawReply({status:'ready',action:'create-listing',document_id:null,indexed:false});
 if(b.action==='law-status')return lawReply({status:'pending',document_id:'doc'});
 assert.equal(b.expected_mapping_fingerprint,'b'.repeat(64));
 return new Response(JSON.stringify({ok:true,status:'queued',document_id:'doc',job_id:'job',payload_sha256:b.confirm_sha256}));
 });
 assert.deepEqual(calls,['law-reconcile','register_text','law-status']);assert.equal(result.publication_pending,1);assert.equal(result.published,0);
 assert.match(await readFile(f.report,'utf8'),/text_sha256/);
});
test('NCLT mapping hold makes no registration call',async t=>{
 const f=await ncltFixture(t);const calls=[];
 const result=await runImport({...f,maxEstimatedCostUsd:1,submit:true,target:'https://fixture.supabase.co',token:'admin-token',publishableKey:'public'},async(url,opts)=>{
 const b=JSON.parse(opts.body);calls.push(b.action);return lawReply({status:'held',reasons:['identity conflict']});
 });assert.deepEqual(calls,['law-reconcile']);assert.equal(result.submitted,0);assert.equal(result.held,1);
});
test('NCLT already registered document skips ingestion and reads publication receipt',async t=>{
 const f=await ncltFixture(t);const calls=[];
 const result=await runImport({...f,maxEstimatedCostUsd:1,submit:true,target:'https://fixture.supabase.co',token:'admin-token',publishableKey:'public'},async(url,opts)=>{
 const b=JSON.parse(opts.body);calls.push(b.action);return lawReply(b.action==='law-reconcile'?{status:'ready',document_id:'existing-doc',indexed:true}:{status:'pending',document_id:'existing-doc'});
 });assert.deepEqual(calls,['law-reconcile','law-status']);assert.equal(result.submitted,0);assert.equal(result.already_registered,1);
});
test('online reconciliation mode never registers a source',async t=>{
 const f=await ncltFixture(t);const calls=[];
 const result=await runImport({...f,reconcile:true,target:'https://fixture.supabase.co',token:'admin-token',publishableKey:'public'},async(url,opts)=>{calls.push(JSON.parse(opts.body).action);return lawReply({status:'ready',document_id:null,indexed:false});});
 assert.deepEqual(calls,['law-reconcile']);assert.equal(result.submitted,0);
});
test('NCLT cost envelope refuses before registration when missing or exceeded',async t=>{
 const f=await ncltFixture(t);const o={...f,submit:true,target:'https://fixture.supabase.co',token:'admin-token',publishableKey:'public'};
 const request=async(url,opts)=>{assert.equal(JSON.parse(opts.body).action,'law-reconcile');return lawReply({status:'ready',document_id:null});};
 await assert.rejects(()=>runImport(o,request),/cost/);
 await assert.rejects(()=>runImport({...o,maxEstimatedCostUsd:1e-12},request),/cost/);
});
test('CLI returns incomplete for live mapping holds and pending publication',async t=>{
 const {createServer}=await import('node:http');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile);
 let mode='held';const server=createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);let value;
  if(body.action==='law-reconcile')value={ok:true,contract_version:1,status:mode==='held'?'held':'ready',fingerprint:'b'.repeat(64),reasons:[],document_id:null};
  else if(body.action==='law-status')value={ok:true,contract_version:1,status:'pending',document_id:'doc'};
  else value={ok:true,status:'queued',document_id:'doc',job_id:'job',payload_sha256:body.confirm_sha256};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 for(const state of ['held','pending']){
  mode=state;const f=await ncltFixture(t);
  await assert.rejects(()=>run(process.execPath,['--experimental-strip-types','scripts/corpus-text-import.mjs','--corpus',f.files[0],'--decisions',f.decisions,'--report',f.report,'--submit','--approval',f.approval,'--target',`http://127.0.0.1:${server.address().port}`,'--max-estimated-cost-usd','1'],{env:{...process.env,NTER_INGEST_ACCESS_TOKEN:'admin-test',SUPABASE_PUBLISHABLE_KEY:'public'}}),e=>{assert.equal(e.code,state==='held'?3:2);return true;});
 }
});
