import test from 'node:test';
import assert from 'node:assert/strict';
import { selectReviewBatch, inspectContext, proposeAnalysisIdentities } from './corpus-batch-review.mjs';

test('batch limits keep whole documents and never mark review candidates executable',()=>{
 const rows=Array.from({length:510},(_,i)=>({source_key:String(i),chunks:50,n_chars:10000}));
 const out=selectReviewBatch(rows);
 assert.equal(out.documents.length,400);assert.equal(out.chunks,20000);assert.equal(out.execution_authorized,false);
 assert.equal(selectReviewBatch(rows.map(x=>({...x,chunks:1}))).documents.length,500);
});
test('oversized and zero-chunk documents are excluded without truncation',()=>{
 const out=selectReviewBatch([{source_key:'oversize',chunks:801,n_chars:100},{source_key:'empty',chunks:0,n_chars:0},{source_key:'ok',chunks:5,n_chars:2000}]);
 assert.deepEqual(out.documents.map(x=>x.source_key),['ok']);
});
test('spaced enactment and lost clause context stay quality holds',()=>{
 const text='B E it enacted\n1. Short title.\nThis Act applies.';
 const result=inspectContext(text,[{content:text,charFrom:0,charTo:text.length,section:{},embedding_input:text}]);
 assert.ok(result.holds.includes('operative_clauses_not_recognized'));
 assert.equal(result.quality_accepted,false);
});
test('a sound automated screen does not substitute for source quality review',()=>{
 const text='BE it enacted\n1. Short title.';
 assert.equal(inspectContext(text,[{content:text,charFrom:0,charTo:text.length,section:{note:'1.'},embedding_input:text}]).quality_accepted,false);
});
test('one recognized clause cannot conceal a later missing clause',()=>{
 const text='BE it enacted\n1. Short title.\n43 of 1950.    2. In section three, substitute the following.';
 const result=inspectContext(text,[{content:text,charFrom:0,charTo:text.length,section:{note:'1.'},embedding_input:text}]);
 assert.deepEqual(result.missing_clause_markers,['2']);
 assert.ok(result.holds.includes('missing_clause_context_requires_review'));
});
test('analysis identity proposal requires every URL to agree, with no index/year guess',()=>{
 const identity={bill_number:'12',bill_year:'2025',bill_name:'Example Bill, 2025',house:'Lok Sabha',document_key:'bill:2025:12'};
 const map={1:{enrichment:{bill_number:'12',pdf_links:{introduced:'a',passed_both:'b'}}}};
 assert.equal(proposeAnalysisIdentities(map,new Map([['a',[identity]],['b',[identity]]])).accepted.length,1);
 assert.equal(proposeAnalysisIdentities(map,new Map([['a',[identity]]])).accepted.length,0);
 assert.equal(proposeAnalysisIdentities(map,new Map([['a',[identity]],['b',[{...identity,bill_year:'2024'}]]])).accepted.length,0);
});

test('optional synopsis/report links do not block an otherwise proven bill Download identity',()=>{
 const identity={bill_number:'12',bill_year:'2025',bill_name:'Example Bill, 2025',house:'Lok Sabha',document_key:'bill:2025:12'};
 const map={1:{enrichment:{bill_number:'12',pdf_links:{introduced:'a',passed_both:'b',synopsis:'not-a-bill',report:'committee-report'}}}};
 const result=proposeAnalysisIdentities(map,new Map([['a',[identity]],['b',[identity]]]));
 assert.equal(result.accepted.length,1);
 assert.deepEqual(result.accepted[0].urls,['a','b']);
 const broken={1:{enrichment:{bill_number:'12',pdf_links:{introduced:'a',passed_both:'unknown'}}}};
 assert.equal(proposeAnalysisIdentities(broken,new Map([['a',[identity]]])).accepted.length,0);
});

test('source registry joins full identities and isolates ambiguous bills',async()=>{
 const {proposeBillSources}=await import('./corpus-batch-review.mjs');
 const identity={bill_number:'12',bill_year:'2025',bill_name:'Example Bill, 2025',house:'Lok Sabha',document_key:'bill:2025:12'};
 const rows=['Bill Passage Probability Index','Policy Intelligence Graph'].map(feature=>({feature,document_key:identity.document_key,row:identity}));
 const source={source_key:'abc',file_url:'https://sansad.in/getFile/BillsTexts/example.pdf',content_sha256:'hash',links:[{...identity,role:'as_introduced'}]};
 assert.equal(proposeBillSources([source],rows).sources.length,1);
 assert.equal(proposeBillSources([source,{...source,source_key:'duplicate'}],rows).sources.length,1);
 assert.equal(proposeBillSources([source,{...source,file_url:'https://sansad.in/getFile/BillsTexts/other.pdf'}],rows).sources.length,0);
 assert.equal(proposeBillSources([source],rows.slice(0,1)).sources.length,0);
 assert.equal(proposeBillSources([source],[...rows,{...rows[0],row:{...identity,bill_name:'Unrelated Bill, 2025'}}]).sources.length,0);
 assert.equal(proposeBillSources([{...source,links:[...source.links,{...identity,bill_year:'2024',document_key:'bill:2024:12'}]}],rows).sources.length,0);
 assert.equal(proposeBillSources([source,{...source,content_sha256:'different'}],rows).sources.length,0);
});
