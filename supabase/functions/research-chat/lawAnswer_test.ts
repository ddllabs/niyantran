import { assert, assertEquals } from 'jsr:@std/assert@1';
import { reviewLawAnswer } from './lawAnswer.ts';
import type { EvidenceMap } from './sources.ts';
import type { Chunk } from '../_shared/retrieval.ts';
import type { ModelEvent, StreamRequest } from '../_shared/openrouterStream.ts';

const evidence: EvidenceMap = new Map([
 ['ref:abcdef-1',{kind:'text',chunk:{document_id:'d',desk_tier:'law',content:'The respondent submits that the debt remains unproven.'} as Chunk}],
 ['ref:abcdef-2',{kind:'text',chunk:{document_id:'d',desk_tier:'law',content:'The tribunal confines its inquiry to limitation. The application is rejected. No order as to cost.'} as Chunk}],
 ['ref:abcdef-3',{kind:'row',row:{record_text:'Rejected'} as never}],
]);
const selection = { passages: ['p1','p2'] };
const synthesis = { claims: [
 {text:'The respondent argued that the debt was unproven.',evidence:['p1']},
 {text:'The tribunal confined its inquiry to limitation and rejected the application with no order as to cost.',evidence:['p2']},
],uncertain:false};
const finish: ModelEvent = {type:'finish',reason:'stop',usage:null,served:null,generationId:null};
function replay(values: unknown[], seen: StreamRequest[] = []) {
 return async function*(req:StreamRequest):AsyncGenerator<ModelEvent>{seen.push(req);yield {type:'text',text:JSON.stringify(values.shift())};yield finish;};
}
const request = () => ({model:'test',question:'Was unproven debt a submission or finding, and what costs were ordered?',evidence,signal:new AbortController().signal});
Deno.test('F247 synthesizes answers with source-owned citations instead of dumping excerpts',async()=>{
 const a=await reviewLawAnswer(replay([selection,synthesis]),request());
 assert(a);assert(a.answer.includes('The respondent argued'));assert(!a.answer.includes('Original passages'));
 assertEquals(a.sources,[{id:1,source:'ref:abcdef-1'},{id:2,source:'ref:abcdef-2'}]);
});
Deno.test('F247 repairs an invalid follow-up shape once using the same evidence',async()=>{
 const seen:StreamRequest[]=[];
 const a=await reviewLawAnswer(replay([selection,{answer:'wrong shape'},synthesis],seen),request());
 assert(a);assertEquals(seen.length,3);
 assertEquals(JSON.parse(String(seen[1].messages[1].content)).passages,JSON.parse(String(seen[2].messages[1].content)).passages);
});
Deno.test('F247 binds a compound proposition to multiple supporting passages',async()=>{
 const compound={claims:[{text:'The respondent challenged proof of debt, while the tribunal confined its decision to limitation.',evidence:['p1','p2']}],uncertain:false};
 const a=await reviewLawAnswer(replay([selection,compound]),request());assert(a);
 assert(a.answer.includes('[1] [2]'));assertEquals(a.sources.length,2);
});

Deno.test('F247 rejects IDs absent from the focused synthesis input even if present in the original pool',async()=>{
 const bad={claims:[{text:'The tribunal rejected the application.',evidence:['p2']}],uncertain:false};
 const a=await reviewLawAnswer(replay([{passages:['p1']},bad,bad]),request());assertEquals(a,null);
});
Deno.test('F247 repairs a selector ID failure once and reserves the synthesis attempt',async()=>{
 const seen:StreamRequest[]=[];const minima:number[]=[];
 const a=await reviewLawAnswer(replay([{passages:['wrong']},selection,synthesis],seen),{...request(),takeAttempt:n=>{minima.push(n);return true;}});
 assert(a);assertEquals(seen.length,3);assertEquals(minima,[2,2,1]);
});
Deno.test('F247 allows only one correction across both stages',async()=>{
 const seen:StreamRequest[]=[];
 const a=await reviewLawAnswer(replay([{},selection,{}],seen),request());assertEquals(a,null);assertEquals(seen.length,3);
});
Deno.test('F247 does not start selection without budget for synthesis',async()=>{
 const seen:StreamRequest[]=[];
 assertEquals(await reviewLawAnswer(replay([selection],seen),{...request(),takeAttempt:()=>false}),null);assertEquals(seen.length,0);
});
Deno.test('F247 synthesis and correction each require the shared attempt gate',async()=>{
 for(const allowed of [1,2]) {
  let attempts=0;const seen:StreamRequest[]=[];
  const a=await reviewLawAnswer(replay([selection,{},synthesis],seen),{...request(),takeAttempt:()=>attempts++<allowed});
  assertEquals(a,null);assertEquals(seen.length,allowed);
 }
});
Deno.test('F247 excludes listing rows and bounds original evidence without truncating passages',async()=>{
 const e=new Map(evidence);e.set('ref:abcdef-4',{kind:'text',chunk:{content:'x'.repeat(80001)} as Chunk});
 const seen:StreamRequest[]=[];await reviewLawAnswer(replay([selection,synthesis],seen),{...request(),evidence:e});
 const passages=JSON.parse(String(seen[0].messages[1].content)).passages;
 assertEquals(passages.length,2);assert(!JSON.stringify(passages).includes('ref:abcdef'));assertEquals(passages[0].text,'The respondent submits that the debt remains unproven.');
});
Deno.test('F247 rejects duplicate, empty and oversized selector ID arrays',async()=>{
 for(const passages of [[],['p1','p1'],Array.from({length:13},(_,i)=>'p'+i)]) {
  assertEquals(await reviewLawAnswer(replay([{passages},{passages}]),request()),null);
 }
});
Deno.test('F247 numeric dates must occur in the sentence cited passages, not elsewhere',async()=>{
 const e=new Map(evidence);e.set('ref:abcdef-4',{kind:'text',chunk:{content:'Notice 01.09.2018; commencement 06.09.2018.'} as Chunk});
 for(const refs of [['p1'],['p3']]) {
  const answer={claims:[{text:'Limitation commenced on 2018-09-06.',evidence:refs}],uncertain:false};
  const a=await reviewLawAnswer(replay([{passages:['p1','p3']},answer,answer]),{...request(),evidence:e});
  assertEquals(!!a,refs[0]==='p3');
 }
});
Deno.test('F247 refuses fabricated markers, URLs, placeholders and uncited limitations',async()=>{
 for(const changed of [
  {...synthesis,limitations:['No merits finding was made.']},
  {claims:[{text:'llm_result',evidence:['p1']}],uncertain:false},
  {claims:[{text:'An invented finding [99].',evidence:['p1']}],uncertain:false},
  {claims:[{text:'See https://example.com for the conclusion.',evidence:['p1']}],uncertain:false},
  {claims:[{text:'The debtor submitted an objection.',evidence:[]}],uncertain:false},
 ]) assertEquals(await reviewLawAnswer(replay([selection,changed,changed]),request()),null);
});
Deno.test('F247 renders uncertainty using a fixed notice with no uncited model assertions',async()=>{
 const a=await reviewLawAnswer(replay([selection,{...synthesis,uncertain:true}]),request());assert(a);
 assert(a.answer.includes('available passages do not establish every part'));assert(!a.answer.includes('>'));
});
Deno.test('F247 observes cancellation before calling the provider and after output',async()=>{
 const c=new AbortController();c.abort();let called=false;
 try {await reviewLawAnswer(async function*(){called=true;yield finish;},{...request(),signal:c.signal});assert(false);} catch {assert(!called);}
 const d=new AbortController();let threw=false;
 try {await reviewLawAnswer(async function*(){yield {type:'text',text:JSON.stringify(selection)};d.abort();yield finish;},{...request(),signal:d.signal});} catch {threw=true;}
 assert(threw);
});
Deno.test('F247 refuses partial, missing, post-finish or tool-call output without retry',async()=>{
 for(const events of [
  [{type:'text',text:JSON.stringify(selection)},{...finish,reason:'length'}],
  [{type:'text',text:JSON.stringify(selection)}],
  [{type:'text',text:JSON.stringify(selection)},finish,{type:'text',text:' '}],
  [{type:'tool-call',id:'x',name:'x',args:'{}'},finish],
 ]) {let calls=0;const a=await reviewLawAnswer(async function*(){calls++;yield* events as ModelEvent[];},request());assertEquals(a,null);assertEquals(calls,1);}
});
Deno.test('F247 malformed JSON is repaired with a reason code but no raw content in diagnostics',async()=>{
 let i=0;const reasons:string[]=[];const provider:ReturnType<typeof replay>=async function*(){
  yield {type:'text',text:i++===0?'private malformed reply':JSON.stringify(i===2?selection:synthesis)};yield finish;
 };
 const a=await reviewLawAnswer(provider,{...request(),report:r=>reasons.push(r)});assert(a);assertEquals(reasons,['invalid_json']);
});
Deno.test('F247 supports conversational context without trusting assistant history as evidence',async()=>{
 const seen:StreamRequest[]=[];
 await reviewLawAnswer(replay([selection,synthesis],seen),{...request(),previousQuestions:['old','a'.repeat(2000),'What did the debtor say?']});
 const input=JSON.parse(String(seen[1].messages[1].content));assertEquals(input.previousQuestions.length,2);assertEquals(input.previousQuestions[0].length,1500);
});

Deno.test('F247 synthesis receives literal ambiguous heading trail alongside the original passage',async()=>{
 const e=new Map(evidence);
 const original=e.get('ref:abcdef-1')!;
 assert(original.kind==='text');
 e.set('ref:abcdef-1',{kind:'text',chunk:{...original.chunk,heading_context:[
  {text:'3. CONTENTIONS OF RESPONDENT',chunkId:'h',charFrom:0},
  {text:'50. Suffice it to conclude that there is no substance',chunkId:'q',charFrom:100},
 ]}});
 const seen:StreamRequest[]=[];
 await reviewLawAnswer(replay([selection,synthesis],seen),{...request(),evidence:e});
 for(const call of seen) {
  const passage=JSON.parse(String(call.messages[1].content)).passages.find((p:{id:string})=>p.id==='p1');
  assert(passage.context.includes('3. CONTENTIONS OF RESPONDENT'));
  assert(passage.context.includes('50. Suffice it'));
  assert(passage.context.includes('Do not assume'));
  assertEquals(passage.text,original.chunk.content);
 }
});

Deno.test('F247 repairs leaked internal passage IDs rather than presenting them as page citations',async()=>{
 const leaked={claims:[{text:'The tribunal rejected the application (p2).',evidence:['p2']}],uncertain:false};
 const seen:StreamRequest[]=[];
 const a=await reviewLawAnswer(replay([selection,leaked,synthesis],seen),request());
 assert(a);assertEquals(seen.length,3);assert(!a.answer.includes('(p2)'));
});
