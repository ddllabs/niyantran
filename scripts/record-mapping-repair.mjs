/** Offline association-only repair planner. Never connects to Supabase or modifies a corpus. */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const hash = s => createHash('sha256').update(s).digest('hex');
const normal = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const sha = s => /^[a-f0-9]{64}$/.test(s ?? '');
// The answer file a Lok Sabha question URL names; same rule as pq_answer_key (SQL) and pqAnswerKey (suppliedText.ts).
const PQ_URL=/^https:\/\/sansad\.in\/getFile\/loksabhaquestions\/annex\/([0-9]{1,4})\/([A-Za-z0-9_]{1,64})\.pdf(\?source=pqals)?$/;
export const pqAnswerKey = u => { const m=typeof u==='string'?PQ_URL.exec(u):null; return m?`pq:ls:${m[1]}:${m[2]}`:null; };
const isoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '') ? s : /^(\d{2})\.(\d{2})\.(\d{4})$/.test(s ?? '') ? s.split('.').reverse().join('-') : null;
export function planRepairs(pages) {
 const urlOwners=new Map();
 for(const page of pages)for(const d of page.documents || []){if(!d.file_url)continue;const owners=urlOwners.get(d.file_url)||new Set();owners.add(d.id);urlOwners.set(d.file_url,owners);}
 const seen = new Set(); const candidates=[]; const held=[]; let chunks=0, vectors=0, ready=0;
 for (const page of pages) {
  if (!page.captured_at || !Array.isArray(page.documents)) throw Error('invalid inventory page');
  for(const d of page.documents) {
   if (!d.id || seen.has(d.id)) throw Error('duplicate or missing document identity: refresh inventory');
   seen.add(d.id); chunks+=Number(d.chunks);vectors+=Number(d.vectors);
   const reasons=[];const c=d.citation || {};const review=d.review || {};
   if(d.desk_tier!=='national'||d.desk_feature!=='Parliamentary Question Database'||c.kind!=='parliamentary_question')reasons.push('unsupported_collection');
   if(!d.indexed_at||!(d.chunks>0)||d.vectors!==d.chunks)reasons.push('index_incomplete');
   if(!sha(d.content_sha256))reasons.push('missing_text_hash');
   if(review.status!=='eligible'||!['identity','completeness','sensitivity','dedupe','rights'].every(k=>review.checks?.[k]===true))reasons.push('screening_not_verified');
   let url;try{url=new URL(d.file_url);}catch{/* held below */}
   if(!url||url.protocol!=='https:'||!['sansad.in','sansad.gov.in'].includes(url.hostname)||url.username||url.password)reasons.push('unapproved_source');
   if(d.url_aliases!==0 || urlOwners.get(d.file_url)?.size>1)reasons.push('source_alias_requires_review');
   const answerKey=pqAnswerKey(d.file_url);
   if(!answerKey||(d.document_key_suggested!=null&&d.document_key_suggested!==answerKey))reasons.push('answer_key_conflict');
   if(!d.rows?.length)reasons.push('no_exact_listing');
   const rowKeys=new Set();
   for(const r of d.rows || []) {
    if(rowKeys.has(r.row_key))reasons.push('duplicate_listing_identity');rowKeys.add(r.row_key);
    if(r.tier!==d.desk_tier||r.feature!==d.desk_feature||r.row?.source_url!==d.file_url||!r.row_key||!sha(r.expected_fingerprint))reasons.push('row_identity_unverified');
    if(pqAnswerKey(r.row?.source_url)!==answerKey)reasons.push('answer_key_conflict');
    if(!normal(c.house)||normal(c.house)!==normal(r.row?.house))reasons.push('house_conflict');
    if(!normal(c.subject)||normal(c.subject)!==normal(r.row?.subject))reasons.push('subject_conflict');
    if(!isoDate(c.answered_on)||isoDate(c.answered_on)!==isoDate(r.row?.date))reasons.push('date_conflict');
    if(!normal(c.ministry)||normal(c.ministry)!==normal(r.row?.ministry))reasons.push('ministry_conflict');
   }
   if(reasons.length)held.push({document_id:d.id,title:d.title,source_key:d.source_key,reasons:[...new Set(reasons)].sort(),row_keys:(d.rows||[]).map(r=>r.row_key)});
   else {
    ready++;
    for(const r of d.rows)candidates.push({tier:r.tier,feature:r.feature,row_key:r.row_key,document_id:d.id,source_key:d.source_key,title:d.title,source_url:d.file_url,text_sha256:d.content_sha256,role:'answer',version:'1',expected_alias_ids:[],expected_fingerprint:r.expected_fingerprint});
   }
  }
 }
 candidates.sort((a,b)=>(a.document_id+a.row_key).localeCompare(b.document_id+b.row_key));
 held.sort((a,b)=>a.document_id.localeCompare(b.document_id));
 return {contract_version:1,status:'review_required',adapter:'national-pq-exact-source-v1',captured_from:pages[0]?.captured_at,captured_through:pages.at(-1)?.captured_at,documents:seen.size,chunks,vectors,ready_documents:ready,candidate_associations:candidates.length,held_documents:held.length,candidates,held};
}
/** Deliberately renders, never executes. One transaction aborts on any stale identity. */
export function renderRepairSql(bytes,{approval,decisionId,approver,maxAssociations=10000}={}) {
 if(approval!==hash(bytes)||!decisionId?.trim()||!approver?.trim())throw Error('exact manifest approval, decision ID and approver required');
 if(!Number.isInteger(maxAssociations)||maxAssociations<1||maxAssociations>10000)throw Error('invalid association limit');
 const p=JSON.parse(bytes);
 if(p.contract_version!==1||p.status!=='review_required'||!Array.isArray(p.candidates)||p.candidates.length>maxAssociations)throw Error('invalid or oversized repair plan');
 const ids=new Set(),tuples=new Set();
 if(!Array.isArray(p.held)||p.candidate_associations!==p.candidates.length||p.held_documents!==p.held.length)throw Error('manifest counts mismatch');
 const heldIds=new Set(p.held.map(h=>h.document_id));
 for(const c of p.candidates){
  if(heldIds.has(c.document_id))throw Error('held/candidate overlap');
  const tuple=JSON.stringify([c.tier,c.feature,c.row_key,c.document_id]);
  if(tuples.has(tuple))throw Error('duplicate candidate association');tuples.add(tuple);ids.add(c.document_id);
  if(c.tier!=='national'||c.feature!=='Parliamentary Question Database'||c.role!=='answer'||c.version!=='1'||!c.row_key||!sha(c.expected_fingerprint)||!sha(c.text_sha256)||!Array.isArray(c.expected_alias_ids)||c.expected_alias_ids.length)throw Error('invalid candidate contract');
 }
 if(ids.size!==p.ready_documents||ids.size+heldIds.size!==p.documents||heldIds.size!==p.held.length)throw Error('manifest document counts mismatch');
 const literal = s => "'"+s.replaceAll("'","''")+"'";
 const statements=p.candidates.map(c=>`select public.record_mapping_apply(${literal(JSON.stringify({...c,decision_id:decisionId,approver,evidence_sha256:approval}))}::jsonb);`);
 return `-- Reviewed association-only repair. Separate production authorization is required.\n-- Manifest sha256: ${approval}\nbegin;\nset local statement_timeout='30s';\n${statements.join('\n')}\ncommit;\n`;
}
async function main(){
 const args=process.argv.slice(2);const options={};
 for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||!args[i+1])throw Error('expected --option value');options[args[i].slice(2)]=args[i+1];}
 if(options.inventory){
  if(!options.out)throw Error('--out required');
  const files=(await readdir(options.inventory)).filter(f=>/^page-\d+\.json$/.test(f)).sort();
  if(!files.length)throw Error('no inventory pages');
  const pages=await Promise.all(files.map(f=>readFile(join(options.inventory,f),'utf8').then(JSON.parse)));
  const plan=planRepairs(pages);const bytes=JSON.stringify(plan,null,2)+'\n';await mkdir(options.out,{recursive:true});
  await writeFile(join(options.out,'repair-plan.json'),bytes,{flag:'wx'});
  const summary={...plan,candidates:undefined,held:undefined,manifest_sha256:hash(bytes),holds_by_reason:{}};
  for(const h of plan.held)for(const reason of h.reasons)summary.holds_by_reason[reason]=(summary.holds_by_reason[reason]||0)+1;
  await writeFile(join(options.out,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(summary));
 }else if(options.plan){
  if(!options.sql)throw Error('--sql output required');
  const sql=renderRepairSql(await readFile(options.plan,'utf8'),{approval:options.approval,decisionId:options['decision-id'],approver:options.approver,maxAssociations:Number(options['max-associations']||10000)});
  await writeFile(options.sql,sql,{flag:'wx'});console.log('SQL prepared only; nothing executed.');
 }else throw Error('Use --inventory DIRECTORY --out NEW_DIRECTORY; rendering: --plan FILE --sql NEW_FILE --approval SHA256 --decision-id ID --approver NAME');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
