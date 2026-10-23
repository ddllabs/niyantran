import { assert, assertEquals } from 'jsr:@std/assert@1';
import { lawReviewEvidence, parseLawReview, reviewLawAnswer } from './lawAnswer.ts';
import type { EvidenceMap } from './sources.ts';
import type { ModelEvent } from '../_shared/openrouterStream.ts';
import type { Chunk } from '../_shared/retrieval.ts';
const quote = '7.34 Accordingly, the application is rejected. No order as to cost.';
const evidence: EvidenceMap = new Map([
 ['ref:abcdef-1', {kind:'text',chunk:{desk_tier:'law',content:quote} as Chunk}],
 ['ref:abcdef-2', {kind:'row',row:{record_text:quote} as never}],
]);
const raw = (extra = {}) => JSON.stringify({claims:[{statement:'The tribunal rejected the application with no order as to cost.',source:'ref:abcdef-1',quote,...extra}],uncertain:false});
Deno.test('Law review binds exact original text to server-owned citations',()=>{
 const answer=parseLawReview(raw(),lawReviewEvidence(evidence)); assert(answer);
 assertEquals(answer.sources,[{id:1,source:'ref:abcdef-1'}]); assert(answer.answer.includes(quote));
});
Deno.test('Law review rejects listing support, unknown handles and fabricated quotations',()=>{
 for(const change of [{source:'ref:abcdef-2'},{source:'ref:abcdef-3'},{quote:quote.replace('No order','An order')},{statement:'A purported holding [99]'}]) assertEquals(parseLawReview(raw(change),lawReviewEvidence(evidence)),null);
});
Deno.test('Law review accepts whitespace differences without changing source words',()=>{
 assert(parseLawReview(raw({quote:quote.replace('Accordingly,','Accordingly,\n')}),lawReviewEvidence(evidence)));
});
Deno.test('Law review rejects empty, malformed and oversized answers',()=>{
 for(const input of ['llm_result','{}',JSON.stringify({claims:[],uncertain:true}),raw({statement:'llm_result'}),raw({quote:'x'.repeat(1601)})]) assertEquals(parseLawReview(input,lawReviewEvidence(evidence)),null);
});
Deno.test('Law reviewer refuses unfinished output and tool calls',async()=>{
 for(const events of [[{type:'text',text:raw()},{type:'finish',reason:'length'}],[{type:'text',text:raw()},{type:'tool-call'},{type:'finish',reason:'stop'}]]) {
  const value=await reviewLawAnswer(async function*(){yield* events as ModelEvent[];},{model:'test',question:'costs?',draft:'bad draft',evidence,signal:new AbortController().signal}); assertEquals(value,null);
 }
});
Deno.test('Law review input excludes rows and enforces text budget',()=>{
 const large=new Map(evidence);large.set('ref:abcdef-4',{kind:'text',chunk:{desk_tier:'law',content:'x'.repeat(80001)} as Chunk});
 assertEquals([...lawReviewEvidence(large).keys()],['ref:abcdef-1']);
});
Deno.test('Review preserves positional-heading uncertainty and mixed-desk text',()=>{
 const mixed = new Map(evidence);
 mixed.set('ref:abcdef-5',{kind:'text',chunk:{desk_tier:'national',content:quote} as Chunk});
 mixed.set('ref:abcdef-6',{kind:'text',chunk:{desk_tier:'law',content:quote,preceding_heading:{text:'7. ANALYSIS',chunkId:'x',charFrom:0}} as Chunk});
 const data=lawReviewEvidence(mixed);
 assert(data.has('ref:abcdef-5'));
 assert(data.get('ref:abcdef-6')!.context.includes('does not establish the governing speaker'));
});
Deno.test('Law review observes cancellation and never accepts post-finish text',async()=>{
 const controller=new AbortController();controller.abort();
 let threw=false;
 try {await reviewLawAnswer(async function*(){yield {type:'text',text:raw()};},{model:'x',question:'q',draft:'d',evidence,signal:controller.signal});} catch {threw=true;}
 assert(threw);
 const value=await reviewLawAnswer(async function*(){yield {type:'text',text:raw()};yield {type:'finish',reason:'stop',usage:null,served:null,generationId:null};yield {type:'text',text:' '};},{model:'x',question:'q',draft:'d',evidence,signal:new AbortController().signal});
 assertEquals(value,null);
});
Deno.test('Review carries bounded server document identity instead of trusting draft case labels',()=>{
 const data:EvidenceMap=new Map([['ref:abcdef-9',{kind:'text',chunk:{desk_tier:'law',content:quote,title:'Case A '.repeat(100),document_id:'document-a'} as Chunk}]]);
 const entry=lawReviewEvidence(data).get('ref:abcdef-9')!;
 assertEquals(entry.documentId,'document-a');assertEquals(entry.title.length,300);
});
