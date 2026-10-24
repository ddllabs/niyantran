import { assert, assertEquals } from 'jsr:@std/assert@1';
import { lawReviewEvidence } from './lawPassages.ts';
import type { EvidenceMap } from './sources.ts';
import type { Chunk } from '../_shared/retrieval.ts';

function map(rows:Partial<Chunk>[]):EvidenceMap {
 return new Map(rows.map((row,i)=>[`ref:abcdef-${i+1}`,{kind:'text',chunk:{document_id:'d',desk_tier:'law',...row} as Chunk}]));
}
Deno.test('Paragraph units omit orphaned continuations instead of exposing quoted fragments alone',()=>{
 const e=map([{content:'The earlier case had a first CIRP.',char_from:200,paragraph_context:{text:'7.32 Other Case follows',chunkId:'missing',charFrom:0}}]);
 assertEquals(lawReviewEvidence(e),[]);
});
Deno.test('Paragraph units retain every citation handle and mark gaps without inventing bridging text',()=>{
 const e=map([{content:'7.32 Other Case follows: ',char_from:0},{content:'quoted ending.',char_from:100,paragraph_context:{text:'7.32 Other Case follows:',chunkId:'intro',charFrom:0}}]);
 const p=lawReviewEvidence(e)[0];
 assertEquals(p.sources,['ref:abcdef-1','ref:abcdef-2']);
 assert(p.text.includes('[Gap between supplied original spans]'));
 assert(p.text.startsWith('7.32 Other Case follows: '));
});
Deno.test('Paragraph grouping never crosses documents and excludes oversized or excessive-source units',()=>{
 const opening={content:'7.32 Original introduction.',char_from:0};
 const continuation={content:'Original continuation.',char_from:100,paragraph_context:{text:opening.content,chunkId:'intro',charFrom:0}};
 assertEquals(lawReviewEvidence(map([opening,{...continuation,document_id:'other'}])).length,1);
 assertEquals(lawReviewEvidence(map([{content:'7.32 '+ 'a'.repeat(12000),char_from:0}])),[]);
 const many=[opening,...Array.from({length:8},(_,i)=>({...continuation,char_from:100*(i+1)}))];
 assertEquals(lawReviewEvidence(map(many)),[]);
 assertEquals(lawReviewEvidence(map([opening]),10),[]);
});
Deno.test('Overlapping original paragraph spans are not duplicated in model text',()=>{
 const intro='7.32 An original quoted paragraph with more words.';
 const p=lawReviewEvidence(map([{content:intro,char_from:0},{content:intro.slice(20)+' The end.',char_from:20,paragraph_context:{text:intro,chunkId:'intro',charFrom:0}}]))[0];
 assertEquals(p.text,intro+' The end.');
 assertEquals(p.sources.length,2);
});

Deno.test('Structured Law evidence omits an unknown prefix and rejects conflicting overlap',()=>{
 const e=map([{content:'orphaned quote.\n7.33 The order is rejected.',char_from:100}]);
 const p=lawReviewEvidence(e);assertEquals(p.length,1);assert(!p[0].text.includes('orphaned'));
 const conflict=map([{content:'7.32 Original wording.',char_from:0},{content:'DIFFERENT wording.',char_from:5,paragraph_context:{text:'7.32 Original wording.',chunkId:'a',charFrom:0}}]);
 assertEquals(lawReviewEvidence(conflict),[]);
});
Deno.test('A decimal paragraph inside a visibly paired quotation stays with its original introduction',()=>{
 const p=lawReviewEvidence(map([{content:'7.32 Other Case is quoted: “\n3.31 That court found this.\n”\n7.33 Present order.',char_from:0}]));
 assertEquals(p.length,2);assert(p[0].text.includes('Other Case'));assert(p[0].text.includes('3.31'));
 assert(!p[1].text.includes('That court'));
});

Deno.test('Consistent chained overlapping spans retain their original coverage',()=>{
 const full='7.32 abcdefghijklmnopqrstuvwxyz';
 const p=lawReviewEvidence(map([{content:full.slice(0,10),char_from:0},{content:full.slice(5,20),char_from:5,paragraph_context:{text:full.slice(0,5),chunkId:'a',charFrom:0}},{content:full.slice(8,18),char_from:8,paragraph_context:{text:full.slice(0,5),chunkId:'a',charFrom:0}}]));
 assertEquals(p.length,1);assertEquals(p[0].text,full.slice(0,20));assertEquals(p[0].sources,['ref:abcdef-1','ref:abcdef-2']);
});
