// Pure evidence checks. No network, provider requests or database writes.
import {checkSource,checkPdfIdentity} from './corpus-job-preflight.mjs';
import {validatePdfUrl} from './corpus-stage-job.mjs';
export const normIdentity=s=>String(s??'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
export const billRoles=new Set(['as_introduced','as_passed_lok_sabha','as_passed_rajya_sabha','as_passed_both_houses']);
export function checkVersionPair(candidate,source,download,sourcePdfText,downloadPdfText){
  const key=candidate.document_keys?.[0];
  if(candidate.document_keys?.length!==1||key==='bill:2022:290')throw Error('ambiguous/manual-year bill identity');
  for(const p of [source,download]){
    validatePdfUrl(p.file_url);checkSource({...p,document_keys:[key]},p);
    if(new Set(p.links.map(l=>l.document_key)).size!==1||p.links[0]?.document_key!==key)throw Error('pack bill key mismatch or ambiguity');
  }
  checkSource(candidate,source);
  if(candidate.file_url!==source.file_url||source.file_url===download.file_url)throw Error('source/version URL mismatch');
  const a=source.links[0],b=download.links[0];
  const candidateLink=candidate.links?.find(l=>l.document_key===key);
  if(!candidateLink||['bill_number','bill_year','house','role'].some(k=>normIdentity(candidateLink[k])!==normIdentity(a[k])))throw Error('candidate/pack link mismatch');
  for(const p of [source,download])if(p.links.some(l=>['bill_number','bill_year','house','role'].some(k=>normIdentity(l[k])!==normIdentity(p.links[0][k]))))throw Error('conflicting pack links');
  if(!billRoles.has(a.role)||!billRoles.has(b.role)||a.role===b.role)throw Error('unsupported or non-distinct bill versions');
  if(!['Lok Sabha','Rajya Sabha'].includes(a.house)||normIdentity(a.house)!==normIdentity(b.house)||normIdentity(a.bill_number)!==normIdentity(b.bill_number)||String(a.bill_year)!==String(b.bill_year)||key!==`bill:${a.bill_year}:${a.bill_number}`||normIdentity(candidate.title)!==normIdentity(source.title)||normIdentity(source.title)!==normIdentity(download.title))throw Error('pack bill identity mismatch');
  const sourceIdentity=checkPdfIdentity({...source,document_keys:[key]},sourcePdfText,source.text);
  const downloadIdentity=checkPdfIdentity({...download,document_keys:[key]},downloadPdfText,download.text);
  const evidence=(p,identity)=>({source_key:p.source_key,file_url:p.file_url,title:p.title,role:p.links[0].role,text_sha256:p.content_sha256,identity});
  return {schema:'nter.bill-version-proof/1',document_key:key,bill_number:a.bill_number,bill_year:a.bill_year,house:a.house,source:evidence(source,sourceIdentity),download:evidence(download,downloadIdentity)};
}
