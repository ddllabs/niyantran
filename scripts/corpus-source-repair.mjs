// Local source-repair provenance only. This does not certify OCR semantics or authorize execution.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
// Download evidence has its own source identity and files. Reuse the same
// reviewed edit-ledger contract; never relabel repaired bytes as original OCR.
export function verifyDownloadRepair(p,safeFile){
 return verifySourceRepair({
  original_sha256:p.original_sha256,pdf_sha256:p.pdf_sha256,text_file:p.text_file,source_repair:p.source_repair,
  doc:{source_key:p.source_key,metadata:{text_sha256:p.text_sha256,original_text_sha256:p.original_sha256,source_repair_proof_sha256:p.source_repair?.proof_sha256}},
 },safeFile);
}
export function verifySourceRepair(r,safeFile){
 const m=r.doc?.metadata;
 if(!r.source_repair){if(r.original_sha256!==m?.text_sha256)throw Error('original/source hash mismatch');return true;}
 const p=r.source_repair;
 const raw=fs.readFileSync(safeFile(p.raw_file),'utf8'),fixed=fs.readFileSync(safeFile(r.text_file),'utf8');
 const bytes=fs.readFileSync(safeFile(p.proof_file));
 if(sha(bytes)!==p.proof_sha256||m?.source_repair_proof_sha256!==p.proof_sha256)throw Error('repair proof changed or metadata binding missing');
 const proof=JSON.parse(bytes);
 if(proof.schema!=='nter.source-repair/1'||proof.source_key!==r.doc.source_key||proof.raw_sha256!==r.original_sha256||proof.raw_sha256!==m?.original_text_sha256||sha(raw)!==proof.raw_sha256||sha(fixed)!==proof.repaired_sha256||proof.repaired_sha256!==m?.text_sha256||proof.pdf_sha256!==r.pdf_sha256)throw Error('repair source/PDF/hash binding mismatch');
 const reviewBytes=fs.readFileSync(safeFile(proof.review_file));
 if(sha(reviewBytes)!==proof.review_sha256)throw Error('repair quality review changed');
 const review=JSON.parse(reviewBytes);
 if(review.schema!=='nter.source-quality-review/1'||review.status!=='pass'||review.source_key!==proof.source_key||review.raw_sha256!==proof.raw_sha256||review.repaired_sha256!==proof.repaired_sha256||review.pdf_sha256!==proof.pdf_sha256||review.full_body_order_verified!==true||review.substantive_text_preserved!==true)throw Error('repair quality review incomplete');
 if(!Array.isArray(proof.edits)||!proof.edits.length)throw Error('repair edits missing');
 let end=0,out='';
 for(const e of proof.edits){
  if(!Number.isSafeInteger(e.from)||!Number.isSafeInteger(e.to)||e.from<end||e.to<=e.from||e.to>raw.length||typeof e.replacement!=='string'||sha(raw.slice(e.from,e.to))!==e.old_sha256)throw Error('repair edit range/hash mismatch');
  out+=raw.slice(end,e.from)+e.replacement;end=e.to;
 }
 out+=raw.slice(end);
 if(out!==fixed)throw Error('repair edits do not reproduce text');
 return true;
}
