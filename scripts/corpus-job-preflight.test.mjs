import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as preflight from './corpus-job-preflight.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const candidate={source_key:'source',title:'The River Navigation (Amendment) Bill, 2025',content_sha256:sha('Evidence'),n_chars:8,chunks:1,document_keys:['bill:2025:4'],links:[{document_key:'bill:2025:4',bill_number:'4',bill_year:'2025',house:'Lok Sabha',role:'as_introduced'}],file_url:'https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/test.pdf?source=legislation'};
test('preflight rejects altered local text before fetching a PDF',()=>assert.throws(()=>preflight.checkSource(candidate,{source_key:'source',text:'Different',content_sha256:candidate.content_sha256}),/hash/));
test('PDF with the wrong bill number is held despite a matching title',()=>assert.throws(()=>preflight.checkPdfIdentity(candidate,'Bill No. 5 of 2025 THE RIVER NAVIGATION (AMENDMENT) BILL, 2025 AS INTRODUCED IN LOK SABHA','Evidence'),/number/));
test('PDF of a different version is held despite correct number/title',()=>assert.throws(()=>preflight.checkPdfIdentity(candidate,'Bill No. 4 of 2025 THE RIVER NAVIGATION (AMENDMENT) BILL, 2025 AS PASSED BY LOK SABHA','Evidence'),/version/));
test('matching header without matching body does not prove source text identity',()=>assert.throws(()=>preflight.checkPdfIdentity(candidate,'Bill No. 4 of 2025 THE RIVER NAVIGATION (AMENDMENT) BILL, 2025 TO BE INTRODUCED IN LOK SABHA unrelated contents','Evidence'),/text/));
test('wrong title under a correct header is held',()=>assert.throws(()=>preflight.checkPdfIdentity(candidate,'Bill No. 4 of 2025 THE MOUNTAIN TRANSPORT BILL, 2025 TO BE INTRODUCED IN LOK SABHA Evidence','Evidence'),/title/));
test('matching bill, role and complete source text pass',()=>assert.equal(preflight.checkPdfIdentity(candidate,'Bill No. 4 of 2025 THE RIVER NAVIGATION (AMENDMENT) BILL, 2025 TO BE INTRODUCED IN LOK SABHA Evidence','Evidence').status,'pass'));
test('stage packing respects both document and chunk bounds without splitting',()=>{const entries=Array.from({length:27},(_,i)=>({source_key:String(i),expected_chunks:45}));const stages=preflight.packStages(entries);assert.deepEqual(stages.map(x=>x.length),[22,5]);});
test('stage packing refuses a single oversized entry rather than silently expanding',()=>assert.throws(()=>preflight.packStages([{expected_chunks:101}]),/bound/));
test('layout reconstruction keeps marginal notes beside their original text line',()=>{const items=[{str:'Main second line',transform:[0,0,0,0,100,680]},{str:'Main first line',transform:[0,0,0,0,100,700]},{str:'Note',transform:[0,0,0,0,10,700]}];assert.equal(preflight.layoutText(items),'Note Main first line\nMain second line');});
test('observed displaced marginal baselines stay beside the corresponding body line',()=>{
 const items=[{str:'corporate, to be known as the Sammakka Sarakka Central',transform:[0,0,0,0,139.637,136.337]},{str:'of Sammakka',transform:[0,0,0,0,487.18,138.54]},{str:'Tribal University',transform:[0,0,0,0,139.637,124.242]},{str:'Sarakka Central',transform:[0,0,0,0,487.18,128.42]}];
 assert.equal(preflight.layoutText(items),'corporate, to be known as the Sammakka Sarakka Central of Sammakka\nSarakka Central\nTribal University');
});
test('layout keeps distinct close body lines separate',()=>assert.equal(preflight.layoutText([{str:'Upper',transform:[0,0,0,0,100,100]},{str:'Lower',transform:[0,0,0,0,100,95]}]),'Upper\nLower'));
test('spaced small-cap PDF labels still prove the passed-both-houses version',()=>{const c={...candidate,links:[{...candidate.links[0],role:'as_passed_both_houses'}],file_url:candidate.file_url.replace('Asintroduced','PassedBothHouses')};assert.equal(preflight.checkPdfIdentity(c,'Bill No. 4-F of 2025 THE RIVER NAVIGATION (AMENDMENT) BILL, 2025 A S PASSED BY THE H OUSES OF P ARLIAMENT Evidence','Evidence').status,'pass');});

test('medium stage packing accepts validated larger documents without splitting',()=>{const entries=[{expected_chunks:697},{expected_chunks:303},{expected_chunks:63}];assert.deepEqual(preflight.packStages(entries,'medium').map(x=>x.length),[2,1]);});
test('medium preflight policy has bounded audit limits and small default stays unchanged',()=>{assert.equal(preflight.preflightPolicy().document_chunks,100);assert.equal(preflight.preflightPolicy('medium').document_chunks,700);assert.equal(preflight.preflightPolicy('medium').document_chars,600000);assert.throws(()=>preflight.preflightPolicy('unknown'),/tier/);});
test('medium packing refuses sources above its own audit bound',()=>assert.throws(()=>preflight.packStages([{expected_chunks:701}],'medium'),/bound/));

test('figure dash in a passed bill header preserves exact bill identity',()=>{
  const c={...candidate,links:[{...candidate.links[0],role:'as_passed_both_houses'}],file_url:candidate.file_url.replace('Asintroduced','PassedBothHouses')};
  const header='Bill No. 4‒F of 2025 THE RIVER NAVIGATION (AMENDMENT) BILL, 2025 AS PASSED BY THE HOUSES OF PARLIAMENT Evidence';
  assert.equal(preflight.checkPdfIdentity(c,header,'Evidence').status,'pass');
  assert.equal(preflight.checkPdfIdentity(c,header.replace('4‒F','4 ‒ F'),'Evidence').bill_number,'4');
});
test('figure dash does not bypass bill number or year mismatches',()=>{
  const header='Bill No. 4‒F of 2025 THE RIVER NAVIGATION (AMENDMENT) BILL, 2025 AS INTRODUCED IN LOK SABHA Evidence';
  assert.throws(()=>preflight.checkPdfIdentity(candidate,header.replace('4‒F','5‒F'),'Evidence'),/number/);
  assert.throws(()=>preflight.checkPdfIdentity(candidate,header.replace('of 2025','of 2024'),'Evidence'),/number/);
});
