// Local-only re-freezing of already verified source/PDF receipts. No network,
// provider or database transport. Every output remains execution_authorized:false.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prepareTextChunks, expectedChunkSpans } from './corpus-stage-job.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');

export async function contextualizeReceipt(receipt,text) {
  if(receipt.status!=='pass'||receipt.chunker_version!==2)throw Error('requires verified version-2 receipt');
  if(sha(text)!==receipt.original_sha256||sha(text)!==receipt.doc.metadata.text_sha256||[...text].length!==receipt.doc.metadata.n_chars)throw Error('source hash/length changed');
  const chunks=await prepareTextChunks(text,'section_context_v1');
  let midword=0;
  const word=c=>c!==undefined&&/[\p{L}\p{N}]/u.test(c);
  for(const c of chunks){
    if(c.content!==text.slice(c.charFrom,c.charTo))throw Error('context citation span drift');
    if(word(text[c.charFrom-1])&&word(text[c.charFrom]))midword++;
    if(word(text[c.charTo-1])&&word(text[c.charTo]))midword++;
  }
  return {...receipt,doc:{...receipt.doc,chunking_mode:'section_context_v1'},chunker_version:4,
    previous_chunks:receipt.expected_chunks,expected_chunks:chunks.length,
    estimated_tokens:chunks.reduce((n,c)=>n+c.tokenEstimate,0),
    token_ceiling:chunks.reduce((n,c)=>n+Buffer.byteLength(c.embedding_input,'utf8'),0),
    expected_spans:expectedChunkSpans(chunks),
    context_audit:{heading_chunks:chunks.filter(c=>c.section.heading).length,note_chunks:chunks.filter(c=>c.section.note).length,midword_boundaries:midword,max_content_chars:Math.max(0,...chunks.map(c=>c.content.length))}};
}

export async function prepareContextDirectory(input,output) {
  const root=fs.realpathSync(input);
  if(fs.existsSync(output))throw Error('context output must be a new directory');
  const sourceFile=name=>{const resolved=path.resolve(root,name);if(!resolved.startsWith(root+path.sep)||fs.realpathSync(resolved)!==resolved)throw Error('source path escapes preflight directory');return resolved;};
  const stages=fs.readdirSync(root).filter(f=>/^stage-\d+\.json$/.test(f)).sort();
  const receipts=[];const sources=new Set();
  for(const file of stages){
    const stage=JSON.parse(fs.readFileSync(path.join(root,file)));
    if(stage.chunker_version!==2||stage.execution_authorized!==false)throw Error('requires untouched version-2 draft stages');
    for(const r of stage.documents){
      if(r.identity?.status!=='pass'||sources.has(r.doc.source_key))throw Error('missing identity evidence or duplicate source');
      sources.add(r.doc.source_key);
      if(sha(fs.readFileSync(sourceFile(r.pdf_file)))!==r.pdf_sha256)throw Error('cached PDF changed');
      receipts.push(await contextualizeReceipt(r,fs.readFileSync(sourceFile(r.text_file),'utf8')));
    }
  }
  if(!receipts.length)throw Error('no verified receipts');
  fs.mkdirSync(output,{recursive:true});fs.mkdirSync(path.join(output,'text'));fs.mkdirSync(path.join(output,'pdf'));
  for(const r of receipts){fs.copyFileSync(sourceFile(r.text_file),path.join(output,r.text_file));fs.copyFileSync(sourceFile(r.pdf_file),path.join(output,r.pdf_file));}
  const ready=receipts.filter(r=>r.expected_chunks<=100&&r.doc.metadata.n_chars<=75000&&r.context_audit.midword_boundaries===0&&r.context_audit.max_content_chars<=6000);
  const pilot=ready.find(r=>r.doc.source_key==='6c18b649806b7aa824a8226ffdb9701fed15e88f')??ready[0];
  const manifest=(documents,budget)=>({schema:'nter.text-job/1',project_id:'vfgcppstyzjarlzyqdac',model:'openai/text-embedding-3-small',chunker_version:4,
    limits:{documents:documents.length,chunks:1000,document_chunks:100,document_chars:75000,gap_ms:2000,max_attempts:5,budget_usd:budget},
    execution_authorized:false,operation_mode:'supervised',embedding_price_per_token:2e-8,
    execution_readiness:'requires_context_function_deployment_current_mapping_pdf_checks_and_exact_release',documents});
  const save=(file,data)=>fs.writeFileSync(path.join(output,file),JSON.stringify(data,null,2)+'\n');
  save('receipts.json',receipts);
  if(pilot){
    save('pilot-proposal.json',manifest([pilot],0.015));
    const text=fs.readFileSync(path.join(output,pilot.text_file),'utf8');
    save('pilot-embedding-inputs.json',await prepareTextChunks(text,'section_context_v1'));
    const remaining=ready.filter(r=>r!==pilot);if(remaining.length)save('follow-up-proposal.json',manifest(remaining,0.08));
  }
  const summary={documents:receipts.length,chunks:receipts.reduce((n,r)=>n+r.expected_chunks,0),heading_chunks:receipts.reduce((n,r)=>n+r.context_audit.heading_chunks,0),note_chunks:receipts.reduce((n,r)=>n+r.context_audit.note_chunks,0),midword_boundaries:receipts.reduce((n,r)=>n+r.context_audit.midword_boundaries,0),bounded_documents:ready.length,bounded_chunks:ready.reduce((n,r)=>n+r.expected_chunks,0),pilot:pilot?{source_key:pilot.doc.source_key,chunks:pilot.expected_chunks,input_token_ceiling:pilot.token_ceiling,one_attempt_cost_ceiling:pilot.token_ceiling*2e-8}:null};
  save('summary.json',summary);return summary;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4)throw Error('usage: node scripts/corpus-context-preflight.mjs INPUT_PREFLIGHT_DIR NEW_OUTPUT_DIR');
  console.log(JSON.stringify(await prepareContextDirectory(process.argv[2],process.argv[3]),null,2));
}
