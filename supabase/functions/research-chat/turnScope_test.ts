import { assertEquals } from 'jsr:@std/assert@1';
import { presearchFor, requiresWebContext } from './turnScope.ts';
import type { ResearchRequest } from './validate.ts';
const request: ResearchRequest = { message: 'tell me about this bill', turn_key: 't', focus: 'attached', attachments: [{ kind: 'record', title: 'National Anti-Doping (Amendment) Bill, 2025', text: 'record' }] };
Deno.test('generic research follows the current attachment even with previous subject history', () => {
  assertEquals(presearchFor(request, true), 'National Anti-Doping (Amendment) Bill, 2025 — tell me about this bill');
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
    attachments: [{ kind: 'record', title: 'Previous bill', text: 'record' }] }, true), 'Current selected bill — tell me about this bill');
});
