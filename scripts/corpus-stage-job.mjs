// Bounded, opt-in existing-text ingestion. Receipts and secrets stay outside Git.
import fs from 'node:fs';
import {verifySourceRepair,verifyDownloadRepair} from './corpus-source-repair.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {analysisFor,buildBillModel,bindBillAnalysisIdentities} from '../src/lib/impactRecord.js';
import {atomicSave,acquireLock} from './corpus-job-supervisor.mjs';
import {parseCapacityMetrics,capacityPressure,validMaintenanceAck} from './corpus-capacity.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function uniqueChunks(rows){const seen=new Set();return rows.filter(r=>seen.has(r.chunkHash)?false:(seen.add(r.chunkHash),true));}
export function validatePdfUrl(value){const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='sansad.in'||u.port||u.username||u.password||!u.pathname.startsWith('/getFile/BillsTexts/')||!u.pathname.toLowerCase().endsWith('.pdf'))throw Error('unapproved PDF URL');return u;}
export function validateVersionProof(entry,p){
  const d=entry.doc,m=d.metadata,roles=new Set(['as_introduced','as_passed_lok_sabha','as_passed_rajya_sabha','as_passed_both_houses']);
  const same=(a,b)=>String(a)===String(b),digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
  const norm=s=>String(s??'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
  if(p?.schema!=='nter.bill-version-proof/1'||p.document_key!==m.document_key||p.document_key==='bill:2022:290'||p.document_key!==`bill:${p.bill_year}:${p.bill_number}`||!same(p.bill_number,m.bill_number)||!same(p.bill_year,m.bill_year)||p.house!==m.house||!['Lok Sabha','Rajya Sabha'].includes(p.house))throw Error('version proof bill identity mismatch');
  for(const part of [p.source,p.download]){
    validatePdfUrl(part?.file_url);
    const i=part.identity;
    if(!part.source_key||norm(part.title)!==norm(d.title)||!roles.has(part.role)||!digest(part.text_sha256)||!digest(part.pdf_sha256)||i?.status!=='pass'||norm(i.bill_number)!==norm(p.bill_number)||!same(i.bill_year,p.bill_year)||i.version!==part.role||!Number.isSafeInteger(i.body_samples)||i.body_samples<1||!Number.isSafeInteger(i.body_samples_matched)||i.body_samples_matched>i.body_samples||i.body_samples_matched/i.body_samples<0.9)throw Error('version proof missing or inconsistent PDF evidence');
  }
  if(p.source.source_key!==d.source_key||p.source.file_url!==d.file_url||p.source.text_sha256!==m.text_sha256||p.source.pdf_sha256!==entry.pdfHash||p.source.role!==m.document_role||p.source.role===p.download.role||p.source.file_url===p.download.file_url||p.source.source_key===p.download.source_key)throw Error('version proof source binding mismatch');
  return p.download.file_url;
}
export function approvedPdfFetches(entries){
  const urls=new Map();
  for(const e of entries)for(const [url,digest] of [[e.doc.file_url,e.pdfHash],...(e.versionProof?[[e.versionProof.download.file_url,e.versionProof.download.pdf_sha256]]:[])]){
    validatePdfUrl(url);const canonical=new URL(url).href;
    if(urls.has(canonical)&&urls.get(canonical).digest!==digest)throw Error('conflicting expected PDF hashes');
    urls.set(canonical,{url,digest});
  }
  return [...urls.values()];
}
function workerBounds(profile){
  if(profile===undefined)return {document_chunks:100,document_chars:75000};
  if(profile==='medium_v1')return {document_chunks:800,document_chars:600000};
  throw Error('unsupported worker profile');
}
export async function readCompleteChunks(readPage,maxChunks=100){
  if(!Number.isSafeInteger(maxChunks)||maxChunks<1||maxChunks>800)throw Error('chunk read bound exceeded');
  const rows=[];
  while(rows.length<=maxChunks){
    const limit=Math.min(100,maxChunks+1-rows.length),page=await readPage(rows.length,limit);
    if(!Array.isArray(page)||page.length>limit)throw Error('invalid chunk page');
    for(const row of page){
      if(!Number.isSafeInteger(row.chunk_index)||row.chunk_index<0||(rows.length&&row.chunk_index<=rows.at(-1).chunk_index))throw Error('chunk page order changed');
      rows.push(row);
    }
    if(rows.length>maxChunks)throw Error('stored chunk bound exceeded');
    if(page.length<limit)return rows;
  }
  throw Error('stored chunk bound exceeded');
}
export function validateEntries(entries,profile) {
  const bounds=workerBounds(profile);
  const seen=new Set();
  for(const {doc,expectedChunks} of entries){
    if(seen.has(doc.source_key))throw Error('duplicate source ID');seen.add(doc.source_key);
    if(doc.chunking_mode!==undefined&&doc.chunking_mode!=='section_context_v1')throw Error('unsupported chunking mode');
    if(hash(doc.ocr_text)!==doc.metadata.text_sha256)throw Error('source hash mismatch');
    if([...doc.ocr_text].length!==doc.metadata.n_chars)throw Error('source length mismatch');
    if(!doc.metadata.document_key?.startsWith('bill:')||!doc.file_url||!doc.title)throw Error('missing bill identity');
    if(profile==='medium_v1'&&doc.chunking_mode!=='section_context_v1')throw Error('medium profile requires context mode');
    if(!Number.isInteger(expectedChunks)||expectedChunks<1||expectedChunks>bounds.document_chunks)throw Error('chunk bound exceeded');
  }
}
export function validateListingRows(entry,rows) {
  const norm=s=>String(s||'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
  const identities=new Set(rows.map(x=>norm(x.row.bill_name||x.row.title)+'|'+norm(x.row.house)));
  if(identities.size!==1)throw Error('bill key collision: '+entry.doc.metadata.document_key);
  if (!['Bill Passage Probability Index', 'Policy Intelligence Graph'].every(feature => rows.some(row => row.feature === feature))) {
    throw Error('both bill listing features are required');
  }
  return rows;
}
function sameSection(a,b){return Boolean(a&&b&&a.heading===b.heading&&a.note===b.note&&Object.keys(a).every(k=>k==='heading'||k==='note'));}
export function verifyStored(entry,current) {
  const {doc,expectedChunks}=entry;const d=current.document;
  if(!d.indexed_at)throw Error('document is not indexed; investigate before retry');
  if(d.content_sha256!==doc.metadata.text_sha256||hash(d.ocr_text)!==doc.metadata.text_sha256)throw Error('stored hash mismatch');
  if(d.metadata.document_key!==doc.metadata.document_key||d.file_url!==doc.file_url)throw Error('stored identity mismatch');
  if(current.chunks.length!==expectedChunks||new Set(current.chunks.map(c=>c.chunk_hash)).size!==expectedChunks)throw Error('stored chunk count mismatch');
  if(doc.chunking_mode==='section_context_v1'&&!entry.expectedSpans)throw Error('missing expected embedding context');
  if(entry.expectedSpans){
    const expected=new Map(entry.expectedSpans.map(x=>[x.chunk_hash,x]));
    for(const c of current.chunks){const e=expected.get(c.chunk_hash);if(!e||c.chunk_index!==e.chunk_index||c.char_from!==e.char_from||c.char_to!==e.char_to)throw Error('stored chunk identity mismatch');
      if(doc.chunking_mode==='section_context_v1'&&(d.chunker_version!==4||c.chunker_version!==4||!e.embed_hash||c.embed_hash!==e.embed_hash||!sameSection(c.metadata?.section,e.section)))throw Error('stored embedding context mismatch');
    }
  }
  for(const c of current.chunks){
    const vector=typeof c.embedding==='string'?JSON.parse(c.embedding):c.embedding;
    if(!Array.isArray(vector)||vector.length!==1536||vector.some(x=>!Number.isFinite(x))||!vector.some(x=>x!==0))throw Error('missing or invalid embedding');
    if(c.source_kind!=='document'||c.page_number!=null||!Number.isInteger(c.char_from)||!Number.isInteger(c.char_to)||c.char_from<0||c.char_to<c.char_from||c.char_to>d.ocr_text.length||!c.content||c.content!==d.ocr_text.slice(c.char_from,c.char_to))throw Error('stored citation span mismatch');
  }
  return {document_id:d.id,chunks:current.chunks.length};
}
function checkResult(result,entry,status){
  const r=result.results?.[0];
  if(entry.doc.chunking_mode==='section_context_v1'&&r?.chunker_version!==4)throw Error('endpoint did not confirm section context mode');
  if(result.results?.length!==1||result.totals?.documents!==1||result.totals?.errors!==0||r?.source_key!==entry.doc.source_key||r.status!==status||r.chunks!==entry.expectedChunks)throw Error('unexpected ingestion result: '+JSON.stringify(result));
  return r;
}
export async function runStage(entries,deps,state={},execute=false){
  validateEntries(entries);state.entries??={};
  // Check every source before the first write, including interrupted receipts.
  for(const e of entries){const current=await deps.read(e.doc.source_key);if(current){if(!state.entries[e.doc.source_key])throw Error('unexpected existing source');verifyStored(e,current);}}
  for(const e of entries){
    const key=e.doc.source_key;const current=await deps.read(key);
    if(current){const verified=verifyStored(e,current);state.entries[key]={...state.entries[key],phase:'verified',...verified};await deps.save(state);continue;}
    if(state.entries[key]&&state.entries[key].phase!=='dry_run')throw Error('checkpoint source missing; investigate before retry');
    const dry=checkResult(await deps.post(e.doc,true),e,'dry_run');
    if(!execute){state.entries[key]={phase:'dry_run',dry_run:dry};await deps.save(state);continue;}
    state.entries[key]={phase:'in_flight',dry_run:dry,started_at:new Date().toISOString()};await deps.save(state);
    const result=checkResult(await deps.post(e.doc,false),e,'indexed');state.entries[key].result=result;await deps.save(state);
    const stored=await deps.read(key);if(!stored)throw Error('indexed document not found');
    Object.assign(state.entries[key],verifyStored(e,stored),{phase:'verified',verified_at:new Date().toISOString()});await deps.save(state);
  }
  return state;
}
export function validateStageLimits(entries,limits){
  validateEntries(entries,limits?.worker_profile);
  const large=limits?.stage_profile==='sequential_500_v1';
  if(limits?.stage_profile!==undefined&&!large)throw Error('unsupported stage profile');
  const stageBounds=large?{documents:500,chunks:20000}:{documents:30,chunks:1000};
  for(const [name,max] of Object.entries({...stageBounds,...workerBounds(limits?.worker_profile)}))if(!Number.isSafeInteger(limits?.[name])||limits[name]<1||limits[name]>max)throw Error('stage bound exceeded: '+name);
  if(!limits||!entries.length||entries.length>limits.documents||entries.reduce((s,e)=>s+e.expectedChunks,0)>limits.chunks||!Number.isFinite(limits.gap_ms)||limits.gap_ms<2000||!Number.isInteger(limits.max_attempts)||limits.max_attempts<1||limits.max_attempts>5)throw Error('stage bound exceeded');
  for(const e of entries)if(e.expectedChunks>limits.document_chunks||[...e.doc.ocr_text].length>limits.document_chars)throw Error('document bound exceeded');
  if(large&&entries.reduce((n,e)=>n+[...e.doc.ocr_text].length,0)>10000000)throw Error('aggregate text bound exceeded');
  return large;
}
export async function runControlledStage(entries,deps,state={},execute=false,limits){
  const large=validateStageLimits(entries,limits);
  if(large&&typeof deps.metrics!=='function')throw Error('large stage requires metrics checks');
  state.entries??={};state.spent_ceiling_usd??=0;
  const now=()=>deps.now?.()??Date.now();
  const save=()=>deps.save(state);
  const hold=async(error,e,current)=>{state.status='held';state.last_error=error.message;if(e)state.repair={source_key:e.doc.source_key,document_id:current?.document.id??null,expected_chunks:e.expectedChunks,observed_chunks:current?.chunks.length??null,reason:error.message};await save();throw error;};
  const retryRead=async error=>{state.read_attempts=(state.read_attempts||0)+1;if(state.read_attempts>=limits.max_attempts)return hold(Error('read retry attempts exhausted'));state.status='retry_wait';state.wake_at=now()+Math.max(error.retryAfterMs||0,Math.min(120000,5000*2**(state.read_attempts-1)));state.last_error=error.message;await save();throw Object.assign(Error('retry scheduled: '+error.message),{retry:true});};
  if(state.status==='held'||state.status==='health_paused')throw Error('job '+state.status+'; explicit review required');
  if(state.status==='maintenance_paused'){
    if(!large||!state.maintenance||!await deps.acknowledgeMaintenance?.(state.maintenance))throw Error('maintenance acknowledgement required');
    state.maintenance_ack={...state.maintenance};delete state.maintenance;
  }
  if(state.status==='retry_wait'&&state.wake_at>now())throw Object.assign(Error('retry wake time pending'),{retry:true});
  state.status='running';await save();
  // Validate the whole stage before any paid request, including completed entries.
  for(const e of entries){let current;try{await deps.validate(e);current=await deps.read(e.doc.source_key);if(current){if(!state.entries[e.doc.source_key])throw Error('unexpected existing source');verifyStored(e,current);}}catch(error){if(error.transient)return retryRead(error);return hold(error,e,current);}}
  state.read_attempts=0;
  const health=async()=>{try{if(large)await deps.metrics();await deps.health();}catch(error){state.status='health_paused';state.last_error=error.message;await save();throw error;}};
  await health();
  for(const e of entries){
    if(large&&execute){
      const verified=Object.values(state.entries).filter(x=>x.phase==='verified');const progress={verified_documents:verified.length,verified_chunks:verified.reduce((n,x)=>n+x.chunks,0)};
      if(progress.verified_documents<entries.length&&(progress.verified_documents-(state.maintenance_ack?.verified_documents??0)>=20||progress.verified_chunks-(state.maintenance_ack?.verified_chunks??0)>=2000)){
        state.maintenance=progress;state.status='maintenance_paused';await save();return state;
      }
    }
    const key=e.doc.source_key;let current;try{current=await deps.read(key);}catch(error){if(error.transient)return retryRead(error);return hold(error,e,current);}let receipt=state.entries[key];
    if(current){try{const verified=verifyStored(e,current);state.entries[key]={...receipt,...verified,phase:'verified'};await save();continue;}catch(error){return hold(error,e,current);}}
    if(receipt?.phase==='verified')return hold(Error('verified checkpoint source missing'),e,current);
    if(receipt?.phase==='in_flight'&&receipt.settle_at>now()){state.status='retry_wait';state.wake_at=receipt.settle_at;await save();throw Object.assign(Error('retry after uncertain invocation settles'),{retry:true});}
    if((receipt?.attempts??0)>=limits.max_attempts||(receipt?.dry_attempts??0)>=limits.max_attempts)return hold(Error('retry attempts exhausted'),e,current);
    try{await deps.validate(e);receipt=state.entries[key]={...receipt,phase:receipt?.phase||'dry_run',dry_attempts:(receipt?.dry_attempts??0)+1};await save();const dry=checkResult(await deps.post(e.doc,true),e,'dry_run');
      if(!execute){state.entries[key]={...receipt,phase:'dry_run',dry_run:dry};await save();continue;}
      await health();await deps.validate(e);
      const reserve=deps.reserve(e);if(!Number.isFinite(reserve)||reserve<0||!Number.isFinite(limits.budget_usd)||state.spent_ceiling_usd+reserve>limits.budget_usd)return hold(Error('embedding budget exceeded'),e,current);
      if(state.last_write_at)await deps.sleep(Math.max(0,limits.gap_ms-(now()-state.last_write_at)));
      receipt=state.entries[key]={...receipt,phase:'in_flight',attempts:(receipt?.attempts??0)+1,dry_run:dry,started_at:now(),settle_at:now()+450000,reserved_usd:reserve};
      // Reserve the worst-case attempt cost before sending. Missing usage stays reserved.
      state.spent_ceiling_usd+=reserve;state.last_write_at=now();await save();
      const result=checkResult(await deps.post(e.doc,false),e,'indexed');receipt.result=result;await save();
      current=await deps.read(key);if(!current)throw Error('indexed document not found');await deps.validate(e);Object.assign(receipt,verifyStored(e,current),{phase:'verified',verified_at:now()});await save();
    }catch(error){
      // A timeout is not evidence that the write failed. Read before retrying.
      try{current=await deps.read(key);}catch{current=null;}
      if(state.status==='health_paused')throw error;
      if(current?.document.indexed_at&&error.transient&&state.entries[key]?.phase==='in_flight'){try{await deps.validate(e);Object.assign(state.entries[key],verifyStored(e,current),{phase:'verified',verified_at:now(),usage_unknown:!state.entries[key]?.result});await save();continue;}catch(conflict){return hold(conflict,e,current);}}
      if(current?.document.indexed_at)return hold(error,e,current);
      if(current)return hold(Error('document is not indexed; partial write requires investigation'),e,current);
      if(!error.transient)return hold(error,e,current);
      receipt=state.entries[key]??={phase:'dry_run',attempts:0};
      if(receipt.attempts>=limits.max_attempts)return hold(Error('retry attempts exhausted'),e,current);
      const delay=Math.max(error.retryAfterMs||0,Math.min(120000,5000*2**Math.max(0,receipt.attempts-1)));
      state.status='retry_wait';state.wake_at=now()+delay;
      if(receipt.phase==='in_flight'&&error.uncertain)state.wake_at=Math.max(state.wake_at,receipt.settle_at);
      // Rejected requests still count against attempts and the conservative cost budget.
      if(receipt.phase==='in_flight'&&!error.uncertain){receipt.phase='retryable';receipt.settle_at=0;}
      state.last_error=error.message;await save();throw Object.assign(Error('retry scheduled: '+error.message),{retry:true});
    }
  }
  await health();state.status=execute?'complete':'dry_run_complete';await save();return state;
}
function envFromFile(file){const env={...process.env};for(const line of fs.readFileSync(file,'utf8').split('\n')){const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);if(m&&!env[m[1]])env[m[1]]=m[2].replace(/^"(.*)"$/,'$1').replace(/^'(.*)'$/,'$1');}return env;}
export async function prepareTextChunks(text,mode){
  const rows=mode==='section_context_v1'?(await import('../supabase/functions/_shared/textContext.ts')).chunkTextWithContext(text):(await import('../supabase/functions/_shared/chunking.ts')).chunkDocument(text);
  return uniqueChunks(await rows);
}
export function expectedChunkSpans(chunks){
  return chunks.map(x=>({chunk_hash:x.chunkHash,chunk_index:x.chunkIndex,char_from:x.charFrom,char_to:x.charTo,...('embed_hash' in x?{embed_hash:x.embed_hash,section:x.section}:{})}));
}
export async function verifyPreparedEntry(entry,version){
  const mode=entry.doc.chunking_mode;
  const currentVersion=mode==='section_context_v1'?(await import('../supabase/functions/_shared/textContext.ts')).TEXT_CONTEXT_VERSION:(await import('../supabase/functions/_shared/chunking.ts')).CHUNK.version;
  if(version!==currentVersion)throw Error('current chunker changed');
  const chunks=await prepareTextChunks(entry.doc.ocr_text,mode);
  if(chunks.length!==entry.expectedChunks||JSON.stringify(expectedChunkSpans(chunks))!==JSON.stringify(entry.expectedSpans)||chunks.reduce((s,x)=>s+Buffer.byteLength(x.embedding_input??x.content,'utf8'),0)!==entry.tokenCeiling)throw Error('current chunk identity/token bound changed');
  return chunks;
}
export function loadJobManifest(file,approvedSha){
  const bytes=fs.readFileSync(file);if(hash(bytes)!==approvedSha)throw Error('approved manifest changed');
  const manifest=JSON.parse(bytes);
  if(manifest.schema!=='nter.text-job/1'||manifest.project_id!=='vfgcppstyzjarlzyqdac'||manifest.model!=='openai/text-embedding-3-small'||![2,4].includes(manifest.chunker_version))throw Error('unsupported target/model/chunker');
  const root=path.dirname(path.resolve(file));
  const safeFile=name=>{const resolved=path.resolve(root,name);if(!resolved.startsWith(root+path.sep)||fs.realpathSync(resolved)!==resolved)throw Error('source path escapes manifest directory');return resolved;};
  const entries=manifest.documents.map(r=>{
    if(r.status!=='pass'||r.identity.status!=='pass'||!Number.isSafeInteger(r.token_ceiling)||r.token_ceiling<=0)throw Error('missing original/PDF/token preflight');
    verifySourceRepair(r,safeFile);
    if(hash(fs.readFileSync(safeFile(r.pdf_file)))!==r.pdf_sha256)throw Error('cached PDF changed');
    if((manifest.chunker_version===4)!==(r.doc.chunking_mode==='section_context_v1')||(r.chunker_version!==undefined&&r.chunker_version!==manifest.chunker_version))throw Error('manifest chunking mode mismatch');
    const doc={...r.doc,ocr_text:fs.readFileSync(safeFile(r.text_file),'utf8')};
    const entry={doc,expectedChunks:r.expected_chunks,expectedSpans:r.expected_spans,pdfHash:r.pdf_sha256,tokenCeiling:r.token_ceiling};
    if(r.version_proof){
      validateVersionProof(entry,r.version_proof);const p=r.version_proof.download;
      if(hash(fs.readFileSync(safeFile(p.pdf_file)))!==p.pdf_sha256||hash(fs.readFileSync(safeFile(p.text_file)))!==p.text_sha256)throw Error('cached Download proof changed');
      verifyDownloadRepair(p,safeFile);
      entry.versionProof=r.version_proof;
    }
    return entry;
  });
  if(manifest.worker_profile==='medium_v1'&&manifest.chunker_version!==4)throw Error('medium profile requires context version');
  validateStageLimits(entries,{...manifest.limits,worker_profile:manifest.worker_profile,stage_profile:manifest.stage_profile});approvedPdfFetches(entries);return {manifest,entries};
}
async function modernMain(mode,file,approvedSha){
  const {manifest,entries}=loadJobManifest(file,approvedSha);
  const execute=mode==='--execute';
  if(execute&&(!manifest.execution_authorized||manifest.operation_mode!=='supervised'||!manifest.release_note))throw Error('exact stage execution release missing');
  const env=envFromFile(path.resolve('.env.local')),url=env.SUPABASE_URL||env.VITE_SUPABASE_URL,key=env.SUPABASE_SECRET_KEY;
  if(new URL(url).hostname!==manifest.project_id+'.supabase.co'||!key?.startsWith('sb_secret_'))throw Error('wrong target or credential');
  const redact=s=>s.replaceAll(key,'[REDACTED]').replaceAll(env.OPENROUTER_API_KEY||'__absent_key__','[REDACTED]');
  async function request(route,options={},paid=false){
    let response;
    try{response=await fetch(url+route,{...options,headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},signal:AbortSignal.timeout(90000)});}catch{throw Object.assign(Error('network request interrupted'),{transient:true,uncertain:paid});}
    let body;try{body=await response.text();}catch{throw Object.assign(Error('response interrupted'),{transient:true,uncertain:paid});}
    if(!response.ok){const transient=[429,502,503,504].includes(response.status)&&!body.includes('WORKER_RESOURCE_LIMIT');const retry=response.headers.get('retry-after');const retryAfterMs=retry?(Number.isFinite(Number(retry))?Number(retry)*1000:Math.max(0,Date.parse(retry)-Date.now())):0;
      throw Object.assign(Error('HTTP '+response.status+': '+redact(body.slice(0,400))),{transient,uncertain:paid&&response.status!==429,retryAfterMs});}
    return JSON.parse(body);
  }
  const checkpoint=file+'.checkpoint.json';const release=acquireLock(path.join(path.dirname(file),'worker.lock'));
  let state;
  try{
    state=fs.existsSync(checkpoint)?JSON.parse(fs.readFileSync(checkpoint)):{manifest_sha256:approvedSha,entries:{}};
    if(state.manifest_sha256!==approvedSha)throw Error('checkpoint belongs to another manifest');
    const map=bindBillAnalysisIdentities(JSON.parse(fs.readFileSync('public/data/embedded_json/national_bill_analysis.json')),JSON.parse(fs.readFileSync('public/data/embedded_json/national_bill_analysis_identity.json')).records,JSON.parse(fs.readFileSync('public/data/embedded_json/national_bill_analysis_identity.json')).sources||[]);
    for(const e of entries)await verifyPreparedEntry(e,manifest.chunker_version);
    const validate=async e=>{
      const rowKey=e.doc.metadata.document_key;const rows=await request('/rest/v1/desk_rows?select=row,feature&document_key=eq.'+encodeURIComponent(rowKey)+'&feature=in.'+encodeURIComponent('("Bill Passage Probability Index","Policy Intelligence Graph")')+'&limit=1001');if(rows.length>1000)throw Error('listing read truncated');validateListingRows(e,rows);
      const norm=s=>String(s||'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
      const matched=rows.filter(x=>norm(x.row.bill_name||x.row.title)===norm(e.doc.title)&&String(x.row.bill_number).trim()===String(e.doc.metadata.bill_number).trim()&&norm(x.row.house)===norm(e.doc.metadata.house));
      validateListingRows(e,matched);
      const expectedUrl=e.versionProof?validateVersionProof(e,e.versionProof):e.doc.file_url;
      if(!matched.length||matched.some(x=>buildBillModel(x.row,analysisFor(x.row,map),null).pdf!==expectedUrl))throw Error('current listing/PDF mismatch');
    };
    // Re-fetch each approved PDF once per invocation; never trust a URL alone.
    for(const {url:pdfUrl,digest} of approvedPdfFetches(entries)){const response=await fetch(pdfUrl,{signal:AbortSignal.timeout(45000),redirect:'error'});if(!response.ok||new URL(response.url).hostname!=='sansad.in')throw Error('PDF source unavailable/redirected');const length=Number(response.headers.get('content-length'));if(length>20000000)throw Error('PDF size bound exceeded');const reader=response.body.getReader();const pieces=[];let bytes=0;while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>20000000){await reader.cancel();throw Error('PDF size bound exceeded');}pieces.push(value);}if(hash(Buffer.concat(pieces))!==digest)throw Error('live PDF changed since preflight');}
    const healthFile=file+'.health.json';let baseline=fs.existsSync(healthFile)?JSON.parse(fs.readFileSync(healthFile)):null;
    const seedIds=mode==='--baseline'?(await request('/rest/v1/documents?select=id&indexed_at=not.is.null&metadata->>document_key=like.bill:*&order=id&limit=5')).map(x=>x.id):baseline?.probe_document_ids;
    if(seedIds?.length!==5)throw Error('five health probe documents required');
    const probes=[];for(const id of seedIds){const vector=await request('/rest/v1/document_chunks?select=embedding&document_id=eq.'+id+'&order=chunk_index&limit=1');if(!vector.length)throw Error('health probe embedding unavailable');probes.push({id,embedding:typeof vector[0].embedding==='string'?JSON.parse(vector[0].embedding):vector[0].embedding});}
    const p95=values=>values.sort((a,b)=>a-b)[Math.ceil(values.length*0.95)-1];
    async function measure(n){const broad=[],scoped=[];for(let i=0;i<n;i++){const probe=probes[i%probes.length];for(const scope of [null,[probe.id]]){const started=performance.now();const results=await request('/rest/v1/rpc/match_documents',{method:'POST',body:JSON.stringify({query_embedding:probe.embedding,match_count:40,p_document_ids:scope})});if(!results.length||scope&&!results.some(x=>x.document_id===probe.id))throw Error('retrieval health probe failed');(scope?scoped:broad).push(performance.now()-started);}}return {broad_p95_ms:p95(broad),scoped_p95_ms:p95(scoped),samples_per_scope:n};}
    if(mode==='--baseline'){baseline={manifest_sha256:approvedSha,captured_at:Date.now(),probe_document_ids:seedIds,match_count:40,...await measure(20)};atomicSave(healthFile,baseline);console.log('Idle retrieval baseline recorded: '+JSON.stringify(baseline));return;}
    if(!baseline||baseline.manifest_sha256!==approvedSha||Date.now()-baseline.captured_at>12*3600000)throw Error('fresh manifest-bound health baseline required');
    let badWindows=0;
    let metricsPrevious=null,metricsCheckedAt=0;
    const readMetrics=async()=>{
      const response=await fetch(url+'/customer/v1/privileged/metrics',{headers:{authorization:'Basic '+Buffer.from('service_role:'+key).toString('base64')},signal:AbortSignal.timeout(45000)});
      if(!response.ok)throw Error('capacity metrics HTTP '+response.status);
      return parseCapacityMetrics(await response.text(),manifest.project_id);
    };
    const metrics=async()=>{
      if(Date.now()-metricsCheckedAt<60000)return;
      let current=await readMetrics();
      if(!metricsPrevious||current.time-metricsPrevious.time>180){
        metricsPrevious=current;
        if(current.memory_available/current.memory_total<0.15)throw Error('capacity memory pressure');
        await new Promise(r=>setTimeout(r,60000));current=await readMetrics();
      }
      const sample=capacityPressure(metricsPrevious,current);metricsPrevious=current;metricsCheckedAt=Date.now();
      state.capacity_samples??=[];state.capacity_samples.push({captured_at:metricsCheckedAt,...sample});
      if(sample.bad)throw Error('capacity pressure exceeds pilot thresholds');
    };
    const health=async()=>{const sample=await measure(3);const bad=sample.broad_p95_ms>baseline.broad_p95_ms*2||sample.scoped_p95_ms>baseline.scoped_p95_ms*2;badWindows=bad?badWindows+1:0;state.health_samples??=[];state.health_samples.push({captured_at:Date.now(),...sample,bad});if(badWindows>=2)throw Error('retrieval p95 exceeded twice idle baseline in two windows');};
    if(execute){const response=await fetch('https://openrouter.ai/api/v1/embeddings/models',{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('embedding price unavailable');const models=await response.json();const price=Number(models.data.find(x=>x.id===manifest.model)?.pricing?.prompt);if(!Number.isFinite(price)||price!==manifest.embedding_price_per_token)throw Error('embedding model price changed/missing');}
    const deps={validate,health,metrics,acknowledgeMaintenance:async pending=>{const ackFile=file+'.maintenance-ack.json';return fs.existsSync(ackFile)&&validMaintenanceAck(JSON.parse(fs.readFileSync(ackFile)),pending,approvedSha);},read:async source=>{const docs=await request('/rest/v1/documents?select=id,ocr_text,content_sha256,indexed_at,file_url,metadata,chunker_version,extract_hash,storage_path&source_key=eq.'+encodeURIComponent(source));if(docs.length>1)throw Error('duplicate live source');if(!docs.length)return null;if(docs[0].extract_hash||docs[0].storage_path)throw Error('page-pipeline source requires separate recovery');return {document:docs[0],chunks:await readCompleteChunks((offset,limit)=>request('/rest/v1/document_chunks?select=chunk_hash,chunk_index,content,char_from,char_to,source_kind,page_number,embedding,chunker_version,embed_hash,metadata&document_id=eq.'+docs[0].id+'&order=chunk_index&offset='+offset+'&limit='+limit),workerBounds(manifest.worker_profile).document_chunks)};},
      post:(doc,dry_run)=>request('/functions/v1/ingest-documents',{method:'POST',body:JSON.stringify({documents:[doc],dry_run})},!dry_run),reserve:e=>e.tokenCeiling*manifest.embedding_price_per_token,sleep:ms=>new Promise(r=>setTimeout(r,ms)),save:async s=>{atomicSave(checkpoint,JSON.parse(redact(JSON.stringify(s))));console.log(s.status+' '+Object.values(s.entries).filter(x=>x.phase==='verified').length+'/'+entries.length);}};
    await runControlledStage(entries,deps,state,execute,{...manifest.limits,worker_profile:manifest.worker_profile,stage_profile:manifest.stage_profile});
  }catch(error){
    if(error.transient&&!error.retry&&mode!=='--baseline'&&state?.manifest_sha256===approvedSha&&!['held','health_paused'].includes(state.status)){
      state.read_attempts=(state.read_attempts||0)+1;
      state.last_error=redact(error.message);
      if(state.read_attempts<manifest.limits.max_attempts){state.status='retry_wait';state.wake_at=Date.now()+Math.max(error.retryAfterMs||0,Math.min(120000,5000*2**(state.read_attempts-1)));error.retry=true;}else state.status='held';
      atomicSave(checkpoint,JSON.parse(redact(JSON.stringify(state))));
    }
    if(!error.retry&&mode!=='--baseline'&&state?.manifest_sha256===approvedSha){if(state.status!=='health_paused')state.status='held';state.last_error=redact(error.message);atomicSave(checkpoint,JSON.parse(redact(JSON.stringify(state))));}
    if(error.retry){process.exitCode=75;console.error(redact(error.message));return;}throw Error(redact(error.message));
  }finally{release();}
}
async function main(){
  const [mode,dir,approvedSha]=process.argv.slice(2);if(!['--baseline','--dry-run','--execute'].includes(mode)||!dir||!approvedSha)throw Error('usage: corpus-stage-job.mjs --baseline|--dry-run|--execute <stage-manifest-file|legacy-directory> <approved-manifest-sha256>');
  if(fs.statSync(dir).isFile())return modernMain(mode,path.resolve(dir),approvedSha);
  if(mode==='--baseline')throw Error('legacy stages do not use baseline mode');
  const manifestBytes=fs.readFileSync(path.join(dir,'proposed-first-stage-manifest.json'));
  if(hash(manifestBytes)!==approvedSha)throw Error('approved manifest changed');
  const checks=JSON.parse(fs.readFileSync(path.join(dir,'checksums.json')));for(const [name,sha] of Object.entries(checks))if(hash(fs.readFileSync(path.join(dir,name)))!==sha)throw Error('frozen evidence changed: '+name);
  const inventory=JSON.parse(fs.readFileSync(path.join(dir,'proposed-first-stage.json')));const pdfChecks=JSON.parse(fs.readFileSync(path.join(dir,'initial-pdf-preflight.json')));
  const entries=JSON.parse(manifestBytes).documents.map(({ocr_file,...doc})=>({doc:{...doc,ocr_text:fs.readFileSync(path.join(dir,ocr_file),'utf8')},expectedChunks:inventory.find(x=>x.source_key===doc.source_key)?.chunks}));
  validateEntries(entries);if(entries.length!==23||entries.reduce((s,e)=>s+e.expectedChunks,0)!==518)throw Error('approved stage cardinality changed');
  const env=envFromFile(path.resolve('.env.local'));const url=env.SUPABASE_URL||env.VITE_SUPABASE_URL;const key=env.SUPABASE_SECRET_KEY;
  if(new URL(url).hostname!=='vfgcppstyzjarlzyqdac.supabase.co'||!key?.startsWith('sb_secret_'))throw Error('wrong target or credential');
  const redact=s=>s.replaceAll(key,'[REDACTED]').replaceAll(env.OPENROUTER_API_KEY||'__absent_key__','[REDACTED]');
  async function request(route,options={}){const r=await fetch(url+route,{...options,headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},signal:AbortSignal.timeout(90000)});const body=await r.text();if(!r.ok)throw Error('HTTP '+r.status+': '+redact(body.slice(0,500)));return JSON.parse(body);}
  const checkpoint=path.join(dir,'stage-checkpoint.json');const lock=checkpoint+'.lock';let lockFd;
  try{lockFd=fs.openSync(lock,'wx');fs.writeFileSync(lockFd,String(process.pid));}catch{throw Error('stage lock exists; check previous process before resuming');}
  try{
    const state=fs.existsSync(checkpoint)?JSON.parse(fs.readFileSync(checkpoint)): {manifest_sha256:approvedSha,entries:{}};
    if(state.manifest_sha256!==approvedSha)throw Error('checkpoint belongs to another manifest');
    const map=bindBillAnalysisIdentities(JSON.parse(fs.readFileSync('public/data/embedded_json/national_bill_analysis.json')),JSON.parse(fs.readFileSync('public/data/embedded_json/national_bill_analysis_identity.json')).records,JSON.parse(fs.readFileSync('public/data/embedded_json/national_bill_analysis_identity.json')).sources||[]);
    for(const e of entries){
      const rowKey=e.doc.metadata.document_key;const rows=await request('/rest/v1/desk_rows?select=row&feature=eq.'+encodeURIComponent('Bill Passage Probability Index')+'&document_key=eq.'+encodeURIComponent(rowKey));
      validateListingRows(e,rows);
      const norm=s=>String(s||'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
      const row=rows.find(x=>norm(x.row.bill_name||x.row.title)===norm(e.doc.title)&&String(x.row.bill_number).trim()===String(e.doc.metadata.bill_number).trim()&&norm(x.row.house)===norm(e.doc.metadata.house))?.row;
      if(!row||buildBillModel(row,analysisFor(row,map),null).pdf!==e.doc.file_url||!pdfChecks.some(x=>x.source_key===e.doc.source_key&&x.status==='pass_pdf_identity_preflight'))throw Error('current listing/PDF preflight mismatch: '+rowKey);
    }
    const deps={
      read:async source=>{const docs=await request('/rest/v1/documents?select=id,ocr_text,content_sha256,indexed_at,file_url,metadata&source_key=eq.'+encodeURIComponent(source));if(docs.length>1)throw Error('duplicate live source');if(!docs.length)return null;const chunks=await request('/rest/v1/document_chunks?select=chunk_hash,content,char_from,char_to,source_kind,page_number,embedding&document_id=eq.'+docs[0].id+'&order=chunk_index&limit=101');return {document:docs[0],chunks};},
      post:(doc,dry_run)=>request('/functions/v1/ingest-documents',{method:'POST',body:JSON.stringify({documents:[doc],dry_run})}),
      save:async s=>{fs.writeFileSync(checkpoint+'.tmp',redact(JSON.stringify(s,null,2)));fs.renameSync(checkpoint+'.tmp',checkpoint);const done=Object.values(s.entries).filter(x=>x.phase==='verified').length;console.log('verified '+done+'/23');},
    };
    try{await runStage(entries,deps,state,mode==='--execute');}catch(err){state.last_error=redact(err.message);await deps.save(state);throw err;}
    console.log(mode==='--execute'?'Stage complete: 23 sources verified':'Stage dry run complete: no writes');
  }catch(err){throw Error(redact(err.message));}finally{fs.closeSync(lockFd);fs.unlinkSync(lock);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=2;});
