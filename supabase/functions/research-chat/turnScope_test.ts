import { assertEquals } from 'jsr:@std/assert@1';
import { presearchFor, requiresWebContext } from './turnScope.ts';
import type { ResearchRequest } from './validate.ts';
const request: ResearchRequest = { message: 'tell me about this bill', turn_key: 't', focus: 'attached', attachments: [{ kind: 'record', title: 'National Anti-Doping (Amendment) Bill, 2025', text: 'record' }] };
Deno.test('generic research follows the current attachment even with previous subject history', () => {
  assertEquals(presearchFor(request, true, { attachments: [{bill_name:'National Anti-Doping (Amendment) Bill, 2025'}] }), 'National Anti-Doping (Amendment) Bill, 2025 — tell me about this bill');
  assertEquals(presearchFor({ ...request, message: 'What about penalties?' }, true), undefined);
  assertEquals(presearchFor({ ...request, focus: 'broad' }, true), undefined);
});
Deno.test('web context is required for missing-document overviews, but never merely for row fields', () => {
  assertEquals(requiresWebContext(request.message), true);
  assertEquals(requiresWebContext('What are the provisions of this bill?'), true);
  assertEquals(requiresWebContext('Which house introduced this bill?'), false);
  assertEquals(requiresWebContext('What is the current stage?'), false);
  assertEquals(requiresWebContext('What is its stage and what are its implications?'), true);
});
Deno.test('current selection outranks an older pinned bill for a deictic question', () => {
  assertEquals(presearchFor({ ...request, focus: 'selection', selection: { tier: 'national', feature: 'Bills', row: { bill_name: 'Current selected bill' } },
    attachments: [{ kind: 'record', title: 'Previous bill', text: 'record' }] }, true, {selection:{bill_name:'Current selected bill'},attachments:[{bill_name:'Previous bill'}]}), 'Current selected bill — tell me about this bill');
});
Deno.test('Law follow-ups retrieve current attached evidence despite prior conversation history', () => {
  const law = { ...request, message:'Did the tribunal award costs?', desk_context:{tier:'law',feature:'NCLT'}, attachments:[{kind:'record' as const,title:'Current order',text:'record',tier:'law'}] };
  assertEquals(presearchFor(law,true,{attachments:[{title:'Current order'}]}),'Current order — Did the tribunal award costs?');
  assertEquals(presearchFor({...law,focus:'broad'},true),'Did the tribunal award costs?');
});

Deno.test('F259: browser titles never become authoritative presearch subjects', () => {
  assertEquals(presearchFor(request, true), undefined);
  assertEquals(presearchFor(request, false), request.message);
  assertEquals(presearchFor(request, true, {attachments:[{name:'Member',subject:'Question subject'}]}), 'Question subject — tell me about this bill');
});
