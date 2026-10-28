import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportReadiness } from './corpus-readiness-export.mjs';
const token = 'header.'+Buffer.from(JSON.stringify({role:'authenticated'})).toString('base64url')+'.signature';
const cursor = after => JSON.stringify({kind:'records',tier:'national',feature:'Parliamentary Question Database',ids:[],cohort:null,after});
const record = row_key => ({row_key,document_key:null,title:'Question',association_adapter:'ordinary',state:'unmapped',links_limited:false,ready_documents:0,documents:[]});
const document = () => ({document_id:'11111111-1111-4111-8111-111111111111',title:'Answer',source_key:'fixture',source_url:'https://sansad.in/a.pdf',text_sha256:'a'.repeat(64),indexed:true,chunks_scanned:4,vectors_scanned:4,inspection_limited:false,index_state:'indexed',cohort:null,association_kind:'ordinary',publication_state:'not_managed',job:null});
const options = report => ({report,target:'https://fixture.supabase.co',release:'local-reviewed-sha',kind:'records',tier:'national',feature:'Parliamentary Question Database',token,publishableKey:'sb_publishable_fixture'});
test('export is bounded, read-only, resumable and never claims complete alias inventory', async t => {
 const dir=await mkdtemp(join(tmpdir(),'readiness-'));t.after(()=>rm(dir,{recursive:true,force:true})); const requests=[];
 const fetch=async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});return new Response(JSON.stringify({ok:true,contract_version:1,visibility:'admin',observed_at:'2026-10-28T00:00:00Z',items:[record(JSON.parse(init.body).cursor?'b':'a')],has_more:true,next_cursor:cursor(JSON.parse(init.body).cursor ? 'b' : 'a')}));};
 const first=join(dir,'first.jsonl');const result=await exportReadiness({...options(first),fetch,maxPages:1});
 assert.equal(requests.length,1);assert.equal(requests[0].body.action,'readiness-records');assert.equal(requests[0].body.limit,50);assert.equal(result.next_cursor,cursor('a'));
 const rows=(await readFile(first,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(rows[0].contract_version,1);assert.equal(rows[0].complete_alias_inventory,false);assert.equal(rows[1].observed_at,'2026-10-28T00:00:00Z');assert.equal(rows.at(-1).status,'page_limit');
 await exportReadiness({...options(join(dir,'second.jsonl')),fetch,resumeFrom:first});assert.equal(requests[1].body.cursor,cursor('a'));
 await assert.rejects(exportReadiness({...options(join(dir,'wrong.jsonl')),feature:'Other',fetch,resumeFrom:first}),/resume filters/);
 await assert.rejects(exportReadiness({...options(first),fetch}),/EEXIST/);
});
test('unknown response stops with an uncertainty receipt and no retry',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'readiness-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;const report=join(dir,'unknown.jsonl');
 await assert.rejects(exportReadiness({...options(report),maxPages:3,fetch:async()=>{calls++;return new Response(JSON.stringify({ok:true}));}}),/unconfirmed readiness/);
 assert.equal(calls,1);assert.match(await readFile(report,'utf8'),/"status":"unknown"/);
});
test('service credentials and unbounded page counts rejected before requests',async()=>{
 await assert.rejects(exportReadiness({...options('/unused'),token:'sb_secret_bad'}),/authenticated/);
 await assert.rejects(exportReadiness({...options('/unused'),maxPages:21}),/max-pages/);
});

test('foreign-scope cursor stops without a second request',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'readiness-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;
 await assert.rejects(exportReadiness({...options(join(dir,'bad-cursor.jsonl')),maxPages:2,fetch:async()=>{calls++;return new Response(JSON.stringify({ok:true,contract_version:1,visibility:'admin',observed_at:'2026-10-28T00:00:00Z',items:[],has_more:true,next_cursor:JSON.stringify({kind:'records',tier:'law',feature:'Other',ids:[],cohort:null,after:'a'})}));}}),/unconfirmed/);
 assert.equal(calls,1);
});
test('terminal first pages including empty matches are valid complete exports',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'readiness-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const items of [[],[record('one')]]) {
  const report=join(dir,'terminal-'+items.length+'.jsonl');
  const result=await exportReadiness({...options(report),fetch:async()=>new Response(JSON.stringify({ok:true,contract_version:1,visibility:'admin',observed_at:'2026-10-28T00:00:00Z',items,has_more:false,next_cursor:null}))});
  assert.equal(result.status,'complete');assert.equal(result.pages,1);assert.equal(result.next_cursor,null);
 }
});
test('cursor must follow the last returned identity and cannot advance an empty page',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'readiness-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const items of [[],[record('a')]]) await assert.rejects(exportReadiness({...options(join(dir,'cursor-'+items.length+'.jsonl')),fetch:async()=>new Response(JSON.stringify({ok:true,contract_version:1,visibility:'admin',observed_at:'2026-10-28T00:00:00Z',items,has_more:true,next_cursor:cursor('skipped')}))}),/unconfirmed/);
});
test('edited resume checkpoint cannot skip unexported identities',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'readiness-'));t.after(()=>rm(dir,{recursive:true,force:true}));const report=join(dir,'original.jsonl');
 const fetch=async()=>new Response(JSON.stringify({ok:true,contract_version:1,visibility:'admin',observed_at:'2026-10-28T00:00:00Z',items:[record('a')],has_more:true,next_cursor:cursor('a')}));
 await exportReadiness({...options(report),fetch});
 const rows=(await readFile(report,'utf8')).trim().split('\n').map(JSON.parse);rows.at(-1).next_cursor=cursor('skipped');
 const {writeFile}=await import('node:fs/promises');await writeFile(report,rows.map(JSON.stringify).join('\n')+'\n');
 await assert.rejects(exportReadiness({...options(join(dir,'resume.jsonl')),fetch,resumeFrom:report}),/resume/);
});
test('oversized response is cancelled before parsing or writing its payload',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'readiness-'));t.after(()=>rm(dir,{recursive:true,force:true}));let cancelled=false;let responseSignal;
 const report=join(dir,'oversize.jsonl');
 let sent=false;const body=new ReadableStream({pull(controller){if(sent)controller.close();else{sent=true;controller.enqueue(new Uint8Array(8_000_001).fill(120));}},cancel(){cancelled=true;}},{highWaterMark:0});
 await assert.rejects(exportReadiness({...options(report),fetch:async(_url,init)=>{responseSignal=init.signal;return new Response(body);}}),/unconfirmed/);
 assert.equal(cancelled,true);assert.equal(responseSignal.aborted,true);assert.ok((await readFile(report)).length<3000);
});
test('nested source text, vectors and unexpected job payload never enter metadata receipts',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'readiness-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const doc={...document(),identity_ok:true,role:'answer',version:'1',published:true};
 const cases=[{...record('a'),ocr_text:'PRIVATE_SOURCE_TEXT'},{...record('a'),documents:[{...doc,ocr_text:'PRIVATE_SOURCE_TEXT'}]},
  {...record('a'),documents:[{...doc,embedding:[1,2,3]}]},{...record('a'),documents:[{...doc,job:{payload:'PRIVATE_SOURCE_TEXT'}}]},
  {...record('a'),documents:[{...doc,chunks_scanned:1002}]}];
 for(let i=0;i<cases.length;i++) {
  const report=join(dir,'payload-'+i+'.jsonl');
  await assert.rejects(exportReadiness({...options(report),fetch:async()=>new Response(JSON.stringify({ok:true,contract_version:1,visibility:'admin',observed_at:'2026-10-28T00:00:00Z',items:[cases[i]],has_more:false,next_cursor:null}))}),/unconfirmed/);
  const saved=await readFile(report,'utf8');assert.doesNotMatch(saved,/PRIVATE_SOURCE_TEXT|"embedding"|"type":"page"/);
 }
});

test('valid bounded nested diagnostics export as a segment with explicit parent limits',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'readiness-'));t.after(()=>rm(dir,{recursive:true,force:true}));const report=join(dir,'metadata.jsonl');
 const item={row_key:'a',document_key:null,title:'Question',association_adapter:'ordinary',state:'privileged_ready',links_limited:false,ready_documents:1,documents:[{document_id:'11111111-1111-4111-8111-111111111111',title:'Answer',source_key:'fixture',source_url:'https://sansad.in/a.pdf',text_sha256:'a'.repeat(64),indexed:true,chunks_scanned:4,vectors_scanned:4,inspection_limited:false,index_state:'indexed',cohort:null,association_kind:'ordinary',publication_state:'not_managed',job:null,identity_ok:true,role:'answer',version:'1',published:true}]};
 await exportReadiness({...options(report),fetch:async()=>new Response(JSON.stringify({ok:true,contract_version:1,visibility:'admin',observed_at:'2026-10-28T00:00:00Z',items:[item],has_more:false,next_cursor:null}))});
 const rows=(await readFile(report,'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(rows[1].items,[item]);assert.equal(rows[0].receipt_scope,'bounded_segment');assert.equal(rows[0].preceding_segments_verified,false);
});
test('incomplete normal readiness shapes are unknown rather than complete',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'readiness-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const without=(item,key)=>Object.fromEntries(Object.entries(item).filter(([name])=>name!==key));
 const cases=[['records',{}],['records',{row_key:'a'}],['records',without(record('a'),'state')],['records',without(record('a'),'association_adapter')],['records',without(record('a'),'documents')],
  ['documents',{document_id:document().document_id}],['documents',without(document(),'index_state')],['documents',without(document(),'association_kind')],['documents',{...document(),job:{}}],
  ['records',{...record('a'),documents:[{...document(),identity_ok:true,role:'answer',version:'1'}]}]];
 for(let i=0;i<cases.length;i++) {
  const [kind,item]=cases[i],report=join(dir,'missing-'+i+'.jsonl');
  await assert.rejects(exportReadiness({...options(report),kind,fetch:async()=>new Response(JSON.stringify({ok:true,contract_version:1,visibility:'admin',observed_at:'2026-10-28T00:00:00Z',items:[item],has_more:false,next_cursor:null}))}),/unconfirmed/);
  const saved=await readFile(report,'utf8');assert.match(saved,/"status":"unknown"/);assert.doesNotMatch(saved,/"type":"page"/);
 }
});
test('normal document diagnostics and exact nested inspection-limit placeholders remain valid',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'readiness-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const limited={document_id:document().document_id,index_state:'inspection_limited',inspection_limited:true,identity_ok:true,role:'answer',version:'1',published:true};
 const cases=[['documents',document()],['documents',{...document(),chunks_scanned:1001,vectors_scanned:1001,inspection_limited:true,index_state:'inspection_limited'}],
  ['records',{...record('a'),state:'inspection_limited',documents:[limited]}]];
 for(let i=0;i<cases.length;i++) {
  const [kind,item]=cases[i];const result=await exportReadiness({...options(join(dir,'variant-'+i+'.jsonl')),kind,fetch:async()=>new Response(JSON.stringify({ok:true,contract_version:1,visibility:'admin',observed_at:'2026-10-28T00:00:00Z',items:[item],has_more:false,next_cursor:null}))});
  assert.equal(result.status,'complete');
 }
 const casesBad=[['documents',limited],['records',{...record('a'),documents:[{...limited,inspection_limited:false}]}],['records',{...record('a'),documents:[{...limited,association_kind:'ordinary'}]}]];
 for(let i=0;i<casesBad.length;i++) {
  const [kind,item]=casesBad[i];await assert.rejects(exportReadiness({...options(join(dir,'bad-variant-'+i+'.jsonl')),kind,fetch:async()=>new Response(JSON.stringify({ok:true,contract_version:1,visibility:'admin',observed_at:'2026-10-28T00:00:00Z',items:[item],has_more:false,next_cursor:null}))}),/unconfirmed/);
 }
});
