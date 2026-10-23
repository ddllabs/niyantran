/** Metadata-only Law publication planning/repair. Never registers, chunks or embeds documents. */
import { open, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lawAdminApi } from './law-client-api.mjs';
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash=x=>createHash('sha256').update(x).digest('hex');
export async function runLawListings(options,request=fetch) {
 const {receipts,plan,report,publish=false,verify=false,approval,decisionId,approver}=options;
 if (!report || (!receipts && !plan) || (receipts && plan) || (publish && verify)) throw Error('choose receipts or plan and a fresh report');
 if ((publish || verify) && !plan) throw Error('publication/verification requires a saved plan');
 const call=lawAdminApi(options,request);
 const path=plan||receipts;
 if ((await stat(path)).size>8_000_000) throw Error('manifest exceeds 8 MB');
 const bytes=await readFile(path);const digest=hash(bytes);
 if (publish && approval!==digest) throw Error('approval must equal plan SHA-256');
 if (publish && (!decisionId?.trim() || !approver?.trim() || decisionId.length>200 || approver.length>200)) throw Error('decision ID and approver required');
 const targets=new Map();
 let boundTarget=false;
 for (const line of new TextDecoder('utf-8',{fatal:true}).decode(bytes).split(/\r?\n/).filter(s=>s.trim())) {
  const r=JSON.parse(line);
  if (r.type === 'manifest') {
   if (r.target !== new URL(options.target).origin) throw Error('plan target differs from requested target');
   boundTarget = true; continue;
  }
  if (r.type && r.type!=='mapping') continue;
  if (!r.document_id) continue;
  if (!UUID.test(r.document_id)||!SHA.test(r.text_sha256??'')) throw Error('receipt requires document ID and text hash');
  if (plan && !SHA.test(r.expected_fingerprint??'')) throw Error('plan requires mapping fingerprint');
  if (publish && !['ready','published','pending'].includes(r.status)) throw Error('held mapping cannot be published');
  const previous=targets.get(r.document_id);
  if (previous && (previous.text_sha256!==r.text_sha256 || previous.expected_fingerprint!==r.expected_fingerprint)) throw Error('conflicting duplicate receipt');
  targets.set(r.document_id,r);
  if(targets.size>1000) throw Error('at most 1000 documents');
 }
 if(plan && !boundTarget) throw Error('plan must bind target');
 if(!targets.size) throw Error('no document receipts');
 const output=await open(report,'wx',0o600);
 const append=async r=>{await output.write(JSON.stringify(r)+'\n');await output.sync();};
 const summary={ready:0,held:0,pending:0,published:0,uncertain:0,not_attempted:0,input_sha256:digest};
 let stopped=false;
 try {
  await append({type:'manifest',contract_version:1,target:new URL(options.target).origin,input_sha256:digest,mode:publish?'publish':verify?'verify':'plan'});
  for(const r of targets.values()) {
   const base={type:'mapping',document_id:r.document_id,text_sha256:r.text_sha256,source_key:r.source_key};
   if(stopped){summary.not_attempted++;await append({...base,status:'not_attempted'});continue;}
   if(publish) await append({...base,status:'publishing',expected_fingerprint:r.expected_fingerprint});
   try {
    let result=await call(verify?{action:'law-status',document_id:r.document_id}:publish?
     {action:'law-publish',document_id:r.document_id,text_sha256:r.text_sha256,expected_fingerprint:r.expected_fingerprint,decision_id:decisionId,approver,evidence_sha256:digest}:
     {action:'law-reconcile',document_id:r.document_id,text_sha256:r.text_sha256});
    if(result.document_id!==r.document_id) throw Error('document identity mismatch');
    if(publish && result.status==='published') {
     result=await call({action:'law-status',document_id:r.document_id});
     if(result.document_id!==r.document_id) throw Error('document identity mismatch');
    }
    if(!['ready','held','pending','published','unmapped'].includes(result.status)) throw Error('unknown publication state');
    if(result.status==='published' && (!UUID.test(result.record_id??'') || !result.row_key || result.document_key!==`law-record:${result.record_id}`)) throw Error('publication receipt lacks listing identity');
    const status=result.status==='unmapped'?'held':result.status;
    summary[status]++;
    await append({...base,status,action:result.action,expected_fingerprint:result.fingerprint??r.expected_fingerprint,
     record_id:result.record_id,row_key:result.row_key,document_key:result.document_key,reasons:result.reasons??[],indexed:result.indexed});
   }catch{
    summary.uncertain++;stopped=true;
    await append({...base,status:'uncertain',reason:'request or acknowledgement failed; inspect remote status before retry',expected_fingerprint:r.expected_fingerprint});
   }
  }
  await append({type:'summary',...summary});return summary;
 }finally{await output.close();}
}
async function main(){
 const opts={token:process.env.NTER_INGEST_ACCESS_TOKEN,publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY};
 const args=process.argv.slice(2); const names={'--receipts':'receipts','--plan':'plan','--report':'report','--target':'target','--approval':'approval','--decision-id':'decisionId','--approver':'approver'};
 if(args.includes('--help')){console.log('node scripts/law-listing-reconcile.mjs --receipts registration.jsonl --report plan.jsonl --target https://PROJECT.supabase.co\nThen: --plan plan.jsonl --report fresh-receipt.jsonl --target ... [--verify | --publish --approval PLAN_SHA256 --decision-id ID --approver NAME]\nMetadata only. No ingestion or embedding.');return;}
 for(let i=0;i<args.length;i++){if(args[i]==='--publish')opts.publish=true;else if(args[i]==='--verify')opts.verify=true;else if(names[args[i]]){const key=names[args[i]];if(!args[++i])throw Error('missing argument');opts[key]=args[i];}else throw Error('unknown argument');}
 const result=await runLawListings(opts);console.log(JSON.stringify(result));if(result.uncertain||result.held||result.pending)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Law listing operation stopped; check inputs and private report. No automatic replay.');process.exitCode=1;});
