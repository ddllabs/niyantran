import { assert, assertEquals } from 'jsr:@std/assert@1';
import { placeholderAnswer, placeholderPrefix } from './answerValidation.ts';
Deno.test('F249: exact placeholder and streamed prefixes are held, not ordinary prose',()=>{
 for(const token of ['llm_result',' LLM_RESULT\n']) assert(placeholderAnswer(token));
 for(const token of ['', 'l', 'llm_', 'llm_result ']) assert(placeholderPrefix(token));
 for(const prose of ['llm_result is an internal token.', 'The text mentions llm_result.', 'Legal result']) {
  assertEquals(placeholderAnswer(prose),false); assertEquals(placeholderPrefix(prose),false);
 }
});

Deno.test('F260: visual scaffolding cannot pass as substantive answer text', async () => {
  const { hasAnswerContent } = await import('./answerValidation.ts');
  for (const value of ['', ' ', '<p></p>', '<p>&nbsp;</p>', '<div>&#32;&#x20;</div>', '<!-- invisible -->', '<style>p { color:red }</style>', '<h2>Answer</h2>', '## Answer', '[1]', '**Search widened.** Searching all documents.', '**Unverified.** No sources retrieved.']) {
    assertEquals(hasAnswerContent(value), false, value);
  }
  for (const value of ['No.', '<p>The order was dismissed.</p>', '| Value |\n| --- |\n| 42 |', 'Insufficient evidence to establish that claim.', '**Unverified.** No sources retrieved.\n\nThe selected row lists 2024.']) assert(hasAnswerContent(value), value);
});
