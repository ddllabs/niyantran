import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateEntries,validateListingRows,verifyStored,runStage} from './corpus-stage-job.mjs';
import * as job from './corpus-stage-job.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
function entry(key='source-a') { return {expectedChunks:1,doc:{source_key:key,title:'Test Bill',ocr_text:'Evidence',file_url:'https://sansad.in/sample.pdf',metadata:{document_key:'bill:2025:1',text_sha256:sha('Evidence'),n_chars:8}}}; }
function stored(e) { return {document:{id:'uuid',indexed_at:'now',ocr_text:e.doc.ocr_text,content_sha256:sha(e.doc.ocr_text),file_url:e.doc.file_url,metadata:e.doc.metadata},chunks:[{chunk_hash:'hash',content:'Evidence',char_from:0,char_to:8,source_kind:'document',page_number:null,embedding:Array(1536).fill(0.1)}]}; }
function fake(){const records=new Map();const receipts=[];return {records,receipts,read:async key=>records.get(key)||null,save:async state=>receipts.push(structuredClone(state)),post:async(doc,dry)=>{if(!dry)records.set(doc.source_key,stored({doc}));return {results:[{source_key:doc.source_key,status:dry?'dry_run':'indexed',chunks:1,errors:0}],totals:{documents:1,errors:0}};}};}
test('source hash mismatch prevents requests',()=>{const e=entry();e.doc.ocr_text='Changed';assert.throws(()=>validateEntries([e]),/hash/);});
test('duplicate source IDs cannot be submitted',()=>assert.throws(()=>validateEntries([entry(),entry()]),/duplicate/));
test('missing vectors cannot become a verified checkpoint',()=>{const e=entry();const x=stored(e);x.chunks[0].embedding=null;assert.throws(()=>verifyStored(e,x),/embedding/);});
test('wrong bill identity cannot become a verified checkpoint',()=>{const e=entry();const x=stored(e);x.document.metadata={...e.doc.metadata,document_key:'bill:2024:1'};assert.throws(()=>verifyStored(e,x),/identity/);});
test('HTTP-200 per-document failure stops before another document',async()=>{const d=fake();d.post=async()=>({results:[{source_key:'source-a',status:'error',chunks:0}],totals:{documents:1,errors:1}});await assert.rejects(runStage([entry(),entry('source-b')],d,{},true),/result/);assert.equal(d.records.size,0);});
test('a completed stage resumes without new provider requests',async()=>{const d=fake();const state=await runStage([entry()],d,{},true);d.post=async()=>{throw Error('duplicate paid request')};await runStage([entry()],d,state,true);assert.equal(d.records.size,1);});
test('unexpected existing source stops without overwrite',async()=>{const d=fake();d.records.set('source-a',stored(entry()));await assert.rejects(runStage([entry()],d,{},true),/existing/);});
test('partial saved document requires investigation instead of automatic retry',async()=>{const d=fake();const x=stored(entry());x.document.indexed_at=null;d.records.set('source-a',x);await assert.rejects(runStage([entry()],d,{entries:{'source-a':{phase:'in_flight'}}},true),/indexed/);});
test('checkpoint exists before a live request with an uncertain outcome',async()=>{const d=fake();d.post=async(doc,dry)=>{if(dry)return {results:[{source_key:doc.source_key,status:'dry_run',chunks:1}],totals:{documents:1,errors:0}};throw Error('network interrupted');};await assert.rejects(runStage([entry()],d,{},true),/network/);assert.equal(d.receipts.at(-1).entries['source-a'].phase,'in_flight');});
test('out-of-bounds offsets are rejected even when slice would clamp them',()=>{const e=entry();const x=stored(e);x.chunks[0].char_to=9;assert.throws(()=>verifyStored(e,x),/span/);});

test('shared bill key with distinct titles is rejected before any ingestion',()=>{assert.throws(()=>validateListingRows(entry(),[{row:{title:'Test Bill',house:'Lok Sabha'}},{row:{title:'Another Bill',house:'Lok Sabha'}}]),/collision/);});

const limits={documents:25,chunks:1000,document_chunks:100,document_chars:50000,gap_ms:2000,max_attempts:5,budget_usd:1};
function controlledFake(){return {...fake(),validate:async()=>{},health:async()=>{},now:()=>100000,sleep:async()=>{},reserve:()=>0.01};}

const largeLimits={...limits,stage_profile:'sequential_500_v1',documents:500,chunks:20000,budget_usd:10};
test('500-entry opt-in stage is sequential, pauses for maintenance and resumes without repeated writes',async()=>{
 const entries=Array.from({length:500},(_,i)=>entry('large-'+i));const d=controlledFake();d.metrics=async()=>{};d.acknowledgeMaintenance=async()=>true;
 let active=0,maxActive=0,writes=0;const post=d.post;
 d.post=async(doc,dry)=>{if(!dry){writes++;active++;maxActive=Math.max(maxActive,active);}const r=await post(doc,dry);if(!dry){active--;if(['large-0','large-249','large-499'].includes(doc.source_key))throw Object.assign(Error('lost response'),{transient:true,uncertain:true});}return r;};
 const state={};let pauses=0;
 do {await job.runControlledStage(entries,d,state,true,largeLimits);if(state.status==='maintenance_paused')pauses++;}while(state.status==='maintenance_paused');
 assert.equal(state.status,'complete');assert.equal(writes,500);assert.equal(maxActive,1);assert.equal(pauses,24);assert.equal(Object.keys(state.entries).length,500);
 await job.runControlledStage(entries,d,state,true,largeLimits);assert.equal(writes,500);
});
test('large stage rejects missing metrics and invalid aggregate bounds before requests',async()=>{
 const d=controlledFake();await assert.rejects(job.runControlledStage([entry()],d,{},true,largeLimits),/metrics/);assert.equal(d.records.size,0);
 d.metrics=async()=>{};
 for(const bad of [{documents:501},{chunks:20001},{stage_profile:'unknown'}])await assert.rejects(job.runControlledStage([entry()],d,{},true,{...largeLimits,...bad}),/profile|bound/);
 const many=Array.from({length:501},(_,i)=>entry('overflow-'+i));await assert.rejects(job.runControlledStage(many,d,{},true,largeLimits),/bound/);
 const text='x'.repeat(75000);const bulky=Array.from({length:134},(_,i)=>({expectedChunks:1,doc:{...entry('bulky-'+i).doc,ocr_text:text,metadata:{...entry().doc.metadata,text_sha256:sha(text),n_chars:text.length}}}));
 await assert.rejects(job.runControlledStage(bulky,d,{},false,{...largeLimits,document_chars:75000}),/aggregate text/);assert.equal(d.records.size,0);
});
test('large stage fails closed on metrics pressure and unacknowledged maintenance',async()=>{
 const d=controlledFake();d.metrics=async()=>{throw Error('CPU pressure')};const state={};await assert.rejects(job.runControlledStage([entry()],d,state,true,largeLimits),/CPU/);assert.equal(state.status,'health_paused');assert.equal(d.records.size,0);
 const fresh=controlledFake();fresh.metrics=async()=>{};const paused={status:'maintenance_paused',maintenance:{verified_documents:20,verified_chunks:20}};
 await assert.rejects(job.runControlledStage([entry()],fresh,paused,true,largeLimits),/maintenance/);assert.equal(fresh.records.size,0);
});
test('metrics pressure mid-stage preserves verified progress and stops further paid work',async()=>{
 const d=controlledFake();let checks=0;d.metrics=async()=>{if(++checks===7)throw Error('CPU pressure')};const state={};
 await assert.rejects(job.runControlledStage(Array.from({length:30},(_,i)=>entry('pressure-'+i)),d,state,true,largeLimits),/CPU/);
 assert.equal(d.records.size,5);assert.equal(Object.values(state.entries).filter(x=>x.phase==='verified').length,5);assert.equal(state.status,'health_paused');
 await assert.rejects(job.runControlledStage([entry()],d,state,true,largeLimits),/health_paused/);assert.equal(d.records.size,5);
});
test('new job reconciles a timeout after a committed write without paying twice',async()=>{
 const d=controlledFake();let live=0;const original=d.post;d.post=async(doc,dry)=>{const result=await original(doc,dry);if(!dry){live++;throw Object.assign(Error('timeout'),{transient:true,uncertain:true});}return result;};
 const state={};await job.runControlledStage([entry()],d,state,true,limits);assert.equal(state.entries['source-a'].phase,'verified');assert.equal(live,1);
});
test('new job persists a terminal hold for a partial write and restart cannot retry it',async()=>{
 const d=controlledFake();const partial=stored(entry());partial.document.indexed_at=null;d.records.set('source-a',partial);const state={entries:{'source-a':{phase:'in_flight',attempts:1}}};d.post=async()=>{throw Error('unsafe duplicate embedding')};
 await assert.rejects(job.runControlledStage([entry()],d,state,true,limits),/indexed/);assert.equal(state.status,'held');assert.equal(state.repair.source_key,'source-a');await assert.rejects(job.runControlledStage([entry()],d,state,true,limits),/held/);
});
test('controlled job rejects a stage larger than its approved 25-document manifest',async()=>assert.rejects(job.runControlledStage(Array.from({length:26},(_,i)=>entry('source-'+i)),controlledFake(),{},true,limits),/stage bound/));
test('budget reservation blocks paid work and survives restart',async()=>{const d=controlledFake();const state={spent_ceiling_usd:1};await assert.rejects(job.runControlledStage([entry()],d,state,true,limits),/budget/);assert.equal(d.records.size,0);assert.equal(state.status,'held');});
test('transient rejection persists bounded attempts instead of retrying in a tight loop',async()=>{
 const d=controlledFake();d.post=async(doc,dry)=>{if(dry)return {results:[{source_key:doc.source_key,status:'dry_run',chunks:1}],totals:{documents:1,errors:0}};throw Object.assign(Error('rate limited'),{transient:true,retryAfterMs:10000});};
 const state={};await assert.rejects(job.runControlledStage([entry()],d,state,true,limits),/retry/);assert.equal(state.status,'retry_wait');assert.equal(state.entries['source-a'].attempts,1);assert.ok(state.wake_at>=110000);
});
test('verified-source mapping is rechecked before it may be skipped on restart',async()=>{const d=controlledFake();const state=await job.runControlledStage([entry()],d,{},true,limits);d.validate=async()=>{throw Error('key collision')};await assert.rejects(job.runControlledStage([entry()],d,state,true,limits),/collision/);assert.equal(state.status,'held');});
test('unhealthy stage does no paid work and remains paused after restart',async()=>{const d=controlledFake();d.health=async()=>{throw Error('retrieval latency')};const state={};await assert.rejects(job.runControlledStage([entry()],d,state,true,limits),/latency/);assert.equal(d.records.size,0);assert.equal(state.status,'health_paused');});
test('chunk identity mismatch is rejected even if count and text span match',()=>{const e=entry();e.expectedSpans=[{chunk_hash:'expected',chunk_index:0,char_from:0,char_to:8}];const current=stored(e);assert.throws(()=>verifyStored(e,current),/chunk identity/);});
test('duplicate chunk hashes keep the first occurrence as the production handler does',()=>{const first={chunkHash:'same',charFrom:0,charTo:8},later={chunkHash:'same',charFrom:20,charTo:28};assert.deepEqual(job.uniqueChunks([first,later]),[first]);});
test('PDF fetching rejects non-Sansad and credential-bearing source URLs before a request',()=>{for(const url of ['http://localhost/private.pdf','https://other.example/file.pdf','https://user:secret@sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/a.pdf'])assert.throws(()=>job.validatePdfUrl(url),/PDF URL/);assert.doesNotThrow(()=>job.validatePdfUrl('https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/a.pdf?source=legislation'));});
test('a key that changes during ingestion is held even though its document is indexed',async()=>{const d=controlledFake();let changed=false;const post=d.post;d.post=async(doc,dry)=>{const r=await post(doc,dry);if(!dry)changed=true;return r;};d.validate=async()=>{if(changed)throw Error('new key collision')};const state={};await assert.rejects(job.runControlledStage([entry()],d,state,true,limits),/collision/);assert.equal(state.status,'held');assert.equal(state.repair.document_id,'uuid');});
test('transient preflight reads schedule bounded retry instead of terminal identity hold',async()=>{const d=controlledFake();d.validate=async()=>{throw Object.assign(Error('offline'),{transient:true})};const state={};await assert.rejects(job.runControlledStage([entry()],d,state,true,limits),/retry/);assert.equal(state.status,'retry_wait');assert.equal(d.records.size,0);});
test('a changed approved manifest cannot run',t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'corpus-manifest-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'stage.json');fs.writeFileSync(file,'{}');const approved=sha('{}');fs.writeFileSync(file,'{"changed":true}');assert.throws(()=>job.loadJobManifest(file,approved),/manifest changed/);});
test('dry-run network retries cannot loop forever across worker restarts',async()=>{const d=controlledFake();d.post=async()=>{throw Object.assign(Error('dry run offline'),{transient:true})};const state={};for(let i=0;i<5;i++){if(state.wake_at)state.wake_at=0;await assert.rejects(job.runControlledStage([entry()],d,state,true,limits));}assert.equal(state.entries['source-a'].dry_attempts,5);state.wake_at=0;await assert.rejects(job.runControlledStage([entry()],d,state,true,limits),/exhausted/);assert.equal(state.status,'held');});
test('production handler completion followed by lost response reconciles without re-embedding',async()=>{
 const {handleIngest}=await import('../supabase/functions/ingest-documents/handler.ts');
 const {chunkDocument}=await import('../supabase/functions/_shared/chunking.ts');
 const e=entry();const expected=await chunkDocument(e.doc.ocr_text);e.expectedSpans=expected.map(c=>({chunk_hash:c.chunkHash,chunk_index:c.chunkIndex,char_from:c.charFrom,char_to:c.charTo}));
 let document=null,chunks=[],paidCalls=0;const logs=[];
 const db={findDocument:async()=>document,upsertDocument:async row=>{document={...row,id:'local-fixture',chunker_version:null,indexed_at:null};return {id:document.id};},updateDocumentMeta:async(id,fields)=>Object.assign(document,fields),existingHashes:async()=>new Set(chunks.map(c=>c.chunk_hash)),chunkCommit:async(id,rows)=>{chunks=rows;return {inserted:rows.length,kept:0,deleted:0};},markIndexed:async(id,version)=>Object.assign(document,{indexed_at:'now',chunker_version:version}),logCall:async row=>logs.push(row)};
 const d={...controlledFake(),read:async()=>document?{document,chunks}:null,post:async(doc,dry_run)=>{const response=await handleIngest(new Request('http://localhost/ingest',{method:'POST',headers:{authorization:'Bearer local-fixture-key','content-type':'application/json'},body:JSON.stringify({documents:[doc],dry_run})}),{secretKey:'local-fixture-key',origins:[],db,embed:async inputs=>{paidCalls++;return {vectors:inputs.map(()=>Array(1536).fill(0.1)),promptTokens:2,costUsd:0.00000004,requests:1,model:'test-model'};}});const result=await response.json();if(!dry_run)throw Object.assign(Error('lost successful response'),{transient:true,uncertain:true});return result;}};
 const state=await job.runControlledStage([e],d,{},true,limits);assert.equal(state.status,'complete');assert.equal(paidCalls,1);assert.equal(chunks.length,1);assert.equal(logs.length,1);
 await job.runControlledStage([e],d,state,true,limits);assert.equal(paidCalls,1);
});

test('explicit 30-document stage completes with all sources verified',async()=>{const d=controlledFake();const entries=Array.from({length:30},(_,i)=>entry('approved-'+i));const state=await job.runControlledStage(entries,d,{},true,{...limits,documents:30});assert.equal(state.status,'complete');assert.equal(d.records.size,30);assert.equal(Object.values(state.entries).filter(x=>x.phase==='verified').length,30);});
test('stage cap above 30 stops before any production writes',async()=>{const d=controlledFake();await assert.rejects(job.runControlledStage(Array.from({length:31},(_,i)=>entry('too-many-'+i)),d,{},true,{...limits,documents:31}),/stage bound/);assert.equal(d.records.size,0);assert.equal(d.receipts.length,0);});

test('context receipt rejects missing or stale embedding-input hashes and section metadata',()=>{
 const e=entry();e.doc.chunking_mode='section_context_v1';
 e.expectedSpans=[{chunk_hash:'hash',chunk_index:0,char_from:0,char_to:8,embed_hash:sha('Powers\n\nEvidence'),section:{heading:'Powers'}}];
 const current=stored(e);current.document.chunker_version=4;Object.assign(current.chunks[0],{chunk_index:0,chunker_version:4,embed_hash:e.expectedSpans[0].embed_hash,metadata:{section:{heading:'Powers'}}});
 verifyStored(e,current);
 current.chunks[0].embed_hash=sha('Evidence');assert.throws(()=>verifyStored(e,current),/context/);
 current.chunks[0].embed_hash=e.expectedSpans[0].embed_hash;current.chunks[0].metadata={};assert.throws(()=>verifyStored(e,current),/context/);
});

test('75,000 character bound accepts a whole source and 75,001 rejects before requests',async()=>{
 const e=entry();e.doc.ocr_text='a'.repeat(75000);e.doc.metadata.text_sha256=sha(e.doc.ocr_text);e.doc.metadata.n_chars=75000;
 const d=controlledFake();await job.runControlledStage([e],d,{},false,{...limits,document_chars:75000});
 e.doc.ocr_text+='a';e.doc.metadata.text_sha256=sha(e.doc.ocr_text);e.doc.metadata.n_chars=75001;
 const fresh=controlledFake();await assert.rejects(job.runControlledStage([e],fresh,{},false,{...limits,document_chars:75000}),/document bound/);assert.equal(fresh.receipts.length,0);
});

test('context preparation freezes prefixes in both identity and token ceiling',async()=>{
 const e=entry();e.doc.ocr_text='# Powers\nEvidence';e.doc.metadata.text_sha256=sha(e.doc.ocr_text);e.doc.metadata.n_chars=e.doc.ocr_text.length;e.doc.chunking_mode='section_context_v1';
 const chunks=await job.prepareTextChunks(e.doc.ocr_text,e.doc.chunking_mode);e.expectedChunks=chunks.length;e.expectedSpans=job.expectedChunkSpans(chunks);e.tokenCeiling=chunks.reduce((n,c)=>n+Buffer.byteLength(c.embedding_input),0);
 await job.verifyPreparedEntry(e,4);
 const old=e.tokenCeiling;e.tokenCeiling=Buffer.byteLength(chunks[0].content);await assert.rejects(job.verifyPreparedEntry(e,4),/identity\/token/);e.tokenCeiling=old;
 e.expectedSpans[0].section.heading='Unverified label';await assert.rejects(job.verifyPreparedEntry(e,4),/identity\/token/);
});

test('context verification accepts JSONB key ordering while rejecting changed context values',()=>{
 const e=entry();e.doc.chunking_mode='section_context_v1';e.expectedSpans=[{chunk_hash:'hash',chunk_index:0,char_from:0,char_to:8,embed_hash:sha('context'),section:{heading:'Powers',note:'1.'}}];
 const c=stored(e);c.document.chunker_version=4;Object.assign(c.chunks[0],{chunk_index:0,chunker_version:4,embed_hash:sha('context'),metadata:{section:{note:'1.',heading:'Powers'}}});
 verifyStored(e,c);c.chunks[0].metadata.section.note='2.';assert.throws(()=>verifyStored(e,c),/context/);
});

test('a context job refuses an old endpoint dry run before any paid request even when counts match',async()=>{
 const e=entry();e.doc.chunking_mode='section_context_v1';
 const d=controlledFake();let live=0;const post=d.post;d.post=async(doc,dry)=>{if(!dry)live++;return post(doc,dry);};
 await assert.rejects(job.runControlledStage([e],d,{},true,limits));assert.equal(live,0);assert.equal(d.records.size,0);
});

test('real context handler acknowledges its mode and reconciles a lost successful response',async()=>{
 const {handleIngest}=await import('../supabase/functions/ingest-documents/handler.ts');
 const e=entry();e.doc.ocr_text='# Powers\nEvidence';e.doc.metadata.text_sha256=sha(e.doc.ocr_text);e.doc.metadata.n_chars=e.doc.ocr_text.length;e.doc.chunking_mode='section_context_v1';
 const chunks=await job.prepareTextChunks(e.doc.ocr_text,e.doc.chunking_mode);e.expectedChunks=chunks.length;e.expectedSpans=job.expectedChunkSpans(chunks);
 let document=null,storedChunks=[],calls=0;
 const db={findDocument:async()=>document,upsertDocument:async row=>{document={...row,id:'local-context',chunker_version:null,indexed_at:null};return {id:document.id};},updateDocumentMeta:async()=>{},existingHashes:async()=>new Set(storedChunks.map(c=>c.chunk_hash)),chunkCommit:async(id,rows)=>{storedChunks=rows;return {inserted:rows.length,kept:0,deleted:0};},markIndexed:async(id,v)=>Object.assign(document,{chunker_version:v,indexed_at:'now'}),logCall:async()=>{}};
 const deps={...controlledFake(),read:async()=>document?{document,chunks:storedChunks}:null,post:async(doc,dry_run)=>{
   const response=await handleIngest(new Request('http://localhost/local-context',{method:'POST',headers:{authorization:'Bearer fixture-key','content-type':'application/json'},body:JSON.stringify({documents:[doc],dry_run})}),{secretKey:'fixture-key',origins:[],db,embed:async inputs=>{calls++;return {vectors:inputs.map(()=>Array(1536).fill(0.1)),model:'fixture',promptTokens:0,costUsd:0,requests:1};}});
   const result=await response.json();if(!dry_run)throw Object.assign(Error('lost response'),{transient:true,uncertain:true});return result;
 }};
 const state=await job.runControlledStage([e],deps,{},true,limits);assert.equal(state.status,'complete');assert.equal(calls,1);assert.equal(document.chunker_version,4);
 await job.runControlledStage([e],deps,state,true,limits);assert.equal(calls,1);
});

test('medium profile is explicit, context-only and bounded at 800 chunks',()=>{
 const e=entry();e.expectedChunks=800;e.doc.chunking_mode='section_context_v1';
 assert.doesNotThrow(()=>job.validateEntries([e],'medium_v1'));
 assert.throws(()=>job.validateEntries([e]),/chunk bound/);
 e.expectedChunks=801;assert.throws(()=>job.validateEntries([e],'medium_v1'),/chunk bound/);
 e.expectedChunks=103;delete e.doc.chunking_mode;assert.throws(()=>job.validateEntries([e],'medium_v1'),/context/);
 assert.throws(()=>job.validateEntries([entry()],'unknown'),/profile/);
});
test('medium controlled job honors source and stage limits before any request',async()=>{
 const e=entry();e.expectedChunks=103;e.doc.chunking_mode='section_context_v1';
 const d=controlledFake();d.post=async doc=>({results:[{source_key:doc.source_key,status:'dry_run',chunks:103,chunker_version:4}],totals:{documents:1,errors:0}});
 const policy={...limits,worker_profile:'medium_v1',document_chunks:800,document_chars:600000};
 const state=await job.runControlledStage([e],d,{},false,policy);assert.equal(state.status,'dry_run_complete');
 for(const bad of [{document_chunks:801},{document_chars:600001},{chunks:1001},{documents:31}]){const deps=controlledFake();await assert.rejects(job.runControlledStage([e],deps,{},false,{...policy,...bad}),/bound/);assert.equal(deps.receipts.length,0);}
});
test('complete chunk reads cross 101 rows, inspect sentinel and reject overflow or repeated pages',async()=>{
 for(const n of [0,103,200,790,800]){
  const rows=Array.from({length:n},(_,chunk_index)=>({chunk_index}));const calls=[];
  const result=await job.readCompleteChunks(async(offset,limit)=>{calls.push([offset,limit]);return rows.slice(offset,offset+limit);},800);
  assert.equal(result.length,n);if(n===800)assert.deepEqual(calls.at(-1),[800,1]);
 }
 await assert.rejects(job.readCompleteChunks(async(offset,limit)=>Array.from({length:Math.min(limit,801-offset)},(_,i)=>({chunk_index:offset+i})),800),/bound/);
 await assert.rejects(job.readCompleteChunks(async()=>Array.from({length:100},(_,chunk_index)=>({chunk_index})),800),/order/);
 await assert.rejects(job.readCompleteChunks(async()=>Array.from({length:101},(_,chunk_index)=>({chunk_index})),800),/page/);
});

test('real medium context handler verifies every page after multiple commits and holds partial commits',async()=>{
 const {handleIngest}=await import('../supabase/functions/ingest-documents/handler.ts');
 for(const partial of [false,true]){
  const e=entry('medium-real');e.doc.chunking_mode='section_context_v1';e.doc.ocr_text=Array.from({length:120},(_,i)=>'# Section '+i+'\n'+('Source evidence for paragraph '+i+'. ').repeat(10)).join('\n\n');e.doc.metadata.text_sha256=sha(e.doc.ocr_text);e.doc.metadata.n_chars=[...e.doc.ocr_text].length;
  const prepared=await job.prepareTextChunks(e.doc.ocr_text,e.doc.chunking_mode);e.expectedChunks=prepared.length;e.expectedSpans=job.expectedChunkSpans(prepared);assert.equal(e.expectedChunks,120);
  let document=null,rows=[],paid=0,commits=0;const pages=[];
  const db={findDocument:async()=>document,upsertDocument:async row=>{document={...row,id:'medium-fixture',indexed_at:null,chunker_version:null};return {id:document.id};},updateDocumentMeta:async(id,fields)=>Object.assign(document,fields),existingHashes:async()=>new Set(rows.map(c=>c.chunk_hash)),chunkCommit:async(id,slice,keep)=>{commits++;if(partial&&commits===2)throw Error('second commit unavailable');rows=rows.filter(c=>keep.includes(c.chunk_hash));rows.push(...slice);return {inserted:slice.length,kept:0,deleted:0};},markIndexed:async(id,v)=>Object.assign(document,{indexed_at:'now',chunker_version:v}),logCall:async()=>{}};
  const deps={...controlledFake(),read:async()=>document?{document,chunks:await job.readCompleteChunks(async(offset,limit)=>{pages.push(offset);return rows.slice(offset,offset+limit);},800)}:null,post:async(doc,dry_run)=>{
   const response=await handleIngest(new Request('http://localhost/medium',{method:'POST',headers:{authorization:'Bearer fixture-key','content-type':'application/json'},body:JSON.stringify({documents:[doc],dry_run})}),{secretKey:'fixture-key',origins:[],db,embed:async inputs=>{paid++;return {vectors:inputs.map(()=>Array(1536).fill(0.1)),model:'fixture',promptTokens:1,costUsd:0.00000002,requests:1};}});
   const result=await response.json();if(!dry_run&&!partial)throw Object.assign(Error('lost successful response'),{transient:true,uncertain:true});return result;
  }};
  const policy={...limits,worker_profile:'medium_v1',document_chunks:800,document_chars:600000};const state={};
  if(partial){await assert.rejects(job.runControlledStage([e],deps,state,true,policy));assert.equal(state.status,'held');assert.equal(state.repair.observed_chunks,100);assert.equal(document.indexed_at,null);await assert.rejects(job.runControlledStage([e],deps,state,true,policy),/held/);}
  else{await job.runControlledStage([e],deps,state,true,policy);assert.equal(state.status,'complete');assert.equal(rows.length,120);assert.ok(pages.includes(100));await job.runControlledStage([e],deps,state,true,policy);}
  assert.equal(paid,1);assert.equal(commits,2);
 }
});

test('alternate version proof rejects incomplete evidence and binds both identities',()=>{
 const e=entry();Object.assign(e.doc,{title:'Example Bill',file_url:'https://sansad.in/getFile/BillsTexts/LSBillTexts/a.pdf'});Object.assign(e.doc.metadata,{document_key:'bill:2024:12',bill_number:'12',bill_year:2024,house:'Lok Sabha',document_role:'as_introduced'});e.pdfHash=sha('source-pdf');
 const identity=role=>({status:'pass',bill_number:'12',bill_year:'2024',version:role,body_samples:40,body_samples_matched:40});
 const p={schema:'nter.bill-version-proof/1',document_key:'bill:2024:12',bill_number:'12',bill_year:2024,house:'Lok Sabha',source:{source_key:e.doc.source_key,file_url:e.doc.file_url,title:e.doc.title,role:'as_introduced',text_sha256:e.doc.metadata.text_sha256,pdf_sha256:e.pdfHash,identity:identity('as_introduced')},download:{source_key:'download-source',file_url:'https://sansad.in/getFile/BillsTexts/LSBillTexts/b.pdf',title:e.doc.title,role:'as_passed_both_houses',text_sha256:sha('download-text'),pdf_sha256:sha('download-pdf'),identity:identity('as_passed_both_houses')}};
 assert.equal(job.validateVersionProof(e,p),p.download.file_url);
 for(const mutate of [p=>p.download.identity.bill_year='2023',p=>p.source.identity.bill_number='99',p=>p.source.identity.bill_year='2023',p=>p.document_key='bill:2024:99',p=>p.download.role='gazette_notification',p=>p.source.pdf_sha256=sha('changed'),p=>p.download.identity.body_samples_matched=1,p=>delete p.download.text_sha256,p=>p.download.title='Different Bill',p=>p.download.file_url=p.source.file_url]){const changed=structuredClone(p);mutate(changed);assert.throws(()=>job.validateVersionProof(e,changed));}
});
test('PDF fetch plan includes both versions and rejects conflicting hashes at one URL',()=>{
 const e=entry();e.doc.file_url='https://sansad.in/getFile/BillsTexts/LSBillTexts/a.pdf';e.pdfHash=sha('a');
 e.versionProof={download:{file_url:'https://sansad.in/getFile/BillsTexts/LSBillTexts/b.pdf',pdf_sha256:sha('b')}};
 assert.equal(job.approvedPdfFetches([e,e]).length,2);
 assert.throws(()=>job.approvedPdfFetches([e,{...e,pdfHash:sha('conflict')}]),/conflicting/);
});

test('manifest loading binds Download PDF/text cache and prevents path escapes',t=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'version-cache-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const e=entry();Object.assign(e.doc,{title:'Example Bill',file_url:'https://sansad.in/getFile/BillsTexts/LSBillTexts/a.pdf'});Object.assign(e.doc.metadata,{document_key:'bill:2024:12',bill_number:'12',bill_year:2024,house:'Lok Sabha',document_role:'as_introduced'});
 for(const [name,text] of [['source.txt',e.doc.ocr_text],['source.pdf','source-pdf'],['download.txt','download-text'],['download.pdf','download-pdf']])fs.writeFileSync(path.join(dir,name),text);
 const identity=role=>({status:'pass',bill_number:'12',bill_year:'2024',version:role,body_samples:40,body_samples_matched:40});
 const proof={schema:'nter.bill-version-proof/1',document_key:'bill:2024:12',bill_number:'12',bill_year:2024,house:'Lok Sabha',source:{source_key:e.doc.source_key,file_url:e.doc.file_url,title:e.doc.title,role:'as_introduced',text_sha256:e.doc.metadata.text_sha256,pdf_sha256:sha('source-pdf'),identity:identity('as_introduced')},download:{source_key:'download',file_url:'https://sansad.in/getFile/BillsTexts/LSBillTexts/b.pdf',title:e.doc.title,role:'as_passed_both_houses',text_sha256:sha('download-text'),original_sha256:sha('download-text'),pdf_sha256:sha('download-pdf'),pdf_file:'download.pdf',text_file:'download.txt',identity:identity('as_passed_both_houses')}};
 const manifest={schema:'nter.text-job/1',project_id:'vfgcppstyzjarlzyqdac',model:'openai/text-embedding-3-small',chunker_version:2,limits,documents:[{status:'pass',identity:proof.source.identity,original_sha256:e.doc.metadata.text_sha256,pdf_sha256:sha('source-pdf'),pdf_file:'source.pdf',text_file:'source.txt',token_ceiling:8,expected_chunks:1,doc:e.doc,version_proof:proof}]};
 const file=path.join(dir,'stage.json');const load=()=>{fs.writeFileSync(file,JSON.stringify(manifest));return job.loadJobManifest(file,sha(fs.readFileSync(file)));};
 assert.equal(load().entries[0].versionProof.download.source_key,'download');
 for(const name of ['download.pdf','download.txt']){const original=fs.readFileSync(path.join(dir,name));fs.writeFileSync(path.join(dir,name),'changed');assert.throws(load,/cached Download/);fs.writeFileSync(path.join(dir,name),original);}
 const raw='download-raw',fixed='download-text';
 fs.writeFileSync(path.join(dir,'download-raw.txt'),raw);
 const review={schema:'nter.source-quality-review/1',status:'pass',source_key:'download',raw_sha256:sha(raw),repaired_sha256:sha(fixed),pdf_sha256:sha('download-pdf'),full_body_order_verified:true,substantive_text_preserved:true};
 fs.writeFileSync(path.join(dir,'download-review.json'),JSON.stringify(review));
 const repair={schema:'nter.source-repair/1',source_key:'download',raw_sha256:sha(raw),repaired_sha256:sha(fixed),pdf_sha256:sha('download-pdf'),review_file:'download-review.json',review_sha256:sha(JSON.stringify(review)),edits:[{from:0,to:raw.length,old_sha256:sha(raw),replacement:fixed}]};
 fs.writeFileSync(path.join(dir,'download-repair.json'),JSON.stringify(repair));
 proof.download.original_sha256=sha(raw);
 proof.download.source_repair={raw_file:'download-raw.txt',proof_file:'download-repair.json',proof_sha256:sha(JSON.stringify(repair))};
 assert.equal(load().entries[0].versionProof.download.original_sha256,sha(raw));
 for(const name of ['download-raw.txt','download-review.json','download-repair.json']){
  const original=fs.readFileSync(path.join(dir,name));fs.appendFileSync(path.join(dir,name),'changed');assert.throws(load);fs.writeFileSync(path.join(dir,name),original);
 }
 proof.download.pdf_file='../escape.pdf';assert.throws(load,/escapes/);
});

test('current listing proof requires both matching bill features', () => {
  const rows = ['Bill Passage Probability Index', 'Policy Intelligence Graph'].map(feature => ({
    feature, row: { title: 'Test Bill', house: 'Lok Sabha' },
  }));
  assert.deepEqual(validateListingRows(entry(), rows), rows);
  for (const missing of [rows.slice(0, 1), rows.slice(1), [{ ...rows[0], feature: 'Other' }]]) {
    assert.throws(() => validateListingRows(entry(), missing), /both bill listing features/);
  }
});
