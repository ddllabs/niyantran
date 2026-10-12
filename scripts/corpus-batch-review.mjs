// Preparation helpers only. No ingestion transport and no automatic quality acceptance.
const norm=value=>String(value??'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
export function selectReviewBatch(rows){
 const documents=[];let chunks=0,characters=0;const seen=new Set();
 for(const row of rows){
  if(!row.source_key||seen.has(row.source_key)||!Number.isSafeInteger(row.chunks)||row.chunks<1||row.chunks>800||!Number.isSafeInteger(row.n_chars)||row.n_chars<1||row.n_chars>600000)continue;
  if(documents.length>=500)break;
  if(chunks+row.chunks>20000||characters+row.n_chars>10000000)continue;
  documents.push(row);seen.add(row.source_key);chunks+=row.chunks;characters+=row.n_chars;
 }
 return {schema:'nter.corpus-review-batch/1',execution_authorized:false,documents,chunks,characters};
}

export function inspectContext(text,chunks){
 const holds=[];
 const enactment=/\bB\s*E\s+it\s+enacted\b/i.exec(text);
 const enacted=Boolean(enactment);
 const clauses=chunks.filter(c=>c.section?.note).length;
 if(!enacted)holds.push('enactment_marker_missing');
 if(enacted&&!clauses)holds.push('operative_clauses_not_recognized');
 if(/\bUNRESOLVED\b|\ufffd/.test(text))holds.push('unresolved_or_invalid_text');
 if(chunks.some(c=>c.content!==text.slice(c.charFrom,c.charTo)))holds.push('span_mismatch');
 if(chunks.some(c=>c.content.length>6000))holds.push('chunk_character_bound');
 // Byte length is a conservative token upper bound for the existing model.
 if(chunks.some(c=>Buffer.byteLength(c.embedding_input,'utf8')>8191))holds.push('embedding_token_ceiling');
 // Independent broad screen: it also sees numbers after statutory margin
 // references that the production parser may miss. Ambiguity requests review;
 // it never changes text, adds context or declares semantic quality accepted.
 const body=enactment?text.slice(enactment.index+enactment[0].length).split(/STATEMENT OF OBJECTS|EXTRACTS FROM|ANNEXURE|SCHEDULE/)[0]:'';
 const expected=[...new Set([...body.matchAll(/(?:^|\s{2,})(\d{1,3})\s*\.\s*(?=[A-Z(])/gm)].map(m=>m[1]))];
 const recognized=new Set(chunks.flatMap(c=>[...(c.section?.note||'').matchAll(/(\d{1,3})\./g)].map(m=>m[1])));
 const missing_clause_markers=expected.filter(n=>!recognized.has(n));
 if(missing_clause_markers.length)holds.push('missing_clause_context_requires_review');
 return {quality_accepted:false,holds,clauses,expected_clause_markers:expected,missing_clause_markers,contextual:chunks.filter(c=>c.section?.heading||c.section?.note).length,
  requires:['full_pdf_text_layout_review','section_chapter_schedule_coverage_review']};
}

export function proposeAnalysisIdentities(map,identitiesByUrl){
 const accepted=[],held=[];
 for(const [analysis_key,value] of Object.entries(map)){
  // These are the exact roles used by the Download resolver. Committee reports
  // and synopses are separate documents and cannot establish bill-text identity.
  const urls=[...new Set(['introduced','passed_ls','passed_rs','passed_both','gazetted']
    .map(role=>value?.enrichment?.pdf_links?.[role]).filter(Boolean))];
  const identities=urls.flatMap(url=>identitiesByUrl.get(url)||[]);
  const key=x=>[x.document_key,x.bill_number,x.bill_year,x.bill_name,x.house].map(norm).join('|');
  const complete=x=>x.document_key&&x.bill_number&&/^\d{4}$/.test(String(x.bill_year))&&x.bill_name&&['Lok Sabha','Rajya Sabha'].includes(x.house)&&x.document_key===`bill:${x.bill_year}:${x.bill_number}`;
  if(!urls.length||urls.some(url=>!identitiesByUrl.get(url)?.length)||identities.some(x=>!complete(x))||new Set(identities.map(key)).size!==1||norm(identities[0]?.bill_number)!==norm(value?.enrichment?.bill_number)){
   held.push({analysis_key,reason:'missing_or_conflicting_url_identity'});continue;
  }
  accepted.push({analysis_key,identity:identities[0],urls,status:'mapping_proposal_requires_pdf_and_listing_proof'});
 }
 return {accepted,held};
}

// Mapping proposals only: PDF identity and substantive text quality remain
// independent release gates. A conflict holds its bill, not unrelated bills.
export function proposeBillSources(pack, rows) {
 const roles={as_introduced:'introduced',as_passed_lok_sabha:'passed_ls',as_passed_rajya_sabha:'passed_rs',as_passed_both_houses:'passed_both',gazette_notification:'gazetted'};
 const identityKey=x=>[x.document_key,x.bill_number,x.bill_year,x.house,x.bill_name].map(norm).join('|');
 const complete=x=>x.document_key===`bill:${x.bill_year}:${x.bill_number}`&&x.bill_number&&/^\d{4}$/.test(String(x.bill_year))&&x.bill_name&&['Lok Sabha','Rajya Sabha'].includes(x.house);
 const listings=new Map(),urls=new Map(),groups=new Map(),holds=[];
 for(const r of rows){const bucket=listings.get(r.document_key)||[];bucket.push(r);listings.set(r.document_key,bucket);}
 for(const p of pack){const bucket=urls.get(p.file_url)||[];bucket.push(p);urls.set(p.file_url,bucket);}
 for(const p of pack)for(const link of p.links||[]){
  const key=link.document_key;const group=groups.get(key)||{identity:link,entries:[],reasons:new Set()};groups.set(key,group);
  if(!complete(link)||identityKey(group.identity)!==identityKey(link))group.reasons.add('conflicting_pack_identity');
  const peers=urls.get(p.file_url);
  if(new Set(peers.flatMap(x=>(x.links||[]).map(identityKey))).size!==1||new Set(peers.map(x=>x.content_sha256)).size!==1)group.reasons.add('conflicting_url_identity_or_text');
  const role=roles[link.role];
  if(!role)group.reasons.add('unknown_document_role');
  try{const u=new URL(p.file_url);if(u.protocol!=='https:'||u.hostname!=='sansad.in'||u.username||u.password||!/^\/getFile\/(?:BillsTexts\/|BillsPDFFiles\/Notification\/).*\.pdf$/i.test(u.pathname))group.reasons.add('unsupported_pdf_url');}catch{group.reasons.add('unsupported_pdf_url');}
  group.entries.push({role,url:p.file_url,source_key:p.source_key});
 }
 const sources=[];
 for(const [key,g] of groups){
  const rs=listings.get(key)||[],i=g.identity;
  if(!['Bill Passage Probability Index','Policy Intelligence Graph'].every(f=>rs.some(r=>r.feature===f))||rs.some(r=>norm(r.row.bill_number)!==norm(i.bill_number)||norm(r.row.house)!==norm(i.house)||norm(r.row.bill_name||r.row.title)!==norm(i.bill_name)))g.reasons.add('listing_identity_missing_or_collision');
  const pdf_links={};
  for(const e of g.entries){if(pdf_links[e.role]&&pdf_links[e.role]!==e.url)g.reasons.add('multiple_urls_for_same_role');pdf_links[e.role]=e.url;}
  if(g.reasons.size){holds.push({document_key:key,reasons:[...g.reasons],source_keys:[...new Set(g.entries.map(e=>e.source_key))]});continue;}
  sources.push({identity:Object.fromEntries(['document_key','bill_number','bill_year','bill_name','house'].map(k=>[k,i[k]])),pdf_links,evidence_source_keys:[...new Set(g.entries.map(e=>e.source_key))]});
 }
 return {sources,holds};
}
