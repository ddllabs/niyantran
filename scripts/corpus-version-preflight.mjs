// Read-only alternate-version audit. No ingestion transport or paid provider.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {analysisFor,buildBillModel,bindBillAnalysisIdentities} from '../src/lib/impactRecord.js';
import {checkVersionPair,normIdentity} from './corpus-version-mapping.mjs';
import {layoutText} from './corpus-job-preflight.mjs';
import {validateListingRows,validatePdfUrl,uniqueChunks,loadJobManifest,verifyPreparedEntry} from './corpus-stage-job.mjs';
import {contextualizeReceipt} from './corpus-context-preflight.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const save=(file,value)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n');fs.renameSync(file+'.tmp',file);};
async function* lines(file){for await(const line of createInterface({input:fs.createReadStream(file).pipe(createGunzip()),crlfDelay:Infinity}))yield JSON.parse(line);}
async function main(){
 const [decisionsFile,dir,packDir,corpusDir]=process.argv.slice(2);
 if(!corpusDir)throw Error('usage: corpus-version-preflight.mjs DECISIONS NEW_AUDIT_DIR PACK_DIR CORPUS_DIR');
 if(fs.existsSync(dir))throw Error('use a new audit directory; completed receipts must not be overwritten');
 const candidates=JSON.parse(fs.readFileSync(decisionsFile)).filter(x=>x.refresh_status==='download_url_unresolved'&&x.download_url_relation==='same_bill_other_document_version'&&x.current_download_urls.length===1&&x.current_download_urls[0].includes('/getFile/BillsTexts/')&&x.links[0].role!=='errata'&&x.chunks<=700&&x.n_chars<=600000);
 if(!candidates.length)throw Error('no selected candidates');
 fs.mkdirSync(path.join(dir,'text'),{recursive:true});fs.mkdirSync(path.join(dir,'pdf'));
 save(path.join(dir,'candidate-inventory.json'),candidates);
 const ids=new Set(candidates.map(c=>c.source_key)),urls=new Set(candidates.flatMap(c=>[c.file_url,c.current_download_urls[0]]).map(u=>new URL(u).href)),packs=new Map(),byUrl=new Map();
 for await(const p of lines(path.join(packDir,'documents/bills.jsonl.gz'))){
  if(ids.has(p.source_key)){if(packs.has(p.source_key))throw Error('duplicate pack source');packs.set(p.source_key,p);}
  if(p.file_url&&urls.has(new URL(p.file_url).href)){const u=new URL(p.file_url).href;const group=byUrl.get(u)||[];group.push(p);byUrl.set(u,group);ids.add(p.source_key);}
 }
 const originals=new Map();
 for await(const o of lines(path.join(corpusDir,'01_original_corpus/docs/_clean.jsonl.gz'))){if(ids.has(o.id)){const digest=sha(o.text);if(originals.has(o.id)&&originals.get(o.id)!==digest)throw Error('conflicting original source ID');originals.set(o.id,digest);}}
 save(path.join(dir,'original-source-checks.json'),{captured_at:new Date().toISOString(),sources:Object.fromEntries(originals)});
 const env={...process.env};for(const line of fs.readFileSync('.env.local','utf8').split('\n')){const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);if(m&&!env[m[1]])env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
 const url=env.SUPABASE_URL||env.VITE_SUPABASE_URL,key=env.SUPABASE_SECRET_KEY;
 if(new URL(url).hostname!=='vfgcppstyzjarlzyqdac.supabase.co'||!key?.startsWith('sb_secret_'))throw Error('wrong target/credential');
 async function read(route){const r=await fetch(url+'/rest/v1/'+route,{headers:{apikey:key,authorization:'Bearer '+key},signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('live read HTTP '+r.status);return r.json();}
 const rowsCache=new Map(),pdfCache=new Map(),receipts={};
 const {chunkDocument,CHUNK}=await import('../supabase/functions/_shared/chunking.ts');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const analysis=bindBillAnalysisIdentities(JSON.parse(fs.readFileSync('public/data/embedded_json/national_bill_analysis.json')),JSON.parse(fs.readFileSync('public/data/embedded_json/national_bill_analysis_identity.json')).records,JSON.parse(fs.readFileSync('public/data/embedded_json/national_bill_analysis_identity.json')).sources||[]);
 async function pdf(p){
  const canonical=new URL(p.file_url).href;if(pdfCache.has(canonical))return pdfCache.get(canonical);
  const promise=(async()=>{
   validatePdfUrl(p.file_url);const response=await fetch(p.file_url,{redirect:'error',signal:AbortSignal.timeout(45000)});
   if(!response.ok||new URL(response.url).hostname!=='sansad.in')throw Error('PDF unavailable HTTP '+response.status);
   const reader=response.body.getReader(),pieces=[];let bytes=0;
   while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>20000000){await reader.cancel();throw Error('PDF size bound exceeded');}pieces.push(value);}
   const buffer=Buffer.concat(pieces);if(!buffer.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Error('response is not a PDF');
   const file='pdf/'+sha(canonical)+'.pdf';fs.writeFileSync(path.join(dir,file),buffer);
   const task=getDocument({data:new Uint8Array(buffer),useSystemFonts:true,isEvalSupported:false});
   try{const d=await task.promise;if(d.numPages>500)throw Error('PDF page bound exceeded');let text='';for(let n=1;n<=d.numPages;n++){const page=await d.getPage(n);text+=layoutText((await page.getTextContent()).items)+'\n';}return {text,pages:d.numPages,pdf_file:file,pdf_sha256:sha(buffer)};}finally{await task.destroy();}
  })();pdfCache.set(canonical,promise);return promise;
 }
 for(const c of candidates){
  const captured_at=new Date().toISOString();
  try{
   const source=packs.get(c.source_key),downloadPacks=byUrl.get(new URL(c.current_download_urls[0]).href);
   if(!source||byUrl.get(new URL(c.file_url).href)?.length!==1||downloadPacks?.length!==1)throw Error('missing or non-unique pack URL identity');
   const download=downloadPacks[0];
   for(const p of [source,download])if(originals.get(p.source_key)!==p.content_sha256||sha(p.text)!==p.content_sha256||[...p.text].length!==p.n_chars)throw Error('original/pack text hash or length mismatch');
   if((await read('documents?select=id&source_key=eq.'+encodeURIComponent(c.source_key))).length)throw Error('source already stored');
   const key=c.document_keys[0];
   if(!rowsCache.has(key))rowsCache.set(key,await read('desk_rows?select=row,row_key,feature&document_key=eq.'+encodeURIComponent(key)+'&feature=in.'+encodeURIComponent('("Bill Passage Probability Index","Policy Intelligence Graph")')+'&limit=1001'));
   const rows=rowsCache.get(key);if(rows.length>1000)throw Error('listing result truncated');validateListingRows({doc:{metadata:{document_key:key}}},rows);
   const link=c.links.find(l=>l.document_key===key),matched=rows.filter(x=>normIdentity(x.row.bill_name||x.row.title)===normIdentity(c.title)&&normIdentity(x.row.house)===normIdentity(link.house)&&String(x.row.bill_number).trim()===String(link.bill_number).trim());
   validateListingRows({doc:{metadata:{document_key:key}}},matched);
   if(!matched.length||matched.some(x=>buildBillModel(x.row,analysisFor(x.row,analysis),null).pdf!==download.file_url))throw Error('current listing/Download mapping mismatch');
   const sourcePdf=await pdf(source),downloadPdf=await pdf(download),proof=checkVersionPair(c,source,download,sourcePdf.text,downloadPdf.text);
   const sourceTextFile='text/'+source.source_key+'.txt',downloadTextFile='text/'+download.source_key+'.txt';fs.writeFileSync(path.join(dir,sourceTextFile),source.text);fs.writeFileSync(path.join(dir,downloadTextFile),download.text);
   Object.assign(proof.source,{pdf_sha256:sourcePdf.pdf_sha256});Object.assign(proof.download,{pdf_sha256:downloadPdf.pdf_sha256,pdf_file:downloadPdf.pdf_file,text_file:downloadTextFile,original_sha256:originals.get(download.source_key)});
   const chunks=uniqueChunks(await chunkDocument(source.text));if(chunks.length!==c.chunks)throw Error('legacy chunk inventory changed');
   const doc={source_key:source.source_key,title:source.title,file_name:source.file_name,file_url:source.file_url,desk_tier:source.desk_tier,desk_feature:source.desk_feature,metadata:{document_key:key,bill_number:link.bill_number,bill_year:link.bill_year,house:link.house,status:link.status,document_role:link.role,file_url_ambiguous:false,file_url_source:'citation_pack_v1_two_version_verified',text_sha256:c.content_sha256,n_chars:c.n_chars,citation:source.citation,extraction:source.extraction}};
   let receipt={status:'pass',captured_at,identity:proof.source.identity,original_sha256:originals.get(source.source_key),pdf_sha256:sourcePdf.pdf_sha256,pdf_file:sourcePdf.pdf_file,text_file:sourceTextFile,pages:sourcePdf.pages,expected_chunks:chunks.length,estimated_tokens:chunks.reduce((s,x)=>s+x.tokenEstimate,0),token_ceiling:chunks.reduce((s,x)=>s+Buffer.byteLength(x.content),0),expected_spans:chunks.map(x=>({chunk_hash:x.chunkHash,chunk_index:x.chunkIndex,char_from:x.charFrom,char_to:x.charTo})),listing_rows:matched.map(x=>({row_key:x.row_key,feature:x.feature})),doc,chunker_version:CHUNK.version,version_proof:proof};
   receipt=await contextualizeReceipt(receipt,source.text);
   if(receipt.expected_chunks>800||receipt.context_audit.midword_boundaries||receipt.context_audit.max_content_chars>6000)throw Error('context worker bound exceeded');
   receipts[c.source_key]=receipt;
  }catch(err){receipts[c.source_key]={status:'hold',captured_at,reason:err.message};}
  save(path.join(dir,'receipts.json'),receipts);console.log(Object.keys(receipts).length+'/'+candidates.length+' '+c.source_key+' '+receipts[c.source_key].status+(receipts[c.source_key].reason?' '+receipts[c.source_key].reason:''));
 }
 const passed=Object.values(receipts).filter(r=>r.status==='pass'),stages=[];let stage=[],count=0;
 for(const r of passed){if(stage.length===30||count+r.expected_chunks>1000){stages.push(stage);stage=[];count=0;}stage.push(r);count+=r.expected_chunks;}if(stage.length)stages.push(stage);
 for(let i=0;i<stages.length;i++){
  const documents=stages[i],manifest={schema:'nter.text-job/1',project_id:'vfgcppstyzjarlzyqdac',created_at:new Date().toISOString(),model:'openai/text-embedding-3-small',chunker_version:4,worker_profile:'medium_v1',operation_mode:'supervised',execution_authorized:false,embedding_price_per_token:2e-8,limits:{documents:30,chunks:1000,document_chunks:800,document_chars:600000,gap_ms:2000,max_attempts:5,budget_usd:0.1},documents};
  const file=path.join(dir,'stage-'+String(i+1).padStart(2,'0')+'.json');save(file,manifest);const approved=sha(fs.readFileSync(file));const loaded=loadJobManifest(file,approved);for(const e of loaded.entries)await verifyPreparedEntry(e,4);save(file+'.approval.json',{manifest_sha256:approved,execution_authorized:false});
 }
 const reasons={};for(const r of Object.values(receipts))if(r.status==='hold')reasons[r.reason]=(reasons[r.reason]||0)+1;
 const summary={captured_at:new Date().toISOString(),candidates:candidates.length,candidate_bill_keys:new Set(candidates.map(c=>c.document_keys[0])).size,passed:passed.length,passed_bill_keys:new Set(passed.map(r=>r.doc.metadata.document_key)).size,held:candidates.length-passed.length,chunks:passed.reduce((n,r)=>n+r.expected_chunks,0),stages:stages.length,hold_reasons:reasons,execution_authorized:false};save(path.join(dir,'summary.json'),summary);console.log(JSON.stringify(summary));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
