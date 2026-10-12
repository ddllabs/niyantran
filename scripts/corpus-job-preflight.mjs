// Read-only preparation. Actual text/URLs are data, never execution instructions.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {analysisFor,buildBillModel,bindBillAnalysisIdentities} from '../src/lib/impactRecord.js';
import {validateListingRows,uniqueChunks,validatePdfUrl} from './corpus-stage-job.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const norm=s=>String(s||'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
export function layoutText(items){
  const lines=[];
  for(const item of items.filter(x=>x.str?.trim()&&x.transform).sort((a,b)=>b.transform[5]-a.transform[5])){
    // Sansad marginal-note baselines can be displaced by up to four points.
    const y=item.transform[5];let line=lines.find(x=>Math.abs(x.y-y)<=4);
    if(!line){line={y,items:[]};lines.push(line);}line.items.push(item);
  }
  return lines.sort((a,b)=>b.y-a.y).map(x=>x.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(x=>x.str).join(' ')).join('\n');
}
export function checkSource(candidate,pack){
  if(pack.source_key!==candidate.source_key||sha(pack.text)!==candidate.content_sha256||pack.content_sha256!==candidate.content_sha256)throw Error('local source hash mismatch');
  if([...pack.text].length!==candidate.n_chars)throw Error('local source length mismatch');
}
export function checkPdfIdentity(candidate,pdfText,sourceText){
  const link=candidate.links.find(x=>x.document_key===candidate.document_keys[0]);
  const head=pdfText.slice(0,10000).replace(/\s+/g,' ');
  // Gazette URLs can be traceable yet still require a separate bill-to-Act proof.
  if(link.role==='gazette_notification')throw Error('gazette bill-to-Act identity requires review');
  const number=/bill\s*(?:no\.?|number)\s*([a-z0-9]+)(?:\s*[-–‒]\s*([a-z]))?\s*of\s*(\d{4})/i.exec(head);
  if(!number||norm(number[1])!==norm(link.bill_number)||number[3]!==String(link.bill_year))throw Error('PDF bill number/year mismatch or unreadable header');
  const words=[...new Set(candidate.title.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2&&!['the','and','bill','act','of','for'].includes(w)))];
  const normalizedHead=norm(head);
  if(words.length<2||words.some(w=>!normalizedHead.includes(w)))throw Error('PDF title mismatch');
  const versionChecks={as_introduced:['to be introduced','as introduced'],as_passed_both_houses:['as passed by the houses of parliament','as passed by both houses'],as_passed_lok_sabha:['as passed by lok sabha','as passed by the lok sabha'],as_passed_rajya_sabha:['as passed by rajya sabha','as passed by the rajya sabha']};
  if(!versionChecks[link.role]?.some(x=>normalizedHead.includes(norm(x))))throw Error('PDF version mismatch or unreadable version');
  const expectedHouse=link.house==='Lok Sabha'?'LSBillTexts':'RSBillTexts';
  if(!decodeURI(new URL(candidate.file_url).pathname).includes(expectedHouse))throw Error('PDF chamber path mismatch');
  // Distributed samples require body agreement, not merely a title-page match.
  const source=norm(sourceText),actual=norm(pdfText);let matched=0,total=0;
  const width=Math.min(80,source.length);
  for(let i=0;i+width<=source.length;i+=Math.max(width,Math.floor(source.length/40))){total++;if(actual.includes(source.slice(i,i+width)))matched++;}
  if(!total||matched/total<0.9)throw Error('PDF/source text disagreement');
  return {status:'pass',bill_number:number[1],bill_year:number[3],version:link.role,body_samples:total,body_samples_matched:matched};
}
export function preflightPolicy(tier='small'){
  if(tier==='small')return {documents:25,chunks:1000,document_chunks:100,document_chars:50000,pdf_pages:100};
  if(tier==='medium')return {documents:10,chunks:1000,document_chunks:700,document_chars:600000,pdf_pages:500};
  throw Error('unknown preflight tier');
}
export function packStages(entries,tier='small'){
  const policy=preflightPolicy(tier);
  const stages=[];let stage=[],chunks=0;
  for(const e of entries){if(!Number.isInteger(e.expected_chunks)||e.expected_chunks<1||e.expected_chunks>policy.document_chunks)throw Error('document chunk bound exceeded');
    if(stage.length===policy.documents||chunks+e.expected_chunks>policy.chunks){stages.push(stage);stage=[];chunks=0;}
    stage.push(e);chunks+=e.expected_chunks;
  }
  if(stage.length)stages.push(stage);return stages;
}

// CLI adapter is deliberately read-only; no ingestion transport is present.
async function main(){
  const [dir,packDir,corpusDir,tier='small']=process.argv.slice(2);
  const policy=preflightPolicy(tier);
  if(!dir||!packDir||!corpusDir)throw Error('usage: corpus-job-preflight.mjs <job-directory> <citation-pack-directory> <original-corpus-directory> [small|medium]');
  const candidates=JSON.parse(fs.readFileSync(path.join(dir,'candidate-inventory.json'))).filter(x=>x.plan_status===tier+'_candidate_pending_pdf_preflight');
  const sourceKeys=new Set(candidates.map(x=>x.source_key)),packs=new Map();
  for await(const line of createInterface({input:fs.createReadStream(path.join(packDir,'documents/bills.jsonl.gz')).pipe(createGunzip()),crlfDelay:Infinity})){
    const p=JSON.parse(line);if(sourceKeys.has(p.source_key)){if(packs.has(p.source_key))throw Error('duplicate pack source');packs.set(p.source_key,p);}
  }
  const originals=new Map();const archive=path.join(corpusDir,'01_original_corpus/docs/_clean.jsonl.gz');
  for await(const line of createInterface({input:fs.createReadStream(archive).pipe(createGunzip()),crlfDelay:Infinity})){
    const original=JSON.parse(line);if(sourceKeys.has(original.id)){const digest=sha(original.text);if(originals.has(original.id)&&originals.get(original.id)!==digest)throw Error('conflicting original source ID');originals.set(original.id,digest);}
  }
  const env={...process.env};for(const line of fs.readFileSync('.env.local','utf8').split('\n')){const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);if(m&&!env[m[1]])env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
  const url=env.SUPABASE_URL||env.VITE_SUPABASE_URL,key=env.SUPABASE_SECRET_KEY;
  if(new URL(url).hostname!=='vfgcppstyzjarlzyqdac.supabase.co'||!key?.startsWith('sb_secret_'))throw Error('wrong target/credential');
  async function read(route){const r=await fetch(url+'/rest/v1/'+route,{headers:{apikey:key,authorization:'Bearer '+key},signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('live read HTTP '+r.status);return r.json();}
  const {chunkDocument,CHUNK}=await import('../supabase/functions/_shared/chunking.ts');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const map=bindBillAnalysisIdentities(JSON.parse(fs.readFileSync('public/data/embedded_json/national_bill_analysis.json')),JSON.parse(fs.readFileSync('public/data/embedded_json/national_bill_analysis_identity.json')).records,JSON.parse(fs.readFileSync('public/data/embedded_json/national_bill_analysis_identity.json')).sources||[]);
  const work=path.join(dir,'preflight-v2');fs.mkdirSync(path.join(work,'text'),{recursive:true});fs.mkdirSync(path.join(work,'pdf'),{recursive:true});
  for(const name of fs.readdirSync(work).filter(x=>/^stage-\d+\.json$/.test(x))){const file=path.join(work,name);if(fs.existsSync(file+'.checkpoint.json')||JSON.parse(fs.readFileSync(file)).execution_authorized)throw Error('stage is frozen; use a new job directory instead of overwriting receipts');}
  const receiptsFile=path.join(work,'receipts.json');const receipts=fs.existsSync(receiptsFile)?JSON.parse(fs.readFileSync(receiptsFile)):{};
  fs.writeFileSync(path.join(work,'original-source-checks.json'),JSON.stringify({archive,captured_at:new Date().toISOString(),sources:Object.fromEntries(originals)},null,2));
  for(const c of candidates){
    if(receipts[c.source_key]){if(receipts[c.source_key].status==='pass'){if(originals.get(c.source_key)!==c.content_sha256)receipts[c.source_key]={status:'hold',reason:'original corpus hash mismatch/missing source'};else receipts[c.source_key].original_sha256=originals.get(c.source_key);}continue;}
    const captured_at=new Date().toISOString();
    try{
      const p=packs.get(c.source_key);if(!p)throw Error('pack source missing');checkSource(c,p);if(originals.get(c.source_key)!==c.content_sha256)throw Error('original corpus hash mismatch/missing source');
      const chunks=uniqueChunks(await chunkDocument(p.text));
      if(chunks.length!==c.chunks||chunks.length>policy.document_chunks||[...p.text].length>policy.document_chars)throw Error('chunk/text bound or inventory mismatch');
      if((await read('documents?select=id&source_key=eq.'+encodeURIComponent(c.source_key))).length)throw Error('source already stored');
      const rows=await read('desk_rows?select=row,row_key,feature&document_key=eq.'+encodeURIComponent(c.document_keys[0])+'&feature=in.'+encodeURIComponent('("Bill Passage Probability Index","Policy Intelligence Graph")')+'&limit=1001');
      if(rows.length>1000)throw Error('listing result truncated');
      validateListingRows({doc:{metadata:{document_key:c.document_keys[0]}}},rows);
      const link=c.links.find(x=>x.document_key===c.document_keys[0]);
      const matched=rows.filter(x=>norm(x.row.bill_name||x.row.title)===norm(c.title)&&norm(x.row.house)===norm(link.house)&&String(x.row.bill_number).trim()===String(link.bill_number).trim());
      validateListingRows({doc:{metadata:{document_key:c.document_keys[0]}}},matched);
      if(!matched.length||matched.some(x=>buildBillModel(x.row,analysisFor(x.row,map),null).pdf!==c.file_url))throw Error('current listing/PDF URL mismatch');
      // Keep gazette cases out before spending download work on a missing identity rule.
      if(link.role==='gazette_notification')throw Error('gazette bill-to-Act identity requires review');
      validatePdfUrl(c.file_url);const response=await fetch(c.file_url,{signal:AbortSignal.timeout(45000),redirect:'error'});
      if(!response.ok)throw Error('PDF HTTP '+response.status);
      if(new URL(response.url).hostname!=='sansad.in')throw Error('unexpected PDF redirect host');
      const reader=response.body.getReader();const pieces=[];let bytes=0;
      while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>20000000){await reader.cancel();throw Error('PDF size bound exceeded');}pieces.push(value);}
      const pdf=Buffer.concat(pieces);if(!pdf.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Error('response is not a PDF');
      const task=getDocument({data:new Uint8Array(pdf),useSystemFonts:true,isEvalSupported:false});let document,pdfText='';
      try{document=await task.promise;if(document.numPages>policy.pdf_pages)throw Error('PDF page bound exceeded');for(let n=1;n<=document.numPages;n++){const page=await document.getPage(n);const t=await page.getTextContent();pdfText+=layoutText(t.items)+'\n';}const identity=checkPdfIdentity(c,pdfText,p.text);
        const textFile='text/'+c.source_key+'.txt',pdfFile='pdf/'+c.source_key+'.pdf';fs.writeFileSync(path.join(work,textFile),p.text);fs.writeFileSync(path.join(work,pdfFile),pdf);
        const doc={source_key:p.source_key,title:p.title,file_name:p.file_name,file_url:c.file_url,desk_tier:p.desk_tier,desk_feature:p.desk_feature,metadata:{document_key:link.document_key,bill_number:link.bill_number,bill_year:link.bill_year,house:link.house,status:link.status,document_role:link.role,file_url_ambiguous:false,file_url_source:'citation_pack_v1_verified',text_sha256:c.content_sha256,n_chars:c.n_chars,citation:p.citation,extraction:p.extraction}};
        receipts[c.source_key]={status:'pass',captured_at,identity,original_sha256:originals.get(c.source_key),pdf_sha256:sha(pdf),pages:document.numPages,text_file:textFile,pdf_file:pdfFile,expected_chunks:chunks.length,estimated_tokens:chunks.reduce((s,x)=>s+x.tokenEstimate,0),token_ceiling:chunks.reduce((s,x)=>s+Buffer.byteLength(x.content,'utf8'),0),expected_spans:chunks.map(x=>({chunk_hash:x.chunkHash,chunk_index:x.chunkIndex,char_from:x.charFrom,char_to:x.charTo})),listing_rows:matched.map(x=>({row_key:x.row_key,feature:x.feature})),doc,chunker_version:CHUNK.version};
      }finally{await task.destroy();}
    }catch(err){receipts[c.source_key]={status:'hold',captured_at,reason:err.message};}
    fs.writeFileSync(receiptsFile+'.tmp',JSON.stringify(receipts,null,2));fs.renameSync(receiptsFile+'.tmp',receiptsFile);
    console.log(Object.keys(receipts).length+'/'+candidates.length+' '+c.source_key+' '+receipts[c.source_key].status+(receipts[c.source_key].reason?' '+receipts[c.source_key].reason:''));
    await new Promise(r=>setTimeout(r,250));
  }
  fs.writeFileSync(receiptsFile+'.tmp',JSON.stringify(receipts,null,2));fs.renameSync(receiptsFile+'.tmp',receiptsFile);
  const passed=Object.entries(receipts).filter(([source,r])=>sourceKeys.has(source)&&r.status==='pass').map(([,r])=>r).sort((a,b)=>String(b.doc.metadata.bill_year).localeCompare(String(a.doc.metadata.bill_year))||a.expected_chunks-b.expected_chunks);
  const stages=packStages(passed,tier);for(let i=0;i<stages.length;i++){
    const manifest={schema:'nter.text-job/1',project_id:'vfgcppstyzjarlzyqdac',created_at:new Date().toISOString(),model:'openai/text-embedding-3-small',chunker_version:CHUNK.version,limits:{documents:policy.documents,chunks:policy.chunks,document_chunks:policy.document_chunks,document_chars:policy.document_chars,gap_ms:2000,max_attempts:5},execution_authorized:false,preflight_tier:tier,execution_readiness:tier==='medium'?'requires_medium_worker_limits_and_measured_pilot':'requires_exact_release',documents:stages[i]};
    fs.writeFileSync(path.join(work,'stage-'+String(i+1).padStart(2,'0')+'.json'),JSON.stringify(manifest,null,2));
  }
  const summary={preflight_tier:tier,candidates:candidates.length,passed:passed.length,held:Object.values(receipts).filter(x=>x.status==='hold').length,chunks:passed.reduce((s,x)=>s+x.expected_chunks,0),stages:stages.length,hold_reasons:{}};
  for(const r of Object.values(receipts))if(r.status==='hold')summary.hold_reasons[r.reason]=(summary.hold_reasons[r.reason]||0)+1;
  fs.writeFileSync(path.join(work,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
