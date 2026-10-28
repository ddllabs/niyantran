import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRepairs, renderRepairSql, pqAnswerKey } from './record-mapping-repair.mjs';
const doc = () => ({id:'11111111-1111-4111-8111-111111111111',source_key:'s1',title:'Film support',file_url:'https://sansad.in/getFile/loksabhaquestions/annex/187/AU234_FilmAb.pdf?source=pqals',content_sha256:'a'.repeat(64),indexed_at:'2026-10-27T00:00:00Z',desk_tier:'national',desk_feature:'Parliamentary Question Database',chunks:5,vectors:5,url_aliases:0,citation:{kind:'parliamentary_question',house:'Lok Sabha',subject:'Film support',answered_on:'01.04.2026',ministry:'Information'},review:{status:'eligible',checks:{identity:true,completeness:true,sensitivity:true,dedupe:true,rights:true}},rows:[{tier:'national',feature:'Parliamentary Question Database',row_key:'234',row:{house:'Lok Sabha',subject:'Film support',date:'2026-04-01',ministry:'Information',source_url:'https://sansad.in/getFile/loksabhaquestions/annex/187/AU234_FilmAb.pdf?source=pqals'},expected_fingerprint:'b'.repeat(64)}]});
const page = d => ({captured_at:'2026-10-27T19:06:57Z',documents:d});
test('one answer may map several MP rows without creating documents', () => {
 const d=doc(); d.rows.push({...d.rows[0],row_key:'235'});
 const p=planRepairs([page([d])]);assert.equal(p.candidates.length,2);assert.equal(p.ready_documents,1);assert.equal(p.held.length,0);
 assert.equal(p.candidates[0].document_id,d.id);
});
test('holds conflict, ambiguity, incomplete vectors, unsupported and missing evidence', () => {
 for(const mutate of [d=>{d.rows[0].row.house='Rajya Sabha'},d=>{d.rows[0].row.date='2026-04-02'},d=>{d.rows[0].row.subject='Other'},d=>{d.url_aliases=1},d=>{d.vectors=4},d=>{d.desk_tier='law'},d=>{d.rows=[]},d=>{d.review.checks.identity=false},d=>{d.rows[0].expected_fingerprint='bad'}]) {
  const d=doc();mutate(d);const p=planRepairs([page([d])]);assert.equal(p.candidates.length,0);assert.equal(p.held.length,1);
 }
});
test('refuses duplicate/moving inventories and binds rendering to exact bytes + named approval', () => {
 const d=doc();assert.throws(()=>planRepairs([page([d,d])]),/duplicate/);
 const p=planRepairs([page([d])]);const bytes=JSON.stringify(p);
 assert.throws(()=>renderRepairSql(bytes,{}),/approval/);
 assert.throws(()=>renderRepairSql(bytes,{approval:'wrong',decisionId:'x',approver:'Owner'}),/approval/);
});
test('render rejects invalid limits, held/candidate overlap and duplicate rows', async () => {
 const {createHash}=await import('node:crypto');const p=planRepairs([page([doc()])]);
 const render=(plan,limit)=>{const bytes=JSON.stringify(plan);return renderRepairSql(bytes,{approval:createHash('sha256').update(bytes).digest('hex'),decisionId:'reviewed',approver:'Owner',maxAssociations:limit});};
 for(const limit of [NaN,Infinity,0,-1,0.5])assert.throws(()=>render(p,limit),/limit/);
 assert.throws(()=>render({...p,held:[{document_id:p.candidates[0].document_id}],held_documents:1},100),/overlap|counts/);
 assert.throws(()=>render({...p,candidates:[...p.candidates,...p.candidates],candidate_associations:2},100),/duplicate/);
 assert.match(render(p,100),/record_mapping_apply/);
});
test('planner independently detects competing full URLs across distinct IDs', () => {
 const a=doc(),b={...doc(),id:'22222222-2222-4222-8222-222222222222'};
 const p=planRepairs([page([a]),page([b])]);assert.equal(p.candidates.length,0);assert.equal(p.held.length,2);
});
test('F266: the answer key must name the same Lok Sabha answer file for the document, its suggested key and every row', () => {
 assert.equal(pqAnswerKey(doc().file_url),'pq:ls:187:AU234_FilmAb');
 assert.equal(planRepairs([page([{...doc(),document_key_suggested:'pq:ls:187:AU234_FilmAb'}])]).candidates.length,1);
 for(const mutate of [d=>{d.document_key_suggested='pq:ls:187:AU999_Other'},d=>{d.file_url='https://sansad.in/getFile/a.pdf?source=pqals';d.rows[0].row.source_url=d.file_url}]){
  const d=doc();mutate(d);const p=planRepairs([page([d])]);assert.equal(p.candidates.length,0);assert.ok(p.held[0].reasons.includes('answer_key_conflict'));
 }
});
