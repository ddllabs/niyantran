import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifySourceRepair,verifyDownloadRepair} from './corpus-source-repair.mjs';
import {loadJobManifest} from './corpus-stage-job.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nter-repair-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const raw='clause 5 margin\n',fixed='clause\n\nMargin notes: margin\n';
 const review={schema:'nter.source-quality-review/1',status:'pass',source_key:'source-a',raw_sha256:sha(raw),repaired_sha256:sha(fixed),pdf_sha256:sha('pdf'),full_body_order_verified:true,substantive_text_preserved:true};
 const proof={schema:'nter.source-repair/1',source_key:'source-a',raw_sha256:sha(raw),repaired_sha256:sha(fixed),pdf_sha256:sha('pdf'),review_file:'review.json',review_sha256:sha(JSON.stringify(review)),edits:[{from:0,to:raw.length,old_sha256:sha(raw),replacement:fixed}]};
 fs.writeFileSync(root+'/raw.txt',raw);fs.writeFileSync(root+'/fixed.txt',fixed);fs.writeFileSync(root+'/review.json',JSON.stringify(review));fs.writeFileSync(root+'/proof.json',JSON.stringify(proof));
 const r={original_sha256:sha(raw),pdf_sha256:sha('pdf'),text_file:'fixed.txt',doc:{source_key:'source-a',metadata:{text_sha256:sha(fixed),original_text_sha256:sha(raw),source_repair_proof_sha256:sha(JSON.stringify(proof))}},source_repair:{raw_file:'raw.txt',proof_file:'proof.json',proof_sha256:sha(JSON.stringify(proof))}};
 const file=n=>{const p=path.resolve(root,n);if(!p.startsWith(root+path.sep)||fs.realpathSync(p)!==p)throw Error('unsafe path');return p;};
 return {r,file,root,proof,review};
}
test('exact reviewed raw-to-repaired text can be verified',t=>{const f=fixture(t);assert.equal(verifySourceRepair(f.r,f.file),true);});
test('Download repair retains original hash and verifies the same full provenance',t=>{
 const f=fixture(t);
 const p={source_key:f.r.doc.source_key,text_file:f.r.text_file,pdf_sha256:f.r.pdf_sha256,original_sha256:f.r.original_sha256,text_sha256:f.r.doc.metadata.text_sha256,source_repair:f.r.source_repair};
 assert.notEqual(p.original_sha256,p.text_sha256);
 assert.equal(verifyDownloadRepair(p,f.file),true);
 fs.appendFileSync(f.root+'/raw.txt',' changed');
 assert.throws(()=>verifyDownloadRepair(p,f.file),/binding/);
});
test('Download text cannot replace the original hash without a repair proof',()=>{
 assert.throws(()=>verifyDownloadRepair({original_sha256:sha('raw'),text_sha256:sha('fixed')},()=>{}),/original/);
});
for(const file of ['raw.txt','fixed.txt','proof.json','review.json'])test('modified '+file+' fails closed',t=>{const f=fixture(t);fs.appendFileSync(f.root+'/'+file,' changed');assert.throws(()=>verifySourceRepair(f.r,f.file));});
test('a hash-rebound unreviewed repair cannot pass',t=>{const f=fixture(t);f.review.full_body_order_verified=false;fs.writeFileSync(f.root+'/review.json',JSON.stringify(f.review));f.proof.review_sha256=sha(JSON.stringify(f.review));fs.writeFileSync(f.root+'/proof.json',JSON.stringify(f.proof));f.r.source_repair.proof_sha256=sha(JSON.stringify(f.proof));f.r.doc.metadata.source_repair_proof_sha256=f.r.source_repair.proof_sha256;assert.throws(()=>verifySourceRepair(f.r,f.file),/quality/);});
test('stored provenance must name the exact reviewed proof',t=>{const f=fixture(t);delete f.r.doc.metadata.source_repair_proof_sha256;assert.throws(()=>verifySourceRepair(f.r,f.file),/metadata binding/);});
test('a repair cannot substitute another source',t=>{const f=fixture(t);f.r.doc.source_key='source-b';assert.throws(()=>verifySourceRepair(f.r,f.file),/binding/);});
test('missing original metadata hash prevents provenance loss',t=>{const f=fixture(t);delete f.r.doc.metadata.original_text_sha256;assert.throws(()=>verifySourceRepair(f.r,f.file),/binding/);});
test('out-of-root raw paths are rejected',t=>{const f=fixture(t);f.r.source_repair.raw_file='../escape';assert.throws(()=>verifySourceRepair(f.r,f.file));});
test('unrepaired manifests still require identical original and text hashes',()=>{assert.equal(verifySourceRepair({original_sha256:sha('raw'),doc:{metadata:{text_sha256:sha('raw')}}},()=>{}),true);assert.throws(()=>verifySourceRepair({original_sha256:sha('raw'),doc:{metadata:{text_sha256:sha('other')}}},()=>{}),/original/);});
test('actual manifest loader verifies repair evidence before returning entries',t=>{
 const f=fixture(t);fs.writeFileSync(f.root+'/source.pdf','pdf');
 Object.assign(f.r,{status:'pass',identity:{status:'pass'},pdf_file:'source.pdf',token_ceiling:100,expected_chunks:1});
 Object.assign(f.r.doc,{title:'Test Bill',file_url:'https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/test.pdf'});
 Object.assign(f.r.doc.metadata,{document_key:'bill:2025:1',n_chars:fs.readFileSync(f.root+'/fixed.txt','utf8').length});
 const m={schema:'nter.text-job/1',project_id:'vfgcppstyzjarlzyqdac',model:'openai/text-embedding-3-small',chunker_version:2,limits:{documents:1,chunks:1,document_chunks:100,document_chars:75000,gap_ms:2000,max_attempts:5},documents:[f.r]};
 const bytes=JSON.stringify(m),file=f.root+'/stage.json';fs.writeFileSync(file,bytes);
 assert.equal(loadJobManifest(file,sha(bytes)).entries.length,1);
 fs.appendFileSync(f.root+'/raw.txt','altered');assert.throws(()=>loadJobManifest(file,sha(bytes)),/binding/);
});
