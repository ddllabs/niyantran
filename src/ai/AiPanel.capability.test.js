import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../lib/supabaseClient.js',()=>({supabase:null}));
import { confiningCount, documentNotice } from './AiPanel.jsx';
import { COVERAGE_TTL_MS, refreshCoverage, recheckCoverage, resetCoverageCache } from '../lib/corpusCoverage.js';
const row={kind:'row',document_key:'desk-record:["national","Questions","one"]'};
const direct={kind:'document',document_id:'00000000-0000-0000-0000-000000000001'};
const directKey=`document-id:${direct.document_id}`;
const db=(key,state,ids=[])=>({rpc:async()=>({data:(ids.length?ids:[null]).map(document_id=>({document_key:key,document_id,coverage:state})),error:null})});
beforeEach(()=>{vi.useFakeTimers();resetCoverageCache();});
afterEach(()=>vi.useRealTimers());

it('F264 scope notice counts usable partial pins and describes items rather than distinct documents',async()=>{
 await refreshCoverage([row.document_key],db(row.document_key,'partial',[direct.document_id]));
 await refreshCoverage([directKey],db(directKey,'full',[direct.document_id]));
 // Two different attached items can share the same source. Neither is two documents.
 expect(confiningCount([row,row,direct],new Set())).toBe(2);
 expect(documentNotice({switched:false,count:2})).toBe('Document attached. Text is available from 2 attached items.');
});

it('F264 stale, failed, unknown and revoked direct pins cannot inflate the usable count',async()=>{
 expect(confiningCount([direct],new Set([directKey]))).toBe(0);
 await refreshCoverage([directKey],db(directKey,'full',[direct.document_id]));
 expect(confiningCount([direct])).toBe(1);
 await recheckCoverage([directKey],{rpc:async()=>({error:{message:'offline'}})});
 expect(confiningCount([direct],new Set([directKey]))).toBe(0);
 await refreshCoverage([directKey],db(directKey,'unavailable'));
 expect(confiningCount([direct])).toBe(0);
 await refreshCoverage([directKey],db(directKey,'full',[direct.document_id]));
 await vi.advanceTimersByTimeAsync(COVERAGE_TTL_MS);
 expect(confiningCount([direct],new Set([directKey]))).toBe(0);
});

it('F264 a fresh verified full fallback can count an item without inventing a document ID',async()=>{
 await refreshCoverage([row.document_key],db(row.document_key,'full'));
 expect(confiningCount([row])).toBe(1);
 await recheckCoverage([row.document_key],{rpc:async()=>({error:{message:'offline'}})});
 expect(confiningCount([row],new Set([row.document_key]))).toBe(0);
});
